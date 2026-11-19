// Müşteri hafızası: kalıcı notlar, kanallar arası kimlik birleştirme ve yapay zekâya verilen profil.
// Konuşmaların kendisi messages tablosunda kalıcıdır; burası her yeni mesajda müşteriyi
// tanımak için o kayıtlardan bir özet çıkarır.
import { nowIso } from './db/db.mjs';
import { normalizePhone } from './money.mjs';

export const MAX_NOTES = 30;
const NOTE_MAX_LEN = 300;
const OTHER_CHANNEL_MESSAGES = 8;
export const CHANNEL_NAMES = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };

export function notesOf(db, customerId) {
  return db.prepare('SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY id').all(customerId);
}

export function addNote(db, customerId, text, source) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX_LEN);
  if (!clean) return null;
  const existing = notesOf(db, customerId);
  if (existing.some((n) => n.text.toLocaleLowerCase('tr') === clean.toLocaleLowerCase('tr'))) return null;
  const oldestAi = existing.find((n) => n.source === 'ai');
  if (existing.length >= MAX_NOTES && oldestAi) db.prepare('DELETE FROM customer_notes WHERE id = ?').run(oldestAi.id); // operatör notları korunur
  const id = db.prepare('INSERT INTO customer_notes(customer_id, text, source, created_at) VALUES (?, ?, ?, ?)').run(customerId, clean, source, nowIso()).lastInsertRowid;
  return db.prepare('SELECT * FROM customer_notes WHERE id = ?').get(id);
}

export function identityOf(db, conv) {
  return db.prepare('SELECT * FROM identities WHERE channel = ? AND external_id = ?').get(conv.channel, conv.external_user_id);
}

export function isVerified(db, conv) {
  return Boolean(identityOf(db, conv)?.verified);
}

function merge(db, sourceId, targetId) {
  for (const table of ['identities', 'conversations', 'customer_notes']) {
    db.prepare(`UPDATE ${table} SET customer_id = ? WHERE customer_id = ?`).run(targetId, sourceId);
  }
  const s = db.prepare('SELECT * FROM customers WHERE id = ?').get(sourceId);
  db.prepare('UPDATE customers SET name = COALESCE(name, ?), email = COALESCE(email, ?), commerce_id = COALESCE(commerce_id, ?) WHERE id = ?')
    .run(s.name, s.email, s.commerce_id, targetId);
  db.prepare('DELETE FROM customers WHERE id = ?').run(sourceId);
}

// Müşteri sipariş numarası + telefon/e-postayla kendini doğruladı: bu kanal kimliği aynı
// telefona/e-postaya sahip mevcut müşteriyle birleşir. Böylece iki kanal tek müşteri olur.
export function linkVerifiedContact(db, conv, { phone, email }) {
  phone = normalizePhone(phone);
  email = email ? String(email).toLowerCase() : null;
  db.exec('BEGIN IMMEDIATE');
  try {
    let target = phone ? db.prepare('SELECT id FROM customers WHERE phone = ? ORDER BY id LIMIT 1').get(phone) : null;
    if (!target && email) target = db.prepare('SELECT id FROM customers WHERE email = ? ORDER BY id LIMIT 1').get(email);
    let customerId = conv.customer_id;
    if (target && target.id !== customerId) {
      merge(db, customerId, target.id);
      customerId = target.id;
    }
    db.prepare('UPDATE customers SET phone = COALESCE(phone, ?), email = COALESCE(email, ?) WHERE id = ?').run(phone, email, customerId);
    db.prepare('UPDATE identities SET verified = 1 WHERE channel = ? AND external_id = ?').run(conv.channel, conv.external_user_id);
    db.exec('COMMIT');
    conv.customer_id = customerId;
    return customerId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export async function commerceCustomerId(db, commerce, customerId) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (c.commerce_id) return c.commerce_id;
  if (!c.phone && !c.email) return null;
  const rec = await commerce.findCustomer({ phone: c.phone, email: c.email });
  if (!rec) return null;
  db.prepare('UPDATE customers SET commerce_id = ?, name = COALESCE(name, ?) WHERE id = ?').run(rec.id, rec.name, customerId);
  return rec.id;
}

const day = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

export async function buildProfile(db, commerce, conv) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(conv.customer_id);
  const verified = isVerified(db, conv);
  const convs = db.prepare('SELECT * FROM conversations WHERE customer_id = ?').all(customer.id);
  const ids = convs.map((c) => c.id);
  const first = db.prepare(`SELECT min(sent_at) t FROM messages WHERE conversation_id IN (${ids.map(() => '?').join(',')})`).get(...ids)?.t;

  const lines = ['## Müşteri hakkında bildiklerin',
    'Bu bilgiler sistemin kayıtlarından gelir. Müşteriyi tanıyormuş gibi doğal kullan (adıyla hitap, daha önce aldığı ürünü hatırlama); bilgileri liste halinde müşteriye okuma.'];
  if (customer.name) lines.push(`- Adı: ${customer.name}`);
  if (first) lines.push(`- İlk mesajı: ${day(first)}. Yazdığı kanallar: ${[...new Set(convs.map((c) => CHANNEL_NAMES[c.channel]))].sort().join(', ')}`);
  if (!verified) lines.push('- Bu kanaldaki kimliği doğrulanmadı: sipariş bilgisi paylaşmadan önce `siparis_sorgula` ile sipariş numarası ve telefon/e-posta doğrulaması iste.');

  const notes = notesOf(db, customer.id);
  if (notes.length) lines.push('- Notlar:', ...notes.map((n) => `  - ${n.text}`));
  else lines.push('- Henüz not yok.');

  if (verified) {
    let orders = null;
    try {
      const cid = await commerceCustomerId(db, commerce, customer.id);
      orders = cid ? await commerce.customerOrders(cid, 3) : [];
    } catch { /* mağazaya ulaşılamazsa profil siparişsiz verilir; ajan gerekirse aracı kendisi dener */ }
    if (orders?.length) {
      lines.push('- Son siparişleri:', ...orders.map((o) => `  - ${o.number} (${day(o.createdAt)}): ${o.items.join(', ')} — ${o.fulfillmentStatus || 'durum bilinmiyor'}`));
    } else if (orders) lines.push('- Mağazada siparişi yok (ilk kez alışveriş yapabilir).');
  }

  const others = ids.filter((id) => id !== conv.id);
  if (others.length) {
    const byId = Object.fromEntries(convs.map((c) => [c.id, c]));
    const rows = db.prepare(`SELECT * FROM messages WHERE conversation_id IN (${others.map(() => '?').join(',')}) ORDER BY id DESC LIMIT ?`).all(...others, OTHER_CHANNEL_MESSAGES).reverse();
    if (rows.length) {
      lines.push('- Diğer kanallardaki son yazışmalar (eskiden yeniye):');
      for (const m of rows) lines.push(`  - [${CHANNEL_NAMES[byId[m.conversation_id].channel]} ${day(m.sent_at)}] ${m.author === 'customer' ? 'Müşteri' : 'Biz'}: ${m.text.slice(0, 300)}`);
    }
  }
  return lines.join('\n');
}
