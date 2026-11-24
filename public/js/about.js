import { h, s, glyph } from './util.js';
import { getLang, t } from './i18n.js';


const copy = {
  en: {
    title: 'How Arus reads traffic',
    intro:
      'Cities already publish their traffic cameras for anyone to watch. Arus watches all of them at once, counts the vehicles in each picture, checks whether they are moving, and turns that into one number per camera you can compare across a city.',
    sources: 'Where the pictures come from',
    steps: 'How one reading is made',
    list: [
      'Take two frames, two seconds apart, from the camera’s live stream.',
      'Find every car, motorcycle, bus and truck in the second frame with D-FINE-S, an open object detector running on this machine.',
      'Weigh them in car units (motorcycle 0.4, car 1, bus or truck 1.3), the way Indonesian road-capacity manuals count mixed traffic.',
      'Compare that with this camera’s own busy level: the 90th percentile of what it has shown over the last week.',
      'Check each vehicle against the first frame. If its patch of picture did not change, it counts as stopped.',
      'Vehicles that stay stopped in the same place for three passes in a row are treated as parked and left out.',
    ],
    formula: 'Index = 100 × min(1, car units ÷ busy level) × (0.35 + 0.65 × stopped share), then the middle value of the last three passes.',
    formulaNote: 'A full road that keeps moving reads Busy. Only a full road that stays stopped reads Jammed: one red light stops a queue for one pass, a jam stops it pass after pass.',
    levels: 'Levels',
    ranges: ['under 25', '25 to 49', '50 to 71', '72 and up'],
    limits: 'Where it gets things wrong',
    limitsList: [
      'Long red lights: a queue that is still waiting on two passes in a row can read Heavy or Jammed for a few minutes.',
      'Night, rain and fog: fewer vehicles are found. Cameras that are too blurred say so instead of reading Clear.',
      'Some public lists (Jakarta, Bekasi, Pekanbaru) have no coordinates, so those cameras are placed from the road or junction name and marked approximate.',
    ],
    close: 'Close',
  },
  id: {
    title: 'Cara Arus membaca lalu lintas',
    intro:
      'Pemerintah kota sudah membuka kamera lalu lintasnya untuk umum. Arus menonton semuanya sekaligus, menghitung kendaraan di tiap gambar, memeriksa apakah kendaraan itu bergerak, lalu mengubahnya jadi satu angka per kamera yang bisa dibandingkan se-kota.',
    sources: 'Asal gambar',
    steps: 'Cara satu pembacaan dibuat',
    list: [
      'Ambil dua frame berjarak dua detik dari siaran langsung kamera.',
      'Temukan semua mobil, sepeda motor, bus, dan truk di frame kedua dengan D-FINE-S, detektor objek terbuka yang berjalan di mesin ini.',
      'Hitung dalam satuan mobil (motor 0,4, mobil 1, bus atau truk 1,3), seperti cara pedoman kapasitas jalan Indonesia menghitung lalu lintas campuran.',
      'Bandingkan dengan batas ramai kamera itu sendiri: persentil ke-90 dari yang terlihat selama seminggu terakhir.',
      'Cocokkan tiap kendaraan dengan frame pertama. Jika bagian gambarnya tidak berubah, kendaraan itu dihitung berhenti.',
      'Kendaraan yang berhenti di tempat yang sama tiga putaran berturut-turut dianggap parkir dan tidak dihitung.',
    ],
    formula: 'Indeks = 100 × min(1, satuan mobil ÷ batas ramai) × (0,35 + 0,65 × porsi berhenti), lalu diambil nilai tengah dari tiga putaran terakhir.',
    formulaNote: 'Jalan penuh yang tetap bergerak terbaca Ramai. Hanya jalan penuh yang terus berhenti terbaca Macet: satu lampu merah menghentikan antrean untuk satu putaran, kemacetan menghentikannya putaran demi putaran.',
    levels: 'Tingkat',
    ranges: ['di bawah 25', '25 sampai 49', '50 sampai 71', '72 ke atas'],
    limits: 'Kapan bisa keliru',
    limitsList: [
      'Lampu merah yang lama: antrean yang masih menunggu di dua putaran berturut-turut bisa terbaca Padat atau Macet selama beberapa menit.',
      'Malam, hujan, dan kabut: kendaraan yang ditemukan lebih sedikit. Kamera yang terlalu buram akan bilang begitu, bukan terbaca Lancar.',
      'Beberapa daftar publik (Jakarta, Bekasi, Pekanbaru) tidak punya koordinat, jadi kameranya ditempatkan dari nama jalan atau simpang dan ditandai perkiraan.',
    ],
    close: 'Tutup',
  },
};

/** cities: the server city list, with label, operator and page for each source. */
export function renderAbout(dialog, cities = []) {
  const c = copy[getLang()];
  const lv = t('levels');
  dialog.replaceChildren(
    h(
      'div',
      { class: 'about-in' },
      h(
        'header',
        {},
        h('h2', { id: 'about-h' }, c.title),
        h('button', { class: 'd-close', type: 'button', 'aria-label': c.close, onclick: () => dialog.close() }, s('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }, s('path', { d: 'M6 6l12 12M18 6 6 18', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }))),
      ),
      h('p', {}, c.intro),
      h('section', {}, h('h3', {}, c.steps), h('ol', {}, c.list.map((x) => h('li', {}, x)))),
      h('p', { class: 'formula' }, c.formula),
      h('p', {}, c.formulaNote),
      h(
        'section',
        {},
        h('h3', {}, c.levels),
        h(
          'div',
          { class: 'levels-key' },
          lv.map((name, i) => h('div', { 'data-l': i }, h('b', {}, glyph(i), name), c.ranges[i])),
        ),
      ),
      h(
        'section',
        {},
        h('h3', {}, c.sources),
        h('ul', { class: 'about-sources' }, cities.map((x) => h('li', {}, h('b', {}, x.label), ' ', h('a', { href: x.page, target: '_blank', rel: 'noopener noreferrer' }, x.operator)))),
      ),
      h('section', {}, h('h3', {}, c.limits), h('ul', {}, c.limitsList.map((x) => h('li', {}, x)))),
    ),
  );
}
