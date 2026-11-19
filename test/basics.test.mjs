// Para, webhook ayrıştırma, imza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toKurus, formatTl, parsePaketIcerigi, normalizePhone } from '../src/money.mjs';
import { parseWebhook, verifySignature } from '../src/meta/webhook.mjs';
import { APP_SECRET, IG_ID, PAGE_ID, WA_ID, sign, waPayload, igPayload } from './helpers.mjs';

test('fiyat kuruşa çevrilir ve TL olarak yazılır', () => {
  assert.equal(toKurus('141.90'), 14190);
  assert.equal(toKurus('141.9'), 14190);
  assert.equal(toKurus('141'), 14100);
  assert.equal(toKurus('0.005'), 1);
  assert.equal(formatTl(14190), '141,90 TL');
  assert.equal(formatTl(123450), '1.234,50 TL');
  assert.equal(formatTl(100000000), '1.000.000,00 TL');
});

test('sayı olarak gelen fiyat reddedilir (TL mi kuruş mu belli değil)', () => {
  assert.throws(() => toKurus(141.9), TypeError);
  assert.throws(() => formatTl(141.9), TypeError);
});

test('paket içeriği açıklamadan okunur', () => {
  assert.equal(parsePaketIcerigi('<p>Sızdırmaz kase.</p><p>Paket içeriği: 50 adet kase + 50 adet kapak.</p>'), '50 adet kase + 50 adet kapak');
  assert.equal(parsePaketIcerigi('paket icerigi: 100 adet'), '100 adet');
  assert.equal(parsePaketIcerigi('yok'), null);
});

test('paket içeriği HTML listesinden tek satır olarak okunur; yoksa ürün adından', () => {
  const html = '<ul>\n<li>Desen: Çizgili</li>\n<li>Paket içeriği: 100 adet kutu</li>\n<li>Dayanıklı yapı</li></ul><p>Kullanım Alanları ...</p>';
  assert.equal(parsePaketIcerigi(html), '100 adet kutu');
  assert.equal(parsePaketIcerigi('<p>Açıklama</p>', 'Islak Mendil 6 x 12 - 1000 Adet Koli'), '1000 Adet Koli (ürün adından)');
  assert.equal(parsePaketIcerigi('', "Çöp Torbası 65x80 - 10'lu Paket"), "10'lu Paket (ürün adından)");
  assert.equal(parsePaketIcerigi('', 'Sülfit Paketleme Kağıdı - 30x40 10Kg Paket'), null);
});

test('telefon numarası tek biçime getirilir', () => {
  for (const p of ['0555 111 22 33', '+90 555 111 22 33', '5551112233']) assert.equal(normalizePhone(p), '905551112233');
});

test('webhook imzası', () => {
  const body = Buffer.from('{"a":1}');
  assert.ok(verifySignature(APP_SECRET, body, sign(body)));
  assert.ok(!verifySignature(APP_SECRET, body, 'sha256=00'));
  assert.ok(!verifySignature(APP_SECRET, body, undefined));
  assert.ok(!verifySignature('', body, sign(body)));
});

test('WhatsApp metin mesajı; zaman saniye cinsinden', () => {
  const [m] = parseWebhook(waPayload({ ts: 1763550000 }));
  assert.deepEqual([m.channel, m.accountId, m.userId, m.phone, m.userName], ['whatsapp', WA_ID, '905551112233', '905551112233', 'Ayşe']);
  assert.equal(m.sentAt, '2025-11-19T11:00:00.000Z');
});

test('WhatsApp durum bildirimi mesaj sayılmaz', () => {
  assert.deepEqual(parseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: WA_ID }, statuses: [{ id: 'x', status: 'read' }] } }] }] }), []);
});

test('Instagram: echo ve kendi mesajımız atlanır; zaman milisaniye', () => {
  assert.deepEqual(parseWebhook(igPayload({ echo: true })), []);
  assert.deepEqual(parseWebhook(igPayload({ sender: IG_ID })), []);
  const [m] = parseWebhook(igPayload({ ts: 1763550000000 }));
  assert.equal(m.channel, 'instagram');
  assert.equal(m.phone, null);
  assert.equal(m.sentAt, '2025-11-19T11:00:00.000Z');
});

test('Messenger sayfa nesnesiyle gelir', () => {
  const [m] = parseWebhook(igPayload({ object: 'page', account: PAGE_ID }));
  assert.equal(m.channel, 'messenger');
});
