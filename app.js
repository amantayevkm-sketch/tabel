/* Табель — клиент бөлігі (PWA). Барлық уақыт пен тексеру серверде; клиент тек көрсетеді. */
'use strict';

const S = { me: null, settings: { timezone: 'Asia/Almaty', company_name: '' }, offset: 0, timers: [] };
const WD = ['', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сн', 'Жк'];
const WD_FULL = ['', 'Дүйсенбі', 'Сейсенбі', 'Сәрсенбі', 'Бейсенбі', 'Жұма', 'Сенбі', 'Жексенбі'];
const MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
const ST = {
  in: ['Жұмыста', 'b-in'], out: ['Кетті', 'b-out'], missing_out: ['Кетуі тіркелмеген', 'b-bad'],
  waiting: ['Күтілуде', 'b-off'], not_arrived: ['Әлі келмеген', 'b-late'], absent: ['Келмеді', 'b-bad'],
  off: ['Демалыс', 'b-off'], not_in: ['Әлі келмеген', 'b-off'],
};

// ---------- Көмекшілер ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class UserError extends Error {}

// Сервер — Google Apps Script веб-қосымшасы (config.js ішіндегі TABEL_API)
const TOKEN_KEY = 'tabel_token';
function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {} }
async function api(action, data = {}) {
  if (!window.TABEL_API || /ОСЫ_ЖЕРГЕ/.test(window.TABEL_API)) throw new UserError('Сервер мекенжайы бапталмаған: config.js файлына Google Apps Script сілтемесін қойыңыз.');
  let res, j;
  try {
    // text/plain — браузер қосымша CORS сұранысын жібермеуі үшін
    res = await fetch(window.TABEL_API, { method: 'POST', body: JSON.stringify({ action, token: getToken(), ...data }), redirect: 'follow', cache: 'no-store' });
    j = await res.json();
  } catch {
    throw new UserError('Серверге қосылу мүмкін болмады. Интернетті тексеріп, қайталаңыз. Тіркеу жасалған жоқ.');
  }
  if (!j || !j.ok) {
    const code = j?.code;
    if (code === 401 && S.me && action !== 'login' && action !== 'me') { S.me = null; setToken(null); setTimeout(() => route(), 0); }
    if (j?.tag === 'must_change') location.hash = '#/password';
    throw new UserError(j?.error || 'Сервер қатесі. Тіркеу жасалған жоқ.');
  }
  if (j.data && j.data.token) setToken(j.data.token);
  return j.data;
}
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, 3500);
}
const serverNow = () => Date.now() + S.offset;
function tzParts(ms) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: S.settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}`, sec: o.second };
}
const fTime = (ms) => (ms ? tzParts(ms).time : '—');
function fTimeRel(ms, workDate) {
  if (!ms) return '—';
  const p = tzParts(ms);
  return p.date === workDate ? p.time : `${p.time} <span class="sub">${esc(fDateShort(p.date))}</span>`;
}
const weekdayOf = (d) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const fDateShort = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const fDate = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const fDateLong = (d) => `${WD_FULL[weekdayOf(d)]}, ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
function fDur(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} сағ ${String(m).padStart(2, '0')} мин` : `${m} мин`;
}
const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const toLocalInput = (ms) => { if (!ms) return ''; const p = tzParts(ms); return `${p.date}T${p.time}`; };
const todayStr = () => tzParts(serverNow()).date;
function badge(status, extra = '') { const s = ST[status] || [status, 'b-off']; return `<span class="badge ${s[1]}">${esc(s[0])}</span>${extra}`; }
const lateBadge = (m) => (m > 0 ? ` <span class="badge b-late">+${m} мин</span>` : '');
function schedText(days) {
  if (!days || !days.length) return 'Кесте жоқ';
  const groups = [];
  for (const d of days) {
    const g = groups[groups.length - 1];
    if (g && g.start === d.start && g.end === d.end && g.to === d.weekday - 1) g.to = d.weekday;
    else groups.push({ from: d.weekday, to: d.weekday, start: d.start, end: d.end });
  }
  return groups.map((g) => `${WD[g.from]}${g.to > g.from ? '–' + WD[g.to] : ''} ${g.start}–${g.end}`).join(', ');
}
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
function every(ms, fn) { S.timers.push(setInterval(fn, ms)); }

const ICON_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';

// ---------- Модаль ----------
function modal(html, onMount) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
  onMount && onMount(back, close);
  const first = $('input, select, textarea, button', back); first && first.focus();
  return close;
}
function formError(root, msg) { const e = $('.err', root); if (e) e.textContent = msg || ''; }

// ---------- Маршрут ----------
async function route() {
  clearTimers();
  if (!S.me) {
    if (!getToken()) return viewEntry();
    try {
      const r = await api('me');
      S.me = r.user; S.settings = r.settings; S.offset = r.server_time - Date.now();
    } catch (e) {
      if (/қосылу мүмкін болмады|бапталмаған/.test(e.message)) return viewOffline(e.message);
      setToken(null); return viewEntry();
    }
  }
  if (S.me.must_change_password) return viewPassword(true);
  const h = location.hash || '#/';
  if (h === '#/password') return viewPassword(false);
  if (S.me.role === 'admin') {
    const map = { '#/': viewDashboard, '#/report': viewReport, '#/users': viewUsers, '#/places': viewPlaces, '#/log': viewLog, '#/settings': viewSettings };
    return (map[h] || viewDashboard)();
  }
  return (h === '#/history' ? viewHistory : viewHome)();
}
window.addEventListener('hashchange', route);

function shell(content, active) {
  const admin = S.me.role === 'admin';
  const tabs = admin ? [['#/', 'Бүгін'], ['#/report', 'Есеп'], ['#/users', 'Қызметкерлер'], ['#/places', 'Жұмыс орындары'], ['#/log', 'Журнал'], ['#/settings', 'Баптаулар']]
    : [['#/', 'Басты'], ['#/history', 'Тарих']];
  const nav = tabs.map(([h, t]) => `<a href="${h}" ${h === active ? 'aria-current="page"' : ''}>${t}</a>`).join('');
  document.body.className = admin ? 'adm' : 'emp';
  $('#app').innerHTML = `
    <header class="top"><span class="brand">${esc(S.settings.company_name || 'Табель')}</span>
      <span class="who">${esc(S.me.full_name)}<br><button class="link small" id="logout">Шығу</button></span></header>
    ${admin ? `<nav class="tabs">${nav}</nav>` : ''}
    <main id="main">${content}</main>
    ${admin ? '' : `<nav class="bottom-nav">${nav}</nav>`}`;
  $('#logout').onclick = async () => { try { await api('logout'); } catch {} setToken(null); S.me = null; location.hash = '#/'; route(); };
}

// ---------- Кіру ----------
async function viewEntry() {
  document.body.className = '';
  $('#app').innerHTML = '<div class="boot">Жүктелуде…</div>';
  try {
    const r = await api('setupInfo');
    if (r.needs_setup) return viewSetup();
  } catch (e) { return viewOffline(e.message); }
  viewLogin();
}
function viewOffline(msg) {
  document.body.className = '';
  $('#app').innerHTML = `<div class="login"><div style="max-width:360px"><img class="mark" src="icons/icon-192.png" alt="">
    <h1>Табель</h1><p class="notice bad" style="margin:16px 0">${esc(msg)}</p><button class="btn-primary" id="retry" style="width:100%">Қайталау</button></div></div>`;
  $('#retry').onclick = () => route();
}
function viewSetup() {
  document.body.className = '';
  $('#app').innerHTML = `
    <div class="login"><form id="f">
      <img class="mark" src="icons/icon-192.png" alt="">
      <h1>Алғашқы баптау</h1><p class="muted">Басшы аккаунтын құрыңыз. Бұл бет тек бір рет шығады.</p>
      <div class="field"><label>Компания атауы</label><input id="cn" value="SALTASHOP" required></div>
      <div class="field"><label>Аты-жөніңіз</label><input id="fn" required></div>
      <div class="field"><label>Логин (латынша)</label><input id="u" autocapitalize="none" required placeholder="kanat"></div>
      <div class="field"><label>Құпиясөз (кемінде 6 таңба)</label><input id="p" type="password" autocomplete="new-password" minlength="6" required></div>
      <button class="btn-primary" style="width:100%">Құру және кіру</button><p class="err"></p>
    </form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); formError(e.target, '');
    try {
      await api('setup', { company_name: $('#cn').value, full_name: $('#fn').value, username: $('#u').value, password: $('#p').value });
      S.me = null; location.hash = '#/'; route();
    } catch (err) { formError(e.target, err.message); }
  };
}
function viewLogin() {
  document.body.className = '';
  $('#app').innerHTML = `
    <div class="login"><form id="f" autocomplete="on">
      <img class="mark" src="icons/icon-192.png" alt="">
      <h1>Табель</h1><p class="muted">Жұмысқа келу мен кетуді тіркеу</p>
      <div class="field"><label for="u">Логин</label><input id="u" name="username" autocomplete="username" autocapitalize="none" required></div>
      <div class="field"><label for="p">Құпиясөз</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn-primary" style="width:100%">Кіру</button><p class="err"></p>
    </form></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); formError(e.target, '');
    try {
      await api('login', { username: $('#u').value, password: $('#p').value });
      S.me = null; location.hash = '#/'; route();
    } catch (err) { formError(e.target, err.message); }
  };
}
function viewPassword(forced) {
  const body = `<div class="panel" style="max-width:420px"><form id="f">
      <h2 style="margin-bottom:6px">Құпиясөзді ауыстыру</h2>
      <p class="muted small" style="margin-bottom:16px">${forced ? 'Қауіпсіздік үшін басшы берген уақытша құпиясөзді өзіңіздікіне ауыстырыңыз.' : 'Кемінде 6 таңба.'}</p>
      <div class="field"><label>Қазіргі құпиясөз</label><input id="o" type="password" autocomplete="current-password" required></div>
      <div class="field"><label>Жаңа құпиясөз</label><input id="n" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="field"><label>Жаңа құпиясөзді қайталаңыз</label><input id="n2" type="password" autocomplete="new-password" required></div>
      <button class="btn-primary">Сақтау</button><p class="err"></p></form></div>`;
  shell(body, '');
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#n').value !== $('#n2').value) return formError(e.target, 'Жаңа құпиясөздер сәйкес емес.');
    try {
      await api('changePassword', { old_password: $('#o').value, new_password: $('#n').value });
      S.me.must_change_password = false; toast('Құпиясөз ауыстырылды'); location.hash = '#/'; route();
    } catch (err) { formError(e.target, err.message); }
  };
}

// ---------- Қызметкер: басты бет ----------
async function viewHome() {
  shell('<div class="boot" style="min-height:40vh">Жүктелуде…</div>', '#/');
  let d;
  try { d = await api('today'); } catch (e) { $('#main').innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; return; }
  S.offset = d.server_time - Date.now();
  const r = d.record;
  const canIn = d.status === 'not_in';
  const canOut = d.status === 'in';
  let line = badge(d.status);
  if (r && r.late_min > 0) line += ` <span class="badge b-late">Кешікті ${r.late_min} мин</span>`;
  if (r && r.corrected) line += ' <span class="mark-fix">түзетілген</span>';
  const schedTxt = d.schedule ? `Бүгінгі кесте: ${d.schedule.start}–${d.schedule.end}` : 'Бүгін кесте бойынша демалыс';
  let note = '';
  if (d.status === 'missing_out') note = '<p class="notice bad">Кетуіңіз тіркелмей қалды. Түзету үшін басшыға хабарласыңыз.</p>';
  else if (d.status === 'out') note = '<p class="notice" style="background:var(--out-soft);color:var(--out)">Бүгінгі ауысым аяқталды. Келесі тіркеу — ертең.</p>';
  if (d.stale_missing_out && d.status !== 'missing_out') note += `<p class="notice">${esc(fDate(d.stale_missing_out))} күнгі кетуіңіз тіркелмеген. Басшыға хабарлаңыз.</p>`;
  $('#main').innerHTML = `
    <section class="clock-block"><div class="clock" id="clock"></div><p class="date-line" id="dateLine"></p></section>
    <div class="state">
      <div><div class="k">Келді</div><div class="v">${r ? fTime(r.check_in) : '—'}</div></div>
      <div><div class="k">Кетті</div><div class="v">${r ? fTime(r.check_out) : '—'}</div></div>
      <div><div class="k">Уақыты</div><div class="v" id="dur">${r && r.duration_min != null ? hm(r.duration_min) : '—'}</div></div>
    </div>
    <div class="state-line">${line}</div>
    <p class="muted small">${esc(schedTxt)}</p>
    ${note}
    <div class="slabs">
      <button class="slab slab-in" id="bIn" ${canIn ? '' : 'disabled'}>${ICON_IN}<span>Жұмысқа келдім<small>QR + геолокация</small></span></button>
      <button class="slab slab-out" id="bOut" ${canOut ? '' : 'disabled'}>${ICON_OUT}<span>Жұмыстан кеттім<small>QR-кодты сканерлеу</small></span></button>
    </div>`;
  const tick = () => {
    const p = tzParts(serverNow());
    $('#clock').innerHTML = `${p.time}<span class="sec">${p.sec}</span>`;
    $('#dateLine').textContent = fDateLong(p.date);
    if (r && r.open) {
      const m = Math.max(0, Math.floor((serverNow() - r.check_in) / 60000));
      $('#dur').textContent = hm(m);
    }
  };
  tick(); every(1000, tick);
  $('#bIn').onclick = () => attendanceFlow('in');
  $('#bOut').onclick = () => attendanceFlow('out');
}

// ---------- Геолокация (тек келу сәтінде, бір рет) ----------
function getLocation(onProgress) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new UserError('Бұл браузер геолокацияны қолдамайды.'));
    let best = null, done = false;
    const target = 30; // метр: осыдан дәл болса бірден жібереміз
    const finish = () => {
      if (done) return; done = true; navigator.geolocation.clearWatch(id); clearTimeout(timer);
      if (!best) return reject(new UserError('Геолокация уақытында анықталмады. GPS қосулы екенін тексеріп, ашық жерде қайталаңыз.'));
      resolve({ ...best, age: () => Math.round(best.baseAge + performance.now() - best.recv) });
    };
    const id = navigator.geolocation.watchPosition((p) => {
      let age = Date.now() - p.timestamp;
      if (!(age >= 0 && age < 600000)) age = 0;
      const cur = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, baseAge: age, recv: performance.now() };
      if (!best || cur.accuracy < best.accuracy) best = cur;
      onProgress && onProgress(best.accuracy);
      if (best.accuracy <= target) finish();
    }, (err) => {
      if (done) return;
      if (err.code === 1) { done = true; navigator.geolocation.clearWatch(id); clearTimeout(timer);
        return reject(new UserError('Геолокацияға рұқсат берілмеген. Телефон баптауларында браузерге және осы сайтқа орналасқан жерді анықтауға рұқсат беріп, қайталаңыз.')); }
      if (!best && err.code !== 3) { done = true; navigator.geolocation.clearWatch(id); clearTimeout(timer);
        return reject(new UserError('Геолокация анықталмады. Телефонда GPS (орналасқан жер) қосулы екенін тексеріңіз.')); }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    // Ең көбі 12 секунд дәлірек координатаны күтеміз, содан кейін ең жақсысын жібереміз
    const timer = setTimeout(finish, 12000);
  });
}

// ---------- QR сканер ----------
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
}
async function getDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (f.includes('qr_code')) { const det = new window.BarcodeDetector({ formats: ['qr_code'] }); return async (video) => (await det.detect(video))[0]?.rawValue || null; }
    } catch {}
  }
  if (!window.jsQR) {
    try { await loadScript('vendor/jsQR.js'); } catch {
      try { await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'); } catch {}
    }
  }
  if (!window.jsQR) throw new UserError('QR оқу модулі жүктелмеді. Интернетті тексеріп, бетті жаңартыңыз.');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, 720 / Math.max(w, h));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
  };
}

class ScanScreen {
  constructor(title) {
    this.el = document.createElement('div');
    this.el.className = 'scan';
    this.title = title;
    document.body.append(this.el);
    this.closed = false;
    this.renderWait('Дайындалуда…');
  }
  top() { return `<div class="scan-top"><b>${esc(this.title)}</b><button class="btn-sm" data-cancel>Болдырмау</button></div>`; }
  bindCancel() { $$('[data-cancel]', this.el).forEach((b) => b.onclick = () => this.close()); }
  renderWait(msg, sub = '') {
    this.stopCamera();
    this.el.innerHTML = `${this.top()}<div class="scan-result"><div><div class="spinner"></div><p class="msg">${esc(msg)}</p><p class="sub muted small" style="color:#AEB8C6">${esc(sub)}</p></div></div>`;
    this.bindCancel();
  }
  sub(text) { const s = $('.sub', this.el); if (s) s.textContent = text; }
  async scan() {
    if (!navigator.mediaDevices?.getUserMedia) throw new UserError('Бұл браузерде камераға қол жеткізу мүмкін емес. Chrome (Android) немесе Safari (iPhone) қолданыңыз.');
    this.el.innerHTML = `${this.top()}<div class="scan-view"><video playsinline muted autoplay></video><div class="scan-frame"></div></div>
      <div class="scan-body"><p>Жұмыс орнындағы экрандағы QR-кодты рамкаға түсіріңіз</p><p class="sub"></p></div>`;
    this.bindCancel();
    const video = $('video', this.el);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
      if (this.closed) throw { cancel: true };
      if (e.name === 'NotAllowedError') throw new UserError('Камераға рұқсат берілмеген. Браузер баптауларында осы сайтқа камераны рұқсат етіп, қайталаңыз.');
      if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') throw new UserError('Камера табылмады.');
      throw new UserError('Камераны ашу мүмкін болмады. Басқа қолданба камераны қолданып тұрған жоқ па, тексеріңіз.');
    }
    if (this.closed) { this.stopCamera(); throw { cancel: true }; }
    video.srcObject = this.stream;
    try { await video.play(); } catch {}
    const decode = await getDecoder();
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const loop = async () => {
        if (this.closed) return;
        let v = null;
        try { v = await decode(video); } catch {}
        if (v) {
          if (/^TB2\.\d+\.\d+\.[A-Za-z0-9_-]{22}$/.test(v.trim())) { this.stopCamera(); return resolve(v.trim()); }
          this.sub('Бұл жұмыс орнының QR-коды емес. Экрандағы кодты сканерлеңіз.');
        }
        this.loopTimer = setTimeout(loop, 150);
      };
      loop();
    });
  }
  stopCamera() {
    clearTimeout(this.loopTimer);
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  }
  result(ok, big, msg, actions) {
    this.stopCamera();
    this.el.innerHTML = `${this.top().replace('Болдырмау', 'Жабу')}<div class="scan-result ${ok ? 'ok' : 'fail'}"><div>
      <div class="icon">${ok ? ICON_OK : ICON_X}</div>${big ? `<div class="big">${esc(big)}</div>` : ''}<p class="msg">${msg}</p></div></div>
      <div class="scan-actions">${actions}</div>`;
    this.bindCancel();
  }
  close() {
    this.closed = true; this.stopCamera(); this.el.remove();
    if (this.reject) this.reject({ cancel: true });
    this.onClose && this.onClose();
  }
}

async function attendanceFlow(kind, retry = false) {
  if (kind === 'out' && !retry && !confirm('Жұмыстан кетуді тіркейсіз бе?')) return;
  const sc = new ScanScreen(kind === 'in' ? 'Жұмысқа келдім' : 'Жұмыстан кеттім');
  sc.onClose = () => route();
  try {
    if (!navigator.onLine) throw new UserError('Интернет байланысы жоқ. Тіркеу жасалмады — желіге қосылып, қайталаңыз.');
    if (!window.isSecureContext) throw new UserError('Камера мен геолокация тек қорғалған (HTTPS) байланыс арқылы жұмыс істейді.');
    let geo = null;
    if (kind === 'in') {
      sc.renderWait('Орналасқан жеріңіз анықталуда…', 'Геолокация тек осы тіркеу сәтінде бір рет алынады.');
      geo = await getLocation((acc) => sc.sub(`Дәлдік: ±${Math.round(acc)} м`));
      if (sc.closed) return;
    }
    const qr = await sc.scan();
    sc.renderWait('Серверге жіберілуде…', 'Растау келгенше бетті жаппаңыз.');
    const body = kind === 'in' ? { qr, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, age_ms: geo.age() } : { qr };
    const { record } = await api(kind === 'in' ? 'checkIn' : 'checkOut', body);
    if (sc.closed) return;
    const t = fTime(kind === 'in' ? record.check_in : record.check_out);
    let msg = kind === 'in' ? 'Келуіңіз тіркелді.' : `Кетуіңіз тіркелді. Жұмыс уақыты: ${esc(fDur(record.duration_min))}.`;
    if (kind === 'in' && record.late_min > 0) msg += `<br><span style="color:#F6C177">Кешігу: ${record.late_min} мин (кесте ${esc(record.sched_start)}).</span>`;
    sc.result(true, t, msg, '<button class="primary" data-cancel>Дайын</button>');
  } catch (e) {
    if (e && e.cancel) return;
    if (sc.closed) return;
    sc.result(false, '', esc(e.message || 'Белгісіз қате. Тіркеу жасалған жоқ.'),
      '<button class="primary" id="again">Қайталау</button><button class="ghost" data-cancel>Жабу</button>');
    const a = $('#again', sc.el);
    if (a) a.onclick = () => { sc.onClose = null; sc.close(); attendanceFlow(kind, true); };
  }
}

// ---------- Қызметкер: тарих ----------
async function viewHistory() {
  const today = todayStr();
  const month = today.slice(0, 7);
  shell(`<div class="section-head"><h1 class="grow">Қатысу тарихы</h1><input type="month" id="m" value="${month}" max="${today.slice(0, 7)}" style="width:auto"></div><div id="hist"></div>`, '#/history');
  const load = async (m) => {
    const from = `${m}-01`;
    const [yy, mm] = m.split('-').map(Number);
    const end = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10); // айдың соңғы күні
    const to = end > today ? today : end;
    const el = $('#hist');
    el.innerHTML = '<p class="muted">Жүктелуде…</p>';
    try {
      const { rows, summary } = await api('history', { from, to });
      const s = summary[0] || { days: 0, minutes: 0, late_count: 0, late_min: 0, absent: 0 };
      const list = rows.slice().reverse().map((r) => `<li>
          <div class="d">${fDateShort(r.work_date)}<small>${WD[weekdayOf(r.work_date)]}</small></div>
          <div><div class="times">${r.check_in ? `${fTime(r.check_in)} – ${r.check_out ? fTimeRel(r.check_out, r.work_date) : '…'}` : '—'}</div>
            <div class="small muted">${r.duration_min != null ? fDur(r.duration_min) : ''}${r.corrected ? ' <span class="mark-fix">түзетілген</span>' : ''}</div></div>
          <div>${badge(r.status)}${lateBadge(r.late_min)}</div></li>`).join('');
      el.innerHTML = `<div class="totals">
          <div><div class="v">${s.days}</div><div class="k">күн</div></div>
          <div><div class="v">${Math.round(s.minutes / 6) / 10}</div><div class="k">сағат</div></div>
          <div><div class="v">${s.late_count}</div><div class="k">кешігу</div></div>
          <div><div class="v">${s.absent}</div><div class="k">келмеген</div></div></div>
        ${rows.length ? `<ul class="day-list">${list}</ul>` : '<p class="empty panel">Бұл айда жазба жоқ.</p>'}`;
    } catch (e) { el.innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; }
  };
  $('#m').onchange = (e) => e.target.value && load(e.target.value);
  load(month);
}

// ---------- Басшы: бүгін ----------
let placesCache = null, usersCache = null;
async function places() { if (!placesCache) placesCache = (await api('workplacesList')).rows; return placesCache; }
async function users() { if (!usersCache) usersCache = (await api('usersList')).rows; return usersCache; }
const wpOptions = (list, sel, empty = 'Барлық орын') => `<option value="">${empty}</option>` + list.map((w) => `<option value="${w.id}" ${String(sel) === String(w.id) ? 'selected' : ''}>${esc(w.name)}</option>`).join('');

async function viewDashboard() {
  const today = todayStr();
  shell(`<div class="section-head"><h1 class="grow">Бүгінгі қатысу</h1>
      <input type="date" id="d" value="${today}" style="width:auto"><select id="w" style="width:auto"></select></div>
    <div id="cnt" class="counters"></div><div id="tbl"><p class="muted">Жүктелуде…</p></div>`, '#/');
  try { $('#w').innerHTML = wpOptions(await places(), ''); } catch {}
  const load = async () => {
    try {
      const d = await api('dashboard', { date: $('#d').value, workplace_id: $('#w').value });
      S.offset = d.server_time - Date.now();
      const s = d.summary;
      $('#cnt').innerHTML = `
        <div class="counter c-in"><b>${s.arrived}</b><span>келді</span></div>
        <div class="counter c-late"><b>${s.late}</b><span>кешікті</span></div>
        <div class="counter c-bad"><b>${s.not_arrived}</b><span>келмеген</span></div>
        <div class="counter"><b>${s.at_work}</b><span>жұмыста</span></div>
        <div class="counter c-out"><b>${s.left}</b><span>кетті</span></div>
        ${s.missing_out ? `<div class="counter c-bad"><b>${s.missing_out}</b><span>кетуі тіркелмеген</span></div>` : ''}
        ${s.waiting ? `<div class="counter"><b>${s.waiting}</b><span>күтілуде</span></div>` : ''}`;
      $('#tbl').innerHTML = attendanceTable(d.rows, false);
      bindRowActions($('#tbl'), d.rows, load);
    } catch (e) { $('#tbl').innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; }
  };
  $('#d').onchange = load; $('#w').onchange = load;
  load(); every(60000, load);
}
function attendanceTable(rows, withDate) {
  if (!rows.length) return '<div class="table-wrap"><p class="empty">Жазба жоқ. Алдымен «Қызметкерлер» бөлімінде қызметкер қосыңыз.</p></div>';
  const tr = rows.map((r, i) => `<tr>
    ${withDate ? `<td class="t">${fDate(r.work_date)}<span class="sub">${WD[weekdayOf(r.work_date)]}</span></td>` : ''}
    <td>${esc(r.full_name)}<span class="sub">${esc(r.position || '')}${r.carried ? ' · кешегі ауысым' : ''}</span></td>
    <td>${esc(r.workplace_name || '—')}</td>
    <td class="t">${r.sched_start ? `${r.sched_start}–${r.sched_end}` : '<span class="muted">демалыс</span>'}</td>
    <td>${badge(r.status)}${r.corrected ? ' <span class="mark-fix">түзетілген</span>' : ''}</td>
    <td class="t">${fTime(r.check_in)}</td>
    <td class="t">${r.check_out ? fTimeRel(r.check_out, r.work_date) : (r.status === 'missing_out' ? '<span class="muted">тіркелмеген</span>' : '—')}</td>
    <td class="t">${r.late_min > 0 ? `<span class="badge b-late">${r.late_min} мин</span>` : (r.late_min === 0 ? '0' : '—')}</td>
    <td class="t">${r.duration_min != null ? fDur(r.duration_min) : (r.status === 'missing_out' ? '<span class="muted">есептелмейді</span>' : '—')}</td>
    <td>${r.id ? `<button class="btn-sm" data-edit="${i}">Түзету</button>` : (r.status === 'off' || r.status === 'waiting' ? '' : `<button class="btn-sm" data-add="${i}">Қолмен тіркеу</button>`)}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${withDate ? '<th>Күні</th>' : ''}<th>Қызметкер</th><th>Орны</th><th>Кесте</th><th>Мәртебе</th><th>Келді</th><th>Кетті</th><th>Кешігу</th><th>Уақыты</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>`;
}
function bindRowActions(root, rows, reload) {
  $$('[data-edit]', root).forEach((b) => b.onclick = () => openRecord(rows[b.dataset.edit].id, reload));
  $$('[data-add]', root).forEach((b) => b.onclick = () => openManual(rows[b.dataset.add], reload));
}
const ACT = { create: 'Қолмен қосылды', update: 'Түзетілді', void: 'Жойылды' };
function histItem(h, withName) {
  const fmt = (o) => (o ? `${o.check_in ? fTimeRel(o.check_in, o.work_date) : '—'} – ${o.check_out ? fTimeRel(o.check_out, o.work_date) : '—'}` : '—');
  return `<li><b>${ACT[h.action] || esc(h.action)}</b>${withName ? ` · ${esc(h.target_name || '')}, ${h.new ? fDate(h.new.work_date) : ''}` : ''}<br>
    <span class="muted">${fDate(tzParts(h.created_at).date)} ${fTime(h.created_at)}, ${esc(h.author_name || '—')}</span><br>
    ${h.old ? `Бұрын: ${fmt(h.old)}<br>` : ''}${h.action !== 'void' ? `Жаңа: ${fmt(h.new)}<br>` : ''}Себебі: ${esc(h.reason || '')}</li>`;
}
async function openRecord(id, reload) {
  let d;
  try { d = await api('attendanceGet', { id }); } catch (e) { return toast(e.message, true); }
  const r = d.record;
  modal(`<h2>${esc(r.full_name)}, ${fDate(r.work_date)}</h2>
    <dl class="kv" style="margin-bottom:14px">
      <dt>Кесте</dt><dd>${r.sched_start ? `${r.sched_start}–${r.sched_end}` : 'демалыс'}</dd>
      <dt>Бастапқы жазба</dt><dd>${r.orig_check_in ? fTimeRel(r.orig_check_in, r.work_date) : '—'} – ${r.orig_check_out ? fTimeRel(r.orig_check_out, r.work_date) : '—'}${r.source_in === 'manual' && !r.orig_check_in ? ' (қолмен қосылған)' : ''}</dd>
      ${r.in_distance != null ? `<dt>Келгендегі қашықтық</dt><dd>${Math.round(r.in_distance)} м (дәлдік ±${Math.round(r.in_accuracy)} м)</dd>` : ''}
    </dl>
    <form id="f">
      <div class="row"><div class="field"><label>Келді</label><input type="datetime-local" id="ci" value="${toLocalInput(r.check_in)}" required></div>
      <div class="field"><label>Кетті (бос болса — тіркелмеген)</label><input type="datetime-local" id="co" value="${toLocalInput(r.check_out)}"></div></div>
      <div class="field" style="margin-top:14px"><label>Түзету себебі (міндетті)</label><textarea id="re" required minlength="3" placeholder="Мысалы: GPS қатесі, қызметкер 09:05-те келгені камерадан расталды"></textarea></div>
      <div class="modal-actions"><button class="btn-primary">Сақтау</button><button type="button" class="btn-danger" id="void">Жазбаны жою</button><span class="grow"></span><button type="button" data-close>Жабу</button></div>
      <p class="err"></p>
    </form>
    ${d.history.length ? `<h3 style="margin-top:18px">Өзгерістер тарихы</h3><ul class="hist">${d.history.map((h) => histItem(h)).join('')}</ul>` : ''}`,
  (root, close) => {
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('attendanceUpdate', { id, check_in: $('#ci', root).value, check_out: $('#co', root).value, reason: $('#re', root).value });
        close(); toast('Түзету сақталды'); reload();
      } catch (err) { formError(root, err.message); }
    };
    $('#void', root).onclick = async () => {
      const reason = $('#re', root).value.trim();
      if (reason.length < 3) return formError(root, 'Жою үшін себебін жазыңыз.');
      if (!confirm('Жазба жойылады (тарихта сақталады). Жалғастырасыз ба?')) return;
      try { await api('attendanceVoid', { id, reason }); close(); toast('Жазба жойылды'); reload(); }
      catch (err) { formError(root, err.message); }
    };
  });
}
function openManual(row, reload) {
  const st = row.sched_start || '09:00';
  modal(`<h2>Қолмен тіркеу</h2><p class="muted" style="margin-bottom:14px">${esc(row.full_name)}, ${fDate(row.work_date)}. Мысалы, GPS қатесіне байланысты тіркей алмаған жағдайда.</p>
    <form id="f">
      <div class="row"><div class="field"><label>Келді</label><input type="datetime-local" id="ci" value="${row.work_date}T${st}" required></div>
      <div class="field"><label>Кетті (міндетті емес)</label><input type="datetime-local" id="co"></div></div>
      <div class="field" style="margin-top:14px"><label>Себебі (міндетті)</label><textarea id="re" required minlength="3" placeholder="Мысалы: телефонда GPS дәлдігі жеткіліксіз болды, келгенін аға сатушы растады"></textarea></div>
      <div class="modal-actions"><button class="btn-primary">Сақтау</button><span class="grow"></span><button type="button" data-close>Жабу</button></div><p class="err"></p>
    </form>`, (root, close) => {
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('attendanceCreate', { user_id: row.user_id, work_date: row.work_date, check_in: $('#ci', root).value, check_out: $('#co', root).value || null, reason: $('#re', root).value });
        close(); toast('Жазба қосылды'); reload();
      } catch (err) { formError(root, err.message); }
    };
  });
}

// ---------- Басшы: есеп ----------
async function viewReport() {
  const today = todayStr();
  shell(`<div class="section-head"><h1 class="grow">Есеп</h1></div>
    <div class="panel" style="margin-bottom:14px"><div class="row">
      <div class="field"><label>Басы</label><input type="date" id="from" value="${today.slice(0, 8)}01"></div>
      <div class="field"><label>Соңы</label><input type="date" id="to" value="${today}"></div>
      <div class="field"><label>Қызметкер</label><select id="u"><option value="">Барлығы</option></select></div>
      <div class="field"><label>Жұмыс орны</label><select id="w"></select></div>
    </div>
    <div class="row" style="margin-top:12px;align-items:center">
      <label style="display:flex;gap:8px;align-items:center;margin:0;color:var(--ink)"><input type="checkbox" id="ab" checked> Келмеген күндерді көрсету</label>
      <span style="flex:1"></span><button class="btn-primary" id="go">Көрсету</button><button id="xl">Excel жүктеу</button>
    </div></div>
    <div id="sum"></div><div id="tbl"></div>`, '#/report');
  try {
    $('#u').innerHTML += (await users()).filter((u) => u.role === 'employee').map((u) => `<option value="${u.id}">${esc(u.full_name)}${u.status !== 'active' ? ' (белсенді емес)' : ''}</option>`).join('');
    $('#w').innerHTML = wpOptions(await places(), '');
  } catch {}
  const params = () => ({ from: $('#from').value, to: $('#to').value, user_id: $('#u').value, workplace_id: $('#w').value, absent: $('#ab').checked });
  let last = null;
  $('#xl').onclick = async () => {
    try { const d = last && JSON.stringify(last.p) === JSON.stringify(params()) ? last.d : await api('report', params()); downloadXlsx(d); }
    catch (e) { toast(e.message, true); }
  };
  const load = async () => {
    $('#tbl').innerHTML = '<p class="muted">Жүктелуде…</p>';
    try {
      const p = params();
      const d = await api('report', p);
      last = { p, d };
      $('#sum').innerHTML = d.summary.length ? `<h2 style="margin:4px 0 10px">Жиынтық</h2><div class="table-wrap" style="margin-bottom:18px"><table>
        <thead><tr><th>Қызметкер</th><th>Келген күн</th><th>Сағат</th><th>Кешігу саны</th><th>Кешігу, мин</th><th>Кетуі тіркелмеген</th><th>Келмеген күн</th></tr></thead>
        <tbody>${d.summary.map((x) => `<tr><td>${esc(x.full_name)}</td><td class="t">${x.days}</td><td class="t">${(x.minutes / 60).toFixed(1)}</td>
        <td class="t">${x.late_count}</td><td class="t">${x.late_min}</td><td class="t">${x.missing_out}</td><td class="t">${x.absent}</td></tr>`).join('')}</tbody></table></div>` : '';
      $('#tbl').innerHTML = `<h2 style="margin:4px 0 10px">Күндер бойынша</h2>` + attendanceTable(d.rows, true);
      bindRowActions($('#tbl'), d.rows, load);
    } catch (e) { $('#tbl').innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; }
  };
  $('#go').onclick = load;
  load();
}

// ---------- Басшы: қызметкерлер ----------
async function viewUsers() {
  shell(`<div class="section-head"><h1 class="grow">Қызметкерлер</h1><button class="btn-primary" id="add">Қызметкер қосу</button></div><div id="tbl"><p class="muted">Жүктелуде…</p></div>`, '#/users');
  const load = async () => {
    usersCache = null;
    try {
      const list = await users();
      const stB = { active: ['Белсенді', 'b-in'], blocked: ['Бұғатталған', 'b-late'], disabled: ['Өшірілген', 'b-off'] };
      $('#tbl').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Аты-жөні</th><th>Логин</th><th>Рөлі</th><th>Жұмыс орны</th><th>Кесте</th><th>Мәртебе</th><th></th></tr></thead><tbody>
        ${list.map((u, i) => `<tr><td>${esc(u.full_name)}<span class="sub">${esc(u.position || '')}</span></td><td>${esc(u.username)}</td>
          <td>${u.role === 'admin' ? 'Басшы' : 'Қызметкер'}</td><td>${esc(u.workplace_name || '—')}</td>
          <td class="wrap small">${u.role === 'admin' ? '—' : esc(schedText(u.schedule))}</td>
          <td><span class="badge ${stB[u.status][1]}">${stB[u.status][0]}</span></td>
          <td><button class="btn-sm" data-i="${i}">Өзгерту</button></td></tr>`).join('')}</tbody></table></div>`;
      $$('[data-i]').forEach((b) => b.onclick = () => userForm(list[b.dataset.i], load));
    } catch (e) { $('#tbl').innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; }
  };
  $('#add').onclick = () => userForm(null, load);
  load();
}
async function userForm(u, reload) {
  const wps = await places().catch(() => []);
  const sched = {}; (u?.schedule || []).forEach((d) => { sched[d.weekday] = d; });
  if (!u) for (let w = 1; w <= 6; w++) sched[w] = { start: '09:00', end: '18:00' };
  const rows = [1, 2, 3, 4, 5, 6, 7].map((w) => `<tr><td><label style="display:flex;gap:8px;align-items:center;margin:0;color:var(--ink)">
      <input type="checkbox" data-wd="${w}" ${sched[w] ? 'checked' : ''}> ${WD_FULL[w]}</label></td>
      <td><input type="time" data-s="${w}" value="${sched[w]?.start || '09:00'}"></td><td><input type="time" data-e="${w}" value="${sched[w]?.end || '18:00'}"></td></tr>`).join('');
  const self = u && u.id === S.me.id;
  modal(`<h2>${u ? 'Қызметкерді өзгерту' : 'Жаңа қызметкер'}</h2><form id="f">
    <div class="field"><label>Аты-жөні</label><input id="fn" value="${esc(u?.full_name || '')}" required></div>
    <div class="row"><div class="field"><label>Логин</label><input id="un" value="${esc(u?.username || '')}" ${u ? 'disabled' : 'required'} autocapitalize="none" placeholder="aigerim.s"></div>
      <div class="field"><label>${u ? 'Жаңа құпиясөз (міндетті емес)' : 'Уақытша құпиясөз'}</label><input id="pw" type="text" ${u ? '' : 'required minlength="6"'} autocomplete="off"></div></div>
    <div class="row" style="margin-top:14px"><div class="field"><label>Лауазымы</label><input id="po" value="${esc(u?.position || '')}" placeholder="Сатушы-кеңесші"></div>
      <div class="field"><label>Рөлі</label><select id="ro" ${self ? 'disabled' : ''}><option value="employee">Қызметкер</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Басшы</option></select></div></div>
    <div class="field" style="margin-top:14px"><label>Негізгі жұмыс орны</label><select id="wp">${wpOptions(wps, u?.workplace_id ?? (wps[0]?.id || ''), 'Таңдалмаған')}</select></div>
    <div id="schedBox"><label>Жұмыс кестесі (түн ортасынан өтетін ауысым үшін соңы басынан ерте болады, мысалы 22:00–06:00)</label>
      <table class="sched"><tbody>${rows}</tbody></table>
      <div class="row" style="margin-top:6px"><button type="button" class="btn-sm" id="q1">Дс–Жм 09:00–18:00</button><button type="button" class="btn-sm" id="q2">Дс–Сн 10:00–20:00</button><button type="button" class="btn-sm" id="q3">Күн сайын 10:00–22:00</button></div></div>
    ${u && !self ? `<div class="modal-actions" style="border-top:1px solid var(--line);padding-top:14px">
      ${u.status !== 'active' ? '<button type="button" data-st="active">Белсендіру</button>' : ''}
      ${u.status === 'active' ? '<button type="button" data-st="blocked">Уақытша бұғаттау</button>' : ''}
      ${u.status !== 'disabled' ? '<button type="button" class="btn-danger" data-st="disabled">Аккаунтты өшіру</button>' : ''}</div>` : ''}
    <div class="modal-actions"><button class="btn-primary">Сақтау</button><span class="grow"></span><button type="button" data-close>Жабу</button></div><p class="err"></p></form>`,
  (root, close) => {
    const toggleSched = () => { $('#schedBox', root).style.display = $('#ro', root).value === 'admin' ? 'none' : ''; };
    $('#ro', root).onchange = toggleSched; toggleSched();
    const quick = (days, s, e) => { for (let w = 1; w <= 7; w++) { $(`[data-wd="${w}"]`, root).checked = days.includes(w); $(`[data-s="${w}"]`, root).value = s; $(`[data-e="${w}"]`, root).value = e; } };
    $('#q1', root).onclick = () => quick([1, 2, 3, 4, 5], '09:00', '18:00');
    $('#q2', root).onclick = () => quick([1, 2, 3, 4, 5, 6], '10:00', '20:00');
    $('#q3', root).onclick = () => quick([1, 2, 3, 4, 5, 6, 7], '10:00', '22:00');
    const schedule = () => [1, 2, 3, 4, 5, 6, 7].filter((w) => $(`[data-wd="${w}"]`, root).checked).map((w) => ({ weekday: w, start: $(`[data-s="${w}"]`, root).value, end: $(`[data-e="${w}"]`, root).value }));
    $$('[data-st]', root).forEach((b) => b.onclick = async () => {
      const st = b.dataset.st;
      const q = { blocked: 'Қызметкер жүйеге кіре алмайды, барлық құрылғыдан шығарылады. Жалғастырасыз ба?', disabled: 'Аккаунт өшіріледі (қатысу тарихы сақталады). Жалғастырасыз ба?', active: 'Аккаунтты белсендіресіз бе?' }[st];
      if (!confirm(q)) return;
      try { await api('userUpdate', { id: u.id, status: st }); close(); toast('Мәртебе өзгерді'); reload(); }
      catch (err) { formError(root, err.message); }
    });
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      const body = { full_name: $('#fn', root).value, position: $('#po', root).value, role: $('#ro', root).value, workplace_id: $('#wp', root).value || null };
      if (body.role === 'employee') body.schedule = schedule();
      const pw = $('#pw', root).value;
      if (pw) body.password = pw;
      if (self) delete body.role;
      try {
        if (u) await api('userUpdate', { id: u.id, ...body });
        else await api('userCreate', { ...body, username: $('#un', root).value });
        close(); toast(u ? 'Сақталды' : 'Қызметкер қосылды'); reload();
      } catch (err) { formError(root, err.message); }
    };
  });
}

// ---------- Басшы: жұмыс орындары ----------
function kioskUrl(w) { return new URL(`kiosk.html#wp=${w.id}&k=${w.secret}`, location.href).href; }
async function viewPlaces() {
  shell(`<div class="section-head"><h1 class="grow">Жұмыс орындары</h1><button class="btn-primary" id="add">Орын қосу</button></div>
    <p class="muted small" style="margin-bottom:14px">Әр жұмыс орнында экранды (планшет, монитор немесе ескі телефон) «Экран сілтемесі» арқылы ашып қойыңыз — онда жаңарып тұратын QR-код шығады.</p>
    <div id="list"><p class="muted">Жүктелуде…</p></div>`, '#/places');
  const load = async () => {
    placesCache = null;
    try {
      const list = await places();
      $('#list').innerHTML = list.length ? `<div class="stack">${list.map((w, i) => {
        const url = kioskUrl(w);
        return `<div class="panel place"><div class="section-head" style="margin:0"><h2 class="grow">${esc(w.name)}</h2>${w.active ? '' : '<span class="badge b-off">Өшірілген</span>'}</div>
          <p class="small">${w.lat != null ? `Координата: <span class="num">${w.lat.toFixed(6)}, ${w.lng.toFixed(6)}</span>, радиус ${w.radius_m} м` : '<span class="badge b-bad">Координата бапталмаған — келуді тіркеу мүмкін емес</span>'}</p>
          <div class="place-link">${esc(url)}</div>
          <div class="row"><button class="btn-sm" data-edit="${i}">Өзгерту</button><a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Экранды ашу</a>
            <button class="btn-sm" data-copy="${i}">Сілтемені көшіру</button><button class="btn-sm btn-danger" data-rot="${i}">Сілтемені жаңарту</button></div></div>`;
      }).join('')}</div>` : '<p class="empty panel">Әзірге жұмыс орны жоқ. «Орын қосу» батырмасын басыңыз.</p>';
      $$('[data-edit]').forEach((b) => b.onclick = () => placeForm(list[b.dataset.edit], load));
      $$('[data-copy]').forEach((b) => b.onclick = async () => {
        try { await navigator.clipboard.writeText(kioskUrl(list[b.dataset.copy])); toast('Сілтеме көшірілді'); } catch { toast('Көшіру мүмкін болмады — сілтемені қолмен белгілеңіз', true); }
      });
      $$('[data-rot]').forEach((b) => b.onclick = async () => {
        if (!confirm('Ескі экран сілтемесі мен QR-кодтар бірден жарамсыз болады. Экранда жаңа сілтемені ашу керек болады. Жалғастырасыз ба?')) return;
        try { await api('workplaceRotate', { id: list[b.dataset.rot].id }); toast('Сілтеме жаңартылды'); load(); } catch (e) { toast(e.message, true); }
      });
    } catch (e) { $('#list').innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; }
  };
  $('#add').onclick = () => placeForm(null, load);
  load();
}
function placeForm(w, reload) {
  modal(`<h2>${w ? 'Жұмыс орнын өзгерту' : 'Жаңа жұмыс орны'}</h2><form id="f">
    <div class="field"><label>Атауы</label><input id="nm" value="${esc(w?.name || '')}" required placeholder="SALTASHOP, Тәуке хан даңғылы"></div>
    <div class="row"><div class="field"><label>Ендік (latitude)</label><input id="la" inputmode="decimal" value="${w?.lat ?? ''}" placeholder="42.3155"></div>
      <div class="field"><label>Бойлық (longitude)</label><input id="ln" inputmode="decimal" value="${w?.lng ?? ''}" placeholder="69.5869"></div></div>
    <p style="margin:10px 0 14px"><button type="button" class="btn-sm" id="here">Қазіргі орнымды алу</button> <span class="small muted" id="hereMsg">Дүкеннің ішінде тұрып басыңыз.</span></p>
    <div class="field"><label>Рұқсат етілген радиус, метр</label><input id="ra" type="number" min="20" max="5000" value="${w?.radius_m ?? 100}"></div>
    ${w ? `<label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="ac" ${w.active ? 'checked' : ''}> Белсенді</label>` : ''}
    <div class="modal-actions"><button class="btn-primary">Сақтау</button><span class="grow"></span><button type="button" data-close>Жабу</button></div><p class="err"></p></form>`,
  (root, close) => {
    $('#here', root).onclick = async () => {
      $('#hereMsg', root).textContent = 'Анықталуда…';
      try {
        const g = await getLocation((a) => { $('#hereMsg', root).textContent = `Дәлдік: ±${Math.round(a)} м…`; });
        $('#la', root).value = g.lat.toFixed(6); $('#ln', root).value = g.lng.toFixed(6);
        $('#hereMsg', root).textContent = `Алынды, дәлдігі ±${Math.round(g.accuracy)} м.${g.accuracy > 30 ? ' Дәлдік төмен — терезеге жақындап қайталаңыз немесе картадан координатаны енгізіңіз.' : ''}`;
      } catch (e) { $('#hereMsg', root).textContent = e.message; }
    };
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: $('#nm', root).value, lat: $('#la', root).value.replace(',', '.'), lng: $('#ln', root).value.replace(',', '.'), radius_m: $('#ra', root).value };
      if (w) body.active = $('#ac', root).checked;
      try {
        if (w) await api('workplaceUpdate', { id: w.id, ...body });
        else await api('workplaceCreate', body);
        close(); toast('Сақталды'); reload();
      } catch (err) { formError(root, err.message); }
    };
  });
}

// ---------- Басшы: журнал ----------
async function viewLog() {
  const tab = 'au';
  shell(`<div class="section-head"><h1 class="grow">Журнал</h1>
      <select id="t" style="width:auto"><option value="au">Түзетулер тарихы</option><option value="ev" ${tab === 'ev' ? 'selected' : ''}>Қабылданбаған тіркеу әрекеттері</option></select></div>
    <div id="body"><p class="muted">Жүктелуде…</p></div>`, '#/log');
  const load = async () => {
    const t = $('#t').value;
    try {
      if (t === 'au') {
        const { rows } = await api('audit');
        $('#body').innerHTML = rows.length ? `<div class="panel"><ul class="hist">${rows.map((h) => histItem(h, true)).join('')}</ul></div>` : '<p class="empty panel">Түзету әлі жасалған жоқ.</p>';
      } else {
        const { rows } = await api('events');
        $('#body').innerHTML = rows.length ? `<p class="muted small" style="margin-bottom:10px">Жиі қайталанатын қабылданбаған әрекеттер GPS ақауын немесе жұмыс орнынан тыс жерден тіркелу әрекетін көрсетуі мүмкін.</p>
          <div class="table-wrap"><table><thead><tr><th>Уақыты</th><th>Қызметкер</th><th>Әрекет</th><th>Орны</th><th>Қашықтық</th><th>Себебі</th></tr></thead><tbody>
          ${rows.map((e) => `<tr><td class="t">${fDate(tzParts(e.created_at).date)} ${fTime(e.created_at)}</td><td>${esc(e.full_name || '—')}</td>
          <td>${e.kind === 'check_in' ? 'Келу' : 'Кету'}</td><td>${esc(e.workplace_name || '—')}</td>
          <td class="t">${e.distance != null ? `${Math.round(e.distance)} м` : '—'}${e.accuracy != null ? `<span class="sub">±${Math.round(e.accuracy)} м</span>` : ''}</td>
          <td class="wrap small">${esc(e.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty panel">Қабылданбаған әрекет жоқ.</p>';
      }
    } catch (e) { $('#body').innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; }
  };
  $('#t').onchange = load;
  load();
}

// ---------- Басшы: баптаулар ----------
async function viewSettings() {
  shell('<h1 style="margin-bottom:14px">Баптаулар</h1><div id="body"><p class="muted">Жүктелуде…</p></div>', '#/settings');
  let s;
  try { s = await api('settingsGet'); } catch (e) { $('#body').innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; return; }
  const tzs = s.tz_list || ['Asia/Almaty'];
  $('#body').innerHTML = `<form id="f" class="panel" style="max-width:640px">
    <div class="field"><label>Компания атауы</label><input id="cn" value="${esc(s.company_name)}"></div>
    <div class="field"><label>Уақыт белдеуі</label><select id="tz">${tzs.map((z) => `<option ${z === s.timezone ? 'selected' : ''}>${z}</option>`).join('')}</select></div>
    <div class="row"><div class="field"><label>QR-код жаңару кезеңі, сек</label><input id="qp" type="number" min="10" max="300" value="${s.qr_period_sec}"></div>
      <div class="field"><label>Кешігу саналмайтын минут</label><input id="gm" type="number" min="0" max="120" value="${s.grace_minutes}"></div></div>
    <div class="row" style="margin-top:14px"><div class="field"><label>Геолокацияның ең нашар дәлдігі, м</label><input id="ma" type="number" min="10" max="1000" value="${s.max_accuracy_m}"></div>
      <div class="field"><label>Координатаның ең үлкен жасы, сек</label><input id="la" type="number" min="10" max="600" value="${s.location_max_age_sec}"></div></div>
    <div class="row" style="margin-top:14px"><div class="field"><label>Ауысымның ең ұзақ уақыты, сағ</label><input id="ms" type="number" min="4" max="24" value="${s.max_shift_hours}"></div>
      <div class="field"><label>Жаңа орынның әдепкі радиусы, м</label><input id="dr" type="number" min="20" max="5000" value="${s.default_radius_m}"></div></div>
    <p class="small muted" style="margin-top:12px">QR-код ағымдағы және алдыңғы кезеңде ғана жарамды, яғни экранда пайда болғаннан кейін ең көбі ${s.qr_period_sec * 2} секунд. Келу «ауысымның ең ұзақ уақытынан» көп уақыт жабылмаса, «Кетуі тіркелмеген» деп белгіленеді, жұмыс уақыты есептелмейді.</p>
    <div class="modal-actions"><button class="btn-primary">Сақтау</button><a class="btn" href="#/password">Құпиясөзді ауыстыру</a></div><p class="err"></p></form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('settingsUpdate', { company_name: $('#cn').value, timezone: $('#tz').value, qr_period_sec: $('#qp').value,
        grace_minutes: $('#gm').value, max_accuracy_m: $('#ma').value, location_max_age_sec: $('#la').value, max_shift_hours: $('#ms').value, default_radius_m: $('#dr').value });
      S.settings.company_name = r.company_name; S.settings.timezone = r.timezone; toast('Баптаулар сақталды'); viewSettings();
    } catch (err) { formError(e.target, err.message); }
  };
}

// ---------- Excel ----------
function downloadXlsx(d) {
  const ST_TXT = { out: 'Кетті', in: 'Жұмыста', missing_out: 'Кетуі тіркелмеген', absent: 'Келмеді' };
  const tm = (ms, wd) => { if (!ms) return ''; const p = tzParts(ms); return p.date === wd ? p.time : `${p.time} (${fDate(p.date)})`; };
  const blob = window.XLSX_LITE.build([
    { name: 'Қатысу', widths: [12, 28, 18, 20, 14, 18, 18, 12, 16, 20, 11],
      header: ['Күні', 'Қызметкер', 'Лауазымы', 'Жұмыс орны', 'Кесте', 'Келді', 'Кетті', 'Кешігу, мин', 'Жұмыс уақыты, сағ', 'Мәртебе', 'Түзетілген'],
      rows: d.rows.map((r) => [fDate(r.work_date), r.full_name, r.position || '', r.workplace_name || '', r.sched_start ? `${r.sched_start}–${r.sched_end}` : 'Демалыс',
        tm(r.check_in, r.work_date), tm(r.check_out, r.work_date), r.late_min ?? '', r.duration_min != null ? Math.round(r.duration_min / 60 * 100) / 100 : '',
        ST_TXT[r.status] || r.status, r.corrected ? 'Иә' : '']) },
    { name: 'Жиынтық', widths: [28, 14, 18, 12, 12, 18, 16],
      header: ['Қызметкер', 'Келген күндер', 'Жұмыс уақыты, сағ', 'Кешігу саны', 'Кешігу, мин', 'Кетуі тіркелмеген', 'Келмеген күндер'],
      rows: d.summary.map((x) => [x.full_name, x.days, Math.round(x.minutes / 60 * 100) / 100, x.late_count, x.late_min, x.missing_out, x.absent]) },
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `tabel_${d.from}_${d.to}.xlsx`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Іске қосу ----------
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
window.addEventListener('offline', () => toast('Интернет байланысы жоқ. Тіркеу мүмкін емес.', true));
route();
