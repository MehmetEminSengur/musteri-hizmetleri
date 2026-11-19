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

// "Paket içeriği: 50 adet kase + 50 adet kapak" satırını ürün açıklamasından bulur.
export function parsePaketIcerigi(text) {
  if (!text) return null;
  const plain = String(text).replace(/<[^>]+>/g, '\n');
  const m = plain.match(/paket\s+i[çc]eri[gğ]i\s*[:：]\s*([^\n]+)/i);
  return m ? m[1].trim().replace(/\.+$/, '').trim() || null : null;
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
