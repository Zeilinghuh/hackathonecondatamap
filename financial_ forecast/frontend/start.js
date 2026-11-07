// ===== CONFIG: edit these to match your files =====
const CONFIG = {
  geojson: 'uk_lad_boundaries.geojson', // use the light file, not the 148 MB one
  csv: 'household_wealth.csv',
  geoKey: 'LAD24CD',     // property name in the geojson that identifies a district
  csvKey: 'code',        // column in the csv holding that same identifier
  csvValue: 'wealth',    // column in the csv holding household wealth
  gridHeight: 400,       // grid rows; width is worked out from the UK's shape
  blurRadius: 3,         // smooths the cliffs at district borders
  blurPasses: 2,
};
const SEA = 0.3;

let W, H, base, world, img;
let shocks = [];
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');

// ===== GEOJSON HELPERS =====
function forEachRing(geom, cb) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
              : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) for (const ring of poly) cb(ring);
}

function getBounds(geo) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const f of geo.features)
    forEachRing(f.geometry, ring => {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      }
    });
  return { minLon, maxLon, minLat, maxLat };
}

// ===== CSV =====
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const head = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    head.forEach((h, i) => (row[h] = (cells[i] || '').trim()));
    return row;
  });
}

const norm = s => String(s ?? '').trim().toLowerCase();

async function loadWealth() {
  try {
    const rows = parseCSV(await (await fetch(CONFIG.csv)).text());
    console.log('CSV columns:', Object.keys(rows[0]));
    const m = new Map();
    for (const r of rows) {
      const v = parseFloat(r[CONFIG.csvValue]);
      if (!isNaN(v)) m.set(norm(r[CONFIG.csvKey]), v);
    }
    return m;
  } catch (e) {
    console.warn('Could not load wealth csv, using fake values:', e);
    return null;
  }
}

// ===== BLUR (land only, so the coastline doesn't shrink) =====
function blurPass(src, dst, mask, r, horizontal) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) { dst[i] = 0; continue; }
      let sum = 0, cnt = 0;
      for (let k = -r; k <= r; k++) {
        const xx = horizontal ? x + k : x;
        const yy = horizontal ? y : y + k;
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const j = yy * W + xx;
        if (mask[j]) { sum += src[j]; cnt++; }
      }
      dst[i] = sum / cnt;
    }
}

function blurLand(arr, mask, r, passes) {
  const tmp = new Float32Array(arr.length);
  for (let p = 0; p < passes; p++) {
    blurPass(arr, tmp, mask, r, true);
    blurPass(tmp, arr, mask, r, false);
  }
}

// ===== BUILD THE HEIGHT GRID FROM THE GEOJSON =====
async function loadUK() {
  const geo = await (await fetch(CONFIG.geojson)).json();
  console.log('Example geojson properties:', geo.features[0].properties);

  // 1. bounds and projection (x stretched by cos(lat) so the UK isn't fat)
  const b = getBounds(geo);
  const cosLat = Math.cos(((b.minLat + b.maxLat) / 2) * Math.PI / 180);
  const lonSpan = b.maxLon - b.minLon;
  const latSpan = b.maxLat - b.minLat;
  H = CONFIG.gridHeight;
  W = Math.round(H * (lonSpan * cosLat) / latSpan);
  const project = (lon, lat) => [
    ((lon - b.minLon) / lonSpan) * W,
    ((b.maxLat - lat) / latSpan) * H,   // canvas y runs down, latitude runs up
  ];

  // 2. one wealth value per district, rescaled so the poorest is still above sea level
  const wealth = await loadWealth();
  let missing = 0;
  const raw = geo.features.map((f, idx) => {
    if (!wealth) return Math.abs(Math.sin(idx * 12.9898)) ; // fake but stable
    const v = wealth.get(norm(f.properties[CONFIG.geoKey]));
    if (v === undefined) { missing++; return NaN; }
    return v;
  });
  if (wealth) console.log(`${missing} of ${geo.features.length} districts had no wealth match`);
  const valid = raw.filter(v => !isNaN(v));
  const lo = Math.min(...valid), hi = Math.max(...valid);
  const mean = valid.reduce((a, v) => a + v, 0) / valid.length;
  const heights = raw.map(v => {
    const t = (hi === lo) ? 0.5 : ((isNaN(v) ? mean : v) - lo) / (hi - lo);
    return 0.4 + 0.55 * t;               // land lives in 0.4 .. 0.95
  });

  // 3. draw each district in a grey level on a hidden canvas
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  geo.features.forEach((f, idx) => {
    const g = Math.round(heights[idx] * 255);
    octx.fillStyle = `rgb(${g},${g},${g})`;
    octx.beginPath();
    forEachRing(f.geometry, ring => {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        i === 0 ? octx.moveTo(x, y) : octx.lineTo(x, y);
      });
      octx.closePath();
    });
    octx.fill('evenodd');                // evenodd keeps holes empty
  });

  // 4. read the pixels back into arrays
  const px = octx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    mask[i] = px[i * 4 + 3] > 20 ? 1 : 0;   // alpha > 0 means inside a district
    h[i] = px[i * 4] / 255;
  }
  blurLand(h, mask, CONFIG.blurRadius, CONFIG.blurPasses);

  // 5. fill the baseline: sea = 0, land never dips below sea level after blurring
  base = { height: new Float32Array(W * H), temp: new Float32Array(W * H).fill(0.5) };
  for (let i = 0; i < W * H; i++)
    base.height[i] = mask[i] ? Math.max(h[i], SEA + 0.05) : 0;

  world = {
    height: new Float32Array(W * H),
    temp: new Float32Array(W * H),
    flood: new Float32Array(W * H),
  };

  canvas.width = W;
  canvas.height = H;
  canvas.style.width = '520px';          // height follows automatically
  img = ctx.createImageData(W, H);
}

// ===== SHOCKS =====
const EFFECTS = {
  quake:  (w, i, f) => { w.height[i] -= 0.4 * f; },
  freeze: (w, i, f) => { w.temp[i]   -= 0.6 * f; },
  flood:  (w, i, f) => { w.flood[i] = Math.max(w.flood[i], 0.2 * f); },
};

function update(dt) {
  for (const s of shocks) s.age += dt;
  shocks = shocks.filter(s => s.age < s.duration);

  world.height.set(base.height);
  world.temp.set(base.temp);
  world.flood.fill(0);

  for (const s of shocks) {
    const life = 1 - s.age / s.duration;
    const x0 = Math.max(0, Math.floor(s.x - s.radius)), x1 = Math.min(W - 1, Math.ceil(s.x + s.radius));
    const y0 = Math.max(0, Math.floor(s.y - s.radius)), y1 = Math.min(H - 1, Math.ceil(s.y + s.radius));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d >= s.radius) continue;
        const f = (1 - d / s.radius) ** 2 * life;
        EFFECTS[s.type](world, y * W + x, f);
      }
  }
}

// ===== RENDER =====
const STOPS = [[0.3,[194,178,128]],[0.4,[80,160,70]],[0.6,[40,110,50]],[0.8,[120,110,100]],[1.0,[250,250,250]]];
function ramp(h) {
  for (let k = 1; k < STOPS.length; k++) {
    if (h <= STOPS[k][0] || k === STOPS.length - 1) {
      const [h0, c0] = STOPS[k - 1], [h1, c1] = STOPS[k];
      const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
      return c0.map((v, j) => v + (c1[j] - v) * t);
    }
  }
}

function render() {
  const d = img.data, Ht = world.height;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, hv = Ht[i];
      const dx = Ht[y * W + Math.min(x + 1, W - 1)] - Ht[y * W + Math.max(x - 1, 0)];
      const dy = Ht[Math.min(y + 1, H - 1) * W + x] - Ht[Math.max(y - 1, 0) * W + x];
      const shade = Math.min(1.4, Math.max(0.6, 1 + (dx + dy) * 6));

      let c = (hv < SEA || hv < SEA + world.flood[i]) ? [30, 90, 170] : ramp(hv);

      const cold = Math.max(0, 0.5 - world.temp[i]);
      c = c.map((v, j) => v + ([220, 235, 255][j] - v) * Math.min(1, cold * 1.5));

      const o = i * 4;
      d[o] = c[0] * shade; d[o + 1] = c[1] * shade; d[o + 2] = c[2] * shade; d[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

// ===== INTERACTION =====
canvas.addEventListener('click', e => {
  if (!world) return;
  const r = canvas.getBoundingClientRect();
  shocks.push({
    type: document.getElementById('type').value,
    x: (e.clientX - r.left) / r.width * W,
    y: (e.clientY - r.top) / r.height * H,
    radius: 40, age: 0, duration: 8,
  });
});

// ===== LOOP =====
let last = performance.now();
function frame(now) {
  update((now - last) / 1000);
  last = now;
  render();
  requestAnimationFrame(frame);
}

loadUK().then(() => requestAnimationFrame(frame));