import { ImapConnectionPool } from '../connection/imap-pool.js';
import type { Folder } from '../types.js';
import { ErrorType } from '../types.js';
import { NotFoundError, IMAPError } from '../utils/errors.js';

export class FolderService {
  private imapPool: ImapConnectionPool;

  constructor(imapPool: ImapConnectionPool) {
    this.imapPool = imapPool;
  }

  async listFolders(): Promise<Folder[]> {
    return this.imapPool.withConnection(async (client) => {
      const folders: Folder[] = [];
      const list = await client.list();

      for (const mailbox of list) {
        folders.push({
          name: mailbox.name,
          path: mailbox.path,
          delimiter: mailbox.delimiter,
          flags: mailbox.flags ? [...mailbox.flags] : [],
          specialUse: mailbox.specialUse,
          subscribed: mailbox.subscribed || false
        });
      }

      return folders;
    });
  }

  async getFolderStatus(folder: string): Promise<Folder & { totalMessages: number; unseenMessages: number }> {
    return this.imapPool.withConnection(async (client) => {
      try {
        const status = await client.status(folder, {
          messages: true,
          unseen: true
        });

        const list = await client.list();
        const mailbox = list.find(m => m.path === folder);

        if (!mailbox) {
          throw new NotFoundError('Folder', folder, ErrorType.FOLDER_NOT_FOUND);
        }

        return {
          name: mailbox.name,
          path: mailbox.path,
          delimiter: mailbox.delimiter,
          flags: mailbox.flags ? [...mailbox.flags] : [],
          specialUse: mailbox.specialUse,
          subscribed: mailbox.subscribed || false,
          totalMessages: status.messages || 0,
          unseenMessages: status.unseen || 0
        };
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        throw new IMAPError(`Failed to get folder status: ${(error as Error).message}`);
      }
    });
  }

  async createFolder(name: string, parentFolder?: string): Promise<Folder> {
    return this.imapPool.withConnection(async (client) => {
      const path = parentFolder ? `${parentFolder}/${name}` : name;

      try {
        await client.mailboxCreate(path);

        // Return the created folder info
        const list = await client.list();
        const mailbox = list.find(m => m.path === path);

        if (!mailbox) {
          // Folder was created but not found in list - return basic info
          return {
            name,
            path,
            delimiter: '/',
            flags: [],
            subscribed: true
          };
        }

        return {
          name: mailbox.name,
          path: mailbox.path,
          delimiter: mailbox.delimiter,
          flags: mailbox.flags ? [...mailbox.flags] : [],
          specialUse: mailbox.specialUse,
          subscribed: mailbox.subscribed || false
        };
      } catch (error) {
        throw new IMAPError(`Failed to create folder: ${(error as Error).message}`);
      }
    });
  }

  async deleteFolder(folderPath: string): Promise<void> {
    return this.imapPool.withConnection(async (client) => {
      try {
        await client.mailboxDelete(folderPath);
      } catch (error) {
        const err = error as Error;
        if (err.message.includes('NONEXISTENT')) {
          throw new NotFoundError('Folder', folderPath, ErrorType.FOLDER_NOT_FOUND);
        }
        throw new IMAPError(`Failed to delete folder: ${err.message}`);
      }
    });
  }

  async renameFolder(folderPath: string, newName: string): Promise<Folder> {
    return this.imapPool.withConnection(async (client) => {
      // Determine the new path
      const parts = folderPath.split('/');
      parts[parts.length - 1] = newName;
      const newPath = parts.join('/');

      try {
        await client.mailboxRename(folderPath, newPath);

        // Return the renamed folder info
        const list = await client.list();
        const mailbox = list.find(m => m.path === newPath);

        if (!mailbox) {
          return {
            name: newName,
            path: newPath,
            delimiter: '/',
            flags: [],
            subscribed: true
          };
        }

        return {
          name: mailbox.name,
          path: mailbox.path,
          delimiter: mailbox.delimiter,
          flags: mailbox.flags ? [...mailbox.flags] : [],
          specialUse: mailbox.specialUse,
          subscribed: mailbox.subscribed || false
        };
      } catch (error) {
        const err = error as Error;
        if (err.message.includes('NONEXISTENT')) {
          throw new NotFoundError('Folder', folderPath, ErrorType.FOLDER_NOT_FOUND);
        }
        throw new IMAPError(`Failed to rename folder: ${err.message}`);
      }
    });
  }

  async subscribeFolder(folderPath: string): Promise<void> {
    return this.imapPool.withConnection(async (client) => {
      try {
        await client.mailboxSubscribe(folderPath);
      } catch (error) {
        throw new IMAPError(`Failed to subscribe to folder: ${(error as Error).message}`);
      }
    });
  }

  async unsubscribeFolder(folderPath: string): Promise<void> {
    return this.imapPool.withConnection(async (client) => {
      try {
        await client.mailboxUnsubscribe(folderPath);
      } catch (error) {
        throw new IMAPError(`Failed to unsubscribe from folder: ${(error as Error).message}`);
      }
    });
  }
}
