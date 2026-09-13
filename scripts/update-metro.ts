/** Run `bun run scripts/update-metro.ts` to refresh the checked-in Amap network snapshot. */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Coordinate, MetroLine, MetroStation } from '../src/lib/types';

const SOURCE = 'https://map.amap.com/service/subway?_1469083453978&srhdata=4403_drw_shenzhen.json';
const earthRadius = 6378245;
const eccentricity = 0.006693421622965943;

// Amap's GCJ-02 coordinates must be converted before drawing on a WGS84/OSM map.
function toGcj02(point: Coordinate): Coordinate {
  const x = point.lng - 105;
  const y = point.lat - 35;
  let latOffset = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  latOffset += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  latOffset += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  latOffset += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  let lngOffset = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  lngOffset += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  lngOffset += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  lngOffset += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  const latitudeRadians = (point.lat / 180) * Math.PI;
  const magic = 1 - eccentricity * Math.sin(latitudeRadians) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  return {
    lat:
      point.lat +
      (latOffset * 180) / (((earthRadius * (1 - eccentricity)) / (magic * sqrtMagic)) * Math.PI),
    lng:
      point.lng +
      (lngOffset * 180) / ((earthRadius / sqrtMagic) * Math.cos(latitudeRadians) * Math.PI),
  };
}

function gcj02ToWgs84(point: Coordinate): Coordinate {
  const guess = { ...point };
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const converted = toGcj02(guess);
    guess.lng -= converted.lng - point.lng;
    guess.lat -= converted.lat - point.lat;
  }
  return { lng: Number(guess.lng.toFixed(6)), lat: Number(guess.lat.toFixed(6)) };
}

type AmapStation = { n: string; sl: string };
type AmapLine = { ln: string; ls: string; cl: string; lo: string; st: AmapStation[] };
const response = await fetch(SOURCE, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`Amap snapshot fetch failed: ${response.status}`);
const payload = (await response.json()) as { s: string; l: AmapLine[] };
if (!Array.isArray(payload.l) || !payload.s.includes('深圳'))
  throw new Error('Unexpected Amap city/network payload');

const stations = new Map<string, MetroStation>();
const lines: MetroLine[] = [];
for (const input of payload.l) {
  // Yunba is a separate guided transit system, excluded from a metro-only planner.
  if (input.ln.includes('云巴')) continue;
  const lineNumber = input.ln.match(/^(\d+)号线/)?.[1];
  if (!lineNumber || input.st.length < 2) throw new Error(`Unexpected metro line ${input.ln}`);
  const lineId = input.ln.includes('支线') ? `${lineNumber}-branch` : lineNumber;
  const line: MetroLine = {
    id: lineId,
    name: input.ln.startsWith('2号线/8')
      ? '2 / 8 号线'
      : input.ln.includes('支线')
        ? '6 号线支线'
        : `${lineNumber} 号线`,
    color: `#${input.cl}`,
    stationIds: [],
  };
  for (const stop of input.st) {
    const name = stop.n.trim();
    const [lng, lat] = stop.sl.split(',').map(Number);
    if (
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      lng! < 113 ||
      lng! > 115 ||
      lat! < 22 ||
      lat! > 24
    ) {
      throw new Error(`Invalid Shenzhen coordinate at ${name}`);
    }
    const id = `station-${name}`;
    const station = stations.get(id) ?? {
      id,
      name,
      location: gcj02ToWgs84({ lng: lng!, lat: lat! }),
      lineIds: [],
    };
    if (!station.lineIds.includes(lineId)) station.lineIds.push(lineId);
    stations.set(id, station);
    if (line.stationIds.at(-1) !== id) line.stationIds.push(id);
  }
  if (input.lo === '1' && line.stationIds.at(-1) !== line.stationIds[0])
    line.stationIds.push(line.stationIds[0]!);
  lines.push(line);
}
if (lines.length < 12 || stations.size < 250)
  throw new Error('Incomplete network: refusing to replace local snapshot');
const targetDirectory = fileURLToPath(new URL('../src/lib/data/', import.meta.url));
await mkdir(targetDirectory, { recursive: true });
const output = {
  source: SOURCE,
  fetchedAt: new Date().toISOString(),
  sourceCoordinateSystem: 'GCJ-02',
  coordinateSystem: 'WGS84',
  notes:
    '高德公开地铁图数据快照；不含坪山云巴。线路及车站以抓取结果为准，不代表实时运营状态。站间连线为示意，非轨道精确线形。',
  stations: [...stations.values()],
  lines,
};
await Bun.write(
  new URL('../src/lib/data/metro.json', import.meta.url),
  JSON.stringify(output, null, 2) + '\n',
);
console.log(`Saved ${stations.size} stations / ${lines.length} lines; ${output.fetchedAt}`);
