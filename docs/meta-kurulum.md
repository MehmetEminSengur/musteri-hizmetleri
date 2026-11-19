# Meta kurulumu (WhatsApp, Instagram, Messenger)

Bu rehberle Meta'dan dört bilgi alıp `.env` dosyasına yazacaksınız: uygulama kimliği ve gizli
anahtarı, erişim anahtarı, sayfa kimliği ve WhatsApp numara kimlikleri. Anahtarları kimseyle ve
yapay zekâ sohbetiyle paylaşmayın; `.env` dosyasına kendiniz yazın.

> Meta'nın ekranları zaman zaman değişir. Bir düğmenin adı burada yazandan farklıysa en yakın
> anlamlı seçeneği arayın; ajanınız ekranda ne gördüğünüzü sorup yönlendirir.

## Hazırlık

- Bir **Meta işletme portföyü** (business.facebook.com). Mağazanın Facebook sayfası ve Instagram
  hesabı bu portföyde olmalı.
- Instagram hesabı **profesyonel hesap** (işletme ya da içerik üreticisi) olmalı ve Facebook
  sayfasına bağlı olmalı.

## Adım 1: Meta uygulaması

1. developers.facebook.com → **Uygulamalarım** → **Uygulama oluştur**.
2. Kullanım durumlarından WhatsApp ve Messenger/Instagram ile müşterilere mesaj gönderme
   seçeneklerini ekleyin. İşletme portföyü olarak mağazanızınkini seçin.
3. Uygulama → **Ayarlar → Temel**: **Uygulama Kimliği** → `.env` → `META_APP_ID`,
   **Uygulama Gizli Anahtarı** (Göster'e basın) → `META_APP_SECRET`.

**Var olan bir uygulamayı kullanacaksanız** (ör. içerik paylaşımı için açılmış bir uygulama): Meta'da
webhook adresi uygulama başınadır, işletme ya da sayfa başına değil. Uygulamaya bağlı bütün sayfaların
mesaj bildirimleri tek adrese gider. `kontrol` komutu uygulamada başka bir sisteme giden webhook olup
olmadığını gösterir; varsa `calistir` o adresin üzerine yazmaz. Bu durumda ayrı bir uygulama açın.

## Adım 2: WhatsApp numarası

1. Uygulama → **WhatsApp → API Kurulumu**.
2. Mağazanın numarasını ekleyin ve doğrulayın.
3. Aynı sayfadaki **Telefon numarası kimliği** → `WHATSAPP_PHONE_NUMBER_ID`,
   **WhatsApp İşletme Hesabı kimliği** → `WHATSAPP_BUSINESS_ACCOUNT_ID`.

**Numara şu an telefondaki WhatsApp Business uygulamasında kullanılıyorsa** üç yol var; kararı siz verin:
- Meta'nın uygulama ile API'yi birlikte kullanma (coexistence) seçeneği hesabınızda sunuluyorsa onu
  kullanın: telefondaki uygulama çalışmaya devam eder.
- API için ayrı bir numara kullanın (en sorunsuzu).
- Numarayı telefondaki uygulamadan kaldırıp API'ye taşıyın (telefonda o numarayla WhatsApp kullanamazsınız).

## Adım 3: Instagram ve Facebook sayfası

1. Facebook sayfanızın kimliği: sayfa → **Hakkında → Sayfa şeffaflığı** ya da İşletme ayarları →
   **Hesaplar → Sayfalar**. → `META_PAGE_ID`
2. Instagram uygulamasında: **Ayarlar → Gizlilik → Mesajlar → Bağlı araçlar** altında
   **Mesajlara erişime izin ver** açık olmalı.
3. Instagram hesabının kimliğini girmenize gerek yok; `kontrol` komutu sayfadan kendisi bulur.

## Adım 4: Sistem kullanıcısı ve erişim anahtarı

Erişim anahtarı süresiz olmalı; kişisel hesabınızın geçici anahtarı birkaç saatte biter.

1. business.facebook.com → **İşletme ayarları → Kullanıcılar → Sistem kullanıcıları** →
   **Ekle** (rol: Yönetici).
2. **Varlık ata**: uygulamanızı, Facebook sayfanızı ve WhatsApp hesabınızı tam yetkiyle atayın.
3. **Yeni anahtar oluştur**: uygulamanızı seçin, süre **Hiçbir zaman**, izinler:
   `whatsapp_business_messaging`, `whatsapp_business_management`, `pages_messaging`,
   `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `instagram_basic`,
   `instagram_manage_messages`, `business_management`.
4. Anahtar bir kez gösterilir → `.env` → `META_ACCESS_TOKEN`.

## Adım 5: Kontrol

```
node bin/musteri.mjs kontrol
```

Meta satırlarının hepsi ✓ olmalı. Webhook adresini Meta'ya girmenize gerek yok:
`calistir` komutu Cloudflare tünelini açar ve adresi Meta'ya kendisi kaydeder.

## Gerçek müşterilere açmadan önce

- Meta uygulaması **geliştirme modundayken** yalnız uygulamada rolü olan kişilerin mesajları gelir.
  Kendi telefonunuzla deneyebilirsiniz.
- Herkesin Instagram ve Messenger mesajlarına cevap verebilmek için uygulamanın **canlı moda**
  alınması ve `pages_messaging` ile `instagram_manage_messages` izinleri için Meta'nın **uygulama
  incelemesinden** geçmesi gerekir. Bunun için işletme doğrulaması istenir.
- WhatsApp'ta müşterinin son mesajından sonraki **24 saat** içinde serbest cevap yazılabilir. 24
  saat geçtiyse sistem mesajı göndermez ve panelde "gönderilemez" olarak gösterir.
