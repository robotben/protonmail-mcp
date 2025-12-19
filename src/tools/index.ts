import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import type { ToolResponse } from '../types.js';
import { createSuccessResponse, errorToResponse } from '../utils/errors.js';

// Tool input schemas
const ListEmailsSchema = z.object({
  folder: z.string().default('INBOX'),
  limit: z.number().min(1).max(500).default(50),
  offset: z.number().min(0).default(0),
  sort_order: z.enum(['asc', 'desc']).default('desc')
});

const GetEmailSchema = z.object({
  folder: z.string().default('INBOX'),
  uid: z.string(),
  include_attachments: z.boolean().default(false)
});

const GetEmailHeadersSchema = z.object({
  folder: z.string().default('INBOX'),
  uid: z.string()
});

const SearchEmailsSchema = z.object({
  query: z.string().optional(),
  folder: z.string().default('INBOX'),
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  has_attachment: z.boolean().optional(),
  is_unread: z.boolean().optional(),
  limit: z.number().min(1).max(1000).default(50),
  offset: z.number().min(0).default(0)
});

const GetUnreadCountSchema = z.object({
  folders: z.array(z.string()).default(['INBOX'])
});

const MarkAsReadSchema = z.object({
  folder: z.string().default('INBOX'),
  uids: z.array(z.string())
});

const MarkAsUnreadSchema = z.object({
  folder: z.string().default('INBOX'),
  uids: z.array(z.string())
});

const SendEmailSchema = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string(),
  body: z.string().optional(),
  html_body: z.string().optional()
});

const ReplyToEmailSchema = z.object({
  folder: z.string().default('INBOX'),
  uid: z.string(),
  body: z.string(),
  html_body: z.string().optional(),
  reply_all: z.boolean().default(false)
});

const ForwardEmailSchema = z.object({
  folder: z.string().default('INBOX'),
  uid: z.string(),
  to: z.array(z.string()),
  body: z.string().optional()
});

const ListFoldersSchema = z.object({});

const CreateFolderSchema = z.object({
  name: z.string(),
  parent_folder: z.string().optional()
});

const DeleteFolderSchema = z.object({
  folder_path: z.string()
});

const RenameFolderSchema = z.object({
  folder_path: z.string(),
  new_name: z.string()
});

const MoveEmailsSchema = z.object({
  source_folder: z.string(),
  target_folder: z.string(),
  uids: z.array(z.string())
});

const ListLabelsSchema = z.object({});

const CreateLabelSchema = z.object({
  name: z.string(),
  color: z.string().optional()
});

const ApplyLabelsSchema = z.object({
  source_folder: z.string().default('INBOX'),
  uids: z.array(z.string()),
  labels: z.array(z.string())
});

const RemoveLabelsSchema = z.object({
  folder: z.string().default('INBOX'),
  uids: z.array(z.string()),
  labels: z.array(z.string())
});

const AnalyzeEmailTrendsSchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
  folder: z.string().default('INBOX')
});

const AnalyzeLabelDistributionSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional()
});

const IdentifyImportantEmailsSchema = z.object({
  frequent_senders: z.array(z.string()).optional(),
  priority_keywords: z.array(z.string()).optional(),
  min_score: z.number().default(10),
  limit: z.number().default(20),
  folder: z.string().default('INBOX')
});

const DeleteEmailsSchema = z.object({
  folder: z.string().default('INBOX'),
  uids: z.array(z.string())
});

// Tool definitions
const tools: Tool[] = [
  // Email Reading Tools
  {
    name: 'list_emails',
    description: 'List emails from a folder with pagination. Returns email metadata including subject, sender, date, and read status.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder to list emails from', default: 'INBOX' },
        limit: { type: 'number', description: 'Maximum emails to return (1-500)', default: 50 },
        offset: { type: 'number', description: 'Number of emails to skip', default: 0 },
        sort_order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order by date', default: 'desc' }
      }
    }
  },
  {
    name: 'get_email',
    description: 'Get a specific email by UID with full content including body and optionally attachments.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the email', default: 'INBOX' },
        uid: { type: 'string', description: 'Email UID' },
        include_attachments: { type: 'boolean', description: 'Include attachment content', default: false }
      },
      required: ['uid']
    }
  },
  {
    name: 'get_email_headers',
    description: 'Get email headers only (lightweight, no body content).',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the email', default: 'INBOX' },
        uid: { type: 'string', description: 'Email UID' }
      },
      required: ['uid']
    }
  },
  {
    name: 'search_emails',
    description: 'Search emails with various criteria including query text, sender, recipient, date range.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (searches subject, body, from, to)' },
        folder: { type: 'string', description: 'Folder to search in', default: 'INBOX' },
        from: { type: 'string', description: 'Filter by sender' },
        to: { type: 'string', description: 'Filter by recipient' },
        subject: { type: 'string', description: 'Filter by subject' },
        date_from: { type: 'string', description: 'Start date (ISO format)' },
        date_to: { type: 'string', description: 'End date (ISO format)' },
        has_attachment: { type: 'boolean', description: 'Filter by attachment presence' },
        is_unread: { type: 'boolean', description: 'Filter by read status' },
        limit: { type: 'number', description: 'Maximum results', default: 50 },
        offset: { type: 'number', description: 'Number of results to skip', default: 0 }
      }
    }
  },
  {
    name: 'get_unread_count',
    description: 'Get unread email count for one or more folders.',
    inputSchema: {
      type: 'object',
      properties: {
        folders: { type: 'array', items: { type: 'string' }, description: 'Folders to check', default: ['INBOX'] }
      }
    }
  },
  {
    name: 'mark_as_read',
    description: 'Mark one or more emails as read.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the emails', default: 'INBOX' },
        uids: { type: 'array', items: { type: 'string' }, description: 'Email UIDs to mark as read' }
      },
      required: ['uids']
    }
  },
  {
    name: 'mark_as_unread',
    description: 'Mark one or more emails as unread.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the emails', default: 'INBOX' },
        uids: { type: 'array', items: { type: 'string' }, description: 'Email UIDs to mark as unread' }
      },
      required: ['uids']
    }
  },

  // Email Sending Tools
  {
    name: 'send_email',
    description: 'Compose and send a new email.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
        cc: { type: 'array', items: { type: 'string' }, description: 'CC recipients' },
        bcc: { type: 'array', items: { type: 'string' }, description: 'BCC recipients' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain text body' },
        html_body: { type: 'string', description: 'HTML body' }
      },
      required: ['to', 'subject']
    }
  },
  {
    name: 'reply_to_email',
    description: 'Reply to an existing email.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the email', default: 'INBOX' },
        uid: { type: 'string', description: 'Email UID to reply to' },
        body: { type: 'string', description: 'Reply body' },
        html_body: { type: 'string', description: 'HTML reply body' },
        reply_all: { type: 'boolean', description: 'Reply to all recipients', default: false }
      },
      required: ['uid', 'body']
    }
  },
  {
    name: 'forward_email',
    description: 'Forward an email to other recipients.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the email', default: 'INBOX' },
        uid: { type: 'string', description: 'Email UID to forward' },
        to: { type: 'array', items: { type: 'string' }, description: 'Recipients to forward to' },
        body: { type: 'string', description: 'Additional message to include' }
      },
      required: ['uid', 'to']
    }
  },

  // Folder Management Tools
  {
    name: 'list_folders',
    description: 'List all email folders/mailboxes.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'create_folder',
    description: 'Create a new folder.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parent_folder: { type: 'string', description: 'Parent folder path (optional)' }
      },
      required: ['name']
    }
  },
  {
    name: 'delete_folder',
    description: 'Delete a folder.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_path: { type: 'string', description: 'Folder path to delete' }
      },
      required: ['folder_path']
    }
  },
  {
    name: 'rename_folder',
    description: 'Rename a folder.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_path: { type: 'string', description: 'Current folder path' },
        new_name: { type: 'string', description: 'New folder name' }
      },
      required: ['folder_path', 'new_name']
    }
  },
  {
    name: 'move_emails',
    description: 'Move emails between folders.',
    inputSchema: {
      type: 'object',
      properties: {
        source_folder: { type: 'string', description: 'Source folder' },
        target_folder: { type: 'string', description: 'Target folder' },
        uids: { type: 'array', items: { type: 'string' }, description: 'Email UIDs to move' }
      },
      required: ['source_folder', 'target_folder', 'uids']
    }
  },

  // Label Management Tools
  {
    name: 'list_labels',
    description: 'List all labels (ProtonMail implements labels as folders).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'create_label',
    description: 'Create a new label.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Label name' },
        color: { type: 'string', description: 'Label color (optional)' }
      },
      required: ['name']
    }
  },
  {
    name: 'apply_labels',
    description: 'Apply labels to emails (copies emails to label folders).',
    inputSchema: {
      type: 'object',
      properties: {
        source_folder: { type: 'string', description: 'Source folder', default: 'INBOX' },
        uids: { type: 'array', items: { type: 'string' }, description: 'Email UIDs' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label paths to apply' }
      },
      required: ['uids', 'labels']
    }
  },
  {
    name: 'remove_labels',
    description: 'Remove labels from emails.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Current folder', default: 'INBOX' },
        uids: { type: 'array', items: { type: 'string' }, description: 'Email UIDs' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label paths to remove' }
      },
      required: ['uids', 'labels']
    }
  },

  // Analytics Tools
  {
    name: 'analyze_email_trends',
    description: 'Analyze email patterns and trends over a time period.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month'], description: 'Analysis period', default: 'week' },
        folder: { type: 'string', description: 'Folder to analyze', default: 'INBOX' }
      }
    }
  },
  {
    name: 'analyze_label_distribution',
    description: 'Analyze email distribution across labels/folders.',
    inputSchema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'Start date (ISO format)' },
        date_to: { type: 'string', description: 'End date (ISO format)' }
      }
    }
  },
  {
    name: 'identify_important_emails',
    description: 'Identify important emails based on various criteria and scoring.',
    inputSchema: {
      type: 'object',
      properties: {
        frequent_senders: { type: 'array', items: { type: 'string' }, description: 'Email addresses of important senders' },
        priority_keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords that indicate importance' },
        min_score: { type: 'number', description: 'Minimum importance score', default: 10 },
        limit: { type: 'number', description: 'Maximum results', default: 20 },
        folder: { type: 'string', description: 'Folder to analyze', default: 'INBOX' }
      }
    }
  },

  // Utility Tools
  {
    name: 'delete_emails',
    description: 'Permanently delete emails.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the emails', default: 'INBOX' },
        uids: { type: 'array', items: { type: 'string' }, description: 'Email UIDs to delete' }
      },
      required: ['uids']
    }
  }
];

export function setupTools(server: Server, services: Services): void {
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args || {}, services);
      return {
        content: result.content,
        isError: result.isError
      };
    } catch (error) {
      const errorResult = errorToResponse(name, error);
      return {
        content: errorResult.content,
        isError: errorResult.isError
      };
    }
  });
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  services: Services
): Promise<ToolResponse> {
  switch (name) {
    // Email Reading Tools
    case 'list_emails': {
      const input = ListEmailsSchema.parse(args);
      const emails = await services.email.listEmails(
        input.folder,
        input.limit,
        input.offset,
        input.sort_order
      );
      return createSuccessResponse({
        folder: input.folder,
        count: emails.length,
        offset: input.offset,
        has_more: emails.length === input.limit,
        emails
      });
    }

    case 'get_email': {
      const input = GetEmailSchema.parse(args);
      const email = await services.email.getEmail(
        input.folder,
        input.uid,
        input.include_attachments
      );
      return createSuccessResponse(email);
    }

    case 'get_email_headers': {
      const input = GetEmailHeadersSchema.parse(args);
      const email = await services.email.getEmailHeaders(input.folder, input.uid);
      return createSuccessResponse(email);
    }

    case 'search_emails': {
      const input = SearchEmailsSchema.parse(args);
      const emails = await services.email.searchEmails({
        query: input.query,
        folder: input.folder,
        from: input.from,
        to: input.to,
        subject: input.subject,
        dateFrom: input.date_from,
        dateTo: input.date_to,
        hasAttachment: input.has_attachment,
        isUnread: input.is_unread,
        limit: input.limit,
        offset: input.offset
      });
      return createSuccessResponse({
        query: input.query,
        folder: input.folder,
        count: emails.length,
        emails
      });
    }

    case 'get_unread_count': {
      const input = GetUnreadCountSchema.parse(args);
      const counts = await services.email.getUnreadCount(input.folders);
      return createSuccessResponse(counts);
    }

    case 'mark_as_read': {
      const input = MarkAsReadSchema.parse(args);
      await services.email.markAsRead(input.folder, input.uids);
      return createSuccessResponse({ marked: input.uids.length });
    }

    case 'mark_as_unread': {
      const input = MarkAsUnreadSchema.parse(args);
      await services.email.markAsUnread(input.folder, input.uids);
      return createSuccessResponse({ marked: input.uids.length });
    }

    // Email Sending Tools
    case 'send_email': {
      const input = SendEmailSchema.parse(args);
      const result = await services.email.sendEmail({
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        body: input.body,
        htmlBody: input.html_body
      });
      return createSuccessResponse(result);
    }

    case 'reply_to_email': {
      const input = ReplyToEmailSchema.parse(args);
      const result = await services.email.replyToEmail(
        input.folder,
        input.uid,
        input.body,
        input.html_body,
        input.reply_all
      );
      return createSuccessResponse(result);
    }

    case 'forward_email': {
      const input = ForwardEmailSchema.parse(args);
      const result = await services.email.forwardEmail(
        input.folder,
        input.uid,
        input.to,
        input.body
      );
      return createSuccessResponse(result);
    }

    // Folder Management Tools
    case 'list_folders': {
      ListFoldersSchema.parse(args);
      const folders = await services.folder.listFolders();
      return createSuccessResponse({ count: folders.length, folders });
    }

    case 'create_folder': {
      const input = CreateFolderSchema.parse(args);
      const folder = await services.folder.createFolder(input.name, input.parent_folder);
      return createSuccessResponse(folder);
    }

    case 'delete_folder': {
      const input = DeleteFolderSchema.parse(args);
      await services.folder.deleteFolder(input.folder_path);
      return createSuccessResponse({ deleted: input.folder_path });
    }

    case 'rename_folder': {
      const input = RenameFolderSchema.parse(args);
      const folder = await services.folder.renameFolder(input.folder_path, input.new_name);
      return createSuccessResponse(folder);
    }

    case 'move_emails': {
      const input = MoveEmailsSchema.parse(args);
      await services.email.moveEmails(input.source_folder, input.target_folder, input.uids);
      return createSuccessResponse({
        moved: input.uids.length,
        from: input.source_folder,
        to: input.target_folder
      });
    }

    // Label Management Tools
    case 'list_labels': {
      ListLabelsSchema.parse(args);
      const labels = await services.label.listLabels();
      return createSuccessResponse({ count: labels.length, labels });
    }

    case 'create_label': {
      const input = CreateLabelSchema.parse(args);
      const label = await services.label.createLabel(input.name, input.color);
      return createSuccessResponse(label);
    }

    case 'apply_labels': {
      const input = ApplyLabelsSchema.parse(args);
      await services.label.applyLabels(input.source_folder, input.uids, input.labels);
      return createSuccessResponse({
        applied: input.labels,
        to_emails: input.uids.length
      });
    }

    case 'remove_labels': {
      const input = RemoveLabelsSchema.parse(args);
      await services.label.removeLabels(input.folder, input.uids, input.labels);
      return createSuccessResponse({
        removed: input.labels,
        from_emails: input.uids.length
      });
    }

    // Analytics Tools
    case 'analyze_email_trends': {
      const input = AnalyzeEmailTrendsSchema.parse(args);
      const analysis = await services.trend.analyzeEmailTrends(input.period, input.folder);
      return createSuccessResponse(analysis);
    }

    case 'analyze_label_distribution': {
      const input = AnalyzeLabelDistributionSchema.parse(args);
      const distribution = await services.trend.analyzeLabelDistribution(
        input.date_from,
        input.date_to
      );
      return createSuccessResponse(distribution);
    }

    case 'identify_important_emails': {
      const input = IdentifyImportantEmailsSchema.parse(args);
      const emails = await services.trend.identifyImportantEmails(
        {
          frequentSenders: input.frequent_senders,
          priorityKeywords: input.priority_keywords,
          minScore: input.min_score,
          limit: input.limit
        },
        input.folder
      );
      return createSuccessResponse({
        count: emails.length,
        emails
      });
    }

    // Utility Tools
    case 'delete_emails': {
      const input = DeleteEmailsSchema.parse(args);
      await services.email.deleteEmails(input.folder, input.uids);
      return createSuccessResponse({ deleted: input.uids.length });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
