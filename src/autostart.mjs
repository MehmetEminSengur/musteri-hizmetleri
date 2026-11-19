// Bilgisayar açılınca (oturum açılınca) müşteri hizmetlerini başlatır ve kapanırsa yeniden açar.
//   macOS  : ~/Library/LaunchAgents içine LaunchAgent (RunAtLoad + KeepAlive)
//   Windows: Görev Zamanlayıcı, oturum açılışında
//   Linux  : systemd kullanıcı servisi (Restart=always)
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { ROOT } from './config.mjs';

const LABEL = 'com.musteri-hizmetleri';
const BIN = path.join(ROOT, 'bin', 'musteri.mjs');
const HOME = process.env.MUSTERI_HOME || ROOT;
const LOG = path.join(HOME, 'data', 'logs', 'servis.log');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Servis çok kısıtlı bir PATH ile açılır; codex/claude/cloudflared bulunabilsin diye kurulumdaki PATH aktarılır.
const PATH_NOW = process.env.PATH || '';

const mac = {
  file: path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`),
  body: () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(BIN)}</string><string>calistir</string></array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(PATH_NOW)}</string><key>MUSTERI_HOME</key><string>${xml(HOME)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict></plist>
`,
};

const linux = {
  file: path.join(homedir(), '.config', 'systemd', 'user', 'musteri-hizmetleri.service'),
  body: () => `[Unit]
Description=Müşteri hizmetleri
After=network-online.target

[Service]
ExecStart=${process.execPath} ${BIN} calistir
WorkingDirectory=${ROOT}
Environment=PATH=${PATH_NOW}
Environment=MUSTERI_HOME=${HOME}
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
`,
};

export function installAutostart({ dryRun = false } = {}) {
  mkdirSync(path.dirname(LOG), { recursive: true });
  if (process.platform === 'darwin') {
    if (dryRun) return mac.body();
    mkdirSync(path.dirname(mac.file), { recursive: true });
    if (existsSync(mac.file)) try { execFileSync('launchctl', ['unload', mac.file], { stdio: 'ignore' }); } catch { /* yüklü değil */ }
    writeFileSync(mac.file, mac.body());
    execFileSync('launchctl', ['load', mac.file]);
    return `Kuruldu: bilgisayar açılınca müşteri hizmetleri kendiliğinden başlar, kapanırsa yeniden açılır. Kayıt: ${LOG}`;
  }
  if (process.platform === 'win32') {
    const cmd = `"${process.execPath}" "${BIN}" calistir`;
    if (dryRun) return cmd;
    execFileSync('schtasks', ['/Create', '/F', '/TN', 'MusteriHizmetleri', '/SC', 'ONLOGON', '/TR', cmd]);
    execFileSync('schtasks', ['/Run', '/TN', 'MusteriHizmetleri']);
    return 'Kuruldu: oturum açılınca müşteri hizmetleri kendiliğinden başlar.';
  }
  if (dryRun) return linux.body();
  mkdirSync(path.dirname(linux.file), { recursive: true });
  writeFileSync(linux.file, linux.body());
  execFileSync('systemctl', ['--user', 'daemon-reload']);
  execFileSync('systemctl', ['--user', 'enable', '--now', 'musteri-hizmetleri.service']);
  return 'Kuruldu: oturum açılınca müşteri hizmetleri kendiliğinden başlar, kapanırsa yeniden açılır.';
}

export function removeAutostart() {
  if (process.platform === 'darwin') {
    if (existsSync(mac.file)) {
      try { execFileSync('launchctl', ['unload', mac.file], { stdio: 'ignore' }); } catch { /* zaten durmuş */ }
      unlinkSync(mac.file);
    }
  } else if (process.platform === 'win32') {
    try { execFileSync('schtasks', ['/Delete', '/F', '/TN', 'MusteriHizmetleri'], { stdio: 'ignore' }); } catch { /* yok */ }
  } else {
    try { execFileSync('systemctl', ['--user', 'disable', '--now', 'musteri-hizmetleri.service'], { stdio: 'ignore' }); } catch { /* yok */ }
    if (existsSync(linux.file)) unlinkSync(linux.file);
  }
  return 'Otomatik başlatma kaldırıldı.';
}
