// Hand-drawn SVG charts for the camera drawer and the city cards. One series each;
// level colours are used only for the threshold lines and the dot at the end.
import { s, h, showTip, hideTip, LEVEL_VAR, clock } from './util.js';
import { t } from './i18n.js';

const levelOf = (v, th) => (v < th[0] ? 0 : v < th[1] ? 1 : v < th[2] ? 2 : 3);

/**
 * Line over time on a fixed 0-100 scale.
 * points: [{t, v}] sorted; opts: {height, from, to, thresholds, bands, compact, label}
 */
export function lineChart(host, points, opts) {
  const { height = 160, from, to, thresholds = [25, 50, 72], bands = true, compact = false, label = '' } = opts;
  host.replaceChildren();
  const W = Math.max(120, host.clientWidth || 300);
  const H = height;
  const pad = compact ? { l: 0, r: 6, t: 6, b: 4 } : { l: 30, r: 54, t: 10, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (tt) => pad.l + ((tt - from) / (to - from)) * iw;
  // Full charts keep the fixed 0-100 scale. A sparkline has no axis, so it zooms
  // to its own range (at least 24 points tall) to show the shape of the day.
  let lo = 0;
  let hi = 100;
  if (compact && points.length) {
    const vs = points.map((p) => p.v);
    const mid = (Math.min(...vs) + Math.max(...vs)) / 2;
    const half = Math.max(12, (Math.max(...vs) - Math.min(...vs)) / 2 + 4);
    lo = Math.max(0, mid - half);
    hi = Math.min(100, lo + half * 2);
    lo = Math.max(0, hi - half * 2);
  }
  const y = (v) => pad.t + ih - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ih;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': label });

  if (bands && !compact) {
    // Threshold rules, labelled at the right end in muted text.
    thresholds.forEach((th, i) => {
      svg.append(s('line', { x1: pad.l, x2: pad.l + iw, y1: y(th), y2: y(th), stroke: 'var(--chart-grid)', 'stroke-width': 1, 'stroke-dasharray': '2 4' }));
      svg.append(s('text', { x: pad.l + iw + 8, y: y(th) + 4, 'font-size': 11, fill: 'var(--ink-3)' }, t('levels')[i + 1]));
    });
    [0, 100].forEach((v) => svg.append(s('text', { x: pad.l - 8, y: y(v) + 4, 'font-size': 11, fill: 'var(--ink-3)', 'text-anchor': 'end' }, v)));
    svg.append(s('line', { x1: pad.l, x2: pad.l + iw, y1: y(0), y2: y(0), stroke: 'var(--line-2)', 'stroke-width': 1 }));
    // time ticks: about four across whatever span is shown
    const span = to - from;
    const step = [5, 10, 15, 30, 60, 120, 180, 360].map((m) => m * 60_000).find((st) => span / st <= 5) || 6 * 3600_000;
    for (let tt = Math.ceil(from / step) * step; tt <= to; tt += step) {
      svg.append(s('text', { x: x(tt), y: H - 4, 'font-size': 11, fill: 'var(--ink-3)', 'text-anchor': 'middle' }, clock(tt).replace(' WIB', '')));
    }
  } else if (compact) {
    svg.append(s('line', { x1: pad.l, x2: pad.l + iw, y1: pad.t + ih + 0.5, y2: pad.t + ih + 0.5, stroke: 'var(--chart-grid)', 'stroke-width': 1 }));
  }

  // Break the line where scans are missing for more than 20 minutes.
  const segs = [];
  let cur = [];
  for (const p of points) {
    if (cur.length && p.t - cur[cur.length - 1].t > 20 * 60_000) {
      segs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  for (const seg of segs) {
    if (seg.length === 1) {
      svg.append(s('circle', { cx: x(seg[0].t), cy: y(seg[0].v), r: 2, fill: 'var(--chart-line)' }));
      continue;
    }
    const d = seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    svg.append(s('path', { d, fill: 'none', stroke: 'var(--chart-line)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  const last = points[points.length - 1];
  if (last) {
    svg.append(s('circle', { cx: x(last.t), cy: y(last.v), r: compact ? 4 : 5, fill: LEVEL_VAR[levelOf(last.v, thresholds)], stroke: 'var(--bg)', 'stroke-width': 2 }));
  }

  // Hover: crosshair + nearest point.
  const cross = s('line', { y1: pad.t, y2: pad.t + ih, stroke: 'var(--ink-3)', 'stroke-width': 1, visibility: 'hidden' });
  const dot = s('circle', { r: 4, fill: 'var(--ink)', stroke: 'var(--bg)', 'stroke-width': 2, visibility: 'hidden' });
  const hit = s('rect', { x: pad.l, y: 0, width: iw, height: H, fill: 'transparent' });
  svg.append(cross, dot, hit);
  const move = (ev) => {
    if (!points.length) return;
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const tt = from + ((px - pad.l) / iw) * (to - from);
    let best = points[0];
    for (const p of points) if (Math.abs(p.t - tt) < Math.abs(best.t - tt)) best = p;
    cross.setAttribute('x1', x(best.t));
    cross.setAttribute('x2', x(best.t));
    dot.setAttribute('cx', x(best.t));
    dot.setAttribute('cy', y(best.v));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    showTip(ev.clientX, ev.clientY, h('b', {}, Math.round(best.v)), ' ', t('levels')[levelOf(best.v, thresholds)], h('div', { class: 'tip-sub' }, clock(best.t), best.sub ? `, ${best.sub}` : ''));
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTip();
  });
  host.append(svg);
}

/** 24 bars, hour of day. Current hour drawn in full ink, others muted. */
export function hourBars(host, rows, { height = 120, label = '' } = {}) {
  host.replaceChildren();
  const W = Math.max(200, host.clientWidth || 300);
  const H = height;
  const pad = { l: 30, r: 4, t: 8, b: 20 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / 24;
  const by = new Map(rows.map((r) => [r.hour, r]));
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jakarta' }).format(Date.now())) % 24;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': label });
  [0, 50, 100].forEach((v) => {
    const yy = pad.t + ih - (v / 100) * ih;
    svg.append(s('line', { x1: pad.l, x2: pad.l + iw, y1: yy, y2: yy, stroke: v === 0 ? 'var(--line-2)' : 'var(--chart-grid)', 'stroke-width': 1, 'stroke-dasharray': v === 0 ? null : '2 4' }));
    svg.append(s('text', { x: pad.l - 8, y: yy + 4, 'font-size': 11, fill: 'var(--ink-3)', 'text-anchor': 'end' }, v));
  });
  for (let hr = 0; hr < 24; hr++) {
    const r = by.get(hr);
    const x0 = pad.l + hr * bw + 1;
    if (hr % 3 === 0) svg.append(s('text', { x: x0 + bw / 2 - 1, y: H - 5, 'font-size': 11, fill: 'var(--ink-3)', 'text-anchor': 'middle' }, String(hr).padStart(2, '0')));
    if (!r) continue;
    const v = Math.max(0.5, r.idx);
    const bh = (v / 100) * ih;
    const yy = pad.t + ih - bh;
    const w = Math.max(2, bw - 2);
    // 4px rounded top, square at the baseline
    const rad = Math.min(4, w / 2, bh);
    const d = `M${x0},${pad.t + ih}V${yy + rad}Q${x0},${yy} ${x0 + rad},${yy}H${x0 + w - rad}Q${x0 + w},${yy} ${x0 + w},${yy + rad}V${pad.t + ih}Z`;
    const bar = s('path', { d, fill: hr === nowHour ? 'var(--chart-line)' : 'var(--line-2)' });
    const hitR = s('rect', { x: pad.l + hr * bw, y: pad.t, width: bw, height: ih, fill: 'transparent' });
    hitR.addEventListener('pointermove', (ev) =>
      showTip(ev.clientX, ev.clientY, h('b', {}, `${String(hr).padStart(2, '0')}:00`), ' ', `${Math.round(r.idx)} ${t('levels')[levelOf(r.idx, [25, 50, 72])]}`, h('div', { class: 'tip-sub' }, `${r.n} scans`)),
    );
    hitR.addEventListener('pointerleave', hideTip);
    svg.append(bar, hitR);
  }
  host.append(svg);
}
