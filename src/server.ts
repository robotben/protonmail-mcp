#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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

  // Connect transport and start server
  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
    console.error(`[${SERVER_NAME}] Server started successfully`);
    console.error(`[${SERVER_NAME}] Connected to ProtonMail Bridge at ${config.protonmail.imap.host}`);
  } catch (error) {
    console.error(`[${SERVER_NAME}] Failed to start server:`, (error as Error).message);
    await shutdown();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
