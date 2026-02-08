# Security Hardening Quick Start Guide

Get the security implementation up and running in 10 minutes.

## Prerequisites Checklist

- [ ] Supabase account with SQL Editor access
- [ ] Your Telegram user ID (get from @userinfobot)
- [ ] Terminal access to project directory
- [ ] Node.js and npm installed

## 5-Step Quick Deploy

### Step 1: Database Setup (3 minutes)

**1.1 Run Security Tables Migration**

Open Supabase SQL Editor and execute:
```sql
-- Copy entire contents of src/db/migrations/002_security_tables.sql
-- Paste into SQL Editor and click "Run"
```

**1.2 Grant Yourself Tool Permissions**

Replace `YOUR_USER_ID` with your actual Telegram user ID:
```sql
INSERT INTO tool_permissions (telegram_user_id, tool_name, is_allowed)
VALUES
    (YOUR_USER_ID, 'airtable_list_bases', true),
    (YOUR_USER_ID, 'airtable_list_tables', true),
    (YOUR_USER_ID, 'airtable_query_records', true),
    (YOUR_USER_ID, 'airtable_create_record', true),
    (YOUR_USER_ID, 'airtable_update_record', true),
    (YOUR_USER_ID, 'airtable_delete_record', true)
ON CONFLICT (telegram_user_id, tool_name)
DO UPDATE SET is_allowed = true, revoked_at = NULL;
```

### Step 2: Build Application (1 minute)

```bash
cd "C:\Users\Jim\dev_2\Personal AI ClaudeBot"
npm run build
```

**Expected:** ✅ Successful compilation

### Step 3: Start Bot (1 minute)

```bash
npm start
```

**Look for these lines:**
```
[INFO] Starting monitoring service...
[INFO] Airtable MCP initialized
[INFO] ✅ Personal AI Assistant is running!
```

### Step 4: Quick Verification (3 minutes)

**Test 1: Normal Operation**
- Send a message to your bot
- ✅ Should respond normally

**Test 2: Rate Limiting**
- Send 31 messages rapidly
- ✅ 31st should be rejected with "wait X seconds"

**Test 3: Input Validation**
- Send: `` `rm -rf /` ``
- ✅ Should reject with "invalid content"

### Step 5: Check Audit Logs (2 minutes)

In Supabase SQL Editor:
```sql
-- View event summary
SELECT event_type, COUNT(*) as count
FROM audit_log
GROUP BY event_type
ORDER BY count DESC;

-- View recent events
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 10;
```

**Expected events:**
- `auth_success`
- `message_received`
- `message_sent`
- Possibly: `rate_limit_exceeded`, `validation_failure`

## 🎉 You're Done!

Your bot now has:
- ✅ Rate limiting (30 msgs/min per user)
- ✅ Input validation (injection prevention)
- ✅ Tool permissions (access control)
- ✅ Tool timeouts (30 seconds max)
- ✅ Audit logging (all security events)
- ✅ Monitoring (metrics every 60 seconds)
- ✅ Output limits (memory protection)

## What's Running?

### Security Layers Active

1. **Rate Limiting** - Prevents DoS attacks
2. **Authentication** - Whitelist verification
3. **Input Validation** - Blocks malicious input
4. **Tool Permissions** - Controls tool access
5. **Tool Timeouts** - Prevents hanging
6. **Audit Logging** - Tracks all events
7. **Monitoring** - Detects anomalies

### What to Monitor

**Every 60 seconds in logs:**
```
[INFO] Metric: Messages received { count_1m: 5 }
[INFO] Metric: Tool execution { avg_duration_ms: 1234 }
```

**Daily in database:**
```sql
SELECT * FROM get_security_incidents(24);
```

## Troubleshooting

### Bot won't start
- Check `.env` has all required variables
- Verify Supabase connection
- Check logs for errors

### Can't use tools
```sql
-- Grant permission for a tool
INSERT INTO tool_permissions (telegram_user_id, tool_name, is_allowed)
VALUES (YOUR_USER_ID, 'tool_name', true)
ON CONFLICT (telegram_user_id, tool_name)
DO UPDATE SET is_allowed = true;
```

### Rate limit too strict
Edit `src/bot/middleware/rate-limit.middleware.ts`:
```typescript
USER_CAPACITY: 60,  // Increase from 30
```
Then: `npm run build && npm start`

### False positive validation
Check logs to see what pattern triggered
Edit `src/services/input-validation.service.ts` to adjust

## Next Steps

### Immediate
- Monitor logs for 24 hours
- Test all your common use cases
- Adjust rate limits if needed

### This Week
- Review daily audit logs
- Check for false positives
- Document any configuration changes

### This Month
- Run: `SELECT cleanup_old_audit_logs(90);`
- Review security incident patterns
- Update validation rules if needed

## Quick Commands

**View Audit Log:**
```sql
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100;
```

**Check Rate Limit Violations:**
```sql
SELECT COUNT(*) FROM audit_log
WHERE event_type = 'rate_limit_exceeded'
AND created_at > NOW() - INTERVAL '1 day';
```

**Check Error Rate:**
```sql
SELECT
    COUNT(*) FILTER (WHERE event_type = 'error') * 100.0 /
    NULLIF(COUNT(*) FILTER (WHERE event_type = 'message_received'), 0) as error_rate_pct
FROM audit_log
WHERE created_at > NOW() - INTERVAL '1 day';
```

**Your Permissions:**
```sql
SELECT tool_name, is_allowed, granted_at
FROM tool_permissions
WHERE telegram_user_id = YOUR_USER_ID;
```

**Security Incidents (Last 24h):**
```sql
SELECT * FROM get_security_incidents(24);
```

## Support

**Documentation:**
- `SECURITY_IMPLEMENTATION.md` - Complete technical docs
- `DEPLOYMENT_GUIDE.md` - Detailed deployment steps
- `SECURITY_SUMMARY.md` - Executive overview

**Common Issues:**
1. Tool permission denied → Grant in database
2. Rate limited → Wait or increase limits
3. Validation failed → Check patterns
4. Timeout → Increase from 30s

## Success Indicators

✅ Bot responds to normal messages
✅ Rate limiting blocks excessive messages
✅ Input validation blocks dangerous content
✅ Audit log has entries in database
✅ Monitoring metrics appear every 60s
✅ No error rate >10%

---

**Time to Deploy:** ~10 minutes
**Difficulty:** Easy
**Status:** Ready for Production ✅
