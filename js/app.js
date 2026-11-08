'use strict';
/* =====================================================================
 *  Jimpitan RT — js/app.js  (frontend statis untuk GitHub Pages)
 *  Backend: Google Apps Script REST API (alamat di js/config.js).
 *  Performa (gas-instant-ux-pro): login = bootstrap 1 panggilan, SWR + cache
 *  lokal, sesi bertahan saat refresh, dedupe in-flight, retry + reqId idempoten,
 *  timeout, antrean offline jimpitan, polling adaptif, lazy-load pustaka berat.
 * ===================================================================== */
'use strict';

/* ---------- Util ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = n => 'Rp\u00a0' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const BLN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const pad = n => (n < 10 ? '0' : '') + n;
const fmtD = s => { if (!s) return '-'; const a = String(s).slice(0, 10).split('-'); return a.length === 3 ? (+a[2]) + ' ' + BLN[+a[1] - 1].slice(0, 3) + ' ' + a[0] : s; };
const fmtYm = ym => { const a = String(ym).split('-'); return BLN[+a[1] - 1] + ' ' + a[0]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const ini = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const isStaff = () => !!S.user && (S.user.role === 'admin' || S.user.role === 'pengurus');
const isAdmin = () => !!S.user && S.user.role === 'admin';
const isRonda = () => !!S.user && S.user.role !== 'warga';
const STAT = { lunas: 'Lunas', kurang: 'Kurang', belum: 'Belum', depan: 'Dimuka', na: '-' };
const sb = s => '<span class="sb ' + s + '">' + (STAT[s] || s) + '</span>';
const dAdd = (ymd, n) => { const a = ymd.split('-'); const d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
const ymEnd = ym => { const a = ym.split('-'); return new Date(Date.UTC(+a[0], +a[1], 0)).getUTCDate(); };
const ymAdd = (ym, n) => { const a = ym.split('-'); const t = (+a[0]) * 12 + (+a[1] - 1) + n; return Math.floor(t / 12) + '-' + pad(t % 12 + 1); };
const numOf = el => Number(String((el && el.value) || '').replace(/\D/g, '')) || 0;
const fmtNum = n => n ? Number(n).toLocaleString('id-ID') : '';

/* ---------- State & penyimpanan lokal aman ---------- */
const S = { token: null, user: null, boot: null, offset: 0, page: null, loaded: {}, wargaList: null };
const PAGES = {};
const ACT = {};
const TABS = {};
const Store = {
  p: 'sikas:v2:',
  g(k, d) { try { const v = localStorage.getItem(this.p + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  s(k, v) { try { localStorage.setItem(this.p + k, JSON.stringify(v)); } catch (e) { /* penuh/diblokir */ } },
  d(k) { try { localStorage.removeItem(this.p + k); } catch (e) { /* abaikan */ } },
  clearCache() { try { Object.keys(localStorage).filter(k => k.indexOf(this.p + 'c:') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* abaikan */ } }
};

/* ---------- Waktu Jakarta (dikoreksi selisih jam server) ---------- */
function jkt() {
  const d = new Date(Date.now() + S.offset);
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const h = p.hour === '24' ? 0 : +p.hour;
  return { ymd: p.year + '-' + p.month + '-' + p.day, min: h * 60 + (+p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const todayJ = () => jkt().ymd;
const hmMin = s => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
function jadwalNow(regu) {
  if (!regu) return { aktif: false, pesan: 'Akun ini belum ditautkan ke regu ronda. Hubungi admin.' };
  const n = jkt(), days = String(regu.hari_aktif || '').split(',').map(s => s.trim()).filter(Boolean);
  const ms = hmMin(regu.jam_mulai), se = hmMin(regu.jam_selesai);
  const dn = HARI[n.dow], yn = HARI[(n.dow + 6) % 7];
  let aktif = false, tanggal = n.ymd;
  if (se > ms) aktif = days.includes(dn) && n.min >= ms && n.min < se;
  else if (days.includes(dn) && n.min >= ms) aktif = true;
  else if (days.includes(yn) && n.min < se) { aktif = true; tanggal = dAdd(n.ymd, -1); }
  return { aktif, tanggal, pesan: aktif ? '' : 'Input dibuka hari ' + (days.join(', ') || '-') + ' pukul ' + regu.jam_mulai + '–' + regu.jam_selesai };
}

/** Jadwal pengguna: aktif bila salah satu regu tempat ia menjadi anggota sedang bertugas (cermin logika server). */
function jadwalUser() {
  const ids = (S.user && S.user.regu_ids) || [], rgs = S.boot.regu.filter(r => ids.includes(r.id));
  if (!rgs.length) return { aktif: false, regu: null, pesan: 'Anda belum terdaftar sebagai anggota regu ronda. Hubungi admin.' };
  const js = rgs.map(r => Object.assign({ regu: r }, jadwalNow(r)));
  return js.find(j => j.aktif) || { aktif: false, regu: rgs[0], pesan: 'Input dibuka ' + js.map(j => j.pesan.replace(/^Input dibuka /, '')).join(' / ') };
}

/* ---------- Muat pustaka berat hanya saat dibutuhkan ---------- */
const _scripts = {};
function loadScript(urls) {
  urls = [].concat(urls);
  const key = urls[0];
  if (_scripts[key]) return _scripts[key];
  _scripts[key] = new Promise((res, rej) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) { delete _scripts[key]; return rej(new Error('Gagal memuat pustaka. Periksa koneksi internet.')); }
      const s = document.createElement('script');
      s.src = urls[i++]; s.async = true; s.onload = () => res(); s.onerror = next;
      document.head.appendChild(s);
    };
    next();
  });
  return _scripts[key];
}
const LIB = {
  chart: ['https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.3/chart.umd.min.js'],
  scan: ['https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js', 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'],
  qr: ['https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js']
};

/* ---------- Indikator, toast, modal ---------- */
let _prog = 0;
function prog(d) {
  _prog = Math.max(0, _prog + d);
  const b = $('#prog');
  if (_prog > 0) { b.style.opacity = 1; b.style.width = '70%'; }
  else { b.style.width = '100%'; setTimeout(() => { if (_prog === 0) { b.style.opacity = 0; b.style.width = '0'; } }, 250); }
}
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast-i ' + (type || 'ok');
  el.innerHTML = '<i class="bi ' + (type === 'err' ? 'bi-x-circle-fill' : type === 'warn' ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill') + '"></i><span>' + esc(msg) + '</span>';
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = 0; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, type === 'err' ? 4800 : 2600);
}
const Mdl = {
  open(o) {
    $('#mdlTitle').textContent = o.title || '';
    $('#mdlBody').innerHTML = o.body || '';
    const f = $('#mdlFoot'); f.innerHTML = o.foot || ''; f.style.display = o.foot ? '' : 'none';
    this.inst = bootstrap.Modal.getOrCreateInstance($('#mdl'));
    this.inst.show();
    if (o.onShow) o.onShow($('#mdlBody'));
  },
  close() { if (this.inst) this.inst.hide(); }
};
function confirmBox(msg, okText, danger) {
  return new Promise(res => {
    const d = document.createElement('div');
    d.className = 'modal fade sheet'; d.tabIndex = -1; d.style.zIndex = 1100;
    d.innerHTML = '<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-body"><p class="mb-0" style="font-size:16px">' + esc(msg) + '</p></div><div class="modal-footer"><button class="btn btn-ghost" data-r="0">Batal</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-brand') + '" data-r="1">' + esc(okText || 'Ya') + '</button></div></div></div>';
    document.body.appendChild(d);
    const m = new bootstrap.Modal(d, { backdrop: 'static' });
    let val = false;
    d.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { val = b.dataset.r === '1'; m.hide(); } });
    d.addEventListener('hidden.bs.modal', () => { d.remove(); res(val); });
    m.show();
  });
}
async function act(btn, fn) {
  if (btn && btn.disabled) return;
  const h = btn && btn.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
  try { return await fn(); }
  catch (e) { toast(e.message || 'Terjadi kesalahan.', 'err'); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = h; } }
}

/* ---------- Lapisan API: dedupe, retry, timeout, reqId, telemetri ---------- */
class ApiErr extends Error { constructor(m, code) { super(m); this.code = code; } }
const Perf = { n: 0, tot: 0, srv: 0, slow: [] };
let _epoch = 0;
const _inflight = {};

async function rawCall(body, ms) {
  if (typeof CFG === 'undefined' || !/^https:\/\/script\.google\.com\/.+\/exec$/.test(CFG.GAS_URL || '')) throw new ApiErr('Alamat API belum diatur. Isi GAS_URL di js/config.js.', 'CONFIG');
  const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), ms || 45000);
  try {
    // text/plain = "simple request": tanpa preflight CORS (wajib untuk Google Apps Script)
    const res = await fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (e) { throw new Error('Respons server tidak valid'); }
  } finally { clearTimeout(to); }
}

async function api(action, p, o) {
  p = JSON.parse(JSON.stringify(p || {})); o = o || {}; // buang nilai undefined
  const write = !!o.write;
  const reqId = write ? (o.reqId || uid()) : null;
  const run = async () => {
    const t0 = performance.now();
    prog(1);
    try {
      for (let i = 0; ; i++) {
        try {
          const r = await rawCall({ action, token: S.token, p, reqId }, write ? 90000 : 45000);
          if (r && r.tk) { S.token = r.tk; Sess.save(); }
          if (r) { Perf.n++; Perf.tot += performance.now() - t0; Perf.srv += r.ms || 0; if ((r.ms || 0) > 3000) Perf.slow.push(action + ' ' + r.ms + 'ms'); }
          if (!r || !r.success) {
            if (r && r.code === 'AUTH') { sessionEnd(true); }
            throw new ApiErr((r && r.message) || 'Gagal memproses.', r && r.code);
          }
          return r.data;
        } catch (e) {
          if (e instanceof ApiErr) throw e;
          if (i >= 2) throw new Error('Koneksi bermasalah. Periksa internet lalu coba lagi.');
          await sleep(700 * (i + 1));
        }
      }
    } finally { prog(-1); }
  };
  if (write) { _epoch++; return run(); }
  const k = _epoch + '|' + action + '|' + JSON.stringify(p);
  if (_inflight[k]) return _inflight[k];
  const pr = run();
  _inflight[k] = pr;
  pr.then(() => delete _inflight[k], () => delete _inflight[k]);
  return pr;
}
const apiW = (action, p, o) => api(action, p, Object.assign({ write: true }, o || {}));

/** Batch: beberapa aksi baca dalam 1 round-trip (maks 8). */
async function apiBatch(list) {
  const r = await api('batch', { calls: list.map(x => ({ a: x[0], p: x[1] || {} })) });
  return r;
}

/** Stale-While-Revalidate: tampilkan cache lokal seketika, segarkan di latar. */
function swr(key, fetcher, render) {
  const k = 'c:' + (S.user ? S.user.id : 'x') + ':' + key;
  const c = Store.g(k, null);
  if (c) render(c, true);
  return fetcher().then(d => {
    if (!c || JSON.stringify(c) !== JSON.stringify(d)) { Store.s(k, d); render(d, false); }
    return d;
  }).catch(e => { if (!c) throw e; });
}

/* ---------- Tema ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-bs-theme', t);
  Store.s('theme', t);
  const ic = $('#themeIco'); if (ic) ic.className = 'bi ' + (t === 'dark' ? 'bi-sun' : 'bi-moon-stars');
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#08101f' : '#2563eb';
}
const toggleTheme = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

/* ---------- Segmen/tab ringkas ---------- */
function tabsHtml(grp, items, active) {
  return '<div class="seg" role="tablist">' + items.map(i => '<button type="button" role="tab" data-act="tab" data-grp="' + grp + '" data-v="' + i[0] + '" class="' + (i[0] === active ? 'on' : '') + '">' + i[1] + '</button>').join('') + '</div>';
}
ACT.tab = b => {
  $$('[data-act="tab"][data-grp="' + b.dataset.grp + '"]').forEach(x => x.classList.toggle('on', x === b));
  if (TABS[b.dataset.grp]) TABS[b.dataset.grp](b.dataset.v);
};
const skel = n => Array.from({ length: n || 4 }, () => '<div class="sk"></div>').join('');
const emptyH = (ic, t) => '<div class="empty"><i class="bi bi-' + ic + '"></i>' + esc(t) + '</div>';

/* ---------- Navigasi ---------- */
const NAV = [
  { id: 'dashboard', t: 'Beranda', i: 'house-door' },
  { id: 'jimpitan', t: 'Jimpitan', i: 'moon-stars' },
  { id: 'iuran', t: 'Iuran', i: 'cash-coin' },
  { id: 'arisan', t: 'Arisan', i: 'gift' },
  { id: 'kas', t: 'Kas RT', i: 'journal-text' },
  { id: 'tunggakan', t: 'Tunggakan', i: 'exclamation-circle', r: ['admin', 'pengurus'] },
  { id: 'laporan', t: 'Laporan', i: 'file-earmark-bar-graph' },
  { id: 'master', t: 'Master Data', i: 'database', r: ['admin'] },
  { id: 'pengaturan', t: 'Pengaturan', i: 'gear', r: ['admin'] }
];
const BOTTOM = {
  admin: ['dashboard', 'jimpitan', 'iuran', 'kas', 'arisan', 'menu'], pengurus: ['dashboard', 'jimpitan', 'iuran', 'kas', 'arisan', 'menu'],
  petugas: ['dashboard', 'jimpitan', 'iuran', 'arisan', 'laporan', 'menu'], warga: ['dashboard', 'jimpitan', 'iuran', 'arisan', 'laporan', 'menu']
};
const navAllowed = () => NAV.filter(n => !n.r || n.r.includes(S.user.role));
const navTitle = id => {
  if (id === 'menu') return 'Menu';
  if (id === 'jimpitan' && S.user.role === 'warga') return 'Kalender Jimpitan';
  if (id === 'kas' && S.user.role === 'warga') return 'Laporan Kas';
  const n = NAV.find(x => x.id === id); return n ? n.t : id;
};
function buildNav() {
  const al = navAllowed();
  $('#sbNav').innerHTML = al.map(n => '<button class="sb-link" data-act="nav" data-p="' + n.id + '"><i class="bi bi-' + n.i + '"></i><span>' + navTitle(n.id) + '</span></button>').join('');
  $('#bottomNav').innerHTML = BOTTOM[S.user.role].map(id => {
    const n = id === 'menu' ? { i: 'grid' } : NAV.find(x => x.id === id);
    return '<button class="bn" data-act="nav" data-p="' + id + '"><i class="bi bi-' + n.i + '"></i><span>' + (id === 'jimpitan' && S.user.role === 'warga' ? 'Kalender' : navTitle(id)) + '</span></button>';
  }).join('');
  $('#sbRt').textContent = S.boot.cfg.NAMA_RT;
}
ACT.nav = b => nav(b.dataset.p);
/** Router hash (#/kas): tombol Back Android & tautan langsung berfungsi. */
function nav(id) { if (location.hash !== '#/' + id) location.hash = '/' + id; else show(id); }
window.addEventListener('hashchange', () => { if (S.token && S.boot) show(location.hash.replace(/^#\//, '') || 'dashboard'); });
function show(id) {
  if (id !== 'menu' && !navAllowed().some(n => n.id === id)) { if (!S.page) show('dashboard'); return; }
  if (!PAGES[id]) return;
  if (S.page === 'jimpitan' && id !== 'jimpitan' && typeof JP !== 'undefined' && JP.scanning) stopScan(); // hemat baterai & privasi
  $$('.page').forEach(p => p.classList.remove('on'));
  $('#pg-' + id).classList.add('on');
  S.page = id;
  $$('[data-act="nav"]').forEach(b => b.classList.toggle('on', b.dataset.p === id || (id === 'menu' && b.dataset.p === 'menu')));
  $('#pgTitle').textContent = navTitle(id);
  $('#pgSub').textContent = S.boot.cfg.NAMA_RT;
  const pg = PAGES[id];
  if (!S.loaded[id]) { S.loaded[id] = Date.now(); pg.init && pg.init(); pg.load && pg.load(); }
  else if (Date.now() - S.loaded[id] > 60000) { S.loaded[id] = Date.now(); pg.load && pg.load(true); }
  window.scrollTo(0, 0);
  if (pg.onEnter) pg.onEnter();
}
const reloadPage = () => { if (S.page && PAGES[S.page] && PAGES[S.page].load) { S.loaded[S.page] = Date.now(); PAGES[S.page].load(true); } };
function invalidate() { S.loaded = {}; if (S.page) S.loaded[S.page] = Date.now(); }

/* ---------- Polling adaptif (hanya petugas/pengurus/admin, tab aktif) ---------- */
const Poll = {
  t: null, iv: 15000, last: null,
  start() { this.stop(); if (!isRonda()) return; this.iv = 15000; this.t = setTimeout(() => this.tick(), this.iv); },
  stop() { clearTimeout(this.t); this.t = null; },
  async tick() {
    if (!S.token) return;
    if (document.visibilityState === 'visible' && ['dashboard', 'jimpitan', 'kas'].includes(S.page)) {
      try {
        const r = await api('versi');
        if (this.last && r.v !== this.last) { this.iv = 15000; if (!_busy()) reloadPage(); } else this.iv = Math.min(60000, Math.round(this.iv * 1.5));
        this.last = r.v;
      } catch (e) { this.iv = 60000; }
    } else this.iv = 60000;
    this.t = setTimeout(() => this.tick(), this.iv);
  }
};
const _busy = () => document.body.classList.contains('modal-open') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));

/* ---------- Sesi: token disimpan lokal agar tetap masuk saat halaman dimuat ulang ---------- */
const Sess = {
  save() { if (S.token) Store.s('sess', { token: S.token }); },
  clear() { Store.d('sess'); },
  info(tok) { try { const p = atob(String(tok).split('.')[0].replace(/-/g, '+').replace(/_/g, '/')).split('.'); return { uid: p[0], exp: +p[1] }; } catch (e) { return null; } }
};
function showLogin(msg) {
  $('#app').classList.remove('show'); $('#app').style.display = 'none';
  $('#login').style.display = 'flex';
  $('#lgPin').value = '';
  const e = $('#lgErr');
  if (msg) { e.classList.remove('d-none-i'); e.querySelector('span').textContent = msg; } else e.classList.add('d-none-i');
}
function sessionEnd(expired) {
  if (!S.token) return;
  Poll.stop(); Store.clearCache(); Sess.clear();
  if (typeof JP !== 'undefined' && JP.scanning) stopScan();
  S.token = null; S.user = null; S.boot = null; S.loaded = {}; S.wargaList = null; S.page = null;
  $$('.page').forEach(p => { p.innerHTML = ''; p.classList.remove('on'); });
  try { Mdl.close(); } catch (e) { /* abaikan */ }
  showLogin(expired ? 'Sesi berakhir, silakan masuk lagi.' : '');
}
async function loginReq(username, pin) {
  for (let i = 0; ; i++) {
    try { return await rawCall({ action: 'login', username, pin }, 45000); }
    catch (e) { if (e instanceof ApiErr || i >= 1) throw e; await sleep(800); }
  }
}
function startApp(data, cached) {
  S.token = data.token; S.boot = data.boot; S.user = data.boot.user;
  S.offset = cached ? 0 : data.boot.serverNow - Date.now();
  Sess.save(); Store.s('c:' + S.user.id + ':boot', data.boot);
  $('#login').style.display = 'none';
  const a = $('#app'); a.style.display = ''; a.classList.add('show');
  buildNav();
  Pending.load();
  const h = location.hash.replace(/^#\//, '');
  nav(h && (h === 'menu' || navAllowed().some(n => n.id === h)) ? h : 'dashboard');
  Poll.start(); Pending.flush();
  if (data.pinDefault) setTimeout(() => { toast('Anda masih memakai PIN bawaan. Segera ganti PIN.', 'warn'); ACT.pin(); }, 800);
}
/** Pulihkan sesi: tampilkan cache boot seketika (SWR), segarkan di latar. */
async function restoreSession() {
  const ss = Store.g('sess', null), inf = ss && Sess.info(ss.token);
  if (!inf || !inf.exp || inf.exp < Date.now() + 60000) { Sess.clear(); return; }
  S.token = ss.token;
  const cb = Store.g('c:' + inf.uid + ':boot', null);
  if (cb) {
    startApp({ token: ss.token, boot: cb }, true);
    try {
      const b = await api('boot');
      if (!S.token) return;
      S.boot = b; S.user = b.user; S.offset = b.serverNow - Date.now(); Store.s('c:' + b.user.id + ':boot', b); buildNav();
    } catch (e) { /* offline: tetap pakai cache */ }
  } else {
    showLogin('Memulihkan sesi…');
    try { const b = await api('boot'); startApp({ token: S.token, boot: b }); }
    catch (e) { if (e.code !== 'AUTH') { S.token = null; showLogin(e.message); } }
  }
}
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const u = $('#lgUser').value.trim(), p = $('#lgPin').value.trim(), er = $('#lgErr'), btn = $('#lgBtn');
  er.classList.add('d-none-i');
  if (!u || !p) { er.classList.remove('d-none-i'); er.querySelector('span').textContent = 'Isi username dan PIN.'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Masuk…';
  try {
    const r = await loginReq(u, p);
    if (!r.success) throw new ApiErr(r.message);
    Store.s('lastUser', u);
    startApp(r.data);
  } catch (x) {
    er.classList.remove('d-none-i');
    er.querySelector('span').textContent = x instanceof ApiErr ? x.message : 'Tidak dapat menghubungi server. Periksa koneksi internet.';
  } finally { btn.disabled = false; btn.innerHTML = '<span>Masuk</span>'; }
});
$('#lgEye').addEventListener('click', () => { const i = $('#lgPin'); i.type = i.type === 'password' ? 'text' : 'password'; });
$('#lgTheme').addEventListener('click', toggleTheme);
$('#btnTheme').addEventListener('click', toggleTheme);
$('#btnRefresh').addEventListener('click', () => { invalidate(); reloadPage(); toast('Memuat ulang…', 'ok'); });
ACT.theme = toggleTheme;
ACT.logout = async () => { if (await confirmBox('Keluar dari aplikasi?', 'Keluar')) sessionEnd(false); };
ACT.pin = () => {
  Mdl.open({
    title: 'Ganti PIN',
    body: '<div class="mb-3"><label class="form-label">PIN lama</label><input class="form-control" id="pnOld" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password"></div>' +
      '<div class="mb-3"><label class="form-label">PIN baru (4–8 digit)</label><input class="form-control" id="pnNew" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>' +
      '<div class="mb-1"><label class="form-label">Ulangi PIN baru</label><input class="form-control" id="pnNew2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div>',
    foot: '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="pnOk">Simpan PIN</button>',
    onShow() {
      $('#pnOk').onclick = ev => act(ev.currentTarget, async () => {
        const o = $('#pnOld').value, n = $('#pnNew').value, n2 = $('#pnNew2').value;
        if (!/^\d{4,8}$/.test(n)) throw new Error('PIN baru harus 4–8 digit angka.');
        if (n !== n2) throw new Error('Ulangi PIN tidak sama.');
        await apiW('gantiPin', { lama: o, baru: n });
        Mdl.close(); toast('PIN berhasil diganti.');
      });
    }
  });
};
window.addEventListener('online', () => { $('#offline').classList.remove('on'); Pending.flush(); });
window.addEventListener('offline', () => $('#offline').classList.add('on'));

/* ---------- Event delegasi tunggal ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || !ACT[b.dataset.act]) return;
  ACT[b.dataset.act](b, e);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t && t.matches && t.matches('[data-money]')) { const d = t.value.replace(/\D/g, ''); t.value = d ? Number(d).toLocaleString('id-ID') : ''; }
});

/* ===================================================================
 *  DASHBOARD
 * =================================================================== */
let _chart = null;
PAGES.dashboard = {
  init() { $('#pg-dashboard').innerHTML = '<div class="hero"><div class="sk" style="background:rgba(255,255,255,.2);height:120px"></div></div><div class="c mt-3">' + skel(5) + '</div>'; },
  load() {
    const el = $('#pg-dashboard');
    return swr('dash', () => api('dashboard'), d => { S.boot.dashboard = d; el.innerHTML = dashHtml(d); drawChart(d.bulan); })
      .catch(e => { el.innerHTML = emptyH('wifi-off', e.message); });
  }
};
function greetHtml() {
  const u = S.user, h = Math.floor(jkt().min / 60);
  const sal = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  const peran = u.role === 'petugas' && u.base === 'warga' ? 'Warga · Petugas ronda' : ({ admin: 'Admin', pengurus: 'Pengurus RT', warga: 'Warga', petugas: 'Petugas ronda' })[u.role];
  return '<div class="greet"><div><small>' + sal + ' 👋</small><b>' + esc(u.nama) + '</b></div><span class="sb info">' + esc(peran) + '</span></div>';
}
function qaHtml() {
  const staff = [['jimpitan', 'qr-code-scan', 'Scan jimpitan'], ['iuran', 'cash-coin', 'Catat iuran'], ['kas', 'journal-text', 'Transaksi'], ['tunggakan', 'exclamation-circle', 'Tunggakan']];
  const L = {
    admin: staff, pengurus: staff,
    petugas: [['jimpitan', 'qr-code-scan', 'Scan jimpitan'], ['iuran', 'cash-coin', 'Iuran saya'], ['kas', 'journal-text', 'Kas RT'], ['laporan', 'file-earmark-bar-graph', 'Laporan']],
    warga: [['jimpitan', 'calendar-check', 'Kalender'], ['iuran', 'cash-coin', 'Iuran saya'], ['kas', 'journal-text', 'Kas RT'], ['laporan', 'file-earmark-bar-graph', 'Laporan']]
  }[S.user.role] || [];
  return '<div class="qa">' + L.map(x => '<button type="button" data-act="nav" data-p="' + x[0] + '"><span class="qi"><i class="bi bi-' + x[1] + '"></i></span>' + x[2] + '</button>').join('') + '</div>';
}
function dashHtml(d) {
  const u = S.user, c = S.boot.cfg;
  let h = greetHtml() + '<div class="hero"><div class="lbl">Saldo total kas ' + esc(c.NAMA_RT) + '</div><div class="big num">' + rp(d.total) + '</div>' +
    '<div class="row2"><div class="pill"><span>Masuk bulan ini</span><b class="num">' + rp(d.bulanIni.masuk) + '</b></div><div class="pill"><span>Keluar bulan ini</span><b class="num">' + rp(d.bulanIni.keluar) + '</b></div></div></div>';
  h += qaHtml();
  if (d.saya) {
    const s = d.saya;
    h += '<div class="c"><h6 class="c-t">Status saya <span class="sb info">No. ' + esc(s.no_rumah) + '</span></h6>' +
      '<div class="list-i"><div class="dot"><i class="bi bi-moon-stars"></i></div><div class="grow"><div class="t">Jimpitan</div><div class="s">' + (s.jimpitan.sampai ? 'Terbayar sampai ' + fmtD(s.jimpitan.sampai) : 'Belum ada setoran') + '</div></div>' +
      (s.jimpitan.tunggakan > 0 ? '<div class="text-end"><div class="amt out">' + rp(s.jimpitan.tunggakan) + '</div><div class="s muted" style="font-size:11px">' + s.jimpitan.hariTunggak + ' hari</div></div>' : sb('lunas')) + '</div>' +
      s.iuran.map(i => '<div class="list-i"><div class="dot"><i class="bi bi-cash-coin"></i></div><div class="grow"><div class="t">' + esc(i.nama) + '</div><div class="s">' + (i.kind === 'bulanan' ? 'Bulan ini' : i.kind === 'sekali' ? 'Sekali bayar' : 'Kegiatan') + ' · ' + rp(i.terbayar) + (i.tagihan ? ' / ' + rp(i.tagihan) : '') + '</div></div>' + sb(i.status) + '</div>').join('') + '</div>';
  }
  h += '<div class="c"><h6 class="c-t">Pemasukan vs pengeluaran</h6><div style="height:210px"><canvas id="chBulan" aria-label="Grafik pemasukan dan pengeluaran 6 bulan"></canvas></div></div>';
  if (d.insight.length) h += '<div class="c"><h6 class="c-t">Insight otomatis</h6>' + d.insight.map(i => '<div class="insight ' + i.tone + '"><i class="bi bi-' + ({ people: 'people', moon: 'moon-stars', flag: 'flag', trend: 'graph-up-arrow' }[i.icon] || 'info-circle') + '"></i><div>' + esc(i.text) + '</div></div>').join('') + '</div>';
  h += '<div class="c"><h6 class="c-t">Jimpitan hari ini</h6><div class="grid g2"><div class="kpi"><span class="v num">' + rp(d.jimpitanHariIni.total) + '</span><span class="l">Terkumpul</span></div><div class="kpi"><span class="v num">' + d.jimpitanHariIni.kk + ' / ' + d.jimpitanHariIni.dari + '</span><span class="l">KK sudah setor</span></div></div></div>';
  if (d.kegiatan && d.kegiatan.length) h += '<div class="c"><h6 class="c-t">Kegiatan khusus aktif</h6>' + d.kegiatan.map(k => '<div class="mb-3"><div class="d-flex justify-content-between"><b>' + esc(k.nama) + '</b><span class="amt">' + rp(k.terkumpul) + '</span></div>' + (k.pct !== null ? '<div class="progress mt-1"><div class="progress-bar" style="width:' + k.pct + '%"></div></div><div class="muted" style="font-size:12px">' + k.pct + '% dari ' + rp(k.targetTotal) + '</div>' : '<div class="muted" style="font-size:12px">Tanpa target total</div>') + '</div>').join('') + '</div>';
  h += '<div class="c"><h6 class="c-t">Saldo per jenis dana</h6>' + d.saldo.map(s => '<div class="dana-row"><div class="dot"><i class="bi bi-' + (s.dana === 'Jimpitan' ? 'moon-stars' : s.dana === 'Kas RT' ? 'bank' : s.dana.indexOf('Kegiatan') === 0 ? 'flag' : 'heart') + '"></i></div><div class="grow" style="flex:1"><b>' + esc(s.dana) + '</b></div><span class="amt ' + (s.saldo < 0 ? 'out' : '') + '">' + rp(s.saldo) + '</span></div>').join('') + '</div>';
  return h;
}
function drawChart(bulan) {
  const cv = $('#chBulan'); if (!cv) return;
  loadScript(LIB.chart).then(() => {
    const cv2 = $('#chBulan'); if (!cv2) return;
    if (_chart) { _chart.destroy(); _chart = null; }
    const cs = getComputedStyle(document.documentElement), ok = cs.getPropertyValue('--brand').trim(), bad = cs.getPropertyValue('--amber').trim(), mu = cs.getPropertyValue('--muted').trim(), ln = cs.getPropertyValue('--line').trim();
    _chart = new Chart(cv2, {
      type: 'bar',
      data: { labels: bulan.map(b => BLN[+b.ym.split('-')[1] - 1].slice(0, 3)), datasets: [{ label: 'Masuk', data: bulan.map(b => b.masuk), backgroundColor: ok, borderRadius: 6 }, { label: 'Keluar', data: bulan.map(b => b.keluar), backgroundColor: bad, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { labels: { color: mu, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + rp(c.parsed.y) } } }, scales: { x: { ticks: { color: mu }, grid: { display: false } }, y: { ticks: { color: mu, callback: v => v >= 1e6 ? (v / 1e6) + 'jt' : v >= 1e3 ? (v / 1e3) + 'rb' : v }, grid: { color: ln } } } }
    });
  }).catch(() => { const p = cv.parentElement; if (p) p.innerHTML = '<div class="muted text-center" style="padding-top:70px">Grafik tidak dapat dimuat (offline).</div>'; });
}

/* ===================================================================
 *  ANTREAN SETORAN (offline-tolerant, idempoten lewat reqId)
 * =================================================================== */
const Pending = {
  q: [], busy: false,
  key() { return 'pend:' + (S.user ? S.user.id : 'x'); },
  load() { this.q = Store.g(this.key(), []); this.badge(); },
  save() { Store.s(this.key(), this.q); this.badge(); },
  add(it) { this.q.push(it); this.save(); },
  badge() {
    const el = $('#jpPending'); if (!el) return;
    el.innerHTML = this.q.length ? '<div class="insight warn"><i class="bi bi-cloud-upload"></i><div><b>' + this.q.length + ' setoran menunggu terkirim</b><br>' + this.q.map(x => esc(x.nama) + ' ' + rp(x.p.nominal)).join(', ') + '<br><button class="btn btn-sm btn-ghost mt-2" data-act="pendRetry">Kirim ulang</button></div></div>' : '';
  },
  async flush() {
    if (this.busy || !this.q.length || !S.token) return;
    this.busy = true;
    try {
      for (const it of this.q.slice()) {
        try {
          const r = await apiW('jimpSimpan', it.p, { reqId: it.reqId });
          this.q = this.q.filter(x => x !== it); this.save();
          toast('✓ ' + r.nama + ' (' + r.no + ') ' + rp(r.nominal) + (r.sampai ? ' · s.d. ' + fmtD(r.sampai) : ''), 'ok');
        } catch (e) {
          if (e instanceof ApiErr && e.code !== 'AUTH') { this.q = this.q.filter(x => x !== it); this.save(); toast('Ditolak — ' + it.nama + ': ' + e.message, 'err'); }
          else { if (e.code !== 'AUTH') toast('Offline/koneksi lemah — setoran disimpan di antrean.', 'warn'); break; }
        }
      }
    } finally { this.busy = false; }
    if (S.page === 'jimpitan') { PAGES.jimpitan.afterSave(); }
    S.boot && (S.loaded.dashboard = 0);
  }
};
ACT.pendRetry = () => Pending.flush();

/* ===================================================================
 *  JIMPITAN
 * =================================================================== */
const JP = { w: null, counts: {}, flashOk: false, scanning: false, starting: false, camDenied: false, userStopped: false, wasActive: undefined, scanner: null, lastCode: '', lastAt: 0, tab: 'input', cal: {}, rekap: { mode: 'harian', tgl: '' } };

PAGES.jimpitan = {
  init() {
    const u = S.user, el = $('#pg-jimpitan');
    if (u.role === 'warga') { el.innerHTML = '<div class="c"><div id="calBox_w">' + skel(6) + '</div></div>'; JP.tab = 'kal'; return; }
    const tabs = [['input', 'Input'], ['hari', 'Hari ini'], ['kal', 'Kalender'], ['rekap', 'Rekap']];
    el.innerHTML = tabsHtml('jp', tabs, 'input') +
      '<div class="jp-p" id="jp-input"></div><div class="jp-p d-none-i" id="jp-hari"></div><div class="jp-p d-none-i" id="jp-kal"></div><div class="jp-p d-none-i" id="jp-rekap"></div>';
    this.buildInput();
    setInterval(() => { if (S.page === 'jimpitan' && JP.tab === 'input') PAGES.jimpitan.tickJadwal(); }, 30000);
  },
  load() {
    if (S.user.role === 'warga') return renderCal($('#calBox_w'), S.user.id_warga, null);
    TABS.jp(JP.tab);
  },
  afterSave() { Pending.badge(); if (JP.tab === 'hari') loadHari(); },
  jadwal() {
    const u = S.user;
    if (u.role !== 'petugas') return { aktif: true, tanggal: todayJ(), staff: true };
    return jadwalUser();
  },
  tickJadwal() {
    const j = this.jadwal(), box = $('#jpJadwal'); if (!box) return;
    if (j.staff) box.innerHTML = '<div class="jadwal on"><i class="bi bi-shield-check fs-5"></i><div>Mode ' + S.user.role + ': input dapat dilakukan kapan saja.</div></div>';
    else {
      const rg = j.regu;
      box.innerHTML = j.aktif
        ? '<div class="jadwal on"><i class="bi bi-broadcast fs-5"></i><div>Giliran ' + esc(rg ? rg.nama_regu : '') + ' sedang aktif<br><small>Input untuk tanggal ' + fmtD(j.tanggal) + '</small></div></div>'
        : '<div class="jadwal off"><i class="bi bi-lock fs-5"></i><div>' + esc(j.pesan) + '</div></div>';
    }
    const lock = !j.aktif;
    ['btnScan', 'btnFoto'].forEach(id => { const x = $('#' + id); if (x) x.disabled = lock; });
    $$('#jpEntry .nom-btn, #jpEntry [data-act="jpSimpan"], #jpEntry [data-act="jpReset"]').forEach(x => { x.disabled = lock; });
    if (lock && JP.scanning) stopScan();
    const was = JP.wasActive; JP.wasActive = !lock;
    if (!lock && was === false && JP.tab === 'input') autoScan(); // jadwal baru saja aktif
  },
  buildInput() {
    $('#jp-input').innerHTML =
      '<div id="jpJadwal" class="mb-3"></div>' +
      '<div class="c"><div class="scan-box" id="scanBox" style="display:none"><div id="qr-reader"></div><button type="button" class="flash-btn" id="btnFlash" data-act="flashToggle" aria-label="Nyalakan flash" aria-pressed="false" style="display:none"><i class="bi bi-lightning-charge-fill"></i></button></div>' +
      '<div class="d-flex gap-2"><button class="btn btn-brand flex-fill" id="btnScan" data-act="scanToggle"><i class="bi bi-qr-code-scan"></i><span>Scan QR rumah</span></button><button class="btn btn-ghost" id="btnFoto" data-act="scanFoto" aria-label="Scan QR dari foto" title="Scan QR dari foto"><i class="bi bi-image"></i></button></div>' +
      '<div class="muted mt-2" style="font-size:12.5px" id="scanMsg">Arahkan kamera ke QR di rumah warga. Setoran hanya dapat dicatat dengan memindai QR.</div>' +
      '<div class="form-check form-switch mt-2"><input class="form-check-input" type="checkbox" id="autoScanSw"><label class="form-check-label" for="autoScanSw" style="font-size:13px">Buka kamera otomatis</label></div>' +
      '<div class="form-check form-switch mt-2"><input class="form-check-input" type="checkbox" id="flashSw"><label class="form-check-label" for="flashSw" style="font-size:13px"><i class="bi bi-lightning-charge"></i> Flash (senter) saat scan</label></div><div class="muted" id="flashHint" style="font-size:12px;display:none"></div>' +
      (isStaff() ? '<div class="mt-3"><label class="form-label">Tanggal setoran</label><input type="date" class="form-control" id="jpTgl" max="' + todayJ() + '" value="' + todayJ() + '"></div>' : '') + '</div>' +
      '<div id="jpEntry"></div><div id="jpPending"></div>';
    const sw = $('#autoScanSw'); sw.checked = Store.g('autoscan', true);
    sw.addEventListener('change', () => { Store.s('autoscan', sw.checked); JP.userStopped = false; JP.camDenied = false; if (sw.checked) autoScan(); else stopScan(); });
    const fsw = $('#flashSw'); fsw.checked = Store.g('flash', false);
    fsw.addEventListener('change', () => toggleFlash(fsw.checked));
    this.tickJadwal(); Pending.badge();
  }
};
TABS.jp = v => {
  JP.tab = v;
  $$('.jp-p').forEach(p => p.classList.toggle('d-none-i', p.id !== 'jp-' + v));
  if (v !== 'input' && JP.scanning) stopScan();
  if (v === 'input') { JP.userStopped = false; PAGES.jimpitan.tickJadwal(); autoScan(); }
  if (v === 'hari') loadHari();
  if (v === 'kal') buildKalPicker();
  if (v === 'rekap') buildRekap();
};

PAGES.jimpitan.onEnter = () => { if (S.user.role !== 'warga' && JP.tab === 'input') { JP.userStopped = false; autoScan(); } };

/* --- Scan & pilih warga --- */
/** Kamera boleh menyala otomatis hanya bila: di tab Input, tidak ada warga terpilih, tab browser terlihat, dan jadwal aktif. */
const scanAllowed = () => S.page === 'jimpitan' && JP.tab === 'input' && !JP.w && document.visibilityState === 'visible' && PAGES.jimpitan.jadwal().aktif;
function autoScan() {
  if (!Store.g('autoscan', true) || JP.camDenied || JP.userStopped || JP.scanning || JP.starting || !scanAllowed()) return;
  startScan(true);
}
async function startScan(auto) {
  if (JP.starting || JP.scanning) return;
  JP.starting = true;
  const msg = $('#scanMsg'), box = $('#scanBox');
  if (!auto) { JP.camDenied = false; JP.userStopped = false; }
  try {
    msg.textContent = 'Menyiapkan kamera…';
    box.style.display = '';
    await loadScript(LIB.scan);
    if (!JP.scanner) JP.scanner = new Html5Qrcode('qr-reader');
    await JP.scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, onScan, () => { });
    JP.scanning = true;
    $('#btnScan').innerHTML = '<i class="bi bi-stop-circle"></i><span>Hentikan kamera</span>';
    msg.textContent = 'Kamera aktif — arahkan ke QR di rumah warga.';
    initFlash();
  } catch (e) {
    box.style.display = 'none'; JP.scanning = false; JP.camDenied = true;
    msg.innerHTML = '<span class="text-danger">Kamera tidak dapat dibuka (izin ditolak atau tidak tersedia). Ketuk “Scan QR rumah” untuk mencoba lagi, atau ketuk ikon foto untuk memindai QR dari foto.</span>';
  } finally { JP.starting = false; }
  // pengguna sempat pindah halaman/tab saat kamera disiapkan -> matikan lagi
  const keep = auto ? scanAllowed() : (S.page === 'jimpitan' && JP.tab === 'input' && document.visibilityState === 'visible');
  if (JP.scanning && !keep) stopScan();
}
async function stopScan(byUser) {
  if (byUser) JP.userStopped = true;
  try { if (JP.scanner && JP.scanning) await JP.scanner.stop(); } catch (e) { /* abaikan */ }
  JP.scanning = false; JP.flashOk = false;
  const fb = $('#btnFlash'); if (fb) { fb.style.display = 'none'; fb.classList.remove('on'); }
  const b = $('#btnScan'); if (b) b.innerHTML = '<i class="bi bi-qr-code-scan"></i><span>Scan QR rumah</span>';
  const sbx = $('#scanBox'); if (sbx) sbx.style.display = 'none';
  const m = $('#scanMsg'); if (m && !JP.camDenied) m.textContent = 'Kamera mati. Ketuk “Scan QR rumah” untuk menyalakan kamera.';
}
/* ---- Flash (senter): dikendalikan lewat track kamera yang sedang berjalan ---- */
function scanTrack() {
  const v = document.querySelector('#qr-reader video'), s = v && v.srcObject;
  return s && s.getVideoTracks ? s.getVideoTracks()[0] : null;
}
function flashSupported() {
  const t = scanTrack();
  try { return !!(t && t.getCapabilities && t.getCapabilities().torch); } catch (e) { return false; }
}
async function setFlash(on) {
  const t = scanTrack();
  if (!t) return false;
  try { await t.applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch (e) { return false; }
}
function paintFlash() {
  const want = Store.g('flash', false), on = want && JP.flashOk && JP.scanning;
  const sw = $('#flashSw'); if (sw) sw.checked = want;
  const b = $('#btnFlash'); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? 'Matikan flash' : 'Nyalakan flash'); }
}
/** Dipanggil setiap kamera menyala (termasuk restart otomatis setelah Simpan): deteksi dukungan lalu terapkan pilihan tersimpan. */
async function initFlash() {
  const b = $('#btnFlash'), hint = $('#flashHint');
  let ok = false;
  for (let i = 0; i < 4 && !ok; i++) { ok = flashSupported(); if (!ok) await sleep(250); }
  if (!JP.scanning) return;
  JP.flashOk = ok;
  if (b) b.style.display = ok ? '' : 'none';
  if (hint) { hint.style.display = ok ? 'none' : ''; hint.textContent = 'Flash tidak didukung oleh kamera/perangkat ini.'; }
  if (ok && Store.g('flash', false)) await setFlash(true);
  paintFlash();
}
async function toggleFlash(want) {
  Store.s('flash', !!want);
  if (JP.scanning) {
    if (!JP.flashOk) { toast('Flash tidak didukung oleh kamera ini.', 'warn'); Store.s('flash', false); }
    else if (!(await setFlash(want))) { toast('Gagal mengatur flash.', 'warn'); Store.s('flash', !want); }
  } else if (want) toast('Flash akan menyala saat kamera aktif.');
  paintFlash();
}
ACT.flashToggle = () => toggleFlash(!Store.g('flash', false));
ACT.scanToggle = () => JP.scanning ? stopScan(true) : startScan(false);
/** Cadangan bila kamera langsung tidak bisa dipakai: foto QR (tetap barcode, bukan input manual). */
ACT.scanFoto = () => pickFile(async f => {
  if (!/^image\//.test(f.type)) return toast('Pilih foto QR (berupa gambar).', 'warn');
  try {
    if (JP.scanning) await stopScan();
    await loadScript(LIB.scan);
    if (!JP.scanner) JP.scanner = new Html5Qrcode('qr-reader');
    const txt = await JP.scanner.scanFile(f, false);
    JP.lastCode = ''; await onScan(txt);
  } catch (e) { toast('QR tidak terbaca dari foto. Pastikan QR jelas dan cukup terang.', 'warn'); }
});
ACT.jpBatal = () => { JP.w = null; JP.lastCode = ''; $('#jpEntry').innerHTML = ''; JP.userStopped = false; autoScan(); };
async function onScan(txt) {
  const now = Date.now();
  if (txt === JP.lastCode && now - JP.lastAt < 3000) return;
  JP.lastCode = txt; JP.lastAt = now;
  try { navigator.vibrate && navigator.vibrate(60); } catch (e) { /* abaikan */ }
  try {
    const r = await api('scan', { kode: txt });
    await stopScan(); setWarga(r);
  } catch (e) { toast(e.message, 'err'); }
}
function setWarga(info) {
  if (JP.scanning) stopScan();
  JP.w = info; JP.counts = {};
  const w = info.warga, T = S.boot.cfg.TOMBOL;
  $('#jpEntry').innerHTML =
    '<div class="c mt-3"><div class="warga-chip"><span class="avatar">' + esc(ini(w.nama_kk)) + '</span><div class="grow" style="flex:1;min-width:0"><b>' + esc(w.nama_kk) + '</b><div class="muted" style="font-size:12.5px">No. rumah ' + esc(w.no_rumah) + ' · wajib ' + rp(info.nominal) + '/hari</div></div><button class="btn btn-sm btn-ghost" data-act="jpBatal">Batal</button></div>' +
    '<div class="mt-2" style="font-size:13px">' + (info.sampai ? '<span class="sb lunas">Terbayar s.d. ' + fmtD(info.sampai) + '</span> ' : '<span class="sb belum">Belum ada setoran</span> ') +
    (info.tunggakan > 0 ? '<span class="sb kurang">Tunggakan ' + rp(info.tunggakan) + '</span> ' : '') + (info.hariIni > 0 ? '<span class="sb info">Hari ini sudah ' + rp(info.hariIni) + '</span>' : '') + '</div>' +
    '<div class="nom-grid mt-3">' + T.map(n => '<button type="button" class="nom-btn" data-act="jpNom" data-n="' + n + '">' + Number(n).toLocaleString('id-ID') + '<span class="cnt">0</span></button>').join('') + '</div>' +
    '<div class="total-box mt-3"><div><div style="font-size:12px;opacity:.85">Total setoran</div><div class="tv" id="jpTotal">Rp 0</div></div><button class="btn btn-sm" style="background:rgba(255,255,255,.18);color:#fff" data-act="jpReset"><i class="bi bi-arrow-counterclockwise"></i> Reset</button></div>' +
    '<button class="btn btn-brand w-100 mt-3" style="min-height:54px;font-size:17px" data-act="jpSimpan"><i class="bi bi-check2-circle"></i> Simpan</button></div>';
  $('#jpEntry').scrollIntoView({ behavior: 'smooth', block: 'start' });
  PAGES.jimpitan.tickJadwal();
}
function jpTotal() { return Object.keys(JP.counts).reduce((s, n) => s + (+n) * JP.counts[n], 0); }
ACT.jpNom = b => {
  const n = b.dataset.n; JP.counts[n] = (JP.counts[n] || 0) + 1;
  b.classList.add('has'); b.querySelector('.cnt').textContent = JP.counts[n];
  $('#jpTotal').textContent = rp(jpTotal());
  try { navigator.vibrate && navigator.vibrate(15); } catch (e) { /* abaikan */ }
};
ACT.jpReset = () => { JP.counts = {}; $$('#jpEntry .nom-btn').forEach(x => { x.classList.remove('has'); x.querySelector('.cnt').textContent = 0; }); $('#jpTotal').textContent = 'Rp 0'; };
ACT.jpSimpan = () => {
  const total = jpTotal();
  if (!JP.w) return;
  if (total <= 0) return toast('Pilih nominal setoran terlebih dahulu.', 'warn');
  const p = { kode: JP.w.kode, nominal: total };
  const tg = $('#jpTgl'); if (tg && tg.value) p.tanggal = tg.value;
  Pending.add({ reqId: uid(), p, nama: JP.w.warga.nama_kk });
  JP.w = null; $('#jpEntry').innerHTML = '';
  JP.lastCode = ''; JP.userStopped = false; autoScan(); // langsung siap scan rumah berikutnya (QR yang sama boleh dibaca lagi)
  if (!navigator.onLine) toast('Offline — setoran masuk antrean.', 'warn');
  Pending.flush();
};

/* --- Hari ini + koreksi --- */
async function loadHari(tgl) {
  const el = $('#jp-hari');
  if (!el.dataset.ready) {
    el.dataset.ready = 1;
    el.innerHTML = '<div class="c"><div class="d-flex justify-content-between align-items-center gap-2"><div class="kpi"><span class="v num" id="hTotal">-</span><span class="l" id="hSub"></span></div>' +
      (isStaff() ? '<input type="date" class="form-control" id="hTgl" style="max-width:170px" max="' + todayJ() + '">' : '') + '</div></div><div class="c" id="hList">' + skel(5) + '</div>';
    if (isStaff()) $('#hTgl').addEventListener('change', e => loadHari(e.target.value));
  }
  try {
    const d = await api('jimpHariIni', tgl ? { tanggal: tgl } : {});
    if (isStaff() && !$('#hTgl').value) $('#hTgl').value = d.tanggal;
    $('#hTotal').textContent = rp(d.total);
    $('#hSub').textContent = d.kk + ' KK · ' + fmtD(d.tanggal);
    $('#hList').innerHTML = d.items.length ? d.items.map(i => '<div class="list-i"><span class="avatar">' + esc(ini(i.nama)) + '</span><div class="grow"><div class="t"><a href="javascript:void(0)" data-act="calModal" data-id="' + i.id_warga + '" style="text-decoration:none;color:inherit">' + esc(i.nama) + '</a></div><div class="s">No. ' + esc(i.no) + ' · ' + esc(i.timestamp.slice(11, 16)) + '</div></div><span class="amt in">' + rp(i.nominal) + '</span>' +
      (i.canEdit ? '<button class="icon-btn" aria-label="Koreksi" data-act="jpEdit" data-id="' + i.id + '" data-n="' + i.nominal + '" data-nm="' + esc(i.nama) + '"><i class="bi bi-pencil"></i></button><button class="icon-btn" aria-label="Hapus" data-act="jpDel" data-id="' + i.id + '" data-nm="' + esc(i.nama) + '"><i class="bi bi-trash text-danger"></i></button>' : '') + '</div>').join('') : emptyH('inbox', 'Belum ada setoran pada tanggal ini.');
  } catch (e) { $('#hList').innerHTML = emptyH('wifi-off', e.message); }
}
ACT.jpEdit = b => {
  const id = b.dataset.id;
  Mdl.open({
    title: 'Koreksi setoran', body: '<p class="mb-3"><b>' + esc(b.dataset.nm) + '</b></p><label class="form-label">Nominal yang benar</label><input class="form-control" id="kNom" inputmode="numeric" data-money value="' + fmtNum(b.dataset.n) + '">',
    foot: '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="kOk">Simpan koreksi</button>',
    onShow() { $('#kOk').onclick = ev => act(ev.currentTarget, async () => { const n = numOf($('#kNom')); if (n <= 0) throw new Error('Nominal tidak valid.'); await apiW('jimpKoreksi', { id, nominal: n }); Mdl.close(); toast('Koreksi tercatat di log.'); loadHari($('#hTgl') ? $('#hTgl').value : undefined); }); }
  });
};
ACT.jpDel = async b => {
  if (!(await confirmBox('Hapus setoran ' + b.dataset.nm + '? Tindakan ini tercatat di log.', 'Hapus', true))) return;
  act(null, async () => { await apiW('jimpHapus', { id: b.dataset.id }); toast('Setoran dihapus.'); loadHari($('#hTgl') ? $('#hTgl').value : undefined); });
};

/* --- Kalender per warga --- */
async function buildKalPicker() {
  const el = $('#jp-kal');
  if (el.dataset.ready) return; el.dataset.ready = 1;
  el.innerHTML = (S.user.id_warga && !isStaff() ? '<div class="c mb-3"><div class="list-i" data-act="calModal" data-id="' + S.user.id_warga + '" style="cursor:pointer;padding:2px"><div class="dot"><i class="bi bi-calendar-check"></i></div><div class="grow t">Kalender jimpitan saya</div><i class="bi bi-chevron-right muted"></i></div></div>' : '') + '<div class="c"><div class="search"><i class="bi bi-search"></i><input class="form-control" id="kalCari" placeholder="Cari nama / no. rumah warga" autocomplete="off"></div><div id="kalList" class="mt-2"></div></div>';
  const draw = list => { $('#kalList').innerHTML = list.length ? list.map(w => '<div class="list-i" data-act="calModal" data-id="' + w.id + '" style="cursor:pointer"><span class="avatar">' + esc(ini(w.nama_kk)) + '</span><div class="grow"><div class="t">' + esc(w.nama_kk) + '</div><div class="s">No. ' + esc(w.no_rumah) + '</div></div><i class="bi bi-calendar3 muted"></i></div>').join('') : emptyH('search', 'Warga tidak ditemukan'); };
  if (isStaff()) {
    if (!S.wargaList) S.wargaList = await api('wargaList');
    const act_ = () => S.wargaList.filter(w => w.status === 'aktif');
    draw(act_());
    $('#kalCari').addEventListener('input', debounce(e => { const q = e.target.value.toLowerCase(); draw(act_().filter(w => w.nama_kk.toLowerCase().includes(q) || w.no_rumah.toLowerCase().includes(q))); }, 150));
  } else {
    $('#kalList').innerHTML = '<div class="muted text-center" style="padding:14px">Ketik nama atau no. rumah untuk melihat kalender.</div>';
    $('#kalCari').addEventListener('input', debounce(async e => { const q = e.target.value.trim(); if (!q) return; try { draw(await api('cariWarga', { q })); } catch (x) { toast(x.message, 'err'); } }, 250));
  }
}
ACT.calModal = b => {
  Mdl.open({ title: 'Kalender jimpitan', body: '<div id="calBox_m">' + skel(6) + '</div>', onShow() { renderCal($('#calBox_m'), b.dataset.id, null); } });
};
async function renderCal(box, idw, bulan) {
  if (!box) return;
  try {
    const d = await api('jimpKalender', { id_warga: idw, bulan: bulan || undefined });
    box.dataset.id = idw; box.dataset.bulan = d.bulan;
    const first = new Date(Date.UTC(+d.bulan.slice(0, 4), +d.bulan.slice(5) - 1, 1)).getUTCDay(), off = (first + 6) % 7, t = todayJ();
    let g = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(x => '<div class="dh">' + x + '</div>').join('') + '<div></div>'.repeat(off);
    d.hari.forEach(h => { g += '<button type="button" class="cd ' + h.s + (h.d === t ? ' today' : '') + '" data-act="calDay" data-d="' + h.d + '" data-s="' + h.s + '" data-v="' + h.setor + '">' + (+h.d.slice(8)) + (h.setor > 0 ? '<small>' + (h.setor >= 1000 ? (h.setor / 1000) + 'rb' : h.setor) + '</small>' : '') + '</button>'; });
    box.innerHTML = '<div class="d-flex align-items-center gap-2 mb-2"><span class="avatar">' + esc(ini(d.warga.nama_kk)) + '</span><div class="grow" style="flex:1;min-width:0"><b>' + esc(d.warga.nama_kk) + '</b><div class="muted" style="font-size:12.5px">No. ' + esc(d.warga.no_rumah) + ' · ' + rp(d.nominal) + '/hari</div></div></div>' +
      '<div class="mb-3">' + (d.sampai ? '<span class="sb lunas">Terbayar sampai ' + fmtD(d.sampai) + '</span> ' : '<span class="sb belum">Belum ada setoran</span> ') + (d.sisa > 0 ? '<span class="sb info">Sisa ' + rp(d.sisa) + ' menuju hari berikutnya</span> ' : '') + (d.tunggakan > 0 ? '<span class="sb kurang">Tunggakan ' + rp(d.tunggakan) + ' (' + d.hariTunggak + ' hari)</span>' : '<span class="sb lunas">Tanpa tunggakan</span>') + '</div>' +
      '<div class="d-flex justify-content-between align-items-center mb-2"><button class="icon-btn" data-act="calNav" data-d="-1" aria-label="Bulan sebelumnya"><i class="bi bi-chevron-left"></i></button><b>' + fmtYm(d.bulan) + '</b><button class="icon-btn" data-act="calNav" data-d="1" aria-label="Bulan berikutnya"><i class="bi bi-chevron-right"></i></button></div>' +
      '<div class="cal">' + g + '</div><div class="legend"><span class="l1">Lunas</span><span class="l2">Kurang</span><span class="l3">Belum</span><span class="l4">Dimuka/di luar masa iuran</span></div>';
  } catch (e) { box.innerHTML = emptyH('wifi-off', e.message); }
}
ACT.calNav = b => { const box = b.closest('[data-id]'); renderCal(box, box.dataset.id, ymAdd(box.dataset.bulan, +b.dataset.d)); };
ACT.calDay = b => { const s = b.dataset.s; toast(fmtD(b.dataset.d) + ': ' + (+b.dataset.v > 0 ? 'setor ' + rp(b.dataset.v) + ' · ' : '') + (STAT[s] || s).toLowerCase(), 'ok'); };

/* --- Rekap --- */
function buildRekap() {
  const el = $('#jp-rekap');
  if (!el.dataset.ready) {
    el.dataset.ready = 1; JP.rekap.tgl = todayJ();
    el.innerHTML = tabsHtml('rk', [['harian', 'Harian'], ['mingguan', 'Mingguan'], ['bulanan', 'Bulanan']], 'harian') +
      '<div class="c"><input type="date" class="form-control" id="rkTgl" value="' + JP.rekap.tgl + '" max="' + todayJ() + '"></div><div id="rkOut" class="mt-3"></div>';
    $('#rkTgl').addEventListener('change', e => { JP.rekap.tgl = e.target.value; loadRekap(); });
  }
  loadRekap();
}
TABS.rk = v => { JP.rekap.mode = v; loadRekap(); };
async function loadRekap() {
  const out = $('#rkOut'); out.innerHTML = '<div class="c">' + skel(4) + '</div>';
  try {
    const d = await api('jimpRekap', { mode: JP.rekap.mode, tanggal: JP.rekap.tgl });
    const mx = Math.max(1, ...d.perHari.map(x => x.total));
    out.innerHTML = '<div class="grid g3"><div class="c kpi"><span class="v num">' + rp(d.total) + '</span><span class="l">Terkumpul</span></div><div class="c kpi"><span class="v num">' + d.setoran + '</span><span class="l">Setoran</span></div><div class="c kpi"><span class="v num">' + d.kk + '/' + d.aktif + '</span><span class="l">KK</span></div></div>' +
      '<div class="c"><h6 class="c-t">Periode ' + fmtD(d.dari) + (d.dari !== d.sampai ? ' – ' + fmtD(d.sampai) : '') + '</h6>' +
      (d.perHari.length ? d.perHari.map(x => '<div class="mb-2"><div class="d-flex justify-content-between" style="font-size:13px"><span>' + fmtD(x.tanggal) + ' · ' + x.kk + ' KK</span><b class="num">' + rp(x.total) + '</b></div><div class="progress"><div class="progress-bar" style="width:' + Math.round(x.total / mx * 100) + '%"></div></div></div>').join('') : emptyH('inbox', 'Belum ada setoran.')) + '</div>' +
      '<div class="c"><h6 class="c-t">Per regu</h6>' + (d.perRegu.length ? d.perRegu.map(g => '<div class="list-i"><div class="dot"><i class="bi bi-people"></i></div><div class="grow"><div class="t">' + esc(g.nama) + '</div><div class="s">' + g.setoran + ' setoran</div></div><span class="amt">' + rp(g.total) + '</span></div>').join('') : emptyH('people', 'Belum ada data regu.')) + '</div>';
  } catch (e) { out.innerHTML = '<div class="c">' + emptyH('wifi-off', e.message) + '</div>'; }
}

/* ===================================================================
 *  IURAN & KEGIATAN KHUSUS
 * =================================================================== */
const IU = { tab: 'status', kegiatan: null };
function iuranItems() {
  const b = S.boot, out = [];
  b.jenis.forEach(j => { if (j.periode !== 'harian') out.push({ id: j.id, nama: j.nama, kind: j.periode, nominal: j.nominal }); });
  b.kegiatan.forEach(k => out.push({ id: k.id, nama: 'Kegiatan: ' + k.nama, kind: 'kegiatan', nominal: k.mode_nominal === 'sama' ? k.target_per_kk : 0, mode: k.mode_nominal }));
  return out;
}
async function refreshBoot() {
  const b = await api('boot'); const keep = S.boot.user; S.boot = b; S.boot.user = keep; S.user = keep; S.offset = b.serverNow - Date.now();
  Store.s('c:' + keep.id + ':boot', S.boot);
  invalidate();
}
const wargaOpts = (sel) => (S.wargaList || []).filter(w => w.status === 'aktif').map(w => '<option value="' + w.id + '"' + (sel === w.id ? ' selected' : '') + '>' + esc(w.no_rumah + ' — ' + w.nama_kk) + '</option>').join('');

PAGES.iuran = {
  init() {
    const tabs = isStaff() ? [['bayar', 'Catat'], ['status', 'Status'], ['riwayat', 'Riwayat'], ['kegiatan', 'Kegiatan']] : [['status', 'Status saya'], ['riwayat', 'Riwayat'], ['kegiatan', 'Kegiatan']];
    IU.tab = isStaff() ? 'bayar' : 'status';
    $('#pg-iuran').innerHTML = tabsHtml('iu', tabs, IU.tab) + '<div id="iuBody"></div>';
  },
  async load() {
    if (isStaff() && !S.wargaList) { try { S.wargaList = await api('wargaList'); } catch (e) { toast(e.message, 'err'); } }
    TABS.iu(IU.tab);
  }
};
TABS.iu = v => {
  IU.tab = v;
  ({ bayar: iuBayar, status: iuStatus, riwayat: iuRiwayat, kegiatan: iuKegiatan }[v])();
};

function iuBayar() {
  const items = iuranItems();
  $('#iuBody').innerHTML = '<div class="c"><h6 class="c-t">Catat pembayaran iuran</h6>' +
    '<div class="mb-3"><label class="form-label">Warga</label><select class="form-select" id="ibW"><option value="">— pilih warga —</option>' + wargaOpts() + '</select></div>' +
    '<div class="mb-3"><label class="form-label">Jenis iuran / kegiatan</label><select class="form-select" id="ibJ">' + items.map(i => '<option value="' + i.id + '">' + esc(i.nama) + (i.kind === 'bulanan' ? ' (' + rp(i.nominal) + '/bln)' : i.nominal ? ' (' + rp(i.nominal) + ')' : '') + '</option>').join('') + '</select></div>' +
    '<div class="mb-3"><label class="form-label">Nominal dibayar</label><input class="form-control" id="ibN" inputmode="numeric" data-money placeholder="0"><div class="muted mt-1" style="font-size:12.5px" id="ibHint"></div></div>' +
    '<div class="grid g2"><div class="mb-3"><label class="form-label">Tanggal bayar</label><input type="date" class="form-control" id="ibT" value="' + todayJ() + '" max="' + todayJ() + '"></div><div class="mb-3" id="ibPwrap"><label class="form-label">Mulai bulan (opsional)</label><input type="month" class="form-control" id="ibP"></div></div>' +
    '<button class="btn btn-brand w-100" id="ibOk"><i class="bi bi-check2-circle"></i> Simpan pembayaran</button></div>';
  const upd = () => {
    const it = items.find(i => i.id === $('#ibJ').value) || {};
    $('#ibPwrap').style.display = it.kind === 'bulanan' ? '' : 'none';
    $('#ibN').value = it.nominal ? fmtNum(it.nominal) : '';
    $('#ibHint').textContent = it.kind === 'bulanan' ? 'Bayar lebih dari 1 bulan? Sistem membaginya otomatis ke bulan berikutnya.' : it.kind === 'sekali' ? 'Iuran sekali bayar — boleh dicicil sampai lunas.' : (it.mode === 'sukarela' ? 'Sukarela — nominal sesuai kemampuan, boleh lebih dari sekali.' : 'Nominal per KK — boleh dibayar lebih dari sekali.');
  };
  $('#ibJ').addEventListener('change', upd); upd();
  $('#ibOk').onclick = ev => act(ev.currentTarget, async () => {
    const p = { id_warga: $('#ibW').value, id_jenis: $('#ibJ').value, nominal: numOf($('#ibN')), tanggal: $('#ibT').value, periode_awal: $('#ibP').value || '' };
    if (!p.id_warga) throw new Error('Pilih warga terlebih dahulu.');
    if (p.nominal <= 0) throw new Error('Isi nominal pembayaran.');
    const r = await apiW('iuranBayar', p);
    const ket = r.alokasi.filter(a => a.periode && a.periode !== 'sekali').map(a => fmtYm(a.periode) + ' ' + rp(a.nominal)).join(', ');
    toast('✓ ' + r.nama + ' ' + rp(p.nominal) + (ket ? ' → ' + ket : ''));
    $('#ibN').value = ''; invalidate(); S.loaded.iuran = Date.now();
  });
}

async function iuStatus() {
  const body = $('#iuBody');
  body.innerHTML = (isStaff() ? '<div class="c mb-2"><select class="form-select" id="isW"><option value="">— pilih warga —</option>' + wargaOpts() + '</select></div>' : '') + '<div id="isOut"></div>';
  const go = async (tahun) => {
    const out = $('#isOut'); const idw = isStaff() ? $('#isW').value : null;
    if (isStaff() && !idw) { out.innerHTML = '<div class="c">' + emptyH('person-check', 'Pilih warga untuk melihat status iurannya.') + '</div>'; return; }
    out.innerHTML = '<div class="c">' + skel(5) + '</div>';
    try {
      const d = await api('iuranStatus', { id_warga: idw, tahun });
      out.innerHTML = '<div class="c"><div class="d-flex align-items-center gap-2"><span class="avatar">' + esc(ini(d.warga.nama_kk)) + '</span><div><b>' + esc(d.warga.nama_kk) + '</b><div class="muted" style="font-size:12.5px">No. ' + esc(d.warga.no_rumah) + '</div></div></div></div>' +
        d.items.map(it => it.kind === 'bulanan'
          ? '<div class="c"><h6 class="c-t">' + esc(it.nama) + ' <span class="d-flex align-items-center gap-1"><button class="icon-btn" style="width:30px;height:30px" data-act="isThn" data-d="-1" data-t="' + d.tahun + '"><i class="bi bi-chevron-left"></i></button>' + d.tahun + '<button class="icon-btn" style="width:30px;height:30px" data-act="isThn" data-d="1" data-t="' + d.tahun + '"><i class="bi bi-chevron-right"></i></button></span></h6><div class="grid g3" style="grid-template-columns:repeat(4,1fr)">' + it.bulan.map(m => '<div class="cal"><div class="cd ' + m.s + '" style="aspect-ratio:auto;padding:8px 0;grid-column:1/-1" title="' + (STAT[m.s] || '') + '">' + BLN[+m.p.slice(5) - 1].slice(0, 3) + '<small>' + (m.s === 'na' ? '–' : m.bayar > 0 ? (m.bayar / 1000) + 'rb' : STAT[m.s]) + '</small></div></div>').join('') + '</div><div class="legend"><span class="l1">Lunas</span><span class="l2">Kurang</span><span class="l3">Belum</span><span class="l4">Dimuka</span></div></div>'
          : '<div class="c"><div class="list-i" style="padding:0"><div class="dot"><i class="bi bi-' + (it.kind === 'kegiatan' ? 'flag' : 'cash-coin') + '"></i></div><div class="grow"><div class="t">' + esc(it.nama) + '</div><div class="s">Terbayar ' + rp(it.terbayar) + (it.tagihan ? ' dari ' + rp(it.tagihan) : it.mode === 'sukarela' ? ' (sukarela)' : '') + '</div></div>' + sb(it.status) + '</div></div>').join('');
    } catch (e) { out.innerHTML = '<div class="c">' + emptyH('wifi-off', e.message) + '</div>'; }
  };
  IU.go = go;
  if (isStaff()) $('#isW').addEventListener('change', () => go()); else go();
}
ACT.isThn = b => IU.go(String(+b.dataset.t + +b.dataset.d));

async function iuRiwayat() {
  const body = $('#iuBody'); body.innerHTML = '<div class="c">' + skel(5) + '</div>';
  try {
    const l = await api('iuranRiwayat', { limit: 80 });
    body.innerHTML = '<div class="c">' + (l.length ? l.map(x => '<div class="list-i"><span class="avatar">' + esc(ini(x.nama)) + '</span><div class="grow"><div class="t">' + esc(x.nama) + ' <span class="muted">· ' + esc(x.no) + '</span></div><div class="s">' + esc(x.jenis) + ' · ' + fmtD(x.tanggal) + (x.periode.length ? ' · ' + x.periode.map(p => fmtYm(p).slice(0, 3) + ' ' + p.slice(2, 4)).join(', ') : '') + '</div></div><span class="amt in">' + rp(x.nominal) + '</span>' + (isStaff() ? '<button class="icon-btn" aria-label="Hapus" data-act="iuDel" data-id="' + x.pay_id + '" data-nm="' + esc(x.nama) + '"><i class="bi bi-trash text-danger"></i></button>' : '') + '</div>').join('') : emptyH('receipt', 'Belum ada pembayaran iuran.')) + '</div>';
  } catch (e) { body.innerHTML = '<div class="c">' + emptyH('wifi-off', e.message) + '</div>'; }
}
ACT.iuDel = async b => {
  if (!(await confirmBox('Hapus pembayaran ' + b.dataset.nm + '? Transaksi kas terkait ikut dihapus.', 'Hapus', true))) return;
  act(null, async () => { await apiW('iuranHapus', { pay_id: b.dataset.id }); toast('Pembayaran dihapus.'); invalidate(); S.loaded.iuran = Date.now(); iuRiwayat(); });
};

async function iuKegiatan() {
  const body = $('#iuBody'); body.innerHTML = '<div class="c">' + skel(4) + '</div>';
  try {
    const l = await api('kegiatanList'); IU.kegiatan = l;
    body.innerHTML = (isStaff() ? '<button class="btn btn-brand w-100 mb-3" data-act="kgForm"><i class="bi bi-plus-lg"></i> Kegiatan baru</button>' : '') +
      (l.length ? l.map(k => '<div class="c" style="cursor:pointer" data-act="kgDetail" data-id="' + k.id + '"><div class="d-flex justify-content-between align-items-start gap-2"><div><b>' + esc(k.nama) + '</b><div class="muted" style="font-size:12.5px">' + (k.mode_nominal === 'sama' ? 'Sama rata ' + rp(k.target_per_kk) + '/KK' : 'Sesuai kemampuan') + (k.tgl_selesai ? ' · s.d. ' + fmtD(k.tgl_selesai) : '') + '</div></div><span class="sb ' + (k.aktif ? 'lunas' : 'na') + '">' + (k.aktif ? 'Aktif' : 'Selesai') + '</span></div>' +
        '<div class="d-flex justify-content-between mt-2"><span class="amt">' + rp(k.terkumpul) + '</span><span class="muted" style="font-size:12.5px">' + k.peserta + ' KK ikut' + (k.target_total ? ' · target ' + rp(k.target_total) : '') + '</span></div>' + (k.pct !== null ? '<div class="progress mt-2"><div class="progress-bar" style="width:' + k.pct + '%"></div></div>' : '') + '</div>').join('') : '<div class="c">' + emptyH('flag', 'Belum ada kegiatan khusus.') + '</div>');
  } catch (e) { body.innerHTML = '<div class="c">' + emptyH('wifi-off', e.message) + '</div>'; }
}
ACT.kgDetail = b => {
  const k = IU.kegiatan.find(x => x.id === b.dataset.id); if (!k) return;
  Mdl.open({
    title: k.nama, body: '<div class="mb-3"><div class="amt" style="font-size:24px">' + rp(k.terkumpul) + '</div><div class="muted">' + k.peserta + ' dari ' + k.jumlahKK + ' KK ikut berkontribusi' + (k.target_total ? ' · target ' + rp(k.target_total) : '') + '</div>' + (k.pct !== null ? '<div class="progress mt-2"><div class="progress-bar" style="width:' + k.pct + '%"></div></div>' : '') + '</div><div id="kgPes">' + (isStaff() ? skel(4) : '') + '</div>',
    foot: isStaff() ? '<button class="btn btn-danger-soft" data-act="kgDel" data-id="' + k.id + '"><i class="bi bi-trash"></i></button><button class="btn btn-ghost" data-act="kgForm" data-id="' + k.id + '"><i class="bi bi-pencil"></i> Ubah</button>' : '',
    async onShow() {
      if (!isStaff()) return;
      try {
        const d = await api('tunggakan', { jenis: k.id });
        $('#kgPes').innerHTML = '<h6 class="c-t">Peserta</h6>' + d.rows.slice().sort((a, b) => b.terbayar - a.terbayar).map(r => '<div class="list-i"><span class="avatar">' + esc(ini(r.nama)) + '</span><div class="grow"><div class="t">' + esc(r.nama) + '</div><div class="s">No. ' + esc(r.no) + '</div></div><span class="amt">' + rp(r.terbayar) + '</span>' + (k.mode_nominal === 'sama' ? sb(r.status) : '') + '</div>').join('');
      } catch (e) { $('#kgPes').innerHTML = emptyH('wifi-off', e.message); }
    }
  });
};
ACT.kgForm = b => {
  const k = b.dataset.id ? IU.kegiatan.find(x => x.id === b.dataset.id) : null;
  Mdl.open({
    title: k ? 'Ubah kegiatan' : 'Kegiatan baru',
    body: '<div class="mb-3"><label class="form-label">Nama kegiatan</label><input class="form-control" id="kgN" maxlength="80" value="' + esc(k ? k.nama : '') + '" placeholder="mis. Peringatan 17 Agustus"></div>' +
      '<div class="mb-3"><label class="form-label">Mode nominal</label><select class="form-select" id="kgM"><option value="sama"' + (k && k.mode_nominal === 'sama' ? ' selected' : '') + '>Sama rata per KK</option><option value="sukarela"' + (k && k.mode_nominal === 'sukarela' ? ' selected' : '') + '>Sesuai kemampuan (sukarela)</option></select></div>' +
      '<div class="mb-3" id="kgTw"><label class="form-label">Nominal per KK</label><input class="form-control" id="kgT" inputmode="numeric" data-money value="' + fmtNum(k ? k.target_per_kk : '') + '"></div>' +
      '<div class="mb-3"><label class="form-label">Target total (opsional)</label><input class="form-control" id="kgTT" inputmode="numeric" data-money value="' + fmtNum(k ? k.target_total : '') + '"></div>' +
      '<div class="grid g2"><div><label class="form-label">Mulai</label><input type="date" class="form-control" id="kgA" value="' + esc(k ? k.tgl_mulai : '') + '"></div><div><label class="form-label">Selesai</label><input type="date" class="form-control" id="kgB" value="' + esc(k ? k.tgl_selesai : '') + '"></div></div>',
    foot: '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="kgOk">Simpan</button>',
    onShow() {
      const tg = () => { $('#kgTw').style.display = $('#kgM').value === 'sama' ? '' : 'none'; }; $('#kgM').onchange = tg; tg();
      $('#kgOk').onclick = ev => act(ev.currentTarget, async () => {
        await apiW('kegiatanSimpan', { id: k ? k.id : '', nama: $('#kgN').value, mode_nominal: $('#kgM').value, target_per_kk: numOf($('#kgT')), target_total: numOf($('#kgTT')), tgl_mulai: $('#kgA').value, tgl_selesai: $('#kgB').value });
        Mdl.close(); toast('Kegiatan disimpan.'); await refreshBoot(); S.loaded.iuran = Date.now(); iuKegiatan();
      });
    }
  });
};
ACT.kgDel = async b => {
  if (!(await confirmBox('Hapus kegiatan ini?', 'Hapus', true))) return;
  act(null, async () => { await apiW('kegiatanHapus', { id: b.dataset.id }); Mdl.close(); toast('Kegiatan dihapus.'); await refreshBoot(); S.loaded.iuran = Date.now(); iuKegiatan(); });
};

/* ===================================================================
 *  KAS RT
 * =================================================================== */
const KS = { f: { dari: '', sampai: '', dana: '', tipe: '', q: '' }, items: [], offset: 0, more: false, buktiData: '', buktiNama: '' };
PAGES.kas = {
  init() {
    const t = todayJ(); KS.f.dari = t.slice(0, 7) + '-01'; KS.f.sampai = t;
    const el = $('#pg-kas');
    el.innerHTML = (isStaff() ? '<button class="btn btn-soft w-100 mb-3" data-act="txForm" data-preset="' + esc(JSON.stringify({ tipe: 'keluar', dana: 'Dana Kematian', kat: 'Santunan', title: 'Salurkan santunan', ph: 'mis. Santunan duka keluarga Bpk. …' })) + '"><i class="bi bi-heart-pulse"></i> Salurkan santunan</button>' : '') + '<div class="c"><div class="search mb-2"><i class="bi bi-search"></i><input class="form-control" id="ksQ" placeholder="Cari keterangan / kategori"></div>' +
      '<div class="grid g2 mb-2"><select class="form-select" id="ksD"><option value="">Semua dana</option>' + S.boot.dana.map(d => '<option>' + esc(d) + '</option>').join('') + '</select><select class="form-select" id="ksT"><option value="">Semua tipe</option><option value="masuk">Pemasukan</option><option value="keluar">Pengeluaran</option></select></div>' +
      '<div class="grid g2"><input type="date" class="form-control" id="ksA" value="' + KS.f.dari + '"><input type="date" class="form-control" id="ksB" value="' + KS.f.sampai + '"></div></div>' +
      '<div class="grid g3 mt-3" id="ksSum"></div><div class="c mt-3" id="ksList">' + skel(6) + '</div><div id="ksMore" class="text-center mt-3"></div>' +
      (isStaff() ? '<button class="fab" data-act="txForm" aria-label="Tambah transaksi"><i class="bi bi-plus-lg"></i></button>' : '');
    const re = debounce(() => { KS.f = { q: $('#ksQ').value.trim(), dana: $('#ksD').value, tipe: $('#ksT').value, dari: $('#ksA').value, sampai: $('#ksB').value }; KS.offset = 0; PAGES.kas.load(); }, 300);
    ['ksQ', 'ksD', 'ksT', 'ksA', 'ksB'].forEach(id => $('#' + id).addEventListener(id === 'ksQ' ? 'input' : 'change', re));
  },
  async load() {
    try {
      const d = await api('txList', Object.assign({ offset: KS.offset }, KS.f));
      KS.items = KS.offset === 0 ? d.items : KS.items.concat(d.items); KS.more = d.more;
      $('#ksSum').innerHTML = '<div class="c kpi"><span class="v num amt in">' + rp(d.masuk) + '</span><span class="l">Masuk</span></div><div class="c kpi"><span class="v num amt out">' + rp(d.keluar) + '</span><span class="l">Keluar</span></div><div class="c kpi"><span class="v num">' + rp(d.masuk - d.keluar) + '</span><span class="l">Selisih</span></div>';
      $('#ksList').innerHTML = KS.items.length ? KS.items.map(txRow).join('') : emptyH('journal-x', 'Tidak ada transaksi pada filter ini.');
      $('#ksMore').innerHTML = d.more ? '<button class="btn btn-ghost" data-act="ksMore">Muat lebih banyak</button>' : '';
    } catch (e) { $('#ksList').innerHTML = emptyH('wifi-off', e.message); }
  }
};
ACT.ksMore = () => { KS.offset = KS.items.length; PAGES.kas.load(); };
const txRow = t => '<div class="list-i" data-act="txDetail" data-id="' + esc(t.id) + '" style="cursor:pointer"><div class="dot" style="' + (t.tipe === 'masuk' ? 'background:var(--ok-soft);color:var(--ok)' : 'background:var(--bad-soft);color:var(--bad)') + '"><i class="bi bi-arrow-' + (t.tipe === 'masuk' ? 'down-left' : 'up-right') + '"></i></div><div class="grow"><div class="t">' + esc(t.keterangan) + '</div><div class="s">' + fmtD(t.tanggal) + ' · ' + esc(t.jenis_dana) + ' · ' + esc(t.kategori) + (t.bukti ? ' · <i class="bi bi-paperclip"></i>' : '') + '</div></div><span class="amt ' + (t.tipe === 'masuk' ? 'in' : 'out') + '">' + (t.tipe === 'masuk' ? '+' : '−') + rp(t.nominal).replace('Rp\u00a0', '') + '</span></div>';

ACT.txDetail = b => {
  const t = KS.items.find(x => x.id === b.dataset.id); if (!t) return;
  const auto = !!t.ref;
  Mdl.open({
    title: 'Detail transaksi',
    body: '<div class="text-center mb-3"><div class="amt ' + (t.tipe === 'masuk' ? 'in' : 'out') + '" style="font-size:28px">' + (t.tipe === 'masuk' ? '+' : '−') + rp(t.nominal) + '</div><div class="muted">' + fmtD(t.tanggal) + '</div></div>' +
      [['Keterangan', t.keterangan], ['Jenis dana', t.jenis_dana], ['Kategori', t.kategori], ['Dicatat oleh', t.dicatat_oleh]].map(r => '<div class="list-i"><div class="muted" style="width:110px">' + r[0] + '</div><div class="grow">' + esc(r[1]) + '</div></div>').join('') +
      (t.bukti ? '<button class="btn btn-soft w-100 mt-3" data-act="buktiLihat" data-id="' + esc(t.bukti) + '"><i class="bi bi-image"></i> Lihat bukti / nota</button>' : '') +
      (auto ? '<div class="insight info mt-3"><i class="bi bi-info-circle"></i><div>Transaksi otomatis dari jimpitan/iuran. Koreksi dilakukan di menu sumbernya.</div></div>' : ''),
    foot: isStaff() && !auto ? '<button class="btn btn-danger-soft" data-act="txDel" data-id="' + t.id + '"><i class="bi bi-trash"></i></button><button class="btn btn-brand" data-act="txForm" data-id="' + t.id + '"><i class="bi bi-pencil"></i> Ubah</button>' : ''
  });
};
ACT.buktiLihat = b => act(b, async () => {
  const f = await api('bukti', { id: b.dataset.id });
  Mdl.open({
    title: 'Bukti transaksi',
    body: f.mime === 'application/pdf' ? '<iframe src="' + f.data + '" style="width:100%;height:60vh;border:0;border-radius:12px"></iframe><div class="muted mt-2" style="font-size:12.5px">Jika PDF tidak tampil, gunakan tombol Unduh.</div>' : '<img class="bukti-thumb" alt="Bukti transaksi" src="' + f.data + '">',
    foot: '<a class="btn btn-brand" download="' + esc(f.name) + '" href="' + f.data + '"><i class="bi bi-download"></i> Unduh</a><button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>'
  });
});
ACT.txDel = async b => {
  if (!(await confirmBox('Hapus transaksi ini? Tercatat di log aktivitas.', 'Hapus', true))) return;
  act(null, async () => { await apiW('txHapus', { id: b.dataset.id }); Mdl.close(); toast('Transaksi dihapus.'); invalidate(); S.loaded.kas = Date.now(); KS.offset = 0; PAGES.kas.load(); });
};

function readImage(file) {
  return new Promise((res, rej) => {
    if (file.type === 'application/pdf') {
      if (file.size > 2.5e6) return rej(new Error('PDF maksimal 2,5 MB.'));
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Gagal membaca file.')); r.readAsDataURL(file); return;
    }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const sc = Math.min(1, 1280 / Math.max(img.width, img.height)), w = Math.round(img.width * sc), h = Math.round(img.height * sc);
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => rej(new Error('Gambar tidak dapat dibaca.'));
    img.src = url;
  });
}
function pickFile(cb) { const i = $('#fileBukti'); i.value = ''; i.onchange = () => { if (i.files[0]) cb(i.files[0]); }; i.click(); }

ACT.txForm = b => {
  const t = b && b.dataset.id ? KS.items.find(x => x.id === b.dataset.id) : null;
  const pre = (b && b.dataset.preset) ? JSON.parse(b.dataset.preset) : {};
  const st = { tipe: t ? t.tipe : (pre.tipe || 'keluar'), hapus: false }; KS.buktiData = ''; KS.buktiNama = '';
  const cfg = S.boot.cfg, kat = tp => (tp === 'masuk' ? cfg.KAT_MASUK : cfg.KAT_KELUAR);
  Mdl.open({
    title: t ? 'Ubah transaksi' : (pre.title || 'Transaksi baru'),
    body: '<div class="seg"><button type="button" data-tp="masuk">Pemasukan</button><button type="button" data-tp="keluar">Pengeluaran</button></div>' +
      '<div class="mb-3"><label class="form-label">Tanggal</label><input type="date" class="form-control" id="txT" max="' + todayJ() + '" value="' + (t ? t.tanggal : todayJ()) + '"></div>' +
      '<div class="mb-3"><label class="form-label">Jenis dana</label><select class="form-select" id="txD">' + S.boot.dana.map(d => '<option' + (d === (t ? t.jenis_dana : (pre.dana || 'Kas RT')) ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select></div>' +
      '<div class="mb-3"><label class="form-label">Kategori</label><select class="form-select" id="txK"></select></div>' +
      '<div class="mb-3"><label class="form-label">Nominal</label><input class="form-control" id="txN" inputmode="numeric" data-money placeholder="0" value="' + fmtNum(t ? t.nominal : '') + '"></div>' +
      '<div class="mb-3"><label class="form-label">Keterangan</label><textarea class="form-control" id="txKet" rows="2" maxlength="200" placeholder="' + esc(pre.ph || 'mis. Beli lampu pos ronda') + '">' + esc(t ? t.keterangan : '') + '</textarea></div>' +
      '<div class="mb-1"><label class="form-label">Bukti / nota (foto atau PDF)</label><div class="d-flex gap-2 align-items-center"><button type="button" class="btn btn-soft" id="txFile"><i class="bi bi-camera"></i> Ambil / pilih</button><span class="muted" id="txFn" style="font-size:12.5px">' + (t && t.bukti ? 'Sudah ada bukti' : 'Belum ada') + '</span></div><img id="txPrev" class="bukti-thumb mt-2" style="display:none;max-height:180px" alt="Pratinjau bukti">' + (t && t.bukti ? '<label class="mt-2 d-flex gap-2 align-items-center" style="font-size:13px"><input type="checkbox" id="txRm"> Hapus bukti lama</label>' : '') + '</div>',
    foot: '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="txOk">Simpan</button>',
    onShow(body) {
      const paint = () => { $$('.seg button', body).forEach(x => x.classList.toggle('on', x.dataset.tp === st.tipe)); const cur = t ? t.kategori : (pre.kat || ''); $('#txK').innerHTML = kat(st.tipe).concat(cur && !kat(st.tipe).includes(cur) ? [cur] : []).map(k => '<option' + (k === cur ? ' selected' : '') + '>' + esc(k) + '</option>').join(''); };
      $$('.seg button', body).forEach(x => x.onclick = () => { st.tipe = x.dataset.tp; paint(); });
      paint();
      $('#txFile').onclick = () => pickFile(async f => { try { KS.buktiData = await readImage(f); KS.buktiNama = f.name; $('#txFn').textContent = f.name + ' ✓'; const pv = $('#txPrev'); if (f.type !== 'application/pdf') { pv.src = KS.buktiData; pv.style.display = ''; } } catch (e) { toast(e.message, 'err'); } });
      $('#txOk').onclick = ev => act(ev.currentTarget, async () => {
        const n = numOf($('#txN')); if (n <= 0) throw new Error('Isi nominal transaksi.');
        if (!$('#txKet').value.trim()) throw new Error('Keterangan wajib diisi.');
        await apiW('txSimpan', { id: t ? t.id : '', tipe: st.tipe, tanggal: $('#txT').value, jenis_dana: $('#txD').value, kategori: $('#txK').value, nominal: n, keterangan: $('#txKet').value, bukti_data: KS.buktiData, bukti_nama: KS.buktiNama, hapus_bukti: !!($('#txRm') && $('#txRm').checked) });
        Mdl.close(); toast('Transaksi tersimpan.'); invalidate(); S.loaded.kas = Date.now(); KS.offset = 0; PAGES.kas.load();
      });
    }
  });
};

/* ===================================================================
 *  MONITORING TUNGGAKAN + PENGINGAT WA
 * =================================================================== */
const TG = { jenis: 'JI-JIMPITAN', periode: 'semua', status: 'tunggak', data: null };
PAGES.tunggakan = {
  init() {
    const b = S.boot, cur = todayJ().slice(0, 7);
    const mo = ['<option value="semua">Semua s.d. bulan ini</option>'].concat(Array.from({ length: 12 }, (_, i) => { const p = ymAdd(cur, -i); return '<option value="' + p + '">' + fmtYm(p) + '</option>'; }));
    $('#pg-tunggakan').innerHTML = '<div class="c"><div class="mb-2"><label class="form-label">Jenis iuran</label><select class="form-select" id="tgJ">' + b.jenis.map(j => '<option value="' + j.id + '">' + esc(j.nama) + '</option>').join('') + b.kegiatan.map(k => '<option value="' + k.id + '">Kegiatan: ' + esc(k.nama) + '</option>').join('') + '</select></div>' +
      '<div id="tgPw"><label class="form-label">Periode</label><select class="form-select" id="tgP">' + mo.join('') + '</select></div></div>' +
      '<div class="seg mt-3" id="tgSeg">' + [['tunggak', 'Menunggak'], ['belum', 'Belum'], ['kurang', 'Kurang'], ['lunas', 'Lunas'], ['semua', 'Semua']].map(x => '<button type="button" data-act="tgSt" data-v="' + x[0] + '" class="' + (x[0] === 'tunggak' ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</div>' +
      '<div class="grid g3" id="tgSum"></div><div class="c mt-3" id="tgList">' + skel(6) + '</div>';
    const ch = () => { TG.jenis = $('#tgJ').value; TG.periode = $('#tgP').value; this.load(); };
    $('#tgJ').addEventListener('change', () => { TG.periode = 'semua'; $('#tgP').value = 'semua'; ch(); });
    $('#tgP').addEventListener('change', ch);
  },
  async load() {
    const kind = (S.boot.jenis.find(j => j.id === TG.jenis) || {}).periode;
    $('#tgPw').style.display = kind === 'bulanan' ? '' : 'none';
    try {
      TG.data = await api('tunggakan', { jenis: TG.jenis, periode: kind === 'bulanan' ? TG.periode : '' });
      drawTg();
    } catch (e) { $('#tgList').innerHTML = emptyH('wifi-off', e.message); }
  }
};
ACT.tgSt = b => { TG.status = b.dataset.v; $$('#tgSeg button').forEach(x => x.classList.toggle('on', x === b)); drawTg(); };
function drawTg() {
  const d = TG.data; if (!d) return;
  const r = d.ringkas;
  $('#tgSum').innerHTML = '<div class="c kpi"><span class="v num" style="color:var(--bad)">' + r.belum + '</span><span class="l">Belum bayar</span></div><div class="c kpi"><span class="v num" style="color:var(--warn)">' + r.kurang + '</span><span class="l">Kurang</span></div><div class="c kpi"><span class="v num" style="color:var(--ok)">' + r.lunas + '</span><span class="l">Lunas</span></div>';
  const rows = d.rows.filter(x => TG.status === 'semua' ? true : TG.status === 'tunggak' ? x.status !== 'lunas' : x.status === TG.status);
  $('#tgList').innerHTML = (d.item.kind !== 'kegiatan' || d.item.mode !== 'sukarela' ? '<div class="muted mb-2" style="font-size:13px">Total kurang: <b class="amt out">' + rp(Math.max(0, r.tagihan - r.terbayar)) + '</b></div>' : '') +
    (rows.length ? rows.map(x => '<div class="list-i"><span class="avatar">' + esc(ini(x.nama)) + '</span><div class="grow"><div class="t">' + esc(x.nama) + ' <span class="muted">· ' + esc(x.no) + '</span></div><div class="s">' + (x.kurang > 0 ? 'Kurang ' + rp(x.kurang) + (x.detail ? ' (' + esc(x.detail) + ')' : '') : 'Terbayar ' + rp(x.terbayar)) + '</div></div>' + sb(x.status) + (x.kurang > 0 && x.hp ? '<button class="btn btn-wa btn-sm" data-act="waKirim" data-id="' + x.id + '" aria-label="Kirim pengingat WhatsApp"><i class="bi bi-whatsapp"></i></button>' : '') + '</div>').join('') : emptyH('emoji-smile', 'Tidak ada data pada filter ini.'));
}
const waNum = h => { let d = String(h || '').replace(/\D/g, ''); if (!d) return ''; if (d[0] === '0') d = '62' + d.slice(1); else if (d[0] === '8') d = '62' + d; return d; };
function waMsg(tpl, x, d) {
  const per = d.item.kind === 'bulanan' ? (d.periode && d.periode !== 'semua' ? 'bulan ' + fmtYm(d.periode) : '(s.d. bulan ini)') : d.item.kind === 'jimpitan' ? '(s.d. hari ini)' : '';
  return String(tpl || 'Pengingat {jenis} {periode}: kurang {kurang}.').replace(/\{nama\}/g, x.nama).replace(/\{no_rumah\}/g, x.no).replace(/\{jenis\}/g, d.item.nama).replace(/\{periode\}/g, per).replace(/\{kurang\}/g, rp(x.kurang)).replace(/\{nama_rt\}/g, S.boot.cfg.NAMA_RT).replace(/\s{2,}/g, ' ');
}
ACT.waKirim = b => {
  const x = TG.data.rows.find(r => r.id === b.dataset.id), num = waNum(x && x.hp);
  if (!num) return toast('No. HP warga belum diisi.', 'warn');
  const a = document.createElement('a');
  a.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(waMsg(S.boot.cfg.WA_TEMPLATE, x, TG.data));
  a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); a.remove();
};

/* ===================================================================
 *  LAPORAN TRANSPARAN
 * =================================================================== */
const LP = { tab: 'buku', dari: '', sampai: '', dana: '', data: null };
PAGES.laporan = {
  init() {
    const t = todayJ(); LP.dari = t.slice(0, 7) + '-01'; LP.sampai = t;
    $('#pg-laporan').innerHTML = tabsHtml('lp', [['buku', 'Buku kas umum'], ['rekap', 'Rekap per dana']], 'buku') +
      '<div class="c"><div class="grid g2 mb-2"><div><label class="form-label">Dari</label><input type="date" class="form-control" id="lpA" value="' + LP.dari + '"></div><div><label class="form-label">Sampai</label><input type="date" class="form-control" id="lpB" value="' + LP.sampai + '"></div></div>' +
      '<div id="lpDw" class="mb-2"><label class="form-label">Jenis dana</label><select class="form-select" id="lpD"><option value="">Semua dana</option>' + S.boot.dana.map(d => '<option>' + esc(d) + '</option>').join('') + '</select></div>' +
      '<div class="grid g2"><button class="btn btn-brand" data-act="lpPdf"><i class="bi bi-file-earmark-pdf"></i> Cetak PDF</button><button class="btn btn-ghost" data-act="lpCsv"><i class="bi bi-filetype-csv"></i> Ekspor CSV</button></div></div><div id="lpOut" class="mt-3"></div>';
    ['lpA', 'lpB', 'lpD'].forEach(id => $('#' + id).addEventListener('change', () => { LP.dari = $('#lpA').value; LP.sampai = $('#lpB').value; LP.dana = $('#lpD').value; this.load(); }));
  },
  async load() {
    $('#lpDw').style.display = LP.tab === 'buku' ? '' : 'none';
    $('#lpOut').innerHTML = '<div class="c">' + skel(6) + '</div>';
    try {
      const d = await api(LP.tab === 'buku' ? 'bukuKas' : 'rekapDana', { dari: LP.dari, sampai: LP.sampai, dana: LP.dana });
      LP.data = d;
      if (LP.tab === 'buku') {
        $('#lpOut').innerHTML = '<div class="grid g2 g-md-4"><div class="c kpi"><span class="v num">' + rp(d.saldoAwal) + '</span><span class="l">Saldo awal</span></div><div class="c kpi"><span class="v num amt in">' + rp(d.masuk) + '</span><span class="l">Masuk</span></div><div class="c kpi"><span class="v num amt out">' + rp(d.keluar) + '</span><span class="l">Keluar</span></div><div class="c kpi"><span class="v num">' + rp(d.saldoAkhir) + '</span><span class="l">Saldo akhir</span></div></div>' +
          '<div class="c mt-3" style="padding:6px 10px"><div style="overflow-x:auto"><table class="table"><thead><tr><th>Tanggal</th><th>Keterangan</th><th class="text-end">Masuk</th><th class="text-end">Keluar</th><th class="text-end">Saldo</th></tr></thead><tbody>' +
          (d.rows.length ? d.rows.map(r => '<tr><td class="num">' + fmtD(r.tanggal) + '</td><td style="min-width:190px">' + esc(r.keterangan) + '<div class="muted" style="font-size:11.5px">' + esc(r.jenis_dana) + '</div></td><td class="text-end num amt in">' + (r.tipe === 'masuk' ? rp(r.nominal) : '') + '</td><td class="text-end num amt out">' + (r.tipe === 'keluar' ? rp(r.nominal) : '') + '</td><td class="text-end num">' + rp(r.saldo) + '</td></tr>').join('') : '<tr><td colspan="5">' + emptyH('journal-x', 'Tidak ada transaksi pada periode ini.') + '</td></tr>') + '</tbody></table></div></div>';
      } else {
        $('#lpOut').innerHTML = '<div class="c" style="padding:6px 10px"><div style="overflow-x:auto"><table class="table"><thead><tr><th>Jenis dana</th><th class="text-end">Awal</th><th class="text-end">Masuk</th><th class="text-end">Keluar</th><th class="text-end">Akhir</th></tr></thead><tbody>' +
          d.rows.concat([d.total]).map(r => '<tr' + (r.dana === 'TOTAL' ? ' style="font-weight:800"' : '') + '><td>' + esc(r.dana) + '</td><td class="text-end num">' + rp(r.awal) + '</td><td class="text-end num amt in">' + rp(r.masuk) + '</td><td class="text-end num amt out">' + rp(r.keluar) + '</td><td class="text-end num">' + rp(r.akhir) + '</td></tr>').join('') + '</tbody></table></div></div>';
      }
    } catch (e) { $('#lpOut').innerHTML = '<div class="c">' + emptyH('wifi-off', e.message) + '</div>'; }
  }
};
TABS.lp = v => { LP.tab = v; PAGES.laporan.load(); };
function dlBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return url;
}
ACT.lpPdf = b => act(b, async () => {
  const f = await api('laporanPdf', { dari: LP.dari, sampai: LP.sampai, dana: LP.dana, jenis: LP.tab });
  const bin = atob(f.data), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u8], { type: 'application/pdf' }));
  Mdl.open({ title: 'PDF siap', body: '<div class="text-center py-3"><i class="bi bi-file-earmark-pdf" style="font-size:54px;color:var(--bad)"></i><p class="mt-2 mb-1"><b>' + esc(f.name) + '</b></p><p class="muted mb-0" style="font-size:13px">Ketuk Unduh untuk menyimpan. Buka dari folder Unduhan untuk mencetak.</p></div>', foot: '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button><a class="btn btn-brand" href="' + url + '" download="' + esc(f.name) + '"><i class="bi bi-download"></i> Unduh PDF</a>' });
});
ACT.lpCsv = () => {
  const d = LP.data; if (!d) return toast('Data belum dimuat.', 'warn');
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  let csv = '';
  if (LP.tab === 'buku') { csv = ['Tanggal', 'Jenis dana', 'Kategori', 'Keterangan', 'Masuk', 'Keluar', 'Saldo'].join(',') + '\n' + d.rows.map(r => [r.tanggal, r.jenis_dana, r.kategori, r.keterangan, r.tipe === 'masuk' ? r.nominal : '', r.tipe === 'keluar' ? r.nominal : '', r.saldo].map(q).join(',')).join('\n'); }
  else { csv = ['Jenis dana', 'Saldo awal', 'Masuk', 'Keluar', 'Saldo akhir'].join(',') + '\n' + d.rows.concat([d.total]).map(r => [r.dana, r.awal, r.masuk, r.keluar, r.akhir].map(q).join(',')).join('\n'); }
  dlBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'laporan_' + LP.tab + '_' + LP.dari + '_' + LP.sampai + '.csv');
  toast('CSV diunduh.');
};

/* ===================================================================
 *  MASTER DATA (admin)
 * =================================================================== */
const MD = { tab: 'warga', q: '', un: {} };
PAGES.master = {
  init() { $('#pg-master').innerHTML = tabsHtml('md', [['warga', 'Warga/KK'], ['regu', 'Regu ronda'], ['jenis', 'Jenis iuran'], ['kat', 'Kategori']], 'warga') + '<div id="mdBody"></div>'; },
  load() { TABS.md(MD.tab); }
};
TABS.md = async v => {
  MD.tab = v; const body = $('#mdBody'); body.innerHTML = '<div class="c">' + skel(5) + '</div>';
  try { await ({ warga: mdWarga, regu: mdRegu, jenis: mdJenis, kat: mdKat }[v])(); } catch (e) { body.innerHTML = '<div class="c">' + emptyH('wifi-off', e.message) + '</div>'; }
};

async function mdWarga() {
  S.wargaList = await api('wargaList');
  const draw = q => {
    const l = S.wargaList.filter(w => !q || w.nama_kk.toLowerCase().includes(q) || w.no_rumah.toLowerCase().includes(q) || String(w.username || '').includes(q));
    $('#mdList').innerHTML = l.length ? l.map(w => '<div class="list-i" data-act="wgForm" data-id="' + w.id + '" style="cursor:pointer"><span class="avatar">' + esc(ini(w.nama_kk)) + '</span><div class="grow"><div class="t">' + esc(w.nama_kk) + '</div><div class="s">No. ' + esc(w.no_rumah) + ' · @' + esc(w.username || '—') + (w.pin_default ? ' · <b style="color:var(--warn)">PIN bawaan</b>' : '') + '</div></div>' + (w.status === 'aktif' ? '' : '<span class="sb na">Nonaktif</span>') + '<button class="icon-btn" aria-label="Lihat QR" data-act="qrShow" data-id="' + w.id + '"><i class="bi bi-qr-code"></i></button></div>').join('') : emptyH('people', 'Belum ada data warga.');
  };
  $('#mdBody').innerHTML = '<div class="d-flex gap-2 mb-3"><div class="search flex-fill"><i class="bi bi-search"></i><input class="form-control" id="mdQ" placeholder="Cari warga"></div><button class="btn btn-brand" data-act="wgForm"><i class="bi bi-plus-lg"></i></button></div><button class="btn btn-soft w-100 mb-3" data-act="qrPrint"><i class="bi bi-printer"></i> Cetak QR massal (' + S.wargaList.filter(w => w.status === 'aktif').length + ' KK)</button><div class="c" id="mdList"></div>';
  draw('');
  $('#mdQ').addEventListener('input', debounce(e => draw(e.target.value.toLowerCase()), 150));
}
ACT.wgForm = (b, ev) => {
  if (ev && ev.target.closest('[data-act="qrShow"]')) return;
  const w = b.dataset.id ? S.wargaList.find(x => x.id === b.dataset.id) : null;
  Mdl.open({
    title: w ? 'Ubah warga' : 'Tambah warga',
    body: '<div class="mb-3"><label class="form-label">Nama kepala keluarga</label><input class="form-control" id="wgN" maxlength="80" value="' + esc(w ? w.nama_kk : '') + '"></div>' +
      '<div class="grid g2 mb-3"><div><label class="form-label">No. rumah</label><input class="form-control" id="wgR" maxlength="12" value="' + esc(w ? w.no_rumah : '') + '"></div><div><label class="form-label">No. HP (WA)</label><input class="form-control" id="wgH" inputmode="tel" value="' + esc(w ? w.no_hp : '') + '" placeholder="08…"></div></div>' +
      '<div class="grid g2 mb-1"><div><label class="form-label">Mulai wajib iuran</label><input type="date" class="form-control" id="wgM" value="' + esc(w ? w.tgl_mulai : (S.boot.cfg.TGL_MULAI || todayJ())) + '"></div><div><label class="form-label">Status</label><select class="form-select" id="wgS"><option value="aktif"' + (w && w.status !== 'aktif' ? '' : ' selected') + '>Aktif</option><option value="nonaktif"' + (w && w.status !== 'aktif' ? ' selected' : '') + '>Nonaktif</option></select></div></div>' +
      '<div class="mt-3"><label class="form-label">Username login</label><input class="form-control" id="wgU" maxlength="30" autocapitalize="off" autocomplete="off" value="' + esc(w ? w.username : '') + '" placeholder="' + (w ? '' : 'kosongkan = dibuat otomatis dari nama') + '"><div class="muted mt-1" style="font-size:12px">' + (w ? 'Warga masuk dengan username ini (bukan no. rumah). Jika warga ini anggota regu ronda, hak input jimpitan otomatis aktif di akun yang sama — tidak perlu akun baru.' : 'Warga masuk dengan username ini + PIN bawaan. Contoh otomatis: budi.santoso. Huruf kecil, angka, titik, garis bawah, atau tanda hubung.') + '</div></div>',
    foot: (w ? '<button class="btn btn-danger-soft" data-act="wgDel" data-id="' + w.id + '"><i class="bi bi-trash"></i></button>' : '') + (w && w.user_id ? '<button class="btn btn-ghost" data-act="usReset" data-id="' + w.user_id + '"><i class="bi bi-key"></i> Reset PIN</button>' : '') + '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="wgOk">Simpan</button>',
    onShow() { $('#wgOk').onclick = ev2 => act(ev2.currentTarget, async () => { const r = await apiW('wargaSimpan', { id: w ? w.id : '', nama_kk: $('#wgN').value, no_rumah: $('#wgR').value, no_hp: $('#wgH').value, tgl_mulai: $('#wgM').value, status: $('#wgS').value, username: $('#wgU').value.trim() }); toast('Data warga disimpan.'); invalidate(); S.loaded.master = Date.now(); mdWarga(); if (!w) showAkunBaru([{ nama: $('#wgN').value.trim(), username: r.username, pin: r.pin }]); else Mdl.close(); }); }
  });
};
ACT.wgDel = async b => {
  if (!(await confirmBox('Hapus warga ini beserta akun loginnya?', 'Hapus', true))) return;
  act(null, async () => { await apiW('wargaHapus', { id: b.dataset.id }); Mdl.close(); toast('Warga dihapus.'); invalidate(); S.loaded.master = Date.now(); mdWarga(); });
};
ACT.qrShow = b => act(b, async () => {
  const w = S.wargaList.find(x => x.id === b.dataset.id); await loadScript(LIB.qr);
  Mdl.open({ title: 'QR jimpitan', body: '<div class="text-center"><div id="qrOne" class="d-flex justify-content-center my-2" style="background:#fff;padding:14px;border-radius:16px;display:inline-flex"></div><h5 class="mt-2 mb-0">' + esc(w.nama_kk) + '</h5><div class="muted">No. rumah ' + esc(w.no_rumah) + '</div></div>', foot: '<button class="btn btn-brand" data-act="qrPrint" data-id="' + w.id + '"><i class="bi bi-printer"></i> Cetak</button>', onShow() { new QRCode($('#qrOne'), { text: w.kode_qr, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); } });
});
ACT.qrPrint = b => act(b, async () => {
  await loadScript(LIB.qr);
  const list = b.dataset.id ? S.wargaList.filter(w => w.id === b.dataset.id) : S.wargaList.filter(w => w.status === 'aktif');
  const pa = $('#printArea'); pa.innerHTML = '<div class="qr-grid">' + list.map((w, i) => '<div class="qr-card"><small>Jimpitan RT · ' + esc(S.boot.cfg.NAMA_RT) + '</small><div class="qimg" id="pq' + i + '"></div><b>' + esc(w.nama_kk) + '</b><small>No. rumah ' + esc(w.no_rumah) + '</small></div>').join('') + '</div>';
  list.forEach((w, i) => new QRCode($('#pq' + i), { text: w.kode_qr, width: 110, height: 110, correctLevel: QRCode.CorrectLevel.M }));
  await sleep(350);
  try { window.print(); } catch (e) { toast('Perintah cetak tidak dapat dijalankan di perangkat ini.', 'warn'); }
});

async function mdRegu() {
  if (!S.wargaList) S.wargaList = await api('wargaList');
  const l = S.boot.regu, nm = id => { const w = S.wargaList.find(x => x.id === id); return w ? w.nama_kk : null; };
  $('#mdBody').innerHTML = '<div class="insight info"><i class="bi bi-info-circle"></i><div>Petugas ronda dipilih dari <b>warga anggota regu</b>. Mereka <b>tetap masuk dengan username warganya</b> — tidak perlu akun baru. Hak input jimpitan otomatis aktif saat jadwal regunya.</div></div>' +
    '<button class="btn btn-brand w-100 mb-3" data-act="rgForm"><i class="bi bi-plus-lg"></i> Tambah regu</button>' +
    (l.length ? l.map(r => {
      const ang = String(r.anggota || '').split(',').filter(Boolean).map(nm).filter(Boolean);
      return '<div class="c" style="cursor:pointer" data-act="rgForm" data-id="' + r.id + '"><div class="d-flex justify-content-between align-items-center"><b>' + esc(r.nama_regu) + '</b><span class="sb info">' + esc(r.jam_mulai) + '–' + esc(r.jam_selesai) + '</span></div><div class="mt-2">' + r.hari_aktif.split(',').map(h => '<span class="sb lunas me-1">' + esc(h) + '</span>').join('') + '</div><div class="muted mt-2" style="font-size:12.5px"><i class="bi bi-people"></i> ' + (ang.length ? ang.length + ' anggota: ' + esc(ang.join(', ')) : 'Belum ada anggota') + '</div></div>';
    }).join('') : '<div class="c">' + emptyH('people', 'Belum ada regu ronda.') + '</div>');
}
ACT.rgForm = b => {
  const r = b.dataset.id ? S.boot.regu.find(x => x.id === b.dataset.id) : null, on = r ? r.hari_aktif.split(',') : [];
  const sel = new Set(r ? String(r.anggota || '').split(',').filter(Boolean) : []), lain = {};
  S.boot.regu.forEach(g => { if (!r || g.id !== r.id) String(g.anggota || '').split(',').filter(Boolean).forEach(id => { (lain[id] = lain[id] || []).push(g.nama_regu); }); });
  Mdl.open({
    title: r ? 'Ubah regu' : 'Tambah regu',
    body: '<div class="mb-3"><label class="form-label">Nama regu</label><input class="form-control" id="rgN" maxlength="40" value="' + esc(r ? r.nama_regu : '') + '"></div><div class="mb-3"><label class="form-label">Hari aktif</label><div class="chk-hari">' + ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'].map(h => '<label><input type="checkbox" value="' + h + '"' + (on.includes(h) ? ' checked' : '') + '><span>' + h + '</span></label>').join('') + '</div></div>' +
      '<div class="grid g2"><div><label class="form-label">Jam mulai</label><input type="time" class="form-control" id="rgA" value="' + esc(r ? r.jam_mulai : '21:00') + '"></div><div><label class="form-label">Jam selesai</label><input type="time" class="form-control" id="rgB" value="' + esc(r ? r.jam_selesai : '04:00') + '"></div></div><div class="muted mt-2" style="font-size:12.5px">Jika jam selesai lebih kecil dari jam mulai, giliran melewati tengah malam dan dicatat ke tanggal awal giliran.</div>' +
      '<div class="mt-3"><label class="form-label">Anggota regu (petugas ronda) <span id="rgCnt" class="sb info ms-1"></span></label><input class="form-control mb-2" id="rgQ" placeholder="Cari nama / no. rumah…" autocomplete="off"><div id="rgAng" style="max-height:230px;overflow:auto;border:1.5px solid var(--line);border-radius:12px;padding:2px 10px"></div></div>',
    foot: (r ? '<button class="btn btn-danger-soft" data-act="rgDel" data-id="' + r.id + '"><i class="bi bi-trash"></i></button>' : '') + '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="rgOk">Simpan</button>',
    onShow(body) {
      const cnt = () => { $('#rgCnt').textContent = sel.size + ' dipilih'; };
      const draw = q => {
        const l = S.wargaList.filter(w => w.status === 'aktif' && (!q || w.nama_kk.toLowerCase().includes(q) || w.no_rumah.toLowerCase().includes(q)));
        $('#rgAng').innerHTML = l.length ? l.map(w => '<label class="list-i" style="cursor:pointer;margin:0"><input type="checkbox" class="form-check-input m-0" data-id="' + w.id + '"' + (sel.has(w.id) ? ' checked' : '') + '><span class="grow"><span class="t" style="display:block">' + esc(w.nama_kk) + '</span><span class="s">No. ' + esc(w.no_rumah) + (lain[w.id] ? ' · juga di ' + esc(lain[w.id].join(', ')) : '') + '</span></span></label>').join('') : emptyH('people', 'Warga tidak ditemukan');
        cnt();
      };
      $('#rgAng').addEventListener('change', e => { const c = e.target.closest('input[data-id]'); if (!c) return; if (c.checked) sel.add(c.dataset.id); else sel.delete(c.dataset.id); cnt(); });
      $('#rgQ').addEventListener('input', debounce(e => draw(e.target.value.trim().toLowerCase()), 120));
      draw('');
      $('#rgOk').onclick = ev => act(ev.currentTarget, async () => {
        await apiW('reguSimpan', { id: r ? r.id : '', nama_regu: $('#rgN').value, hari: $$('.chk-hari input:checked', body).map(x => x.value), jam_mulai: $('#rgA').value, jam_selesai: $('#rgB').value, anggota: Array.from(sel) });
        toast('Regu disimpan.'); await refreshBoot(); S.loaded.master = Date.now(); mdRegu();
        Mdl.close();
      });
    }
  });
};
ACT.rgDel = async b => { if (!(await confirmBox('Hapus regu ini?', 'Hapus', true))) return; act(null, async () => { await apiW('reguHapus', { id: b.dataset.id }); Mdl.close(); toast('Regu dihapus.'); await refreshBoot(); S.loaded.master = Date.now(); mdRegu(); }); };

async function mdJenis() {
  const l = S.boot.jenis;
  $('#mdBody').innerHTML = '<button class="btn btn-brand w-100 mb-3" data-act="jnForm"><i class="bi bi-plus-lg"></i> Tambah jenis iuran</button><div class="c">' + l.map(j => '<div class="list-i" data-act="jnForm" data-id="' + j.id + '" style="cursor:pointer"><div class="dot"><i class="bi bi-' + (j.periode === 'harian' ? 'moon-stars' : 'cash-coin') + '"></i></div><div class="grow"><div class="t">' + esc(j.nama) + '</div><div class="s">' + esc(j.periode) + '</div></div><span class="amt">' + rp(j.nominal) + '</span></div>').join('') + '</div>';
}
ACT.jnForm = b => {
  const j = b.dataset.id ? S.boot.jenis.find(x => x.id === b.dataset.id) : null, jp = j && j.id === 'JI-JIMPITAN';
  Mdl.open({
    title: j ? 'Ubah jenis iuran' : 'Tambah jenis iuran',
    body: '<div class="mb-3"><label class="form-label">Nama</label><input class="form-control" id="jnN" maxlength="40" value="' + esc(j ? j.nama : '') + '"' + (jp ? ' disabled' : '') + '></div><div class="grid g2"><div><label class="form-label">Nominal</label><input class="form-control" id="jnV" inputmode="numeric" data-money value="' + fmtNum(j ? j.nominal : '') + '"></div><div><label class="form-label">Periode</label><select class="form-select" id="jnP"' + (jp ? ' disabled' : '') + '><option value="bulanan"' + (j && j.periode === 'bulanan' ? ' selected' : '') + '>Bulanan</option><option value="sekali"' + (j && j.periode === 'sekali' ? ' selected' : '') + '>Sekali bayar</option>' + (jp ? '<option value="harian" selected>Harian</option>' : '') + '</select></div></div>' + (jp ? '<div class="muted mt-2" style="font-size:12.5px">Nominal jimpitan harian berlaku sama untuk semua rumah.</div>' : ''),
    foot: (j && !jp ? '<button class="btn btn-danger-soft" data-act="jnDel" data-id="' + j.id + '"><i class="bi bi-trash"></i></button>' : '') + '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="jnOk">Simpan</button>',
    onShow() { $('#jnOk').onclick = ev => act(ev.currentTarget, async () => { await apiW('jenisSimpan', { id: j ? j.id : '', nama: $('#jnN').value || (j && j.nama), nominal: numOf($('#jnV')), periode: $('#jnP').value }); Mdl.close(); toast('Jenis iuran disimpan.'); await refreshBoot(); S.loaded.master = Date.now(); mdJenis(); }); }
  });
};
ACT.jnDel = async b => { if (!(await confirmBox('Hapus jenis iuran ini?', 'Hapus', true))) return; act(null, async () => { await apiW('jenisHapus', { id: b.dataset.id }); Mdl.close(); toast('Jenis dihapus.'); await refreshBoot(); S.loaded.master = Date.now(); mdJenis(); }); };

async function mdKat() {
  const c = S.boot.cfg;
  $('#mdBody').innerHTML = '<div class="c"><div class="mb-3"><label class="form-label">Kategori pemasukan (1 baris = 1 kategori)</label><textarea class="form-control" id="ktM" rows="5">' + esc(c.KAT_MASUK.join('\n')) + '</textarea></div><div class="mb-3"><label class="form-label">Kategori pengeluaran</label><textarea class="form-control" id="ktK" rows="7">' + esc(c.KAT_KELUAR.join('\n')) + '</textarea></div><button class="btn btn-brand w-100" data-act="ktSimpan">Simpan kategori</button></div>';
}
ACT.ktSimpan = b => act(b, async () => {
  const sp = id => $('#' + id).value.split('\n').map(s => s.trim()).filter(Boolean);
  await apiW('kategoriSimpan', { masuk: sp('ktM'), keluar: sp('ktK') }); await refreshBoot(); S.loaded.master = Date.now(); toast('Kategori disimpan.');
});

/* ===================================================================
 *  PENGATURAN (admin)
 * =================================================================== */
const PG = { tab: 'umum' };
PAGES.pengaturan = {
  init() { $('#pg-pengaturan').innerHTML = tabsHtml('pg', [['umum', 'Umum'], ['wa', 'Pesan WA'], ['user', 'Pengguna'], ['sis', 'Sistem'], ['log', 'Log']], 'umum') + '<div id="pgBody"></div>'; },
  load() { TABS.pg(PG.tab); }
};
TABS.pg = async v => {
  PG.tab = v; const body = $('#pgBody'); body.innerHTML = '<div class="c">' + skel(5) + '</div>';
  try { await ({ umum: pgUmum, wa: pgWa, user: pgUser, sis: pgSis, log: pgLog }[v])(); } catch (e) { body.innerHTML = '<div class="c">' + emptyH('wifi-off', e.message) + '</div>'; }
};
function pgUmum() {
  const c = S.boot.cfg;
  $('#pgBody').innerHTML = '<div class="c"><h6 class="c-t">Identitas RT</h6><div class="mb-3"><label class="form-label">Nama RT / RW</label><input class="form-control" id="cfN" value="' + esc(c.NAMA_RT) + '"></div><div class="mb-3"><label class="form-label">Alamat</label><input class="form-control" id="cfA" value="' + esc(c.ALAMAT_RT) + '"></div><div class="grid g2"><div><label class="form-label">Ketua RT</label><input class="form-control" id="cfK" value="' + esc(c.KETUA_RT) + '"></div><div><label class="form-label">Bendahara</label><input class="form-control" id="cfB" value="' + esc(c.BENDAHARA) + '"></div></div></div>' +
    '<div class="c"><h6 class="c-t">Nominal &amp; jadwal</h6><div class="mb-3"><label class="form-label">Nominal jimpitan harian (semua rumah)</label><input class="form-control" id="cfJ" inputmode="numeric" data-money value="' + fmtNum(c.JIMPITAN_NOMINAL) + '"></div><div class="mb-3"><label class="form-label">Tombol nominal ronda (pisahkan koma)</label><input class="form-control" id="cfT" value="' + esc(c.TOMBOL.join(', ')) + '"></div><div class="mb-3"><label class="form-label">Tanggal mulai iuran (default warga baru)</label><input type="date" class="form-control" id="cfM" value="' + esc(c.TGL_MULAI) + '"></div><div><label class="form-label">PIN bawaan akun baru / reset</label><input class="form-control" id="cfP" inputmode="numeric" maxlength="8" placeholder="Kosongkan jika tidak diubah"></div><div class="muted mt-2" style="font-size:12.5px">Nominal Dana Sosial/Kematian diatur di Master Data → Jenis iuran.</div></div>' +
    '<button class="btn btn-brand w-100" data-act="cfSimpan">Simpan pengaturan</button>';
}
ACT.cfSimpan = b => act(b, async () => {
  const items = { NAMA_RT: $('#cfN').value, ALAMAT_RT: $('#cfA').value, KETUA_RT: $('#cfK').value, BENDAHARA: $('#cfB').value, JIMPITAN_NOMINAL: numOf($('#cfJ')), TOMBOL: $('#cfT').value.split(',').map(x => Number(x.replace(/\D/g, ''))).filter(x => x > 0), TGL_MULAI: $('#cfM').value };
  if ($('#cfP').value.trim()) items.DEFAULT_PIN = $('#cfP').value.trim();
  const r = await apiW('configSimpan', { items }); S.boot.cfg = r.cfg; $('#sbRt').textContent = r.cfg.NAMA_RT; $('#pgSub').textContent = r.cfg.NAMA_RT;
  await refreshBoot(); S.loaded.pengaturan = Date.now(); toast('Pengaturan disimpan.');
});
function pgWa() {
  const t = S.boot.cfg.WA_TEMPLATE;
  $('#pgBody').innerHTML = '<div class="c"><h6 class="c-t">Template pesan pengingat</h6><textarea class="form-control" id="waT" rows="6" maxlength="600">' + esc(t) + '</textarea><div class="muted mt-2" style="font-size:12.5px">Placeholder: <code>{nama}</code> <code>{no_rumah}</code> <code>{jenis}</code> <code>{periode}</code> <code>{kurang}</code> <code>{nama_rt}</code></div><div class="insight info mt-3"><i class="bi bi-eye"></i><div id="waPrev"></div></div><button class="btn btn-brand w-100" data-act="waSimpan">Simpan template</button></div>';
  const pv = () => { $('#waPrev').textContent = waMsg($('#waT').value, { nama: 'Budi Santoso', no: '12', kurang: 20000 }, { item: { nama: 'Dana Sosial', kind: 'bulanan' }, periode: todayJ().slice(0, 7) }); };
  $('#waT').addEventListener('input', pv); pv();
}
ACT.waSimpan = b => act(b, async () => { const r = await apiW('configSimpan', { items: { WA_TEMPLATE: $('#waT').value } }); S.boot.cfg = r.cfg; toast('Template disimpan.'); });

async function pgUser() {
  const [us] = await Promise.all([api('users'), S.wargaList ? 0 : api('wargaList').then(x => { S.wargaList = x; })]);
  PG.users = us;
  const RL = { admin: 'Admin', pengurus: 'Pengurus RT', petugas: 'Petugas Ronda', warga: 'Warga' };
  $('#pgBody').innerHTML = '<button class="btn btn-brand w-100 mb-3" data-act="usForm"><i class="bi bi-person-plus"></i> Tambah pengguna</button><div class="c">' + us.map(u => '<div class="list-i" data-act="usForm" data-id="' + u.id + '" style="cursor:pointer"><span class="avatar">' + esc(ini(u.nama)) + '</span><div class="grow"><div class="t">' + esc(u.nama) + '</div><div class="s">@' + esc(u.username) + ' · ' + RL[u.role] + (u.regu ? ' · ' + esc(u.regu) : '') + '</div></div>' + (u.pin_default && u.status === 'aktif' ? '<span class="sb kurang">PIN bawaan</span> ' : '') + (u.status === 'aktif' ? '' : '<span class="sb na">Nonaktif</span>') + '</div>').join('') + '</div>';
}
ACT.usForm = b => {
  const u = b.dataset.id ? PG.users.find(x => x.id === b.dataset.id) : null;
  Mdl.open({
    title: u ? 'Ubah pengguna' : 'Tambah pengguna',
    body: '<div class="mb-3"><label class="form-label">Nama</label><input class="form-control" id="usN" value="' + esc(u ? u.nama : '') + '"></div><div class="mb-3"><label class="form-label">Username / no. rumah</label><input class="form-control" id="usU" value="' + esc(u ? u.username : '') + '" autocapitalize="off"></div>' +
      '<div class="grid g2 mb-3"><div><label class="form-label">Peran</label><select class="form-select" id="usR">' + [['admin', 'Admin'], ['pengurus', 'Pengurus RT'], ['warga', 'Warga']].concat(u && u.role === 'petugas' ? [['petugas', 'Petugas (akun lama)']] : []).map(r => '<option value="' + r[0] + '"' + (u && u.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('') + '</select></div><div><label class="form-label">Status</label><select class="form-select" id="usS"><option value="aktif">Aktif</option><option value="nonaktif"' + (u && u.status !== 'aktif' ? ' selected' : '') + '>Nonaktif</option></select></div></div>' +
      '<div class="muted mb-3" style="font-size:12.5px">Petugas ronda tidak perlu akun terpisah: tambahkan warga ke regu (Master Data → Regu ronda), lalu ia masuk dengan username warganya.</div>' +
      '<div class="mb-3" id="usWw"><label class="form-label">Terhubung ke warga</label><select class="form-select" id="usW"><option value="">—</option>' + wargaOpts(u ? u.id_warga : '') + '</select></div>' +
      '<div class="mb-3" id="usGw"><label class="form-label">Regu ronda</label><select class="form-select" id="usG"><option value="">—</option>' + S.boot.regu.map(r => '<option value="' + r.id + '"' + (u && u.id_regu === r.id ? ' selected' : '') + '>' + esc(r.nama_regu) + '</option>').join('') + '</select></div>' +
      '<div class="mb-1"><label class="form-label">' + (u ? 'PIN baru (kosongkan jika tidak diubah)' : 'PIN awal (kosong = PIN bawaan)') + '</label><input class="form-control" id="usP" inputmode="numeric" maxlength="8"></div>',
    foot: (u ? '<button class="btn btn-danger-soft" data-act="usDel" data-id="' + u.id + '"><i class="bi bi-trash"></i></button><button class="btn btn-ghost" data-act="usReset" data-id="' + u.id + '"><i class="bi bi-key"></i> Reset PIN</button>' : '') + '<button class="btn btn-brand" id="usOk">Simpan</button>',
    onShow() {
      const tg = () => { const r = $('#usR').value; $('#usWw').style.display = (r === 'warga' || r === 'petugas') ? '' : 'none'; $('#usGw').style.display = (r === 'petugas' && u && u.id_regu && !u.id_warga) ? '' : 'none'; }; $('#usR').onchange = tg; tg();
      $('#usOk').onclick = ev => act(ev.currentTarget, async () => { await apiW('userSimpan', { id: u ? u.id : '', nama: $('#usN').value, username: $('#usU').value, role: $('#usR').value, status: $('#usS').value, id_warga: $('#usW').value, id_regu: $('#usG').value, pin: $('#usP').value.trim() }); Mdl.close(); toast('Pengguna disimpan.'); await refreshBoot(); S.loaded.pengaturan = Date.now(); pgUser(); });
    }
  });
};
ACT.usReset = async b => {
  if (!(await confirmBox('Reset PIN pengguna ini ke PIN bawaan?', 'Reset'))) return;
  act(null, async () => { const r = await apiW('userReset', { id: b.dataset.id }); Mdl.open({ title: 'PIN direset', body: '<div class="text-center py-2"><div class="muted">Username <b>' + esc(r.username) + '</b></div><div class="amt" style="font-size:34px;letter-spacing:.2em;margin:8px 0">' + esc(r.pin) + '</div><div class="muted" style="font-size:13px">Sampaikan PIN ini ke pengguna dan minta segera menggantinya.</div></div>' }); });
};
ACT.usDel = async b => { if (!(await confirmBox('Hapus pengguna ini?', 'Hapus', true))) return; act(null, async () => { await apiW('userHapus', { id: b.dataset.id }); Mdl.close(); toast('Pengguna dihapus.'); S.loaded.pengaturan = Date.now(); pgUser(); }); };

async function pgSis() {
  const s = await api('sistem'), n = Math.max(1, Perf.n);
  $('#pgBody').innerHTML = '<div class="c"><h6 class="c-t">Penyimpanan</h6><div class="mb-3"><label class="form-label">ID Spreadsheet database</label><input class="form-control" id="ssId" value="' + esc(s.SPREADSHEET_ID) + '"></div><div class="mb-3"><label class="form-label">ID Folder bukti (Drive)</label><input class="form-control" id="sfId" value="' + esc(s.BUKTI_FOLDER_ID) + '"></div>' + (s.url ? '<a class="btn btn-ghost w-100 mb-2" target="_blank" rel="noopener" href="' + esc(s.url) + '"><i class="bi bi-box-arrow-up-right"></i> Buka spreadsheet</a>' : '') + '<button class="btn btn-brand w-100" data-act="ssSimpan">Simpan ID</button><div class="muted mt-2" style="font-size:12.5px">Ubah hanya jika memindahkan database. ID salah membuat aplikasi tidak bisa membaca data.</div></div>' +
    '<div class="c"><h6 class="c-t">Telemetri sesi ini</h6><div class="grid g2"><div class="kpi"><span class="v num">' + Perf.n + '</span><span class="l">Panggilan</span></div><div class="kpi"><span class="v num">' + Math.round(Perf.tot / n) + ' ms</span><span class="l">Rata-rata total</span></div><div class="kpi"><span class="v num">' + Math.round(Perf.srv / n) + ' ms</span><span class="l">Rata-rata server</span></div><div class="kpi"><span class="v num">' + Math.max(0, Math.round((Perf.tot - Perf.srv) / n)) + ' ms</span><span class="l">Rata-rata jaringan</span></div></div>' + (Perf.slow.length ? '<div class="muted mt-2" style="font-size:12.5px">Lambat (&gt;3 dtk): ' + esc(Perf.slow.slice(-5).join(', ')) + '</div>' : '') + '<div class="muted mt-2" style="font-size:12.5px">Versi aplikasi ' + esc(s.versi) + '</div><button class="btn btn-ghost w-100 mt-3" data-act="clearCache"><i class="bi bi-trash3"></i> Kosongkan cache lokal</button></div>';
}
ACT.ssSimpan = b => act(b, async () => { await apiW('sistemSimpan', { SPREADSHEET_ID: $('#ssId').value, BUKTI_FOLDER_ID: $('#sfId').value }); invalidate(); toast('ID tersimpan & diverifikasi.'); });
ACT.clearCache = () => { Store.clearCache(); toast('Cache lokal dikosongkan.'); };
async function pgLog() {
  const l = await api('logList', { limit: 120 });
  $('#pgBody').innerHTML = '<div class="c">' + (l.length ? l.map(x => '<div class="list-i" style="align-items:flex-start"><div class="dot" style="width:32px;height:32px"><i class="bi bi-activity"></i></div><div class="grow"><div class="t" style="white-space:normal"><b>' + esc(x.aksi) + '</b> <span class="muted">— ' + esc(x.user) + '</span></div><div class="s" style="white-space:normal">' + esc(x.detail) + '</div><div class="s">' + esc(x.timestamp) + '</div></div></div>').join('') : emptyH('activity', 'Belum ada aktivitas tercatat.')) + '</div>';
}

/* ===================================================================
 *  MENU (HP) & INISIALISASI
 * =================================================================== */
PAGES.menu = {
  init() {
    const u = S.user, RL = { admin: 'Admin', pengurus: 'Pengurus RT', petugas: 'Petugas Ronda', warga: 'Warga' };
    const rest = navAllowed().filter(n => !BOTTOM[u.role].includes(n.id));
    $('#pg-menu').innerHTML = '<div class="c d-flex align-items-center gap-3"><span class="avatar" style="width:52px;height:52px;font-size:18px">' + esc(ini(u.nama)) + '</span><div><b style="font-size:17px">' + esc(u.nama) + '</b><div class="muted">' + (u.role === 'petugas' && u.base === 'warga' ? 'Warga · Petugas ronda' : RL[u.role]) + ' · @' + esc(u.username) + '</div></div></div>' +
      (rest.length ? '<div class="c mt-3">' + rest.map(n => '<div class="list-i" data-act="nav" data-p="' + n.id + '" style="cursor:pointer"><div class="dot"><i class="bi bi-' + n.i + '"></i></div><div class="grow t">' + navTitle(n.id) + '</div><i class="bi bi-chevron-right muted"></i></div>').join('') + '</div>' : '') +
      '<div class="c mt-3"><div class="list-i" data-act="theme" style="cursor:pointer"><div class="dot"><i class="bi bi-moon-stars"></i></div><div class="grow t">Mode gelap / terang</div></div><div class="list-i" data-act="pin" style="cursor:pointer"><div class="dot"><i class="bi bi-key"></i></div><div class="grow t">Ganti PIN</div></div><div class="list-i" data-act="logout" style="cursor:pointer"><div class="dot" style="background:var(--bad-soft);color:var(--bad)"><i class="bi bi-box-arrow-right"></i></div><div class="grow t">Keluar</div></div></div>' +
      '<div class="text-center muted mt-3" style="font-size:12px">Jimpitan RT v2.4 · ' + esc(S.boot.cfg.NAMA_RT) + '</div>';
  }
};

/* ===================================================================
 *  KREDENSIAL AKUN PETUGAS BARU
 * =================================================================== */
function showAkunBaru(list) {
  const txt = list.map(a => a.nama + ' — username: ' + a.username + ' — PIN: ' + a.pin).join('\n');
  Mdl.open({
    title: 'Akun login dibuat',
    body: '<div class="insight info"><i class="bi bi-info-circle"></i><div>Berikan username &amp; PIN ini ke yang bersangkutan, lalu minta mengganti PIN setelah masuk pertama kali.</div></div>' +
      list.map(a => '<div class="list-i"><span class="avatar">' + esc(ini(a.nama)) + '</span><div class="grow"><div class="t">' + esc(a.nama) + '</div><div class="s">Username: <b>' + esc(a.username) + '</b> · PIN awal: <b>' + esc(a.pin) + '</b></div></div></div>').join(''),
    foot: '<button class="btn btn-ghost" data-act="copyAkun" data-txt="' + esc(txt) + '"><i class="bi bi-clipboard"></i> Salin</button><button class="btn btn-brand" data-bs-dismiss="modal">Mengerti</button>'
  });
}
ACT.copyAkun = b => { try { navigator.clipboard.writeText(b.dataset.txt).then(() => toast('Disalin ke papan klip.'), () => toast('Tidak dapat menyalin.', 'warn')); } catch (e) { toast('Tidak dapat menyalin.', 'warn'); } };

/* ===================================================================
 *  ARISAN — peserta sukarela (nama bebas), daftar sudah dapat, alat undian
 * =================================================================== */
const AR = { list: [], id: null, d: null, tab: 'peserta', filter: 'semua', spinning: false, reveal: null };
const PER_AR = { mingguan: 'Mingguan', dua_mingguan: 'Dua mingguan', bulanan: 'Bulanan' };
PAGES.arisan = {
  init() { $('#pg-arisan').innerHTML = '<div id="arList"></div><div id="arDet" class="d-none-i"></div>'; },
  async load() {
    if (isStaff() && !S.wargaList) { try { S.wargaList = await api('wargaList'); } catch (e) { /* abaikan */ } }
    if (AR.id) loadArDetail(); else loadArList();
  }
};
const arCard = a => '<div class="c" style="cursor:pointer" data-act="arOpen" data-id="' + a.id + '">' +
  '<div class="d-flex justify-content-between align-items-start gap-2"><div style="min-width:0"><b style="font-size:16.5px">' + esc(a.nama) + '</b><div class="muted" style="font-size:12.5px">Iuran ' + rp(a.iuran) + ' · ' + PER_AR[a.periode] + ' · Siklus ' + a.siklus + '</div></div><span class="sb ' + (a.status === 'aktif' ? 'lunas' : 'na') + '">' + (a.status === 'aktif' ? 'Aktif' : 'Selesai') + '</span></div>' +
  '<div class="progress mt-3"><div class="progress-bar" style="width:' + (a.peserta ? Math.round(a.sudah / a.peserta * 100) : 0) + '%"></div></div>' +
  '<div class="d-flex justify-content-between mt-1" style="font-size:12.5px"><span class="muted">' + a.sudah + ' dari ' + a.peserta + ' peserta sudah dapat</span><b>' + a.belum + ' belum</b></div>' +
  '<div class="d-flex gap-2 flex-wrap mt-2">' + (a.saya ? '<span class="sb info">Anda peserta</span>' : '') + '<span class="sb ' + (a.undian === 'aktif' ? 'lunas' : 'na') + '"><i class="bi bi-dice-5"></i> Undian ' + (a.undian === 'aktif' ? 'aktif' : 'nonaktif') + '</span><span class="sb info">Total/putaran ' + rp(a.total) + '</span></div></div>';
async function loadArList() {
  AR.id = null; AR.d = null;
  $('#arDet').classList.add('d-none-i');
  const el = $('#arList'); el.classList.remove('d-none-i');
  if (!el.innerHTML) el.innerHTML = '<div class="c">' + skel(4) + '</div>';
  try {
    AR.list = await api('arisanList');
    el.innerHTML = '<div class="insight info"><i class="bi bi-info-circle"></i><div>Arisan bersifat <b>sukarela</b>: hanya warga/orang yang didaftarkan sebagai peserta yang ikut.</div></div>' +
      (isStaff() ? '<button class="btn btn-brand w-100 mb-3" data-act="arForm"><i class="bi bi-plus-lg"></i> Buat arisan baru</button>' : '') +
      (AR.list.length ? AR.list.map(arCard).join('') : '<div class="c">' + emptyH('gift', isStaff() ? 'Belum ada arisan. Buat yang pertama.' : 'Belum ada arisan di RT ini.') + '</div>');
  } catch (e) { el.innerHTML = '<div class="c">' + emptyH('wifi-off', e.message) + '</div>'; }
}
ACT.arOpen = b => { AR.reveal = null; AR.id = b.dataset.id; AR.tab = 'peserta'; AR.filter = 'semua'; AR.d = null; loadArDetail(); window.scrollTo(0, 0); };
ACT.arBack = () => { loadArList(); window.scrollTo(0, 0); };
async function loadArDetail() {
  $('#arList').classList.add('d-none-i');
  const el = $('#arDet'); el.classList.remove('d-none-i');
  if (!AR.d) el.innerHTML = '<div class="c">' + skel(6) + '</div>';
  try { AR.d = await api('arisanDetail', { id: AR.id }); drawArDetail(); }
  catch (e) {
    if (/tidak ditemukan/i.test(e.message)) return loadArList();
    el.innerHTML = '<button class="btn btn-sm btn-ghost mb-2" data-act="arBack">‹ Semua arisan</button><div class="c">' + emptyH('wifi-off', e.message) + '</div>';
  }
}
function drawArDetail() {
  const d = AR.d, a = d.arisan, el = $('#arDet'), aktifP = d.peserta.filter(p => p.status === 'aktif'), sudah = aktifP.filter(p => p.sudah).length;
  const on = a.undian === 'aktif';
  el.innerHTML = '<button class="btn btn-sm btn-ghost mb-2" data-act="arBack"><i class="bi bi-chevron-left"></i> Semua arisan</button>' +
    '<div class="c"><div class="d-flex justify-content-between align-items-start gap-2"><div style="min-width:0"><h5 class="mb-1">' + esc(a.nama) + '</h5><div class="muted" style="font-size:12.5px">Iuran ' + rp(a.iuran) + ' · ' + PER_AR[a.periode] + ' · Siklus ' + a.siklus + (a.catatan ? '<br>' + esc(a.catatan) : '') + '</div></div>' +
    (isStaff() ? '<button class="icon-btn" data-act="arForm" data-id="' + a.id + '" aria-label="Ubah arisan"><i class="bi bi-pencil"></i></button>' : '<span class="sb ' + (a.status === 'aktif' ? 'lunas' : 'na') + '">' + (a.status === 'aktif' ? 'Aktif' : 'Selesai') + '</span>') + '</div>' +
    '<div class="progress mt-3"><div class="progress-bar" style="width:' + (aktifP.length ? Math.round(sudah / aktifP.length * 100) : 0) + '%"></div></div>' +
    '<div class="d-flex justify-content-between mt-1" style="font-size:12.5px"><span class="muted">' + sudah + ' dari ' + aktifP.length + ' peserta sudah dapat</span><b>' + d.sisa + ' belum</b></div>' +
    '<div class="d-flex align-items-center justify-content-between gap-2 mt-3 pt-3" style="border-top:1px dashed var(--line)"><div><b><i class="bi bi-dice-5"></i> Alat undian</b><div class="muted" style="font-size:12px">' + (on ? 'Aktif — pengurus dapat mengundi pemenang' : 'Nonaktif — pemenang dicatat manual') + '</div></div>' +
    (isStaff() ? '<div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" id="arUndiSw" aria-label="Alat undian" style="width:3em;height:1.5em"' + (on ? ' checked' : '') + '></div>' : '<span class="sb ' + (on ? 'lunas' : 'na') + '">' + (on ? 'Aktif' : 'Nonaktif') + '</span>') + '</div></div>' +
    tabsHtml('ar', [['peserta', 'Peserta'], ['sudah', 'Sudah dapat'], ['undian', 'Undian']], AR.tab) + '<div id="arBody"></div>';
  const sw = $('#arUndiSw');
  if (sw) sw.addEventListener('change', () => act(null, async () => {
    try { await apiW('arisanUndianSet', { id_arisan: a.id, aktif: sw.checked }); toast(sw.checked ? 'Alat undian diaktifkan.' : 'Alat undian dinonaktifkan.'); }
    catch (e) { sw.checked = !sw.checked; throw e; }
    await loadArDetail();
  }));
  drawArBody();
}
TABS.ar = v => { AR.tab = v; drawArBody(); };
TABS.arf = v => { AR.filter = v; drawArBody(); };
function drawArBody() {
  const b = $('#arBody'); if (!b || !AR.d) return;
  ({ peserta: arPeserta, sudah: arSudah, undian: arUndian }[AR.tab])(b);
}
function arPeserta(b) {
  const d = AR.d, f = AR.filter, staff = isStaff();
  const l = d.peserta.filter(p => f === 'semua' ? true : f === 'belum' ? (p.status === 'aktif' && !p.sudah) : p.sudah);
  b.innerHTML = tabsHtml('arf', [['semua', 'Semua'], ['belum', 'Belum dapat'], ['dapat', 'Sudah dapat']], f) +
    (staff ? '<button class="btn btn-soft w-100 mb-3" data-act="arPesertaForm"><i class="bi bi-person-plus"></i> Tambah peserta</button>' : '') +
    '<div class="c">' + (l.length ? l.map(p => '<div class="list-i"' + (staff ? ' data-act="arPeserta" data-id="' + p.id + '" style="cursor:pointer"' : '') + '><span class="avatar">' + esc(ini(p.nama)) + '</span><div class="grow"><div class="t">' + esc(p.nama) + (p.saya ? ' <span class="sb info">Anda</span>' : '') + '</div><div class="s">' + (staff ? (p.warga ? 'Warga: ' + esc(p.warga) : 'Bukan warga terdaftar') : (p.total_menang ? 'Pernah dapat ' + p.total_menang + '×' : '')) + '</div></div>' +
      (p.status !== 'aktif' ? '<span class="sb na">Keluar</span>' : p.sudah ? '<span class="sb lunas">Putaran ' + p.putaran + '</span>' : '<span class="sb kurang">Belum</span>') + '</div>').join('') : emptyH('people', d.peserta.length ? 'Tidak ada peserta pada filter ini.' : 'Belum ada peserta terdaftar.')) + '</div>';
}
function arSudah(b) {
  const d = AR.d, a = d.arisan, cur = d.riwayat.filter(x => x.siklus === a.siklus).sort((x, y) => x.putaran - y.putaran), old = d.riwayat.filter(x => x.siklus !== a.siklus);
  const belum = d.peserta.filter(p => p.status === 'aktif' && !p.sudah);
  const row = x => '<div class="list-i"><div class="dot" style="font-weight:800;font-size:15px">' + x.putaran + '</div><div class="grow"><div class="t">' + esc(x.nama) + '</div><div class="s">' + fmtD(x.tanggal) + ' · ' + (x.metode === 'undian' ? '🎲 Undian' : '✍ Manual') + (x.catatan ? ' · ' + esc(x.catatan) : '') + '</div></div></div>';
  const sik = Array.from(new Set(old.map(x => x.siklus)));
  b.innerHTML = '<div class="c"><h6 class="c-t">Siklus ' + a.siklus + ' — sudah dapat <span class="sb lunas">' + cur.length + '</span></h6>' + (cur.length ? cur.map(row).join('') : emptyH('gift', 'Belum ada yang dapat pada siklus ini.')) + '</div>' +
    '<div class="c"><h6 class="c-t">Belum dapat <span class="sb kurang">' + belum.length + '</span></h6>' + (belum.length ? '<div>' + belum.map(p => '<span class="chip-n">' + esc(p.nama) + '</span>').join('') + '</div>' : '<div class="muted">Semua peserta sudah dapat.</div>') + '</div>' +
    (old.length ? '<div class="c"><h6 class="c-t">Siklus sebelumnya</h6>' + sik.map(s => '<div class="mb-2"><div class="muted mb-1" style="font-size:12.5px;font-weight:700">Siklus ' + s + '</div>' + old.filter(x => x.siklus === s).sort((x, y) => x.putaran - y.putaran).map(row).join('') + '</div>').join('') + '</div>' : '');
}
function arUndian(b) {
  const d = AR.d, a = d.arisan, staff = isStaff(), el = d.peserta.filter(p => p.status === 'aktif' && !p.sudah);
  const bisa = a.status === 'aktif' && a.undian === 'aktif' && el.length > 0, adaSiklus = d.riwayat.some(x => x.siklus === a.siklus);
  const pesan = a.status !== 'aktif' ? 'Arisan ini sudah selesai.' : a.undian !== 'aktif' ? (staff ? 'Aktifkan saklar “Alat undian” di atas untuk mengundi.' : 'Pemenang dicatat manual oleh pengurus.') : !el.length ? 'Semua peserta sudah dapat — mulai siklus baru.' : (staff ? 'Tekan tombol untuk mengundi pemenang berikutnya.' : 'Undian dilakukan oleh pengurus.');
  const rv = AR.reveal && d.terakhir && d.terakhir.putaran === AR.reveal.putaran ? AR.reveal : null;
  b.innerHTML = '<div class="draw-box"><div class="sub">' + (a.undian === 'aktif' ? 'Putaran ' + d.putaranBerikut + ' · ' + el.length + ' kandidat' : 'Alat undian nonaktif') + '</div><div class="dn' + (rv ? ' win' : '') + '" id="drawName">' + (rv ? esc(rv.nama) : a.undian !== 'aktif' ? '🔒' : el.length ? '🎲' : '✅') + '</div><div class="sub" id="drawSub">' + (rv ? '🎉 Selamat! Pemenang putaran ' + rv.putaran : pesan) + '</div></div>' +
    (staff && bisa ? '<button class="btn btn-brand w-100 mt-3" style="min-height:56px;font-size:17px" id="btnDraw" data-act="arDraw"><i class="bi bi-dice-5"></i> Undi sekarang</button>' : '') +
    (staff && a.status === 'aktif' && !el.length && adaSiklus ? '<button class="btn btn-soft w-100 mt-3" data-act="arSiklus"><i class="bi bi-arrow-repeat"></i> Mulai siklus baru</button>' : '') +
    (d.terakhir ? '<div class="c mt-3"><h6 class="c-t">Pemenang terakhir</h6><div class="d-flex align-items-center gap-2"><div class="dot" style="font-weight:800">' + d.terakhir.putaran + '</div><b>' + esc(d.terakhir.nama) + '</b></div>' + (staff ? '<button class="btn btn-sm btn-danger-soft mt-3" data-act="arBatal" data-id="' + d.terakhir.id + '"><i class="bi bi-arrow-counterclockwise"></i> Batalkan pencatatan ini</button>' : '') + '</div>' : '') +
    '<div class="c mt-3"><h6 class="c-t">Kandidat (belum dapat) <span class="sb kurang">' + el.length + '</span></h6>' + (el.length ? el.map(p => '<span class="chip-n">' + esc(p.nama) + '</span>').join('') : '<div class="muted">Tidak ada kandidat.</div>') + '</div>';
}
function arSpin(r) {
  return new Promise(res => {
    const box = $('#drawName'); if (!box) return res();
    const names = r.kandidat.slice().sort(() => Math.random() - 0.5);
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fin = () => { box.textContent = r.winner.nama; box.classList.add('win'); const sub = $('#drawSub'); if (sub) sub.textContent = '🎉 Selamat! Putaran ' + r.putaran; setTimeout(res, 900); };
    if (reduce || names.length < 2) return fin();
    let i = 0, delay = 55, total = 0;
    const tick = () => { total += delay; box.textContent = names[i++ % names.length]; if (total < 2600) { delay *= 1.08; setTimeout(tick, delay); } else fin(); };
    tick();
  });
}
ACT.arDraw = async b => {
  if (AR.spinning) return;
  AR.spinning = true; b.disabled = true;
  try {
    const r = await apiW('arisanUndian', { id_arisan: AR.d.arisan.id, putaran: AR.d.putaranBerikut });
    await arSpin(r);
    AR.reveal = { putaran: r.putaran, nama: r.winner.nama };
    toast('🎉 ' + r.winner.nama + ' — dapat arisan putaran ' + r.putaran + (r.sisa === 0 ? ' (semua sudah dapat)' : ''));
    await loadArDetail();
  } catch (e) { toast(e.message, 'err'); await loadArDetail(); }
  finally { AR.spinning = false; }
};
ACT.arBatal = async b => {
  if (!(await confirmBox('Batalkan pencatatan pemenang terakhir? Peserta tersebut dapat diundi lagi.', 'Batalkan', true))) return;
  act(null, async () => { await apiW('arisanBatalPutaran', { id_arisan: AR.d.arisan.id, id: b.dataset.id }); toast('Pencatatan dibatalkan.'); await loadArDetail(); });
};
ACT.arSiklus = async () => {
  if (!(await confirmBox('Mulai siklus baru? Semua peserta aktif kembali menjadi kandidat. Riwayat siklus lama tetap tersimpan.', 'Mulai siklus baru'))) return;
  act(null, async () => { const r = await apiW('arisanSiklusBaru', { id_arisan: AR.d.arisan.id }); toast('Siklus ' + r.siklus + ' dimulai.'); await loadArDetail(); });
};
ACT.arForm = b => {
  const a = b.dataset.id ? (AR.d && AR.d.arisan.id === b.dataset.id ? AR.d.arisan : AR.list.find(x => x.id === b.dataset.id)) : null;
  Mdl.open({
    title: a ? 'Ubah arisan' : 'Arisan baru',
    body: '<div class="mb-3"><label class="form-label">Nama arisan</label><input class="form-control" id="arN" maxlength="60" value="' + esc(a ? a.nama : '') + '" placeholder="mis. Arisan Ibu-ibu RT"></div>' +
      '<div class="grid g2 mb-3"><div><label class="form-label">Iuran per putaran</label><input class="form-control" id="arI" inputmode="numeric" data-money value="' + fmtNum(a ? a.iuran : '') + '" placeholder="0"></div><div><label class="form-label">Periode</label><select class="form-select" id="arP">' + Object.keys(PER_AR).map(k => '<option value="' + k + '"' + (a && a.periode === k ? ' selected' : (!a && k === 'bulanan' ? ' selected' : '')) + '>' + PER_AR[k] + '</option>').join('') + '</select></div></div>' +
      '<div class="grid g2 mb-3"><div><label class="form-label">Tanggal mulai</label><input type="date" class="form-control" id="arT" value="' + esc(a ? a.tgl_mulai : todayJ()) + '"></div><div><label class="form-label">Alat undian</label><select class="form-select" id="arU"><option value="aktif"' + (!a || a.undian === 'aktif' ? ' selected' : '') + '>Aktif</option><option value="nonaktif"' + (a && a.undian === 'nonaktif' ? ' selected' : '') + '>Nonaktif</option></select></div></div>' +
      (a ? '<div class="mb-3"><label class="form-label">Status</label><select class="form-select" id="arS"><option value="aktif"' + (a.status === 'aktif' ? ' selected' : '') + '>Aktif</option><option value="selesai"' + (a.status === 'selesai' ? ' selected' : '') + '>Selesai</option></select></div>' : '') +
      '<div class="mb-1"><label class="form-label">Catatan (opsional)</label><textarea class="form-control" id="arC" rows="2" maxlength="200">' + esc(a ? a.catatan : '') + '</textarea></div>',
    foot: (a ? '<button class="btn btn-danger-soft" data-act="arDel" data-id="' + a.id + '"><i class="bi bi-trash"></i></button>' : '') + '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="arOk">Simpan</button>',
    onShow() {
      $('#arOk').onclick = ev => act(ev.currentTarget, async () => {
        const r = await apiW('arisanSimpan', { id: a ? a.id : '', nama: $('#arN').value, iuran: numOf($('#arI')), periode: $('#arP').value, tgl_mulai: $('#arT').value, undian: $('#arU').value, status: a ? $('#arS').value : 'aktif', catatan: $('#arC').value });
        Mdl.close(); toast('Arisan disimpan.');
        if (!a) { AR.id = r.id; AR.d = null; AR.tab = 'peserta'; AR.filter = 'semua'; loadArDetail(); } else if (AR.id) loadArDetail(); else loadArList();
      });
    }
  });
};
ACT.arDel = async b => {
  if (!(await confirmBox('Hapus arisan ini beserta daftar pesertanya?', 'Hapus', true))) return;
  act(null, async () => { await apiW('arisanHapus', { id: b.dataset.id }); Mdl.close(); toast('Arisan dihapus.'); loadArList(); });
};
ACT.arPeserta = b => {
  const p = AR.d.peserta.find(x => x.id === b.dataset.id); if (!p) return;
  const bisa = p.status === 'aktif' && !p.sudah && AR.d.arisan.status === 'aktif';
  Mdl.open({
    title: 'Peserta arisan',
    body: '<div class="d-flex align-items-center gap-3 mb-3"><span class="avatar" style="width:52px;height:52px;font-size:18px">' + esc(ini(p.nama)) + '</span><div><b style="font-size:17px">' + esc(p.nama) + '</b><div class="muted" style="font-size:12.5px">' + (p.warga ? 'Warga: ' + esc(p.warga) : 'Bukan warga terdaftar') + (p.no_hp ? ' · ' + esc(p.no_hp) : '') + '</div></div></div>' +
      '<div>' + (p.status !== 'aktif' ? '<span class="sb na">Keluar</span>' : p.sudah ? '<span class="sb lunas">Sudah dapat — putaran ' + p.putaran + '</span>' : '<span class="sb kurang">Belum dapat</span>') + (p.total_menang ? ' <span class="sb info">Total dapat ' + p.total_menang + '×</span>' : '') + '</div>',
    foot: '<button class="btn btn-danger-soft" data-act="arPesertaDel" data-id="' + p.id + '"><i class="bi bi-trash"></i></button><button class="btn btn-ghost" data-act="arPesertaForm" data-id="' + p.id + '"><i class="bi bi-pencil"></i> Ubah</button>' + (bisa ? '<button class="btn btn-brand" data-act="arPemenang" data-id="' + p.id + '"><i class="bi bi-trophy"></i> Catat pemenang</button>' : '')
  });
};
ACT.arPesertaForm = b => {
  const p = b.dataset.id ? AR.d.peserta.find(x => x.id === b.dataset.id) : null;
  Mdl.open({
    title: p ? 'Ubah peserta' : 'Tambah peserta',
    body: '<div class="mb-3"><label class="form-label">Nama peserta (tampil di arisan)</label><input class="form-control" id="psN" maxlength="60" value="' + esc(p ? p.nama : '') + '" placeholder="mis. Bu Siti"><div class="muted mt-1" style="font-size:12px">Boleh berbeda dari nama kepala keluarga di daftar warga/jimpitan (mis. nama istri, panggilan, atau orang di luar RT).</div></div>' +
      '<div class="mb-3"><label class="form-label">Terhubung ke warga (opsional)</label><select class="form-select" id="psW"><option value="">— tidak terhubung / bukan warga —</option>' + wargaOpts(p ? p.id_warga : '') + '</select><div class="muted mt-1" style="font-size:12px">Hanya penanda rumah; tidak mengubah nama peserta. Warga yang terhubung dapat melihat tanda “Anda peserta”.</div></div>' +
      '<div class="grid g2"><div><label class="form-label">No. HP</label><input class="form-control" id="psH" inputmode="tel" value="' + esc(p ? p.no_hp : '') + '"></div><div><label class="form-label">Status</label><select class="form-select" id="psS"><option value="aktif"' + (!p || p.status === 'aktif' ? ' selected' : '') + '>Aktif</option><option value="keluar"' + (p && p.status !== 'aktif' ? ' selected' : '') + '>Keluar</option></select></div></div>',
    foot: '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="psOk">Simpan</button>',
    onShow() {
      $('#psW').addEventListener('change', () => { const w = (S.wargaList || []).find(x => x.id === $('#psW').value); if (w && !$('#psN').value.trim()) $('#psN').value = w.nama_kk; });
      $('#psOk').onclick = ev => act(ev.currentTarget, async () => {
        await apiW('arisanPesertaSimpan', { id: p ? p.id : '', id_arisan: AR.d.arisan.id, nama: $('#psN').value, id_warga: $('#psW').value, no_hp: $('#psH').value, status: $('#psS').value });
        Mdl.close(); toast('Peserta disimpan.'); await loadArDetail();
      });
    }
  });
};
ACT.arPesertaDel = async b => {
  if (!(await confirmBox('Hapus peserta ini dari arisan?', 'Hapus', true))) return;
  act(null, async () => { await apiW('arisanPesertaHapus', { id: b.dataset.id }); Mdl.close(); toast('Peserta dihapus.'); await loadArDetail(); });
};
ACT.arPemenang = b => {
  const p = AR.d.peserta.find(x => x.id === b.dataset.id); if (!p) return;
  Mdl.open({
    title: 'Catat pemenang manual',
    body: '<p class="mb-3">Pemenang putaran <b>' + AR.d.putaranBerikut + '</b>: <b>' + esc(p.nama) + '</b></p><div class="mb-3"><label class="form-label">Tanggal</label><input type="date" class="form-control" id="pmT" max="' + todayJ() + '" value="' + todayJ() + '"></div><div><label class="form-label">Catatan (opsional)</label><input class="form-control" id="pmC" maxlength="200" placeholder="mis. sesuai urutan kesepakatan"></div>',
    foot: '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button><button class="btn btn-brand" id="pmOk">Simpan pemenang</button>',
    onShow() { $('#pmOk').onclick = ev => act(ev.currentTarget, async () => { await apiW('arisanPemenang', { id_arisan: AR.d.arisan.id, id_peserta: p.id, tanggal: $('#pmT').value, catatan: $('#pmC').value, putaran: AR.d.putaranBerikut }); Mdl.close(); toast('Pemenang dicatat.'); await loadArDetail(); }); }
  });
};

/* Mulai */
(function () {
  applyTheme(Store.g('theme', window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const lu = Store.g('lastUser', ''); if (lu) $('#lgUser').value = lu;
  if (!navigator.onLine) $('#offline').classList.add('on');
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token) { Pending.flush(); if (S.page && Date.now() - (S.loaded[S.page] || 0) > 60000) { S.loaded[S.page] = Date.now(); const pg = PAGES[S.page]; pg && pg.load && pg.load(true); } } });
})();

restoreSession();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });

/* Kamera mati saat tab disembunyikan, menyala lagi saat kembali (bila di halaman Jimpitan) */
document.addEventListener('visibilitychange', () => {
  if (!S.token) return;
  if (document.visibilityState === 'hidden') { if (JP.scanning) stopScan(); }
  else if (S.page === 'jimpitan') autoScan();
});
