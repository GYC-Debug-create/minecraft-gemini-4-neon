import * as THREE from 'three';
import { Entity } from './EntitySystem';
import { MobEntity, MobKind } from './Mob';

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color })
  );
}

/**
 * Procedural articulated original voxel 3D models for all 6 Stoneroot mobs.
 * Zero commercial-game color schemes or silhouettes.
 */
export function createMobMesh(kind: MobKind): THREE.Group {
  const root = new THREE.Group();
  const limbs: THREE.Object3D[] = [];

  if (kind === 'husk') {
    // Ash Husk: gaunt ash-grey shrouded undead with weathered ochre bandages & glowing amber eyes
    const torso = box(0.52, 0.72, 0.28, 0x8b7e68); // tattered ochre wrap
    torso.position.y = 1.04;
    const head = box(0.44, 0.44, 0.44, 0x787d82); // ash-slate skull/skin
    head.position.y = 1.64;
    const eyeL = box(0.08, 0.06, 0.04, 0xf2a83b); // glowing amber eyes
    eyeL.position.set(-0.1, 1.66, -0.22);
    const eyeR = box(0.08, 0.06, 0.04, 0xf2a83b);
    eyeR.position.set(0.1, 1.66, -0.22);

    const armL = box(0.18, 0.62, 0.18, 0x6b7075);
    armL.position.set(-0.36, 1.24, -0.24);
    armL.rotation.x = 1.25;
    const armR = box(0.18, 0.62, 0.18, 0x6b7075);
    armR.position.set(0.36, 1.24, -0.24);
    armR.rotation.x = 1.25;

    const legL = box(0.2, 0.68, 0.2, 0x4e4a44);
    legL.position.set(-0.14, 0.34, 0);
    const legR = box(0.2, 0.68, 0.2, 0x4e4a44);
    legR.position.set(0.14, 0.34, 0);

    limbs.push(legL, legR);
    root.add(torso, head, eyeL, eyeR, armL, armR, legL, legR);
  } else if (kind === 'bone_archer') {
    // Hollow Archer: hooded slate-cloak bone ranger holding wooden recurve bow
    const ribcage = box(0.42, 0.68, 0.22, 0xe4dfd1); // warm ivory bones
    ribcage.position.y = 1.04;
    const hood = box(0.48, 0.48, 0.48, 0x3b444f); // ranger cloak hood
    hood.position.y = 1.64;
    const skullFace = box(0.36, 0.36, 0.06, 0xe8e2d5);
    skullFace.position.set(0, 1.62, -0.23);
    const eyeL = box(0.08, 0.07, 0.05, 0x22262c);
    eyeL.position.set(-0.08, 1.65, -0.25);
    const eyeR = box(0.08, 0.07, 0.05, 0x22262c);
    eyeR.position.set(0.08, 1.65, -0.25);

    const armL = box(0.12, 0.64, 0.12, 0xd9d3c5);
    armL.position.set(-0.3, 1.24, -0.22);
    armL.rotation.x = 1.3;
    const armR = box(0.12, 0.64, 0.12, 0xd9d3c5);
    armR.position.set(0.3, 1.24, -0.24);
    armR.rotation.x = 1.4;

    // Recurve bow held forward
    const bow = box(0.08, 0.66, 0.12, 0x7d5532);
    bow.position.set(0.32, 1.28, -0.52);

    const legL = box(0.12, 0.7, 0.12, 0xd9d3c5);
    legL.position.set(-0.13, 0.35, 0);
    const legR = box(0.12, 0.7, 0.12, 0xd9d3c5);
    legR.position.set(0.13, 0.35, 0);

    limbs.push(legL, legR);
    root.add(ribcage, hood, skullFace, eyeL, eyeR, armL, armR, bow, legL, legR);
  } else if (kind === 'gloom_spider') {
    // Gloom Spider: wide 8-legged burgundy & violet cavern arachnid with 6 golden eyes
    const abdomen = box(0.76, 0.44, 0.76, 0x4b1d33); // deep burgundy
    abdomen.position.set(0, 0.42, 0.36);
    const stripe = box(0.34, 0.46, 0.62, 0x7a3b7e); // violet stripe
    stripe.position.set(0, 0.44, 0.36);
    const thorax = box(0.54, 0.36, 0.5, 0x351727);
    thorax.position.set(0, 0.38, -0.22);

    // 6 golden eyes
    for (let i = -1; i <= 1; i++) {
      const eTop = box(0.07, 0.06, 0.05, 0xf2c94c);
      eTop.position.set(i * 0.13, 0.45, -0.47);
      const eBot = box(0.06, 0.05, 0.05, 0xf2c94c);
      eBot.position.set(i * 0.11, 0.35, -0.47);
      root.add(eTop, eBot);
    }

    // 8 splayed legs
    for (let side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const leg = box(0.58, 0.09, 0.09, 0x2c1420);
        leg.position.set(side * 0.48, 0.24, -0.25 + i * 0.22);
        leg.rotation.z = side * -0.45;
        limbs.push(leg);
        root.add(leg);
      }
    }
    root.add(abdomen, stripe, thorax);
  } else if (kind === 'boar') {
    // Meadow Boar: stout russet-brown pig/boar with pale ivory tusks
    const body = box(0.68, 0.52, 0.96, 0x7c4a32);
    body.position.set(0, 0.52, 0);
    const head = box(0.48, 0.42, 0.44, 0x6b3d28);
    head.position.set(0, 0.58, -0.58);
    const snout = box(0.24, 0.18, 0.16, 0x9b664f);
    snout.position.set(0, 0.5, -0.84);
    const tuskL = box(0.06, 0.14, 0.06, 0xf0ead8);
    tuskL.position.set(-0.14, 0.52, -0.84);
    const tuskR = box(0.06, 0.14, 0.06, 0xf0ead8);
    tuskR.position.set(0.14, 0.52, -0.84);
    for (const [lx, lz] of [[-0.22, -0.32], [0.22, -0.32], [-0.22, 0.32], [0.22, 0.32]]) {
      const leg = box(0.18, 0.32, 0.18, 0x4c2b1d);
      leg.position.set(lx, 0.16, lz);
      limbs.push(leg);
      root.add(leg);
    }
    root.add(body, head, snout, tuskL, tuskR);
  } else if (kind === 'ram') {
    // Woolhorn Ram: cream woolly body, charcoal face, curved golden-ochre horns
    const wool = box(0.72, 0.62, 1.0, 0xeae5d9);
    wool.position.set(0, 0.66, 0);
    const head = box(0.42, 0.4, 0.44, 0x403e3c);
    head.position.set(0, 0.86, -0.58);
    const hornL = box(0.14, 0.22, 0.24, 0xc69848);
    hornL.position.set(-0.26, 0.96, -0.52);
    const hornR = box(0.14, 0.22, 0.24, 0xc69848);
    hornR.position.set(0.26, 0.96, -0.52);
    for (const [lx, lz] of [[-0.22, -0.32], [0.22, -0.32], [-0.22, 0.32], [0.22, 0.32]]) {
      const leg = box(0.16, 0.4, 0.16, 0x4a4542);
      leg.position.set(lx, 0.2, lz);
      limbs.push(leg);
      root.add(leg);
    }
    root.add(wool, head, hornL, hornR);
  } else {
    // Crested Fowl: slate-blue body, amber crest & beak
    const body = box(0.42, 0.34, 0.52, 0x5c728a);
    body.position.set(0, 0.38, 0);
    const head = box(0.26, 0.28, 0.26, 0x6e859e);
    head.position.set(0, 0.62, -0.24);
    const crest = box(0.08, 0.14, 0.22, 0xd87a34);
    crest.position.set(0, 0.8, -0.24);
    const beak = box(0.1, 0.08, 0.14, 0xe3b444);
    beak.position.set(0, 0.58, -0.4);
    const legL = box(0.07, 0.22, 0.07, 0xd89c3c);
    legL.position.set(-0.1, 0.11, 0);
    const legR = box(0.07, 0.22, 0.07, 0xd89c3c);
    legR.position.set(0.1, 0.11, 0);
    limbs.push(legL, legR);
    root.add(body, head, crest, beak, legL, legR);
  }

  // Sun-burn flame visual (hidden unless burning)
  const flame = box(0.55, 0.75, 0.55, 0xf58426);
  flame.position.y = 1.0;
  (flame.material as THREE.MeshLambertMaterial).transparent = true;
  (flame.material as THREE.MeshLambertMaterial).opacity = 0.55;
  flame.visible = false;
  root.add(flame);

  root.userData.limbs = limbs;
  root.userData.flame = flame;
  return root;
}

export function animateMobVisual(entity: Entity, obj: THREE.Object3D): void {
  if (!(entity instanceof MobEntity)) return;
  const limbs = obj.userData.limbs as THREE.Object3D[] | undefined;
  if (limbs) {
    for (let i = 0; i < limbs.length; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      limbs[i].rotation.x = Math.sin(entity.walkPhase) * 0.55 * sign;
    }
  }
  const flame = obj.userData.flame as THREE.Mesh | undefined;
  if (flame) {
    flame.visible = entity.burning;
  }

  // Red hurt tint flash
  const isHurt = entity.hurtFlashTicks > 0;
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child !== flame) {
      const mat = child.material as THREE.MeshLambertMaterial;
      mat.emissive.setHex(isHurt ? 0x991f1f : 0x000000);
    }
  });
}
