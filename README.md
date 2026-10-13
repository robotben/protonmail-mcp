# ProtonMail MCP Server

An MCP (Model Context Protocol) server that connects to ProtonMail via Bridge, enabling AI assistants like Claude to manage your email.

## Features

- **Email Management**: Read, search, send, reply, forward, and delete emails
- **Folder Management**: List, create, rename, and delete folders
- **Label Management**: Apply and remove labels from emails
- **Trend Analysis**: Analyze email patterns, identify important emails, track sender statistics

## Requirements

- Node.js >= 20
- [ProtonMail Bridge](https://proton.me/mail/bridge) installed and running
- ProtonMail account (Plus, Unlimited, or Business)

## Installation

```bash
git clone https://github.com/robotben/protonmail-mcp.git
cd protonmail-mcp
npm ci --ignore-scripts
npm run build
```

`--ignore-scripts` skips dependency install hooks. None are needed to build or run this server.

## Configuration

1. Copy the example config:
   ```bash
   cp config/protonmail.config.example.json config/protonmail.config.json
   ```

2. Edit `config/protonmail.config.json` with your credentials:
   ```json
   {
     "protonmail": {
       "auth": {
         "user": "your-email@protonmail.com",
         "pass": "your-bridge-password"
       }
     }
   }
   ```

   > **Note**: Use the Bridge password from ProtonMail Bridge app (not your account password).

## Running the Server

```bash
npm start
```

The server listens on `127.0.0.1:3000` by default (loopback only). Set the `PORT` environment variable to change the port:

```bash
PORT=8080 npm start
```

MCP endpoint: `http://localhost:3000/mcp`

## Security

This server can read, send, and delete all mail in the account, so treat access to it like access to the mailbox.

| Variable | Default | Purpose |
|----------|---------|---------|
| `MCP_HOST` | `127.0.0.1` | Address to bind. Any non-loopback value requires `MCP_AUTH_TOKEN`; the server refuses to start without it. |
| `MCP_AUTH_TOKEN` | unset | If set (16+ characters), `/mcp` and `/emails` require `Authorization: Bearer <token>`. |
| `MCP_ALLOWED_HOSTS` | unset | Comma-separated extra `Host` header names to accept (e.g. your public hostname). Required when serving through a proxy or tunnel with host checking on. |
| `MCP_READ_ONLY` | `false` | `true` disables every tool that sends mail or changes the mailbox. |
| `MCP_DISABLED_TOOLS` | unset | Comma-separated tool names to disable. An unknown name stops startup. |
| `MCP_ALLOWED_RECIPIENTS` | unset | Comma-separated `user@example.com` or `@example.com` entries. When set, `send_email`, `reply_to_email` and `forward_email` can only reach these recipients. |

- On loopback, requests whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]` are rejected (this blocks DNS-rebinding from web pages).
- If you expose the server beyond this machine (tunnel, reverse proxy, container), set `MCP_AUTH_TOKEN` and put it behind TLS.
- Email content is untrusted input to the model. A malicious message can try to make an assistant forward or delete mail. `MCP_READ_ONLY`, `MCP_DISABLED_TOOLS` and `MCP_ALLOWED_RECIPIENTS` limit the damage.
- Bridge uses a self-signed certificate, so certificate verification is off by default **only** when the Bridge host is loopback. For any other host it is on; override per service with `PROTONMAIL_IMAP_TLS_REJECT_UNAUTHORIZED` / `PROTONMAIL_SMTP_TLS_REJECT_UNAUTHORIZED` (`true`/`false`) or `tls.rejectUnauthorized` in the config file.
- Tools that take message UIDs accept only plain positive integers, at most 500 per call.

### Docker

Build `dist/` first (`npm run build`), then:

```bash
docker build -t protonmail-mcp .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e MCP_AUTH_TOKEN=<random 16+ character token> \
  -e PROTONMAIL_USER=you@protonmail.com -e PROTONMAIL_PASS=<bridge password> \
  -e PROTONMAIL_IMAP_HOST=<bridge host> -e PROTONMAIL_SMTP_HOST=<bridge host> \
  protonmail-mcp
```

The image runs as a non-root user and contains no credentials. Bridge only listens on loopback by default, so a container needs a Bridge instance it can reach (not `127.0.0.1`).

## Usage with Claude Desktop

The server uses the **MCP Streamable HTTP transport** (spec 2025-03-26), so configure Claude Desktop with a URL instead of a command:

```json
{
  "mcpServers": {
    "protonmail": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

> **Note**: Start the server before launching Claude Desktop (`npm start`).

### Legacy stdio (not supported)

This server no longer supports stdio transport. If you need stdio, use an earlier version.

## Available Tools (23)

### Email Reading
| Tool | Description |
|------|-------------|
| `list_emails` | List emails from a folder with pagination |
| `get_email` | Get full email content by UID |
| `get_email_headers` | Get email headers only (lightweight) |
| `search_emails` | Search emails with query, date range, filters |
| `get_unread_count` | Get unread count for folders |
| `mark_as_read` | Mark emails as read |
| `mark_as_unread` | Mark emails as unread |

### Email Sending
| Tool | Description |
|------|-------------|
| `send_email` | Send a new email |
| `reply_to_email` | Reply to an email |
| `forward_email` | Forward an email |

### Folder Management
| Tool | Description |
|------|-------------|
| `list_folders` | List all folders |
| `create_folder` | Create a new folder |
| `delete_folder` | Delete a folder |
| `rename_folder` | Rename a folder |
| `move_emails` | Move emails between folders |

### Label Management
| Tool | Description |
|------|-------------|
| `list_labels` | List all labels |
| `create_label` | Create a new label |
| `apply_labels` | Apply labels to emails |
| `remove_labels` | Remove labels from emails |

### Analytics
| Tool | Description |
|------|-------------|
| `analyze_email_trends` | Analyze email patterns over time |
| `analyze_label_distribution` | Analyze email distribution across folders |
| `identify_important_emails` | Find important emails based on criteria |

### Utility
| Tool | Description |
|------|-------------|
| `delete_emails` | Permanently delete emails |

## Resources

| URI | Description |
|-----|-------------|
| `protonmail://inbox/summary` | Inbox statistics |
| `protonmail://folders` | Folder list with counts |
| `protonmail://labels` | Label summary |
| `protonmail://recent` | Recent 24h activity |
| `protonmail://stats` | Email analytics |

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Run directly with tsx
npx tsx src/server.ts
```

## License

MIT
