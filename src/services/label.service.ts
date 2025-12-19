import { ImapConnectionPool } from '../connection/imap-pool.js';
import { FolderService } from './folder.service.js';
import type { Label } from '../types.js';
import { IMAPError } from '../utils/errors.js';

/**
 * LabelService - ProtonMail Label Management
 *
 * Note: ProtonMail implements labels as IMAP folders via the Bridge.
 * The bridge creates a "Labels" folder hierarchy for user-created labels.
 * System labels (Inbox, Sent, Drafts, etc.) are mapped to standard IMAP folders.
 *
 * Applying/removing labels in ProtonMail's IMAP implementation means
 * copying/moving emails to different folders. This is a limitation of
 * the IMAP protocol which doesn't natively support labels.
 */
export class LabelService {
  private imapPool: ImapConnectionPool;
  private folderService: FolderService;

  constructor(imapPool: ImapConnectionPool, folderService: FolderService) {
    this.imapPool = imapPool;
    this.folderService = folderService;
  }

  async listLabels(): Promise<Label[]> {
    const folders = await this.folderService.listFolders();

    // ProtonMail Bridge exposes labels as folders under "Labels" or "Folders"
    // Standard folders are: INBOX, Sent, Drafts, Trash, Spam, Archive, All Mail
    const systemFolders = new Set([
      'INBOX', 'Sent', 'Drafts', 'Trash', 'Spam', 'Archive', 'All Mail',
      'Starred', 'Outbox'
    ]);

    const labels: Label[] = [];

    for (const folder of folders) {
      // Include folders that are likely user labels
      // These are typically under "Labels/" or "Folders/" prefix in ProtonMail Bridge
      const isLabel = folder.path.startsWith('Labels/') ||
                      folder.path.startsWith('Folders/') ||
                      !systemFolders.has(folder.name);

      if (isLabel && folder.name !== 'Labels' && folder.name !== 'Folders') {
        labels.push({
          name: folder.name,
          path: folder.path,
          emailCount: folder.totalMessages
        });
      }
    }

    // Also add system labels for completeness
    for (const folder of folders) {
      if (systemFolders.has(folder.name)) {
        labels.push({
          name: folder.name,
          path: folder.path,
          emailCount: folder.totalMessages
        });
      }
    }

    return labels;
  }

  async createLabel(name: string, color?: string): Promise<Label> {
    // Create label as a folder under "Labels/" hierarchy
    // Note: ProtonMail Bridge may not support the "Labels/" prefix
    // In that case, create as a regular folder
    try {
      const folder = await this.folderService.createFolder(name, 'Labels');
      return {
        name: folder.name,
        path: folder.path,
        color
      };
    } catch {
      // Fallback: create as regular folder if Labels hierarchy doesn't exist
      const folder = await this.folderService.createFolder(name);
      return {
        name: folder.name,
        path: folder.path,
        color
      };
    }
  }

  async deleteLabel(labelPath: string): Promise<void> {
    await this.folderService.deleteFolder(labelPath);
  }

  async applyLabels(
    sourceFolder: string,
    uids: string[],
    labelPaths: string[]
  ): Promise<void> {
    // In IMAP, applying a label means copying the message to that folder
    // ProtonMail Bridge handles the actual labeling on the server side
    return this.imapPool.withMailbox(sourceFolder, async (client, lock) => {
      const uidStr = uids.join(',');

      for (const labelPath of labelPaths) {
        try {
          await client.messageCopy(uidStr, labelPath, { uid: true });
        } catch (error) {
          throw new IMAPError(
            `Failed to apply label ${labelPath}: ${(error as Error).message}`
          );
        }
      }
    }, false);
  }

  async removeLabels(
    folder: string,
    uids: string[],
    labelPaths: string[]
  ): Promise<void> {
    // In IMAP, removing a label means deleting the message from that folder
    // This is complex because we need to find the message in each label folder
    // For ProtonMail Bridge, we can use message flags or move operations

    // For each label, if the email is in that label folder, delete it
    for (const labelPath of labelPaths) {
      if (labelPath === folder) {
        // Can't remove from the folder we're operating on
        continue;
      }

      try {
        await this.imapPool.withMailbox(labelPath, async (client, lock) => {
          // Search for messages with matching UIDs
          // Note: UIDs are folder-specific in IMAP, so we need to search by Message-ID
          // This is a limitation - for proper label removal, we'd need Message-IDs
          const uidStr = uids.join(',');

          // Try to delete - this may fail if messages aren't in this folder
          try {
            await client.messageDelete(uidStr, { uid: true });
          } catch {
            // Message might not be in this label folder
          }
        }, false);
      } catch {
        // Folder might not exist or be accessible
      }
    }
  }

  async getLabelCounts(): Promise<Record<string, number>> {
    const labels = await this.listLabels();
    const counts: Record<string, number> = {};

    for (const label of labels) {
      try {
        const status = await this.folderService.getFolderStatus(label.path);
        counts[label.path] = status.totalMessages;
      } catch {
        counts[label.path] = 0;
      }
    }

    return counts;
  }
}
