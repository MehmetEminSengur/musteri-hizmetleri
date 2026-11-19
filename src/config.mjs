// config.json (ayarlar) ve .env (gizli anahtarlar) okunur. Harici paket yok.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export const DEFAULTS = {
  // approval: her cevap paneldeki onayınızla gider. auto: kontrollerden geçen cevap hemen gider,
  // geçmeyen onayınıza düşer.
  mode: 'approval',
  store: { platform: 'shopify', domain: '', publicUrl: '', brandName: '', apiVersion: '2026-07' },
  engines: { text: 'codex' },
  channels: { whatsapp: true, instagram: true, messenger: true },
  server: { panelPort: 8787, webhookPort: 8788, publicUrl: '' },
  limits: { maxPackagesPerOrder: 50, aiStepsPerReply: 8 },
  meta: { graphVersion: 'v23.0' },
};

function merge(base, over) {
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base?.[k], v);
  return out;
}

export function parseEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

// MUSTERI_HOME: ayar ve veri klasörünü repodan ayırmak için (ör. testler, birden fazla mağaza).
export function loadConfig(root = process.env.MUSTERI_HOME || ROOT) {
  const cfgPath = path.join(root, 'config.json');
  const user = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
  const envPath = path.join(root, '.env');
  const env = { ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}), ...process.env };
  const config = merge(DEFAULTS, user);
  config.store.domain = String(config.store.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  config.store.publicUrl = String(config.store.publicUrl || (config.store.domain ? `https://${config.store.domain}` : '')).replace(/\/$/, '');
  return { ...config, root, dataDir: path.join(root, 'data'), configured: existsSync(cfgPath), env };
}
