// Configuration Types
export interface ProtonMailConfig {
  protonmail: {
    imap: IMAPConfig;
    smtp: SMTPConfig;
    auth: AuthConfig;
  };
  server: ServerConfig;
  connection: ConnectionConfig;
  cache: CacheConfig;
  limits: LimitsConfig;
}

export interface IMAPConfig {
  host: string;
  port: number;
  secure: boolean;
  tls: TLSConfig;
}

export interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  tls: TLSConfig;
}

export interface TLSConfig {
  rejectUnauthorized: boolean;
  minVersion: string;
}

export interface AuthConfig {
  user: string;
  pass: string;
}

export interface ServerConfig {
  transport: 'stdio' | 'http';
  httpPort: number;
  httpPath: string;
}

export interface ConnectionConfig {
  poolSize: number;
  idleTimeout: number;
  connectionTimeout: number;
  maxRetries: number;
  retryDelay: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttl: number;
  maxSize: number;
}

export interface LimitsConfig {
  defaultPageSize: number;
  maxPageSize: number;
  maxSearchResults: number;
  maxEmailBodySize: number;
}

// Email Types
export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailMessage {
  uid: string;
  messageId?: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress[];
  date: string;
  flags: string[];
  labels?: string[];
  hasAttachments: boolean;
  size?: number;
  preview?: string;
}

export interface EmailMessageFull extends EmailMessage {
  body?: string;
  htmlBody?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  inReplyTo?: string;
  references?: string[];
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  content?: Buffer;
}

export interface SendEmailOptions {
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body?: string;
  htmlBody?: string;
  attachments?: EmailAttachmentInput[];
  inReplyTo?: string;
  references?: string[];
}

export interface EmailAttachmentInput {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

// Folder Types
export interface Folder {
  name: string;
  path: string;
  delimiter: string;
  flags: string[];
  specialUse?: string;
  subscribed: boolean;
  totalMessages?: number;
  unseenMessages?: number;
}

// Label Types (ProtonMail uses folders as labels)
export interface Label {
  name: string;
  path: string;
  color?: string;
  emailCount?: number;
}

// Contact Types
export interface Contact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateContactOptions {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
}

export interface UpdateContactOptions {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

// Search Types
export interface SearchOptions {
  query?: string;
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  dateFrom?: string;
  dateTo?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  limit?: number;
  offset?: number;
}

// Analytics Types
export interface EmailTrendAnalysis {
  period: 'day' | 'week' | 'month';
  folder: string;
  dateRange: {
    start: string;
    end: string;
  };
  totalEmails: number;
  readRatio: number;
  hourlyDistribution: Record<number, number>;
  topSenders: SenderStats[];
  peakHours: number[];
  responsePatterns?: ResponsePattern[];
}

export interface SenderStats {
  address: string;
  name: string;
  count: number;
}

export interface ResponsePattern {
  hour: number;
  avgResponseTimeMinutes: number;
  responseCount: number;
}

export interface LabelDistribution {
  dateRange: {
    start: string;
    end: string;
  };
  totalEmails: number;
  byLabel: Record<string, number>;
  mostUsed: string[];
}

export interface ImportanceCriteria {
  frequentSenders?: string[];
  priorityKeywords?: string[];
  minScore?: number;
  limit?: number;
}

export interface ImportantEmail extends EmailMessage {
  importanceScore: number;
  reasons: string[];
}

// MCP Response Types
export interface ToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface MCPError {
  error: true;
  errorType: ErrorType;
  message: string;
  tool: string;
  details?: Record<string, unknown>;
  suggestions?: string[];
  timestamp: string;
}

// Error Types
export enum ErrorType {
  CONNECTION_ERROR = 'connection_error',
  CONNECTION_TIMEOUT = 'connection_timeout',
  AUTHENTICATION_ERROR = 'authentication_error',
  IMAP_ERROR = 'imap_error',
  SMTP_ERROR = 'smtp_error',
  VALIDATION_ERROR = 'validation_error',
  INVALID_PARAMETER = 'invalid_parameter',
  EMAIL_NOT_FOUND = 'email_not_found',
  FOLDER_NOT_FOUND = 'folder_not_found',
  CONTACT_NOT_FOUND = 'contact_not_found',
  OPERATION_FAILED = 'operation_failed',
  RATE_LIMIT_ERROR = 'rate_limit_error',
  UNKNOWN_ERROR = 'unknown_error'
}

// Resource Types
export interface InboxSummary {
  totalEmails: number;
  unreadCount: number;
  recentEmails: number;
  lastEmailDate?: string;
}

export interface FolderSummary {
  folders: Folder[];
  totalFolders: number;
}

export interface LabelSummary {
  labels: Label[];
  totalLabels: number;
}

export interface RecentActivity {
  emails: EmailMessage[];
  periodHours: number;
  receivedCount: number;
  sentCount: number;
}

export interface ContactSummary {
  totalContacts: number;
  recentlyAdded: Contact[];
}
