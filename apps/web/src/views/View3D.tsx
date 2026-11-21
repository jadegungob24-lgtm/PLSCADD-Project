import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fromSI, stationToXY, unitLabel, type UnitSystem } from '@tlcad/engine';
import { useApp } from '../store/appStore';
import { useDerived, type DerivedView } from '../store/derived';
import type { BreakLine } from '@tlcad/model';
import { niceStep } from './viewport2d';

/**
 * 3D workspace (Z up): survey points, the TIN ground surface coloured by
 * elevation, and the alignment draped on the centerline ground profile.
 * Coordinates are shifted to a local origin so that large projected
 * coordinates (e.g. UTM northings) keep full precision in single-precision
 * GPU buffers.
 */
const NO_BREAK_LINES: BreakLine[] = [];

export function View3D() {
  const host = useRef<HTMLDivElement>(null);
  const project = useApp((s) => s.project);
  const fitSignal = useApp((s) => s.fitSignal);
  const d = useDerived();
  const [info, setInfo] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const api = useRef<{ rebuild: (fit: boolean) => void } | null>(null);
  const sys: UnitSystem = project?.settings.unitSystem ?? 'SI_N';
  const breakLines = project?.terrain.breakLines ?? NO_BREAK_LINES;
  const data = useRef<{ d: DerivedView; sys: UnitSystem; breakLines: BreakLine[] }>({ d, sys, breakLines });
  data.current = { d, sys, breakLines };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'WebGL is not available.');
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14181d);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;

    const content = new THREE.Group();
    scene.add(content);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);

    const clear = () => {
      for (const child of [...content.children]) {
        content.remove(child);
        const o = child as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach((m) => m.dispose());
      }
    };

    const rebuild = (fit: boolean) => {
      clear();
      const dd = data.current.d;
      const pts = dd.points;
      const box = new THREE.Box3();
      for (const p of pts) box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z + p.h));
      for (const ln of dd.lines) for (const p of ln.alignment.pis) box.expandByPoint(new THREE.Vector3(p.x, p.y, box.isEmpty() ? 0 : box.min.z));
      for (const b of data.current.breakLines) { box.expandByPoint(new THREE.Vector3(b.ax, b.ay, b.az)); box.expandByPoint(new THREE.Vector3(b.bx, b.by, b.bz)); }
      for (const sd of dd.model.structures) {
        if (sd.frame && sd.topZ !== null) box.expandByPoint(new THREE.Vector3(sd.frame.baseX, sd.frame.baseY, sd.topZ));
      }
      const has = !box.isEmpty();
      const origin = has ? new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z) : new THREE.Vector3();
      const zRange = has ? Math.max(box.max.z - box.min.z, 1e-9) : 1;

      if (pts.length > 0) {
        const arr = new Float32Array(pts.length * 3);
        const col = new Float32Array(pts.length * 3);
        const c = new THREE.Color();
        pts.forEach((p, i) => {
          arr[i * 3] = p.x - origin.x; arr[i * 3 + 1] = p.y - origin.y; arr[i * 3 + 2] = p.z + p.h - origin.z;
          c.set(dd.codes.get(p.code)?.color ?? '#7fd08a');
          col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        content.add(new THREE.Points(g, new THREE.PointsMaterial({ vertexColors: true, size: 3, sizeAttenuation: false })));
      }

      if (dd.tin) {
        const tv = dd.tin.vertices;
        const n = tv.length / 3;
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const c = new THREE.Color();
        for (let i = 0; i < n; i++) {
          pos[i * 3] = tv[i * 3]! - origin.x; pos[i * 3 + 1] = tv[i * 3 + 1]! - origin.y; pos[i * 3 + 2] = tv[i * 3 + 2]! - origin.z;
          // Elevation tint from low (green) to high (brown).
          c.setHSL(0.33 - 0.25 * ((tv[i * 3 + 2]! - origin.z) / zRange), 0.45, 0.32);
          col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setIndex(new THREE.BufferAttribute(dd.tin.triangles, 1));
        content.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        })));
        // Triangle outlines are skipped on very large TINs, where they are slow to build and merge into a solid colour.
        if (dd.tin.triangles.length / 3 <= 100_000) {
          content.add(new THREE.LineSegments(new THREE.WireframeGeometry(g), new THREE.LineBasicMaterial({ color: 0x0f1a12 })));
        }
      }

      dd.lines.forEach((ln, li) => {
        if (!ln.geom) return;
        // Drape the alignment on the centerline profile where one exists; otherwise draw it at the base elevation.
        const line: number[] = [];
        if (ln.centerline.length > 1) {
          for (const v of ln.centerline) {
            const p = stationToXY(ln.geom, v.station, 0);
            line.push(p.x - origin.x, p.y - origin.y, v.z - origin.z);
          }
        } else {
          for (const p of ln.alignment.pis) line.push(p.x - origin.x, p.y - origin.y, 0);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(line), 3));
        content.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: li === dd.active ? 0xf2d14b : 0x9c8a45, depthTest: false })));
      });

      // Structures as stick figures (axis, arms to attachment points, insulators) and wires as sagged catenaries (dashed straight chords where not sagged).
      const model = dd.model;
      const sticks: number[] = [];
      const o = (p: { x: number; y: number; z: number }) => [p.x - origin.x, p.y - origin.y, p.z - origin.z];
      for (const sd of model.structures) {
        if (!sd.frame || sd.baseZ === null || sd.topZ === null) continue;
        const base = { x: sd.frame.baseX, y: sd.frame.baseY };
        sticks.push(...o({ ...base, z: sd.baseZ }), ...o({ ...base, z: sd.topZ }));
        for (const q of sd.points) {
          sticks.push(...o({ ...base, z: q.top.z }), ...o(q.top));
          if (q.wire && q.wire !== q.top) sticks.push(...o(q.top), ...o(q.wire));
        }
      }
      if (sticks.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sticks), 3));
        content.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9d2db })));
      }
      for (const sec of model.sections) {
        const shape = dd.analysis.sections.get(sec.section.id)?.shape;
        for (const ph of shape?.plan ?? sec.wires) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ph.flatMap(o)), 3));
          const color = sec.cable?.color ?? '#e05d4f';
          const line = new THREE.Line(g, shape ? new THREE.LineBasicMaterial({ color }) : new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 2 }));
          line.computeLineDistances();
          content.add(line);
        }
      }

      // Clearance markers (§11.2.3): a line between the closest points, or a short vertical tick at a point.
      for (const mk of useApp.getState().markers) {
        const col = mk.status === 'violation' ? 0xff5c4d : mk.status === 'questionable' ? 0x4f8ff7 : 0x5bc06b;
        const b = mk.b ?? { ...mk.a, z: mk.a.z + 3 };
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...o(mk.a), ...o(b)]), 3));
        content.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, depthTest: false })));
      }

      const brk = data.current.breakLines;
      if (brk.length > 0) {
        const arr = new Float32Array(brk.length * 6);
        brk.forEach((b, i) => {
          arr.set([b.ax - origin.x, b.ay - origin.y, b.az - origin.z, b.bx - origin.x, b.by - origin.y, b.bz - origin.z], i * 6);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        content.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3fbf6a, depthTest: false })));
      }

      const radius = has ? Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10) : 500;
      // Reference grid on the XY plane at the lowest elevation, cell size a round number of display units.
      const f = fromSI(1, data.current.sys, 'length'); // display units per metre
      const cellDisp = niceStep(1 / ((radius * 2 * f) / 12), 1);
      const cell = cellDisp / f;
      const half = Math.ceil((radius * 1.5) / cell) * cell;
      const grid = new THREE.GridHelper(half * 2, Math.round((half * 2) / cell), 0x4b5967, 0x27303a);
      grid.rotation.x = Math.PI / 2;
      content.add(grid);
      content.add(new THREE.AxesHelper(cell * 2));
      setInfo(`Z up · grid ${cellDisp} ${unitLabel(data.current.sys, 'length')}` +
        (pts.length ? ` · ${pts.length} pts` : '') + (dd.tin ? ` · TIN ${dd.tin.triangles.length / 3} tri` : ''));

      if (fit) {
        const h = has ? (box.max.z - box.min.z) / 2 : 0;
        controls.target.set(0, 0, h);
        camera.position.set(-radius * 1.1, -radius * 1.5, h + radius * 1.0);
        camera.near = Math.max(radius / 1000, 0.01);
        camera.far = radius * 200;
        camera.updateProjectionMatrix();
        controls.update();
      }
      render();
    };
    api.current = { rebuild };

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      render();
    });
    ro.observe(el);
    rebuild(true);

    return () => {
      api.current = null;
      ro.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      clear();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => { api.current?.rebuild(true); }, [fitSignal, project?.id]);
  const markers = useApp((s) => s.markers);
  useEffect(() => { api.current?.rebuild(false); }, [d, sys, breakLines, markers]);

  if (failed) {
    return <div className="placeholder"><div className="box"><h3>3D view unavailable</h3>WebGL could not be started in this browser: {failed}</div></div>;
  }
  return (
    <>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div className="view-top" style={{ left: 10 }}>
        <div className="view-hint">Left-drag orbit · right-drag pan · wheel zoom{d.points.length > 0 && !d.tin ? ' · enable the TIN (Terrain menu) to see the ground surface' : ''}</div>
        <div className="view-badge">{info}</div>
      </div>
    </>
  );
}
