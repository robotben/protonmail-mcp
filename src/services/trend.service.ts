import { EmailService } from './email.service.js';
import { FolderService } from './folder.service.js';
import type {
  EmailMessage,
  EmailTrendAnalysis,
  LabelDistribution,
  ImportanceCriteria,
  ImportantEmail,
  SenderStats
} from '../types.js';

export class TrendService {
  private emailService: EmailService;
  private folderService: FolderService;

  constructor(emailService: EmailService, folderService: FolderService) {
    this.emailService = emailService;
    this.folderService = folderService;
  }

  async analyzeEmailTrends(
    period: 'day' | 'week' | 'month',
    folder: string = 'INBOX'
  ): Promise<EmailTrendAnalysis> {
    const dateRange = this.getDateRange(period);

    const emails = await this.emailService.searchEmails({
      folder,
      dateFrom: dateRange.start.toISOString(),
      dateTo: dateRange.end.toISOString(),
      limit: 1000
    });

    const hourlyDistribution = this.calculateHourlyDistribution(emails);
    const senderFrequency = this.calculateSenderFrequency(emails);
    const readRatio = this.calculateReadRatio(emails);
    const peakHours = this.findPeakHours(hourlyDistribution);

    return {
      period,
      folder,
      dateRange: {
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString()
      },
      totalEmails: emails.length,
      readRatio,
      hourlyDistribution,
      topSenders: senderFrequency.slice(0, 10),
      peakHours
    };
  }

  async analyzeLabelDistribution(
    dateFrom?: string,
    dateTo?: string
  ): Promise<LabelDistribution> {
    const folders = await this.folderService.listFolders();
    const distribution: Record<string, number> = {};
    let totalEmails = 0;

    for (const folder of folders) {
      try {
        const count = await this.emailService.getEmailCount(
          folder.path,
          dateFrom,
          dateTo
        );
        distribution[folder.name] = count;
        totalEmails += count;
      } catch {
        distribution[folder.name] = 0;
      }
    }

    const mostUsed = Object.entries(distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    return {
      dateRange: {
        start: dateFrom || 'all time',
        end: dateTo || new Date().toISOString()
      },
      totalEmails,
      byLabel: distribution,
      mostUsed
    };
  }

  async identifyImportantEmails(
    criteria: ImportanceCriteria,
    folder: string = 'INBOX'
  ): Promise<ImportantEmail[]> {
    const emails = await this.emailService.searchEmails({
      folder,
      isUnread: true, // Focus on unread emails by default
      limit: 500
    });

    const scored = emails
      .map(email => this.scoreEmail(email, criteria))
      .filter(email => email.importanceScore >= (criteria.minScore || 10))
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, criteria.limit || 20);

    return scored;
  }

  async getEmailActivity(folder: string = 'INBOX', hours: number = 24): Promise<{
    received: number;
    read: number;
    unread: number;
    hourlyBreakdown: Record<number, number>;
  }> {
    const since = new Date();
    since.setHours(since.getHours() - hours);

    const emails = await this.emailService.searchEmails({
      folder,
      dateFrom: since.toISOString(),
      limit: 500
    });

    const read = emails.filter(e => e.flags.includes('\\Seen')).length;
    const hourlyBreakdown = this.calculateHourlyDistribution(emails);

    return {
      received: emails.length,
      read,
      unread: emails.length - read,
      hourlyBreakdown
    };
  }

  async getSenderAnalytics(folder: string = 'INBOX', limit: number = 20): Promise<{
    topSenders: SenderStats[];
    totalUniqueSenders: number;
    avgEmailsPerSender: number;
  }> {
    const emails = await this.emailService.listEmails(folder, 500, 0, 'desc');
    const senderStats = this.calculateSenderFrequency(emails);

    return {
      topSenders: senderStats.slice(0, limit),
      totalUniqueSenders: senderStats.length,
      avgEmailsPerSender: emails.length / (senderStats.length || 1)
    };
  }

  private scoreEmail(email: EmailMessage, criteria: ImportanceCriteria): ImportantEmail {
    let score = 0;
    const reasons: string[] = [];

    // Frequent sender bonus
    if (criteria.frequentSenders?.some(
      sender => email.from.address.toLowerCase().includes(sender.toLowerCase())
    )) {
      score += 30;
      reasons.push('From frequent sender');
    }

    // Priority keywords in subject
    const subjectLower = email.subject.toLowerCase();
    for (const keyword of criteria.priorityKeywords || []) {
      if (subjectLower.includes(keyword.toLowerCase())) {
        score += 20;
        reasons.push(`Contains priority keyword: ${keyword}`);
      }
    }

    // Urgency keywords
    const urgencyKeywords = ['urgent', 'asap', 'important', 'action required', 'deadline'];
    for (const keyword of urgencyKeywords) {
      if (subjectLower.includes(keyword)) {
        score += 15;
        reasons.push(`Contains urgency keyword: ${keyword}`);
        break;
      }
    }

    // Recent emails get higher score
    const emailDate = new Date(email.date);
    const ageInHours = (Date.now() - emailDate.getTime()) / (1000 * 60 * 60);
    if (ageInHours < 1) {
      score += 20;
      reasons.push('Received within last hour');
    } else if (ageInHours < 4) {
      score += 15;
      reasons.push('Received within last 4 hours');
    } else if (ageInHours < 24) {
      score += 10;
      reasons.push('Received today');
    }

    // Unread emails are more important
    if (!email.flags.includes('\\Seen')) {
      score += 10;
      reasons.push('Unread');
    }

    // Starred/flagged emails
    if (email.flags.includes('\\Flagged')) {
      score += 25;
      reasons.push('Flagged/starred');
    }

    // Has attachments might indicate important content
    if (email.hasAttachments) {
      score += 5;
      reasons.push('Has attachments');
    }

    // Direct recipient (not CC'd)
    // This would require checking if user is in TO vs CC

    return {
      ...email,
      importanceScore: score,
      reasons
    };
  }

  private getDateRange(period: 'day' | 'week' | 'month'): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();

    switch (period) {
      case 'day':
        start.setDate(start.getDate() - 1);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
    }

    return { start, end };
  }

  private calculateHourlyDistribution(emails: EmailMessage[]): Record<number, number> {
    const distribution: Record<number, number> = {};
    for (let i = 0; i < 24; i++) {
      distribution[i] = 0;
    }

    for (const email of emails) {
      const hour = new Date(email.date).getHours();
      distribution[hour]++;
    }

    return distribution;
  }

  private calculateSenderFrequency(emails: EmailMessage[]): SenderStats[] {
    const frequency: Record<string, { count: number; name: string }> = {};

    for (const email of emails) {
      const address = email.from.address.toLowerCase();
      if (!frequency[address]) {
        frequency[address] = {
          count: 0,
          name: email.from.name || address
        };
      }
      frequency[address].count++;
    }

    return Object.entries(frequency)
      .map(([address, stats]) => ({
        address,
        name: stats.name,
        count: stats.count
      }))
      .sort((a, b) => b.count - a.count);
  }

  private findPeakHours(distribution: Record<number, number>): number[] {
    return Object.entries(distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => parseInt(hour, 10));
  }

  private calculateReadRatio(emails: EmailMessage[]): number {
    if (emails.length === 0) return 0;
    const read = emails.filter(e => e.flags.includes('\\Seen')).length;
    return Math.round((read / emails.length) * 100) / 100;
  }
}
