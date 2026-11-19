// .env dosyasına anahtar yazar. Değer ekranda görünmeden girilir; sohbet ya da komut geçmişine düşmez.
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';

export const ENV_KEYS = ['META_APP_ID', 'META_APP_SECRET', 'META_ACCESS_TOKEN', 'META_PAGE_ID', 'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_ADMIN_TOKEN'];

export function setEnvValue(root, key, value) {
  if (!ENV_KEYS.includes(key)) throw new Error(`bilinmeyen anahtar: ${key}. Geçerli olanlar: ${ENV_KEYS.join(', ')}`);
  if (/[\r\n]/.test(value)) throw new Error('değer tek satır olmalı');
  const file = path.join(root, '.env');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const i = lines.findIndex((l) => l.replace(/\s+/g, '').startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  writeFileSync(file, lines.join('\n').replace(/\n?$/, '\n'));
  try { chmodSync(file, 0o600); } catch { /* Windows */ }
}

// Terminalden gizli okuma: yazılan/yapıştırılan karakterler ekrana basılmaz.
export function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('bu komut bir terminalde çalıştırılmalı'));
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (err) => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); err ? reject(err) : resolve(value.trim()); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('iptal edildi'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
