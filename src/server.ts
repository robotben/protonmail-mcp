#!/usr/bin/env node
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config/config.js';
import { ImapConnectionPool } from './connection/imap-pool.js';
import { SMTPClient } from './connection/smtp-client.js';
import { createServices } from './services/index.js';
import { setupTools } from './tools/index.js';
import { setupResources } from './resources/index.js';

const SERVER_NAME = 'protonmail-mcp';
const SERVER_VERSION = '1.0.0';

async function main() {
  // Load configuration
  let config;
  try {
    config = loadConfig();
    console.error(`[${SERVER_NAME}] Configuration loaded successfully`);
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
  const services = createServices(imapPool, smtpClient, config);

  // Create MCP server
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

  // Setup handlers
  setupTools(server, services);
  setupResources(server, services);

  // Handle server errors
  server.onerror = (error) => {
    console.error(`[${SERVER_NAME}] Server error:`, error);
  };

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

  // Express app — matches obsidian-http-mcp architecture
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // REST endpoint for n8n digest workflow
  app.get('/emails', async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) ?? '50', 10);
      const since = req.query.since as string | undefined;
      const emails = await services.email.searchEmails({
        folder: 'INBOX',
        isUnread: true,
        dateFrom: since || new Date(Date.now() - 86400000).toISOString(),
        limit
      });
      res.json({ success: true, emails, count: emails.length });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  // MCP endpoint — Streamable HTTP, stateless, plain JSON responses
  app.post('/mcp', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        transport.close();
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
            message: error instanceof Error ? error.message : 'Internal error',
          },
          id: null,
        });
      }
    }
  });

  app.listen(PORT, () => {
    console.error(`[${SERVER_NAME}] Server started on http://localhost:${PORT}/mcp`);
    console.error(`[${SERVER_NAME}] Connected to ProtonMail Bridge at ${config.protonmail.imap.host}`);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
