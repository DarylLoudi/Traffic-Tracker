// The hero: four roads at night, long exposure. Warm headlights run one way,
// red tail-lights the other. On each road the tail-light side slows and bunches
// at one spot, as hard as the live congestion index of the city on that road says.
// Roads are numbered 0-3; the page decides which city each one stands for.

const ROADS = [
  { city: 0, p: [[0.3, -0.1], [0.48, 0.3], [0.8, 0.2], [1.1, 0.44]], jamAt: 0.5 },
  { city: 1, p: [[1.1, 0.0], [0.74, 0.3], [0.76, 0.74], [0.42, 1.12]], jamAt: 0.47 },
  { city: 2, p: [[0.56, -0.1], [0.54, 0.44], [0.98, 0.56], [0.93, 1.12]], jamAt: 0.63 },
  { city: 3, p: [[0.9, -0.1], [1.03, 0.34], [0.56, 0.54], [0.67, 1.12]], jamAt: 0.3 },
];
// Portrait screens get a different drawing so the roads still cross the picture.
const ROADS_TALL = [
  { city: 0, p: [[-0.1, 0.09], [0.4, 0.13], [0.6, 0.04], [1.1, 0.11]], jamAt: 0.3 },
  { city: 1, p: [[1.1, 0.03], [0.5, 0.1], [0.9, 0.24], [0.3, 0.36]], jamAt: 0.5 },
  { city: 2, p: [[0.2, -0.05], [0.1, 0.18], [0.9, 0.18], [1.1, 0.31]], jamAt: 0.6 },
  { city: 3, p: [[-0.1, 0.25], [0.4, 0.27], [0.5, 0.13], [1.1, 0.24]], jamAt: 0.25 },
];

const TAIL = '255, 52, 40';
const HEAD = '255, 232, 196';

function bezier(p, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

export function createFlow(roadCanvas, trailCanvas, { onLayout = () => {} } = {}) {
  const rc = roadCanvas.getContext('2d');
  const tc = trailCanvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let roads = [];
  let jam = {};
  let raf = 0;
  let last = 0;
  let visible = true;

  function build() {
    const box = trailCanvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(box.width * dpr));
    H = Math.max(1, Math.round(box.height * dpr));
    for (const c of [roadCanvas, trailCanvas]) {
      c.width = W;
      c.height = H;
    }
    const defs = W / H < 0.8 ? ROADS_TALL.map((d) => ({ ...d, p: d.p.map(([x, y]) => [x, y * 0.8]) })) : ROADS;
    const laneW = Math.max(4 * dpr, Math.min(W, H) * 0.0085);
    const step = 3 * dpr;
    const rand = mulberry(7);

    roads = defs.map((def) => {
      // Sample the curve, then resample to even spacing so speed is in pixels.
      const raw = [];
      for (let i = 0; i <= 300; i++) {
        const [x, y] = bezier(def.p, i / 300);
        raw.push([x * W, y * H]);
      }
      const cum = [0];
      for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
      const L = cum[cum.length - 1];
      const n = Math.floor(L / step);
      const pts = new Float32Array((n + 1) * 2);
      const nrm = new Float32Array((n + 1) * 2);
      let j = 1;
      for (let i = 0; i <= n; i++) {
        const d = i * step;
        while (j < cum.length - 1 && cum[j] < d) j++;
        const k = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
        const x = raw[j - 1][0] + (raw[j][0] - raw[j - 1][0]) * k;
        const y = raw[j - 1][1] + (raw[j][1] - raw[j - 1][1]) * k;
        const tx = raw[j][0] - raw[j - 1][0];
        const ty = raw[j][1] - raw[j - 1][1];
        const tl = Math.hypot(tx, ty) || 1;
        pts[i * 2] = x;
        pts[i * 2 + 1] = y;
        nrm[i * 2] = -ty / tl;
        nrm[i * 2 + 1] = tx / tl;
      }
      const lanes = [];
      for (const k of [-3, -2, -1, 1, 2, 3]) {
        const off = (k > 0 ? k - 0.5 + 0.55 : k + 0.5 - 0.55) * laneW;
        const dir = k > 0 ? 1 : -1;
        const count = Math.round(L / (laneW * (dir > 0 ? 6 : 8.5)));
        const cars = [];
        for (let c = 0; c < count; c++) cars.push({ s: rand() * L, v: 0.82 + rand() * 0.36, x: NaN, y: NaN });
        lanes.push({ off, dir, cars, speed: 1 - Math.abs(Math.abs(k) - 2) * 0.1 });
      }
      return { ...def, pts, nrm, n, L, lanes, laneW, step, s0: def.jamAt * L, sigma: L * 0.085 };
    });

    drawRoads();
    tc.clearRect(0, 0, W, H);
    // Settle into steady state so the jam is already there on the first frame.
    for (let i = 0; i < 700; i++) advance(1 / 30, false);
    if (still) for (let i = 0; i < 46; i++) advance(1 / 60, true);
    onLayout(
      roads.map((r) => {
        const i = Math.round(r.s0 / r.step);
        // Tag sits beside the road, on the tail-light side.
        return { city: r.city, x: (r.pts[i * 2] + r.nrm[i * 2] * r.laneW * 7) / W, y: (r.pts[i * 2 + 1] + r.nrm[i * 2 + 1] * r.laneW * 7) / H };
      }),
    );
  }

  function drawRoads() {
    rc.clearRect(0, 0, W, H);
    rc.lineCap = 'butt';
    for (const r of roads) {
      const path = new Path2D();
      path.moveTo(r.pts[0], r.pts[1]);
      for (let i = 1; i <= r.n; i++) path.lineTo(r.pts[i * 2], r.pts[i * 2 + 1]);
      // casing so a road reads as passing over the ones drawn before it
      rc.strokeStyle = '#101316';
      rc.lineWidth = r.laneW * 9.4;
      rc.stroke(path);
      rc.strokeStyle = '#171b1f';
      rc.lineWidth = r.laneW * 8.2;
      rc.stroke(path);
      rc.strokeStyle = 'rgba(255,255,255,0.05)';
      rc.lineWidth = Math.max(1, r.laneW * 0.16);
      for (const side of [-1, 1]) {
        const edge = new Path2D();
        for (let i = 0; i <= r.n; i++) {
          const x = r.pts[i * 2] + r.nrm[i * 2] * r.laneW * 4.1 * side;
          const y = r.pts[i * 2 + 1] + r.nrm[i * 2 + 1] * r.laneW * 4.1 * side;
          if (i) edge.lineTo(x, y);
          else edge.moveTo(x, y);
        }
        rc.stroke(edge);
      }
    }
  }

  const at = (r, lane, s, out) => {
    const f = Math.min(r.n - 1, Math.max(0, s / r.step));
    const i = Math.floor(f);
    const k = f - i;
    const a = i * 2;
    const x = r.pts[a] + (r.pts[a + 2] - r.pts[a]) * k;
    const y = r.pts[a + 1] + (r.pts[a + 3] - r.pts[a + 1]) * k;
    out[0] = x + r.nrm[a] * lane.off;
    out[1] = y + r.nrm[a + 1] * lane.off;
  };

  const pos = [0, 0];
  function advance(dt, draw) {
    const vfree = Math.max(W, H) * 0.13;
    const tail = draw ? new Path2D() : null;
    const head = draw ? new Path2D() : null;
    for (const r of roads) {
      const idx = jam[r.city];
      const depth = idx == null ? 0.6 : Math.min(0.955, Math.max(0.3, 0.3 + (idx / 100) * 0.82));
      for (const lane of r.lanes) {
        const path = lane.dir > 0 ? tail : head;
        for (const car of lane.cars) {
          let slow = 1;
          if (lane.dir > 0) {
            const d = (car.s - r.s0) / r.sigma;
            slow = 1 - depth * Math.exp(-0.5 * d * d);
          }
          const ds = vfree * lane.speed * car.v * slow * dt * lane.dir;
          let s = car.s + ds;
          let wrapped = false;
          if (s > r.L) {
            s -= r.L;
            wrapped = true;
          } else if (s < 0) {
            s += r.L;
            wrapped = true;
          }
          car.s = s;
          at(r, lane, s, pos);
          if (draw && !wrapped && !Number.isNaN(car.x)) {
            path.moveTo(car.x, car.y);
            path.lineTo(pos[0], pos[1]);
          }
          car.x = pos[0];
          car.y = pos[1];
        }
      }
    }
    if (!draw) return;
    const lw = roads[0].laneW;
    tc.globalCompositeOperation = 'destination-out';
    tc.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / 0.42)})`;
    tc.fillRect(0, 0, W, H);
    tc.globalCompositeOperation = 'lighter';
    tc.lineCap = 'round';
    for (const [path, rgb] of [[tail, TAIL], [head, HEAD]]) {
      tc.strokeStyle = `rgba(${rgb}, 0.1)`;
      tc.lineWidth = lw * 1.9;
      tc.stroke(path);
      tc.strokeStyle = `rgba(${rgb}, 0.62)`;
      tc.lineWidth = lw * 0.42;
      tc.stroke(path);
    }
  }

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    advance(dt, true);
    raf = requestAnimationFrame(frame);
  }
  const start = () => {
    if (still || raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  let resizeT;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const b = trailCanvas.getBoundingClientRect();
      if (Math.round(b.width * dpr) === W && Math.round(b.height * dpr) === H) return;
      build();
      start();
    }, 150);
  });
  ro.observe(trailCanvas);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) start();
  }).observe(trailCanvas);
  document.addEventListener('visibilitychange', start);

  build();
  start();

  return {
    /** indexByRoad: { 0: 41, 1: 18, ... } */
    setJam(indexByRoad) {
      jam = { ...indexByRoad };
      if (still) build();
    },
  };
}

function mulberry(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
