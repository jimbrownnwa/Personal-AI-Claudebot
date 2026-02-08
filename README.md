# Personal AI Assistant

A persistent AI assistant with Claude as the brain, accessible via Telegram with long-term memory powered by Supabase.

## Features

- **Telegram Interface** - Communicate with your AI assistant via Telegram
- **Persistent Memory** - Conversations and context are stored in Supabase
- **Semantic Search** - Find relevant past conversations using vector embeddings
- **Context-Aware Responses** - Claude remembers your preferences and past interactions
- **Secure** - Only authorized users can interact with the bot

## Architecture

- **Communication Layer**: Grammy bot framework for Telegram
- **Intelligence Layer**: Claude API with context-aware responses
- **Memory Layer**: Supabase with vector search (OpenAI embeddings)
- **Security Layer**: User verification and rate limiting

## Prerequisites

- Node.js v18 or higher
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Supabase account and project
- Anthropic API key (Claude)
- OpenAI API key (for embeddings)

## Setup

1. **Clone and install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your actual API keys and configuration
   ```

3. **Set up Supabase**
   - Create a new Supabase project
   - Enable the pgvector extension in the SQL editor:
     ```sql
     CREATE EXTENSION IF NOT EXISTS vector;
     ```
   - Run the schema from `src/db/schema.sql` in the SQL editor
   - Add your Telegram user ID to the `verified_users` table

4. **Get your Telegram User ID**
   - Message [@userinfobot](https://t.me/userinfobot) on Telegram to get your user ID
   - Insert it into Supabase:
     ```sql
     INSERT INTO verified_users (telegram_user_id, telegram_username, first_name, is_active)
     VALUES (YOUR_USER_ID, 'your_username', 'Your Name', true);
     ```

5. **Run the bot**
   ```bash
   # Development mode with auto-reload
   npm run dev

   # Production build and run
   npm run build
   npm start
   ```

## Usage

### Commands

- `/start` - Initialize the bot and get welcome message
- `/help` - Display available commands
- `/clear` - Clear conversation history (semantic memory is retained)
- `/status` - Show statistics (message count, memory entries)

### Normal Conversation

Just send messages to the bot as you would in any chat. The bot will:
1. Remember recent conversations (last 20 messages)
2. Search for relevant past context using semantic memory
3. Respond with context-aware answers from Claude

## Project Structure

```
├── src/
│   ├── index.ts                    # Application entry point
│   ├── bot/                        # Telegram bot logic
│   ├── services/                   # Business logic (Claude, Memory, Embeddings)
│   ├── db/                         # Database client and repositories
│   ├── types/                      # TypeScript type definitions
│   └── utils/                      # Utilities (logger, error handler)
├── .env.example                     # Environment variables template
├── package.json
├── tsconfig.json
└── README.md
```

## Development

```bash
# Run in development mode with auto-reload
npm run dev

# Type check without building
npm run type-check

# Build for production
npm run build
```

## Future Enhancements

- Proactive check-ins (30-minute workspace scans)
- Voice integration (11 Labs + Twilio)
- External integrations (Gmail, Calendar, Notion)
- MCP tool capabilities
- Observability dashboard

## Security

- Only verified users can interact with the bot
- All API keys are stored securely in environment variables
- Row-level security (RLS) in Supabase prevents unauthorized data access
- Rate limiting prevents abuse

## License

ISC
