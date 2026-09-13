import type { Coordinate } from '../src/lib/types';

// Mainland GCJ-02 offset, matching the existing geocoder and metro import.
// Amap services require their own coordinates; the Leaflet map uses WGS84.
export function wgs84ToGcj02({ lng, lat }: Coordinate): Coordinate {
  const a = 6378245;
  const ee = 0.006693421622965943;
  const x = lng - 105;
  const y = lat - 35;
  let dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  let dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  const common = ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  dLat += common + ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  dLat += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  dLng += common + ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  dLng += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  const rad = (lat / 180) * Math.PI;
  const magic = 1 - ee * Math.sin(rad) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  return {
    lng: lng + (dLng * 180) / ((a / sqrtMagic) * Math.cos(rad) * Math.PI),
    lat: lat + (dLat * 180) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI),
  };
}

export function gcj02ToWgs84(location: Coordinate): Coordinate {
  const result = { ...location };
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const converted = wgs84ToGcj02(result);
    const deltaLng = converted.lng - location.lng;
    const deltaLat = converted.lat - location.lat;
    result.lng -= deltaLng;
    result.lat -= deltaLat;
    if (Math.max(Math.abs(deltaLng), Math.abs(deltaLat)) < 1e-8) break;
  }
  return result;
}
