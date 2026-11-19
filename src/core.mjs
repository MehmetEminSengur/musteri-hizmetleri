// Ortak bağlam: ayarlar, veritabanı, kayıt, mağaza, yapay zekâ motoru.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { openDb } from './db/db.mjs';
import { createCommerce } from './commerce/shopify.mjs';
import { textEngine } from './engines/text.mjs';

// Satır başına bir JSON olayı: ekrana ve data/logs/<gün>.log dosyasına. Gizli bilgi ve mesaj
// metni loglanmaz; yalnız kimlik, durum ve sayı.
export function createLogger(dataDir, { quiet = false } = {}) {
  const dir = path.join(dataDir, 'logs');
  mkdirSync(dir, { recursive: true });
  return (event, fields = {}) => {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields });
    try { appendFileSync(path.join(dir, `${line.slice(7, 17)}.log`), line + '\n'); } catch { /* log yazılamaması işi durdurmaz */ }
    if (!quiet) console.log(line);
  };
}

export function createContext({ config = loadConfig(), db, commerce, engine, quiet = false } = {}) {
  const log = createLogger(config.dataDir, { quiet });
  db = db || openDb(config.dataDir);
  return { config, db, log, commerce: commerce || createCommerce(config, db), engine: engine || textEngine(config) };
}
