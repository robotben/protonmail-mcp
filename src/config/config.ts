import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import type { ProtonMailConfig } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Zod schema for configuration validation
const TLSConfigSchema = z.object({
  rejectUnauthorized: z.boolean().default(false),
  minVersion: z.string().default('TLSv1.2')
});

const IMAPConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().default(1143),
  secure: z.boolean().default(false),
  tls: TLSConfigSchema.default({})
});

const SMTPConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().default(1025),
  secure: z.boolean().default(false),
  requireTLS: z.boolean().default(true),
  tls: TLSConfigSchema.default({})
});

const AuthConfigSchema = z.object({
  user: z.string().min(1, 'Email address is required'),
  pass: z.string().min(1, 'Bridge password is required')
});

const ServerConfigSchema = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio'),
  httpPort: z.number().default(3000),
  httpPath: z.string().default('/mcp')
});

const ConnectionConfigSchema = z.object({
  poolSize: z.number().min(1).max(10).default(3),
  idleTimeout: z.number().default(300000),
  connectionTimeout: z.number().default(30000),
  maxRetries: z.number().default(3),
  retryDelay: z.number().default(1000)
});

const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ttl: z.number().default(60),
  maxSize: z.number().default(1000)
});

const LimitsConfigSchema = z.object({
  defaultPageSize: z.number().default(50),
  maxPageSize: z.number().default(500),
  maxSearchResults: z.number().default(1000),
  maxEmailBodySize: z.number().default(1048576)
});

const ProtonMailConfigSchema = z.object({
  protonmail: z.object({
    imap: IMAPConfigSchema.default({}),
    smtp: SMTPConfigSchema.default({}),
    auth: AuthConfigSchema
  }),
  server: ServerConfigSchema.default({}),
  connection: ConnectionConfigSchema.default({}),
  cache: CacheConfigSchema.default({}),
  limits: LimitsConfigSchema.default({})
});

function findConfigFile(): string | null {
  const possiblePaths = [
    process.env.PROTONMAIL_CONFIG,
    join(process.cwd(), 'config', 'protonmail.config.json'),
    join(process.cwd(), 'protonmail.config.json'),
    join(__dirname, '..', '..', 'config', 'protonmail.config.json')
  ].filter(Boolean) as string[];

  for (const configPath of possiblePaths) {
    if (existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

export function loadConfig(): ProtonMailConfig {
  const configPath = findConfigFile();

  if (!configPath) {
    // Check for environment variables as fallback
    if (process.env.PROTONMAIL_USER && process.env.PROTONMAIL_PASS) {
      const envConfig = {
        protonmail: {
          imap: {
            host: process.env.PROTONMAIL_IMAP_HOST || '127.0.0.1',
            port: parseInt(process.env.PROTONMAIL_IMAP_PORT || '1143', 10),
            secure: process.env.PROTONMAIL_IMAP_SECURE === 'true',
            tls: {
              rejectUnauthorized: false,
              minVersion: 'TLSv1.2'
            }
          },
          smtp: {
            host: process.env.PROTONMAIL_SMTP_HOST || '127.0.0.1',
            port: parseInt(process.env.PROTONMAIL_SMTP_PORT || '1025', 10),
            secure: process.env.PROTONMAIL_SMTP_SECURE === 'true',
            requireTLS: true,
            tls: {
              rejectUnauthorized: false,
              minVersion: 'TLSv1.2'
            }
          },
          auth: {
            user: process.env.PROTONMAIL_USER,
            pass: process.env.PROTONMAIL_PASS
          }
        },
        server: {},
        connection: {},
        cache: {},
        limits: {}
      };

      const result = ProtonMailConfigSchema.safeParse(envConfig);
      if (!result.success) {
        throw new Error(`Invalid configuration from environment: ${result.error.message}`);
      }
      return result.data;
    }

    throw new Error(
      'Configuration file not found. Please create config/protonmail.config.json or set PROTONMAIL_USER and PROTONMAIL_PASS environment variables.'
    );
  }

  try {
    const configContent = readFileSync(configPath, 'utf-8');
    const rawConfig = JSON.parse(configContent);

    const result = ProtonMailConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      throw new Error(`Invalid configuration: ${result.error.message}`);
    }

    return result.data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${configPath}`);
    }
    throw error;
  }
}

export function validateConfig(config: unknown): ProtonMailConfig {
  const result = ProtonMailConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Configuration validation failed: ${result.error.message}`);
  }
  return result.data;
}
