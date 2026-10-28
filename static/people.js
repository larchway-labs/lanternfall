// Townsfolk: simple jointed figures, so a walk can swing their arms and legs.
import * as THREE from "three";

const SKIN = [0xe8c4a0, 0xd9a77e, 0xb98a62, 0x8d5f3f];
const LOOKS = {
  player: { tunic: 0x3f5a3a, legs: 0x3a2e24, hair: 0x5a3b22, hood: 0x4a3a2a },
  innkeeper: { tunic: 0x8a5a3a, legs: 0x3a2e24, hair: 0x2a1c14, apron: 0xe8e0cc },
  guard: { tunic: 0x7a2b25, legs: 0x2e2a28, hair: 0x3a2a1a, helm: 0x8a8d90 },
  priest: { tunic: 0x2a2a30, legs: 0x2a2a30, hair: 0x9a9a9a, robe: 0x2a2a30 },
  baker: { tunic: 0xc9a46a, legs: 0x4a3a2a, hair: 0x7a4a24, apron: 0xf2ece0 },
  child: { tunic: 0x3a5a8a, legs: 0x5a4a3a, hair: 0xb07a3a, small: true },
  lamplighter: { tunic: 0x5a4a6a, legs: 0x2e2a28, hair: 0xd8d8d8, hat: 0x2a2420 },
};

export function makePerson(role, seed = 0) {
  const look = LOOKS[role] || LOOKS.baker;
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const g = new THREE.Group();
  const scale = look.small ? 0.68 : 1;
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  g.add(body);
  const skin = mat(SKIN[seed % SKIN.length]);
  const parts = {};
  const limb = (w, h, colour, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(w, h, 4, 8), mat(colour));
    m.position.y = -h / 2 - w / 2;
    pivot.add(m);
    body.add(pivot);
    return pivot;
  };
  parts.legL = limb(0.1, 0.62, look.legs, -0.12, 0.88);
  parts.legR = limb(0.1, 0.62, look.legs, 0.12, 0.88);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.72, 12), mat(look.tunic));
  torso.position.y = 1.22;
  body.add(torso);
  if (look.robe) {
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.95, 12), mat(look.robe));
    robe.position.y = 0.5;
    body.add(robe);
  }
  if (look.apron) {
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.62, 0.04), mat(look.apron));
    apron.position.set(0, 0.95, 0.28);
    body.add(apron);
  }
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.07, 12), mat(0x2a1e16));
  belt.position.y = 0.92;
  body.add(belt);
  parts.armL = limb(0.075, 0.5, look.tunic, -0.33, 1.52);
  parts.armR = limb(0.075, 0.5, look.tunic, 0.33, 1.52);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin);
  head.position.y = 1.8;
  body.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(look.hair));
  hair.position.y = 1.82;
  hair.rotation.x = -0.25;
  body.add(hair);
  if (look.hood) {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 12, 1, true), mat(look.hood));
    hood.position.set(0, 1.92, -0.04);
    hood.material.side = THREE.DoubleSide;
    body.add(hood);
    const cloak = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.1, 12, 1, true, Math.PI * 0.6, Math.PI * 0.8), mat(look.hood));
    cloak.material.side = THREE.DoubleSide;
    cloak.position.y = 1.08;
    body.add(cloak);
  }
  if (look.helm) {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: look.helm, metalness: 0.7, roughness: 0.35 }));
    helm.position.y = 1.84;
    body.add(helm);
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.6, 6), mat(0x4a3424));
    spear.position.set(0.42, 1.3, 0.1);
    body.add(spear);
  }
  if (look.hat) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16), mat(look.hat));
    brim.position.y = 1.92;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.25, 16), mat(look.hat));
    crown.position.y = 2.05;
    body.add(brim, crown);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { parts, phase: seed, walk: 0 };
  return g;
}

// Swing the limbs: `speed` 0 is standing, 1 a walk, 1.8 a run.
export function animate(person, dt, speed) {
  const u = person.userData;
  u.walk += (speed - u.walk) * Math.min(1, dt * 10);
  u.phase += dt * (3 + 5 * u.walk);
  const s = Math.sin(u.phase) * 0.7 * Math.min(1, u.walk);
  u.parts.legL.rotation.x = s;
  u.parts.legR.rotation.x = -s;
  u.parts.armL.rotation.x = -s * 0.8;
  u.parts.armR.rotation.x = s * 0.8;
  const idle = Math.sin(u.phase * 0.5) * 0.02 * (1 - Math.min(1, u.walk));
  person.children[0].position.y = Math.abs(Math.sin(u.phase)) * 0.05 * u.walk + idle;
}

// A see-through copy drawn only where something stands in front of it, so
// the player is never lost behind a house.
export function ghostOf(person) {
  const ghost = new THREE.MeshBasicMaterial({ color: 0xf2d8a8, transparent: true, opacity: 0.35, depthWrite: false, depthFunc: THREE.GreaterDepth });
  const meshes = [];
  person.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    // The figure itself draws after its ghost, so the ghost is tested against
    // the town's depth alone and never against the figure's own limbs.
    m.material.transparent = true;
    m.renderOrder = 20;
    const twin = new THREE.Mesh(m.geometry, ghost);
    twin.renderOrder = 10;
    m.add(twin);
  }
}
