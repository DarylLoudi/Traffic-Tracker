import { t } from './i18n.js';

/** Tiny element builder. Strings become text nodes, never HTML. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat(Infinity)) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export const LEVEL_VAR = ['var(--l0)', 'var(--l1)', 'var(--l2)', 'var(--l3)'];

export function glyph(level) {
  return h('span', { class: 'glyph', 'data-l': level ?? 'n', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
}

export function statusLabel(cam) {
  if (cam.status === 'ok') return t('levels')[cam.level];
  return t('status')[cam.status] || t('noReading');
}

/** Level glyph + word. Colour never carries the meaning alone. */
export function levelTag(cam) {
  const l = cam.status === 'ok' ? cam.level : null;
  return h('span', { class: 'lvl', 'data-l': l ?? 'n' }, glyph(l), statusLabel(cam));
}

export const fmtIdx = (v) => (v == null ? '–' : Math.round(v).toString());
export const totalVehicles = (c) => (c?.counts ? c.counts.car + c.counts.moto + c.counts.bus + c.counts.truck : 0);

export function ago(ts) {
  if (!ts) return t('never');
  return t('ago', (Date.now() - ts) / 1000);
}

const wib = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false });
export const clock = (ts) => `${wib.format(ts)} WIB`;

/** City id -> display name, filled from the server's city list. An unknown id shows as itself. */
const labels = {};
export const CITY_LABEL = new Proxy(labels, { get: (o, k) => o[k] ?? k });
export function setCityLabels(cities) {
  for (const c of cities) labels[c.city] = c.label;
}

export function debounce(fn, ms) {
  let id;
  return (...a) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...a), ms);
  };
}

/** Detection boxes over a frame. Boxes are [x, y, w, h, class, flags] in 0..1. */
export function boxesSvg(boxes, level, { thin = false, stagger = false } = {}) {
  const svg = s('svg', { class: stagger ? 'boxes stagger' : 'boxes', viewBox: '0 0 1000 1000', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const stopColor = level != null ? LEVEL_VAR[level] : 'var(--l3)';
  const w = thin ? 1.2 : 1.6;
  for (const [x, y, bw, bh, , f] of boxes || []) {
    const parked = f & 2;
    const stopped = f & 1;
    const attrs = {
      x: (x * 1000).toFixed(1),
      y: (y * 1000).toFixed(1),
      width: (bw * 1000).toFixed(1),
      height: (bh * 1000).toFixed(1),
      rx: 3,
      'vector-effect': 'non-scaling-stroke',
      'stroke-width': w,
      fill: 'none',
    };
    if (parked) Object.assign(attrs, { stroke: '#c9cdd0', 'stroke-dasharray': '3 3', 'stroke-opacity': thin ? 0.55 : 0.8 });
    else if (stopped) Object.assign(attrs, { stroke: stopColor, fill: stopColor, 'fill-opacity': thin ? 0.18 : 0.32, 'stroke-opacity': thin ? 0.85 : 1 });
    else Object.assign(attrs, { stroke: '#ffffff', 'stroke-opacity': thin ? 0.7 : 0.92 });
    const rect = s('rect', attrs);
    if (stagger) rect.style.setProperty('--i', svg.childElementCount);
    svg.append(rect);
  }
  return svg;
}

export function frameUrl(cam, thumb = true) {
  return cam.frameV ? `/frames/${cam.id}${thumb ? '.t' : ''}.jpg?v=${cam.frameV}` : null;
}

// Shared tooltip
const tip = () => document.getElementById('tip');
export function showTip(x, y, ...content) {
  const el = tip();
  el.replaceChildren(...content);
  el.hidden = false;
  const r = el.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
  const top = y + r.height + 20 > window.innerHeight ? y - r.height - 12 : y + 16;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
export const hideTip = () => {
  tip().hidden = true;
};

export const levelOfIdx = (v) => (v == null ? null : v < 25 ? 0 : v < 50 ? 1 : v < 72 ? 2 : 3);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count a number up or down to a new value. Remembers the last value on the element. */
export function tweenNumber(el, to, { format = (v) => Math.round(v).toString(), duration = 900 } = {}) {
  if (to == null || Number.isNaN(to)) {
    el._val = null;
    el.textContent = '–';
    return;
  }
  const from = el._val ?? 0;
  el._val = to;
  cancelAnimationFrame(el._raf);
  if (reducedMotion() || Math.abs(to - from) < 0.5) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = format(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/** Re-render a keyed list and slide surviving items from their old place (FLIP). Items carry data-key. */
export function flipRender(container, render) {
  const before = new Map();
  for (const el of container.children) if (el.dataset.key) before.set(el.dataset.key, el.getBoundingClientRect().top);
  render();
  if (reducedMotion() || !before.size) return;
  for (const el of container.children) {
    const key = el.dataset.key;
    if (!key) continue;
    const was = before.get(key);
    if (was === undefined) {
      el.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
      continue;
    }
    const dy = was - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
}

export const arrowIcon = () =>
  s('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }, s('path', { d: 'M5 12h13M12.5 6l6 6-6 6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

/** An <img> that fades in once it has loaded. */
export function fadeImg(attrs) {
  const img = h('img', { ...attrs, class: `${attrs.class || ''} is-loading`.trim() });
  const done = () => img.classList.remove('is-loading');
  img.addEventListener('load', done);
  img.addEventListener('error', done);
  if (img.complete) done();
  return img;
}
