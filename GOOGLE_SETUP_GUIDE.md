# Google Workspace Integration Setup Guide

Connect Gmail, Google Drive, Docs, Sheets, and Calendar to your Personal AI Assistant.

## Prerequisites

- Google account
- Access to Google Cloud Console
- Bot already running with security features

## Step 1: Set Up Google Cloud Project

### 1.1 Create Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Name: `Personal AI Assistant`
4. Click **Create**

### 1.2 Enable APIs

1. Go to **APIs & Services** → **Library**
2. Search and enable these APIs:
   - ✅ **Gmail API**
   - ✅ **Google Drive API**
   - ✅ **Google Docs API**
   - ✅ **Google Sheets API**
   - ✅ **Google Calendar API**
   - ✅ **Google People API** (for contacts)

## Step 2: Create OAuth 2.0 Credentials

### 2.1 Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Choose **External** (unless you have a Google Workspace)
3. Fill in:
   - **App name:** Personal AI Assistant
   - **User support email:** your_email@gmail.com
   - **Developer contact:** your_email@gmail.com
4. Click **Save and Continue**

### 2.2 Add Scopes

Click **Add or Remove Scopes** and add:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.compose
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/documents
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/contacts.readonly
```

Click **Update** → **Save and Continue**

### 2.3 Add Test Users

1. Click **Add Users**
2. Add your Gmail address
3. Click **Save and Continue**

### 2.4 Create Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Choose **Desktop app**
4. Name: `Personal AI Assistant`
5. Click **Create**

### 2.5 Download Credentials

1. Click the download icon next to your new OAuth client
2. Save as `google_credentials.json`
3. **IMPORTANT:** Keep this file secure!

## Step 3: Install Google MCP Server

Choose one of these options:

### Option A: go-google-mcp (Recommended - Most Comprehensive)

```bash
# Install via npm
npm install -g @matheusbuniotto/go-google-mcp

# Or install Go and build from source
# 1. Install Go from https://go.dev/dl/
# 2. Clone and build:
git clone https://github.com/matheusbuniotto/go-google-mcp.git
cd go-google-mcp
go build
```

### Option B: Individual Services

**For Gmail only:**
```bash
npm install -g @gongrzhe/gmail-mcp-server
```

**For Drive only:**
```bash
npm install -g @piotr-agier/google-drive-mcp
```

## Step 4: Configure Environment Variables

Add to your `.env` file:

```env
# Google Workspace Configuration
GOOGLE_CLIENT_ID=123456789.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123xyz
GOOGLE_REDIRECT_URI=http://localhost:8080/callback
```

**Get these values from:**
- Your downloaded `google_credentials.json`
- `client_id` → GOOGLE_CLIENT_ID
- `client_secret` → GOOGLE_CLIENT_SECRET

## Step 5: First-Time Authentication

When you first start the bot with Google credentials:

1. The MCP server will open a browser window
2. **Sign in** to your Google account
3. **Grant permissions** to the app
4. The browser will show "Authentication successful"
5. Close the browser

The authentication token will be saved for future use.

## Step 6: Grant Tool Permissions in Database

Run in Supabase SQL Editor:

```sql
-- Grant Google tool permissions to your user
-- Replace 7740730922 with YOUR Telegram user ID

INSERT INTO tool_permissions (telegram_user_id, tool_name, is_allowed)
VALUES
    -- Gmail Tools
    (7740730922, 'gmail_list_messages', true),
    (7740730922, 'gmail_read_message', true),
    (7740730922, 'gmail_search_messages', true),
    (7740730922, 'gmail_send_message', true),
    (7740730922, 'gmail_create_draft', true),

    -- Drive Tools
    (7740730922, 'drive_list_files', true),
    (7740730922, 'drive_search_files', true),
    (7740730922, 'drive_read_file', true),
    (7740730922, 'drive_create_file', true),
    (7740730922, 'drive_upload_file', true),
    (7740730922, 'drive_delete_file', true),

    -- Docs Tools
    (7740730922, 'docs_create_document', true),
    (7740730922, 'docs_read_document', true),
    (7740730922, 'docs_update_document', true),

    -- Sheets Tools
    (7740730922, 'sheets_create_spreadsheet', true),
    (7740730922, 'sheets_read_spreadsheet', true),
    (7740730922, 'sheets_update_spreadsheet', true),

    -- Calendar Tools
    (7740730922, 'calendar_list_events', true),
    (7740730922, 'calendar_create_event', true),
    (7740730922, 'calendar_update_event', true),
    (7740730922, 'calendar_delete_event', true)
ON CONFLICT (telegram_user_id, tool_name)
DO UPDATE SET is_allowed = true, revoked_at = NULL;
```

**Note:** Actual tool names may vary depending on which MCP server you use. Check the bot logs on startup to see available tool names.

## Step 7: Build and Test

```bash
# Build the project
npm run build

# Start the bot
npm start
```

**Look for in logs:**
```
[INFO] Initializing Google Workspace MCP...
[INFO] Google Workspace MCP initialized { toolCount: 20, tools: [...] }
```

## Step 8: Test Google Integration

### Test Gmail:
```
Send to bot: "Show me my recent emails"
Send to bot: "Search my emails for 'invoice'"
Send to bot: "Draft an email to john@example.com thanking him for the meeting"
```

### Test Drive:
```
Send to bot: "List files in my Google Drive"
Send to bot: "Search my Drive for 'budget spreadsheet'"
Send to bot: "Create a new Google Doc called 'Meeting Notes'"
```

### Test Calendar:
```
Send to bot: "Show my calendar events for today"
Send to bot: "Schedule a meeting tomorrow at 2pm for 1 hour titled 'Team Sync'"
```

## Available Capabilities

Once configured, your bot can:

### 📧 Gmail
- Read and search emails
- Compose and send emails
- Create drafts
- Manage labels
- Archive/delete messages

### 📁 Google Drive
- List and search files
- Read file contents
- Create documents/sheets/slides
- Upload files
- Share files
- Organize folders

### 📄 Google Docs
- Create new documents
- Read document content
- Edit and format text
- Insert images/tables
- Collaborate on docs

### 📊 Google Sheets
- Create spreadsheets
- Read/write cell data
- Create charts
- Apply formulas
- Format sheets

### 📅 Google Calendar
- View events
- Create events
- Update events
- Delete events
- Check availability

## Troubleshooting

### "Failed to initialize Google Workspace MCP"

**Check:**
1. Google credentials in `.env` are correct
2. APIs are enabled in Google Cloud Console
3. OAuth consent screen is configured
4. Your email is added as a test user

### "Tool permission denied"

**Fix:**
```sql
-- Grant permission for specific tool
INSERT INTO tool_permissions (telegram_user_id, tool_name, is_allowed)
VALUES (YOUR_USER_ID, 'tool_name_here', true)
ON CONFLICT (telegram_user_id, tool_name)
DO UPDATE SET is_allowed = true, revoked_at = NULL;
```

### "Authentication failed"

1. Delete saved credentials (varies by MCP server)
2. Restart bot to trigger new OAuth flow
3. Make sure you're signing in with the correct Google account

### Rate Limits

Google APIs have rate limits:
- **Gmail:** 250 quota units/user/second
- **Drive:** 1,000 requests/100 seconds/user
- **Calendar:** 1,000,000 requests/day

The bot's 30-second tool timeout will prevent long-running operations.

## Security Notes

✅ **OAuth 2.0** - Industry standard authentication
✅ **Tool Permissions** - Enforced per-user, per-tool
✅ **Audit Logging** - All Google tool usage logged
✅ **Rate Limiting** - Prevents API abuse
✅ **Timeouts** - 30-second max per operation

## Privacy

- Your Google data stays in your account
- Bot only accesses what you explicitly request
- All requests are logged in audit_log table
- You can revoke access anytime in Google Account settings

## Revoking Access

To remove bot access to your Google account:

1. Go to [Google Account](https://myaccount.google.com/)
2. **Security** → **Third-party apps with account access**
3. Find "Personal AI Assistant"
4. Click **Remove Access**

---

**Setup Time:** ~30 minutes
**Difficulty:** Moderate
**Result:** Full Google Workspace integration 🎉

## Sources

- [Google Workspace MCP Server](https://github.com/matheusbuniotto/go-google-mcp)
- [Gmail MCP Server](https://github.com/GongRzhe/Gmail-MCP-Server)
- [Google Drive MCP](https://github.com/piotr-agier/google-drive-mcp)
- [Official Google MCP Support](https://cloud.google.com/blog/products/ai-machine-learning/announcing-official-mcp-support-for-google-services)
- [Google Workspace MCP (Commercial)](https://workspacemcp.com/)
