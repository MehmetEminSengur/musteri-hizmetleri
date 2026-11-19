// Abonelik CLI'lerini (codex, claude, gemini, shopify, cloudflared) alt süreç olarak çalıştırır.
// İstem stdin'den verilir; komut satırına yazılmaz.
import { spawn } from 'node:child_process';

export function runCli(cmd, args, { input = '', timeoutMs = 10 * 60_000, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${cmd} ${timeoutMs / 1000} sn içinde cevap vermedi`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new Error(`${cmd} bulunamadı. Kurulu ve PATH içinde mi?`) : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${code} koduyla çıktı: ${(stderr || stdout).slice(-500)}`));
    });
    child.stdin.end(input);
  });
}

// Model bazen JSON'u ```json bloğuna ya da açıklamanın arasına koyar; ilk geçerli nesneyi al.
export function extractJson(text) {
  const s = String(text).trim();
  try { return JSON.parse(s); } catch { /* devam */ }
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* devam */ } }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new Error('modelin cevabında JSON bulunamadı');
}

// Yapay zekâ CLI'lerine verilen ortam: yalnız oturum açmak için gerekenler. Meta ve Shopify
// anahtarları müşteri mesajını okuyan modele hiçbir zaman ulaşmaz.
const KEEP = ['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'TERM',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH'];
const KEEP_PREFIX = ['CODEX_', 'CLAUDE_', 'ANTHROPIC_', 'GEMINI_', 'GOOGLE_', 'OPENAI_'];

export function aiEnv(source = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (KEEP.includes(k) || KEEP_PREFIX.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}
