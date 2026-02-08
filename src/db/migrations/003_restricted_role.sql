-- Security Hardening: Least Privilege Database Access
-- Migration: 003_restricted_role.sql
--
-- This migration creates a restricted database role for the bot application
-- to replace the god-mode service role access.
--
-- IMPORTANT: After running this migration, you must:
-- 1. Create a new service role key in Supabase with the bot_app_role
-- 2. Update your .env file with the new restricted key
-- 3. Keep the original service role key in a secure location for admin access

-- ============================================================================
-- CREATE RESTRICTED ROLE
-- ============================================================================

-- Create restricted role for bot application
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bot_app_role') THEN
        CREATE ROLE bot_app_role;
        RAISE NOTICE 'Created role: bot_app_role';
    ELSE
        RAISE NOTICE 'Role bot_app_role already exists';
    END IF;
END
$$;

-- ============================================================================
-- GRANT NECESSARY PERMISSIONS
-- ============================================================================

-- Grant CONNECT permission
GRANT CONNECT ON DATABASE postgres TO bot_app_role;

-- Grant USAGE on schema
GRANT USAGE ON SCHEMA public TO bot_app_role;

-- ============================================================================
-- TABLE PERMISSIONS (Least Privilege)
-- ============================================================================

-- chat_history: Allow SELECT and INSERT (no DELETE)
GRANT SELECT, INSERT ON chat_history TO bot_app_role;

-- semantic_memory: Allow SELECT and INSERT (no DELETE)
GRANT SELECT, INSERT ON semantic_memory TO bot_app_role;

-- verified_users: Allow SELECT and UPDATE (for last_active_at)
GRANT SELECT ON verified_users TO bot_app_role;
GRANT UPDATE (last_active_at) ON verified_users TO bot_app_role;

-- conversation_sessions: Allow SELECT, INSERT, and UPDATE
GRANT SELECT, INSERT, UPDATE ON conversation_sessions TO bot_app_role;

-- audit_log: Allow SELECT and INSERT (no DELETE - preserve audit trail)
GRANT SELECT, INSERT ON audit_log TO bot_app_role;

-- tool_permissions: Allow SELECT only (permissions managed by admin)
GRANT SELECT ON tool_permissions TO bot_app_role;

-- ============================================================================
-- FUNCTION PERMISSIONS
-- ============================================================================

-- Grant EXECUTE on necessary functions
GRANT EXECUTE ON FUNCTION search_semantic_memory(vector(1536), BIGINT, FLOAT, INT) TO bot_app_role;
GRANT EXECUTE ON FUNCTION get_recent_context(BIGINT, INT) TO bot_app_role;
GRANT EXECUTE ON FUNCTION get_active_session(BIGINT) TO bot_app_role;
GRANT EXECUTE ON FUNCTION close_inactive_sessions() TO bot_app_role;
GRANT EXECUTE ON FUNCTION get_user_audit_trail(BIGINT, INT, INT) TO bot_app_role;
GRANT EXECUTE ON FUNCTION get_security_incidents(INT, TEXT) TO bot_app_role;

-- ============================================================================
-- SEQUENCE PERMISSIONS (for UUIDs and auto-increment)
-- ============================================================================

-- Grant USAGE on sequences if any exist
-- Note: Most tables use gen_random_uuid() which doesn't require sequence permissions

-- ============================================================================
-- DENY DANGEROUS OPERATIONS
-- ============================================================================

-- Explicitly REVOKE dangerous operations (defense in depth)
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM bot_app_role;
REVOKE DROP ON ALL TABLES IN SCHEMA public FROM bot_app_role;

-- Revoke ability to modify table structure
REVOKE CREATE ON SCHEMA public FROM bot_app_role;
REVOKE ALTER ON ALL TABLES IN SCHEMA public FROM bot_app_role;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Note: RLS policies are already configured in 001_schema.sql and 002_security_tables.sql
-- The bot_app_role will use the service_role policies which grant full access
-- If you want to add additional restrictions, you can create new policies here

-- Example: Add RLS policy for bot_app_role (optional)
-- CREATE POLICY "Bot app role access to chat_history"
--     ON chat_history
--     FOR SELECT
--     TO bot_app_role
--     USING (true);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Run these queries to verify the role has correct permissions:
--
-- 1. Check role exists:
-- SELECT rolname FROM pg_roles WHERE rolname = 'bot_app_role';
--
-- 2. Check table permissions:
-- SELECT
--     table_name,
--     privilege_type
-- FROM information_schema.table_privileges
-- WHERE grantee = 'bot_app_role'
-- ORDER BY table_name, privilege_type;
--
-- 3. Verify no DELETE permissions:
-- SELECT
--     table_name
-- FROM information_schema.table_privileges
-- WHERE grantee = 'bot_app_role'
--   AND privilege_type = 'DELETE';
-- -- Should return no rows
--
-- 4. Test connection with bot_app_role:
-- SET ROLE bot_app_role;
-- SELECT * FROM chat_history LIMIT 1; -- Should work
-- DELETE FROM chat_history WHERE id = '...'; -- Should fail
-- RESET ROLE;

-- ============================================================================
-- NOTES FOR DEPLOYMENT
-- ============================================================================

-- STEP 1: Run this migration in Supabase SQL Editor
--
-- STEP 2: Create a new service role key with bot_app_role:
--   - Go to Supabase Dashboard → Settings → API
--   - Under "Service role secret" section
--   - Create a new key and assign it the bot_app_role
--   - NOTE: This might require manual Postgres configuration depending on Supabase version
--
-- STEP 3: Update .env file:
--   SUPABASE_SERVICE_ROLE_KEY=<new_restricted_key>
--   # Keep old key for emergency admin access:
--   # SUPABASE_ADMIN_KEY=<old_service_role_key>
--
-- STEP 4: Test the application:
--   - Verify bot can read and write data
--   - Verify bot cannot delete data (check logs for permission denied errors)
--   - Run the verification queries above to confirm permissions
--
-- ROLLBACK PLAN:
--   If issues occur, revert .env to use the original service role key
--   The bot_app_role can be dropped with: DROP ROLE IF EXISTS bot_app_role;

-- ============================================================================
-- ALTERNATIVE: Manual Role Assignment (if Supabase doesn't support custom roles)
-- ============================================================================

-- If Supabase doesn't allow custom roles with API keys, you can:
-- 1. Use Supabase connection pooler with a custom role
-- 2. Use direct Postgres connection with bot_app_role
-- 3. Implement application-level restrictions (less secure)
--
-- For now, document the permissions and plan for future implementation
-- when Supabase supports custom role-based API keys
