import * as THREE from "three";
import { Sky } from "three/addons/Sky.js";
import { makeMaterials, SEASONS } from "./textures.js";
import { buildTown, buildLanterns, heightAt } from "./world.js";
import { makePerson, animate, ghostOf } from "./people.js";

const CFG = window.LANTERNFALL;
const $ = (id) => document.getElementById(id);
const town = await (await fetch(CFG.layoutUrl)).json();
const N = town.lanterns.length;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$("stage").appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.3, 1200);
const season = SEASONS[town.season];
scene.fog = new THREE.FogExp2(season.fog, 0.0065);

const sky = new Sky();
sky.scale.setScalar(4000);
sky.material.uniforms.turbidity.value = 5;
sky.material.uniforms.rayleigh.value = 1.4;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.85;
scene.add(sky);

const stars = (() => {
  const pos = [];
  for (let i = 0; i < 1800; i++) {
    const t = Math.random() * Math.PI * 2, p = Math.acos(Math.random() * 0.95);
    pos.push(Math.sin(p) * Math.cos(t) * 900, Math.cos(p) * 900, Math.sin(p) * Math.sin(t) * 900);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const s = new THREE.Points(g, m);
  scene.add(s);
  return s;
})();

const hemi = new THREE.HemisphereLight(0xbcd0ff, 0x5a4a32, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 300 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const glowTexture = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,230,180,1)");
  g.addColorStop(0.25, "rgba(255,170,80,0.5)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

// ------------------------------------------------------------------- world
const M = makeMaterials(town.season);
const world = buildTown(town, M);
scene.add(world.group);
const lanterns = buildLanterns(town, M, scene, glowTexture);

// Chimney smoke: a few soft puffs per chimney, rising and thinning on the wind.
const smoke = (() => {
  const chimneys = world.chimneys.slice(0, 48);
  const per = 7, n = chimneys.length * per;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), age = new Float32Array(n);
  for (let i = 0; i < n; i++) age[i] = Math.random() * per;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 4));
  const puff = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,0.9)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const m = new THREE.PointsMaterial({ map: puff, size: 2.6, vertexColors: true, transparent: true, depthWrite: false });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  scene.add(points);
  return { update(dt, shade) {
    for (let i = 0; i < n; i++) {
      age[i] += dt;
      if (age[i] > per) age[i] -= per;
      const c = chimneys[Math.floor(i / per)], a = age[i];
      pos[i * 3] = c.x + a * 0.55 + Math.sin(a * 1.3 + i) * 0.25;
      pos[i * 3 + 1] = c.y + a * 0.9;
      pos[i * 3 + 2] = c.z + a * 0.25;
      col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = shade;
      col[i * 4 + 3] = Math.max(0, 0.4 * Math.min(1, a * 2) * (1 - a / per));
    }
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  } };
})();
const H = (x, z) => heightAt(town, x, z);

const LINES = (() => {
  const lamp = town.folk.find((f) => f.role === "lamplighter").name;
  const where = {
    church: `I saw ${lamp} going round the back of the church, under the tower.`,
    keep: `${lamp} had business up at the keep, I think. Something about the steward's oil.`,
    gate: `${lamp} told me he'd walk out past the walls to fetch oil from a farm.`,
  }[town.hideout];
  return {
    innkeeper: [`Evening. The Lantern Fair is tomorrow, and not one lamp is lit in ${town.name}.`, `${lamp} the lamplighter should have been round by six. Nobody's seen him since noon.`, `Light them yourself, if you've a mind. There are ${N}, and midnight comes quick.`],
    guard: [`Nobody's come through this gate since noon but the miller's cart.`, town.hideout === "gate" ? `Mind you, old ${lamp} went out this way before dusk. Said he wouldn't be long.` : `If it's ${lamp} you're after, ask at the church. The priest misses nothing.`],
    priest: [`Peace be with you. The lamps dark on the eve of the Fair is a poor omen.`, where],
    baker: [`Lanterns? ${N} of them, counting the one by my stall. Follow the streets and you'll not miss them.`, `Walk up close and you can light one. Be quick, the oil is dear.`],
    child: [`I know where all the lanterns are! They're the little lights on your map.`, `The bright ones are lit. The dim ones are still waiting.`],
    lamplighter: [],
  };
})();

const folk = town.folk.map((f, i) => {
  const p = makePerson(f.role, i + town.seed);
  p.position.set(f.x, H(f.x, f.z), f.z);
  p.rotation.y = Math.atan2(-f.x, -f.z) + (i % 2 ? 0.6 : -0.6);
  scene.add(p);
  return { ...f, mesh: p, talked: 0 };
});

const player = makePerson("player", 3);
ghostOf(player);
scene.add(player);
const carry = new THREE.PointLight(0xffb870, 0, 9, 1.8);
carry.position.set(0.35, 1.3, 0.25);
player.add(carry);

// ----------------------------------------------------------------- the day
const state = {
  mode: "title",          // title | play | wander | end
  hour: CFG.startHour,
  targetHour: null,
  lit: 0,
  started: 0,
  foundLamplighter: false,
  yaw: 0.6, pitch: 0.8, dist: 16,
  vel: new THREE.Vector3(),
};
const sunDir = new THREE.Vector3();

function setTime(h) {
  const day = (h - 6) / 12;
  const elev = Math.sin(Math.PI * day) * 62;           // degrees above the horizon
  const az = Math.PI * day + 0.4;
  const phi = THREE.MathUtils.degToRad(90 - elev);
  sunDir.setFromSphericalCoords(1, phi, az);
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  const night = THREE.MathUtils.clamp((4 - elev) / 14, 0, 1);
  const low = THREE.MathUtils.clamp(1 - elev / 25, 0, 1);
  // The sun, or after dark the moon from the other side.
  if (elev > -2) {
    sun.color.setHSL(0.09, 0.9 * low, 0.62 + 0.3 * (1 - low));
    sun.intensity = Math.sqrt(Math.max(0, Math.sin(THREE.MathUtils.degToRad(elev)))) * 3.2 + 0.2;
  } else {
    sun.color.set(0x9fb4ff);
    sun.intensity = 0.55;
  }
  const lightDir = elev > -2 ? sunDir : new THREE.Vector3(-0.3, 0.8, -0.5).normalize();
  sun.userData.dir = lightDir.clone();
  hemi.intensity = THREE.MathUtils.lerp(1.45, 0.42, night);
  hemi.color.set(0xc8d6f0).lerp(new THREE.Color(0x4a5a8a), night);
  hemi.groundColor.set(0x8a7652).lerp(new THREE.Color(0x0d0d14), night);
  const fogDay = new THREE.Color(season.fog), fogDusk = new THREE.Color(0xd59a6a), fogNight = new THREE.Color(0x0b1020);
  scene.fog.color.copy(fogDay).lerp(fogDusk, low * (1 - night) * 0.7).lerp(fogNight, night);
  sky.visible = night < 0.98;
  scene.background = fogNight;
  stars.material.opacity = night;
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.25, night);
  for (const f of M.facades) f.emissiveIntensity = night * 1.5 + low * 0.15;
  M.churchGlass.emissiveIntensity = night * 1.2;
  carry.intensity = night * 7;
  for (const l of lanterns) {
    const on = l.lit ? 1 : 0;
    l.base = on * (8 + night * 22);
    l.light.intensity = l.base;
    l.glass.material.emissiveIntensity = on * (1.2 + night * 2);
    l.glow.material.opacity = on * (0.25 + night * 0.75);
  }
  state.night = night;
}

function clock(h) {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ------------------------------------------------------------------- input
const keys = new Set();
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "KeyF" || e.code === "Space" || e.code === "Enter") { e.preventDefault(); interact(); }
  if (e.code === "Escape" && state.mode !== "title") toggleHelp();
});
addEventListener("keyup", (e) => keys.delete(e.code));
let drag = null;
renderer.domElement.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener("pointerup", () => { drag = null; });
addEventListener("pointermove", (e) => {
  if (!drag || state.mode === "title") return;
  state.yaw -= (e.clientX - drag.x) * 0.006;
  state.pitch = THREE.MathUtils.clamp(state.pitch + (e.clientY - drag.y) * 0.004, 0.35, 1.35);
  drag = { x: e.clientX, y: e.clientY };
});
addEventListener("wheel", (e) => { state.dist = THREE.MathUtils.clamp(state.dist + e.deltaY * 0.02, 6, 40); }, { passive: true });

// A thumbstick on the left and an action button on the right, on touch screens.
const joy = { x: 0, z: 0, id: null, ox: 0, oy: 0 };
if (matchMedia("(pointer: coarse)").matches) {
  $("touch").hidden = false;
  const pad = $("stick"), knob = $("knob");
  pad.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY;
    pad.setPointerCapture(e.pointerId);
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId !== joy.id) return;
    const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, d = Math.hypot(dx, dy), k = Math.min(1, d / 50) / (d || 1);
    joy.x = dx * k; joy.z = dy * k;
    knob.style.transform = `translate(${joy.x * 40}px, ${joy.z * 40}px)`;
  });
  const end = () => { joy.id = null; joy.x = joy.z = 0; knob.style.transform = ""; };
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  $("act").addEventListener("pointerdown", (e) => { e.stopPropagation(); interact(); });
}

// ---------------------------------------------------------------- movement
const R = town.radius;
function collide(p) {
  const pr = 0.38;
  for (const c of world.colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
    const cs = Math.cos(c.ry), sn = Math.sin(c.ry);
    const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
    const cu = THREE.MathUtils.clamp(u, -c.hw, c.hw), cv = THREE.MathUtils.clamp(v, -c.hd, c.hd);
    let du = u - cu, dv = v - cv;
    let d = Math.hypot(du, dv);
    if (d >= pr) continue;
    let nu, nv;
    if (d > 1e-4) { nu = cu + du / d * pr; nv = cv + dv / d * pr; }
    else {
      const pen = [c.hw - u, u + c.hw, c.hd - v, v + c.hd];
      const k = pen.indexOf(Math.min(...pen));
      nu = [c.hw + pr, -c.hw - pr, u, u][k];
      nv = [v, v, c.hd + pr, -c.hd - pr][k];
    }
    p.x = c.x + nu * cs + nv * sn;
    p.z = c.z - nu * sn + nv * cs;
  }
  const extra = [...world.circles, ...lanterns.map((l) => ({ x: l.x, z: l.z, r: 0.2 })), ...folk.map((f) => ({ x: f.mesh.position.x, z: f.mesh.position.z, r: 0.35 }))];
  for (const c of extra) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + pr;
    if (d < min && d > 1e-4) { p.x = c.x + dx / d * min; p.z = c.z + dz / d * min; }
  }
  const d = Math.hypot(p.x, p.z);
  const a = Math.atan2(p.z, p.x);
  const inGate = town.gates.some((g) => Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < world.gapHalf * 0.8);
  const half = 1.2 + pr;
  if (!inGate && Math.abs(d - R) < half) {
    const nd = d < R ? R - half : R + half;
    p.x *= nd / d; p.z *= nd / d;
  }
  const far = R + 80;
  if (d > far) { p.x *= far / d; p.z *= far / d; }
}

// Is this point inside a building or the town wall? The camera uses it to
// come in front of whatever would hide the player.
function solidAt(x, y, z) {
  for (const c of world.colliders) {
    if (y > c.top + 0.4) continue;
    const dx = x - c.x, dz = z - c.z;
    if (Math.abs(dx) > 16 || Math.abs(dz) > 16) continue;
    const cs = Math.cos(c.ry), sn = Math.sin(c.ry);
    if (Math.abs(dx * cs - dz * sn) < c.hw + 0.4 && Math.abs(dx * sn + dz * cs) < c.hd + 0.4) return true;
  }
  const d = Math.hypot(x, z);
  if (y < 8.5 && Math.abs(d - R) < 1.8) {
    const a = Math.atan2(z, x);
    return !town.gates.some((g) => Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < world.gapHalf);
  }
  return false;
}

function move(dt) {
  let fx = 0, fz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) fz -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) fz += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) fx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) fx += 1;
  if (keys.has("KeyQ")) state.yaw += dt * 1.8;
  if (keys.has("KeyE")) state.yaw -= dt * 1.8;
  if (joy.id !== null) { fx = joy.x; fz = joy.z; }
  const run = keys.has("ShiftLeft") || keys.has("ShiftRight") || Math.hypot(joy.x, joy.z) > 0.95;
  const len = Math.hypot(fx, fz);
  const speed = (run ? 7.5 : 4.2) * Math.min(1, len);
  const target = new THREE.Vector3();
  if (len > 0.05 && !dialog.open) {
    const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
    target.set((fx * cy + fz * sy) / len * speed, 0, (-fx * sy + fz * cy) / len * speed);
  }
  state.vel.lerp(target, Math.min(1, dt * 10));
  const p = player.position;
  p.x += state.vel.x * dt;
  p.z += state.vel.z * dt;
  collide(p);
  p.y = H(p.x, p.z);
  const v = Math.hypot(state.vel.x, state.vel.z);
  if (v > 0.3) {
    const want = Math.atan2(state.vel.x, state.vel.z);
    let diff = want - player.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.rotation.y += diff * Math.min(1, dt * 12);
  }
  animate(player, dt, v / 4.2);
}

// ------------------------------------------------------- talk and lanterns
const dialog = { open: false, lines: [], i: 0 };
function nearest() {
  const p = player.position;
  let best = null, bd = 2.6;
  for (const l of lanterns) {
    const d = Math.hypot(p.x - l.x, p.z - l.z);
    if (!l.lit && d < bd) { best = { kind: "lantern", l }; bd = d; }
  }
  for (const f of folk) {
    const d = Math.hypot(p.x - f.mesh.position.x, p.z - f.mesh.position.z);
    if (d < bd + 0.2) { best = { kind: "folk", f }; bd = d; }
  }
  return best;
}

function interact() {
  if (state.mode === "title" || state.mode === "end") return;
  if (dialog.open) {
    dialog.i++;
    if (dialog.i >= dialog.lines.length) { dialog.open = false; $("dialog").hidden = true; }
    else $("dialog-text").textContent = dialog.lines[dialog.i];
    return;
  }
  const n = nearest();
  if (!n) return;
  if (n.kind === "lantern") {
    n.l.lit = true;
    state.lit++;
    setTime(state.hour);
    report("lit", { n: state.lit });
    toast(`Lantern lit · ${state.lit} of ${N}`);
    if (state.lit === N && state.mode === "play") win();
    return;
  }
  const f = n.f;
  let lines = LINES[f.role] || [];
  if (f.role === "lamplighter") {
    state.foundLamplighter = true;
    lines = state.lit < N
      ? [`Ah, you've found me. I turned my ankle on the cobbles and sat down to wait for help.`, `${N - state.lit} lantern${N - state.lit === 1 ? " is" : "s are"} still dark. Would you see to them? I'll hobble back to the tavern.`]
      : [`Every lamp in ${town.name} burning, and me sat here on a stone! You've saved the Fair.`];
  }
  f.mesh.lookAt(player.position.x, f.mesh.position.y, player.position.z);
  dialog.open = true;
  dialog.who = f;
  dialog.lines = lines;
  dialog.i = 0;
  $("dialog-name").textContent = `${f.name}, the ${f.role}`;
  $("dialog-text").textContent = lines[0];
  $("dialog").hidden = false;
  if (!f.talked++) report("talk", { who: f.role });
}

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

function report(kind, extra = {}) {
  const body = { kind, seed: town.seed, name: town.name, size: town.size, season: town.season, mode: state.mode,
    clock: clock(state.hour), seconds: state.started ? Math.round((performance.now() - state.started) / 1000) : 0, total: N, ...extra };
  fetch(CFG.base + "api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

// -------------------------------------------------------------- the minimap
const mini = $("minimap"), mctx = mini.getContext("2d");
const MS = mini.width, scale = MS / ((R + 20) * 2);
const base = document.createElement("canvas");
base.width = base.height = MS;
(() => {
  const x = base.getContext("2d");
  const tx = (v) => MS / 2 + v * scale;
  x.fillStyle = "#3d4a2c";
  x.fillRect(0, 0, MS, MS);
  x.strokeStyle = "#8c8170";
  x.lineCap = "round";
  for (const s of town.streets) {
    x.lineWidth = s.w * scale;
    x.beginPath();
    s.pts.forEach(([px, pz], i) => (i ? x.lineTo(tx(px), tx(pz)) : x.moveTo(tx(px), tx(pz))));
    x.stroke();
  }
  x.fillStyle = "#8c8170";
  x.beginPath();
  x.arc(tx(0), tx(0), town.square * scale, 0, 7);
  x.fill();
  const rect = (b, colour) => {
    x.save();
    x.translate(tx(b.x), tx(b.z));
    x.rotate(-b.ry);
    x.fillStyle = colour;
    x.fillRect(-b.w / 2 * scale, -b.d / 2 * scale, b.w * scale, b.d * scale);
    x.restore();
  };
  town.houses.forEach((h) => rect(h, h.roof === "thatch" ? "#b59a62" : "#a5583c"));
  if (town.church) rect(town.church, "#6e7480");
  if (town.keep) rect(town.keep, "#77736a");
  if (town.tavern) rect(town.tavern, "#c4793e");
  x.strokeStyle = "#c9c0ae";
  x.lineWidth = 2.4 * scale + 1;
  x.beginPath();
  x.arc(tx(0), tx(0), R * scale, 0, 7);
  x.stroke();
})();

function drawMinimap() {
  const tx = (v) => MS / 2 + v * scale;
  mctx.drawImage(base, 0, 0);
  for (const l of lanterns) {
    mctx.fillStyle = l.lit ? "#ffcf6a" : "rgba(255,240,200,0.35)";
    mctx.strokeStyle = "#1a1510";
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.arc(tx(l.x), tx(l.z), l.lit ? 4 : 3.2, 0, 7);
    mctx.fill();
    mctx.stroke();
  }
  for (const f of folk) {
    if (f.role === "lamplighter" && !state.foundLamplighter) continue;
    mctx.fillStyle = "#e8e0d0";
    mctx.fillRect(tx(f.mesh.position.x) - 2, tx(f.mesh.position.z) - 2, 4, 4);
  }
  const p = player.position;
  mctx.save();
  mctx.translate(tx(p.x), tx(p.z));
  mctx.rotate(-player.rotation.y + Math.PI);
  mctx.fillStyle = "#fff";
  mctx.beginPath();
  mctx.moveTo(0, -6); mctx.lineTo(4.5, 5); mctx.lineTo(0, 2.5); mctx.lineTo(-4.5, 5);
  mctx.closePath();
  mctx.fill();
  mctx.restore();
}

// ------------------------------------------------------------- game flow
const PLAY_MINUTES = 7;     // dusk to midnight, in real minutes
function begin(mode) {
  state.mode = mode;
  $("title").hidden = true;
  $("hud").hidden = false;
  $("times").hidden = mode !== "wander";
  // The tale starts outside the main gate; wandering starts by the well.
  const g = town.gates[0];
  const r = mode === "play" ? R + 8 : town.square - 4;
  player.position.set(r * Math.cos(g), 0, r * Math.sin(g));
  player.rotation.y = Math.atan2(-Math.cos(g), -Math.sin(g));
  state.yaw = Math.atan2(Math.cos(g), Math.sin(g));
  camera.position.set(player.position.x + Math.sin(state.yaw) * state.dist, state.dist * 0.6, player.position.z + Math.cos(state.yaw) * state.dist);
  state.hour = mode === "play" ? 18.6 : state.hour;
  state.started = performance.now();
  setTime(state.hour);
  drawMinimap();
  report("start");
  toast(mode === "play" ? `Light all ${N} lanterns before midnight` : "Wander as you please");
}

function win() {
  state.mode = "end";
  const secs = Math.round((performance.now() - state.started) / 1000);
  report("finish", { seconds: secs, lamplighter: state.foundLamplighter });
  $("end-title").textContent = "The Fair goes on";
  $("end-text").textContent = `Every lantern in ${town.name} was burning by ${clock(state.hour)}, in ${Math.floor(secs / 60)}m ${secs % 60}s.` +
    (state.foundLamplighter ? " And the lamplighter is safe at the tavern." : " Somewhere, the lamplighter is still waiting to be found.");
  $("end").hidden = false;
}

function lose() {
  state.mode = "end";
  report("midnight", { n: state.lit });
  $("end-title").textContent = "Midnight";
  $("end-text").textContent = `${town.name} goes to sleep with ${N - state.lit} of its ${N} lanterns dark.`;
  $("end").hidden = false;
}

function toggleHelp() { $("help").hidden = !$("help").hidden; }

$("btn-play").onclick = () => begin("play");
$("btn-wander").onclick = () => begin("wander");
$("btn-again").onclick = () => location.reload();
$("btn-help").onclick = toggleHelp;
document.querySelectorAll("[data-hour]").forEach((b) => (b.onclick = () => (state.targetHour = +b.dataset.hour)));

// -------------------------------------------------------------- the frame
const clockEl = $("clock"), countEl = $("count"), promptEl = $("prompt");
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
let last = performance.now(), mmLast = -1e9, titleSpin = 0;
setTime(state.hour);

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.mode === "title") {
    titleSpin += dt * 0.04;
    const far = innerWidth < innerHeight ? 1.7 : 1;
    camPos.set(Math.cos(titleSpin) * (R + 34) * far, R * 0.62 * far, Math.sin(titleSpin) * (R + 34) * far);
    camera.position.lerp(camPos, 1);
    camera.lookAt(0, 4, 0);
    sun.target.position.set(0, 0, 0);
  } else {
    if (state.mode !== "end") move(dt);
    if (state.mode === "play") {
      state.hour += dt * (24 - 18.6) / (PLAY_MINUTES * 60);
      if (state.hour >= 24) { state.hour = 24; lose(); }
      setTime(state.hour);
    } else if (state.targetHour !== null) {
      let d = state.targetHour - state.hour;
      state.hour += Math.sign(d) * Math.min(Math.abs(d), dt * 6);
      if (Math.abs(d) < 0.01) state.targetHour = null;
      setTime(state.hour);
    }
    const p = player.position;
    camPos.set(p.x + Math.sin(state.yaw) * Math.cos(state.pitch) * state.dist,
      p.y + Math.sin(state.pitch) * state.dist,
      p.z + Math.cos(state.yaw) * Math.cos(state.pitch) * state.dist);
    look.set(p.x, p.y + 1.4, p.z);
    let reach = 1;
    for (let s = 0.1; s <= 1.0001; s += 0.04) {
      if (solidAt(look.x + (camPos.x - look.x) * s, look.y + (camPos.y - look.y) * s, look.z + (camPos.z - look.z) * s)) {
        reach = Math.max(0.12, s - 0.08);
        break;
      }
    }
    camPos.lerpVectors(look, camPos, reach);
    if (camera.position.distanceTo(camPos) > 30) camera.position.copy(camPos);   // a jump, not a walk
    else camera.position.lerp(camPos, Math.min(1, dt * (reach < 1 ? 14 : 6)));
    camera.lookAt(look);
    sun.target.position.set(p.x, 0, p.z);
    const n = nearest();
    promptEl.hidden = !n || dialog.open || state.mode === "end";
    if (n) promptEl.innerHTML = n.kind === "lantern" ? "<kbd>F</kbd> Light the lantern" : `<kbd>F</kbd> Talk to ${n.f.name}`;
    clockEl.textContent = clock(state.hour);
    countEl.textContent = `${state.lit} / ${N}`;
    if (now - mmLast > 80) { drawMinimap(); mmLast = now; }
  }
  sun.position.copy(sun.target.position).addScaledVector(sun.userData.dir || sunDir, 150);
  for (const f of folk) {
    if (f.role === "child" && !(dialog.open && dialog.who === f)) {
      f.angle = (f.angle ?? Math.atan2(f.z, f.x)) + dt * 0.45;
      const r = 3.4;
      f.mesh.position.set(Math.cos(f.angle) * r, 0, Math.sin(f.angle) * r);
      f.mesh.rotation.y = Math.atan2(-Math.sin(f.angle), Math.cos(f.angle));
      animate(f.mesh, dt, 0.8);
    } else animate(f.mesh, dt, 0);
  }
  for (const l of lanterns) {
    l.beacon.visible = !l.lit && state.mode !== "title";
    l.beacon.position.y = 4.5 + Math.sin(now * 0.002 + l.x) * 0.15;
    l.beacon.material.opacity = 0.35 + 0.25 * Math.sin(now * 0.004 + l.z);
  }
  smoke.update(dt, 0.75 - (state.night || 0) * 0.45);
  for (const l of lanterns) if (l.lit) l.light.intensity = l.base * (0.9 + 0.1 * Math.sin(now * 0.013 + l.x) * Math.sin(now * 0.007 + l.z));
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function fit() {
  // A phone held upright sees a narrow slice; widen the lens and step back.
  const portrait = innerWidth < innerHeight;
  camera.fov = portrait ? 60 : 45;
  state.dist = portrait ? 22 : 16;
  camera.updateProjectionMatrix();
}
fit();
addEventListener("resize", () => {
  fit();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
$("loading").hidden = true;
window.__lanternfall = { state, begin, setTime, player, town, lanterns, folk, interact, drawMinimap };

// ?enter=play or ?enter=wander skips the title; &hour=21 starts at that hour.
const q = new URLSearchParams(location.search);
if (q.get("hour")) { state.hour = +q.get("hour"); setTime(state.hour); }
if (q.get("enter") === "play" || q.get("enter") === "wander") {
  begin(q.get("enter"));
  if (q.get("hour")) { state.hour = +q.get("hour"); setTime(state.hour); }
}
