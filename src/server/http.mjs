// İki yerel sunucu, ikisi de yalnız 127.0.0.1'de dinler:
//   webhook (tünel buna bağlanır): Meta'nın doğrulama ve mesaj istekleri. İmzasız istek reddedilir.
//   panel (yalnız bu bilgisayardan): onay ekranı ve API'si. Tünel panele bağlanmaz.
// Panel API'si her açılışta üretilen gizli anahtar ister ve Host başlığını denetler: başka bir web
// sitesi tarayıcı üzerinden panele istek gönderip mesaj yollayamaz.
import { verifySignature } from '../meta/webhook.mjs';
import { approveDraft, rejectDraft, setConversationStatus, manualMessage, ConflictError } from '../service.mjs';
import { addNote, notesOf } from '../customers.mjs';
import { resolveUnknown } from '../outbox.mjs';
import { panelHtml } from './panel-html.mjs';

const MAX_BODY = 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('istek çok büyük')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

export function webhookHandler({ config, verifyToken, runtime, log }) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/webhook') return json(res, 404, { error: 'yok' });
    if (req.method === 'GET') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && verifyToken && url.searchParams.get('hub.verify_token') === verifyToken;
      if (!ok) return json(res, 403, { error: 'doğrulama başarısız' });
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(url.searchParams.get('hub.challenge') || '');
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'yöntem desteklenmiyor' });
    let body;
    try { body = await readBody(req); } catch { return json(res, 413, { error: 'istek çok büyük' }); }
    if (!verifySignature(config.env.META_APP_SECRET, body, req.headers['x-hub-signature-256'])) {
      log('webhook_imza_hatasi', {});
      return json(res, 401, { error: 'imza geçersiz' });
    }
    let payload;
    try { payload = JSON.parse(body.toString('utf8')); } catch { return json(res, 400, { error: 'json değil' }); }
    try {
      runtime.handleWebhook(payload);
    } catch (err) {
      log('webhook_hatasi', { error: err.message });
      return json(res, 500, { error: 'kaydedilemedi' }); // Meta tekrar dener
    }
    return json(res, 200, { ok: true });
  };
}

function conversationView(db, id) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conv) return null;
  const customer = db.prepare('SELECT id, name, phone, email, created_at FROM customers WHERE id = ?').get(conv.customer_id);
  return {
    ...conv,
    customer: {
      ...customer,
      channels: db.prepare('SELECT channel, verified FROM identities WHERE customer_id = ?').all(customer.id),
      notes: notesOf(db, customer.id),
    },
    messages: db.prepare('SELECT id, author, text, sent_at FROM messages WHERE conversation_id = ? ORDER BY id').all(id),
    drafts: db.prepare('SELECT * FROM drafts WHERE conversation_id = ? ORDER BY id').all(id),
    outbox: db.prepare("SELECT id, state, error, text FROM outbox WHERE conversation_id = ? AND state IN ('unknown','failed','blocked') ORDER BY id").all(id),
  };
}

export function panelHandler(ctx, { runtime, panelToken, port }) {
  const { db } = ctx;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return async (req, res) => {
    if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: 'bu panel yalnız bu bilgisayardan açılır' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'" });
      return res.end(panelHtml({ token: panelToken, brand: ctx.config.store.brandName }));
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'yok' });
    if (req.headers['x-panel-token'] !== panelToken) return json(res, 401, { error: 'panel anahtarı geçersiz; sayfayı yenileyin' });

    let body = {};
    if (req.method === 'POST') {
      try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return json(res, 400, { error: 'json değil' }); }
    }
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const id = Number(parts[2]);
    try {
      if (req.method === 'GET' && parts[1] === 'ozet') {
        const rows = db.prepare(`SELECT d.id draft_id, d.status, d.text, d.handoff_category, d.created_at, c.id conversation_id, c.channel, cu.name,
            (SELECT text FROM messages m WHERE m.id = d.reply_to_message_id) last_message
          FROM drafts d JOIN conversations c ON c.id = d.conversation_id JOIN customers cu ON cu.id = c.customer_id
          WHERE d.status IN ('pending','handoff') ORDER BY d.id`).all();
        const outbox = db.prepare("SELECT o.id, o.state, o.error, o.text, o.conversation_id, c.channel FROM outbox o JOIN conversations c ON c.id = o.conversation_id WHERE o.state IN ('unknown','failed','blocked') ORDER BY o.id DESC LIMIT 50").all();
        return json(res, 200, { taslaklar: rows, gonderimler: outbox });
      }
      if (req.method === 'GET' && parts[1] === 'konusma') {
        const view = conversationView(db, id);
        return view ? json(res, 200, view) : json(res, 404, { error: 'konuşma yok' });
      }
      if (req.method === 'POST' && parts[1] === 'taslak' && parts[3] === 'onayla') {
        const item = await approveDraft(ctx, id, typeof body.text === 'string' ? body.text : undefined);
        const sent = await runtime.sendOutbox(item.id);
        return json(res, 200, { gonderim: sent.state, hata: sent.error });
      }
      if (req.method === 'POST' && parts[1] === 'taslak' && parts[3] === 'reddet') {
        rejectDraft(db, id);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && parts[1] === 'konusma' && ['devral', 'birak'].includes(parts[3])) {
        setConversationStatus(db, id, parts[3] === 'devral' ? 'human' : 'ai');
        if (parts[3] === 'birak') runtime.schedule(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && parts[1] === 'konusma' && parts[3] === 'gonder') {
        const item = manualMessage(db, id, body.text, body.requestKey);
        const sent = await runtime.sendOutbox(item.id);
        return json(res, 200, { gonderim: sent.state, hata: sent.error });
      }
      if (req.method === 'POST' && parts[1] === 'musteri' && parts[3] === 'not') {
        const note = addNote(db, id, body.text, 'human');
        return json(res, 200, { ok: Boolean(note) });
      }
      if (req.method === 'POST' && parts[1] === 'not' && parts[3] === 'sil') {
        db.prepare('DELETE FROM customer_notes WHERE id = ?').run(id);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && parts[1] === 'gonderim' && parts[3] === 'isaretle') {
        resolveUnknown(db, id, Boolean(body.sent));
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'yok' });
    } catch (err) {
      if (err instanceof ConflictError || /yalnız belirsiz|sadece belirsiz/.test(err.message)) return json(res, 409, { error: err.message });
      ctx.log('panel_hatasi', { path: url.pathname, error: err.message });
      return json(res, 500, { error: err.message });
    }
  };
}
