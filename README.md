# musteri-hizmetleri

> **Yapay zekâ ajanı için (Codex, Claude Code, Antigravity, Gemini CLI):** Kullanıcı sana bu sayfanın
> linkini verip kurmanı istediyse, sadece bu sayfayı okuyup cevap verme; aşağıdakileri **kendin uygula**:
> 1. Repoyu kullanıcının ev dizininde `musteri-hizmetleri` klasörüne indir:
>    `git clone https://github.com/MehmetEminSengur/musteri-hizmetleri.git ~/musteri-hizmetleri`
>    (git yoksa `https://github.com/MehmetEminSengur/musteri-hizmetleri/archive/refs/heads/main.zip`
>    dosyasını indirip aç, klasör adını `musteri-hizmetleri` yap). Klasör varsa `git pull` ile güncelle.
> 2. O klasörde `.agents/skills/musteri-hizmetleri-kurulum/SKILL.md` dosyasını baştan sona oku.
> 3. Kurulumu oradaki sırayla yap. Soruları kullanıcıya teker teker sor. Müşteriye kullanıcının onayı
>    olmadan hiçbir mesaj gönderme.

Mağazanızın **WhatsApp, Instagram ve Facebook Messenger** mesajlarına, ürün ve sipariş bilgisini
**Shopify**'dan alarak cevap yazan, **kendi bilgisayarınızda** çalışan yapay zekâ müşteri hizmetleri.

- Cevapları **kendi yapay zekâ aboneliğiniz** yazar (ChatGPT/Codex, Claude ya da Gemini). Ek API ücreti yoktur.
- Fiyatı, stoku, paket içeriğini ve kargo durumunu **mağazanızdan okur**; uydurmaz.
- Müşteriyi **tanır**: konuşmalar kayıtlı kalır, müşteri hakkında notlar tutulur, WhatsApp'tan ve
  Instagram'dan yazan aynı kişi tek müşteri olarak görülür.
- Toptan, şikayet, iade, kapıda ödeme ve özel fiyat konuşmalarını **size devreder**.

## En kolay kurulum: linki ajanınıza verin

**Codex**, **Claude Code** ya da **Antigravity**'yi açın ve şunu yazın:

> https://github.com/MehmetEminSengur/musteri-hizmetleri bu sistemi mağazama kur.

Ajan repoyu indirir, kurulum skill'ini okur ve sizinle adım adım ilerler: Shopify'a tarayıcıda tek
onayla bağlanır, yapay zekâ aboneliğinizi seçer, Meta panelinde WhatsApp/Instagram/Messenger
ayarlarını sizinle birlikte yapar, sonra bir deneme cevabı gösterir.

## İki çalışma modu

| Mod | Ne olur |
|---|---|
| **Onaylı** (varsayılan) | AI cevabı yazar, paneldeki **Gönder** düğmesine basınca gider. |
| **Otomatik** | AI cevabı yazar ve kontrollerden geçerse hemen gönderir. Geçmezse onayınıza düşer. |

Otomatik modda her cevap müşteriye gitmeden önce kodla denetlenir:

- Cevaptaki her fiyat mağaza verisinden gelmeli (ya da birim fiyatın tam paket katı olmalı).
- Cevaptaki her link sizin sitenize ya da mağazanın verdiği bir adrese gitmeli.
- Anahtar, dosya yolu veya sistem bilgisine benzeyen bir ifade varsa cevap gönderilmez.
- Ödeme linki (taslak sipariş) cevap gönderilirken oluşturulur; AI tek başına sipariş açamaz.
- Gidip gitmediği belli olmayan bir mesaj asla otomatik tekrar gönderilmez.

## Panel

`node bin/musteri.mjs calistir` paneli tarayıcıda açar (http://127.0.0.1:8787). Panel yalnız sizin
bilgisayarınızdan açılır. Onay bekleyen cevaplar, size devredilen konuşmalar, müşteri kartı (kanallar,
notlar) ve gönderim sorunları buradadır. Bir konuşmayı devraldığınızda AI o konuşmaya cevap yazmaz;
"AI'a geri ver" ile tekrar açılır.

## Komutlar

```
node bin/musteri.mjs kontrol                  # her şey bağlı mı?
node bin/musteri.mjs deneme "kase fiyatı?"    # cevap taslağı üretir, kimseye göndermez
node bin/musteri.mjs deneme --ornek "..."     # mağazaya bağlanmadan örnek ürünle dener
node bin/musteri.mjs calistir                 # mesajları dinler, paneli açar
node bin/musteri.mjs otomatik-baslat-kur      # bilgisayar açılınca kendiliğinden başlar
node bin/musteri.mjs durum                    # bekleyen/devredilen/gönderilen sayıları
```

## Bilmeniz gerekenler

- **Bilgisayar açık olmalı.** Mesajlar Meta'dan ücretsiz bir Cloudflare tüneliyle bilgisayarınıza
  gelir. Bilgisayar kapalıyken gelen mesajları Meta bir süre tekrar dener; çok uzun kapalı kalırsa
  bazıları kaçabilir. 7/24 çalışma için sabit bir adres gerekir (`config.json` → `server.publicUrl`).
- **WhatsApp 24 saat kuralı:** müşterinin son mesajından 24 saat sonra serbest mesaj gönderilemez.
- **Instagram ve Messenger'da herkese cevap** için Meta uygulamanızın incelemeden geçmesi gerekir
  (`docs/meta-kurulum.md` → "Gerçek müşterilere açmadan önce").
- Şimdilik yalnız **Shopify** mağazaları desteklenir.
- Yapay zekâ aboneliğinizin kullanım koşullarına ve limitlerine siz tabisiniz. Yoğun mesaj trafiğinde
  aboneliğin limitleri yetmeyebilir.

## Gereksinimler

- Node.js 22.13 veya üstü
- Codex CLI, Claude Code ya da Gemini CLI (abonelikle oturum açılmış)
- cloudflared (macOS: `brew install cloudflared`, Windows: `winget install --id Cloudflare.cloudflared`)
- Shopify mağazası, Meta işletme portföyü, Facebook sayfası; WhatsApp için Cloud API'ye bağlı bir numara

## Lisans

MIT
