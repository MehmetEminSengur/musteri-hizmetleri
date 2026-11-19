// Ajan döngüsü: her adımda motor tek bir JSON döndürür (araç çağrısı ya da cevap). Araçları bu
// süreç çalıştırır, sonucu sonraki adımın istemine ekler. Hata, ret veya döngü → insana devir.
import { buildSystem, buildPrompt, STEP_SCHEMA } from './prompt.mjs';
import { createExecutor, toolCatalog } from './tools.mjs';
import { buildHistory } from '../inbox.mjs';
import { buildProfile, isVerified } from '../customers.mjs';

export async function runAgent({ db, config, commerce, engine, conversationId, log = () => {} }) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  const history = buildHistory(db, conversationId);
  if (!history.length) return null;

  const system = buildSystem({ brandName: config.store.brandName || 'Mağaza', publicUrl: config.store.publicUrl });
  const profile = await buildProfile(db, commerce, conv);
  const state = { handoff: null, actions: [] };
  const execute = createExecutor({ db, commerce, conv, state, maxPackages: config.limits.maxPackagesPerOrder });
  const steps = [];
  const evidence = () => steps.filter((s) => !s.isError).map((s) => s.result).join('\n');
  const giveUp = (reason) => ({ text: '', handoff: { category: 'emin_degilim', reason }, actions: state.actions, evidence: evidence() });

  for (let i = 0; i < config.limits.aiStepsPerReply; i++) {
    const prompt = buildPrompt({ channel: conv.channel, verified: isVerified(db, conv), profile, toolCatalog: toolCatalog(), history, steps });
    let step;
    try {
      step = await engine.generate({ system, prompt, schema: STEP_SCHEMA });
    } catch (err) {
      log('motor_hatasi', { conversation: conversationId, error: err.message.slice(0, 300) });
      return giveUp(`yapay zekâ çalışmadı: ${err.message.slice(0, 200)}`);
    }
    if (step?.action === 'reply') {
      const text = String(step.text || '').trim();
      return text ? { text, handoff: state.handoff, actions: state.actions, evidence: evidence() } : giveUp('yapay zekâ boş cevap döndürdü');
    }
    if (step?.action !== 'tool') return giveUp('yapay zekâ geçersiz cevap döndürdü');
    const argsJson = String(step.args_json || '{}');
    let args;
    try { args = JSON.parse(argsJson); } catch { args = undefined; }
    const out = args === undefined ? { result: 'Hata: args_json geçerli JSON değil', isError: true } : await execute(String(step.tool), args, log);
    steps.push({ tool: String(step.tool), argsJson, ...out });
  }
  return giveUp('yapay zekâ araç döngüsünden çıkamadı');
}
