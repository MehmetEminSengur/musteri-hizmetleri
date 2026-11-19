// Operatör paneli: tek sayfa, harici dosya yok. Onay bekleyen ve devredilen konuşmalar solda,
// seçilen konuşma (geçmiş, müşteri kartı, taslak) sağda.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function panelHtml({ token, brand }) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="panel-token" content="${esc(token)}"><title>Müşteri hizmetleri · ${esc(brand || '')}</title>
<style>
:root{--bg:#f4efe6;--card:#fff;--ink:#222;--muted:#6b6257;--line:#e3dccf;--accent:#8a5a2b;--ok:#2f7d4f;--warn:#b26b00;--err:#b3261e}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--card)}
header h1{font-size:17px;margin:0}header small{color:var(--muted)}
main{display:grid;grid-template-columns:minmax(260px,340px) 1fr;min-height:calc(100vh - 52px)}
@media(max-width:760px){main{grid-template-columns:1fr}}
aside{border-right:1px solid var(--line);overflow:auto;max-height:calc(100vh - 52px)}
aside h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 14px 6px}
.item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);background:none;padding:10px 14px;cursor:pointer;font:inherit;color:inherit}
.item:hover,.item.sel{background:#fff}.item b{display:block}.item span{color:var(--muted);font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:9px;background:#eee;color:#444;margin-left:6px}
.tag.handoff{background:#fde7c8;color:var(--warn)}.tag.unknown,.tag.failed,.tag.blocked{background:#f9d6d3;color:var(--err)}
section{padding:16px;overflow:auto;max-height:calc(100vh - 52px)}
.empty{color:var(--muted);padding:40px 16px;text-align:center}
.cols{display:grid;grid-template-columns:1fr 280px;gap:16px}@media(max-width:1000px){.cols{grid-template-columns:1fr}}
.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px}
.box h3{margin:0 0 8px;font-size:14px}
.msg{max-width:80%;padding:7px 11px;border-radius:12px;margin:6px 0;white-space:pre-wrap}
.msg.customer{background:#efe9df}.msg.ai,.msg.human{background:#e3f0e8;margin-left:auto}
.msg small{display:block;color:var(--muted);font-size:11px}
textarea{width:100%;min-height:120px;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px}
button.b{font:inherit;border:1px solid var(--line);background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;margin:6px 6px 0 0}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.danger{color:var(--err)}
.note{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line);padding:4px 0;font-size:14px}
.note button{border:0;background:none;color:var(--err);cursor:pointer}
.why{color:var(--warn);font-size:13px}#toast{position:fixed;bottom:16px;right:16px;background:#222;color:#fff;padding:10px 14px;border-radius:8px;display:none}
</style></head><body>
<header><h1>Müşteri hizmetleri <small>${esc(brand || '')}</small></h1><small id="stamp"></small></header>
<main><aside id="list"></aside><section id="detail"><p class="empty">Soldan bir konuşma seçin.</p></section></main>
<div id="toast"></div>
<script>
const TOKEN = document.querySelector('meta[name=panel-token]').content;
const CH = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };
const CAT = { toptan: 'Toptan', sikayet_iade: 'Şikayet / iade', ozel_fiyat: 'Özel fiyat', kapida_odeme: 'Kapıda ödeme', emin_degilim: 'AI emin değil', diger: 'Diğer' };
const OUT = { unknown: 'Gidip gitmediği belli değil', failed: 'Gönderilemedi', blocked: 'Gönderilemez' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let selected = null;

async function api(path, body) {
  const r = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'x-panel-token': TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}
function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', 4000); }

async function loadList() {
  const { taslaklar, gonderimler } = await api('ozet');
  const pending = taslaklar.filter((d) => d.status === 'pending');
  const handoff = taslaklar.filter((d) => d.status === 'handoff');
  const row = (d) => '<button class="item' + (selected === d.conversation_id ? ' sel' : '') + '" data-c="' + d.conversation_id + '"><b>' + esc(d.name || 'İsimsiz müşteri') + '<span class="tag ' + d.status + '">' + (d.status === 'handoff' ? esc(CAT[d.handoff_category] || 'Devredildi') : CH[d.channel]) + '</span></b><span>' + esc(d.last_message) + '</span></button>';
  const out = (o) => '<button class="item" data-c="' + o.conversation_id + '"><b>' + CH[o.channel] + '<span class="tag ' + o.state + '">' + OUT[o.state] + '</span></b><span>' + esc(o.text) + '</span></button>';
  document.getElementById('list').innerHTML =
    '<h2>Onay bekleyen (' + pending.length + ')</h2>' + (pending.map(row).join('') || '<p class="empty">Yok</p>') +
    '<h2>Size devredilen (' + handoff.length + ')</h2>' + (handoff.map(row).join('') || '<p class="empty">Yok</p>') +
    (gonderimler.length ? '<h2>Gönderim sorunları</h2>' + gonderimler.map(out).join('') : '');
  document.getElementById('stamp').textContent = 'Son yenileme ' + new Date().toLocaleTimeString('tr');
}

async function open(id) {
  selected = id;
  const c = await api('konusma/' + id);
  const draft = [...c.drafts].reverse().find((d) => d.status === 'pending' || d.status === 'handoff');
  const msgs = c.messages.map((m) => '<div class="msg ' + m.author + '">' + esc(m.text) + '<small>' + ({ customer: 'Müşteri', ai: 'AI', human: 'Siz' }[m.author]) + ' · ' + new Date(m.sent_at).toLocaleString('tr') + '</small></div>').join('');
  const notes = c.customer.notes.map((n) => '<div class="note"><span>' + esc(n.text) + '</span><button data-del="' + n.id + '" title="Sil">×</button></div>').join('') || '<p class="why">Not yok</p>';
  const issues = (c.outbox || []).map((o) => '<div class="box"><b class="why">' + OUT[o.state] + '</b><p>' + esc(o.text) + '</p><p class="why">' + esc(o.error || '') + '</p>' + (o.state === 'unknown' ? '<button class="b" data-mark="' + o.id + '" data-sent="1">Gitmiş, işaretle</button><button class="b" data-mark="' + o.id + '" data-sent="0">Gitmemiş</button>' : '') + '</div>').join('');
  let action = '';
  if (draft) {
    action = '<div class="box"><h3>' + (draft.status === 'handoff' ? 'Size devredildi: ' + esc(CAT[draft.handoff_category] || '') : 'AI cevap taslağı') + '</h3>' +
      (draft.handoff_reason ? '<p class="why">' + esc(draft.handoff_reason) + '</p>' : '') +
      (draft.hold_reason ? '<p class="why">Otomatik gönderilmedi: ' + esc(draft.hold_reason) + '</p>' : '') +
      '<textarea id="txt">' + esc(draft.text) + '</textarea>' +
      '<button class="b primary" data-act="onayla" data-d="' + draft.id + '">Gönder</button><button class="b danger" data-act="reddet" data-d="' + draft.id + '">Reddet</button></div>';
  } else {
    action = '<div class="box"><h3>Mesaj yaz</h3><textarea id="txt"></textarea><button class="b primary" data-send="1">Gönder</button></div>';
  }
  const control = c.status === 'human'
    ? '<button class="b" data-status="birak">AI\\'a geri ver</button>'
    : '<button class="b" data-status="devral">Konuşmayı devral (AI cevap yazmasın)</button>';
  document.getElementById('detail').innerHTML = '<div class="cols"><div>' + issues + '<div class="box"><h3>' + CH[c.channel] + ' konuşması</h3>' + msgs + '</div>' + action + control + '</div>' +
    '<div><div class="box"><h3>' + esc(c.customer.name || 'İsimsiz müşteri') + '</h3><p>' + c.customer.channels.map((x) => CH[x.channel] + (x.verified ? ' ✓' : ' (doğrulanmadı)')).join(', ') + '</p>' +
    (c.customer.phone ? '<p>Tel: ' + esc(c.customer.phone) + '</p>' : '') + '<h3>Notlar</h3>' + notes +
    '<textarea id="note" style="min-height:60px" placeholder="Not ekle (ör. Kafe işletiyor)"></textarea><button class="b" data-note="' + c.customer.id + '">Notu kaydet</button></div></div></div>';
  loadList();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  try {
    if (t.dataset.c) return open(Number(t.dataset.c));
    if (t.dataset.act === 'onayla') { const r = await api('taslak/' + t.dataset.d + '/onayla', { text: document.getElementById('txt').value }); toast(r.gonderim === 'sent' ? 'Gönderildi' : 'Gönderim: ' + (OUT[r.gonderim] || r.gonderim) + (r.hata ? ' — ' + r.hata : '')); }
    if (t.dataset.act === 'reddet') { await api('taslak/' + t.dataset.d + '/reddet', {}); toast('Reddedildi'); }
    if (t.dataset.send) { const r = await api('konusma/' + selected + '/gonder', { text: document.getElementById('txt').value, requestKey: crypto.randomUUID() }); toast(r.gonderim === 'sent' ? 'Gönderildi' : 'Gönderim: ' + (OUT[r.gonderim] || r.gonderim)); }
    if (t.dataset.status) { await api('konusma/' + selected + '/' + t.dataset.status, {}); toast(t.dataset.status === 'devral' ? 'Konuşma sizde' : 'AI tekrar cevap yazacak'); }
    if (t.dataset.note) { await api('musteri/' + t.dataset.note + '/not', { text: document.getElementById('note').value }); toast('Not kaydedildi'); }
    if (t.dataset.del) { await api('not/' + t.dataset.del + '/sil', {}); }
    if (t.dataset.mark) { await api('gonderim/' + t.dataset.mark + '/isaretle', { sent: t.dataset.sent === '1' }); }
    if (selected) open(selected); else loadList();
  } catch (err) { toast('Hata: ' + err.message); }
});
loadList(); setInterval(() => { loadList().catch(() => {}); }, 10000);
</script></body></html>`;
}
