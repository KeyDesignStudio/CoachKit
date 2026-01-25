'use client';

import { useMemo } from 'react';

type LatLng = { lat: number; lng: number };

function decodePolyline(encoded: string, precision = 5): LatLng[] {
  // Google encoded polyline algorithm.
  // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
  const coordinates: LatLng[] = [];
  const factor = Math.pow(10, precision);

  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    const deltaLat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    const deltaLng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }

  return coordinates;
}

function projectMercator(points: LatLng[]) {
  // Project lat/lng into a roughly tile-like plane for nicer aspect ratios.
  return points.map((p) => {
    const latRad = (p.lat * Math.PI) / 180;
    const x = p.lng;
    const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return { x, y };
  });
}

export function PolylineRouteMap({
  polyline,
  height = 160,
}: {
  polyline: string;
  height?: number;
}) {
  const { pathD, start, end } = useMemo(() => {
    try {
      const decoded = decodePolyline(polyline);
      if (!decoded || decoded.length < 2) return { pathD: null as string | null, start: null as any, end: null as any };

      const projected = projectMercator(decoded);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const p of projected) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }

      const pad = 8;
      const width = 320;
      const innerW = width - pad * 2;
      const innerH = height - pad * 2;

      const spanX = Math.max(1e-9, maxX - minX);
      const spanY = Math.max(1e-9, maxY - minY);

      const scale = Math.min(innerW / spanX, innerH / spanY);

      const mapPoint = (p: { x: number; y: number }) => {
        const x = pad + (p.x - minX) * scale;
        // flip Y so north is up
        const y = pad + (maxY - p.y) * scale;
        return { x, y };
      };

      const mapped = projected.map(mapPoint);
      const d = mapped
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(' ');

      return {
        pathD: d,
        start: mapped[0],
        end: mapped[mapped.length - 1],
      };
    } catch {
      return { pathD: null, start: null, end: null };
    }
  }, [polyline, height]);

  if (!pathD) return null;

  const width = 320;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Route map"
        className="block text-sky-600"
      >
        <rect x="0" y="0" width={width} height={height} fill="var(--bg-card)" />
        {/* subtle grid */}
        <g opacity="0.10" stroke="currentColor" strokeWidth="1">
          {Array.from({ length: 7 }).map((_, i) => {
            const x = (width / 6) * i;
            return <line key={`vx-${i}`} x1={x} y1={0} x2={x} y2={height} />;
          })}
          {Array.from({ length: 5 }).map((_, i) => {
            const y = (height / 4) * i;
            return <line key={`hy-${i}`} x1={0} y1={y} x2={width} y2={y} />;
          })}
        </g>

        <path d={pathD} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {start ? <circle cx={start.x} cy={start.y} r="4" fill="currentColor" /> : null}
        {end ? <circle cx={end.x} cy={end.y} r="4" fill="currentColor" opacity="0.55" /> : null}
      </svg>
    </div>
  );
}
