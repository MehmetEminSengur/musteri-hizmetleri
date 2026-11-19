// Yapay zekânın araçları. Model hiçbir zaman müşteri kimliği, hesap veya alıcı seçmez: bunlar
// konuşmadan gelir. Model yalnız ürün sorgusu, varyant ve adet seçer; her şey burada doğrulanır.
import { formatTl, normalizePhone } from '../money.mjs';
import { addNote, commerceCustomerId, isVerified, linkVerifiedContact } from '../customers.mjs';

export const PAYMENT_LINK_PLACEHOLDER = '{ODEME_LINKI}';
export const HANDOFF_CATEGORIES = ['toptan', 'sikayet_iade', 'ozel_fiyat', 'kapida_odeme', 'emin_degilim', 'diger'];

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const ITEMS = { type: 'array', description: 'Kalemler. Adet = paket sayısı.', items: obj({ varyant_id: { type: 'string' }, adet: { type: 'integer' } }) };

export const TOOLS = [
  { name: 'urun_ara', description: "Mağazada ürün arar. Kısa Türkçe sorgu ver (ör. 'sızdırmaz kase 500 ml'). Fiyat, stok, paket içeriği ve link döner.", schema: obj({ sorgu: { type: 'string' } }) },
  { name: 'urun_detay', description: 'Tek bir ürünün açıklamasını, varyantlarını, fiyatını ve stok durumunu getirir.', schema: obj({ urun_id: { type: 'string' } }) },
  { name: 'musteri_siparisleri', description: 'Bu konuşmadaki müşterinin son siparişlerini ve kargo takibini getirir. Yalnız kimliği doğrulanmış müşteride çalışır.', schema: obj({}) },
  { name: 'siparis_sorgula', description: 'Sipariş numarasıyla durum ve kargo takibini getirir. Güvenlik için müşterinin siparişte kullandığı telefon veya e-posta da gerekir.', schema: obj({ siparis_no: { type: 'string' }, telefon_veya_eposta: { type: 'string' } }) },
  { name: 'sepet_linki', description: 'Seçilen ürünlerle hazır doldurulmuş sepet linki oluşturur.', schema: obj({ kalemler: ITEMS }) },
  { name: 'odeme_linki', description: `Müşteri siteden alışverişte zorlanırsa kullanılır. Ekip onaylayınca taslak sipariş ve ödeme linki oluşturulur. Cevabına dönen yer tutucuyu (${PAYMENT_LINK_PLACEHOLDER}) aynen koy.`, schema: obj({ kalemler: ITEMS }) },
  { name: 'musteri_notu_kaydet', description: "Müşteri hakkında sonraki konuşmalarda işe yarayacak kalıcı bir bilgi kaydeder (ör. 'Kafe işletiyor, ayda 10 paket 500 ml kase alıyor'). Kısa, tek cümle. Adres, ödeme, sağlık gibi hassas bilgileri ve notlarda zaten olanı kaydetme.", schema: obj({ not: { type: 'string' } }) },
  { name: 'insana_devret', description: 'Konuşmayı ekibe devreder: toptan, şikayet/iade, özel fiyat, kapıda ödeme veya emin olmadığın durumlar. Sonra müşteriye kısa bir bekleme mesajı yaz.', schema: obj({ kategori: { type: 'string', enum: HANDOFF_CATEGORIES }, neden: { type: 'string' } }) },
];

export const toolCatalog = () => TOOLS.map((t) => `### ${t.name}\n${t.description}\nArgüman şeması: ${JSON.stringify(t.schema)}`).join('\n\n');

export class ToolInputError extends Error {}
const dump = (x) => JSON.stringify(x);

const productView = (p, withDescription = false) => ({
  id: p.id, title: p.title, url: p.url,
  paket_icerigi: p.paketIcerigi || 'BİLİNMİYOR - müşteriye tahmin söyleme',
  variants: p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku, price: formatTl(v.priceKurus), available: v.available, stock: v.stock })),
  ...(withDescription ? { description: p.description.slice(0, 2000) } : {}),
});

// Adres ve iletişim bilgisi bilerek dışarıda bırakılır (veri en aza).
const orderView = (o) => ({ number: o.number, created_at: o.createdAt, financial_status: o.financialStatus, fulfillment_status: o.fulfillmentStatus, total: formatTl(o.totalKurus), items: o.items, shipments: o.shipments });

// state: { handoff: {category, reason} | null, actions: [] } — bir cevap boyunca biriken sonuçlar
export function createExecutor({ db, commerce, conv, state, maxPackages = 50 }) {
  async function validateItems(kalemler) {
    if (!Array.isArray(kalemler) || !kalemler.length) throw new ToolInputError('en az bir kalem gerekli');
    const out = [];
    for (const k of kalemler) {
      const qty = Number(k.adet);
      if (!Number.isInteger(qty) || qty < 1) throw new ToolInputError('adet 1 veya daha büyük tam sayı olmalı');
      if (qty > maxPackages) throw new ToolInputError(`${qty} paket perakende sınırının üstünde; toptan talep olarak insana devret`);
      const v = await commerce.getVariant(String(k.varyant_id));
      if (!v) throw new ToolInputError(`varyant bulunamadı: ${k.varyant_id}`);
      if (!v.available) throw new ToolInputError(`varyant stokta yok: ${v.title || v.id}`);
      out.push({ item: { variantId: v.id, quantity: qty }, variant: v });
    }
    return out;
  }

  const summary = (pairs) => {
    let total = 0;
    const lines = pairs.map(({ item, variant }) => {
      const line = variant.priceKurus * item.quantity;
      total += line;
      return `${item.quantity} paket x ${variant.title || variant.sku} (${formatTl(variant.priceKurus)}) = ${formatTl(line)}`;
    });
    return { kalemler: lines, ara_toplam: formatTl(total), not: 'kargo ücreti ödeme adımında hesaplanır' };
  };

  const handlers = {
    async urun_ara({ sorgu }) {
      const products = await commerce.searchProducts(String(sorgu), 5);
      return products.length ? dump(products.map((p) => productView(p))) : dump({ sonuc: 'ürün bulunamadı', ipucu: 'daha kısa veya farklı kelimelerle tekrar ara' });
    },
    async urun_detay({ urun_id }) {
      const p = await commerce.getProduct(String(urun_id));
      return p ? dump(productView(p, true)) : dump({ sonuc: 'ürün bulunamadı' });
    },
    async musteri_siparisleri() {
      if (!isVerified(db, conv)) return dump({ sonuc: 'müşterinin kimliği bu kanalda doğrulanmadı; sipariş numarası ve telefon/e-posta isteyip siparis_sorgula kullan' });
      const cid = await commerceCustomerId(db, commerce, conv.customer_id);
      if (!cid) return dump({ sonuc: 'bu numarayla kayıtlı müşteri bulunamadı' });
      const orders = await commerce.customerOrders(cid, 5);
      return orders.length ? dump(orders.map(orderView)) : dump({ sonuc: 'müşterinin siparişi yok' });
    },
    async siparis_sorgula({ siparis_no, telefon_veya_eposta }) {
      const order = await commerce.orderByNumber(String(siparis_no));
      const proof = String(telefon_veya_eposta || '').trim();
      const given = proof.includes('@') ? proof.toLowerCase() : normalizePhone(proof);
      const candidates = new Set([given].filter(Boolean));
      const customer = db.prepare('SELECT phone FROM customers WHERE id = ?').get(conv.customer_id);
      if (isVerified(db, conv) && customer?.phone) candidates.add(customer.phone);
      const matches = order && [order.phone, order.email].some((x) => x && candidates.has(x));
      // Sipariş yok ile bilgi eşleşmiyor aynı cevabı alır: başkasının siparişinin varlığı bile sızmaz.
      if (!matches) return dump({ sonuc: 'bu sipariş numarası ve iletişim bilgisiyle eşleşen sipariş bulunamadı' });
      if (given && [order.phone, order.email].includes(given) && !isVerified(db, conv)) {
        linkVerifiedContact(db, conv, { phone: order.phone, email: order.email });
      }
      return dump(orderView(order));
    },
    async sepet_linki({ kalemler }) {
      const pairs = await validateItems(kalemler);
      return dump({ link: commerce.cartLink(pairs.map((p) => p.item)), ...summary(pairs) });
    },
    async odeme_linki({ kalemler }) {
      const pairs = await validateItems(kalemler);
      state.actions.push({ type: 'payment_link', items: pairs.map((p) => p.item) });
      return dump({ yer_tutucu: PAYMENT_LINK_PLACEHOLDER, ...summary(pairs) });
    },
    async musteri_notu_kaydet(args) {
      return dump({ sonuc: addNote(db, conv.customer_id, args.not, 'ai') ? 'kaydedildi' : 'zaten kayıtlı veya boş' });
    },
    async insana_devret({ kategori, neden }) {
      state.handoff = { category: HANDOFF_CATEGORIES.includes(kategori) ? kategori : 'diger', reason: String(neden || '') };
      return dump({ sonuc: 'ekibe devredildi; müşteriye kısa bir bekleme mesajı yaz, söz verme' });
    },
  };

  // → { result, isError }. Altyapı hatasının ayrıntısı modele gitmez (log'a yazılır).
  return async function execute(name, args, log = () => {}) {
    const tool = TOOLS.find((t) => t.name === name);
    try {
      if (!tool) throw new ToolInputError(`bilinmeyen araç: ${name}`);
      const expected = Object.keys(tool.schema.properties).sort();
      if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(expected)) {
        throw new ToolInputError(`${name} şu argümanları ister: ${expected.join(', ') || '(yok)'}`);
      }
      return { result: await handlers[name](args), isError: false };
    } catch (err) {
      if (err instanceof ToolInputError) return { result: `Hata: ${err.message}`, isError: true };
      log('arac_hatasi', { tool: name, error: err.message });
      return { result: 'Hata: sistem şu an bu bilgiye ulaşamıyor. Tahmin yürütme; gerekirse insana devret.', isError: true };
    }
  };
}
