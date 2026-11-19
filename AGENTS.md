# Ajan talimatları: musteri-hizmetleri

Bu dosya kullanıcının yapay zekâ ajanı (Codex, Claude Code, Antigravity) içindir.

- **Kullanıcı kurulum istiyorsa** ("bunu mağazama kur", "müşteri hizmetlerini kur"):
  `.agents/skills/musteri-hizmetleri-kurulum/SKILL.md` dosyasını baştan sona oku ve oradaki akışı
  sırayla uygula. Claude Code aynı skill'i `.claude/skills/` altında da bulur.
- **Günlük kullanım** panelden yapılır: `node bin/musteri.mjs calistir` → http://127.0.0.1:8787
- Gizli anahtarları sohbete yazdırma; `.env` içeriğini okuma, gösterme, commit etme.

## Geliştirme notları (kodu değiştirecek ajanlar için)

- Node.js 22.13+, ek paket yok. Testler: `npm test` (gerçek Meta/Shopify/yapay zekâya bağlanmaz).
- Para her yerde tam sayı kuruştur (`priceKurus`); müşteriye `formatTl` ile yazılır. Ondalık sayı
  ile fiyat taşıma.
- Model hiçbir zaman alıcı, hesap veya müşteri kimliği seçmez; araçlar bunları konuşmadan alır.
  Yeni bir araç eklerken de böyle kalmalı.
- Müşteriye giden her metin `src/agent/guards.mjs` kapılarından geçer. Otomatik modu genişleten
  bir değişiklik bu kapıları zayıflatmamalı.
- Gönderim idempotenttir (`outbox`). Sonucu belirsiz gönderim (`unknown`) asla otomatik tekrar
  gönderilmez.
- `.agents/skills/` ve `.claude/skills/` altındaki SKILL.md dosyaları aynı olmalı (test denetler).
