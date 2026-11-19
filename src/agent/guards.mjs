// Otomatik gönderim kapıları. Model ne yazarsa yazsın, cevap müşteriye gitmeden önce burada kodla
// denetlenir; bir kapıdan geçmeyen cevap gönderilmez, operatör onayına düşer.
import { PAYMENT_LINK_PLACEHOLDER } from './tools.mjs';
import { toKurus } from '../money.mjs';

const MAX_LEN = 1200;
const PRICE = /\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s*(?:TL|₺)|(?:₺)\s*\d[\d.,]*/gi;
const URL_RE = /https?:\/\/[^\s)<>"']+/gi;
// Anahtar, dosya yolu veya sistem bilgisi gibi görünen her şey: müşteriye asla gitmez.
const SECRET = [/\bsk-[A-Za-z0-9_-]{8,}/, /\bEAA[A-Za-z0-9]{20,}/, /\bshp(?:at|ss|ca|pa)_[A-Za-z0-9]{8,}/, /-----BEGIN [A-Z ]+-----/,
  /(?:^|\s)(?:\/Users\/|\/home\/|~\/|[A-Z]:\\)/, /\b(?:access_token|client_secret|api[_-]?key|password|parola)\b/i, /\.(?:env|json|toml|db)\b/];

// "1.234,5 TL" → 123450 kuruş; okunamazsa null
const priceKurus = (s) => {
  try { return toKurus(s.replace(/\s|₺/g, '').replace(/TL$/i, '').replace(/\./g, '').replace(',', '.')); } catch { return null; }
};
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

// → kapıdan geçmeme nedenleri (boşsa gönderilebilir)
export function autoSendIssues({ text, evidence = '', actions = [], publicUrl, storeDomain, maxPackages = 50 }) {
  const issues = [];
  const t = String(text || '');
  if (!t.trim()) issues.push('cevap boş');
  if (t.length > MAX_LEN) issues.push(`cevap çok uzun (${t.length} karakter)`);
  if (t.includes(PAYMENT_LINK_PLACEHOLDER) && !actions.some((a) => a.type === 'payment_link')) issues.push('ödeme linki yer tutucusu var ama ödeme isteği yok');
  if (SECRET.some((re) => re.test(t))) issues.push('cevapta anahtar, dosya yolu veya sistem bilgisine benzeyen bir ifade var');

  // Cevaptaki her tutar ya mağaza verisinde aynen geçmeli ya da oradaki bir birim fiyatın tam
  // paket katı olmalı (ör. 2 paket x 141,90 TL = 283,80 TL).
  const known = (String(evidence).match(PRICE) || []).map(priceKurus).filter((k) => k != null && k > 0);
  for (const p of t.match(PRICE) || []) {
    const k = priceKurus(p);
    const ok = k != null && known.some((u) => k === u || (k % u === 0 && k / u <= maxPackages));
    if (!ok) issues.push(`"${p.trim()}" tutarı mağaza verisinden gelmedi`);
  }

  const allowed = new Set([host(publicUrl), storeDomain && storeDomain.replace(/^www\./, '')].filter(Boolean));
  for (const u of t.match(URL_RE) || []) {
    const h = host(u);
    if (!h || (!allowed.has(h) && !String(evidence).includes(u.replace(/[.,!?;:]+$/, '')))) issues.push(`mağaza dışı link: ${u}`);
  }
  return [...new Set(issues)];
}
