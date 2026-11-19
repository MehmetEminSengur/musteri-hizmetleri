---
name: musteri-hizmetleri-kurulum
description: "musteri-hizmetleri sistemini kullanıcının mağazasına kurar: WhatsApp, Instagram ve Facebook Messenger mesajlarına Shopify verisiyle cevap yazan, kendi bilgisayarında çalışan yapay zekâ müşteri hizmetleri. Shopify bağlantısı, Meta uygulaması ve anahtarları, yapay zekâ motoru, deneme, otomatik mod ve otomatik başlatmayı sırayla kurdurur. Tetikleyiciler: 'müşteri hizmetlerini kur', 'WhatsApp'a otomatik cevap kur', 'Instagram DM'lerine AI cevap versin', 'müşteri mesajlarını yapay zekâ cevaplasın', 'musteri-hizmetleri kurulumu', 'set up AI customer service for my store'."
---

# Müşteri hizmetleri kurulumu

Bu skill, kullanıcının yapay zekâ ajanı (Codex, Claude Code, Antigravity) için yazıldı. Kullanıcı
teknik biri değil: kısa, sade Türkçe konuş, her adımda ne yaptığını tek cümleyle söyle, soruları
**teker teker** sor. Komutların hepsi repo klasöründe `node bin/musteri.mjs <komut>` ile çalışır.

## Değişmez kurallar

1. **Gizli bilgileri sohbete yazdırma.** Anahtarları (Meta, Shopify) kullanıcıdan sohbete
   yapıştırmasını isteme. `.env` dosyasını sen oluştur, değerleri kullanıcı **kendisi** yazsın.
   `.env` içeriğini ekrana basma, loglama, commit etme.
2. **Müşteriye onaysız mesaj gönderme.** Kurulumda `mode` her zaman `"approval"` başlar. Otomatik
   moda (`"auto"`) ancak kullanıcı denemeleri gördükten sonra açıkça isterse geç.
3. **Kodu değiştirme.** Kurulumda yalnız `config.json` ve `.env` düzenlenir. Bir hata görürsen
   kullanıcıya anlat; kodu "düzeltmeye" çalışma.
4. **Shopify eklentin varsa** (Claude veya Codex için Shopify eklentisi/bağlayıcısı) kurulum
   sırasında mağaza adresini bulmak ve ürün açıklamalarına bakmak için kullanabilirsin. Ama
   sistemin kendisi mağazaya kendi bağlantısıyla bağlanır; eklentiyi sisteme bağlamaya çalışma.

## Adım 0: Ön kontrol

- Repo bilgisayarda yoksa: `git clone https://github.com/MehmetEminSengur/musteri-hizmetleri.git ~/musteri-hizmetleri`
  (git yoksa `https://github.com/MehmetEminSengur/musteri-hizmetleri/archive/refs/heads/main.zip`
  dosyasını indirip açın, klasör adını `musteri-hizmetleri` yapın). Varsa `git pull`.
- `node -v` → 22.13'ten küçükse ya da Node yoksa kullanıcıya nodejs.org'dan LTS sürümünü kurmasını
  söyle ve "tamam" demesini bekle.
- `cp config.example.json config.json` ve `cp .env.example .env` (Windows'ta `copy`).

## Soru 1: Mağaza

"Mağazanız Shopify'da mı? Shopify admin'deki xxx.myshopify.com adresiniz ve müşterilerin gördüğü
site adresi nedir? Marka adınız nasıl yazılsın?"

- `config.json` → `store.domain` (xxx.myshopify.com), `store.publicUrl`, `store.brandName`.
- Şimdilik yalnız **Shopify** destekleniyor. IdeaSoft/İkas ise bunu açıkça söyle ve dur.
- `node bin/musteri.mjs shopify-baglan` çalıştır. Kullanıcıya tek cümle: "Tarayıcıda Shopify
  açılacak; mağaza sahibi hesabıyla girip Yükle'ye basın." İstenen izinler yalnız okuma ve taslak
  sipariştir; ürün veya sipariş değiştirme izni istenmez.
- Ürün açıklamalarında `Paket içeriği: 50 adet kase + 50 adet kapak` gibi bir satır yoksa AI paket
  içeriğini "bilinmiyor" der. Bunu kullanıcıya söyle (`docs/shopify.md` → "Paket içeriği").

## Soru 2: Yapay zekâ

"Hangi yapay zekâ aboneliğiniz var: ChatGPT (Codex), Claude ya da Gemini?"

- `config.json` → `engines.text`: `"codex"` | `"claude"` | `"gemini"`.
- Motorun kurulu ve oturumun açık olduğunu kontrol et (`codex --version`, `claude --version`,
  `gemini --version`). Değilse kullanıcıya oturum açmasını söyle ve bekle.
- Hemen dene: `node bin/musteri.mjs deneme "Merhaba, en çok satan ürününüzün fiyatı ne?"`
  Cevabı kullanıcıya göster. Bu deneme kimseye mesaj göndermez.

## Soru 3: Kanallar ve Meta

"Hangi kanallardan gelen mesajlara cevap verilsin: WhatsApp, Instagram, Facebook Messenger?"

- `config.json` → `channels` içinde istenmeyenleri `false` yap.
- Meta tarafını `docs/meta-kurulum.md` dosyasındaki adımlarla **birlikte, adım adım** yap: her
  adımı kullanıcıya anlat, ekranda ne gördüğünü sor, sonraki adıma öyle geç. Adımlar:
  Meta uygulaması → WhatsApp numarası → Instagram'ın sayfaya bağlanması ve mesaj izni →
  sistem kullanıcısı ve erişim anahtarı → `.env` doldurma.
- Kullanıcı değerleri `.env` dosyasına **kendisi** yazar. Sen yalnız hangi satıra ne yazılacağını
  söylersin.
- WhatsApp numarası şu an telefondaki WhatsApp Business uygulamasında kullanılıyorsa
  `docs/meta-kurulum.md` → "WhatsApp numarası" bölümündeki seçenekleri anlat, kararı kullanıcı versin.

## Soru 4: Mesajların bilgisayara ulaşması

Meta mesajları internetten erişilebilen bir adrese gönderir. Varsayılan yol ücretsiz Cloudflare
tünelidir; hesap gerekmez, sistem adresi Meta'ya kendisi bildirir.

- `cloudflared` kurulu değilse: macOS `brew install cloudflared`, Windows
  `winget install --id Cloudflare.cloudflared`. (Homebrew yoksa cloudflare.com'daki kurulum sayfasını göster.)
- Kullanıcıya açıkça söyle: **bilgisayar kapalı veya uykudayken mesaj gelmez**; açılınca Meta'nın
  tekrar denediği mesajlar gelir, çok uzun kapalı kalınırsa bazıları kaçabilir. 7/24 için sabit bir
  adres (kendi alan adıyla Cloudflare tüneli ya da sunucu) gerekir: `config.json` → `server.publicUrl`.

## Adım 5: Kontrol ve ilk çalıştırma

1. `node bin/musteri.mjs kontrol` → her satır ✓ olana kadar ✗ satırlardaki öneriyi kullanıcıyla uygula.
2. `node bin/musteri.mjs calistir` → panel tarayıcıda açılır (http://127.0.0.1:8787).
3. Kullanıcıdan başka bir telefondan mağazanın WhatsApp'ına (veya Instagram'ına) mesaj atmasını iste.
   Taslak panelde görünmeli. Kullanıcı "Gönder"e basınca mesaj gitmeli. Görünmezse
   `data/logs/` altındaki bugünün kaydına bak ve kullanıcıya sade dille anlat.

## Adım 6: Otomatik çalışma (kullanıcı isterse)

- **Otomatik cevap:** Kullanıcı birkaç gerçek mesajda taslakları beğendiyse ve isterse
  `config.json` → `"mode": "auto"`. Anlat: kontrollerden geçen cevaplar hemen gider. Mağazada
  olmayan bir fiyat, mağaza dışı bir link veya şüpheli bir ifade içeren cevap gönderilmez, panelde
  onaya düşer. Toptan, şikayet, iade, kapıda ödeme ve özel fiyat konuşmaları her zaman kullanıcıya
  devredilir.
- **Bilgisayar açılınca başlasın:** `node bin/musteri.mjs otomatik-baslat-kur`. Kaldırmak için
  `otomatik-baslat-kaldir`.

Kurulum bitince kullanıcıya üç cümleyle özetle: hangi kanallar bağlı, mod ne (onaylı/otomatik),
paneli nereden açacak.
