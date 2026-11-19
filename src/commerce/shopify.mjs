// Shopify Admin GraphQL: müşteri hizmetlerinin ihtiyaç duyduğu okuma işleri ve taslak sipariş.
// Bağlantı iki yoldan biri (config.json → store.auth):
//   cli (varsayılan): mağaza sahibi bir kez `node bin/musteri.mjs shopify-baglan` ile tarayıcıda onay
//      verir. Anahtarı Shopify CLI saklar ve yeniler; istekler `shopify store execute` ile gider.
//   app: .env'de SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (client_credentials, ~24 saatlik token)
//      ya da eski özel uygulamalar için SHOPIFY_ADMIN_TOKEN.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nowIso } from '../db/db.mjs';
import { runCli } from '../engines/run-cli.mjs';
import { toKurus, parsePaketIcerigi, normalizePhone } from '../money.mjs';

// Yalnız müşteri hizmetinin ihtiyacı: ürün/stok okuma, müşteri ve sipariş okuma, taslak sipariş.
// Ürün veya sipariş DEĞİŞTİRME izni istenmez.
export const SHOPIFY_SCOPES = 'read_products,read_inventory,read_customers,read_orders,write_draft_orders';

const GID = { variant: 'gid://shopify/ProductVariant/', product: 'gid://shopify/Product/', customer: 'gid://shopify/Customer/' };
const numeric = (gid) => String(gid).split('/').pop();

export function shopifyAuthMode(config) {
  if (config.store?.auth) return config.store.auth;
  const env = config.env || {};
  return env.SHOPIFY_ADMIN_TOKEN || env.SHOPIFY_CLIENT_ID ? 'app' : 'cli';
}

const clean = (s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[│╭╮╰╯─]/g, ' ').replace(/\s+/g, ' ').trim();
const NEEDS_LOGIN = /No stored app authentication|Token refresh failed|missing required scopes|Run `shopify store auth`/i;
const ACCESS_DENIED = /ACCESS_DENIED|access denied|not approved to access|protected customer data/i;

function transport(config, db, { fetchImpl = fetch, run = runCli } = {}) {
  const env = config.env;
  const domain = config.store.domain;
  const version = config.store.apiVersion || '2026-07';
  const adminBase = String(config.store.adminBaseUrl || `https://${domain}`).replace(/\/$/, ''); // adminBaseUrl yalnız testler için

  async function accessToken() {
    if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN;
    if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) throw new Error('.env içinde SHOPIFY_CLIENT_ID ve SHOPIFY_CLIENT_SECRET (ya da SHOPIFY_ADMIN_TOKEN) yok');
    const row = db.prepare("SELECT * FROM tokens WHERE provider = 'shopify'").get();
    if (row?.access_token && Date.parse(row.expires_at) - Date.now() > 5 * 60_000) return row.access_token;
    const res = await fetchImpl(`${adminBase}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Shopify anahtarı alınamadı (${res.status})`);
    const json = await res.json();
    const expiresAt = nowIso(Date.now() + (Number(json.expires_in) || 86_399) * 1000);
    db.prepare(`INSERT INTO tokens(provider, access_token, expires_at, updated_at) VALUES ('shopify', ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
      .run(json.access_token, expiresAt, nowIso());
    return json.access_token;
  }

  async function viaCli(query, variables) {
    const dir = mkdtempSync(path.join(tmpdir(), 'musteri-shopify-'));
    try {
      writeFileSync(path.join(dir, 'q.graphql'), query);
      writeFileSync(path.join(dir, 'v.json'), JSON.stringify(variables));
      const out = path.join(dir, 'out.json');
      await run('shopify', ['store', 'execute', '--store', domain, '--version', version, '--json', '--no-color',
        '--query-file', path.join(dir, 'q.graphql'), '--variable-file', path.join(dir, 'v.json'), '--output-file', out,
        ...(/^\s*mutation\b/.test(query) ? ['--allow-mutations'] : [])], { timeoutMs: 120_000 });
      return { data: JSON.parse(readFileSync(out, 'utf8')) };
    } catch (err) {
      const msg = clean(err.message);
      if (/THROTTLED/.test(msg)) return { throttled: true };
      if (/bulunamadı/.test(msg)) throw new Error('Shopify CLI kurulu değil: node bin/musteri.mjs shopify-baglan');
      if (NEEDS_LOGIN.test(msg)) throw new Error('Shopify bağlantısı yenilenmeli: node bin/musteri.mjs shopify-baglan');
      if (ACCESS_DENIED.test(msg)) throw new Error('Shopify müşteri/sipariş verisine erişim izni yok: docs/shopify.md → "Müşteri verisine erişim"');
      throw new Error(`shopify: ${msg.slice(-400)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const cli = shopifyAuthMode(config) === 'cli';

  return async function gql(query, variables = {}) {
    for (let attempt = 0; attempt < 5; attempt++) {
      let res;
      if (cli) {
        res = await viaCli(query, variables);
      } else {
        const r = await fetchImpl(`${adminBase}/admin/api/${version}/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': await accessToken(), 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(60_000),
        });
        if (r.status === 429 || r.status >= 500) res = { throttled: true };
        else {
          if (!r.ok) throw new Error(`shopify ${r.status}`);
          const json = await r.json();
          if (json.errors?.some((e) => e.extensions?.code === 'THROTTLED')) res = { throttled: true };
          else if (json.errors?.length) {
            const text = JSON.stringify(json.errors);
            if (ACCESS_DENIED.test(text)) throw new Error('Shopify müşteri/sipariş verisine erişim izni yok: docs/shopify.md → "Müşteri verisine erişim"');
            throw new Error(`shopify: ${text.slice(0, 400)}`);
          } else res = { data: json.data };
        }
      }
      if (res.throttled) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
      return res.data;
    }
    throw new Error('shopify: istek sınırı aşıldı, biraz sonra tekrar denenecek');
  };
}

const RECENT_ORDERS = 250;
const VARIANT = 'id title sku price inventoryQuantity availableForSale';
const PRODUCT = `id title handle onlineStoreUrl description descriptionHtml status variants(first: 30) { nodes { ${VARIANT} } }`;
const ORDER = `name createdAt displayFinancialStatus displayFulfillmentStatus phone email
  customer { id phone } shippingAddress { phone } billingAddress { phone }
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 20) { nodes { title quantity } }
  fulfillments(first: 5) { trackingInfo(first: 3) { company number url } }`;

// Ortak biçimler (diğer altyapılar da aynısını döndürmeli):
//   Variant { id, title, sku, priceKurus, available, stock }
//   Product { id, title, url, paketIcerigi, description, variants }
//   Order   { number, createdAt, financialStatus, fulfillmentStatus, totalKurus, items[], shipments[], phones[], email, customerId }
// Siparişteki telefon çoğu mağazada siparişin kendisinde değil teslimat/fatura adresindedir; hepsi toplanır.
export function createShopifyCommerce(config, db, opts = {}) {
  const gql = opts.gql || transport(config, db, opts);
  const publicBase = config.store.publicUrl;

  const variant = (n) => ({ id: numeric(n.id), title: n.title || '', sku: n.sku || null, priceKurus: toKurus(String(n.price)), available: Boolean(n.availableForSale), stock: n.inventoryQuantity ?? null });
  const product = (n) => ({
    id: numeric(n.id), title: n.title,
    url: n.onlineStoreUrl || `${publicBase}/products/${n.handle}`,
    paketIcerigi: parsePaketIcerigi(n.descriptionHtml || n.description, n.title),
    description: n.description || '',
    variants: n.variants.nodes.map(variant),
  });
  const order = (n) => ({
    number: n.name, createdAt: n.createdAt,
    financialStatus: n.displayFinancialStatus || null, fulfillmentStatus: n.displayFulfillmentStatus || null,
    totalKurus: toKurus(String(n.totalPriceSet.shopMoney.amount)),
    items: n.lineItems.nodes.map((li) => `${li.quantity} x ${li.title}`),
    shipments: (n.fulfillments || []).flatMap((f) => (f.trackingInfo || []).map((t) => ({ company: t.company || null, number: t.number || null, url: t.url || null }))),
    phones: [...new Set([n.phone, n.shippingAddress?.phone, n.billingAddress?.phone, n.customer?.phone].map(normalizePhone).filter(Boolean))],
    email: n.email ? n.email.toLowerCase() : null,
    customerId: n.customer?.id ? numeric(n.customer.id) : null,
  });

  return {
    name: 'shopify',
    async searchProducts(query, limit = 5) {
      const q = query.trim() ? `status:active AND (${query})` : 'status:active';
      const d = await gql(`query($q: String!, $n: Int!) { products(first: $n, query: $q) { nodes { ${PRODUCT} } } }`, { q, n: limit });
      return d.products.nodes.map(product);
    },
    async getProduct(id) {
      const d = await gql(`query($id: ID!) { product(id: $id) { ${PRODUCT} } }`, { id: GID.product + numeric(id) });
      return d.product ? product(d.product) : null;
    },
    async getVariant(id) {
      const d = await gql(`query($id: ID!) { productVariant(id: $id) { ${VARIANT} } }`, { id: GID.variant + numeric(id) });
      return d.productVariant ? variant(d.productVariant) : null;
    },
    async findCustomer({ phone, email }) {
      const q = phone ? `phone:+${normalizePhone(phone)}` : email ? `email:${email}` : null;
      if (!q) return null;
      const d = await gql('query($q: String!) { customers(first: 1, query: $q) { nodes { id displayName email phone } } }', { q });
      const n = d.customers.nodes[0];
      return n ? { id: numeric(n.id), name: n.displayName || null, email: n.email || null, phone: n.phone || null } : null;
    },
    // Telefon/e-postayla eşleşen siparişler (yeniden eskiye). Telefon adreslerde durduğu için son
    // RECENT_ORDERS sipariş içinde aranır; e-posta Shopify aramasıyla bulunur.
    async ordersByContact({ phone, email }, limit = 5) {
      const found = new Map();
      if (email) {
        const d = await gql(`query($q: String!) { orders(first: 20, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER} } } }`, { q: `email:${email}` });
        for (const n of d.orders.nodes) found.set(n.name, order(n));
      }
      const p = normalizePhone(phone);
      if (p) {
        const d = await gql(`query($n: Int!) { orders(first: $n, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER} } } }`, { n: RECENT_ORDERS });
        for (const n of d.orders.nodes) { const o = order(n); if (o.phones.includes(p)) found.set(o.number, o); }
      }
      return [...found.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    },
    async orderByNumber(number) {
      const name = String(number).trim().replace(/^#/, '');
      if (!/^[\w-]+$/.test(name)) return null;
      const d = await gql(`query($q: String!) { orders(first: 1, query: $q) { nodes { ${ORDER} } } }`, { q: `name:#${name}` });
      return d.orders.nodes[0] ? order(d.orders.nodes[0]) : null;
    },
    cartLink(items) {
      return `${publicBase}/cart/${items.map((i) => `${numeric(i.variantId)}:${Math.trunc(i.quantity)}`).join(',')}`;
    },
    async createPaymentLink(items, customerId) {
      const input = { lineItems: items.map((i) => ({ variantId: GID.variant + numeric(i.variantId), quantity: Math.trunc(i.quantity) })), tags: ['ai-musteri-hizmetleri'] };
      if (customerId) input.purchasingEntity = { customerId: GID.customer + numeric(customerId) };
      const d = await gql('mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } } }', { input });
      const r = d.draftOrderCreate;
      if (r.userErrors?.length) throw new Error(`taslak sipariş oluşturulamadı: ${r.userErrors.map((e) => e.message).join('; ')}`);
      return r.draftOrder.invoiceUrl;
    },
  };
}

export function createCommerce(config, db, opts) {
  if (config.store?.platform !== 'shopify') throw new Error('müşteri hizmetleri şimdilik yalnız Shopify mağazalarını destekliyor (config.json → store.platform: "shopify")');
  return createShopifyCommerce(config, db, opts);
}
