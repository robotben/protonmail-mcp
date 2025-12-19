import nodemailer, { Transporter } from 'nodemailer';
import type { SMTPConfig, AuthConfig, SendEmailOptions } from '../types.js';
import { SMTPError, ConnectionError, AuthenticationError } from '../utils/errors.js';

interface SendMailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export class SMTPClient {
  private transporter: Transporter;
  private config: SMTPConfig;
  private authConfig: AuthConfig;
  private verified = false;

  constructor(config: SMTPConfig, auth: AuthConfig) {
    this.config = config;
    this.authConfig = auth;

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTLS,
      auth: {
        user: auth.user,
        pass: auth.pass
      },
      tls: {
        rejectUnauthorized: config.tls.rejectUnauthorized,
        minVersion: config.tls.minVersion as 'TLSv1.2' | 'TLSv1.3'
      }
    });
  }

  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.verified = true;
      return true;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('ECONNREFUSED')) {
        throw new ConnectionError(
          'Cannot connect to ProtonMail Bridge SMTP server. Is it running?',
          { host: this.config.host, port: this.config.port }
        );
      }
      if (err.message.toLowerCase().includes('auth')) {
        throw new AuthenticationError(
          'SMTP authentication failed. Check your Bridge credentials.'
        );
      }
      throw new SMTPError(`SMTP verification failed: ${err.message}`);
    }
  }

  async sendMail(options: SendEmailOptions): Promise<SendMailResult> {
    if (!this.verified) {
      await this.verify();
    }

    const mailOptions = {
      from: options.from || this.authConfig.user,
      to: options.to.join(', '),
      cc: options.cc?.join(', '),
      bcc: options.bcc?.join(', '),
      subject: options.subject,
      text: options.body,
      html: options.htmlBody,
      inReplyTo: options.inReplyTo,
      references: options.references?.join(' '),
      attachments: options.attachments?.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType
      }))
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      return {
        messageId: info.messageId,
        accepted: Array.isArray(info.accepted)
          ? info.accepted.map(String)
          : [String(info.accepted)],
        rejected: Array.isArray(info.rejected)
          ? info.rejected.map(String)
          : info.rejected ? [String(info.rejected)] : []
      };
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('ECONNREFUSED')) {
        this.verified = false;
        throw new ConnectionError(
          'Lost connection to ProtonMail Bridge SMTP server',
          { host: this.config.host, port: this.config.port }
        );
      }
      throw new SMTPError(`Failed to send email: ${err.message}`);
    }
  }

  async close(): Promise<void> {
    this.transporter.close();
    this.verified = false;
  }
}
