'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';

type LatLng = { lat: number; lng: number };

function decodePolyline(encoded: string, precision = 5): LatLng[] {
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
  return points.map((p) => {
    const latRad = (p.lat * Math.PI) / 180;
    const x = p.lng;
    const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return { x, y };
  });
}

function SvgFallback({ points, height }: { points: LatLng[]; height: number }) {
  const { pathD, start, end } = useMemo(() => {
    if (!points.length || points.length < 2) return { pathD: null as string | null, start: null as any, end: null as any };

    const projected = projectMercator(points);
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

    const mapPoint = (p: { x: number; y: number }) => ({
      x: pad + (p.x - minX) * scale,
      y: pad + (maxY - p.y) * scale,
    });

    const mapped = projected.map(mapPoint);
    const d = mapped.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

    return {
      pathD: d,
      start: mapped[0],
      end: mapped[mapped.length - 1],
    };
  }, [height, points]);

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
        <g opacity="0.1" stroke="currentColor" strokeWidth="1">
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

export function PolylineRouteMap({
  polyline,
  height = 220,
}: {
  polyline: string;
  height?: number;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<LeafletMap | null>(null);
  const [renderMode, setRenderMode] = useState<'leaflet' | 'fallback'>('leaflet');

  const decodedPoints = useMemo(() => {
    try {
      return decodePolyline(polyline);
    } catch {
      return [];
    }
  }, [polyline]);

  useEffect(() => {
    if (!mapRef.current || decodedPoints.length < 2 || renderMode !== 'leaflet') return;

    let cancelled = false;

    async function mount() {
      try {
        const L = await import('leaflet');
        if (cancelled || !mapRef.current) return;

        const map = L.map(mapRef.current, {
          zoomControl: false,
          attributionControl: true,
          scrollWheelZoom: false,
          dragging: true,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
        });

        leafletMapRef.current = map;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(map);

        const latLngs = decodedPoints.map((point) => [point.lat, point.lng] as [number, number]);
        const route = L.polyline(latLngs, {
          color: '#0ea5e9',
          weight: 4,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);

        const start = latLngs[0];
        const end = latLngs[latLngs.length - 1];

        if (start) {
          L.circleMarker(start, {
            radius: 6,
            color: '#082f49',
            weight: 2,
            fillColor: '#38bdf8',
            fillOpacity: 1,
          }).addTo(map);
        }

        if (end) {
          L.circleMarker(end, {
            radius: 6,
            color: '#7f1d1d',
            weight: 2,
            fillColor: '#fb7185',
            fillOpacity: 0.95,
          }).addTo(map);
        }

        map.fitBounds(route.getBounds(), { padding: [18, 18] });
      } catch {
        if (!cancelled) {
          setRenderMode('fallback');
        }
      }
    }

    void mount();

    return () => {
      cancelled = true;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [decodedPoints, renderMode]);

  if (decodedPoints.length < 2) return null;

  if (renderMode === 'fallback') {
    return <SvgFallback points={decodedPoints} height={height} />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <div
        ref={mapRef}
        className="leaflet-route-map"
        style={{ height }}
        role="img"
        aria-label="Route map"
      />
    </div>
  );
}
