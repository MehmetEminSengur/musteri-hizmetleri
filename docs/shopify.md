# Shopify bağlantısı

## En kolay yol: tarayıcıda tek onay

```
node bin/musteri.mjs shopify-baglan
```

Shopify CLI yoksa kurulur ve tarayıcıda Shopify'ın izin ekranı açılır. Mağaza sahibi hesabıyla
girip **Yükle**'ye basın. İstenen izinler yalnız şunlar:

| İzin | Neden |
|---|---|
| Ürün ve stok okuma | Fiyat, stok, paket içeriği ve ürün linki |
| Müşteri ve sipariş okuma | "Siparişim nerede?" sorusu, müşteriyi tanıma |
| Taslak sipariş oluşturma | Müşteri sitede zorlanırsa ödeme linki |

Ürün, fiyat veya sipariş **değiştirme** izni istenmez.

## Kesintisiz çalışma için uygulama anahtarı

Shopify CLI bağlantısı uzun süre kullanılmazsa yenilenmek isteyebilir. Hiç tarayıcı istemeyen yol:
Shopify **Dev Dashboard** (dev.shopify.com) üzerinden mağazanız için bir uygulama açın,
yukarıdaki izinleri verip mağazaya yükleyin, **Client ID** ve **Client Secret**'ı `.env` dosyasına yazın
(`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`) ve `config.json` → `store.auth` değerini `"app"` yapın.

## Müşteri verisine erişim

Shopify müşteri adı, telefon ve e-postasını **korumalı müşteri verisi** sayar. `kontrol` komutu
"müşteri/sipariş verisine erişim izni yok" derse uygulama yolunu kullanın ve uygulamanın ayarlarında
**Korumalı müşteri verisi erişimi** bölümünden ad, e-posta ve telefon alanlarına erişim isteyin.

## Paket içeriği

AI paket içeriğini ürün açıklamasındaki şu satırdan okur:

```
Paket içeriği: 50 adet kase + 50 adet kapak
```

Bu satır yoksa müşteriye paket içeriğini tahmin etmez, "bilinmiyor, ekibimiz dönecek" der. Satış
birimi paket olan ürünlerde (1 adet = 1 paket) bu satırı eklemeniz önerilir.
