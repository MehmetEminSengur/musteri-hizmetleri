// Gelen mesajı kaydeder: müşteri kimliği bulunur/oluşturulur, konuşmaya eklenir, bekleyen eski
// taslaklar geçersiz olur. Aynı mesaj (aynı kanal mesaj kimliği) ikinci kez gelirse null döner.
import { nowIso } from './db/db.mjs';
import { normalizePhone } from './money.mjs';

// Mesaj bu mağazanın hesabına mı geldi? (Webhook başka hesapların olaylarını da taşıyabilir.)
export function isOurAccount(accounts, msg) {
  const expected = { whatsapp: accounts.whatsapp, instagram: accounts.instagram, messenger: accounts.messenger }[msg.channel];
  return Boolean(expected) && String(expected) === String(msg.accountId);
}

function customerFor(db, msg) {
  const ident = db.prepare('SELECT customer_id FROM identities WHERE channel = ? AND external_id = ?').get(msg.channel, msg.userId);
  if (ident) return ident.customer_id;
  const phone = normalizePhone(msg.phone);
  let customerId = phone ? db.prepare('SELECT id FROM customers WHERE phone = ? ORDER BY id LIMIT 1').get(phone)?.id : null;
  if (!customerId) {
    customerId = Number(db.prepare('INSERT INTO customers(name, phone, created_at) VALUES (?, ?, ?)').run(msg.userName || null, phone, nowIso()).lastInsertRowid);
  }
  db.prepare('INSERT INTO identities(channel, external_id, customer_id, verified) VALUES (?, ?, ?, ?)').run(msg.channel, msg.userId, customerId, phone ? 1 : 0);
  return customerId;
}

export function ingest(db, msg) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM messages WHERE channel = ? AND external_id = ?').get(msg.channel, msg.messageId)) {
      db.exec('ROLLBACK');
      return null;
    }
    const customerId = customerFor(db, msg);
    let conv = db.prepare('SELECT * FROM conversations WHERE channel = ? AND external_user_id = ?').get(msg.channel, msg.userId);
    if (!conv) {
      const id = db.prepare('INSERT INTO conversations(customer_id, channel, external_user_id, created_at) VALUES (?, ?, ?, ?)').run(customerId, msg.channel, msg.userId, nowIso()).lastInsertRowid;
      conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    }
    const messageId = Number(db.prepare('INSERT INTO messages(conversation_id, channel, author, text, external_id, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(conv.id, msg.channel, 'customer', msg.text, msg.messageId, msg.sentAt).lastInsertRowid);
    if (!conv.last_inbound_at || msg.sentAt > conv.last_inbound_at) {
      db.prepare('UPDATE conversations SET last_inbound_at = ? WHERE id = ?').run(msg.sentAt, conv.id);
    }
    // Müşteri yeni mesaj yazdı: bekleyen eski taslaklar artık bu mesajı cevaplamıyor.
    db.prepare("UPDATE drafts SET status = 'superseded' WHERE conversation_id = ? AND status = 'pending'").run(conv.id);
    db.exec('COMMIT');
    return { conversationId: conv.id, messageId };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function latestCustomerMessageId(db, conversationId) {
  return db.prepare("SELECT id FROM messages WHERE conversation_id = ? AND author = 'customer' ORDER BY id DESC LIMIT 1").get(conversationId)?.id ?? null;
}

// Konuşma geçmişi → [{ role: 'user'|'assistant', content }]. Ardışık aynı roller birleşir.
// Son mesaj bizdense boş döner (cevaplanacak bir şey yok).
export function buildHistory(db, conversationId, limit = 40) {
  const rows = db.prepare('SELECT author, text FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?').all(conversationId, limit).reverse();
  const turns = [];
  for (const m of rows) {
    const role = m.author === 'customer' ? 'user' : 'assistant';
    if (turns.length && turns.at(-1).role === role) turns.at(-1).content += `\n${m.text}`;
    else turns.push({ role, content: m.text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns.length && turns.at(-1).role === 'user' ? turns : [];
}
