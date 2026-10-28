// Every surface in the town is painted here on a canvas, so the game loads no
// image files. Each texture comes with a normal map derived from its own
// brightness, which is what makes stone and tile catch the low sun.
import * as THREE from "three";

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvas(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")];
}

function speckle(ctx, size, r, amount, alpha) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(r() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
}

// Brightness as height, Sobel'd into a tangent-space normal map.
function normalFrom(src, strength = 2.5) {
  const w = src.width, h = src.height;
  const data = src.getContext("2d").getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas(w);
  const out = ctx.createImageData(w, h);
  const H = (x, y) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function material(c, opts = {}, bump = 0) {
  const m = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.9, ...opts });
  if (bump) {
    m.normalMap = tex(normalFrom(c, bump), false);
    m.normalScale = new THREE.Vector2(1, 1);
  }
  return m;
}

// Irregular blocks in courses, each its own shade, with dark mortar.
function stoneCanvas(seed, base = [150, 140, 125], courses = 8) {
  const [c, x] = canvas();
  const r = rng(seed);
  x.fillStyle = "rgb(70,64,58)";
  x.fillRect(0, 0, 512, 512);
  const ch = 512 / courses;
  for (let row = 0; row < courses; row++) {
    let px = -r() * 60;
    while (px < 512) {
      const w = 40 + r() * 70;
      const k = 0.75 + r() * 0.35;
      x.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
      x.beginPath();
      x.roundRect(px + 2, row * ch + 2, w - 4, ch - 4, 5);
      x.fill();
      px += w;
    }
  }
  speckle(x, 512, r, 9000, 0.25);
  return c;
}

function cobbleCanvas(seed, base = [128, 118, 104]) {
  const [c, x] = canvas();
  const r = rng(seed);
  x.fillStyle = "rgb(62,56,48)";
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const cx = r() * 512, cy = r() * 512, rad = 9 + r() * 9;
    const k = 0.7 + r() * 0.45;
    for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
      const grad = x.createRadialGradient(cx + ox - 3, cy + oy - 3, 1, cx + ox, cy + oy, rad);
      grad.addColorStop(0, `rgb(${base[0] * k * 1.15 | 0},${base[1] * k * 1.15 | 0},${base[2] * k * 1.15 | 0})`);
      grad.addColorStop(1, `rgb(${base[0] * k * 0.7 | 0},${base[1] * k * 0.7 | 0},${base[2] * k * 0.7 | 0})`);
      x.fillStyle = grad;
      x.beginPath();
      x.ellipse(cx + ox, cy + oy, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2);
      x.fill();
    }
  }
  return c;
}

// One storey of a timber-framed house, 4 m wide and 3 m tall: plaster, dark
// oak posts and braces, and a leaded window. The emissive twin has only the
// window, lit or dark, so houses glow at night one window at a time.
function facadeCanvases(seed) {
  const [c, x] = canvas();
  const [e, ex] = canvas();
  const r = rng(seed);
  x.fillStyle = "#e9e1cf";
  x.fillRect(0, 0, 512, 512);
  speckle(x, 512, r, 14000, 0.12);
  ex.fillStyle = "#000";
  ex.fillRect(0, 0, 512, 512);
  const oak = "#3d2a1c";
  x.fillStyle = oak;
  const beam = (x0, y0, x1, y1, w) => {
    x.strokeStyle = oak;
    x.lineWidth = w;
    x.beginPath();
    x.moveTo(x0, y0);
    x.lineTo(x1, y1);
    x.stroke();
  };
  beam(0, 10, 512, 10, 22);       // top plate
  beam(0, 500, 512, 500, 26);     // sill
  beam(12, 0, 12, 512, 24);       // posts
  beam(500, 0, 500, 512, 24);
  beam(256, 0, 256, 512, 18);
  const style = seed % 3;
  if (style === 0) { beam(20, 490, 120, 300, 14); beam(492, 490, 392, 300, 14); }
  if (style === 1) { beam(20, 260, 250, 260, 12); beam(262, 260, 492, 260, 12); beam(30, 30, 240, 250, 12); }
  if (style === 2) { for (let k = 60; k < 500; k += 70) { beam(k, 300, k, 490, 10); } }
  // the window
  const wx = 300, wy = 130, ww = 150, wh = 170;
  x.fillStyle = oak;
  x.fillRect(wx - 12, wy - 12, ww + 24, wh + 24);
  x.fillStyle = "#26303a";
  x.fillRect(wx, wy, ww, wh);
  const lit = r() < 0.75;
  ex.fillStyle = lit ? "#ffb35c" : "#000";
  ex.fillRect(wx, wy, ww, wh);
  x.strokeStyle = "#1b1410";
  x.lineWidth = 3;
  ex.strokeStyle = "#000";
  ex.lineWidth = 4;
  for (const ctx of [x, ex]) {
    ctx.beginPath();
    for (let k = -wh; k < ww + wh; k += 26) {
      ctx.moveTo(wx + k, wy);
      ctx.lineTo(wx + k + wh * 0.6, wy + wh);
      ctx.moveTo(wx + k + wh * 0.6, wy);
      ctx.lineTo(wx + k, wy + wh);
    }
    ctx.save();
    ctx.rect(wx, wy, ww, wh);
    ctx.clip();
    ctx.stroke();
    ctx.restore();
  }
  x.fillStyle = oak;
  x.fillRect(wx + ww / 2 - 5, wy, 10, wh);
  ex.fillStyle = "#000";
  ex.fillRect(wx + ww / 2 - 5, wy, 10, wh);
  // a sill box with flowers on some
  if (r() < 0.5) {
    x.fillStyle = "#4a3324";
    x.fillRect(wx - 6, wy + wh + 14, ww + 12, 18);
    for (let k = 0; k < 14; k++) {
      x.fillStyle = ["#b3443a", "#d6a13a", "#e8e0d0", "#7a4a8a"][k % 4];
      x.beginPath();
      x.arc(wx + 4 + k * 11, wy + wh + 12, 6, 0, 7);
      x.fill();
    }
  }
  return [c, e];
}

function rowsCanvas(seed, base, rows, ragged) {
  const [c, x] = canvas();
  const r = rng(seed);
  x.fillStyle = `rgb(${base.map((v) => v * 0.45 | 0)})`;
  x.fillRect(0, 0, 512, 512);
  const rh = 512 / rows;
  for (let row = 0; row < rows; row++) {
    let px = row % 2 ? -rh / 2 : 0;
    while (px < 512) {
      const w = ragged ? 4 + r() * 6 : rh * 0.9;
      const k = 0.75 + r() * 0.4;
      if (ragged) {
        x.strokeStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
        x.lineWidth = w;
        x.beginPath();
        x.moveTo(px, row * rh - 4);
        x.lineTo(px + (r() - 0.5) * 8, row * rh + rh + 6);
        x.stroke();
        px += w * 0.7;
      } else {
        const grad = x.createLinearGradient(0, row * rh, 0, row * rh + rh);
        grad.addColorStop(0, `rgb(${base[0] * k * 0.8 | 0},${base[1] * k * 0.8 | 0},${base[2] * k * 0.8 | 0})`);
        grad.addColorStop(1, `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`);
        x.fillStyle = grad;
        x.beginPath();
        x.roundRect(px + 1, row * rh, w - 2, rh - 2, [0, 0, rh / 2, rh / 2]);
        x.fill();
        px += w;
      }
    }
  }
  speckle(x, 512, r, 4000, 0.15);
  return c;
}

function grassCanvas(seed, colour) {
  const [c, x] = canvas();
  const r = rng(seed);
  x.fillStyle = colour;
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const k = 0.7 + r() * 0.6;
    const [cr, cg, cb] = colour.match(/\w\w/g).map((h) => parseInt(h, 16));
    x.strokeStyle = `rgba(${cr * k | 0},${cg * k | 0},${cb * k | 0},0.8)`;
    x.lineWidth = 1 + r();
    const px = r() * 512, py = r() * 512;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + (r() - 0.5) * 4, py - 3 - r() * 6);
    x.stroke();
  }
  return c;
}

function plainCanvas(seed, colour, grain) {
  const [c, x] = canvas(256);
  const r = rng(seed);
  x.fillStyle = colour;
  x.fillRect(0, 0, 256, 256);
  if (grain) {
    for (let k = 0; k < 90; k++) {
      x.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
      x.lineWidth = 1 + r() * 2;
      const y = r() * 256;
      x.beginPath();
      x.moveTo(0, y);
      x.bezierCurveTo(80, y + (r() - 0.5) * 10, 170, y + (r() - 0.5) * 10, 256, y);
      x.stroke();
    }
  }
  speckle(x, 256, r, 3000, 0.12);
  return c;
}

function clothCanvas(colour) {
  const [c, x] = canvas(256);
  x.fillStyle = "#efe6d2";
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = colour;
  for (let k = 0; k < 256; k += 64) x.fillRect(k, 0, 32, 256);
  return c;
}

export const SEASONS = {
  spring: { grass: "#6f8f45", leaves: [0x7da64a, 0x9cbf5a, 0xe7b9c8], field: ["#7d9b4c", "#8aa456", "#6d8a3e"], snow: 0, fog: 0xc9d4d8 },
  summer: { grass: "#6a8a3c", leaves: [0x4f7a32, 0x5f8a3a, 0x46702c], field: ["#c9a94a", "#9fae4c", "#b8953e"], snow: 0, fog: 0xd2d8d6 },
  autumn: { grass: "#7f8443", leaves: [0xc0702a, 0xa8482a, 0xd9a03a, 0x7a7a30], field: ["#a8874a", "#8a6a3a", "#b49a5a"], snow: 0, fog: 0xd6cbb8 },
  winter: { grass: "#dfe4e8", leaves: [0x6d5a48, 0x5b4b3c], field: ["#e8ecef", "#dfe4e8", "#e4e8ea"], snow: 1, fog: 0xd8dee4 },
};

export function makeMaterials(season) {
  const S = SEASONS[season];
  const snowy = S.snow > 0;
  const M = {};
  M.grass = material(grassCanvas(3, S.grass), { roughness: 1 }, snowy ? 0.6 : 1.2);
  M.cobble = material(cobbleCanvas(5, snowy ? [190, 190, 192] : [128, 118, 104]), { roughness: 0.85 }, 3);
  M.dirt = material(plainCanvas(9, snowy ? "#cfd3d6" : "#8a7457", false), { roughness: 1 }, 1);
  M.stone = material(stoneCanvas(11), {}, 3.5);
  M.wallStone = material(stoneCanvas(12, [160, 152, 138], 10), {}, 3.5);
  M.churchStone = material(stoneCanvas(13, [176, 166, 146], 12), {}, 3);
  M.tile = material(rowsCanvas(17, snowy ? [225, 228, 232] : [150, 72, 48], 14, false), {}, 3);
  M.thatch = material(rowsCanvas(19, snowy ? [222, 225, 228] : [168, 140, 86], 10, true), {}, 2);
  M.slate = material(rowsCanvas(23, snowy ? [220, 224, 230] : [78, 84, 92], 16, false), {}, 3);
  M.wood = material(plainCanvas(29, "#5c4030", true), {}, 1.5);
  M.darkWood = material(plainCanvas(31, "#3b2a1f", true), {}, 1.5);
  M.facades = [0, 1, 2].map((k) => {
    const [c, e] = facadeCanvases(41 + k);
    const m = material(c, { vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0 }, 1.2);
    m.emissiveMap = tex(e);
    return m;
  });
  M.cloth = ["#9b3b2e", "#2f5b7a", "#c99a2e", "#4c6b3a"].map((col) =>
    new THREE.MeshStandardMaterial({ map: tex(clothCanvas(col)), roughness: 1, side: THREE.DoubleSide }));
  M.fields = S.field.map((col, k) => material(rowsCanvas(51 + k, col.match(/\w\w/g).map((h) => parseInt(h, 16)), 24, true), { roughness: 1 }, 1.5));
  M.leaves = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  M.bark = material(plainCanvas(61, "#4a3a2c", true), {}, 2);
  M.iron = new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 0.6, metalness: 0.6 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.2 });
  M.churchGlass = new THREE.MeshStandardMaterial({ color: 0x1a2030, emissive: 0xffb060, emissiveIntensity: 0, roughness: 0.3 });
  return M;
}
