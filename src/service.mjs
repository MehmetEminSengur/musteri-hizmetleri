// İş kuralları: taslak üretme, onaylama, reddetme, insan devri, operatör mesajı.
import { nowIso } from './db/db.mjs';
import { latestCustomerMessageId } from './inbox.mjs';
import { enqueue } from './outbox.mjs';
import { runAgent } from './agent/agent.mjs';
import { PAYMENT_LINK_PLACEHOLDER } from './agent/tools.mjs';
import { autoSendIssues } from './agent/guards.mjs';

export class ConflictError extends Error {}

export async function generateDraft(ctx, conversationId) {
  const { db } = ctx;
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  if (!conv || conv.status === 'human') return null;
  const replyTo = latestCustomerMessageId(db, conversationId);
  if (!replyTo) return null;
  if (db.prepare('SELECT 1 FROM drafts WHERE conversation_id = ? AND reply_to_message_id = ?').get(conversationId, replyTo)) return null;

  const result = await runAgent({ ...ctx, conversationId });
  if (!result) return null;
  // Model çalışırken müşteri yeni mesaj yazdıysa bu taslak eskidir; yeni mesaj için ayrı taslak üretilir.
  if (latestCustomerMessageId(db, conversationId) !== replyTo) return null;
  if (db.prepare('SELECT status FROM conversations WHERE id = ?').get(conversationId).status === 'human') return null;

  const issues = autoSendIssues({ ...result, publicUrl: ctx.config.store.publicUrl, storeDomain: ctx.config.store.domain, maxPackages: ctx.config.limits.maxPackagesPerOrder });
  db.exec('BEGIN IMMEDIATE');
  try {
    const status = result.handoff ? 'handoff' : 'pending';
    const ins = db.prepare(`INSERT INTO drafts(conversation_id, reply_to_message_id, text, status, handoff_category, handoff_reason, actions_json, hold_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id, reply_to_message_id) DO NOTHING`)
      .run(conversationId, replyTo, result.text, status, result.handoff?.category ?? null, result.handoff?.reason ?? null, JSON.stringify(result.actions), issues.length ? issues.join('; ') : null, nowIso());
    if (result.handoff) db.prepare("UPDATE conversations SET status = 'human' WHERE id = ?").run(conversationId);
    db.exec('COMMIT');
    return ins.changes ? db.prepare('SELECT * FROM drafts WHERE id = ?').get(ins.lastInsertRowid) : null;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export async function approveDraft(ctx, draftId, editedText) {
  const { db, commerce } = ctx;
  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId);
  if (!draft) throw new ConflictError('taslak yok');
  if (!['pending', 'handoff'].includes(draft.status)) throw new ConflictError(`bu taslak onaylanamaz (durumu: ${draft.status})`);
  if (latestCustomerMessageId(db, draft.conversation_id) !== draft.reply_to_message_id) throw new ConflictError('müşteri bu taslaktan sonra yeni mesaj yazdı');

  let text = String(editedText ?? draft.text).trim();
  if (!text) throw new ConflictError('boş mesaj gönderilemez');

  // Taslağı önce "approved" yap: iki kez onaya basılırsa ikinci ödeme linki oluşmaz.
  const claimed = db.prepare("UPDATE drafts SET status = 'approved', decided_at = ? WHERE id = ? AND status IN ('pending','handoff')").run(nowIso(), draftId);
  if (claimed.changes !== 1) throw new ConflictError('taslak zaten işlendi');

  try {
    if (text.includes(PAYMENT_LINK_PLACEHOLDER)) {
      const action = JSON.parse(draft.actions_json).find((a) => a.type === 'payment_link');
      if (!action) throw new ConflictError('metinde ödeme linki yer tutucusu var ama taslakta ödeme isteği yok');
      const conv = db.prepare('SELECT customer_id FROM conversations WHERE id = ?').get(draft.conversation_id);
      const commerceId = db.prepare('SELECT commerce_id FROM customers WHERE id = ?').get(conv.customer_id)?.commerce_id;
      const link = await commerce.createPaymentLink(action.items, commerceId);
      text = text.split(PAYMENT_LINK_PLACEHOLDER).join(link);
    }
  } catch (err) {
    db.prepare("UPDATE drafts SET status = ?, decided_at = NULL WHERE id = ?").run(draft.status, draftId); // geri al
    throw err;
  }
  const author = editedText == null ? 'ai' : 'human';
  return enqueue(db, { conversationId: draft.conversation_id, text, author, key: `draft:${draftId}`, draftId });
}

export function rejectDraft(db, draftId) {
  const r = db.prepare("UPDATE drafts SET status = 'rejected', decided_at = ? WHERE id = ? AND status IN ('pending','handoff')").run(nowIso(), draftId);
  if (r.changes !== 1) throw new ConflictError('taslak reddedilemez');
}

export function setConversationStatus(db, conversationId, status) {
  if (!['ai', 'human'].includes(status)) throw new ConflictError('geçersiz durum');
  const r = db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, conversationId);
  if (r.changes !== 1) throw new ConflictError('konuşma yok');
}

export function manualMessage(db, conversationId, text, requestKey) {
  if (!db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(conversationId)) throw new ConflictError('konuşma yok');
  const clean = String(text || '').trim();
  if (!clean) throw new ConflictError('boş mesaj gönderilemez');
  if (!requestKey) throw new ConflictError('istek anahtarı gerekli');
  return enqueue(db, { conversationId, text: clean, author: 'human', key: `manual:${conversationId}:${requestKey}` });
}
