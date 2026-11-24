# Arus

Live traffic congestion read from public city CCTV in Indonesia.

Ten Indonesian cities and regencies already publish their traffic cameras for anyone to watch: Jakarta, Bekasi, Kabupaten Tangerang, Bandung, Semarang, Yogyakarta, Magelang, Malang, Palembang and Pekanbaru. Arus watches all of them at once (about 720 cameras), counts the vehicles in each picture, checks whether they are moving, and turns that into one congestion index per camera, per city, over time.

Every reading comes with its evidence: the frame it was made from, with each detected vehicle boxed and marked as moving, stopped, or parked.

## What you see

**Landing page (`/`)**

- A hero of four night roads in long exposure, one for each of the four cities with the most readable cameras. Each road's tail-light side slows and bunches as hard as that city's live congestion index says.
- A reel of the latest frames from the cameras, with the vehicles Arus found in them.
- "How a road is read": one real reading stepped through on scroll (two frames, the boxes, which ones stopped, the index).
- A card per city showing its worst camera right now.
- Search (the button in the header, or `/`): roads, junctions and cities, opening the place on the live map.

**Live map (`/live`)**

- A full-screen map of every camera, coloured by level. Jammed cameras pulse, and a ring marks each camera as it is read.
- City cards along the bottom, in a strip that scrolls sideways: index, cameras by level, a sparkline. They are also the city filter.
- Search for any road, junction or city from the header.
- **Worst right now**: the most congested cameras, re-ranked live.
- **Camera wall**: every camera's latest frame with detections, filterable by level and searchable.
- **Camera detail**: the evidence frame or the live stream, the vehicle mix, how much of it stopped, the index over the last 24 hours, and a typical day by hour.

Updates arrive over server-sent events as each camera is read. English and Bahasa Indonesia, one dark theme.

## How a reading is made

1. `ffmpeg` takes two frames, two seconds apart, from the camera's HLS stream.
2. [D-FINE-S](https://github.com/Peterande/D-FINE) (COCO, Apache-2.0) finds cars, motorcycles, buses and trucks in the second frame, on CPU through `onnxruntime-node` (about 200 ms a frame).
3. Vehicles are weighed in passenger-car units: motorcycle 0.4, car 1, bus/truck 1.3, in the spirit of Indonesia's road-capacity manuals (MKJI/PKJI).
4. That load is compared with the camera's own busy level, the 90th percentile of what it has shown over the last week (a default of 16 until there is history).
5. Each box is compared between the two frames. If its patch of picture did not change beyond the frame's own noise, the vehicle counts as stopped.
6. Vehicles stopped in the same place for three passes in a row are treated as parked or static and left out.

```
index = 100 × min(1, pcu / busy level) × (0.35 + 0.65 × stopped share)
shown = median of the last three passes
```

A full road that keeps moving reads **Busy** (about 35). Only a full road that stays stopped reads **Jammed**. Taking the median of three passes means one red light is not enough to paint a junction red.

| Level  | Index    |
|--------|----------|
| Clear  | under 25 |
| Busy   | 25 – 49  |
| Heavy  | 50 – 71  |
| Jammed | 72 +     |

Cameras whose picture is too blurred to read (fog, rain, a dirty lens; measured as the mean absolute Laplacian of the frame) say **Low visibility** instead of reading Clear. Streams that send the same picture twice say **Feed frozen**.

## Sources

| City | Operator | How it is listed |
|---|---|---|
| Jakarta | Pemprov DKI Jakarta, [CCTV Publik](https://jakcctv.jakarta.go.id/publik) | paged JSON of Flussonic embeds, no coordinates (geocoded from the road name, marked approximate) |
| Bekasi | Pemkot Bekasi, [Pantau CCTV](https://bekasikota.go.id/cctv) | the city site's public API; no coordinates (geocoded from the landmark in the name, marked approximate); played through the relay |
| Kab. Tangerang | [ATCS Dishub Kabupaten Tangerang](https://cctv-dishub.tangerangkab.go.id/) | Livewire map snapshot with coordinates; played through the relay |
| Bandung | [ATCS Dishub Kota Bandung](https://atcs-dishub.bandung.go.id/) | locations with coordinates, cameras per location, HLS per camera |
| Semarang | [Pantau Semar](https://pantausemar.semarangkota.go.id/) | camera array embedded in the page |
| Yogyakarta | [CCTV Kota Yogyakarta](https://cctv.jogjakota.go.id/) | JSON with coordinates; only junction and street categories are used |
| Magelang | [CCTV Kota Magelang](https://cctv.magelangkota.go.id/) | map page with coordinates per camera position |
| Malang | [Portal CCTV Publik Kota Malang](https://cctv.malangkota.go.id/) | Next.js page data with coordinates; media nodes turn away bursts, so three streams at a time |
| Palembang | [CCTV Kota Palembang](https://cctv.palembang.go.id/) | public GeoJSON API |
| Pekanbaru | [Pekanbaru CCTV](https://cctv.pekanbaru.go.id/cam) | page of camera cards, no coordinates (junctions placed where the two named roads meet in OpenStreetMap, marked approximate) |

Parks, car parks, offices and test feeds are left out. Each source can cap how many of its streams are read at once (`meta.concurrency`).

Looked at and left out: Salatiga (its terms forbid recording or redistributing the picture without written permission), Kabupaten Bogor and Medan (their camera API needs a client secret), toll-road CCTV (no public coordinates), Bali Tower's Jakarta feeds (the host did not answer when tested), Denpasar (portal behind maintenance).

`npm run discover` rebuilds `data/cameras.json`; the server also runs it on first start and refreshes it daily.

### Adding a city

Each file in `server/sources/` exports `meta` (`city`, `label`, `operator`, `page`, `center`, optionally `concurrency`) and `discover()`, which returns cameras shaped like:

```js
{ id, city, name, view, area, operator, stream, snapshot, cors: null, lat, lng }
```

A camera without coordinates gives `geo` instead: a list of Nominatim lookups tried in order (a query string, `{ q, box }`, or `{ junction: [roadA, roadB], box }`), and should set `approx: true`. Add the module to `SOURCES` in `server/discover.js` and run `npm run discover`.

Only use cameras the operator publishes for anyone to watch, without a login or a key, and check the site's terms first.

## Running it

Needs Node.js 22.13+ (uses the built-in `node:sqlite`) and `ffmpeg` on the PATH.

```bash
npm install          # also copies browser libs to public/vendor and downloads the model
npm start            # http://127.0.0.1:9985
```

`node scripts/make-demo.js [camera-id]` (with the server running, in daylight) re-shoots the worked example the landing page uses: two frames and their reading, saved to `public/assets/demo/`.

| Variable | Default | |
|---|---|---|
| `ARUS_PORT` | `9985` | |
| `ARUS_HOST` | `127.0.0.1` | |
| `ARUS_CYCLE_MS` | `150000` | a full pass never starts sooner than this |
| `ARUS_GRAB_CONCURRENCY` | `8` | streams read at once |
| `ARUS_THREADS` | `4` | CPU threads for detection |
| `ARUS_SCAN` | `1` | `0` serves the UI without scanning |
| `ARUS_USER_AGENT` | `Mozilla/5.0 (compatible; Arus/0.1)` | sent to camera sites and Nominatim; if you run a public instance, put a contact URL in it as [Nominatim's policy](https://operations.osmfoundation.org/policies/nominatim/) asks |
| `ARUS_MODEL` | `models/dfine_s_coco.onnx` | |
| `FFMPEG` | `ffmpeg` | path to the ffmpeg binary |

A full pass over ~720 cameras takes about four to five minutes on a desktop CPU.

## Layout

```
server/
  index.js        HTTP server, JSON API, server-sent events, HLS relay
  scanner.js      the scan loop: grab -> detect -> analyse -> store -> broadcast
  grab.js         two frames from a live stream with ffmpeg
  detect.js       D-FINE-S on onnxruntime
  analyze.js      car units, stopped share, parked tracking, visibility, index
  db.js           SQLite samples (14 days kept)
  discover.js     builds the camera list from the sources below
  sources/        one module per city
public/           landing page (index.html) and live map (live.html); plain ES modules, MapLibre GL, hls.js
scripts/          vendor copy, model download, landing-page demo builder
```

API: `GET /api/state`, `GET /api/summary`, `GET /api/cameras` (search index), `GET /api/camera/:id`, `GET /api/history?hours=24`, `GET /api/events` (SSE), `GET /frames/:id.jpg`.

## Privacy and manners

- Only cameras the operators publish for the public are read.
- Each pass reads a few seconds of each stream, about what one person glancing at it would use.
- Arus stores vehicle counts per pass and the latest frame per camera. No faces, no plates, no video, no tracking of a vehicle between cameras.
- The HLS relay exists only for streams that do not send CORS headers. It serves only cameras in the list, only paths under that camera's own stream folder (or the folder its source names), and only playlist and media file types.
- The page's Content-Security-Policy lets the browser reach only the map tiles and the stream hosts in the camera list.

## Limits

- Long red lights can hold a queue across two passes and read Heavy or Jammed for a few minutes.
- At night, in rain and in fog fewer vehicles are found.
- The busy level is learned per camera, so the first hours of a new install lean on the default.

## License

Code under the [MIT License](LICENSE). Map data © OpenStreetMap contributors, © CARTO. D-FINE is Apache-2.0, Overpass is SIL OFL 1.1, MapLibre GL is BSD-3-Clause, hls.js is Apache-2.0. Camera imagery, including the two frames in `public/assets/demo/`, belongs to its operators.
