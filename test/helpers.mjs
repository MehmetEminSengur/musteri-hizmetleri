import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULTS } from '../src/config.mjs';
import { openDb } from '../src/db/db.mjs';

export const APP_SECRET = 'test-secret';
export const WA_ID = '111';
export const PAGE_ID = '333';
export const IG_ID = '222';

export function makeConfig(over = {}) {
  const c = structuredClone(DEFAULTS);
  c.store = { ...c.store, domain: 'ornek.myshopify.com', publicUrl: 'https://ornek-magaza.com', brandName: 'Örnek Mağaza' };
  c.env = { META_APP_SECRET: APP_SECRET, META_APP_ID: 'app', META_ACCESS_TOKEN: 'tok', META_PAGE_ID: PAGE_ID, WHATSAPP_PHONE_NUMBER_ID: WA_ID };
  c.dataDir = mkdtempSync(path.join(tmpdir(), 'musteri-test-'));
  return { ...c, ...over };
}

export function fakeCommerce() {
  const variants = {
    1001: { id: '1001', title: '500 ml', sku: 'K500', priceKurus: 14190, available: true, stock: 12 },
    1002: { id: '1002', title: '1000 ml', sku: 'K1000', priceKurus: 19900, available: false, stock: 0 },
  };
  const product = { id: '10', title: 'Sızdırmaz Kase', url: 'https://ornek-magaza.com/products/kase', paketIcerigi: '50 adet kase + 50 adet kapak', description: 'Paket içeriği: 50 adet kase + 50 adet kapak', variants: Object.values(variants) };
  const orders = { 1042: { number: '#1042', createdAt: '2026-11-10T10:00:00Z', financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED', totalKurus: 28380, items: ['2 x Sızdırmaz Kase'], shipments: [{ company: 'Yurtiçi', number: 'ABC123', url: null }], phones: ['905551112233'], email: 'a@b.com', customerId: '77' } };
  return {
    name: 'fake', paymentLinks: [], searches: [],
    async searchProducts(q) { this.searches.push(q); return [product]; },
    async getProduct(id) { return id === '10' ? product : null; },
    async getVariant(id) { return variants[id] || null; },
    async findCustomer({ phone }) { return phone === '905551112233' ? { id: '77', name: 'Ayşe', email: 'a@b.com', phone: '+905551112233' } : null; },
    async ordersByContact({ phone, email }) { return Object.values(orders).filter((o) => o.phones.includes(phone) || (email && o.email === email)); },
    async orderByNumber(n) { return orders[String(n).replace('#', '')] || null; },
    cartLink(items) { return 'https://ornek-magaza.com/cart/' + items.map((i) => `${i.variantId}:${i.quantity}`).join(','); },
    async createPaymentLink(items, customerId) { this.paymentLinks.push({ items, customerId }); return `https://ornek-magaza.com/invoices/${this.paymentLinks.length}`; },
  };
}

export const tool = (name, args) => ({ action: 'tool', tool: name, args_json: JSON.stringify(args), text: '' });
export const reply = (text) => ({ action: 'reply', tool: '', args_json: '{}', text });

// Sırayla önceden yazılmış adımları döndüren motor; gelen istemleri kaydeder.
export function scriptedEngine(...steps) {
  return {
    name: 'scripted', prompts: [], steps,
    async generate({ prompt }) {
      this.prompts.push(prompt);
      const s = this.steps.shift();
      if (s instanceof Error) throw s;
      return s ?? { action: 'reply', tool: '', args_json: '{}', text: 'Merhaba, nasıl yardımcı olabilirim?' };
    },
  };
}

export function fakeSender(error) {
  return { sent: [], error, async sendText(target, text) { this.sent.push({ target, text }); if (this.error) throw this.error; return `wamid.${this.sent.length}`; } };
}

export function makeCtx(over = {}) {
  const config = over.config || makeConfig();
  return { config, db: openDb(':memory:'), log: () => {}, commerce: fakeCommerce(), engine: scriptedEngine(), ...over };
}

export const sign = (body) => 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');

export function waMsg({ text = 'kase fiyatı?', id = 'wamid.in1', phone = '905551112233', at = new Date().toISOString() } = {}) {
  return { channel: 'whatsapp', accountId: WA_ID, userId: phone, messageId: id, text, sentAt: at, userName: 'Ayşe', phone };
}

export function igMsg({ text = 'merhaba', id = 'mid.1', user = 'igsid_1', at = new Date().toISOString() } = {}) {
  return { channel: 'instagram', accountId: IG_ID, userId: user, messageId: id, text, sentAt: at, userName: null, phone: null };
}

export function waPayload({ text = 'kase fiyatı?', id = 'wamid.in1', phone = '905551112233', ts = Math.floor(Date.now() / 1000) } = {}) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: WA_ID },
    contacts: [{ wa_id: phone, profile: { name: 'Ayşe' } }],
    messages: [{ from: phone, id, timestamp: String(ts), type: 'text', text: { body: text } }],
  } }] }] };
}

export function igPayload({ text = 'fiyat?', mid = 'mid.1', sender = 'igsid_1', echo = false, ts = Date.now(), object = 'instagram', account = IG_ID } = {}) {
  return { object, entry: [{ id: account, time: ts, messaging: [{ sender: { id: sender }, recipient: { id: account }, timestamp: ts, message: { mid, text, ...(echo ? { is_echo: true } : {}) } }] }] };
}
