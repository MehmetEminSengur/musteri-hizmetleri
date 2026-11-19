// Meta webhook'ları: WhatsApp Cloud API, Instagram DM, Facebook Messenger.
// Daha önce yaşanmış hatalardan gelen kurallar:
// - Echo: sistemin kendi gönderdiği mesaj webhook'la geri gelir (is_echo). İşlenmez.
// - Instagram'da webhook'taki hesap kimliği (IG hesabı) ile cevabın gönderildiği uç (Facebook
//   sayfası) farklıdır.
// - Zaman WhatsApp'ta saniye, Instagram/Messenger'da milisaniyedir.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(appSecret, rawBody, header) {
  if (!appSecret || !header || !String(header).startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(String(header).slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const fromSeconds = (s) => new Date(Number(s) * 1000).toISOString();
const fromMillis = (ms) => new Date(Number(ms)).toISOString();

const PLACEHOLDER = {
  image: '[müşteri bir görsel gönderdi]',
  audio: '[müşteri bir ses kaydı gönderdi]',
  video: '[müşteri bir video gönderdi]',
  document: '[müşteri bir dosya gönderdi]',
  sticker: '[müşteri bir çıkartma gönderdi]',
  location: '[müşteri bir konum gönderdi]',
};

// Dönen her mesaj: { channel, accountId, userId, messageId, text, sentAt, userName?, phone? }
export function parseWebhook(payload) {
  const out = [];
  if (payload?.object === 'whatsapp_business_account') {
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        const accountId = v.metadata?.phone_number_id;
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
        for (const m of v.messages || []) {
          let text;
          if (m.type === 'text') text = m.text?.body ?? '';
          else if (m.type === 'button') text = m.button?.text ?? '';
          else if (m.type === 'interactive') text = (m.interactive?.button_reply || m.interactive?.list_reply || {}).title ?? '';
          else {
            text = PLACEHOLDER[m.type] || `[desteklenmeyen mesaj türü: ${m.type}]`;
            const caption = m[m.type]?.caption;
            if (caption) text += ` Açıklama: ${caption}`;
          }
          out.push({ channel: 'whatsapp', accountId, userId: m.from, messageId: m.id, text, sentAt: fromSeconds(m.timestamp), userName: names[m.from] || null, phone: m.from });
        }
        // v.statuses (gönderildi/iletildi/okundu) gönderim makbuzudur; burada atlanır.
      }
    }
  } else if (payload?.object === 'instagram' || payload?.object === 'page') {
    const channel = payload.object === 'instagram' ? 'instagram' : 'messenger';
    for (const entry of payload.entry || []) {
      const accountId = String(entry.id);
      for (const ev of entry.messaging || []) {
        const msg = ev.message;
        if (!msg || msg.is_echo || msg.is_deleted) continue;
        const sender = String(ev.sender?.id);
        if (sender === accountId) continue; // kendi hesabımızdan giden
        let text = msg.text;
        if (text == null) {
          const kind = msg.attachments?.[0]?.type;
          text = PLACEHOLDER[kind] || '[müşteri ek gönderdi]';
        }
        out.push({ channel, accountId, userId: sender, messageId: msg.mid, text, sentAt: fromMillis(ev.timestamp || 0), userName: null, phone: null });
      }
    }
  }
  return out;
}
