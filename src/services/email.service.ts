import { simpleParser, ParsedMail } from 'mailparser';
import { ImapConnectionPool } from '../connection/imap-pool.js';
import { SMTPClient } from '../connection/smtp-client.js';
import type {
  EmailMessage,
  EmailMessageFull,
  EmailAddress,
  EmailAttachment,
  SendEmailOptions,
  SearchOptions,
  LimitsConfig,
  ErrorType
} from '../types.js';
import { NotFoundError, IMAPError } from '../utils/errors.js';
import { ErrorType as ErrorTypeEnum } from '../types.js';

export class EmailService {
  private imapPool: ImapConnectionPool;
  private smtpClient: SMTPClient;
  private limits: LimitsConfig;

  constructor(
    imapPool: ImapConnectionPool,
    smtpClient: SMTPClient,
    limits: LimitsConfig
  ) {
    this.imapPool = imapPool;
    this.smtpClient = smtpClient;
    this.limits = limits;
  }

  async listEmails(
    folder: string = 'INBOX',
    limit: number = this.limits.defaultPageSize,
    offset: number = 0,
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<EmailMessage[]> {
    limit = Math.min(limit, this.limits.maxPageSize);

    return this.imapPool.withMailbox(folder, async (client, lock) => {
      const messages: EmailMessage[] = [];
      const mailboxStatus = client.mailbox;

      if (!mailboxStatus || mailboxStatus.exists === 0) {
        return [];
      }

      const total = mailboxStatus.exists;

      // Calculate sequence range
      let start: number, end: number;
      if (sortOrder === 'desc') {
        end = Math.max(1, total - offset);
        start = Math.max(1, end - limit + 1);
      } else {
        start = offset + 1;
        end = Math.min(total, offset + limit);
      }

      if (start > end || start > total) {
        return [];
      }

      for await (const message of client.fetch(`${start}:${end}`, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        size: true
      })) {
        messages.push(this.mapMessage(message));
      }

      return sortOrder === 'desc' ? messages.reverse() : messages;
    });
  }

  async getEmail(
    folder: string,
    uid: string,
    includeAttachments: boolean = false
  ): Promise<EmailMessageFull> {
    return this.imapPool.withMailbox(folder, async (client, lock) => {
      const uidNum = parseInt(uid, 10);

      for await (const message of client.fetch(
        `${uidNum}`,
        {
          envelope: true,
          flags: true,
          bodyStructure: true,
          size: true,
          source: true,
          uid: true
        }
      )) {
        return await this.parseFullMessage(message, includeAttachments);
      }

      throw new NotFoundError('Email', uid, ErrorTypeEnum.EMAIL_NOT_FOUND);
    });
  }

  async getEmailHeaders(folder: string, uid: string): Promise<EmailMessage> {
    return this.imapPool.withMailbox(folder, async (client, lock) => {
      const uidNum = parseInt(uid, 10);

      for await (const message of client.fetch(
        `${uidNum}`,
        {
          envelope: true,
          flags: true,
          bodyStructure: true,
          size: true,
          uid: true
        }
      )) {
        return this.mapMessage(message);
      }

      throw new NotFoundError('Email', uid, ErrorTypeEnum.EMAIL_NOT_FOUND);
    });
  }

  async searchEmails(options: SearchOptions): Promise<EmailMessage[]> {
    const folder = options.folder || 'INBOX';
    const limit = Math.min(options.limit || this.limits.defaultPageSize, this.limits.maxSearchResults);

    return this.imapPool.withMailbox(folder, async (client, lock) => {
      const searchCriteria = this.buildSearchCriteria(options);

      let uids: number[];
      try {
        uids = await client.search(searchCriteria, { uid: true }) as number[];
      } catch (error) {
        throw new IMAPError(`Search failed: ${(error as Error).message}`);
      }

      if (uids.length === 0) {
        return [];
      }

      // Apply offset and limit
      const offset = options.offset || 0;
      const selectedUids = uids.slice(offset, offset + limit);

      if (selectedUids.length === 0) {
        return [];
      }

      const messages: EmailMessage[] = [];
      const uidStr = selectedUids.join(',');
      for await (const message of client.fetch(
        uidStr,
        {
          envelope: true,
          flags: true,
          bodyStructure: true,
          size: true,
          uid: true
        }
      )) {
        messages.push(this.mapMessage(message));
      }

      return messages;
    });
  }

  async getUnreadCount(folders: string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    for (const folder of folders) {
      try {
        await this.imapPool.withConnection(async (client) => {
          const status = await client.status(folder, { unseen: true });
          counts[folder] = status.unseen || 0;
        });
      } catch {
        counts[folder] = -1; // Indicate error
      }
    }

    return counts;
  }

  async markAsRead(folder: string, uids: string[]): Promise<void> {
    return this.imapPool.withMailbox(folder, async (client, lock) => {
      const uidStr = uids.join(',');
      await client.messageFlagsAdd(uidStr, ['\\Seen'], { uid: true });
    }, false);
  }

  async markAsUnread(folder: string, uids: string[]): Promise<void> {
    return this.imapPool.withMailbox(folder, async (client, lock) => {
      const uidStr = uids.join(',');
      await client.messageFlagsRemove(uidStr, ['\\Seen'], { uid: true });
    }, false);
  }

  async sendEmail(options: SendEmailOptions): Promise<{ messageId: string }> {
    const result = await this.smtpClient.sendMail(options);
    return { messageId: result.messageId };
  }

  async replyToEmail(
    folder: string,
    uid: string,
    body: string,
    htmlBody?: string,
    replyAll: boolean = false
  ): Promise<{ messageId: string }> {
    const original = await this.getEmail(folder, uid, false);

    const to = replyAll
      ? [original.from.address, ...original.to.map(t => t.address)]
      : [original.from.address];

    const cc = replyAll && original.cc
      ? original.cc.map(c => c.address)
      : undefined;

    const subject = original.subject.startsWith('Re:')
      ? original.subject
      : `Re: ${original.subject}`;

    return this.sendEmail({
      to: [...new Set(to)], // Remove duplicates
      cc: cc ? [...new Set(cc)] : undefined,
      subject,
      body,
      htmlBody,
      inReplyTo: original.messageId,
      references: original.references
        ? [...original.references, original.messageId!]
        : [original.messageId!]
    });
  }

  async forwardEmail(
    folder: string,
    uid: string,
    to: string[],
    body?: string
  ): Promise<{ messageId: string }> {
    const original = await this.getEmail(folder, uid, true);

    const subject = original.subject.startsWith('Fwd:')
      ? original.subject
      : `Fwd: ${original.subject}`;

    const forwardBody = `${body || ''}\n\n---------- Forwarded message ----------\nFrom: ${original.from.name || ''} <${original.from.address}>\nDate: ${original.date}\nSubject: ${original.subject}\nTo: ${original.to.map(t => t.address).join(', ')}\n\n${original.body || ''}`;

    return this.sendEmail({
      to,
      subject,
      body: forwardBody,
      htmlBody: original.htmlBody,
      attachments: original.attachments?.map(att => ({
        filename: att.filename,
        content: att.content!,
        contentType: att.contentType
      }))
    });
  }

  async moveEmails(
    sourceFolder: string,
    targetFolder: string,
    uids: string[]
  ): Promise<void> {
    return this.imapPool.withMailbox(sourceFolder, async (client, lock) => {
      const uidStr = uids.join(',');
      await client.messageMove(uidStr, targetFolder, { uid: true });
    }, false);
  }

  async deleteEmails(folder: string, uids: string[]): Promise<void> {
    return this.imapPool.withMailbox(folder, async (client, lock) => {
      const uidStr = uids.join(',');
      await client.messageDelete(uidStr, { uid: true });
    }, false);
  }

  async getEmailCount(
    folder: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<number> {
    return this.imapPool.withConnection(async (client) => {
      if (!dateFrom && !dateTo) {
        const status = await client.status(folder, { messages: true });
        return status.messages || 0;
      }

      // Need to open mailbox for search
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const searchCriteria: Record<string, unknown> = {};
        if (dateFrom) searchCriteria.since = new Date(dateFrom);
        if (dateTo) searchCriteria.before = new Date(dateTo);

        const uids = await client.search(searchCriteria, { uid: true });
        return (uids as number[]).length;
      } finally {
        lock.release();
      }
    });
  }

  private mapMessage(message: any): EmailMessage {
    const envelope = message.envelope || {};

    return {
      uid: message.uid?.toString() || message.seq?.toString() || '0',
      messageId: envelope.messageId,
      subject: envelope.subject || '(no subject)',
      from: this.mapAddress(envelope.from?.[0]),
      to: (envelope.to || []).map((a: any) => this.mapAddress(a)),
      cc: envelope.cc ? envelope.cc.map((a: any) => this.mapAddress(a)) : undefined,
      date: envelope.date?.toISOString() || new Date().toISOString(),
      flags: message.flags ? [...message.flags] : [],
      hasAttachments: this.hasAttachments(message.bodyStructure),
      size: message.size
    };
  }

  private async parseFullMessage(
    message: any,
    includeAttachments: boolean
  ): Promise<EmailMessageFull> {
    const base = this.mapMessage(message);
    const envelope = message.envelope || {};

    let body: string | undefined;
    let htmlBody: string | undefined;
    let attachments: EmailAttachment[] = [];

    if (message.source) {
      try {
        const parsed: ParsedMail = await simpleParser(message.source);
        body = parsed.text;
        htmlBody = parsed.html || undefined;

        if (includeAttachments && parsed.attachments) {
          attachments = parsed.attachments.map(att => ({
            filename: att.filename || 'attachment',
            contentType: att.contentType,
            size: att.size,
            contentId: att.contentId,
            content: att.content
          }));
        }
      } catch (error) {
        console.error('Failed to parse email:', error);
      }
    }

    return {
      ...base,
      body,
      htmlBody,
      attachments: includeAttachments ? attachments : undefined,
      replyTo: envelope.replyTo
        ? envelope.replyTo.map((a: any) => this.mapAddress(a))
        : undefined,
      inReplyTo: envelope.inReplyTo,
      references: envelope.references
    };
  }

  private mapAddress(addr: any): EmailAddress {
    if (!addr) {
      return { address: 'unknown' };
    }
    return {
      name: addr.name || undefined,
      address: addr.address || 'unknown'
    };
  }

  private hasAttachments(bodyStructure: any): boolean {
    if (!bodyStructure) return false;
    if (bodyStructure.disposition === 'attachment') return true;
    if (bodyStructure.childNodes) {
      return bodyStructure.childNodes.some((node: any) => this.hasAttachments(node));
    }
    return false;
  }

  private buildSearchCriteria(options: SearchOptions): Record<string, unknown> {
    const criteria: Record<string, unknown> = {};

    if (options.query) {
      // Search in subject, body, from, and to
      criteria.or = [
        { subject: options.query },
        { body: options.query },
        { from: options.query },
        { to: options.query }
      ];
    }

    if (options.from) {
      criteria.from = options.from;
    }

    if (options.to) {
      criteria.to = options.to;
    }

    if (options.subject) {
      criteria.subject = options.subject;
    }

    if (options.dateFrom) {
      criteria.since = new Date(options.dateFrom);
    }

    if (options.dateTo) {
      criteria.before = new Date(options.dateTo);
    }

    if (options.hasAttachment !== undefined) {
      // IMAP doesn't have a direct attachment search, will filter in memory if needed
    }

    if (options.isUnread === true) {
      criteria.unseen = true;
    } else if (options.isUnread === false) {
      criteria.seen = true;
    }

    // If no criteria specified, match all
    if (Object.keys(criteria).length === 0) {
      criteria.all = true;
    }

    return criteria;
  }
}
