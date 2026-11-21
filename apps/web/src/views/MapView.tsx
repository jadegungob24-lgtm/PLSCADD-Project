import { useEffect, useRef, useState } from 'react';
import {
  LngLatBounds, Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification,
} from 'maplibre-gl';
// The library locates its worker relative to its own file, which does not survive bundling;
// have the bundler build the worker and hand its URL to the library.
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { makeTransformer, WGS84_GEOGRAPHIC } from '@tlcad/engine';
import { useApp } from '../store/appStore';
import { useDerived } from '../store/derived';

/**
 * Map view: the alignments, P.I.s and a sample of the survey points drawn over
 * an OpenStreetMap basemap. It needs the project coordinate system, which is
 * used to convert plan coordinates to longitude and latitude, and an internet
 * connection for the basemap tiles. This view is for orientation only; the
 * Plan view is the working view and does not depend on a network.
 */

const MAX_MAP_POINTS = 5000;

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

setWorkerUrl(mapWorkerUrl);

type FC = FeatureCollection;
const empty: FC = { type: 'FeatureCollection', features: [] };

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const crs = useApp((s) => s.project?.settings.crs ?? null);
  const fitSignal = useApp((s) => s.fitSignal);
  const openDialog = useApp((s) => s.openDialog);
  const d = useDerived();
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const latest = useRef({ d, crs });
  latest.current = { d, crs };

  const update = (fit: boolean) => {
    const m = map.current;
    const { d: dd, crs: c } = latest.current;
    if (!m || !ready.current || !c) return;
    let t;
    try { t = makeTransformer(c.definition, WGS84_GEOGRAPHIC); } catch (e) { setNote(`Coordinate system error: ${e instanceof Error ? e.message : String(e)}`); return; }
    const bounds = new LngLatBounds();
    let bad = 0;
    const ll = (x: number, y: number): [number, number] | null => {
      try {
        const [lon, lat] = t.forward(x, y);
        if (Math.abs(lat) > 85 || Math.abs(lon) > 180) { bad++; return null; }
        bounds.extend([lon, lat]);
        return [lon, lat];
      } catch { bad++; return null; }
    };
    const lines: FC = { type: 'FeatureCollection', features: [] };
    const pis: FC = { type: 'FeatureCollection', features: [] };
    dd.lines.forEach((l, li) => {
      const coords = l.alignment.pis.map((p) => ll(p.x, p.y)).filter((q): q is [number, number] => q !== null);
      if (coords.length > 1) lines.features.push({ type: 'Feature', properties: { active: li === dd.active }, geometry: { type: 'LineString', coordinates: coords } });
      coords.forEach((q, i) => pis.features.push({ type: 'Feature', properties: { label: `${dd.lines.length > 1 ? `A${li + 1} ` : ''}PI ${i + 1}` }, geometry: { type: 'Point', coordinates: q } }));
    });
    const stride = Math.max(1, Math.ceil(dd.points.length / MAX_MAP_POINTS));
    const pts: FC = { type: 'FeatureCollection', features: [] };
    for (let i = 0; i < dd.points.length; i += stride) {
      const p = dd.points[i]!;
      const q = ll(p.x, p.y);
      if (q) pts.features.push({ type: 'Feature', properties: { color: dd.codes.get(p.code)?.color ?? '#7fd08a' }, geometry: { type: 'Point', coordinates: q } });
    }
    (m.getSource('lines') as GeoJSONSource).setData(lines);
    (m.getSource('pis') as GeoJSONSource).setData(pis);
    (m.getSource('pts') as GeoJSONSource).setData(pts);
    setNote(
      `${c.name}` + (stride > 1 ? ` · showing every ${stride}th survey point` : '') +
      (bad ? ` · ${bad} coordinate(s) fall outside the valid area of the coordinate system — check that it is the right one` : ''),
    );
    if (fit && !bounds.isEmpty()) m.fitBounds(bounds, { padding: 50, maxZoom: 17, duration: 0 });
  };

  useEffect(() => {
    const el = host.current;
    if (!el || !crs) return;
    let m: MlMap;
    try {
      m = new MlMap({ container: el, style: STYLE, center: [0, 0], zoom: 1, attributionControl: { compact: true } });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The map could not be started.');
      return;
    }
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.on('load', () => {
      m.addSource('pts', { type: 'geojson', data: empty });
      m.addSource('lines', { type: 'geojson', data: empty });
      m.addSource('pis', { type: 'geojson', data: empty });
      m.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-radius': 2.5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#10161c', 'circle-stroke-width': 0.5 } });
      m.addLayer({ id: 'lines-halo', type: 'line', source: 'lines', paint: { 'line-color': '#10161c', 'line-width': 5 } });
      m.addLayer({ id: 'lines', type: 'line', source: 'lines', paint: { 'line-color': ['case', ['get', 'active'], '#f2d14b', '#c2ad55'], 'line-width': 3 } });
      m.addLayer({ id: 'pis', type: 'circle', source: 'pis', paint: { 'circle-radius': 5, 'circle-color': '#14181d', 'circle-stroke-color': '#f2d14b', 'circle-stroke-width': 2 } });
      ready.current = true;
      update(true);
    });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el);
    return () => { ro.disconnect(); ready.current = false; map.current = null; m.remove(); };
  }, [crs === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { update(false); }, [d, crs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { update(true); }, [fitSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!crs) {
    return (
      <div className="placeholder">
        <div className="box">
          <h3>The map needs a coordinate system</h3>
          The map places the project on the earth using the project coordinate system, which is not defined yet.
          <div style={{ marginTop: 10 }}>
            <button className="link-btn" style={{ color: '#8fb8ee' }} onClick={() => openDialog('crs')}>Define the coordinate system</button>
          </div>
        </div>
      </div>
    );
  }
  if (failed) return <div className="placeholder"><div className="box"><h3>Map unavailable</h3>{failed}</div></div>;
  return (
    <>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div className="view-top" style={{ left: 10, right: 50, color: '#1c2228', textShadow: '0 0 3px #fff, 0 0 3px #fff' }}>
        <div className="view-hint">{note} · basemap needs an internet connection</div>
      </div>
    </>
  );
}
