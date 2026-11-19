// Cloudflare hızlı tüneli: bilgisayardaki webhook sunucusunu internetten erişilebilir yapar.
// Hesap gerekmez. Adres her açılışta değişir; program yeni adresi Meta'ya kendisi bildirir.
import { spawn } from 'node:child_process';

export function startTunnel(port, { bin = 'cloudflared', timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let buf = '';
    let resolved = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Cloudflare tüneli 60 sn içinde açılmadı; internet bağlantısını kontrol edin')); }, timeoutMs);
    const onData = (d) => {
      buf += d;
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolved = true;
        resolve({ url: m[0], stop: () => child.kill(), closed: new Promise((r) => child.once('exit', r)) });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT'
        ? new Error('cloudflared kurulu değil. macOS: brew install cloudflared · Windows: winget install --id Cloudflare.cloudflared')
        : err);
    });
    child.on('exit', (code) => { clearTimeout(timer); if (!resolved) reject(new Error(`cloudflared kapandı (${code})`)); });
  });
}
