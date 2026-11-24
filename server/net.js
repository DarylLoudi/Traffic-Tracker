import { config } from './config.js';

/** fetch with a timeout and our user agent. Throws on non-2xx. */
export async function get(url, { timeoutMs = 20_000, headers = {}, method = 'GET', body } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      body,
      headers: { 'user-agent': config.userAgent, accept: '*/*', ...headers },
      signal: ctl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

export const getText = async (url, opts) => (await get(url, opts)).text();
export const getJson = async (url, opts) => (await get(url, opts)).json();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn over items with at most n in flight. Results keep input order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** "JL. GATOT SUBROTO" -> "Jl. Gatot Subroto" (keeps short acronyms upper case). */
export function titleCase(s) {
  const keep = new Set(['JPO', 'UOB', 'MH', 'KH', 'RS', 'SMP', 'SMA', 'SD', 'PKK', 'DPRD', 'TV', 'ATCS', 'PTZ', 'RTHP', 'BI', 'II', 'III', 'IV', 'HM', 'RA', 'RSJ', 'RSUD', 'PSC', 'SMPN', 'SMAN', 'SMK', 'SMKN', 'SDN', 'BNI', 'BRI', 'BCA', 'CPM', 'GOR', 'MPP', 'SKA', 'LW', 'MTQ', 'FTL', 'KFC', 'PT', 'IP', 'KM', 'UB', 'UKSW', 'BTN', 'SPBU', 'PLN', 'KPU', 'TNI', 'ITC', 'BSD']);
  return String(s)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => {
      const bare = w.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (keep.has(bare)) return w.toUpperCase();
      return w.toLowerCase().replace(/(^|[.(\-/])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join(' ')
    .replace(/\bJl\b\.?/g, 'Jl.')
    .replace(/\bJln\b\.?/gi, 'Jl.');
}
