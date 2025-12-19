import { ImapConnectionPool } from '../connection/imap-pool.js';
import { SMTPClient } from '../connection/smtp-client.js';
import { EmailService } from './email.service.js';
import { FolderService } from './folder.service.js';
import { LabelService } from './label.service.js';
import { TrendService } from './trend.service.js';
import type { ProtonMailConfig } from '../types.js';

export interface Services {
  email: EmailService;
  folder: FolderService;
  label: LabelService;
  trend: TrendService;
}

export function createServices(
  imapPool: ImapConnectionPool,
  smtpClient: SMTPClient,
  config: ProtonMailConfig
): Services {
  const folderService = new FolderService(imapPool);
  const emailService = new EmailService(imapPool, smtpClient, config.limits);
  const labelService = new LabelService(imapPool, folderService);
  const trendService = new TrendService(emailService, folderService);

  return {
    email: emailService,
    folder: folderService,
    label: labelService,
    trend: trendService
  };
}

export { EmailService } from './email.service.js';
export { FolderService } from './folder.service.js';
export { LabelService } from './label.service.js';
export { TrendService } from './trend.service.js';
