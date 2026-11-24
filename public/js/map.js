import * as maplibregl from '/vendor/maplibre/maplibre-gl.mjs';
import { h, glyph, fmtIdx, showTip, hideTip, statusLabel, levelOfIdx, reducedMotion } from './util.js';
import { t } from './i18n.js';

const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
// Sumatra to East Java, until the camera list says otherwise.
const START = [[100.9, -8.4], [113.1, 1.0]];
const CITY_ZOOM = 9.2;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function boundsOf(cameras) {
  if (!cameras.length) return START;
  const b = new maplibregl.LngLatBounds();
  cameras.forEach((c) => b.extend([c.lng, c.lat]));
  return b;
}

// Dot radius by level and zoom. "zoom" has to stay at the top of the expression,
// so scaling and growing happen inside each stop.
const BY_LEVEL = [
  [7, [4.5, 4, 3.5, 3, 2.5]],
  [13, [9, 8, 7, 6, 4.5]],
  [17, [13, 12, 11, 10, 7]],
];
const radius = (mul = 1, add = 0) => [
  'interpolate', ['linear'], ['zoom'],
  ...BY_LEVEL.flatMap(([z, [l3, l2, l1, l0, none]]) => [z, ['match', ['get', 'level'], 3, l3 * mul + add, 2, l2 * mul + add, 1, l1 * mul + add, 0, l0 * mul + add, none * mul + add]]),
];

/** pad(): map padding in px that keeps the floating panels clear of what the map is showing. */
export function createMap(container, { onSelect, onCity, pad = () => 40, cameras = [] }) {
  let everything = boundsOf(cameras);
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    bounds: everything,
    fitBoundsOptions: { padding: pad() },
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxZoom: 18,
    minZoom: 3.5,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  let data = { type: 'FeatureCollection', features: [] };
  let selected = null;
  const cityMarkers = new Map();

  function paint() {
    const L = [css('--l0'), css('--l1'), css('--l2'), css('--l3')];
    const none = css('--ln');
    for (const layer of map.getStyle().layers) {
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', css('--bg-2'));
    }
    if (!map.getSource('cams')) map.addSource('cams', { type: 'geojson', data });
    const color = ['match', ['get', 'level'], 0, L[0], 1, L[1], 2, L[2], 3, L[3], none];
    map.addLayer({
      id: 'cams-halo',
      type: 'circle',
      source: 'cams',
      filter: ['==', ['get', 'level'], 3],
      paint: { 'circle-radius': radius(2.4), 'circle-color': L[3], 'circle-opacity': 0.2 },
    });
    map.addLayer({
      id: 'cams',
      type: 'circle',
      source: 'cams',
      layout: { 'circle-sort-key': ['get', 'level'] },
      paint: {
        'circle-radius': radius(),
        'circle-color': color,
        'circle-stroke-color': css('--bg'),
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 13, 1.6],
        'circle-opacity': ['case', ['==', ['get', 'level'], -1], 0.75, 1],
      },
    });
    map.addLayer({
      id: 'cams-sel',
      type: 'circle',
      source: 'cams',
      filter: ['==', ['get', 'id'], selected || ''],
      paint: { 'circle-radius': radius(1, 6), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': css('--ink'), 'circle-stroke-width': 2 },
    });
  }

  map.on('style.load', paint);
  map.on('error', (e) => console.warn('map:', e?.error?.message || e));

  // Jammed cameras breathe: the halo grows and fades every two seconds.
  if (!reducedMotion()) {
    const beat = () => {
      if (!document.hidden && map.getLayer('cams-halo')) {
        const k = (performance.now() % 2000) / 2000;
        const e = 1 - Math.pow(1 - k, 3);
        map.setPaintProperty('cams-halo', 'circle-radius', radius(1.2 + e * 2.4), { validate: false });
        map.setPaintProperty('cams-halo', 'circle-opacity', 0.36 * (1 - e), { validate: false });
      }
      setTimeout(() => requestAnimationFrame(beat), 45);
    };
    requestAnimationFrame(beat);
  }

  map.on('mousemove', 'cams', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    const cam = { status: p.status, level: p.level === -1 ? null : p.level };
    showTip(e.originalEvent.clientX, e.originalEvent.clientY, h('b', {}, p.name), h('div', { class: 'tip-sub' }, p.view), h('div', {}, p.level >= 0 ? `${fmtIdx(p.idx)} ` : '', statusLabel(cam)));
  });
  map.on('mouseleave', 'cams', () => {
    map.getCanvas().style.cursor = '';
    hideTip();
  });
  map.on('click', 'cams', (e) => {
    hideTip();
    onSelect(e.features[0].properties.id);
  });

  // City labels show when zoomed out. Where two would overlap (Jakarta, Bekasi and
  // Tangerang sit close together) the city with more cameras keeps its label.
  const toggleMarkers = () => {
    const show = map.getZoom() < CITY_ZOOM - 0.6;
    const kept = [];
    const order = [...cityMarkers.values()].sort((a, b) => b.weight - a.weight);
    for (const m of order) {
      const el = m.getElement();
      el.style.display = show ? '' : 'none';
      if (!show) continue;
      const r = el.getBoundingClientRect();
      const hit = kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom && r.bottom > k.top);
      if (hit) el.style.display = 'none';
      else kept.push(r);
    }
  };
  map.on('zoom', toggleMarkers);
  map.on('moveend', toggleMarkers);

  let pings = 0;

  return {
    map,
    update(cameras, cities) {
      data = {
        type: 'FeatureCollection',
        features: cameras.map((c) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
          properties: { id: c.id, name: c.name, view: c.view, status: c.status, level: c.status === 'ok' ? c.level : -1, idx: c.idx ?? 0 },
        })),
      };
      map.getSource('cams')?.setData(data);
      for (const city of cities) {
        let m = cityMarkers.get(city.city);
        const lvl = levelOfIdx(city.idx);
        const el = h(
          'button',
          { class: 'city-marker', type: 'button', 'aria-label': `${city.label} ${fmtIdx(city.idx)}`, onclick: () => onCity(city.city) },
          h('b', {}, city.label),
          h('span', { class: 'cm-read', 'data-l': lvl ?? 'n' }, glyph(lvl), lvl == null ? t('noReading') : [fmtIdx(city.idx), h('span', { class: 'cm-word' }, t('levels')[lvl])]),
        );
        if (!m) {
          m = new maplibregl.Marker({ element: h('div'), anchor: 'bottom', offset: [0, -8] }).setLngLat(city.center).addTo(map);
          cityMarkers.set(city.city, m);
        }
        m.weight = city.cameras || 0;
        m.getElement().replaceChildren(el);
      }
      everything = boundsOf(cameras);
      requestAnimationFrame(toggleMarkers); // after the new markers have their positions
    },
    /** A ring where a camera has just been read. */
    ping(cam) {
      if (reducedMotion() || document.hidden || pings > 10) return;
      if (!map.getBounds().contains([cam.lng, cam.lat])) return;
      const el = h('div', { class: 'ping', 'data-l': cam.status === 'ok' ? cam.level : 'n' }, h('i'));
      const m = new maplibregl.Marker({ element: el }).setLngLat([cam.lng, cam.lat]).addTo(map);
      pings++;
      setTimeout(() => {
        m.remove();
        pings--;
      }, 1250);
    },
    select(id) {
      selected = id;
      if (map.getLayer('cams-sel')) map.setFilter('cams-sel', ['==', ['get', 'id'], id || '']);
    },
    focusCity(cityId, cameras) {
      if (!cityId) {
        map.fitBounds(everything, { padding: pad(), duration: 1100 });
        return;
      }
      const pts = cameras.filter((c) => c.city === cityId);
      if (!pts.length) return;
      const b = new maplibregl.LngLatBounds();
      pts.forEach((c) => b.extend([c.lng, c.lat]));
      map.fitBounds(b, { padding: pad(), maxZoom: 14, duration: 1100 });
    },
    flyTo(cam, shiftX = 0) {
      map.easeTo({ center: [cam.lng, cam.lat], zoom: Math.max(map.getZoom(), 14), offset: [shiftX, 0], duration: 900 });
    },
    resize: () => map.resize(),
  };
}
