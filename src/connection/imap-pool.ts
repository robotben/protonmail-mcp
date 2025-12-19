import { ImapFlow, MailboxLockObject } from 'imapflow';
import type { IMAPConfig, AuthConfig, ConnectionConfig } from '../types.js';
import { ConnectionError, AuthenticationError } from '../utils/errors.js';

interface PooledConnection {
  client: ImapFlow;
  inUse: boolean;
  lastUsed: number;
  id: number;
}

export class ImapConnectionPool {
  private pool: PooledConnection[] = [];
  private waiting: Array<(conn: ImapFlow) => void> = [];
  private config: IMAPConfig;
  private authConfig: AuthConfig;
  private connectionConfig: ConnectionConfig;
  private nextId = 1;
  private closed = false;

  constructor(
    config: IMAPConfig,
    auth: AuthConfig,
    connectionConfig: ConnectionConfig
  ) {
    this.config = config;
    this.authConfig = auth;
    this.connectionConfig = connectionConfig;
  }

  async acquire(): Promise<ImapFlow> {
    if (this.closed) {
      throw new ConnectionError('Connection pool is closed');
    }

    // Find available connection
    const available = this.pool.find(conn => !conn.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available.client;
    }

    // Create new connection if pool not full
    if (this.pool.length < this.connectionConfig.poolSize) {
      const conn = await this.createConnection();
      this.pool.push({
        client: conn,
        inUse: true,
        lastUsed: Date.now(),
        id: this.nextId++
      });
      return conn;
    }

    // Wait for available connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiting.indexOf(resolve);
        if (index !== -1) {
          this.waiting.splice(index, 1);
        }
        reject(new ConnectionError('Connection pool timeout'));
      }, this.connectionConfig.connectionTimeout);

      this.waiting.push((conn: ImapFlow) => {
        clearTimeout(timeout);
        resolve(conn);
      });
    });
  }

  release(connection: ImapFlow): void {
    const pooled = this.pool.find(p => p.client === connection);
    if (!pooled) return;

    pooled.inUse = false;
    pooled.lastUsed = Date.now();

    // If someone is waiting, give them the connection
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      pooled.inUse = true;
      resolve(connection);
      return;
    }

    // Schedule idle cleanup
    setTimeout(() => {
      this.cleanupIdleConnections();
    }, this.connectionConfig.idleTimeout);
  }

  async withConnection<T>(operation: (conn: ImapFlow) => Promise<T>): Promise<T> {
    const connection = await this.acquire();
    try {
      return await operation(connection);
    } finally {
      this.release(connection);
    }
  }

  async withMailbox<T>(
    folder: string,
    operation: (conn: ImapFlow, lock: MailboxLockObject) => Promise<T>,
    readOnly = true
  ): Promise<T> {
    return this.withConnection(async (conn) => {
      const lock = await conn.getMailboxLock(folder, { readOnly });
      try {
        return await operation(conn, lock);
      } finally {
        lock.release();
      }
    });
  }

  private async createConnection(): Promise<ImapFlow> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.authConfig.user,
        pass: this.authConfig.pass
      },
      tls: {
        rejectUnauthorized: this.config.tls.rejectUnauthorized,
        minVersion: this.config.tls.minVersion as 'TLSv1.2' | 'TLSv1.3'
      },
      logger: false
    });

    // Handle connection events
    client.on('error', (err: Error) => {
      console.error('IMAP connection error:', err.message);
      this.removeConnection(client);
    });

    client.on('close', () => {
      this.removeConnection(client);
    });

    try {
      await client.connect();
      return client;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('ECONNREFUSED')) {
        throw new ConnectionError(
          'Cannot connect to ProtonMail Bridge. Is it running?',
          { host: this.config.host, port: this.config.port }
        );
      }
      if (err.message.toLowerCase().includes('auth') ||
          err.message.toLowerCase().includes('login')) {
        throw new AuthenticationError(
          'IMAP authentication failed. Check your Bridge credentials.'
        );
      }
      throw new ConnectionError(`IMAP connection failed: ${err.message}`);
    }
  }

  private removeConnection(client: ImapFlow): void {
    const index = this.pool.findIndex(p => p.client === client);
    if (index !== -1) {
      this.pool.splice(index, 1);
    }
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();
    const idleThreshold = this.connectionConfig.idleTimeout;

    // Keep at least one connection
    if (this.pool.length <= 1) return;

    for (let i = this.pool.length - 1; i >= 0; i--) {
      const conn = this.pool[i];
      if (!conn.inUse && now - conn.lastUsed > idleThreshold) {
        conn.client.logout().catch(() => {});
        this.pool.splice(i, 1);
        // Keep at least one connection
        if (this.pool.length <= 1) break;
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;

    // Reject all waiting requests
    for (const resolve of this.waiting) {
      // These will be rejected by the timeout
    }
    this.waiting = [];

    // Close all connections
    const closePromises = this.pool.map(async (conn) => {
      try {
        await conn.client.logout();
      } catch {
        // Ignore logout errors
      }
    });

    await Promise.all(closePromises);
    this.pool = [];
  }

  get stats() {
    return {
      total: this.pool.length,
      inUse: this.pool.filter(p => p.inUse).length,
      available: this.pool.filter(p => !p.inUse).length,
      waiting: this.waiting.length
    };
  }
}
