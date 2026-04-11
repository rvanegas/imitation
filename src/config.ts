import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as TOML from '@iarna/toml';

// XDG Base Directory resolution
const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
const xdgStateHome  = process.env.XDG_STATE_HOME  ?? path.join(os.homedir(), '.local', 'state');
const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR ?? '/tmp';

export const CONFIG_DIR  = path.join(xdgConfigHome, 'imitation');
export const STATE_DIR   = path.join(xdgStateHome,  'imitation');
export const RUNTIME_DIR = path.join(xdgRuntimeDir, 'imitation');

for (const dir of [CONFIG_DIR, STATE_DIR, RUNTIME_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Persistent state file paths
export const SESSIONS_FILE = path.join(STATE_DIR, 'sessions.json');
export const PROFILES_FILE = path.join(STATE_DIR, 'user_profiles.json');

interface PricingEntry {
  input_per_million?: number;
  output_per_million?: number;
  cache_write_per_million?: number;
  cache_read_per_million?: number;
}

// TOML config schema
interface Config {
  bot_token?:     string;
  model_provider?: string;
  anthropic?: { api_key?: string; model?: string };
  ollama?:    { model?: string; base_url?: string };
  socket?:    { path?: string };
  websocket?: { port?: number };
  pricing?:   Record<string, PricingEntry>;
}

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.toml');
let raw: Config = {};
try {
  raw = TOML.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Config;
} catch (err: any) {
  if (err.code !== 'ENOENT') {
    console.error(`Warning: failed to parse ${CONFIG_FILE}: ${err.message}`);
  }
}

export const BOT_TOKEN       = raw.bot_token            ?? '';
export const MODEL_PROVIDER  = raw.model_provider       ?? 'anthropic';
export const ANTHROPIC_API_KEY = raw.anthropic?.api_key ?? '';
export const ANTHROPIC_MODEL = raw.anthropic?.model     ?? 'claude-sonnet-4-6';
export const OLLAMA_MODEL    = raw.ollama?.model        ?? 'llama3.2';
export const OLLAMA_BASE_URL = raw.ollama?.base_url     ?? 'http://localhost:11434/v1';
export const SOCKET_PATH     = raw.socket?.path         || path.join(RUNTIME_DIR, 'imitation.sock');
export const WS_PORT         = raw.websocket?.port      ?? 8080;

// Per-model pricing table. Keys are model IDs as recorded in cost-audit.jsonl.
export const PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number; cacheWritePerMillion: number; cacheReadPerMillion: number }> = {};
for (const [model, p] of Object.entries(raw.pricing ?? {})) {
  if (typeof p !== 'object' || p === null) continue;
  PRICING[model] = {
    inputPerMillion:      p.input_per_million       ?? 0,
    outputPerMillion:     p.output_per_million      ?? 0,
    cacheWritePerMillion: p.cache_write_per_million ?? 0,
    cacheReadPerMillion:  p.cache_read_per_million  ?? 0,
  };
}
