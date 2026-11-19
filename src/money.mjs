// Para kuralı: içeride her tutar TAM SAYI KURUŞ olarak tutulur ve adı "Kurus" ile biter
// (priceKurus). Mağazadan gelen "141.90" metni ondalık sayıya çevrilmeden kuruşa çevrilir;
// müşteriye her zaman "141,90 TL" biçiminde yazılır. Kuruş/TL karışıklığı 100 kat fiyat
// hatası doğurur, bu yüzden sayı (number) girdi kabul edilmez.

export function toKurus(value) {
  if (typeof value !== 'string') throw new TypeError(`fiyat metin olmalı ("141.90"), gelen: ${typeof value}`);
  const m = value.trim().match(/^(-?)(\d+)(?:[.,](\d+))?$/);
  if (!m) throw new TypeError(`fiyat okunamadı: ${value}`);
  const [, sign, whole, frac = ''] = m;
  let kurus = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) kurus += 1; // yarım kuruş yukarı yuvarlanır
  return sign ? -kurus : kurus;
}

export function formatTl(kurus) {
  if (!Number.isInteger(kurus)) throw new TypeError('formatTl tam sayı kuruş ister');
  const sign = kurus < 0 ? '-' : '';
  const abs = Math.abs(kurus);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${whole},${String(abs % 100).padStart(2, '0')} TL`;
}

// Paket içeriği: önce açıklamadaki "Paket içeriği: 50 adet kase + 50 adet kapak" satırı (HTML'deki
// <li>, <p>, <br> satır sayılır), yoksa ürün adındaki "100'lü Paket", "1000 Adet Koli" gibi ifade.
const BLOCK_END = /<\/(?:p|li|div|h[1-6]|tr|td|ul|ol)>|<br\s*\/?>/gi;

export function parsePaketIcerigi(html, title = '') {
  if (html) {
    const text = String(html).replace(BLOCK_END, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    const m = text.match(/paket\s+i[çc]eri[gğ]i\s*[:：]\s*([^\n]+)/i);
    const line = m && m[1].trim().replace(/\.+$/, '').trim();
    if (line) return line.slice(0, 200);
  }
  const t = String(title).match(/\d[\d.]*\s*(?:['’]?\s*(?:li|lı|lu|lü))?\s*(?:adet|paket|koli|rulo|kutu)(?:\s+(?:koli|paket|kutu))?/i);
  return t ? `${t[0].trim()} (ürün adından)` : null;
}

// Türkiye numaralarını 905xxxxxxxxx biçimine getirir; diğerlerinde yalnız rakamları bırakır.
export function normalizePhone(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 11 && d.startsWith('0')) d = '9' + d;
  else if (d.length === 10 && d.startsWith('5')) d = '90' + d;
  return d;
}
