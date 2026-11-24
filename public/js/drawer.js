import Hls from '/vendor/hls/hls.min.mjs';
import { h, s, boxesSvg, levelTag, glyph, fmtIdx, ago, clock, frameUrl, CITY_LABEL, totalVehicles } from './util.js';
import { lineChart, hourBars } from './charts.js';
import { t } from './i18n.js';

const root = () => document.getElementById('drawer');
const panel = () => document.getElementById('drawer-panel');

let current = null; // camera detail
let mode = 'frame';
let hls = null;
let lastFocus = null;
let reqId = 0;

function stopVideo() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  panel()?.querySelector('video')?.removeAttribute('src');
}

export const openId = () => (root().hidden ? null : current?.id || null);

export async function openCamera(id, { onClose } = {}) {
  const el = root();
  if (el.hidden) {
    lastFocus = document.activeElement;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    mode = 'frame';
  }
  el.onclose = onClose;
  if (current?.id !== id) {
    stopVideo();
    mode = 'frame';
    panel().replaceChildren(h('div', { class: 'd-body' }, h('p', { class: 'worst-sub' }, '…')));
  }
  await load(id, false);
  panel().focus();
}

async function load(id, animate) {
  const mine = ++reqId;
  let d;
  try {
    const res = await fetch(`/api/camera/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(res.status);
    d = await res.json();
  } catch {
    if (mine === reqId) panel().replaceChildren(head({ id, name: id }), h('div', { class: 'd-body' }, h('p', {}, t('loadError'))));
    return;
  }
  if (mine !== reqId || root().hidden) return;
  const keepVideo = mode === 'live' && current?.id === d.id && hls;
  current = d;
  render(animate, keepVideo);
}

export function closeDrawer() {
  const el = root();
  if (el.hidden) return;
  stopVideo();
  el.hidden = true;
  document.body.style.overflow = '';
  const cb = el.onclose;
  current = null;
  cb?.();
  lastFocus?.focus?.();
}

/** Called for every live camera event; refreshes the open drawer if it is this camera. */
export function cameraUpdated(id) {
  if (!root().hidden && current?.id === id) load(id, true);
}

export function rerender() {
  if (!root().hidden && current) render(false, false);
}

function head(d) {
  return h(
    'header',
    { class: 'd-head' },
    h('div', {}, h('h2', { id: 'd-name' }, d.name), h('p', {}, [d.view, d.area && d.area !== CITY_LABEL[d.city] ? d.area : null, CITY_LABEL[d.city]].filter(Boolean).join(', '))),
    h(
      'button',
      { class: 'd-close', type: 'button', 'aria-label': t('close'), 'data-close': '' },
      s('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }, s('path', { d: 'M6 6l12 12M18 6 6 18', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })),
    ),
  );
}

function render(animate, keepVideo) {
  const d = current;
  const p = panel();
  const ok = d.status === 'ok';

  // media
  let media;
  if (keepVideo) {
    media = p.querySelector('.d-media');
  } else {
    stopVideo();
    const frame = h('div', { class: 'frame' });
    if (mode === 'live') {
      const video = h('video', { muted: true, playsinline: true, autoplay: true, controls: true, 'aria-label': `${t('liveVideo')}: ${d.name}` });
      video.muted = true;
      const note = h('div', { class: 'frame-flag' }, t('playLoading'));
      frame.append(video, note);
      const fail = () => note.replaceChildren(t('playError')) || (note.hidden = false);
      video.addEventListener('playing', () => (note.hidden = true));
      if (Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 2, maxBufferLength: 10 });
        hls.on(Hls.Events.ERROR, (_, e) => e.fatal && fail());
        hls.loadSource(d.live);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = d.live;
        video.addEventListener('error', fail);
      } else fail();
    } else if (d.frameV) {
      const img = h('img', { src: frameUrl(d, false), alt: `${t('frame')}: ${d.name}`, width: 960, height: 540, decoding: 'async' });
      frame.append(img, boxesSvg(d.boxes, ok ? d.level : null, { stagger: true }));
      if (!ok) frame.append(h('div', { class: 'frame-flag' }, t('status')[d.status] || '', h('small', {}, t('statusWhy')[d.status] || '')));
      if (animate) {
        const sw = h('div', { class: 'sweep' });
        frame.append(sw);
        requestAnimationFrame(() => sw.style.setProperty('--h', `${frame.clientHeight}px`));
        sw.addEventListener('animationend', () => sw.remove());
      }
    } else {
      frame.append(h('div', { class: 'frame-flag' }, t('status')[d.status] || t('noReading'), h('small', {}, t('statusWhy')[d.status] || '')));
    }
    const toggle = h(
      'div',
      { class: 'seg-toggle', role: 'group', 'aria-label': t('frame') },
      h('button', { type: 'button', 'aria-pressed': String(mode === 'frame'), onclick: () => setMode('frame') }, t('frame')),
      h('button', { type: 'button', 'aria-pressed': String(mode === 'live'), onclick: () => setMode('live') }, t('liveVideo')),
    );
    const key =
      mode === 'frame'
        ? h(
            'div',
            { class: 'box-key', 'data-l': ok ? d.level : 3 },
            h('span', {}, h('i', { class: 'k-move' }), t('moving')),
            h('span', {}, h('i', { class: 'k-stop' }), t('stopped')),
            h('span', {}, h('i', { class: 'k-park' }), t('parked')),
          )
        : null;
    media = h('section', { class: 'd-media', 'aria-label': t('frame') }, frame, h('div', { class: 'd-media-bar' }, toggle, key));
  }

  // reading
  const reading = h(
    'section',
    { class: 'd-reading' },
    h('div', { class: 'd-idx', 'aria-label': `${t('index')} ${fmtIdx(d.idx)}` }, ok ? fmtIdx(d.idx) : '–', h('small', {}, ' /100')),
    h(
      'div',
      {},
      h('div', { class: 'd-level', 'data-l': ok ? d.level : 'n' }, glyph(ok ? d.level : null), ok ? t('levels')[d.level] : t('status')[d.status] || t('noReading')),
      h('div', { class: 'd-when' }, d.ts ? `${ago(d.ts)}, ${clock(d.ts)}` : t('never')),
    ),
    h('p', { class: 'd-why' }, ok ? t('why', { pcu: d.pcu, crowd: d.crowd ?? 0, stall: d.stall }) + (d.dark ? t('whyDark') : '') : t('statusWhy')[d.status] || ''),
  );

  // vehicle mix
  let mix = null;
  if (d.counts && (ok || d.status === 'blind')) {
    const c = d.counts;
    const max = Math.max(1, c.moto, c.car, c.bus, c.truck);
    const row = (key, n) =>
      h('div', { class: 'mix-row' }, h('span', {}, t(key)), h('div', { class: 'mix-track' }, h('div', { class: 'mix-fill', style: { width: `${(n / max) * 100}%` } })), h('b', {}, n));
    const parts = [h('div', { class: 'mix' }, row('moto', c.moto), row('car', c.car), row('bus', c.bus), row('truck', c.truck))];
    if (d.stall != null) {
      const pct = Math.round(d.stall * 100);
      parts.push(
        h(
          'div',
          { class: 'stall' },
          h('div', { class: 'board-label' }, t('stoppedShare')),
          h('div', { class: 'stall-track', role: 'img', 'aria-label': `${pct}% ${t('stopped')}` }, pct > 0 ? h('span', { class: 's-stop', style: { width: `${pct}%` } }) : null, pct < 100 ? h('span', { class: 's-move' }) : null),
          h('div', { class: 'stall-cap' }, h('span', {}, `${pct}% ${t('stopped').toLowerCase()}`), h('span', {}, `${100 - pct}% ${t('moved')}`)),
        ),
      );
    }
    if (d.parked) parts.push(h('p', { class: 'worst-sub' }, t('parkedLeftOut', d.parked)));
    mix = h('section', { class: 'd-sec' }, h('h3', {}, t('mix'), h('span', { class: 'sub' }, `${totalVehicles(d)} ${t('vehiclesShort')}`)), parts);
  }

  // charts
  const now = Date.now();
  const chartHost = h('div', { class: 'chart' });
  const hist = (d.history || []).filter((r) => r.idx != null).map((r) => ({ t: r.ts, v: r.idx, sub: `${r.car + r.moto + r.bus + r.truck} ${t('vehiclesShort')}` }));
  const from = hist.length ? Math.max(now - 24 * 3600_000, hist[0].t - 10 * 60_000) : now - 24 * 3600_000;
  const partial = from > now - 23 * 3600_000;
  const dayTitle = partial ? `${t('indexWord')}, ${t('since', clock(from)).replace(/^./, (ch) => ch.toLowerCase())}` : t('todayChart');
  const day = h('section', { class: 'd-sec' }, h('h3', {}, dayTitle), hist.length > 1 ? chartHost : h('p', { class: 'chart-empty' }, t('noHistory')));
  const hourHost = h('div', { class: 'chart' });
  const enoughHours = (d.hourly || []).filter((r) => r.n >= 2).length >= 3;
  const typical = h('section', { class: 'd-sec' }, h('h3', {}, t('typical'), h('span', { class: 'sub' }, t('typicalSub'))), enoughHours ? hourHost : h('p', { class: 'chart-empty' }, t('typicalEmpty')));

  // facts
  const facts = h(
    'section',
    { class: 'd-sec' },
    h('h3', {}, t('details')),
    h(
      'dl',
      { class: 'facts' },
      h('dt', {}, t('operator')),
      h('dd', {}, d.operator),
      h('dt', {}, t('location')),
      h('dd', {}, `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)} (${d.approx ? t('approx') : t('exact')})`),
      d.cap ? [h('dt', {}, t('busyLevel')), h('dd', {}, d.learned ? t('busyLearned', Math.round(d.cap * 10) / 10) : t('busyDefault', Math.round(d.cap)))] : null,
      d.sharp != null ? [h('dt', {}, t('picture')), h('dd', {}, t('sharpness', Math.round(d.sharp), Math.round(d.luma)))] : null,
      h('dt', {}, t('source')),
      h('dd', {}, h('a', { href: d.source, target: '_blank', rel: 'noopener noreferrer' }, t('openSource'))),
    ),
  );

  const body = h('div', { class: animate || keepVideo ? 'd-body is-update' : 'd-body' }, media, reading, mix, day, typical, facts);
  p.replaceChildren(head(d), body);
  if (hist.length > 1) lineChart(chartHost, hist, { height: 170, from, to: now, label: dayTitle });
  if (enoughHours) hourBars(hourHost, d.hourly, { height: 130, label: t('typical') });
}

function setMode(m) {
  if (mode === m) return;
  mode = m;
  render(false, false);
}

// Close on scrim / button / Escape, and keep Tab inside the panel.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') && !root().hidden) closeDrawer();
});
document.addEventListener('keydown', (e) => {
  if (root().hidden) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeDrawer();
  } else if (e.key === 'Tab') {
    const f = [...panel().querySelectorAll('button, a[href], video[controls], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel())) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
