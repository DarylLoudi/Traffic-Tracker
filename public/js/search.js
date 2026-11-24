// Search: a header button (or the "/" key) opens a finder for roads, junctions and cities.
// Cameras at one place are grouped, and picking a place opens its most congested view.
import { h, s, glyph, fmtIdx, CITY_LABEL } from './util.js';
import { t } from './i18n.js';

const fold = (x) =>
  String(x || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bjl\b\.?|\bjln\b\.?/g, 'jalan')
    .replace(/\bsp\b\.?/g, 'simpang')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const icon = () =>
  s('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }, s('path', { d: 'M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z', fill: 'currentColor' }));

/** One row per place: cameras sharing a city and a name. */
function places(cams) {
  const by = new Map();
  for (const c of cams) {
    const k = `${c.city}|${c.name}`;
    let p = by.get(k);
    if (!p) by.set(k, (p = { city: c.city, name: c.name, cams: [], text: '' }));
    p.cams.push(c);
  }
  for (const p of by.values()) {
    const ok = p.cams.filter((c) => c.status === 'ok').sort((a, b) => b.idx - a.idx);
    p.best = ok[0] || p.cams[0];
    p.text = fold(`${p.name} ${p.cams.map((c) => `${c.view} ${c.area || ''}`).join(' ')} ${CITY_LABEL[p.city]}`);
    p.head = fold(p.name);
  }
  return [...by.values()];
}

function score(p, words) {
  if (!words.every((w) => p.text.includes(w))) return -1;
  const first = words[0];
  let sc = 0;
  if (p.head.startsWith(first)) sc += 4;
  else if (` ${p.head}`.includes(` ${first}`)) sc += 2;
  if (p.best?.status === 'ok') sc += p.best.idx / 100;
  return sc;
}

/**
 * data(): { cities: [{city, label, cameras}], cams: [camera] } or a promise of it.
 * onCam(id), onCity(cityId): what picking does.
 */
export function initSearch({ data, onCam, onCity }) {
  const btn = document.getElementById('search-btn');
  const input = h('input', { type: 'search', class: 'finder-input', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'finder-list', 'aria-autocomplete': 'list' });
  const list = h('ul', { class: 'finder-list', id: 'finder-list', role: 'listbox' });
  const foot = h('p', { class: 'finder-foot' });
  const dlg = h(
    'dialog',
    { class: 'finder', 'aria-label': t('searchLabel') },
    h('div', { class: 'finder-in' }, h('label', { class: 'finder-field' }, icon(), input, h('kbd', {}, 'Esc')), list, foot),
  );
  document.body.append(dlg);

  let rows = [];
  let active = 0;
  let cache = null;

  const words = () => {
    input.placeholder = t('searchPh');
    input.setAttribute('aria-label', t('searchLabel'));
    dlg.setAttribute('aria-label', t('searchLabel'));
    btn.querySelector('.search-word').textContent = t('searchBtn');
    btn.setAttribute('aria-label', t('searchLabel'));
    foot.replaceChildren(h('kbd', {}, '↑'), h('kbd', {}, '↓'), ` ${t('searchKeys')}`);
  };

  function rowFor(item, i) {
    const li = h('li', { role: 'option', id: `finder-${i}`, class: 'finder-row', 'aria-selected': String(i === active) });
    if (item.kind === 'city') {
      li.append(h('span', { class: 'finder-pin', 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 24 24', width: 16, height: 16 }, s('path', { d: 'M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', fill: 'currentColor' }))), h('span', { class: 'finder-text' }, h('b', {}, item.label), h('small', {}, t('cityCams', item.cameras))));
    } else {
      const c = item.best;
      const ok = c.status === 'ok';
      const views = item.cams.length;
      li.append(
        h('span', { class: 'finder-lvl', 'data-l': ok ? c.level : 'n' }, glyph(ok ? c.level : null)),
        h('span', { class: 'finder-text' }, h('b', {}, item.name), h('small', {}, views > 1 ? `${CITY_LABEL[item.city]}, ${t('camerasN', views)}` : `${CITY_LABEL[item.city]}, ${c.view}`)),
        h('span', { class: 'finder-idx' }, ok ? fmtIdx(c.idx) : ''),
      );
    }
    li.addEventListener('pointermove', () => setActive(i));
    li.addEventListener('click', () => pick(i));
    return li;
  }

  function group(title) {
    return h('li', { class: 'finder-group', role: 'presentation' }, title);
  }

  function render() {
    const q = fold(input.value);
    const d = cache;
    list.replaceChildren();
    rows = [];
    if (!d) return;
    const all = places(d.cams);
    let cityHits = [];
    let placeHits;
    if (!q) {
      placeHits = all.filter((p) => p.best.status === 'ok').sort((a, b) => b.best.idx - a.best.idx).slice(0, 6);
    } else {
      const ws = q.split(' ');
      cityHits = d.cities.filter((c) => ws.every((w) => fold(c.label).includes(w))).map((c) => ({ kind: 'city', ...c }));
      placeHits = all
        .map((p) => [p, score(p, ws)])
        .filter(([, sc]) => sc >= 0)
        .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))
        .slice(0, 8)
        .map(([p]) => p);
    }
    rows = [...cityHits, ...placeHits.map((p) => ({ kind: 'place', ...p }))];
    active = Math.min(active, Math.max(0, rows.length - 1));
    let i = 0;
    if (cityHits.length) list.append(group(t('searchCities')), ...cityHits.map((r) => rowFor(r, i++)));
    if (placeHits.length) list.append(group(q ? t('searchCams') : t('worstTitle')), ...placeHits.map(() => rowFor(rows[i], i++)));
    if (!rows.length) list.append(h('li', { class: 'finder-empty', role: 'presentation' }, q ? t('searchNone', input.value.trim()) : t('searchHint')));
    input.setAttribute('aria-activedescendant', rows.length ? `finder-${active}` : '');
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    list.querySelectorAll('.finder-row').forEach((li) => li.setAttribute('aria-selected', String(li.id === `finder-${i}`)));
    input.setAttribute('aria-activedescendant', `finder-${i}`);
    list.querySelector(`#finder-${i}`)?.scrollIntoView({ block: 'nearest' });
  }

  function pick(i) {
    const r = rows[i];
    if (!r) return;
    dlg.close();
    if (r.kind === 'city') onCity(r.city);
    else onCam(r.best.id);
  }

  async function open() {
    words();
    input.value = '';
    active = 0;
    dlg.showModal();
    input.focus();
    render();
    try {
      cache = await data();
    } catch {
      cache = null;
    }
    render();
  }

  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    }
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  btn.addEventListener('click', open);
  addEventListener('keydown', (e) => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      if (dlg.open || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      open();
    }
  });
  words();
  return { words, open };
}
