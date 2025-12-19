# ProtonMail MCP Server

An MCP (Model Context Protocol) server that connects to ProtonMail via Bridge, enabling AI assistants like Claude to manage your email.

## Features

- **Email Management**: Read, search, send, reply, forward, and delete emails
- **Folder Management**: List, create, rename, and delete folders
- **Label Management**: Apply and remove labels from emails
- **Trend Analysis**: Analyze email patterns, identify important emails, track sender statistics

## Requirements

- Node.js >= 18
- [ProtonMail Bridge](https://proton.me/mail/bridge) installed and running
- ProtonMail account (Plus, Unlimited, or Business)

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/protonmail-mcp.git
cd protonmail-mcp
npm install
npm run build
```

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

## Usage with Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "protonmail": {
      "command": "node",
      "args": ["/path/to/protonmail-mcp/dist/server.js"]
    }
  }
}
```

## Available Tools (22)

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
