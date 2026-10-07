/* Жұмыс орнындағы экран. QR-кодты өзі есептейді (Google Authenticator сияқты):
   HMAC(құпия кілт, уақыт слоты). Сервер уақытымен 10 минут сайын синхрондалады,
   сондықтан интернет қысқа уақыт үзілсе де код шыға береді. */
(function () {
  'use strict';
  const h = new URLSearchParams(location.hash.slice(1));
  const wp = h.get('wp'), key = h.get('k');
  const $ = (id) => document.getElementById(id);
  const STORE = `tabel_kiosk_${wp}`;
  let info = null, offset = 0, lastSlot = null, cryptoKey = null, lastSync = 0;

  const showError = (m) => { $('err').textContent = m || ''; $('err').hidden = !m; };
  if (!wp || !key) { $('place').textContent = 'Сілтеме толық емес'; showError('Басшы панеліндегі «Жұмыс орындары» бөлімінен экран сілтемесін толық ашыңыз.'); return; }
  if (!window.crypto || !crypto.subtle) { showError('Бұл экран тек HTTPS арқылы ашылуы керек.'); return; }

  function apply(d) {
    info = d; offset = d.server_time - d.received_at;
    $('company').textContent = d.company_name || ''; $('place').textContent = d.workplace; document.title = `QR — ${d.workplace}`;
  }
  async function sync() {
    try {
      const t0 = Date.now();
      const r = await fetch(window.TABEL_API, { method: 'POST', body: JSON.stringify({ action: 'kioskInfo', wp, k: key }), cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) { if (j.code === 403) { localStorage.removeItem(STORE); info = null; $('qr').classList.add('hide'); showError(j.error); } return; }
      const t1 = Date.now();
      const d = { ...j.data, received_at: Math.round((t0 + t1) / 2) };
      try { localStorage.setItem(STORE, JSON.stringify(d)); } catch {}
      apply(d); showError(''); lastSync = Date.now();
    } catch {
      if (!info) showError('Серверге қосылу жоқ. Экран алғаш рет интернетке қосылуы керек.');
    }
  }
  async function sign(slot) {
    if (!cryptoKey) cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`TB2.${wp}.${slot}`)));
    let bin = ''; sig.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22);
  }
  async function tick() {
    if (!info) return;
    const now = Date.now() + offset, period = info.period_sec * 1000, slot = Math.floor(now / period);
    $('clock').textContent = new Intl.DateTimeFormat('kk-KZ', { timeZone: info.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
    $('bar').style.transform = `scaleX(${((slot + 1) * period - now) / period})`;
    if (slot !== lastSlot) {
      lastSlot = slot;
      $('qr').innerHTML = window.QR.toSvg(`TB2.${wp}.${slot}.${await sign(slot)}`, 4);
      $('qr').classList.remove('hide');
    }
    // 12 сағат синхрондалмаса, сағат ауытқуы мүмкін — ескерту
    if (lastSync && Date.now() - lastSync > 12 * 3600e3) showError('Сервермен уақыт синхрондалмағанына 12 сағаттан асты. Интернетті тексеріңіз.');
  }
  try { const c = JSON.parse(localStorage.getItem(STORE) || 'null'); if (c) apply(c); } catch {}
  sync(); setInterval(sync, 10 * 60e3);
  setInterval(tick, 250);
  let wake = null;
  const keepAwake = async () => { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch {} };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); sync(); } });
  keepAwake();
})();
