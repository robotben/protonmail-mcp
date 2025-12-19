import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Resource
} from '@modelcontextprotocol/sdk/types.js';
import type { Services } from '../services/index.js';

const resources: Resource[] = [
  {
    uri: 'protonmail://inbox/summary',
    name: 'Inbox Summary',
    description: 'Summary of inbox including unread count and recent activity',
    mimeType: 'application/json'
  },
  {
    uri: 'protonmail://folders',
    name: 'Folder List',
    description: 'List of all email folders with message counts',
    mimeType: 'application/json'
  },
  {
    uri: 'protonmail://labels',
    name: 'Label Summary',
    description: 'Summary of all labels with email counts',
    mimeType: 'application/json'
  },
  {
    uri: 'protonmail://recent',
    name: 'Recent Activity',
    description: 'Recent email activity in the last 24 hours',
    mimeType: 'application/json'
  },
  {
    uri: 'protonmail://stats',
    name: 'Email Statistics',
    description: 'Overall email statistics and trends',
    mimeType: 'application/json'
  }
];

export function setupResources(server: Server, services: Services): void {
  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources };
  });

  // Read resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      const content = await getResourceContent(uri, services);
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(content, null, 2)
        }]
      };
    } catch (error) {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: true,
            message: (error as Error).message
          }, null, 2)
        }]
      };
    }
  });
}

async function getResourceContent(
  uri: string,
  services: Services
): Promise<unknown> {
  switch (uri) {
    case 'protonmail://inbox/summary': {
      const unreadCounts = await services.email.getUnreadCount(['INBOX']);
      const recentEmails = await services.email.listEmails('INBOX', 10, 0, 'desc');

      return {
        folder: 'INBOX',
        unreadCount: unreadCounts['INBOX'] || 0,
        recentEmails: recentEmails.length,
        lastEmailDate: recentEmails[0]?.date || null,
        preview: recentEmails.slice(0, 5).map(e => ({
          subject: e.subject,
          from: e.from.address,
          date: e.date,
          isRead: e.flags.includes('\\Seen')
        })),
        timestamp: new Date().toISOString()
      };
    }

    case 'protonmail://folders': {
      const folders = await services.folder.listFolders();
      const folderStats = await Promise.all(
        folders.slice(0, 20).map(async (folder) => {
          try {
            const status = await services.folder.getFolderStatus(folder.path);
            return {
              name: folder.name,
              path: folder.path,
              specialUse: folder.specialUse,
              totalMessages: status.totalMessages,
              unreadMessages: status.unseenMessages
            };
          } catch {
            return {
              name: folder.name,
              path: folder.path,
              specialUse: folder.specialUse,
              totalMessages: 0,
              unreadMessages: 0
            };
          }
        })
      );

      return {
        totalFolders: folders.length,
        folders: folderStats,
        timestamp: new Date().toISOString()
      };
    }

    case 'protonmail://labels': {
      const labels = await services.label.listLabels();
      const counts = await services.label.getLabelCounts();

      return {
        totalLabels: labels.length,
        labels: labels.map(l => ({
          name: l.name,
          path: l.path,
          emailCount: counts[l.path] || 0
        })),
        timestamp: new Date().toISOString()
      };
    }

    case 'protonmail://recent': {
      const activity = await services.trend.getEmailActivity('INBOX', 24);
      const recentEmails = await services.email.listEmails('INBOX', 20, 0, 'desc');

      return {
        periodHours: 24,
        received: activity.received,
        read: activity.read,
        unread: activity.unread,
        hourlyBreakdown: activity.hourlyBreakdown,
        recentEmails: recentEmails.map(e => ({
          uid: e.uid,
          subject: e.subject,
          from: e.from,
          date: e.date,
          isRead: e.flags.includes('\\Seen'),
          hasAttachments: e.hasAttachments
        })),
        timestamp: new Date().toISOString()
      };
    }

    case 'protonmail://stats': {
      const [inboxTrends, senderAnalytics, labelDist] = await Promise.all([
        services.trend.analyzeEmailTrends('week', 'INBOX'),
        services.trend.getSenderAnalytics('INBOX', 10),
        services.trend.analyzeLabelDistribution()
      ]);

      return {
        weeklyTrends: {
          totalEmails: inboxTrends.totalEmails,
          readRatio: inboxTrends.readRatio,
          peakHours: inboxTrends.peakHours,
          topSenders: inboxTrends.topSenders.slice(0, 5)
        },
        senderStats: {
          uniqueSenders: senderAnalytics.totalUniqueSenders,
          topSenders: senderAnalytics.topSenders,
          avgEmailsPerSender: senderAnalytics.avgEmailsPerSender
        },
        folderDistribution: labelDist.byLabel,
        timestamp: new Date().toISOString()
      };
    }

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}
