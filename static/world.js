// The town, built from the layout the server hands over. Everything that
// shares a material is merged into one mesh, so a city of a hundred houses is
// a few dozen draw calls.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/BufferGeometryUtils.js";
import { SEASONS } from "./textures.js";

const TINTS = [0xf2ead8, 0xeedcc0, 0xe6d5b8, 0xf3e3c4, 0xdcd3c4, 0xe9d2b4].map((c) => new THREE.Color(c));

export function heightAt(town, x, z) {
  const d = Math.hypot(x, z);
  const t = d - town.radius - 6;
  if (t <= 0) return 0;
  const ramp = Math.min(1, t / 30);
  const n = Math.sin(x * 0.045 + 1.7) * Math.cos(z * 0.038 - 0.4) * 2.6 + Math.sin((x + z) * 0.021) * 2.2;
  return 0.0016 * t * t + n * ramp + ramp * 2.4;
}

class Parts {
  constructor() { this.byKey = new Map(); }
  add(key, geo, matrix, colour) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (colour) {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colour.toArray(col, i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.byKey.has(key)) this.byKey.set(key, []);
    this.byKey.get(key).push(g);
  }
  build(materials, group) {
    for (const [key, list] of this.byKey) {
      const geo = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, materials(key));
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

const M4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

// A box whose UVs are in metres over a tile, so textures keep their scale.
function box(w, h, d, tu = 2, tv = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tu, uv.getY(i) * dims[f][1] / tv);
    }
  }
  return g;
}

function cyl(rt, rb, h, seg = 12, tile = 2, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * rb / tile, uv.getY(i) * h / tile);
  return g;
}

// A gabled roof over a span x length footprint, ridge along local x.
function roof(span, length, rise, over = 0.5) {
  const hs = span / 2 + over, hl = length / 2 + over;
  const slope = Math.hypot(hs, rise);
  const pos = [], uv = [];
  const quad = (a, b, c, d, ua, ub, uc, ud) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud); };
  const L = length + 2 * over;
  quad([-hl, 0, hs], [hl, 0, hs], [hl, rise, 0], [-hl, rise, 0], [0, 0], [L / 2, 0], [L / 2, slope / 2], [0, slope / 2]);
  quad([hl, 0, -hs], [-hl, 0, -hs], [-hl, rise, 0], [hl, rise, 0], [0, 0], [L / 2, 0], [L / 2, slope / 2], [0, slope / 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function gables(span, length, rise) {
  const hs = span / 2, hl = length / 2;
  const pos = [hl, 0, hs, hl, 0, -hs, hl, rise, 0, -hl, 0, -hs, -hl, 0, hs, -hl, rise, 0];
  const uv = [span / 4, 0, 0, 0, span / 8, rise / 3, span / 4, 0, 0, 0, span / 8, rise / 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function ribbon(pts, width, y, tile = 3) {
  const pos = [], uv = [];
  let run = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, z0, y0] = pts[k], [x1, z1, y1] = pts[k + 1];
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const nx = -(z1 - z0) / len * width / 2, nz = (x1 - x0) / len * width / 2;
    const a = [x0 + nx, y0 + y, z0 + nz], b = [x0 - nx, y0 + y, z0 - nz];
    const c = [x1 - nx, y1 + y, z1 - nz], d = [x1 + nx, y1 + y, z1 + nz];
    pos.push(...a, ...c, ...b, ...a, ...d, ...c);
    const v0 = run / tile, v1 = (run + len) / tile, u = width / tile;
    uv.push(0, v0, u, v1, u, v0, 0, v0, 0, v1, u, v1);
    run += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function house(P, h, colliders) {
  const m = M4(h.x, 0, h.z, h.ry);
  const tint = TINTS[h.tint % TINTS.length];
  const facade = "facade" + (h.facade % 3);
  const storey = 3;
  let top;
  if (h.floors === 1) {
    P.add("stone", box(h.w, 0.6, h.d), m.clone().multiply(M4(0, 0.3, 0)));
    P.add(facade, box(h.w - 0.05, storey, h.d - 0.05, 4, 3), m.clone().multiply(M4(0, 0.6 + storey / 2, 0)), tint);
    top = 0.6 + storey;
  } else {
    P.add("stone", box(h.w, storey, h.d), m.clone().multiply(M4(0, storey / 2, 0)));
    const j = h.jetty ? 0.35 : 0;
    const up = (h.floors - 1) * storey;
    P.add(facade, box(h.w + 2 * j, up, h.d + 2 * j, 4, 3), m.clone().multiply(M4(0, storey + up / 2, 0)), tint);
    if (j) P.add("darkWood", box(h.w + 2 * j + 0.1, 0.25, h.d + 2 * j + 0.1), m.clone().multiply(M4(0, storey + 0.12, 0)));
    top = storey + up;
  }
  const along = h.ridge === "x";
  const span = (along ? h.d : h.w) + (h.jetty && h.floors > 1 ? 0.7 : 0);
  const len = (along ? h.w : h.d) + (h.jetty && h.floors > 1 ? 0.7 : 0);
  const rise = span * (h.roof === "thatch" ? 0.62 : 0.5);
  const rm = m.clone().multiply(M4(0, top, 0, along ? 0 : Math.PI / 2));
  P.add(h.roof, roof(span, len, rise, h.roof === "thatch" ? 0.7 : 0.45), rm);
  P.add(facade, gables(span, len, rise), rm, tint);
  if (h.chimney) {
    const cx = along ? len * 0.3 : span * 0.15, cz = along ? span * 0.15 : len * 0.3;
    P.add("stone", box(0.9, rise + 1.6, 0.9), m.clone().multiply(M4(cx, top + (rise + 1.6) / 2, cz)));
  }
  P.add("darkWood", box(1.2, 2.2, 0.15, 1, 1), m.clone().multiply(M4(-h.w * 0.22, 1.1, h.d / 2 + 0.05)));
  colliders.push({ x: h.x, z: h.z, ry: h.ry, hw: h.w / 2 + 0.1, hd: h.d / 2 + 0.1, top: top + rise });
  return { top: top + rise };
}

export function buildTown(town, M) {
  const S = SEASONS[town.season];
  const group = new THREE.Group();
  const P = new Parts();
  const colliders = [];
  const circles = [];
  const R = town.radius;
  const H = (x, z) => heightAt(town, x, z);

  // Ground
  const ground = new THREE.PlaneGeometry(520, 520, 180, 180);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position, guv = ground.attributes.uv;
  for (let i = 0; i < gp.count; i++) {
    gp.setY(i, H(gp.getX(i), gp.getZ(i)));
    guv.setXY(i, guv.getX(i) * 520 / 7, guv.getY(i) * 520 / 7);
  }
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(ground, M.grass);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // Streets: cobbles inside the walls, a dirt track beyond them.
  town.streets.forEach((s, k) => {
    const inside = [], outside = [];
    for (const [x, z] of s.pts) {
      const d = Math.hypot(x, z);
      (d < R + 1 ? inside : outside).push([x, z, H(x, z)]);
      if (d < R + 1 && d > R - 1) outside.push([x, z, H(x, z)]);
    }
    const lift = 0.03 + k * 0.004;
    if (inside.length > 1) P.add("cobble", ribbon(inside, s.w, lift));
    if (outside.length > 1) P.add("dirt", ribbon(outside.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1])), s.w * 0.8, lift + 0.05));
  });
  const sq = new THREE.CircleGeometry(town.square, 48);
  sq.rotateX(-Math.PI / 2);
  const suv = sq.attributes.uv;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i) * town.square * 2 / 3, suv.getY(i) * town.square * 2 / 3);
  P.add("cobble", sq, M4(0, 0.07, 0));

  // Walls, towers and gatehouses.
  const gapHalf = 5 / R;
  const inGate = (a) => town.gates.some((g) => Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < gapHalf);
  const segs = Math.ceil(2 * Math.PI * R / 3.5);
  for (let k = 0; k < segs; k++) {
    const a = (k + 0.5) / segs * Math.PI * 2;
    if (inGate(a)) continue;
    const chord = 2 * R * Math.sin(Math.PI / segs) + 0.25;
    const x = R * Math.cos(a), z = R * Math.sin(a), ry = -a - Math.PI / 2;
    P.add("wallStone", box(chord, 7, 2.4, 3, 3), M4(x, 3.5, z, ry));
    for (const off of [-chord / 4, chord / 4]) {
      const ox = x + Math.cos(a) * 0.9 + Math.cos(ry) * off, oz = z + Math.sin(a) * 0.9 - Math.sin(ry) * off;
      P.add("wallStone", box(0.9, 1.0, 0.6, 3, 3), M4(ox, 7.5, oz, ry));
    }
  }
  const tower = (a, r = 3, h = 11) => {
    const x = R * Math.cos(a), z = R * Math.sin(a);
    P.add("wallStone", cyl(r, r + 0.2, h, 14, 3), M4(x, h / 2, z));
    P.add("slate", cyl(0, r + 0.6, 4.5, 14, 2), M4(x, h + 2.25, z));
    circles.push({ x, z, r: r + 0.3 });
  };
  const towers = Math.max(4, Math.round(2 * Math.PI * R / 28));
  for (let k = 0; k < towers; k++) {
    const a = k / towers * Math.PI * 2 + 0.2;
    if (!town.gates.some((g) => Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < gapHalf * 3)) tower(a);
  }
  for (const g of town.gates) {
    tower(g - gapHalf * 1.35, 3.2, 12);
    tower(g + gapHalf * 1.35, 3.2, 12);
    const x = R * Math.cos(g), z = R * Math.sin(g);
    P.add("wallStone", box(2 * R * Math.sin(gapHalf) + 1, 3, 3, 3, 3), M4(x, 8.5, z, -g - Math.PI / 2));
  }

  // Houses, then the three landmarks.
  for (const h of town.houses) house(P, h, colliders);
  if (town.tavern) {
    const t = town.tavern;
    house(P, { ...t, floors: 2, roof: "tile", ridge: "x", tint: 3, jetty: true, chimney: true, facade: 1 }, colliders);
    const m = M4(t.x, 0, t.z, t.ry);
    P.add("iron", box(0.08, 0.08, 1.4), m.clone().multiply(M4(t.w * 0.3, 3.4, t.d / 2 + 0.6)));
    P.add("wood", box(0.1, 0.9, 1.0, 1, 1), m.clone().multiply(M4(t.w * 0.3, 2.85, t.d / 2 + 0.9, Math.PI / 2)));
    for (const [bx, bz] of [[t.w * 0.35, 1.3], [t.w * 0.42, 2.1]]) {
      P.add("wood", cyl(0.42, 0.42, 1.0, 12, 1), m.clone().multiply(M4(bx, 0.5, t.d / 2 + bz)));
    }
  }
  if (town.church) {
    const c = town.church;
    const m = M4(c.x, 0, c.z, c.ry);
    P.add("churchStone", box(c.w, 9, c.d, 3, 3), m.clone().multiply(M4(0, 4.5, 0)));
    P.add("slate", roof(c.w, c.d, 6, 0.5), m.clone().multiply(M4(0, 9, 0, Math.PI / 2)));
    P.add("churchStone", gables(c.w, c.d, 6), m.clone().multiply(M4(0, 9, 0, Math.PI / 2)));
    P.add("churchStone", box(5.5, 22, 5.5, 3, 3), m.clone().multiply(M4(0, 11, -c.d / 2 - 2.2)));
    const spire = new THREE.ConeGeometry(4.2, 13, 4);
    P.add("slate", spire, m.clone().multiply(M4(0, 28.5, -c.d / 2 - 2.2, Math.PI / 4)));
    P.add("darkWood", box(2.2, 3.6, 0.2, 1, 1), m.clone().multiply(M4(0, 1.8, c.d / 2 + 0.05)));
    for (let k = -2; k <= 2; k++) {
      for (const side of [-1, 1]) {
        P.add("churchGlass", box(0.15, 3.6, 1.1, 1, 1), m.clone().multiply(M4(side * (c.w / 2 + 0.03), 5, k * c.d / 6)));
      }
    }
    P.add("churchGlass", new THREE.CircleGeometry(1.4, 20), m.clone().multiply(M4(0, 7, c.d / 2 + 0.06)));
    colliders.push({ x: c.x, z: c.z, ry: c.ry, hw: c.w / 2, hd: c.d / 2, top: 15 });
    const [tx, tz] = [c.x - Math.sin(c.ry) * (c.d / 2 + 2.2), c.z - Math.cos(c.ry) * (c.d / 2 + 2.2)];
    colliders.push({ x: tx, z: tz, ry: c.ry, hw: 2.9, hd: 2.9, top: 35 });
  }
  if (town.keep) {
    const k = town.keep;
    const m = M4(k.x, 0, k.z, k.ry);
    P.add("wallStone", box(k.w, 16, k.d, 3, 3), m.clone().multiply(M4(0, 8, 0)));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 7; j++) {
        const t = -k.w / 2 + 0.6 + j * (k.w - 1.2) / 6;
        const [lx, lz] = [[t, k.d / 2 - 0.3], [t, -k.d / 2 + 0.3], [k.w / 2 - 0.3, t], [-k.w / 2 + 0.3, t]][i];
        P.add("wallStone", box(0.9, 1.1, 0.9, 3, 3), m.clone().multiply(M4(lx, 16.55, lz)));
      }
    }
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      P.add("wallStone", cyl(1.7, 1.8, 19.5, 12, 3), m.clone().multiply(M4(cx * k.w / 2, 9.75, cz * k.d / 2)));
      P.add("slate", cyl(0, 2.2, 3.8, 12, 2), m.clone().multiply(M4(cx * k.w / 2, 21.4, cz * k.d / 2)));
    }
    P.add("darkWood", box(2.6, 3.8, 0.25, 1, 1), m.clone().multiply(M4(0, 1.9, k.d / 2 + 0.05)));
    P.add("iron", cyl(0.06, 0.06, 6, 6), m.clone().multiply(M4(0, 20, 0)));
    colliders.push({ x: k.x, z: k.z, ry: k.ry, hw: k.w / 2 + 1.2, hd: k.d / 2 + 1.2, top: 22 });
  }

  // The market: a well and stalls.
  P.add("stone", cyl(1.3, 1.4, 0.9, 16, 2, true), M4(0, 0.45, 0));
  P.add("stone", cyl(1.0, 1.0, 0.9, 16, 2, true), M4(0, 0.45, 0));
  P.add("darkWood", new THREE.CircleGeometry(1.05, 16).rotateX(-Math.PI / 2), M4(0, 0.35, 0));
  for (const s of [-1, 1]) P.add("wood", box(0.18, 2.6, 0.18), M4(s * 1.15, 1.3, 0));
  P.add("tile", roof(1.6, 2.8, 0.9, 0.2), M4(0, 2.6, 0));
  circles.push({ x: 0, z: 0, r: 1.6 });
  town.stalls.forEach((s) => {
    const m = M4(s.x, 0, s.z, s.ry);
    for (const [px, pz] of [[-1.4, 0.8], [1.4, 0.8], [-1.4, -0.8], [1.4, -0.8]]) {
      P.add("wood", box(0.12, pz > 0 ? 2.3 : 2.7, 0.12), m.clone().multiply(M4(px, pz > 0 ? 1.15 : 1.35, pz)));
    }
    P.add("wood", box(3, 0.9, 1.1, 1, 1), m.clone().multiply(M4(0, 0.45, 0.3)));
    const cloth = new THREE.PlaneGeometry(3.3, 2.2);
    cloth.rotateX(-Math.PI / 2 + 0.2);
    P.add("cloth" + s.cloth, cloth, m.clone().multiply(M4(0, 2.55, 0)));
    for (let i = 0; i < 5; i++) {
      const colour = [0xb5452f, 0xd8a03a, 0x8a9a3a, 0xc76a2a][(i + s.cloth) % 4];
      P.add("produce", new THREE.SphereGeometry(0.16, 8, 6), m.clone().multiply(M4(-1.1 + i * 0.55, 0.98, 0.35)), new THREE.Color(colour));
    }
    colliders.push({ x: s.x, z: s.z, ry: s.ry, hw: 1.6, hd: 0.9, top: 0 });
  });

  // Fields beyond the walls.
  town.fields.forEach((f) => {
    const g = new THREE.PlaneGeometry(f.w, f.d, 10, 8);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * f.w / 6, uv.getY(i) * f.d / 6);
    const m = M4(f.x, 0, f.z, f.ry);
    g.applyMatrix4(m);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)) + 0.08);
    g.computeVertexNormals();
    P.add("field" + f.crop, g);
  });

  // Trees: oaks in the season's colours and a few pines.
  const leafColours = S.leaves.map((c) => new THREE.Color(c));
  let r = town.seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (const t of town.trees) {
    const y = H(t.x, t.z), s = t.s;
    if (t.kind === "pine") {
      P.add("bark", cyl(0.18 * s, 0.28 * s, 2.2 * s, 7, 1), M4(t.x, y + 1.1 * s, t.z));
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Color(S.snow && i === 2 ? 0xe8edf0 : 0x2f4a30).offsetHSL(0, 0, (rand() - 0.5) * 0.05);
        P.add("leaves", new THREE.ConeGeometry((2.4 - i * 0.6) * s, 3 * s, 8), M4(t.x, y + (2.6 + i * 1.6) * s, t.z), c);
      }
    } else {
      P.add("bark", cyl(0.22 * s, 0.38 * s, 3.4 * s, 7, 1), M4(t.x, y + 1.7 * s, t.z));
      const blobs = S.snow ? 2 : 5;
      for (let i = 0; i < blobs; i++) {
        const c = leafColours[Math.floor(rand() * leafColours.length)].clone().offsetHSL(0, 0, (rand() - 0.5) * 0.08);
        const rad = (S.snow ? 0.9 : 1.5 + rand() * 0.6) * s;
        const blob = new THREE.IcosahedronGeometry(rad, 1);
        P.add("leaves", blob, M4(t.x + (rand() - 0.5) * 2.2 * s, y + (3.6 + rand() * 1.6) * s, t.z + (rand() - 0.5) * 2.2 * s), c);
      }
    }
    circles.push({ x: t.x, z: t.z, r: 0.5 * s });
  }

  const mat = (key) => {
    if (key.startsWith("facade")) return M.facades[+key.slice(6)];
    if (key.startsWith("cloth")) return M.cloth[+key.slice(5)];
    if (key.startsWith("field")) return M.fields[+key.slice(5)];
    if (key === "produce") return M.produce || (M.produce = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    return M[key];
  };
  P.build(mat, group);
  return { group, colliders, circles, gapHalf };
}

// A lantern on an iron post. Lighting one turns up its glass, its glow and
// a point light that was there, dark, all along (adding lights would
// recompile every shader in the scene).
export function buildLanterns(town, M, scene, glowTexture) {
  const out = [];
  for (const [x, z] of town.lanterns) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const post = new THREE.Mesh(cyl(0.07, 0.1, 3.2, 8), M.iron);
    post.position.y = 1.6;
    const cage = new THREE.Mesh(box(0.42, 0.55, 0.42, 1, 1), M.iron);
    cage.position.y = 3.45;
    const glass = new THREE.Mesh(box(0.34, 0.45, 0.34, 1, 1), M.glass.clone());
    glass.position.y = 3.45;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.3, 4), M.iron);
    cap.position.y = 3.86;
    cap.rotation.y = Math.PI / 4;
    for (const m of [post, cage, cap]) m.castShadow = true;
    const light = new THREE.PointLight(0xffa850, 0, 16, 1.6);
    light.position.y = 3.3;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffb060, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(2.6);
    glow.position.y = 3.45;
    g.add(post, cage, glass, cap, light, glow);
    scene.add(g);
    out.push({ x, z, lit: false, glass, light, glow });
  }
  return out;
}
