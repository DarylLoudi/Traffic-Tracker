import { t, getLang, applyStatic } from './i18n.js';
import { h, glyph, levelTag, fmtIdx, ago, debounce, boxesSvg, frameUrl, totalVehicles, CITY_LABEL, statusLabel, showTip, hideTip, tweenNumber, levelOfIdx, fadeImg, flipRender, setCityLabels, reducedMotion } from './util.js';
import { createMap } from './map.js';
import { openCamera, closeDrawer, cameraUpdated, openId, rerender as rerenderDrawer } from './drawer.js';
import { lineChart } from './charts.js';
import { renderAbout } from './about.js';
import { initChrome } from './chrome.js';
import { initSearch } from './search.js';

const $ = (id) => document.getElementById(id);
// Cities come from the server, in its order.
const cityOrder = () => app.cities.map((c) => c.city);
const nf = () => new Intl.NumberFormat(getLang() === 'id' ? 'id-ID' : 'en-US');

const app = {
  cams: new Map(),
  cities: [],
  scan: null,
  history: null,
  filter: { city: null, level: 'all', q: '', sort: 'idx' },
  sseOk: false,
};

// url state: #city=bandung&cam=bdg-76
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const city = p.get('city');
  return { city: city && /^[a-z-]{2,30}$/.test(city) ? city : null, cam: p.get('cam') };
}
function writeHash({ city = app.filter.city, cam = openId() } = {}, push = false) {
  const p = new URLSearchParams();
  if (city) p.set('city', city);
  if (cam) p.set('cam', cam);
  const next = p.toString() ? `#${p}` : location.pathname;
  if (push) history.pushState(null, '', next);
  else history.replaceState(null, '', next);
}

// derived data
const camList = () => [...app.cams.values()];
const inCity = (c) => !app.filter.city || c.city === app.filter.city;
const levelKey = (c) => (c.status === 'ok' ? String(c.level) : 'none');
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** Summary of one city, or of everything when cityId is null. */
function summary(cityId) {
  const meta = cityId ? app.cities.find((c) => c.city === cityId) || { city: cityId } : {};
  const list = camList().filter((c) => !cityId || c.city === cityId);
  const live = list.filter((c) => c.status === 'ok');
  const levels = [0, 0, 0, 0];
  live.forEach((c) => levels[c.level]++);
  const sorted = live.map((c) => c.idx).sort((a, b) => b - a);
  // Mean of readable cameras, weighted towards the worst quarter.
  const idx = sorted.length ? 0.6 * avg(sorted) + 0.4 * avg(sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)))) : null;
  return { ...meta, city: cityId, label: cityId ? CITY_LABEL[cityId] : t('allCities'), cameras: list.length, live: live.length, levels, idx, none: list.length - live.length, vehicles: live.reduce((a, c) => a + totalVehicles(c), 0) };
}

// header: scan status
let countdownTimer;
function renderScan() {
  const el = $('scan');
  const text = $('scan-text');
  const s = app.scan;
  el.classList.toggle('is-live', app.sseOk && !!s && !s.running);
  el.classList.toggle('is-scanning', !!(app.sseOk && s?.running));
  clearInterval(countdownTimer);
  if (!app.sseOk) {
    text.textContent = s ? t('offline') : t('connecting');
    return;
  }
  if (s?.running) {
    text.textContent = t('scanning', s.progress.done, s.progress.total);
    $('scan-fill').style.width = `${(100 * s.progress.done) / Math.max(1, s.progress.total)}%`;
  } else {
    const tick = () => {
      const left = Math.max(0, Math.round(((s?.nextAt || Date.now()) - Date.now()) / 1000));
      text.textContent = left > 0 ? t('nextScan', `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`) : t('live');
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
}

// city cards: the city filter and the summary in one
const cardEls = new Map();
function buildCards() {
  cardEls.clear();
  $('cards').replaceChildren(
    ...[null, ...cityOrder()].map((id, i) => {
      const el = {
        name: h('span', { class: 'ccard-name' }),
        lvl: h('span', { class: 'lvl' }),
        idx: h('span', { class: 'ccard-idx' }, '–'),
        spark: h('span', { class: 'spark' }),
        seg: h('span', { class: 'segbar' }),
        cap: h('span', { class: 'ccard-cap' }),
      };
      el.btn = h(
        'button',
        { class: 'ccard glass', type: 'button', style: { '--i': i }, onclick: () => setCity(id === app.filter.city ? null : id) },
        h('span', { class: 'ccard-top' }, el.name, el.lvl),
        h('span', { class: 'ccard-mid' }, el.idx, el.spark),
        el.seg,
        el.cap,
      );
      cardEls.set(id ?? 'all', el);
      return el.btn;
    }),
  );
}

function renderCards() {
  $('cards').classList.toggle('has-pick', !!app.filter.city);
  for (const [key, el] of cardEls) {
    const id = key === 'all' ? null : key;
    const s = summary(id);
    const lvl = levelOfIdx(s.idx);
    el.btn.setAttribute('aria-pressed', String(app.filter.city === id));
    el.name.textContent = s.label;
    el.lvl.dataset.l = lvl ?? 'n';
    el.lvl.replaceChildren(glyph(lvl), lvl == null ? t('noReading') : t('levels')[lvl]);
    tweenNumber(el.idx, s.idx);
    el.cap.textContent = t('liveN', s.live, s.cameras);
    el.btn.setAttribute('aria-label', `${s.label}. ${t('index')} ${fmtIdx(s.idx)}${lvl == null ? '' : `, ${t('levels')[lvl]}`}. ${t('liveN', s.live, s.cameras)}`);
    // Segments are kept and resized so the bar animates instead of jumping.
    const total = s.cameras || 1;
    const parts = [...[3, 2, 1, 0].map((i) => [i, s.levels[i]]), ['none', s.none]];
    if (el.seg.childElementCount !== parts.length) {
      el.seg.replaceChildren(...parts.map(([i]) => (i === 'none' ? h('span', { class: 'seg-none' }) : h('span', { 'data-l': i }))));
      [...el.seg.children].forEach((sp, k) => {
        sp.addEventListener('pointermove', (e) => sp._tip && showTip(e.clientX, e.clientY, ...sp._tip()));
        sp.addEventListener('pointerleave', hideTip);
        sp._k = k;
      });
    }
    [...el.seg.children].forEach((sp, k) => {
      const [i, n] = parts[k];
      sp.style.flexGrow = n / total;
      sp.style.display = n ? '' : 'none';
      sp._tip = () => [h('b', {}, `${n} ${t('camerasLower')}`), ' ', i === 'none' ? t('noReading') : t('levels')[i]];
    });
  }
}

function cityPoints(cityId) {
  if (!app.history) return [];
  const now = Date.now();
  const half = app.history.bucket / 2;
  const rows = app.history.rows.filter((r) => r.idx != null && (!cityId || r.city === cityId));
  if (cityId) return rows.map((r) => ({ t: Math.min(now, r.t + half), v: r.idx, sub: t('jammedN', r.jammed) }));
  const by = new Map();
  for (const r of rows) {
    const b = by.get(r.t) || { n: 0, sum: 0, jammed: 0 };
    b.n += r.n;
    b.sum += r.idx * r.n;
    b.jammed += r.jammed;
    by.set(r.t, b);
  }
  return [...by].sort((a, b) => a[0] - b[0]).map(([tt, b]) => ({ t: Math.min(now, tt + half), v: b.sum / b.n, sub: t('jammedN', b.jammed) }));
}

function renderSparks() {
  const now = Date.now();
  const first = app.history?.rows[0]?.t;
  // Until a full day exists the x axis covers only the history there is.
  const from = first ? Math.max(now - 24 * 3600_000, first) : now - 24 * 3600_000;
  for (const [key, el] of cardEls) {
    const pts = cityPoints(key === 'all' ? null : key);
    if (pts.length > 1) lineChart(el.spark, pts, { height: 40, from, to: now, compact: true, label: t('last24') });
    else el.spark.replaceChildren();
  }
}

function setCity(city, { fly = true } = {}) {
  app.filter.city = city;
  writeHash({ city });
  renderAll();
  cardEls.get(city ?? 'all')?.btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (fly) mapApi?.focusCity(city, camList());
}

// worst list
const worstEls = new Map();
function worstItem(id) {
  let el = worstEls.get(id);
  if (el) return el;
  el = {
    rank: h('span', { class: 'worst-rank' }),
    img: fadeImg({ alt: '', width: 92, height: 52, decoding: 'async' }),
    name: h('span', { class: 'worst-name' }),
    meta: h('span', { class: 'worst-meta' }),
    idx: h('span', { class: 'worst-idx' }),
    lvl: h('span', { class: 'lvl' }),
    v: null,
  };
  el.thumb = h('span', { class: 'worst-thumb' }, el.img);
  el.li = h(
    'li',
    { class: 'worst-item', dataset: { key: id } },
    h('button', { class: 'worst-btn', type: 'button', onclick: () => select(id, { fly: true }) }, el.rank, el.thumb, h('span', {}, el.name, el.meta), h('span', { class: 'worst-read' }, el.idx, el.lvl)),
  );
  worstEls.set(id, el);
  return el;
}

function renderWorstSub() {
  const read = camList().filter((c) => inCity(c) && c.status === 'ok');
  const latest = Math.max(0, ...read.map((c) => c.ts || 0));
  const veh = read.reduce((a, c) => a + totalVehicles(c), 0);
  $('worst-sub').textContent = read.length ? t('worstSub', nf().format(veh), read.length, ago(latest)) : '';
}

function renderWorst() {
  renderWorstSub();
  const top = camList()
    .filter((c) => inCity(c) && c.status === 'ok')
    .sort((a, b) => b.idx - a.idx)
    .slice(0, 14);
  const ol = $('worst');
  if (!top.length) {
    ol.replaceChildren(h('li', { class: 'worst-empty' }, t('worstEmpty')));
    return;
  }
  const keep = new Set(top.map((c) => c.id));
  for (const id of worstEls.keys()) if (!keep.has(id)) worstEls.delete(id);
  flipRender(ol, () =>
    ol.replaceChildren(
      ...top.map((c, i) => {
        const el = worstItem(c.id);
        el.rank.textContent = i + 1;
        if (el.v !== c.frameV) {
          el.v = c.frameV;
          if (c.frameV) el.img.src = frameUrl(c);
          el.thumb.querySelector('svg')?.remove();
          el.thumb.append(boxesSvg(c.boxes, c.level, { thin: true }));
        }
        el.name.textContent = c.name;
        el.meta.textContent = `${c.view}, ${CITY_LABEL[c.city]}`;
        tweenNumber(el.idx, c.idx, { duration: 700 });
        el.lvl.dataset.l = c.level;
        el.lvl.replaceChildren(glyph(c.level), t('levels')[c.level]);
        return el.li;
      }),
    ),
  );
}

// wall
const tileEls = new Map();
let firstWall = true;

function renderChips() {
  const list = camList().filter(inCity);
  const count = (k) => (k === 'all' ? list.length : list.filter((c) => levelKey(c) === k).length);
  const chip = (k, label, lvl) =>
    h(
      'button',
      { class: 'chip', type: 'button', 'data-l': lvl ?? 'n', 'aria-pressed': String(app.filter.level === k), onclick: () => ((app.filter.level = k), renderChips(), renderWall()) },
      lvl !== undefined ? glyph(lvl) : null,
      label,
      h('small', {}, count(k)),
    );
  $('chips').replaceChildren(chip('all', t('all')), chip('3', t('levels')[3], 3), chip('2', t('levels')[2], 2), chip('1', t('levels')[1], 1), chip('0', t('levels')[0], 0), chip('none', t('noReading'), null));
}

function tile(c, prevSrc) {
  const ok = c.status === 'ok';
  const frame = h('div', { class: prevSrc ? 'frame is-fresh' : 'frame' });
  if (c.frameV) {
    // The old picture stays behind the new one while it fades in.
    if (prevSrc) frame.style.backgroundImage = `url("${prevSrc}")`;
    frame.append(fadeImg({ src: frameUrl(c), alt: '', loading: 'lazy', decoding: 'async', width: 400, height: 225 }));
    if (ok || c.status === 'blind') frame.append(boxesSvg(c.boxes, ok ? c.level : null, { thin: true, stagger: !!prevSrc }));
  }
  if (!ok) frame.append(h('div', { class: 'frame-flag' }, t('status')[c.status] || t('noReading'), c.lastOk && c.status !== 'pending' ? h('small', {}, ago(c.lastOk)) : null));
  else if (c.dark) frame.append(h('span', { class: 'frame-badge' }, t('lowLight')));
  const label = `${c.name}, ${c.view}. ${statusLabel(c)}${ok ? ` ${fmtIdx(c.idx)}` : ''}`;
  return h(
    'button',
    { class: 'tile-btn', type: 'button', 'aria-label': label, onclick: () => select(c.id) },
    frame,
    h(
      'div',
      { class: 'tile-cap' },
      h('div', {}, h('div', { class: 'tile-name' }, c.name), h('div', { class: 'tile-meta' }, `${c.view}, ${CITY_LABEL[c.city]}`)),
      h('div', { class: 'tile-read' }, ok ? h('span', { class: 'tile-idx' }, fmtIdx(c.idx)) : null, levelTag(c)),
    ),
  );
}

function wallList() {
  const q = app.filter.q.trim().toLowerCase();
  let list = camList().filter(inCity);
  if (app.filter.level !== 'all') list = list.filter((c) => levelKey(c) === app.filter.level);
  if (q) list = list.filter((c) => `${c.name} ${c.view} ${c.area} ${CITY_LABEL[c.city]}`.toLowerCase().includes(q));
  const byName = (a, b) => a.name.localeCompare(b.name) || a.view.localeCompare(b.view);
  const rank = (c) => (c.status === 'ok' ? c.idx : -1);
  if (app.filter.sort === 'name') list.sort(byName);
  else if (app.filter.sort === 'veh') list.sort((a, b) => totalVehicles(b) - totalVehicles(a) || byName(a, b));
  else list.sort((a, b) => rank(b) - rank(a) || byName(a, b));
  return list;
}

function renderWall() {
  const list = wallList();
  const ul = $('tiles');
  const total = camList().filter(inCity).length;
  $('wall-h').textContent = app.filter.city ? t('camerasIn', CITY_LABEL[app.filter.city]) : t('wallTitle');
  $('wall-count').textContent = t('wallCount', list.length, total);
  if (!list.length) {
    ul.replaceChildren(h('li', { class: 'tiles-empty' }, t('wallEmpty')));
    return;
  }
  ul.replaceChildren(
    ...list.map((c) => {
      let li = tileEls.get(c.id);
      if (!li || li._v !== c._v) {
        const old = li?.querySelector('.frame img');
        const prevSrc = !firstWall && old && li._frameV !== c.frameV ? old.currentSrc || old.src : null;
        li = h('li', {}, tile(c, prevSrc));
        li._v = c._v;
        li._frameV = c.frameV;
        tileEls.set(c.id, li);
      }
      return li;
    }),
  );
  firstWall = false;
}

// everything
let mapApi = null;
function renderAll() {
  renderCards();
  renderWorst();
  renderChips();
  renderWall();
  mapApi?.update(camList(), cityOrder().map(summary));
}
const renderSoon = debounce(renderAll, 600);

const wide = () => innerWidth > 980;
function select(id, { fly = false } = {}) {
  const cam = app.cams.get(id);
  if (!cam) return;
  mapApi?.select(id);
  // On wide screens the drawer covers the right side, so the camera is centred in what is left.
  if (fly) mapApi?.flyTo(cam, wide() ? -300 : 0);
  writeHash({ cam: id }, !openId());
  openCamera(id, {
    onClose: () => {
      mapApi?.select(null);
      writeHash({ cam: null });
    },
  });
}

let vseq = 0;
function putCam(c) {
  c._v = ++vseq;
  app.cams.set(c.id, c);
}

async function loadState() {
  const d = await (await fetch('/api/state')).json();
  app.cities = d.cities;
  setCityLabels(d.cities);
  app.scan = d.scan;
  d.cameras.forEach(putCam);
}
async function loadHistory() {
  try {
    app.history = await (await fetch('/api/history?hours=24')).json();
  } catch {
    /* keep the old one */
  }
}

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => {
    app.sseOk = true;
    app.scan = { ...app.scan, ...JSON.parse(e.data) };
    renderScan();
  });
  es.addEventListener('camera', (e) => {
    const { cam, scan } = JSON.parse(e.data);
    putCam(cam);
    app.scan = { ...app.scan, running: true, progress: { done: scan.done, total: scan.total } };
    renderScan();
    mapApi?.ping(cam);
    cameraUpdated(cam.id);
    renderSoon();
  });
  es.addEventListener('cycle-start', (e) => {
    const d = JSON.parse(e.data);
    app.scan = { ...app.scan, running: true, progress: { done: 0, total: d.total } };
    renderScan();
  });
  es.addEventListener('cycle', async (e) => {
    const d = JSON.parse(e.data);
    app.scan = { ...app.scan, running: false, last: d, nextAt: d.nextAt };
    renderScan();
    await loadHistory();
    renderSparks();
  });
  es.onerror = () => {
    app.sseOk = false;
    renderScan();
  };
  es.onopen = () => {
    app.sseOk = true;
    renderScan();
  };
}

// chrome
function renderLegend() {
  $('legend').replaceChildren(
    ...t('levels').map((name, i) => h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: { background: `var(--l${i})` } }), name)),
    h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: { background: 'var(--ln)' } }), t('noReading')),
  );
}
function renderWords() {
  applyStatic();
  document.title = t('liveTitle');
  renderLegend();
}

initChrome({
  onLang: () => {
    search.words();
    renderWords();
    tileEls.clear();
    worstEls.clear();
    firstWall = true;
    renderAll();
    renderSparks();
    rerenderDrawer();
    renderScan();
  },
});
$('about-btn').addEventListener('click', () => {
  renderAbout($('about'), app.cities);
  $('about').showModal();
});
$('about').addEventListener('click', (e) => {
  if (e.target === $('about')) $('about').close();
});
$('q').addEventListener('input', debounce((e) => ((app.filter.q = e.target.value), renderWall()), 150));
$('sort').addEventListener('change', (e) => ((app.filter.sort = e.target.value), renderWall()));
addEventListener('popstate', () => {
  const { city, cam } = readHash();
  if (city !== app.filter.city) setCity(city);
  if (cam && cam !== openId()) select(cam);
  else if (!cam && openId()) closeDrawer();
});
addEventListener('resize', debounce(renderSparks, 200));

// city strip: arrows and the fade show when there is more to scroll
function watchCardScroll() {
  const strip = $('cards');
  const prev = $('cards-prev');
  const next = $('cards-next');
  const step = () => Math.max(240, strip.clientWidth - 260);
  const update = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    prev.hidden = strip.scrollLeft < 8;
    next.hidden = strip.scrollLeft > max - 8;
    strip.classList.toggle('more-right', strip.scrollLeft < max - 8);
  };
  prev.addEventListener('click', () => strip.scrollBy({ left: -step(), behavior: reducedMotion() ? 'auto' : 'smooth' }));
  next.addEventListener('click', () => strip.scrollBy({ left: step(), behavior: reducedMotion() ? 'auto' : 'smooth' }));
  // A mouse wheel over the strip scrolls it sideways.
  strip.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || strip.scrollWidth <= strip.clientWidth) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
  strip.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(strip);
  update();
}

const search = initSearch({
  data: () => ({ cities: app.cities.map(({ city, label, cameras }) => ({ city, label, cameras })), cams: camList() }),
  onCam: (id) => select(id, { fly: true }),
  onCity: (city) => setCity(city),
});

// boot
renderWords();
const initial = readHash();
try {
  await Promise.all([loadState(), loadHistory()]);
} catch {
  $('worst').replaceChildren(h('li', { class: 'worst-empty' }, t('loadError')));
}
app.filter.city = cityOrder().includes(initial.city) ? initial.city : null;
buildCards();
watchCardScroll();
renderScan();
// Padding that keeps the floating panels clear of what the map is asked to show.
const pad = () => (wide() ? { top: 160, right: $('worst').offsetWidth + 70, bottom: 225, left: 60 } : { top: 160, right: 90, bottom: 90, left: 90 });
mapApi = createMap($('map'), { onSelect: (id) => select(id), onCity: (city) => setCity(city), pad, cameras: camList() });
mapApi.map.on('load', () => {
  mapApi.update(camList(), cityOrder().map(summary));
  if (app.filter.city) mapApi.focusCity(app.filter.city, camList());
});
renderAll();
renderSparks();
if (app.filter.city) cardEls.get(app.filter.city)?.btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
connect();
if (initial.cam && app.cams.has(initial.cam)) select(initial.cam);
// Keep "x s ago" honest between events.
setInterval(renderWorstSub, 15_000);
