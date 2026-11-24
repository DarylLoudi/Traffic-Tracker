import { getLang, t, applyStatic } from './i18n.js';
import { copy } from './landing-copy.js';
import { h, s, glyph, fmtIdx, boxesSvg, frameUrl, CITY_LABEL, tweenNumber, levelOfIdx, arrowIcon, fadeImg, clock, setCityLabels } from './util.js';
import { initSearch } from './search.js';
import { initChrome } from './chrome.js';
import { createFlow } from './flow.js';

const $ = (id) => document.getElementById(id);
const c = () => copy[getLang()];
// Cities in the server's order, and the four the hero roads stand for.
const cityOrder = () => (summary ? summary.cities.map((x) => x.city) : []);
let roadCities = [];
const nf = () => new Intl.NumberFormat(getLang() === 'id' ? 'id-ID' : 'en-US');

let summary = null;
let demo = null;
let tagPos = [];

// words that do not depend on live data
function renderWords() {
  const w = c();
  document.title = w.title;
  document.documentElement.lang = getLang();
  document.querySelectorAll('.top-nav a').forEach((a, i) => (a.textContent = w.nav[i]));
  $('open-btn').replaceChildren(h('span', {}, w.open), arrowIcon());
  $('h1').replaceChildren(...w.h1.map((line) => h('span', { class: 'line' }, h('span', {}, line))));
  $('lede').textContent = w.lede;
  $('cta1').replaceChildren(w.cta1, arrowIcon());
  $('cta2').textContent = w.cta2;
  document.querySelectorAll('#stats dt').forEach((dt, i) => (dt.textContent = w.stats[i]));
  $('ticker-label').textContent = w.ticker;
  $('reel-title').textContent = w.reelTitle;
  $('reel-sub').textContent = w.reelSub;
  $('how-title').textContent = w.howTitle;
  $('cities-sub').textContent = w.citiesSub;
  $('hood-title').textContent = w.hoodTitle;
  $('hood-sub').textContent = w.hoodSub;
  renderPipe();
  $('facts').replaceChildren(...w.facts.map(([a, b]) => h('div', {}, h('h3', {}, a), h('p', {}, b))));
  $('closing-h').textContent = w.closing;
  $('closing-cta').replaceChildren(w.cta1, arrowIcon());
  applyStatic(document.querySelector('.foot'));
}

function renderPipe() {
  const w = c();
  const ops = summary ? summary.cities.length : 10;
  const cams = summary ? nf().format(summary.totals.cameras) : '700';
  $('pipe').replaceChildren(...w.pipe.map(([a, b]) => h('li', {}, h('i', { 'aria-hidden': 'true' }), h('b', {}, a), h('span', {}, typeof b === 'function' ? b(ops, cams) : b))));
}

// hero: live numbers, road tags, ticker
function renderHero() {
  const w = c();
  if (!summary) {
    $('hero-live').textContent = w.liveWait;
    return;
  }
  const { totals } = summary;
  $('hero-live').textContent = w.live(totals.cameras);
  const dd = document.querySelectorAll('#stats dd');
  tweenNumber(dd[0], totals.readable, { format: (v) => nf().format(Math.round(v)) });
  tweenNumber(dd[1], totals.vehicles, { format: (v) => nf().format(Math.round(v)), duration: 1400 });
  tweenNumber(dd[2], totals.jammed, { format: (v) => nf().format(Math.round(v)) });
  renderTags();

  const track = $('ticker');
  const items = summary.worst.slice(0, 10);
  if (track.childElementCount !== items.length * 2) {
    const make = () =>
      items.map(() => h('a', { class: 'ticker-item' }, glyph(null), h('b', {}), h('span', { class: 'ticker-name' }), h('em', {})));
    track.replaceChildren(...make(), ...make());
  }
  [...track.children].forEach((a, i) => {
    const cam = items[i % items.length];
    a.href = `/live#cam=${cam.id}`;
    a.dataset.l = cam.level;
    a.children[0].dataset.l = cam.level;
    a.children[1].textContent = fmtIdx(cam.idx);
    a.children[2].textContent = cam.name;
    a.children[3].textContent = CITY_LABEL[cam.city];
    if (i >= items.length) a.setAttribute('aria-hidden', 'true'), (a.tabIndex = -1);
  });
}

function renderTags() {
  const host = $('hero-tags');
  if (!summary || !tagPos.length) return;
  host.replaceChildren(
    ...tagPos
      .filter((p) => p.x > 0.06 && p.x < 0.94 && p.y > 0.12 && p.y < 0.9)
      .map((p) => {
        const id = roadCities[p.city];
        const city = summary.cities.find((x) => x.city === id);
        if (!city) return null;
        const lvl = levelOfIdx(city.idx);
        return h(
          'a',
          { class: 'hero-tag', href: `/live#city=${id}`, 'data-l': lvl ?? 'n', style: { left: `${(p.x * 100).toFixed(2)}%`, top: `${(p.y * 100).toFixed(2)}%` } },
          h('b', {}, city.label),
          h('span', { class: 'tag-read' }, glyph(lvl), lvl == null ? '–' : `${fmtIdx(city.idx)} ${t('levels')[lvl]}`),
        );
      })
      .filter(Boolean),
  );
}

// reel of live frames
function reelCard() {
  const frame = h('div', { class: 'frame' });
  const name = h('b', {});
  const read = h('span', { class: 'lvl' });
  const a = h('a', { class: 'reel-card' }, frame, h('div', { class: 'reel-cap' }, name, read));
  a._fill = (cam) => {
    if (a._v === `${cam.id}:${cam.frameV}:${getLang()}`) return;
    a._v = `${cam.id}:${cam.frameV}:${getLang()}`;
    a.href = `/live#cam=${cam.id}`;
    a.setAttribute('aria-label', `${cam.name}, ${CITY_LABEL[cam.city]}. ${t('levels')[cam.level]} ${fmtIdx(cam.idx)}`);
    const old = frame.querySelector('img');
    if (old) frame.style.backgroundImage = `url("${old.currentSrc || old.src}")`;
    frame.replaceChildren(fadeImg({ src: frameUrl(cam), alt: '', loading: 'lazy', decoding: 'async', width: 400, height: 225 }), boxesSvg(cam.boxes, cam.level, { thin: true }));
    name.textContent = cam.name;
    read.dataset.l = cam.level;
    read.replaceChildren(glyph(cam.level), `${fmtIdx(cam.idx)} ${t('levels')[cam.level]}`);
  };
  return a;
}

function renderReel() {
  const host = $('reel');
  const cams = summary?.wall || [];
  if (cams.length < 8) {
    host.replaceChildren(h('p', { class: 'reel-empty' }, c().reelEmpty));
    return;
  }
  const half = Math.floor(cams.length / 2);
  const rows = [cams.slice(0, half), cams.slice(half, half * 2)];
  if (host.querySelectorAll('.reel-row').length !== 2 || host.querySelector('.reel-row').childElementCount !== half * 2) {
    host.replaceChildren(...rows.map((r) => h('div', { class: 'reel-row' }, r.map(reelCard), r.map(reelCard))));
    // the second copy only exists to make the loop seamless
    host.querySelectorAll('.reel-row').forEach((row) => [...row.children].slice(half).forEach((a) => (a.setAttribute('aria-hidden', 'true'), (a.tabIndex = -1))));
  }
  host.querySelectorAll('.reel-row').forEach((row, r) => [...row.children].forEach((a, i) => a._fill(rows[r][i % half])));
}

// cities
function renderCities() {
  const w = c();
  const host = $('city-grid');
  if (!summary) return;
  $('cities-title').textContent = w.citiesTitle(summary.cities.length);
  if (host.childElementCount !== cityOrder().length) {
    host.replaceChildren(
      ...cityOrder().map((id) => {
        const img = fadeImg({ alt: '', loading: 'lazy', decoding: 'async' });
        return h(
          'a',
          { class: 'city-card night', href: `/live#city=${id}`, 'data-city': id },
          img,
          h('div', { class: 'city-top' }, h('span', { class: 'city-worst' }), h('span', { class: 'city-go' }, arrowIcon())),
          h('div', {}, h('div', { class: 'city-name' }, CITY_LABEL[id]), h('div', { class: 'city-read' }, h('b', {}), h('span', { class: 'lvl' }), h('span', { class: 'city-n' }))),
        );
      }),
    );
  }
  for (const a of host.children) {
    const city = summary.cities.find((x) => x.city === a.dataset.city);
    if (!city) continue;
    const lvl = levelOfIdx(city.idx);
    a.setAttribute('aria-label', w.openCity(city.label));
    const img = a.querySelector('img');
    const src = city.worst?.frameV ? frameUrl(city.worst, false) : null;
    if (src && img.getAttribute('src') !== src) img.src = src;
    a.querySelector('.city-worst').textContent = city.worst?.name ? w.worst(city.worst.name) : '';
    tweenNumber(a.querySelector('.city-read b'), city.idx);
    const tag = a.querySelector('.lvl');
    tag.dataset.l = lvl ?? 'n';
    tag.replaceChildren(glyph(lvl), lvl == null ? t('noReading') : t('levels')[lvl]);
    a.querySelector('.city-n').textContent = w.readable(city.live, city.cameras);
  }
}

// how a road is read: one real reading, stepped through on scroll
function renderHow() {
  const w = c();
  const sec = $('how');
  if (!demo) {
    sec.hidden = true;
    return;
  }
  $('how-sub').textContent = w.howSub(demo.name, CITY_LABEL[demo.city], clock(demo.ts));
  const svg = s('svg', { class: 'boxes', viewBox: '0 0 1000 1000', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  demo.boxes
    .filter((b) => !(b[5] & 2))
    .forEach(([x, y, bw, bh, , f], i) => {
      const r = s('rect', { class: f & 1 ? 'bx bx-stop' : 'bx', x: x * 1000, y: y * 1000, width: bw * 1000, height: bh * 1000, rx: 3, 'vector-effect': 'non-scaling-stroke', 'stroke-width': 1.6 });
      r.style.setProperty('--i', i);
      svg.append(r);
    });
  const size = { width: demo.width, height: demo.height };
  $('how-frame').replaceChildren(
    h('img', { id: 'how-a', src: '/assets/demo/a.jpg', alt: `${demo.name}: ${w.frame1}`, ...size }),
    h('img', { id: 'how-b', src: '/assets/demo/b.jpg', alt: '', ...size }),
    svg,
    h('span', { class: 'how-stamp', id: 'how-stamp' }, w.frame1),
  );
  $('how-frame').style.aspectRatio = `${demo.width} / ${demo.height}`;
  const n = demo.counts.car + demo.counts.moto + demo.counts.bus + demo.counts.truck;
  const stop = Math.round(demo.stall * 100);
  $('how-meter').replaceChildren(
    h('div', { class: 'how-cell', 'data-from': 2, 'data-to': n }, h('dt', {}, w.mFound), h('dd', {}, '0'), h('p', {}, w.mMix(demo.counts))),
    h('div', { class: 'how-cell', 'data-from': 3, 'data-to': stop, 'data-unit': '%', style: { '--w': `${stop}%` } }, h('dt', {}, w.mStopped), h('dd', {}, '0', h('small', {}, '%')), h('div', { class: 'how-bar' }, h('i')), h('p', {}, w.mStoppedSub)),
    h('div', { class: 'how-cell', 'data-from': 4, 'data-to': Math.round(demo.idx), 'data-l': demo.level }, h('dt', {}, w.mIndex), h('dd', {}, '0', h('small', {}, ' /100')), h('p', { class: 'lvl' }, glyph(demo.level), t('levels')[demo.level])),
  );
  $('how-steps').replaceChildren(...w.steps.map(([title, body], i) => h('li', { 'data-step': i + 1 }, h('h3', {}, title), h('p', {}, typeof body === 'function' ? body(demo.detectMs) : body))));
  watchSteps();
  setStep(Number(sec.dataset.step) || 1, true);
}

let stepObserver;
let abTimer;
function watchSteps() {
  stepObserver?.disconnect();
  stepObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) setStep(Number(e.target.dataset.step));
    },
    { rootMargin: '-48% 0px -48% 0px' },
  );
  document.querySelectorAll('#how-steps li').forEach((li) => stepObserver.observe(li));
}

function setStep(n, force = false) {
  const sec = $('how');
  if (!force && Number(sec.dataset.step) === n) return;
  sec.dataset.step = n;
  document.querySelectorAll('#how-steps li').forEach((li) => li.classList.toggle('is-on', Number(li.dataset.step) === n));
  for (const cell of document.querySelectorAll('.how-cell')) {
    const on = n >= Number(cell.dataset.from);
    if (on === cell.classList.contains('is-on') && !force) continue;
    cell.classList.toggle('is-on', on);
    const dd = cell.querySelector('dd');
    const num = dd.firstChild;
    const target = on ? Number(cell.dataset.to) : 0;
    cell._num ??= { _val: 0, set textContent(v) { num.textContent = v; } };
    tweenNumber(cell._num, target, { duration: on ? 1100 : 300 });
  }
  // Step 1 flips between the two frames so the two seconds are visible; later steps hold frame 2.
  clearInterval(abTimer);
  const stamp = $('how-stamp');
  const show = (b) => {
    sec.dataset.ab = b ? 'b' : 'a';
    if (stamp) stamp.textContent = b ? c().frame2 : c().frame1;
  };
  if (n === 1) {
    let b = false;
    show(false);
    abTimer = setInterval(() => show((b = !b)), 1100);
  } else show(true);
}

// data
async function refresh() {
  try {
    summary = await (await fetch('/api/summary')).json();
  } catch {
    return;
  }
  setCityLabels(summary.cities);
  // The four roads stand for the four cities with the most readable cameras; the set only
  // changes when that ranking does, so the tags do not hop around between refreshes.
  const top = [...summary.cities].sort((a, b) => b.live - a.live).slice(0, 4).map((x) => x.city);
  if (top.length && top.slice().sort().join() !== roadCities.slice().sort().join()) roadCities = top;
  flow?.setJam(Object.fromEntries(roadCities.map((id, i) => [i, summary.cities.find((x) => x.city === id)?.idx ?? null])));
  renderPipe();
  renderHero();
  renderReel();
  renderCities();
}

function renderAll() {
  renderWords();
  renderHero();
  if (summary) {
    renderReel();
    renderCities();
  }
  renderHow();
}

// boot
const search = initSearch({
  data: async () => {
    const d = await (await fetch('/api/cameras')).json();
    setCityLabels(d.cities);
    return d;
  },
  onCam: (id) => location.assign(`/live#cam=${encodeURIComponent(id)}`),
  onCity: (city) => location.assign(`/live#city=${encodeURIComponent(city)}`),
});
initChrome({
  onLang: () => {
    search.words();
    renderAll();
  },
});
renderWords();
renderHero();
const flow = createFlow($('flow-road'), $('flow'), {
  onLayout: (pos) => {
    tagPos = pos;
    renderTags();
  },
});
try {
  demo = await (await fetch('/assets/demo/demo.json')).json();
} catch {
  demo = null;
}
renderHow();
await refresh();
setInterval(refresh, 30_000);
