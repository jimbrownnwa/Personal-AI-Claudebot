-- Grant Google Calendar tool permissions
-- Run this in your Supabase SQL Editor after re-authenticating with Calendar scopes

-- Your Telegram User ID: 7740730922

-- Grant permissions for all Calendar tools
INSERT INTO tool_permissions (telegram_user_id, tool_name, is_allowed, notes)
VALUES
  (7740730922, 'calendar_list_events', true, 'View upcoming calendar events'),
  (7740730922, 'calendar_get_event', true, 'Get details of specific calendar events'),
  (7740730922, 'calendar_create_event', true, 'Create new calendar events'),
  (7740730922, 'calendar_update_event', true, 'Update existing calendar events'),
  (7740730922, 'calendar_delete_event', true, 'Delete calendar events'),
  (7740730922, 'calendar_search_events', true, 'Search calendar events')
ON CONFLICT (telegram_user_id, tool_name)
DO UPDATE SET
  is_allowed = true,
  granted_at = NOW(),
  revoked_at = NULL,
  revoked_by = NULL,
  notes = EXCLUDED.notes;

-- Verify permissions were granted
SELECT
  tool_name,
  is_allowed,
  granted_at,
  notes
FROM tool_permissions
WHERE telegram_user_id = 7740730922
  AND tool_name LIKE 'calendar_%'
ORDER BY tool_name;
