// Yapay zekâ motoru. Hepsi aynı sözleşmeyi uygular:
//   generate({ system, prompt, schema }) → JSON nesnesi
// Motor, kullanıcının kendi aboneliğiyle oturum açtığı CLI'dir; ek API ücreti yoktur.
//
// Müşteri mesajı istemin içinde olduğu için motorlar kısıtlı çalışır:
// - codex: salt-okunur sandbox, kullanıcı ayarları/kuralları yüklenmez, tarayıcı ve bilgisayar
//   kontrolü kapalı, kabuk komutlarına ortam değişkeni geçmez. Sabit çalışma klasörü: data/codex.
// - claude: araçlar kapalı (--tools ""), oturum kaydedilmez.
// - gemini: şema desteği yok, istemde tarif edilir. Araç kısıtlaması diğerleri kadar sıkı değil.
// Hiçbirine Meta/Shopify anahtarı verilmez (aiEnv). Taslaklar her zaman insan onayından geçer.
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runCli, extractJson, aiEnv } from './run-cli.mjs';

const CODEX_DISABLED = ['browser_use', 'browser_use_external', 'computer_use', 'apps'];

export function createEngines(config, { run = runCli } = {}) {
  const workdir = path.join(config.dataDir, 'codex');
  const model = config.engines?.textModel;
  const effort = config.engines?.textEffort || 'medium';

  return {
    async codex({ system, prompt, schema }) {
      mkdirSync(path.join(workdir, 'calls'), { recursive: true });
      const call = mkdtempSync(path.join(workdir, 'calls', 'c-'));
      try {
        const schemaFile = path.join(call, 'schema.json');
        const outFile = path.join(call, 'out.json');
        writeFileSync(schemaFile, JSON.stringify(schema));
        const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
          '-s', 'read-only', '-C', workdir, '-c', 'shell_environment_policy.inherit=none',
          '-c', `model_reasoning_effort=${effort}`, '--output-schema', schemaFile, '-o', outFile];
        for (const f of CODEX_DISABLED) args.push('--disable', f);
        if (model) args.push('-m', model);
        args.push('-');
        await run('codex', args, { input: `${system}\n\n${prompt}`, env: aiEnv(), timeoutMs: 5 * 60_000 });
        return extractJson(readFileSync(outFile, 'utf8'));
      } finally {
        rmSync(call, { recursive: true, force: true });
      }
    },

    async claude({ system, prompt, schema }) {
      const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--no-session-persistence',
        '--tools', '', '--append-system-prompt', system];
      if (model) args.push('--model', model);
      const { stdout } = await run('claude', args, { input: prompt, env: aiEnv(), timeoutMs: 5 * 60_000 });
      const res = JSON.parse(stdout);
      if (res.is_error) throw new Error(`claude hata döndü: ${String(res.result).slice(0, 300)}`);
      return res.structured_output ?? extractJson(res.result);
    },

    async gemini({ system, prompt, schema }) {
      const args = ['-p', '', '--output-format', 'json'];
      if (model) args.push('-m', model);
      const full = `${system}\n\nCevabın yalnız şu JSON şemasına uyan tek bir nesne olmalı; araç kullanma, dosya okuma:\n${JSON.stringify(schema)}\n\n${prompt}`;
      const { stdout } = await run('gemini', args, { input: full, env: aiEnv(), timeoutMs: 5 * 60_000 });
      const res = JSON.parse(stdout);
      return extractJson(res.response ?? stdout);
    },
  };
}

export function textEngine(config, opts) {
  const name = config.engines?.text || 'codex';
  const engines = createEngines(config, opts);
  const impl = engines[name];
  if (!impl) throw new Error(`bilinmeyen yapay zekâ motoru: ${name} (codex | claude | gemini)`);
  return { name, generate: (req) => impl(req) };
}

export async function probeEngine(name) {
  try {
    const { stdout } = await runCli(name, ['--version'], { timeoutMs: 15_000 });
    return stdout.trim().split('\n')[0];
  } catch {
    return null;
  }
}
