// Yapay zekâ motorlarının kısıtlı çalıştırılması ve Shopify adaptörü.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createEngines } from '../src/engines/text.mjs';
import { aiEnv } from '../src/engines/run-cli.mjs';
import { createShopifyCommerce } from '../src/commerce/shopify.mjs';
import { openDb } from '../src/db/db.mjs';
import { makeConfig } from './helpers.mjs';

test('codex: salt-okunur, ayarsız, tarayıcısız, sabit çalışma klasörü; anahtarlar ortama geçmez', async () => {
  const config = makeConfig();
  let seen;
  const run = async (cmd, args, opts) => {
    seen = { cmd, args, opts };
    writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ action: 'reply', tool: '', args_json: '{}', text: 'ok' }));
    return { stdout: '', stderr: '' };
  };
  process.env.META_ACCESS_TOKEN_TEST = 'gizli';
  const out = await createEngines(config, { run }).codex({ system: 's', prompt: 'p', schema: {} });
  assert.equal(out.text, 'ok');
  for (const f of ['--ephemeral', '--ignore-user-config', '--ignore-rules', 'computer_use', 'browser_use', 'apps']) assert.ok(seen.args.includes(f), f);
  assert.equal(seen.args[seen.args.indexOf('-s') + 1], 'read-only');
  assert.equal(seen.args[seen.args.indexOf('-C') + 1], path.join(config.dataDir, 'codex'));
  assert.ok(!('META_ACCESS_TOKEN_TEST' in seen.opts.env));
  assert.deepEqual(readdirSync(path.join(config.dataDir, 'codex', 'calls')), []);
  delete process.env.META_ACCESS_TOKEN_TEST;
});

test('claude: araçlar kapalı, oturum kaydedilmez', async () => {
  let args;
  const run = async (_c, a) => { args = a; return { stdout: JSON.stringify({ structured_output: { action: 'reply', text: 'ok' } }) }; };
  await createEngines(makeConfig(), { run }).claude({ system: 's', prompt: 'p', schema: {} });
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(args.includes('--no-session-persistence'));
});

test('yapay zekâya giden ortamda Meta ve Shopify anahtarı yok', () => {
  const env = aiEnv({ HOME: '/h', PATH: '/p', META_ACCESS_TOKEN: 'x', SHOPIFY_CLIENT_SECRET: 'y', CODEX_HOME: '/c', ANTHROPIC_API_KEY: 'z' });
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'CODEX_HOME', 'HOME', 'PATH']);
});

test('Shopify: fiyat kuruşa, link site adresine, taslak sipariş hatası iletilir', async () => {
  const calls = [];
  const gql = async (q, v) => {
    calls.push({ q, v });
    if (q.includes('draftOrderCreate')) return { draftOrderCreate: { draftOrder: null, userErrors: [{ message: 'stok yok' }] } };
    return { products: { nodes: [{ id: 'gid://shopify/Product/10', title: 'Kase', handle: 'kase', onlineStoreUrl: null, description: 'Paket içeriği: 50 adet', variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1001', title: '500 ml', sku: 'K', price: '141.90', inventoryQuantity: 3, availableForSale: true }] } }] } };
  };
  const c = createShopifyCommerce(makeConfig(), openDb(':memory:'), { gql });
  const [p] = await c.searchProducts('kase');
  assert.equal(p.url, 'https://ornek-magaza.com/products/kase');
  assert.equal(p.variants[0].priceKurus, 14190);
  assert.equal(p.paketIcerigi, '50 adet');
  assert.equal(calls[0].v.q, 'status:active AND (kase)');
  assert.equal(c.cartLink([{ variantId: '1001', quantity: 2 }]), 'https://ornek-magaza.com/cart/1001:2');
  await assert.rejects(c.createPaymentLink([{ variantId: '1001', quantity: 1 }]), /stok yok/);
  assert.equal(await c.orderByNumber('1042; DROP'), null); // sorgu enjeksiyonu yok
});

test('kurulum skill dosyası Codex/Antigravity ve Claude Code için aynı', () => {
  const a = readFileSync('.agents/skills/musteri-hizmetleri-kurulum/SKILL.md', 'utf8');
  const b = readFileSync('.claude/skills/musteri-hizmetleri-kurulum/SKILL.md', 'utf8');
  assert.equal(a, b);
  assert.match(a, /^---\nname: musteri-hizmetleri-kurulum\ndescription: /);
});
