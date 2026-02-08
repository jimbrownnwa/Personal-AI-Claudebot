-- Security Hardening: Audit Logging and Tool Permissions
-- Migration: 002_security_tables.sql

-- ============================================================================
-- AUDIT LOGGING TABLE
-- ============================================================================

-- Table: audit_log
-- Purpose: Record security events and system activity for investigation and compliance
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'auth_success',
        'auth_failure',
        'message_received',
        'message_sent',
        'tool_execution',
        'tool_timeout',
        'tool_error',
        'rate_limit_exceeded',
        'validation_failure',
        'permission_denied',
        'error'
    )),
    telegram_user_id BIGINT,
    event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_user
    ON audit_log(telegram_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_event
    ON audit_log(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_severity
    ON audit_log(severity, created_at DESC)
    WHERE severity IN ('error', 'critical');

CREATE INDEX IF NOT EXISTS idx_audit_log_created
    ON audit_log(created_at DESC);

-- ============================================================================
-- TOOL PERMISSIONS TABLE
-- ============================================================================

-- Table: tool_permissions
-- Purpose: Control which users can execute which MCP tools (allowlist-based)
CREATE TABLE IF NOT EXISTS tool_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id BIGINT NOT NULL,
    tool_name TEXT NOT NULL,
    is_allowed BOOLEAN DEFAULT false,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    granted_by BIGINT, -- User ID who granted permission (for RBAC)
    revoked_at TIMESTAMPTZ,
    revoked_by BIGINT, -- User ID who revoked permission
    notes TEXT, -- Optional notes about why permission was granted/revoked
    UNIQUE(telegram_user_id, tool_name)
);

-- Indexes for tool_permissions
CREATE INDEX IF NOT EXISTS idx_tool_permissions_user
    ON tool_permissions(telegram_user_id);

CREATE INDEX IF NOT EXISTS idx_tool_permissions_tool
    ON tool_permissions(tool_name);

CREATE INDEX IF NOT EXISTS idx_tool_permissions_active
    ON tool_permissions(telegram_user_id, tool_name)
    WHERE is_allowed = true AND revoked_at IS NULL;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on new security tables
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_permissions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Service role full access to audit_log" ON audit_log;
DROP POLICY IF EXISTS "Service role full access to tool_permissions" ON tool_permissions;

-- Grant full access to service role
CREATE POLICY "Service role full access to audit_log"
    ON audit_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to tool_permissions"
    ON tool_permissions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: cleanup_old_audit_logs
-- Purpose: Clean up audit logs older than specified days (for GDPR/storage management)
-- Default: Keep 90 days of audit logs
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(
    days_to_keep INT DEFAULT 90
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM audit_log
    WHERE created_at < NOW() - (days_to_keep || ' days')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Function: get_user_audit_trail
-- Purpose: Retrieve audit trail for a specific user
CREATE OR REPLACE FUNCTION get_user_audit_trail(
    user_id BIGINT,
    days_back INT DEFAULT 7,
    limit_count INT DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    event_type TEXT,
    event_data JSONB,
    severity TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        al.id,
        al.event_type,
        al.event_data,
        al.severity,
        al.created_at
    FROM audit_log al
    WHERE al.telegram_user_id = user_id
        AND al.created_at > NOW() - (days_back || ' days')::INTERVAL
    ORDER BY al.created_at DESC
    LIMIT limit_count;
END;
$$;

-- Function: get_security_incidents
-- Purpose: Retrieve high-severity security events for monitoring
CREATE OR REPLACE FUNCTION get_security_incidents(
    hours_back INT DEFAULT 24,
    min_severity TEXT DEFAULT 'warning'
)
RETURNS TABLE (
    id UUID,
    event_type TEXT,
    telegram_user_id BIGINT,
    event_data JSONB,
    severity TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        al.id,
        al.event_type,
        al.telegram_user_id,
        al.event_data,
        al.severity,
        al.created_at
    FROM audit_log al
    WHERE al.created_at > NOW() - (hours_back || ' hours')::INTERVAL
        AND al.severity IN ('warning', 'error', 'critical')
    ORDER BY al.created_at DESC;
END;
$$;
