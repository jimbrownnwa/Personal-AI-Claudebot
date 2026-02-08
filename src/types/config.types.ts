/**
 * Configuration types for the Personal AI Assistant
 */

export interface AppConfig {
  telegram: TelegramConfig;
  supabase: SupabaseConfig;
  anthropic: AnthropicConfig;
  openai: OpenAIConfig;
  app: ApplicationConfig;
}

export interface TelegramConfig {
  botToken: string;
}

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export interface AnthropicConfig {
  apiKey: string;
}

export interface OpenAIConfig {
  apiKey: string;
}

export interface ApplicationConfig {
  logLevel: LogLevel;
  nodeEnv: NodeEnv;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type NodeEnv = 'development' | 'production' | 'test';

export interface EnvironmentVariables {
  TELEGRAM_BOT_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  LOG_LEVEL?: string;
  NODE_ENV?: string;
}
