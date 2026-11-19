// Idempotent gönderim kuyruğu. Her gönderimin bir anahtarı vardır (ör. draft:42); aynı anahtar
// ikinci kez kuyruğa giremez. Sonucu belirsiz gönderim "unknown" olur ve otomatik tekrar
// gönderilmez: operatör kanaldan bakıp panelde işaretler.
import { nowIso } from './db/db.mjs';
import { SendError, SendUnknown } from './meta/graph.mjs';

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function enqueue(db, { conversationId, text, author, key, draftId = null }) {
  const now = nowIso();
  db.prepare(`INSERT INTO outbox(idempotency_key, conversation_id, draft_id, author, text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`).run(key, conversationId, draftId, author, text, now, now);
  return db.prepare('SELECT * FROM outbox WHERE idempotency_key = ?').get(key);
}

const setState = (db, id, fields) => {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE outbox SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), nowIso(), id);
};

export async function send(db, outboxId, sender, { now = Date.now() } = {}) {
  // pending → sending atomik: aynı kaydı iki işçi alamaz. "sending" kalıcı yazıldıktan sonra
  // gönderilir; süreç gönderim sırasında çökerse kayıt "sending" kalır ve açılışta "unknown" olur.
  const claimed = db.prepare("UPDATE outbox SET state = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = 'pending'").run(nowIso(), outboxId);
  if (claimed.changes !== 1) return db.prepare('SELECT * FROM outbox WHERE id = ?').get(outboxId);

  const item = db.prepare('SELECT * FROM outbox WHERE id = ?').get(outboxId);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(item.conversation_id);

  if (conv.channel === 'whatsapp' && (!conv.last_inbound_at || now - Date.parse(conv.last_inbound_at) > WHATSAPP_WINDOW_MS)) {
    setState(db, item.id, { state: 'blocked', error: 'WhatsApp 24 saat penceresi kapalı: müşterinin son mesajının üzerinden 24 saat geçti, serbest mesaj gönderilemez' });
    return db.prepare('SELECT * FROM outbox WHERE id = ?').get(outboxId);
  }

  try {
    const providerId = await sender.sendText({ channel: conv.channel, userId: conv.external_user_id }, item.text);
    db.exec('BEGIN IMMEDIATE');
    try {
      setState(db, item.id, { state: 'sent', provider_message_id: providerId || null, error: null });
      db.prepare('INSERT INTO messages(conversation_id, channel, author, text, external_id, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(conv.id, conv.channel, item.author, item.text, providerId || null, nowIso());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } catch (err) {
    if (err instanceof SendError) setState(db, item.id, { state: 'failed', error: err.message });
    else setState(db, item.id, { state: 'unknown', error: err instanceof SendUnknown ? err.message : `beklenmeyen hata: ${err.message}` });
  }
  return db.prepare('SELECT * FROM outbox WHERE id = ?').get(outboxId);
}

// Açılışta: önceki çalışmada gönderim sırasında kapanmış kayıtlar belirsizdir.
export function recoverOutbox(db) {
  return db.prepare("UPDATE outbox SET state = 'unknown', error = 'program gönderim sırasında kapandı; kanaldan kontrol edin', updated_at = ? WHERE state = 'sending'").run(nowIso()).changes;
}

export function resolveUnknown(db, outboxId, sent) {
  const item = db.prepare('SELECT * FROM outbox WHERE id = ?').get(outboxId);
  if (!item || item.state !== 'unknown') throw new Error('sadece belirsiz gönderimler işaretlenebilir');
  setState(db, item.id, { state: sent ? 'sent' : 'failed' });
  if (sent) {
    const conv = db.prepare('SELECT channel FROM conversations WHERE id = ?').get(item.conversation_id);
    db.prepare('INSERT INTO messages(conversation_id, channel, author, text, sent_at) VALUES (?, ?, ?, ?, ?)')
      .run(item.conversation_id, conv.channel, item.author, item.text, nowIso());
  }
}
