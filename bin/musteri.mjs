#!/usr/bin/env node
// musteri-hizmetleri — WhatsApp, Instagram ve Messenger mesajlarına mağaza bilgisiyle cevap yazan yerel sistem.
// Komutlar için: node bin/musteri.mjs yardim
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { openDb, getMeta, setMeta } from '../src/db/db.mjs';
import { createContext } from '../src/core.mjs';
import { createCommerce, SHOPIFY_SCOPES, shopifyAuthMode } from '../src/commerce/shopify.mjs';
import { probeEngine } from '../src/engines/text.mjs';
import { createGraph } from '../src/meta/graph.mjs';
import { recoverOutbox } from '../src/outbox.mjs';
import { createRuntime } from '../src/server/runtime.mjs';
import { webhookHandler, panelHandler } from '../src/server/http.mjs';
import { startTunnel } from '../src/server/tunnel.mjs';
import { installAutostart, removeAutostart } from '../src/autostart.mjs';
import { ingest } from '../src/inbox.mjs';
import { generateDraft } from '../src/service.mjs';
import { sampleCommerce } from '../src/sample.mjs';
import { setEnvValue, readHidden, ENV_KEYS } from '../src/env-file.mjs';

const HELP = `Kullanım: node bin/musteri.mjs <komut>

Kurulum
  kontrol                   Ayarları, yapay zekâ motorunu, Shopify ve Meta bağlantısını sınar
  anahtar <AD>              .env dosyasına bir anahtar yazar; değer ekranda görünmeden yapıştırılır
                            (ör. anahtar META_APP_SECRET)
  shopify-baglan            Shopify'a bağlanır: tarayıcıda tek onay (bir kez)
  deneme "mesaj" [--ornek]  Bir müşteri mesajına cevap taslağı üretir; kimseye bir şey göndermez.
                            --ornek: mağazaya bağlanmadan örnek ürünle dener
  otomatik-baslat-kur       Bilgisayar açılınca sistemi kendiliğinden başlatır
  otomatik-baslat-kaldir    Otomatik başlatmayı kaldırır

Çalıştırma
  calistir                  Mesajları dinler, cevap yazar, paneli açar (Ctrl+C ile durur)
  durum                     Bekleyen taslak, devredilen konuşma ve gönderim sayıları
`;

const [cmd = 'yardim', ...rest] = process.argv.slice(2);
const flag = (f) => rest.includes(f);
const ok = (t) => console.log(`  ✓ ${t}`);
const bad = (t, fix) => console.log(`  ✗ ${t}${fix ? `\n      → ${fix}` : ''}`);

function requireConfig(config) {
  if (!config.configured) throw new Error('config.json yok. Kurulum için ajanınıza "müşteri hizmetlerini kur" deyin ya da README.md → Kurulum.');
}

function metaAccounts(config) {
  return { whatsapp: config.env.WHATSAPP_PHONE_NUMBER_ID, messenger: config.env.META_PAGE_ID, instagram: null };
}

const REQUIRED_ENV = {
  always: ['META_APP_ID', 'META_APP_SECRET', 'META_ACCESS_TOKEN'],
  whatsapp: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID'],
  instagram: ['META_PAGE_ID'],
  messenger: ['META_PAGE_ID'],
};

function missingEnv(config) {
  const keys = new Set(REQUIRED_ENV.always);
  for (const ch of ['whatsapp', 'instagram', 'messenger']) if (config.channels[ch]) REQUIRED_ENV[ch].forEach((k) => keys.add(k));
  return [...keys].filter((k) => !config.env[k]);
}

async function kontrol() {
  const config = loadConfig();
  console.log('Müşteri hizmetleri kontrolü\n');
  const [maj, min] = process.versions.node.split('.').map(Number);
  (maj > 22 || (maj === 22 && min >= 13)) ? ok(`Node.js ${process.versions.node}`) : bad(`Node.js ${process.versions.node} eski`, 'nodejs.org adresinden LTS sürümünü kurun (22.13 veya üstü)');
  if (!config.configured) return bad('config.json yok', 'cp config.example.json config.json ve mağaza bilgilerini yazın');
  ok(`Ayarlar: ${config.store.brandName || '(marka adı yok)'} · ${config.store.publicUrl} · mod: ${config.mode === 'auto' ? 'otomatik' : 'onaylı'}`);
  if (!config.store.brandName) bad('config.json → store.brandName boş', 'marka adını yazın; AI kendini bu adla tanıtır');

  const engine = config.engines.text;
  const v = await probeEngine(engine);
  v ? ok(`Yapay zekâ motoru: ${engine} (${v})`) : bad(`Yapay zekâ motoru bulunamadı: ${engine}`, { codex: 'npm i -g @openai/codex ve codex login', claude: 'Claude Code kurun ve claude ile oturum açın', gemini: 'npm i -g @google/gemini-cli' }[engine]);

  const db = openDb(config.dataDir);
  try {
    const commerce = createCommerce(config, db);
    const products = await commerce.searchProducts('', 1);
    ok(`Shopify ürünleri okunuyor (${shopifyAuthMode(config) === 'cli' ? 'Shopify CLI bağlantısı' : 'uygulama anahtarı'})${products[0] ? `: örnek "${products[0].title}"` : ''}`);
    if (products[0] && !products[0].paketIcerigi) bad(`"${products[0].title}" açıklamasında "Paket içeriği:" satırı yok`, 'AI paket içeriğini uydurmaz, "bilinmiyor" der. docs/shopify.md → "Paket içeriği"');
    await commerce.findCustomer({ phone: '900000000000' });
    ok('Shopify müşteri ve sipariş verisi okunabiliyor');
  } catch (err) {
    bad(`Shopify: ${err.message}`, 'node bin/musteri.mjs shopify-baglan · docs/shopify.md');
  }

  const missing = missingEnv(config);
  if (missing.length) return bad(`.env içinde eksik: ${missing.join(', ')}`, 'docs/meta-kurulum.md adımlarıyla değerleri alıp .env dosyasına kendiniz yazın');
  const graph = createGraph(config);
  try {
    await graph.call('me?fields=id');
    ok('Meta erişim anahtarı geçerli');
  } catch (err) { bad(`Meta erişim anahtarı: ${err.message}`, 'docs/meta-kurulum.md → Adım 4'); }
  if (config.channels.whatsapp) {
    try {
      const r = await graph.call(`${config.env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`);
      ok(`WhatsApp numarası: ${r.display_phone_number} (${r.verified_name})`);
    } catch (err) { bad(`WhatsApp numarası okunamadı: ${err.message}`, 'docs/meta-kurulum.md → Adım 2'); }
  }
  if (config.channels.messenger || config.channels.instagram) {
    try {
      await graph.getPageToken();
      ok('Facebook sayfasına erişim var');
      if (config.channels.instagram) {
        const ig = await graph.instagramAccountId();
        ig ? ok(`Instagram hesabı sayfaya bağlı (${ig})`) : bad('Sayfaya bağlı Instagram hesabı yok', 'docs/meta-kurulum.md → Adım 3');
      }
    } catch (err) { bad(`Facebook sayfası: ${err.message}`, 'docs/meta-kurulum.md → Adım 4 (sistem kullanıcısına sayfa atanmalı)'); }
  }
  try {
    const subs = (await graph.subscriptions()).filter((x) => ['whatsapp_business_account', 'instagram', 'page'].includes(x.object) && x.callback_url);
    const foreign = subs.filter((x) => !/\.trycloudflare\.com\//.test(x.callback_url) && !(config.server.publicUrl && x.callback_url.startsWith(config.server.publicUrl)));
    if (foreign.length && config.server.overrideWebhook !== true) bad(`Uygulamanın webhook'u başka bir sisteme gidiyor: ${foreign.map((x) => `${x.object} → ${new URL(x.callback_url).host}`).join(', ')}`, 'calistir bu adresin üzerine yazmaz. Ayrı bir Meta uygulaması kullanın ya da bilerek devralmak için config.json → server.overrideWebhook: true');
    else ok('Uygulamanın webhook ayarı bu sisteme bırakılabilir');
  } catch (err) { bad(`Uygulamanın webhook ayarları okunamadı: ${err.message}`, 'META_APP_ID ve META_APP_SECRET doğru mu?'); }
  if (!config.server.publicUrl) {
    (await probeEngine('cloudflared')) ? ok('cloudflared kurulu (mesajlar bu tünelle gelir)') : bad('cloudflared kurulu değil', 'macOS: brew install cloudflared · Windows: winget install --id Cloudflare.cloudflared');
  }
}

async function deneme() {
  const text = rest.filter((x) => !x.startsWith('--')).join(' ') || 'Merhaba, fiyat bilgisi alabilir miyim?';
  const config = loadConfig();
  if (!config.configured && !flag('--ornek')) throw new Error('config.json yok; mağazaya bağlanmadan denemek için --ornek ekleyin');
  if (!config.store.brandName) config.store.brandName = 'Örnek Mağaza';
  if (!config.store.publicUrl) config.store.publicUrl = 'https://ornek-magaza.com';
  const db = openDb(':memory:');
  const ctx = createContext({ config, db, commerce: flag('--ornek') ? sampleCommerce(config.store.publicUrl) : undefined, quiet: true });
  const r = ingest(db, { channel: 'whatsapp', accountId: 'deneme', userId: '905000000000', messageId: `deneme-${Date.now()}`, text, sentAt: new Date().toISOString(), userName: 'Deneme Müşteri', phone: '905000000000' });
  console.log(`Motor: ${ctx.engine.name} · Mağaza: ${ctx.commerce.name}\nMüşteri: ${text}\n`);
  const started = Date.now();
  const d = await generateDraft(ctx, r.conversationId);
  console.log(`Cevap (${((Date.now() - started) / 1000).toFixed(1)} sn):\n${d.text || '(boş)'}\n`);
  if (d.status === 'handoff') console.log(`İnsana devredildi: ${d.handoff_category} — ${d.handoff_reason}`);
  console.log(d.hold_reason ? `Otomatik modda GÖNDERİLMEZ, onayınıza düşer: ${d.hold_reason}` : 'Otomatik modda kontrollerden geçer ve gönderilir.');
  console.log('Bu bir denemeydi; kimseye mesaj gönderilmedi.');
}

function listen(handler, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', (err) => reject(err.code === 'EADDRINUSE' ? new Error(`${port} portu kullanımda: sistem zaten çalışıyor olabilir (config.json → server)`) : err));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function calistir() {
  const config = loadConfig();
  requireConfig(config);
  const missing = missingEnv(config);
  if (missing.length) throw new Error(`.env içinde eksik: ${missing.join(', ')} (docs/meta-kurulum.md)`);
  const ctx = createContext({ config });
  const { db, log } = ctx;
  const graph = createGraph(config);
  const accounts = metaAccounts(config);
  if (config.channels.instagram) accounts.instagram = await graph.instagramAccountId();

  const recovered = recoverOutbox(db);
  if (recovered) log('belirsiz_gonderim', { adet: recovered });
  let verifyToken = getMeta(db, 'verify_token');
  if (!verifyToken) { verifyToken = randomBytes(24).toString('hex'); setMeta(db, 'verify_token', verifyToken); }
  const panelToken = randomBytes(24).toString('hex');

  const runtime = createRuntime(ctx, { accounts, sender: graph });
  await listen(webhookHandler({ config, verifyToken, runtime, log }), config.server.webhookPort);
  await listen(panelHandler(ctx, { runtime, panelToken, port: config.server.panelPort }), config.server.panelPort);
  const panelUrl = `http://127.0.0.1:${config.server.panelPort}`;

  const objects = [config.channels.whatsapp && 'whatsapp_business_account', config.channels.instagram && 'instagram', config.channels.messenger && 'page'].filter(Boolean);
  async function connect(publicBase) {
    // Önceki çalışmaların tünel adresleri bizimdir; üzerine yazılabilir.
    const ownUrl = (u) => /\.trycloudflare\.com\//.test(u) || (config.server.publicUrl && u.startsWith(config.server.publicUrl));
    await graph.registerWebhook({ callbackUrl: `${publicBase}/webhook`, verifyToken, objects, ownUrl, override: config.server.overrideWebhook === true });
    await graph.subscribeAssets({ whatsapp: config.channels.whatsapp, page: config.channels.instagram || config.channels.messenger });
    log('webhook_kayitli', { adres: publicBase });
  }

  let stopping = false;
  let tunnel = null;
  if (config.server.publicUrl) {
    await connect(config.server.publicUrl.replace(/\/$/, ''));
  } else {
    // Tünel düşerse yeniden açılır ve yeni adres Meta'ya bildirilir. Arada gelen mesajları Meta tekrar dener.
    (async function supervise() {
      for (let attempt = 0; !stopping; attempt++) {
        try {
          tunnel = await startTunnel(config.server.webhookPort);
          await connect(tunnel.url);
          attempt = 0;
          await tunnel.closed;
          if (!stopping) log('tunel_koptu', {});
        } catch (err) {
          log('tunel_hatasi', { error: err.message });
          tunnel?.stop();
        }
        if (!stopping) await new Promise((r) => setTimeout(r, Math.min(60_000, 5_000 * (attempt + 1))));
      }
    })();
  }

  await runtime.resume();
  console.log(`\nMüşteri hizmetleri çalışıyor (${config.mode === 'auto' ? 'OTOMATİK mod: kontrollerden geçen cevaplar hemen gider' : 'ONAYLI mod: cevaplar panelde onayınızı bekler'}).\nPanel: ${panelUrl}\nDurdurmak için Ctrl+C.\n`);
  if (process.stdout.isTTY && !flag('--panel-acma')) {
    spawnSync(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [panelUrl], { stdio: 'ignore' });
  }
  const shutdown = () => { stopping = true; tunnel?.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function durum() {
  const config = loadConfig();
  const db = openDb(config.dataDir);
  const q = (sql) => db.prepare(sql).get().n;
  console.log(JSON.stringify({
    onay_bekleyen: q("SELECT count(*) n FROM drafts WHERE status = 'pending'"),
    size_devredilen: q("SELECT count(*) n FROM drafts WHERE status = 'handoff'"),
    belirsiz_gonderim: q("SELECT count(*) n FROM outbox WHERE state = 'unknown'"),
    gonderilen: q("SELECT count(*) n FROM outbox WHERE state = 'sent'"),
    musteri: q('SELECT count(*) n FROM customers'),
    mod: config.mode,
  }, null, 2));
}

function shopifyBaglan() {
  const config = loadConfig();
  requireConfig(config);
  const shell = process.platform === 'win32';
  if (!/\.myshopify\.com$/.test(config.store.domain)) throw new Error('config.json → store.domain mağazanın xxx.myshopify.com adresi olmalı (Shopify admin → Ayarlar → Alan adları)');
  if (spawnSync('shopify', ['version'], { shell }).status !== 0) {
    console.log('Shopify CLI kuruluyor (bir kez, 1-2 dakika)...');
    const r = spawnSync('npm', ['install', '-g', '@shopify/cli@4'], { stdio: 'inherit', shell });
    if (r.status !== 0) throw new Error('Shopify CLI kurulamadı. Elle kurun: npm install -g @shopify/cli@4');
  }
  console.log('\nTarayıcıda Shopify açılacak. Mağaza sahibi hesabıyla girip "Yükle"ye basın.\nİstenen izinler: ürün ve stok okuma, müşteri ve sipariş okuma, taslak sipariş oluşturma.\n');
  const r = spawnSync('shopify', ['store', 'auth', '--store', config.store.domain, '--scopes', SHOPIFY_SCOPES], { stdio: 'inherit', shell });
  if (r.status !== 0) throw new Error('Shopify bağlantısı tamamlanmadı; komutu tekrar çalıştırın.');
  console.log('Shopify bağlantısı kuruldu. Kontrol: node bin/musteri.mjs kontrol');
}

async function anahtar() {
  const key = rest[0];
  if (!key) throw new Error(`hangi anahtar? ör. node bin/musteri.mjs anahtar META_APP_SECRET\nGeçerli olanlar: ${ENV_KEYS.join(', ')}`);
  const config = loadConfig();
  const value = await readHidden(`${key} değerini yapıştırıp Enter'a basın (ekranda görünmez): `);
  if (!value) throw new Error('boş değer girildi, hiçbir şey yazılmadı');
  setEnvValue(config.root, key, value);
  console.log(`✓ ${key} .env dosyasına yazıldı (${value.length} karakter).`);
}

const commands = {
  yardim: () => console.log(HELP), help: () => console.log(HELP), '--help': () => console.log(HELP),
  kontrol, deneme, calistir, durum, anahtar, 'shopify-baglan': shopifyBaglan,
  'otomatik-baslat-kur': () => console.log(installAutostart({ dryRun: flag('--goster') })),
  'otomatik-baslat-kaldir': () => console.log(removeAutostart()),
};

const run = commands[cmd];
if (!run) { console.log(HELP); process.exitCode = 2; } else {
  Promise.resolve().then(run).catch((err) => { console.error(`Hata: ${err.message}`); process.exitCode = 1; });
}
