#!/usr/bin/env node
import express from 'express';
import type { RequestHandler } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config/config.js';
import { ImapConnectionPool } from './connection/imap-pool.js';
import { SMTPClient } from './connection/smtp-client.js';
import { createServices } from './services/index.js';
import { setupTools } from './tools/index.js';
import { setupResources } from './resources/index.js';
import { loadServerSecurity, loadToolPolicy, hostGuard, bearerAuth } from './security.js';
import type { ServerSecurity, ToolPolicy } from './security.js';

const SERVER_NAME = 'protonmail-mcp';
const SERVER_VERSION = '1.0.0';

async function main() {
  // Load configuration
  let config;
  let security: ServerSecurity;
  let policy: ToolPolicy;
  try {
    config = loadConfig();
    console.error(`[${SERVER_NAME}] Configuration loaded successfully`);
    security = loadServerSecurity();
    policy = loadToolPolicy();
  } catch (error) {
    console.error(`[${SERVER_NAME}] Failed to load configuration:`, (error as Error).message);
    process.exit(1);
  }

  // Initialize IMAP connection pool
  const imapPool = new ImapConnectionPool(
    config.protonmail.imap,
    config.protonmail.auth,
    config.connection
  );

  // Initialize SMTP client
  const smtpClient = new SMTPClient(
    config.protonmail.smtp,
    config.protonmail.auth
  );

  // Create services
  const services = createServices(imapPool, smtpClient, config, policy);

  // The server is stateless, so each request gets its own MCP server instance.
  // A single shared instance can only be connected to one transport at a time.
  const createMcpServer = (): Server => {
    const server = new Server(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    );

    setupTools(server, services, policy);
    setupResources(server, services);

    server.onerror = (error) => {
      console.error(`[${SERVER_NAME}] Server error:`, error);
    };

    return server;
  };

  // Build one up front so a bad tool policy stops startup instead of the first request.
  try {
    createMcpServer();
  } catch (error) {
    console.error(`[${SERVER_NAME}] Invalid tool policy:`, (error as Error).message);
    process.exit(1);
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    console.error(`[${SERVER_NAME}] Shutting down...`);
    try {
      await imapPool.close();
      await smtpClient.close();
    } catch {
      // Ignore cleanup errors
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  const app = express();
  app.disable('x-powered-by');

  // Reject unexpected Host headers (blocks DNS rebinding against a loopback listener)
  if (security.allowedHosts) {
    app.use(hostGuard(security.allowedHosts));
  }

  // Authenticate before parsing bodies so unauthenticated callers cannot make
  // the server buffer request payloads.
  const requireAuth: RequestHandler = security.authToken
    ? bearerAuth(security.authToken)
    : (_req, _res, next) => next();
  const parseJson = express.json({ limit: '1mb' });

  // Health check (no mailbox access)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // REST endpoint for n8n digest workflow
  app.get('/emails', requireAuth, async (req, res) => {
    try {
      const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
      const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 500);

      let dateFrom = new Date(Date.now() - 86400000).toISOString();
      if (typeof req.query.since === 'string' && req.query.since) {
        const since = new Date(req.query.since);
        if (Number.isNaN(since.getTime())) {
          res.status(400).json({ success: false, error: '"since" must be a valid date' });
          return;
        }
        dateFrom = since.toISOString();
      }

      const emails = await services.email.searchEmails({
        folder: 'INBOX',
        isUnread: true,
        dateFrom,
        limit
      });
      res.json({ success: true, emails, count: emails.length });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // MCP endpoint — Streamable HTTP, stateless, plain JSON responses
  app.post('/mcp', requireAuth, parseJson, async (req, res) => {
    const server = createMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[${SERVER_NAME}] MCP request error:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error',
          },
          id: null,
        });
      }
    }
  });

  app.listen(PORT, security.host, () => {
    console.error(`[${SERVER_NAME}] Server started on http://${security.host}:${PORT}/mcp`);
    console.error(`[${SERVER_NAME}] Connected to ProtonMail Bridge at ${config.protonmail.imap.host}`);
    if (security.authToken) {
      console.error(`[${SERVER_NAME}] Bearer token authentication is enabled`);
    } else {
      console.error(
        `[${SERVER_NAME}] WARNING: MCP_AUTH_TOKEN is not set. Access is limited to this machine ` +
        'by the loopback binding and Host header check only.'
      );
    }
    if (policy.disabledTools.size > 0) {
      console.error(`[${SERVER_NAME}] Disabled tools: ${[...policy.disabledTools].join(', ')}`);
    }
    if (policy.allowedRecipients.length > 0) {
      console.error(`[${SERVER_NAME}] Outgoing mail restricted to ${policy.allowedRecipients.length} allowed recipient pattern(s)`);
    }
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
