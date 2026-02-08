    -- Personal AI Assistant Database Schema
    -- This schema supports persistent memory and semantic search capabilities

    -- Enable pgvector extension for vector embeddings
    CREATE EXTENSION IF NOT EXISTS vector;

    -- ============================================================================
    -- TABLES
    -- ============================================================================

    -- Table: chat_history
    -- Purpose: Store raw conversation history between user and assistant
    CREATE TABLE IF NOT EXISTS chat_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_user_id BIGINT NOT NULL,
        message_id BIGINT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'::jsonb
    );

    -- Table: semantic_memory
    -- Purpose: Store vector embeddings for semantic search of past conversations
    CREATE TABLE IF NOT EXISTS semantic_memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_user_id BIGINT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(1536), -- OpenAI text-embedding-3-small produces 1536 dimensions
        context_summary TEXT,
        importance_score FLOAT DEFAULT 0.5 CHECK (importance_score >= 0 AND importance_score <= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'::jsonb
    );

    -- Table: verified_users
    -- Purpose: Whitelist of authorized users who can interact with the bot
    CREATE TABLE IF NOT EXISTS verified_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_user_id BIGINT UNIQUE NOT NULL,
        telegram_username TEXT,
        first_name TEXT,
        last_name TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'::jsonb
    );

    -- Table: conversation_sessions
    -- Purpose: Group messages into logical conversation sessions
    CREATE TABLE IF NOT EXISTS conversation_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_user_id BIGINT NOT NULL,
        session_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        session_end TIMESTAMPTZ,
        message_count INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        summary TEXT,
        metadata JSONB DEFAULT '{}'::jsonb
    );

    -- ============================================================================
    -- INDEXES
    -- ============================================================================

    -- Indexes for chat_history
    CREATE INDEX IF NOT EXISTS idx_chat_history_user_time
        ON chat_history(telegram_user_id, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp
        ON chat_history(timestamp DESC);

    -- Indexes for semantic_memory
    CREATE INDEX IF NOT EXISTS idx_semantic_memory_user
        ON semantic_memory(telegram_user_id);

    CREATE INDEX IF NOT EXISTS idx_semantic_memory_importance
        ON semantic_memory(importance_score DESC);

    CREATE INDEX IF NOT EXISTS idx_semantic_memory_created
        ON semantic_memory(created_at DESC);

    -- Vector index for semantic search (IVFFlat algorithm for approximate nearest neighbor search)
    CREATE INDEX IF NOT EXISTS idx_semantic_memory_embedding
        ON semantic_memory
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);

    -- Indexes for verified_users
    CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_users_telegram_id
        ON verified_users(telegram_user_id);

    CREATE INDEX IF NOT EXISTS idx_verified_users_active
        ON verified_users(is_active)
        WHERE is_active = true;

    -- Indexes for conversation_sessions
    CREATE INDEX IF NOT EXISTS idx_sessions_user_active
        ON conversation_sessions(telegram_user_id, is_active)
        WHERE is_active = true;

    CREATE INDEX IF NOT EXISTS idx_sessions_start
        ON conversation_sessions(session_start DESC);

    -- ============================================================================
    -- ROW LEVEL SECURITY (RLS) POLICIES
    -- ============================================================================

    -- Enable RLS on all tables
    ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
    ALTER TABLE semantic_memory ENABLE ROW LEVEL SECURITY;
    ALTER TABLE verified_users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY;

    -- Grant full access to service role (used by the application)
    -- This allows the bot to access all user data when authenticated as service role

    -- Drop existing policies if they exist (for idempotency)
    DROP POLICY IF EXISTS "Service role full access to chat_history" ON chat_history;
    DROP POLICY IF EXISTS "Service role full access to semantic_memory" ON semantic_memory;
    DROP POLICY IF EXISTS "Service role full access to verified_users" ON verified_users;
    DROP POLICY IF EXISTS "Service role full access to conversation_sessions" ON conversation_sessions;

    -- Create policies
    CREATE POLICY "Service role full access to chat_history"
        ON chat_history
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);

    CREATE POLICY "Service role full access to semantic_memory"
        ON semantic_memory
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);

    CREATE POLICY "Service role full access to verified_users"
        ON verified_users
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);

    CREATE POLICY "Service role full access to conversation_sessions"
        ON conversation_sessions
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);

    -- ============================================================================
    -- HELPER FUNCTIONS
    -- ============================================================================

    -- Function: search_semantic_memory
    -- Purpose: Search semantic memory using vector similarity (cosine distance)
    -- Parameters:
    --   query_embedding: The embedding vector to search for
    --   user_id: The Telegram user ID to filter results
    --   match_threshold: Minimum similarity score (0-1, default 0.7)
    --   match_count: Maximum number of results to return (default 5)
    CREATE OR REPLACE FUNCTION search_semantic_memory(
        query_embedding vector(1536),
        user_id BIGINT,
        match_threshold FLOAT DEFAULT 0.7,
        match_count INT DEFAULT 5
    )
    RETURNS TABLE (
        id UUID,
        content TEXT,
        context_summary TEXT,
        similarity FLOAT,
        created_at TIMESTAMPTZ
    )
    LANGUAGE plpgsql
    AS $$
    BEGIN
        RETURN QUERY
        SELECT
            sm.id,
            sm.content,
            sm.context_summary,
            1 - (sm.embedding <=> query_embedding) AS similarity,
            sm.created_at
        FROM semantic_memory sm
        WHERE sm.telegram_user_id = user_id
            AND 1 - (sm.embedding <=> query_embedding) > match_threshold
        ORDER BY sm.embedding <=> query_embedding
        LIMIT match_count;
    END;
    $$;

    -- Function: get_recent_context
    -- Purpose: Retrieve recent chat messages for a user
    -- Parameters:
    --   user_id: The Telegram user ID
    --   message_limit: Maximum number of messages to return (default 20)
    CREATE OR REPLACE FUNCTION get_recent_context(
        user_id BIGINT,
        message_limit INT DEFAULT 20
    )
    RETURNS TABLE (
        id UUID,
        role TEXT,
        content TEXT,
        message_timestamp TIMESTAMPTZ
    )
    LANGUAGE plpgsql
    AS $$
    BEGIN
        RETURN QUERY
        SELECT
            ch.id,
            ch.role,
            ch.content,
            ch.timestamp
        FROM chat_history ch
        WHERE ch.telegram_user_id = user_id
        ORDER BY ch.timestamp DESC
        LIMIT message_limit;
    END;
    $$;

    -- Function: get_active_session
    -- Purpose: Get the current active conversation session for a user
    -- Parameters:
    --   user_id: The Telegram user ID
    CREATE OR REPLACE FUNCTION get_active_session(
        user_id BIGINT
    )
    RETURNS TABLE (
        id UUID,
        session_start TIMESTAMPTZ,
        message_count INT
    )
    LANGUAGE plpgsql
    AS $$
    BEGIN
        RETURN QUERY
        SELECT
            cs.id,
            cs.session_start,
            cs.message_count
        FROM conversation_sessions cs
        WHERE cs.telegram_user_id = user_id
            AND cs.is_active = true
        ORDER BY cs.session_start DESC
        LIMIT 1;
    END;
    $$;

    -- Function: close_inactive_sessions
    -- Purpose: Close sessions that have been inactive for more than 30 minutes
    -- This should be called periodically (e.g., before creating a new session)
    CREATE OR REPLACE FUNCTION close_inactive_sessions()
    RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
        UPDATE conversation_sessions
        SET is_active = false,
            session_end = NOW()
        WHERE is_active = true
            AND session_start < NOW() - INTERVAL '30 minutes';
    END;
    $$;

    -- ============================================================================
    -- INITIAL DATA (OPTIONAL)
    -- ============================================================================

    -- Example: Insert your Telegram user ID here to authorize yourself
    -- Replace 123456789 with your actual Telegram user ID
    -- You can get this from @userinfobot on Telegram

    -- INSERT INTO verified_users (telegram_user_id, telegram_username, first_name, is_active)
    -- VALUES (123456789, 'your_username', 'Your Name', true)
    -- ON CONFLICT (telegram_user_id) DO NOTHING;

    -- ============================================================================
    -- CLEANUP AND MAINTENANCE
    -- ============================================================================

    -- Optional: Function to clean up old chat history (for GDPR compliance or storage management)
    -- Uncomment and customize if needed

    -- CREATE OR REPLACE FUNCTION cleanup_old_chat_history(
    --     days_to_keep INT DEFAULT 90
    -- )
    -- RETURNS INT
    -- LANGUAGE plpgsql
    -- AS $$
    -- DECLARE
    --     deleted_count INT;
    -- BEGIN
    --     DELETE FROM chat_history
    --     WHERE timestamp < NOW() - (days_to_keep || ' days')::INTERVAL;
    --
    --     GET DIAGNOSTICS deleted_count = ROW_COUNT;
    --     RETURN deleted_count;
    -- END;
    -- $$;
