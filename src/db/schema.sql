-- Tek doğruluk kaynağı. Ödeme bilgisi hiçbir tabloda tutulmaz.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT,
  phone TEXT,            -- 905xxxxxxxxx biçiminde, + olmadan
  email TEXT,
  commerce_id TEXT,      -- mağazadaki müşteri kimliği
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS customers_email ON customers(email);

-- Müşteri hakkında kalıcı bilgi (işletme türü, düzenli aldığı ürün). AI veya operatör yazar.
CREATE TABLE IF NOT EXISTS customer_notes (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  text TEXT NOT NULL,
  source TEXT NOT NULL,  -- ai | human
  created_at TEXT NOT NULL
);

-- Kanal kimliği (WhatsApp numarası, Instagram/Messenger kullanıcı kimliği) → müşteri.
-- verified: WhatsApp'ta numara kanaldan geldiği için 1; Instagram/Messenger'da müşteri sipariş
-- numarası + telefon/e-postayla kendini doğrulayınca 1 olur.
CREATE TABLE IF NOT EXISTS identities (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  verified INTEGER NOT NULL DEFAULT 0,
  UNIQUE (channel, external_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,   -- cevabın gideceği kimlik
  status TEXT NOT NULL DEFAULT 'ai', -- ai: AI taslak yazar | human: insan devraldı
  last_inbound_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (channel, external_user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,           -- geliş sırası; sıralama buna göre yapılır
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  channel TEXT NOT NULL,
  author TEXT NOT NULL,             -- customer | ai | human
  text TEXT NOT NULL,
  external_id TEXT,                 -- kanalın mesaj kimliği; aynı webhook iki kez işlenmez
  sent_at TEXT NOT NULL,
  UNIQUE (channel, external_id)
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  reply_to_message_id INTEGER NOT NULL REFERENCES messages(id),
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,             -- pending | handoff | approved | rejected | superseded
  handoff_category TEXT,
  handoff_reason TEXT,
  actions_json TEXT NOT NULL DEFAULT '[]', -- onayda çalışacak işler (ödeme linki)
  hold_reason TEXT,                 -- otomatik modda gönderilmeme nedeni (kontrolden geçmedi)
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (conversation_id, reply_to_message_id)
);
CREATE INDEX IF NOT EXISTS drafts_status ON drafts(status);

-- Idempotent gönderim kuyruğu. unknown: gidip gitmediği belli değil, otomatik tekrar gönderilmez.
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  draft_id INTEGER REFERENCES drafts(id),
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed | unknown | blocked
  provider_message_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (provider TEXT PRIMARY KEY, access_token TEXT, expires_at TEXT, updated_at TEXT);
