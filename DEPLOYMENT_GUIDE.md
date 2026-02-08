# Security Hardening Deployment Guide

This guide walks you through deploying the security hardening implementation for the Personal AI Assistant.

## Prerequisites

- Access to Supabase SQL Editor
- Your Telegram user ID (get from @userinfobot on Telegram)
- Terminal access to the project directory

## Deployment Steps

### Step 1: Database Migrations

Run these SQL migrations in your Supabase SQL Editor (in order):

#### 1.1 Create Security Tables

```sql
-- File: src/db/migrations/002_security_tables.sql
-- Copy and paste the entire file into Supabase SQL Editor and execute
```

This creates:
- `audit_log` table for security event tracking
- `tool_permissions` table for access control
- Helper functions for queries
- Indexes for performance

**Verify:**
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('audit_log', 'tool_permissions');

-- Should return 2 rows
```

#### 1.2 Grant Tool Permissions to Your User

Replace `YOUR_TELEGRAM_USER_ID` with your actual Telegram user ID:

```sql
-- Grant all Airtable tools (or other MCP tools you're using)
INSERT INTO tool_permissions (telegram_user_id, tool_name, is_allowed)
VALUES
    (YOUR_TELEGRAM_USER_ID, 'airtable_list_bases', true),
    (YOUR_TELEGRAM_USER_ID, 'airtable_list_tables', true),
    (YOUR_TELEGRAM_USER_ID, 'airtable_query_records', true),
    (YOUR_TELEGRAM_USER_ID, 'airtable_create_record', true),
    (YOUR_TELEGRAM_USER_ID, 'airtable_update_record', true),
    (YOUR_TELEGRAM_USER_ID, 'airtable_delete_record', true)
ON CONFLICT (telegram_user_id, tool_name)
DO UPDATE SET is_allowed = true, revoked_at = NULL;
```

**Note:** You'll need to update this list based on the actual tools available in your MCP server. Check the bot logs when it starts to see available tool names.

**Verify:**
```sql
-- Check your permissions
SELECT tool_name, is_allowed, granted_at
FROM tool_permissions
WHERE telegram_user_id = YOUR_TELEGRAM_USER_ID;
```

#### 1.3 (Optional) Create Restricted Database Role

For maximum security, create a restricted database role:

```sql
-- File: src/db/migrations/003_restricted_role.sql
-- Copy and paste the entire file into Supabase SQL Editor and execute
```

**Note:** This step is optional and may require additional Supabase configuration. You can defer this to later if needed.

### Step 2: Build and Deploy Application

#### 2.1 Install Dependencies (if needed)

```bash
cd "C:\Users\Jim\dev_2\Personal AI ClaudeBot"
npm install
```

#### 2.2 Run Type Check

```bash
npm run type-check
```

**Expected:** No errors

#### 2.3 Build Project

```bash
npm run build
```

**Expected:** Successful compilation to `dist/` directory

#### 2.4 Verify Environment Variables

Check your `.env` file has all required variables:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key
ANTHROPIC_API_KEY=sk-ant-your-key
OPENAI_API_KEY=sk-your-openai-key
```

### Step 3: Start the Bot

```bash
npm start
```

**Expected Output:**
```
[INFO] 🤖 Starting Personal AI Assistant...
[INFO] Environment variables verified
[INFO] Checking Supabase connection...
[INFO] Supabase connection verified
[INFO] Initializing Airtable MCP...
[INFO] Airtable MCP initialized (6 tools)
[INFO] Starting monitoring service...
[INFO] Telegram bot initialized successfully
[INFO] ✅ Personal AI Assistant is running!
[INFO] Press Ctrl+C to stop
```

### Step 4: Verify Security Controls

#### 4.1 Test Rate Limiting

Send 31 messages rapidly to your bot:

**Expected:** 31st message gets rejected with:
```
⚠️ You're sending messages too quickly. Please wait X second(s) before trying again.
```

**Verify in database:**
```sql
SELECT * FROM audit_log
WHERE event_type = 'rate_limit_exceeded'
ORDER BY created_at DESC LIMIT 5;
```

#### 4.2 Test Input Validation

Send a message with dangerous content:
```
`rm -rf /`
```

**Expected:**
```
⚠️ Your message contains invalid content and cannot be processed. Please review your input and try again.
```

**Verify in database:**
```sql
SELECT * FROM audit_log
WHERE event_type = 'validation_failure'
ORDER BY created_at DESC LIMIT 5;
```

#### 4.3 Test Tool Permissions

**Method 1: Revoke permission and test**
```sql
-- Revoke a tool permission
UPDATE tool_permissions
SET is_allowed = false, revoked_at = NOW()
WHERE telegram_user_id = YOUR_TELEGRAM_USER_ID
AND tool_name = 'airtable_list_bases';
```

Try to use that tool via the bot.

**Expected:**
```
You don't have permission to use the tool: airtable_list_bases. Please contact the administrator if you need access.
```

**Restore permission:**
```sql
UPDATE tool_permissions
SET is_allowed = true, revoked_at = NULL
WHERE telegram_user_id = YOUR_TELEGRAM_USER_ID
AND tool_name = 'airtable_list_bases';
```

**Verify in database:**
```sql
SELECT * FROM audit_log
WHERE event_type = 'permission_denied'
ORDER BY created_at DESC LIMIT 5;
```

#### 4.4 Test Audit Logging

Check that all events are being logged:

```sql
-- View event type summary
SELECT event_type, COUNT(*) as count, MAX(created_at) as last_occurrence
FROM audit_log
GROUP BY event_type
ORDER BY count DESC;

-- Expected to see:
-- auth_success
-- message_received
-- message_sent
-- tool_execution
-- Possibly: rate_limit_exceeded, validation_failure, permission_denied
```

#### 4.5 Test Monitoring

Monitor the bot logs for periodic metrics (every 60 seconds):

**Expected output:**
```
[INFO] Metric: Messages received { count_1m: 5, rate_per_min: 5 }
[INFO] Metric: Tool execution { count_5m: 3, avg_duration_ms: 1234, max_duration_ms: 2000 }
```

### Step 5: Security Verification Checklist

- [ ] `audit_log` table exists and has entries
- [ ] `tool_permissions` table exists and has your permissions
- [ ] Rate limiting works (31st message rejected)
- [ ] Input validation blocks dangerous input
- [ ] Tool permissions are enforced
- [ ] Audit log captures all event types
- [ ] Monitoring metrics appear in logs every 60 seconds
- [ ] Bot responds normally to legitimate messages

## Post-Deployment Monitoring

### Daily Tasks

1. **Check Logs for Alerts**
   ```bash
   # Look for 🚨 ALERT messages in bot output
   grep "ALERT" bot.log
   ```

2. **Review Error Rate**
   ```sql
   SELECT
       COUNT(*) FILTER (WHERE event_type = 'error') as errors,
       COUNT(*) FILTER (WHERE event_type = 'message_received') as messages,
       ROUND(100.0 * COUNT(*) FILTER (WHERE event_type = 'error') /
             NULLIF(COUNT(*) FILTER (WHERE event_type = 'message_received'), 0), 2) as error_rate_pct
   FROM audit_log
   WHERE created_at > NOW() - INTERVAL '24 hours';
   ```

### Weekly Tasks

1. **Review Security Incidents**
   ```sql
   SELECT * FROM get_security_incidents(168); -- Last 7 days
   ```

2. **Check Rate Limit Violations**
   ```sql
   SELECT DATE_TRUNC('day', created_at) as day, COUNT(*) as violations
   FROM audit_log
   WHERE event_type = 'rate_limit_exceeded'
   AND created_at > NOW() - INTERVAL '7 days'
   GROUP BY day
   ORDER BY day;
   ```

3. **Review Failed Authentications**
   ```sql
   SELECT telegram_user_id, event_data->>'username' as username, COUNT(*) as attempts
   FROM audit_log
   WHERE event_type = 'auth_failure'
   AND created_at > NOW() - INTERVAL '7 days'
   GROUP BY telegram_user_id, username
   ORDER BY attempts DESC;
   ```

### Monthly Tasks

1. **Clean Up Old Audit Logs**
   ```sql
   SELECT cleanup_old_audit_logs(90); -- Keep 90 days
   ```

2. **Review Tool Usage Patterns**
   ```sql
   SELECT
       event_data->>'toolName' as tool_name,
       COUNT(*) as usage_count,
       AVG((event_data->>'durationMs')::numeric) as avg_duration_ms
   FROM audit_log
   WHERE event_type = 'tool_execution'
   AND created_at > NOW() - INTERVAL '30 days'
   GROUP BY tool_name
   ORDER BY usage_count DESC;
   ```

3. **Security Audit**
   - Review all tool permissions
   - Check for stale user accounts
   - Update rate limits if needed
   - Review and update input validation patterns

## Troubleshooting

### Issue: Rate Limiting Too Strict

**Symptom:** Legitimate users getting rate limited

**Solution:** Adjust rate limits in `src/bot/middleware/rate-limit.middleware.ts`:

```typescript
const RATE_LIMITS = {
  USER_CAPACITY: 60,        // Increase from 30
  USER_REFILL_RATE: 1,      // Increase from 0.5
  GLOBAL_CAPACITY: 200,     // Increase from 100
  GLOBAL_REFILL_RATE: 3.33, // Increase from 1.67
};
```

Then rebuild and restart:
```bash
npm run build
npm start
```

### Issue: Input Validation False Positives

**Symptom:** Legitimate messages being rejected

**Solution:** Review and adjust patterns in `src/services/input-validation.service.ts`

Comment out specific patterns causing issues, then rebuild.

### Issue: Tool Timeout Too Short

**Symptom:** Tools timing out before completing

**Solution:** Increase timeout in `src/services/airtable.service.ts`:

```typescript
const TOOL_TIMEOUT_MS = 60000; // Change from 30000 to 60000 (60 seconds)
```

### Issue: Audit Log Growing Too Large

**Symptom:** Database size increasing rapidly

**Solution:** Reduce audit log retention:

```sql
-- Clean up older logs
SELECT cleanup_old_audit_logs(30); -- Keep only 30 days instead of 90

-- Or schedule automatic cleanup
-- (Set up a cron job or Supabase scheduled function)
```

### Issue: Performance Degradation

**Symptom:** Bot responding slowly

**Solutions:**

1. **Check monitoring metrics:** Look for slow tool executions
2. **Increase permission cache TTL:** In `src/services/tool-permission.service.ts`
3. **Reduce monitoring frequency:** In `src/services/monitoring.service.ts` (change from 60s to 120s)
4. **Check database indexes:** Ensure audit_log indexes exist

### Issue: Can't Use Tools

**Symptom:** "You don't have permission to use the tool" errors

**Solution:** Grant permissions in database:

```sql
-- Check current permissions
SELECT * FROM tool_permissions WHERE telegram_user_id = YOUR_TELEGRAM_USER_ID;

-- Grant permission
INSERT INTO tool_permissions (telegram_user_id, tool_name, is_allowed)
VALUES (YOUR_TELEGRAM_USER_ID, 'tool_name_here', true)
ON CONFLICT (telegram_user_id, tool_name)
DO UPDATE SET is_allowed = true, revoked_at = NULL;
```

## Rollback Plan

If you need to rollback the security implementation:

### Option 1: Disable Specific Controls

**Disable Rate Limiting:**
```typescript
// In src/bot/bot.ts, comment out:
// bot.use(rateLimitMiddleware);
```

**Disable Input Validation:**
```typescript
// In src/bot/handlers/message-with-tools.handler.ts, comment out validation check
```

**Disable Tool Permissions:**
```typescript
// In src/services/airtable.service.ts, comment out permission check
```

Then rebuild and restart.

### Option 2: Full Rollback

```bash
# Revert to previous version
git log --oneline  # Find commit before security implementation
git revert <commit_hash>
npm run build
npm start
```

## Support

For issues or questions:

1. Check the logs: `npm start` output
2. Check audit logs: `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100;`
3. Review `SECURITY_IMPLEMENTATION.md` for detailed documentation
4. Check troubleshooting section above

## Next Steps

After successful deployment:

1. **Monitor for 24 hours** - Watch for any issues
2. **Document any adjustments** - Update this guide if you change settings
3. **Set up alerts** - Configure notifications for critical security events
4. **Schedule maintenance** - Add calendar reminders for weekly/monthly tasks
5. **(Optional) Implement restricted DB role** - Follow Step 1.3 for additional security

## Success Criteria

✅ All security tests pass
✅ No false positives blocking legitimate use
✅ Audit logs are being written
✅ Monitoring metrics appear every 60 seconds
✅ Bot responds normally to regular messages
✅ Rate limiting works but doesn't block normal usage
✅ Tool permissions prevent unauthorized access

---

**Deployed:** [Date]
**Version:** 1.0.0
**Last Updated:** 2026-02-08
