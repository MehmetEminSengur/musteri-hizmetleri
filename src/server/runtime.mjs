// Çalışma anı: gelen mesajı kaydeder, taslak işlerini sıraya koyar, onaylananları gönderir.
// Taslaklar tek tek üretilir (aboneliğin istek sınırını zorlamamak için).
import { parseWebhook } from '../meta/webhook.mjs';
import { ingest, isOurAccount, latestCustomerMessageId } from '../inbox.mjs';
import { generateDraft, approveDraft } from '../service.mjs';
import { send } from '../outbox.mjs';

export function createRuntime(ctx, { accounts, sender }) {
  const { db, config, log } = ctx;
  const queue = new Set();
  let running = null;

  const self = {};
  async function drain() {
    while (queue.size) {
      const [id] = queue;
      queue.delete(id);
      try {
        const draft = await generateDraft(ctx, id);
        if (draft) {
          log('taslak', { conversation: id, draft: draft.id, status: draft.status, bekletme: draft.hold_reason || undefined });
          if (config.mode === 'auto' && draft.text && !draft.hold_reason) {
            // Otomatik mod: kapılardan geçen cevap (devirdeki bekleme mesajı dahil) hemen gönderilir.
            const item = await approveDraft(ctx, draft.id);
            await self.sendOutbox(item.id);
          }
        }
      } catch (err) {
        log('taslak_hatasi', { conversation: id, error: err.message });
      }
    }
    running = null;
  }

  function schedule(conversationId) {
    queue.add(conversationId);
    if (!running) running = drain();
    return running;
  }

  return Object.assign(self, {
    schedule,
    idle: () => running || Promise.resolve(),

    handleWebhook(payload) {
      const ids = new Set();
      for (const msg of parseWebhook(payload)) {
        if (!config.channels[msg.channel] || !isOurAccount(accounts, msg)) continue;
        const r = ingest(db, msg);
        if (r) ids.add(r.conversationId);
      }
      for (const id of ids) schedule(id);
      return ids.size;
    },

    async sendOutbox(outboxId) {
      const item = await send(db, outboxId, sender);
      log('gonderim', { outbox: outboxId, state: item.state });
      return item;
    },

    // Açılışta: cevapsız kalmış müşteri mesajları için taslak, bekleyen gönderimler için gönderim.
    async resume() {
      const convs = db.prepare("SELECT id FROM conversations WHERE status = 'ai'").all();
      for (const { id } of convs) {
        const last = latestCustomerMessageId(db, id);
        const lastAny = db.prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(id)?.id;
        if (last && last === lastAny && !db.prepare('SELECT 1 FROM drafts WHERE conversation_id = ? AND reply_to_message_id = ?').get(id, last)) schedule(id);
      }
      for (const { id } of db.prepare("SELECT id FROM outbox WHERE state = 'pending'").all()) await self.sendOutbox(id);
    },
  });
}
