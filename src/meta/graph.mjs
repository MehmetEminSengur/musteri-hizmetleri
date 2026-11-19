// Meta Graph API: mesaj gönderme, sayfa anahtarı, webhook adresini kaydetme.
// Anahtarlar yalnız .env'den okunur; loglara ve hata mesajlarına yazılmaz.

export class SendError extends Error {}   // kesin reddedildi, mesaj gitmedi
export class SendUnknown extends Error {} // gidip gitmediği belli değil; körlemesine tekrar gönderilmez

const NOT_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

export function createGraph(config, { fetchImpl = fetch } = {}) {
  const env = config.env;
  const base = `https://graph.facebook.com/${config.meta.graphVersion}`;
  let pageToken = null;

  async function call(path, { method = 'GET', token = env.META_ACCESS_TOKEN, body, form } = {}) {
    const url = new URL(`${base}/${path}`);
    const init = { method, headers: {}, signal: AbortSignal.timeout(30_000) };
    if (form) {
      init.body = new URLSearchParams(form).toString();
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
    } else if (body) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    if (token) init.headers.authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      const code = err?.cause?.code || err?.code;
      if (NOT_CONNECTED.has(code)) throw new SendError(`Meta'ya bağlanılamadı (${code})`);
      throw new SendUnknown(`Meta isteği yarıda kaldı: ${err.name === 'TimeoutError' ? 'zaman aşımı' : code || err.message}`);
    }
    const text = await res.text();
    if (res.status >= 500) throw new SendUnknown(`Meta ${res.status}`);
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* düz metin */ }
    if (!res.ok) throw new SendError(`Meta ${res.status}: ${json?.error?.message || text.slice(0, 200)}`);
    return json;
  }

  // Instagram ve Messenger mesajları sayfa anahtarıyla gönderilir; sistem kullanıcısı anahtarından türetilir.
  async function getPageToken() {
    if (pageToken) return pageToken;
    const res = await call(`${env.META_PAGE_ID}?fields=access_token`);
    if (!res?.access_token) throw new SendError('sayfa anahtarı alınamadı: sistem kullanıcısına sayfa atanmış mı?');
    pageToken = res.access_token;
    return pageToken;
  }

  return {
    call,
    getPageToken,

    // target: { channel, userId } → sağlayıcının mesaj kimliği
    async sendText(target, text) {
      if (target.channel === 'whatsapp') {
        const res = await call(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: target.userId, type: 'text', text: { body: text, preview_url: true } },
        });
        return res?.messages?.[0]?.id || '';
      }
      const res = await call(`${env.META_PAGE_ID}/messages`, {
        method: 'POST',
        token: await getPageToken(),
        body: { recipient: { id: target.userId }, messaging_type: 'RESPONSE', message: { text } },
      });
      return res?.message_id || '';
    },

    // Sayfaya bağlı Instagram hesabının kimliği (webhook'larda bu kimlik gelir).
    async instagramAccountId() {
      const res = await call(`${env.META_PAGE_ID}?fields=instagram_business_account`);
      return res?.instagram_business_account?.id || null;
    },

    // Uygulamanın webhook adresini kaydeder. Meta hemen bu adrese doğrulama isteği gönderir.
    async registerWebhook({ callbackUrl, verifyToken, objects }) {
      const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
      for (const object of objects) {
        await call(`${env.META_APP_ID}/subscriptions`, {
          method: 'POST',
          token: null,
          form: { object, callback_url: callbackUrl, verify_token: verifyToken, fields: 'messages', include_values: 'true', access_token: appToken },
        });
      }
    },

    // Sayfayı ve WhatsApp hesabını uygulamaya abone eder (mesaj olayları uygulamaya gelsin).
    async subscribeAssets({ whatsapp, page }) {
      if (whatsapp) await call(`${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps`, { method: 'POST' });
      if (page) await call(`${env.META_PAGE_ID}/subscribed_apps`, { method: 'POST', token: await getPageToken(), form: { subscribed_fields: 'messages' } });
    },
  };
}
