import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

type Env = NodeJS.ProcessEnv;

const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '::1'];

// Tools that change mailbox state or send mail. Disabled together by MCP_READ_ONLY=true.
export const MUTATING_TOOLS = [
  'mark_as_read',
  'mark_as_unread',
  'send_email',
  'reply_to_email',
  'forward_email',
  'create_folder',
  'delete_folder',
  'rename_folder',
  'move_emails',
  'create_label',
  'apply_labels',
  'remove_labels',
  'delete_emails'
];

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    h.startsWith('::ffff:127.')
  );
}

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// "example.com:443" -> "example.com", "[::1]:3000" -> "::1"
function hostnameFromHostHeader(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    return end === -1 ? v : v.slice(1, end);
  }
  if ((v.match(/:/g) ?? []).length > 1) return v; // bare IPv6, no port
  const colon = v.lastIndexOf(':');
  return colon === -1 ? v : v.slice(0, colon);
}

// ---------------------------------------------------------------------------
// HTTP server hardening
// ---------------------------------------------------------------------------

export interface ServerSecurity {
  host: string;
  authToken?: string;
  /** Accepted Host header names. Undefined means Host validation is off. */
  allowedHosts?: Set<string>;
}

export function loadServerSecurity(env: Env = process.env): ServerSecurity {
  const host = env.MCP_HOST?.trim() || '127.0.0.1';
  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
  const loopback = isLoopbackHost(host);

  if (authToken && authToken.length < 16) {
    throw new Error('MCP_AUTH_TOKEN must be at least 16 characters');
  }

  if (!loopback && !authToken) {
    throw new Error(
      `Refusing to listen on non-loopback address "${host}" without MCP_AUTH_TOKEN. ` +
      'Set MCP_AUTH_TOKEN (16+ characters), or bind to 127.0.0.1.'
    );
  }

  // Host validation blocks DNS-rebinding against a loopback listener. For a
  // non-loopback listener the bearer token is the protection, so Host
  // validation only turns on when MCP_ALLOWED_HOSTS is set.
  const extraHosts = parseList(env.MCP_ALLOWED_HOSTS).map(hostnameFromHostHeader);
  let allowedHosts: Set<string> | undefined;
  if (loopback || extraHosts.length > 0) {
    allowedHosts = new Set([...LOOPBACK_HOSTNAMES, ...extraHosts]);
  }

  return { host, authToken, allowedHosts };
}

export function hostGuard(allowedHosts: Set<string>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.host;
    if (!header || !allowedHosts.has(hostnameFromHostHeader(header))) {
      res.status(403).json({ error: 'Forbidden: Host header not allowed (see MCP_ALLOWED_HOSTS)' });
      return;
    }
    next();
  };
}

export function bearerAuth(token: string): RequestHandler {
  // Compare fixed-length digests so the comparison is constant-time
  // regardless of the length of what the caller sends.
  const expected = createHash('sha256').update(token).digest();

  return (req: Request, res: Response, next: NextFunction) => {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    const presented = createHash('sha256').update(match?.[1]?.trim() ?? '').digest();

    if (!match || !timingSafeEqual(presented, expected)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Tool policy
// ---------------------------------------------------------------------------

export interface ToolPolicy {
  disabledTools: Set<string>;
  /** Lower-cased full addresses or "@domain" entries. Empty means no restriction. */
  allowedRecipients: string[];
}

export function loadToolPolicy(env: Env = process.env): ToolPolicy {
  const disabledTools = new Set(parseList(env.MCP_DISABLED_TOOLS));

  if (env.MCP_READ_ONLY?.trim().toLowerCase() === 'true') {
    for (const tool of MUTATING_TOOLS) disabledTools.add(tool);
  }

  const allowedRecipients = parseList(env.MCP_ALLOWED_RECIPIENTS).map(s => s.toLowerCase());
  for (const entry of allowedRecipients) {
    if (!/^(@[^@\s,<>]+|[^@\s,<>]+@[^@\s,<>]+)$/.test(entry)) {
      throw new Error(
        `Invalid MCP_ALLOWED_RECIPIENTS entry: "${entry}" (use user@example.com or @example.com)`
      );
    }
  }

  return { disabledTools, allowedRecipients };
}

// Deliberately strict: if an allowlist is active, anything that is not a plain
// "user@host" or "Name <user@host>" is rejected rather than interpreted. This
// avoids parser differences (comments, quoted local parts, IDN) between this
// check and what the SMTP library ends up sending to.
const BARE_ADDRESS = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)$/;
const NAMED_ADDRESS = /^[^<>"()\\,;:\r\n]*<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)>$/;

function extractAddress(value: string): string | null {
  const trimmed = value.trim();
  const m = BARE_ADDRESS.exec(trimmed) ?? NAMED_ADDRESS.exec(trimmed);
  return m ? m[1].toLowerCase() : null;
}

export function assertRecipientsAllowed(policy: ToolPolicy, recipients: string[]): void {
  if (policy.allowedRecipients.length === 0) return;

  for (const recipient of recipients) {
    const address = extractAddress(recipient);
    const allowed =
      address !== null &&
      // The strict patterns above guarantee exactly one "@", so a suffix match
      // on "@domain" is an exact domain match (no subdomains).
      policy.allowedRecipients.some(entry =>
        entry.startsWith('@') ? address.endsWith(entry) : address === entry
      );

    if (!allowed) {
      throw new Error(
        `Recipient "${recipient}" is not permitted by this server's MCP_ALLOWED_RECIPIENTS policy`
      );
    }
  }
}
