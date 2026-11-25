import * as THREE from 'three';
import { CHUNK_SIZE, DAY_LENGTH_TICKS } from '../config/constants';
import { BlockPos, Vec3 } from '../core/types';
import { ChunkMeshData, MeshBuffers } from '../world/worker/protocol';
import { TextureAtlas } from './TextureAtlas';

const VOXEL_VERT = /* glsl */ `
attribute vec3 color;
varying vec2 vUv;
varying vec3 vColor;
varying float vFogDepth;

void main() {
  vUv = uv;
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const VOXEL_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uSkyLightColor;
uniform vec3 uTorchColor;
uniform vec3 uMinAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;

varying vec2 vUv;
varying vec3 vColor;
varying float vFogDepth;

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (uAlphaTest > 0.0 && tex.a < uAlphaTest) {
    discard;
  }

  vec3 skyL = clamp(vColor.r, 0.0, 1.0) * uSkyLightColor;
  float blk = clamp(vColor.g, 0.0, 1.0);
  vec3 blockL = pow(blk, 1.25) * uTorchColor;
  // Screen blend sky & torch light so torches shine warmly in caves and at midnight
  vec3 combined = 1.0 - (1.0 - clamp(skyL, 0.0, 1.0)) * (1.0 - clamp(blockL, 0.0, 1.0));
  vec3 lit = max(combined, uMinAmbient);
  vec3 rgb = tex.rgb * lit * vColor.b;

  float fogFactor = clamp((vFogDepth - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);
  rgb = mix(rgb, uFogColor, fogFactor * fogFactor);

  gl_FragColor = vec4(rgb, tex.a);
}
`;

interface ChunkRenderEntry {
  group: THREE.Group;
  opaque?: THREE.Mesh;
  cutout?: THREE.Mesh;
  translucent?: THREE.Mesh;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly atlas: TextureAtlas;
  readonly entityGroup: THREE.Group;

  private readonly chunkGroup: THREE.Group;
  private readonly chunkEntries = new Map<string, ChunkRenderEntry>();

  private readonly sharedUniforms: {
    uAtlas: { value: THREE.CanvasTexture };
    uSkyLightColor: { value: THREE.Color };
    uTorchColor: { value: THREE.Color };
    uMinAmbient: { value: THREE.Color };
    uFogColor: { value: THREE.Color };
    uFogNear: { value: number };
    uFogFar: { value: number };
  };

  private readonly opaqueMat: THREE.ShaderMaterial;
  private readonly cutoutMat: THREE.ShaderMaterial;
  private readonly translucentMat: THREE.ShaderMaterial;

  // Sky objects
  private readonly skyGroup: THREE.Group;
  private readonly skyDomeMat: THREE.ShaderMaterial;
  private readonly starFieldMat: THREE.PointsMaterial;
  private readonly sunMesh: THREE.Mesh;
  private readonly moonMesh: THREE.Mesh;
  private readonly cloudsGroup: THREE.Group;
  private readonly cloudMat: THREE.MeshBasicMaterial;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly sunLight: THREE.DirectionalLight;

  // Reusable color constants & scratch vectors (zero per-frame allocations)
  private readonly colDayZenith = new THREE.Color(0x4b8ec9);
  private readonly colDayHorizon = new THREE.Color(0xa6cfe9);
  private readonly colDuskZenith = new THREE.Color(0x3a3b6e);
  private readonly colDuskHorizon = new THREE.Color(0xe37c46);
  private readonly colNightZenith = new THREE.Color(0x060a16);
  private readonly colNightHorizon = new THREE.Color(0x111a30);
  private readonly colWaterFog = new THREE.Color(0x1f5678);
  private readonly colDaySkyLight = new THREE.Color(1.0, 0.99, 0.96);
  private readonly colDuskSkyLight = new THREE.Color(0.96, 0.56, 0.34);
  private readonly colNightSkyLight = new THREE.Color(0.06, 0.08, 0.16);
  private readonly scratchZenith = new THREE.Color();
  private readonly scratchHorizon = new THREE.Color();
  private readonly scratchSkyLight = new THREE.Color();
  private readonly bgColor = new THREE.Color(0x88bce0);

  // Block selection outline & break crack overlay
  private readonly selectionBox: THREE.LineSegments;
  private readonly breakOverlay: THREE.Mesh;
  private readonly breakOverlayMat: THREE.MeshBasicMaterial;

  // First-person held item / hand + walk bobbing
  private readonly handGroup: THREE.Group;
  private readonly handArm: THREE.Group;
  private readonly handItemMesh: THREE.Mesh;
  private readonly handItemMat: THREE.MeshBasicMaterial;
  private readonly iconTextureCache = new Map<string, THREE.Texture>();
  private swingTime = 0;
  private bobPhase = 0;
  private bobStrength = 0;

  private lastDrawCalls = 0;
  private lastTriangles = 0;

  constructor(canvas: HTMLCanvasElement, fov = 75) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = this.bgColor;

    this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.08, 420);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.atlas = new TextureAtlas();

    this.sharedUniforms = {
      uAtlas: { value: this.atlas.texture },
      uSkyLightColor: { value: new THREE.Color(1.0, 0.99, 0.96) },
      uTorchColor: { value: new THREE.Color(1.25, 0.84, 0.46) },
      uMinAmbient: { value: new THREE.Color(0.032, 0.036, 0.052) },
      uFogColor: { value: new THREE.Color(0x88bce0) },
      uFogNear: { value: 72 },
      uFogFar: { value: 132 },
    };

    this.opaqueMat = new THREE.ShaderMaterial({
      uniforms: { ...this.sharedUniforms, uAlphaTest: { value: 0.0 } },
      vertexShader: VOXEL_VERT,
      fragmentShader: VOXEL_FRAG,
      side: THREE.FrontSide,
    });

    this.cutoutMat = new THREE.ShaderMaterial({
      uniforms: { ...this.sharedUniforms, uAlphaTest: { value: 0.5 } },
      vertexShader: VOXEL_VERT,
      fragmentShader: VOXEL_FRAG,
      side: THREE.DoubleSide,
    });

    this.translucentMat = new THREE.ShaderMaterial({
      uniforms: { ...this.sharedUniforms, uAlphaTest: { value: 0.0 } },
      vertexShader: VOXEL_VERT,
      fragmentShader: VOXEL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    this.chunkGroup = new THREE.Group();
    this.entityGroup = new THREE.Group();
    this.scene.add(this.chunkGroup, this.entityGroup);

    // Lighting for 3D entities (mobs, dropped items, hand)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.sunLight = new THREE.DirectionalLight(0xfff4dc, 0.85);
    this.sunLight.position.set(40, 80, 30);
    this.scene.add(this.ambientLight, this.sunLight);

    // Sky group (follows camera XZ)
    this.skyGroup = new THREE.Group();

    // Procedural zenith-to-horizon gradient sky dome (sunrise/sunset/day/night smooth transitions)
    this.skyDomeMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenithColor: { value: new THREE.Color(0x4b8ec9) },
        uHorizonColor: { value: new THREE.Color(0xaed3ec) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenithColor;
        uniform vec3 uHorizonColor;
        varying vec3 vWorldDir;
        void main() {
          float h = clamp(vWorldDir.y, 0.0, 1.0);
          float factor = pow(h, 0.55);
          vec3 col = mix(uHorizonColor, uZenithColor, factor);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(310, 24, 16), this.skyDomeMat);
    skyDome.renderOrder = -4;

    // Night starfield
    const starPositions = new Float32Array(260 * 3);
    for (let i = 0; i < 260; i++) {
      // Deterministic Fibonacci-ish upper hemisphere star distribution
      const phi = Math.acos(0.12 + ((i * 73) % 88) / 100);
      const theta = i * 2.3999632;
      const r = 285;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starFieldMat = new THREE.PointsMaterial({
      color: 0xe6eefc,
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const starField = new THREE.Points(starGeo, this.starFieldMat);
    starField.renderOrder = -3;

    const sunGeo = new THREE.PlaneGeometry(22, 22);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff3bc, fog: false, depthWrite: false, side: THREE.DoubleSide });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.sunMesh.renderOrder = -2;

    const moonGeo = new THREE.PlaneGeometry(16, 16);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xd9e6fa, fog: false, depthWrite: false, side: THREE.DoubleSide });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.moonMesh.renderOrder = -2;

    this.cloudMat = new THREE.MeshBasicMaterial({
      color: 0xf7f5ef,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.cloudsGroup = this.buildClouds();
    this.skyGroup.add(skyDome, starField, this.sunMesh, this.moonMesh, this.cloudsGroup);
    this.scene.add(this.skyGroup);

    // Selection wireframe box
    const boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1a1e24, transparent: true, opacity: 0.8 });
    this.selectionBox = new THREE.LineSegments(boxEdges, lineMat);
    this.selectionBox.visible = false;
    this.selectionBox.renderOrder = 4;
    this.scene.add(this.selectionBox);

    // Break crack overlay
    this.breakOverlayMat = new THREE.MeshBasicMaterial({
      map: this.atlas.breakTextures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.breakOverlay = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.breakOverlayMat);
    this.breakOverlay.visible = false;
    this.breakOverlay.renderOrder = 3;
    this.scene.add(this.breakOverlay);

    // First-person hand / tunic cuff / held item attached to camera
    this.handGroup = new THREE.Group();
    this.handGroup.position.set(0.42, -0.38, -0.62);
    this.handArm = new THREE.Group();
    const forearm = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.3, 0.15),
      new THREE.MeshLambertMaterial({ color: 0xc99c74 })
    );
    forearm.position.set(0, 0.06, 0);
    forearm.renderOrder = 10;
    const cuff = new THREE.Mesh(
      new THREE.BoxGeometry(0.168, 0.18, 0.168),
      new THREE.MeshLambertMaterial({ color: 0x4b6b47 })
    );
    cuff.position.set(0, -0.14, 0);
    cuff.renderOrder = 10;
    const wristBand = new THREE.Mesh(
      new THREE.BoxGeometry(0.174, 0.04, 0.174),
      new THREE.MeshLambertMaterial({ color: 0x7a5132 })
    );
    wristBand.position.set(0, -0.05, 0);
    wristBand.renderOrder = 10;
    this.handArm.add(forearm, cuff, wristBand);
    this.handArm.rotation.set(0.65, -0.25, 0.35);

    this.handItemMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthTest: false });
    this.handItemMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), this.handItemMat);
    this.handItemMesh.position.set(-0.04, 0.14, -0.05);
    this.handItemMesh.rotation.set(0.15, -0.35, 0.1);
    this.handItemMesh.visible = false;
    this.handItemMesh.renderOrder = 11;

    this.handGroup.add(this.handArm, this.handItemMesh);
    this.handGroup.visible = false; // Enabled once player survival/first-person mode is active
    this.camera.add(this.handGroup);

    window.addEventListener('resize', this.onResize);
  }

  private buildClouds(): THREE.Group {
    const group = new THREE.Group();
    // Deterministic layered cloud slabs at y = 118
    const coords = [
      [-60, -40, 26, 14], [10, -55, 32, 16], [70, -25, 22, 12],
      [-85, 20, 30, 18], [-15, 15, 28, 14], [48, 35, 34, 16],
      [-45, 72, 24, 14], [25, 80, 28, 12], [90, 65, 26, 16],
      [-95, -75, 24, 14], [65, -80, 28, 14],
    ];
    for (const [cx, cz, w, d] of coords) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), this.cloudMat);
      m.position.set(cx, 118, cz);
      group.add(m);
    }
    return group;
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setCamera(pos: Vec3, yaw: number, pitch: number, applyWalkBob = false): void {
    const bobWave = 0.5 - 0.5 * Math.cos(this.bobPhase * 2);
    const bobY = applyWalkBob ? bobWave * 0.036 * this.bobStrength : 0;
    const bobRoll = applyWalkBob ? Math.cos(this.bobPhase) * 0.006 * this.bobStrength : 0;
    this.camera.position.set(pos.x, pos.y + bobY, pos.z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
    this.camera.rotation.z = bobRoll;
  }

  setHandVisible(visible: boolean): void {
    this.handGroup.visible = visible;
  }

  setHeldItemIcon(iconKey: string | null): void {
    if (!iconKey) {
      this.handItemMesh.visible = false;
      return;
    }
    let tex = this.iconTextureCache.get(iconKey);
    if (!tex) {
      const dataUrl = this.atlas.getItemIcon(iconKey);
      const img = new Image();
      img.src = dataUrl;
      tex = new THREE.Texture(img);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      const createdTex = tex;
      img.onload = () => {
        createdTex.needsUpdate = true;
      };
      this.iconTextureCache.set(iconKey, tex);
    }
    this.handItemMat.map = tex;
    this.handItemMat.needsUpdate = true;
    this.handItemMesh.visible = true;
  }

  triggerHandSwing(): void {
    this.swingTime = 1.0;
  }

  updateHandAnimation(dt: number, moveSpeed: number, onGround: boolean): void {
    const targetStrength = onGround && moveSpeed > 0.25 ? Math.min(moveSpeed / 4.2, 1) : 0;
    this.bobStrength += (targetStrength - this.bobStrength) * Math.min(1, dt * 10);
    if (this.bobStrength > 0.01) {
      this.bobPhase += dt * Math.min(Math.max(moveSpeed, 1.5) * 2.1, 11);
    }

    if (!this.handGroup.visible) return;
    const bobX = Math.cos(this.bobPhase) * 0.024 * this.bobStrength;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.03 * this.bobStrength;

    if (this.swingTime > 0) {
      this.swingTime = Math.max(0, this.swingTime - dt * 4.8);
    }
    const swing = Math.sin(this.swingTime * Math.PI);
    this.handGroup.position.set(0.42 + bobX - swing * 0.14, -0.38 - bobY - swing * 0.08, -0.62 - swing * 0.12);
    this.handGroup.rotation.set(-swing * 0.85, swing * 0.28, swing * 0.25);
  }

  setTargetBlock(pos: BlockPos | null, height = 1.0): void {
    if (!pos) {
      this.selectionBox.visible = false;
      return;
    }
    this.selectionBox.visible = true;
    this.selectionBox.scale.set(1, height, 1);
    this.selectionBox.position.set(pos.x + 0.5, pos.y + height * 0.5, pos.z + 0.5);
  }

  setBreakOverlay(pos: BlockPos | null, progress: number, height = 1.0): void {
    if (!pos || progress <= 0.01) {
      this.breakOverlay.visible = false;
      return;
    }
    const stage = Math.min(
      this.atlas.breakTextures.length - 1,
      Math.max(0, Math.floor(progress * this.atlas.breakTextures.length))
    );
    this.breakOverlayMat.map = this.atlas.breakTextures[stage];
    this.breakOverlayMat.needsUpdate = true;
    this.breakOverlay.visible = true;
    this.breakOverlay.scale.set(1, height, 1);
    this.breakOverlay.position.set(pos.x + 0.5, pos.y + height * 0.5, pos.z + 0.5);
  }

  /**
   * Updates sun/moon orbit, sky color, fog, clouds, and shader sky-light tint smoothly from worldTime.
   * Convention: 0 = sunrise (06:00), 6000 = noon (12:00), 12000 = dusk (18:00), 18000 = midnight (00:00).
   */
  updateEnvironment(worldTime: number, renderDistance: number, cameraPos: Vec3, underwater = false): void {
    const dayPhase = ((worldTime % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS;
    const angle = (dayPhase / DAY_LENGTH_TICKS) * Math.PI * 2; // 0 = horizon east, PI/2 = zenith, PI = west, 3PI/2 = nadir
    const sunHeight = Math.sin(angle); // -1..1

    const orbitRadius = 175;
    this.skyGroup.position.set(cameraPos.x, 0, cameraPos.z);

    this.sunMesh.position.set(Math.cos(angle) * orbitRadius, Math.sin(angle) * orbitRadius + 50, -30);
    this.sunMesh.lookAt(cameraPos.x, 50, cameraPos.z);

    this.moonMesh.position.set(-Math.cos(angle) * orbitRadius, -Math.sin(angle) * orbitRadius + 50, -30);
    this.moonMesh.lookAt(cameraPos.x, 50, cameraPos.z);

    // Drift clouds gently
    const cloudOffset = ((worldTime * 0.025) % 200) - 100;
    this.cloudsGroup.position.x = cloudOffset;

    // Sky & lighting color curves (zenith + horizon gradient + fog matched to horizon, zero allocations)
    const zenithColor = this.scratchZenith;
    const horizonColor = this.scratchHorizon;
    const skyLight = this.scratchSkyLight;

    if (sunHeight >= 0.25) {
      zenithColor.copy(this.colDayZenith);
      horizonColor.copy(this.colDayHorizon);
      skyLight.copy(this.colDaySkyLight);
    } else if (sunHeight >= -0.18) {
      const t = (sunHeight + 0.18) / 0.43; // 0 at night, 0.5 at sunset peak, 1 at day
      if (t >= 0.5) {
        const k = (t - 0.5) * 2;
        zenithColor.copy(this.colDuskZenith).lerp(this.colDayZenith, k);
        horizonColor.copy(this.colDuskHorizon).lerp(this.colDayHorizon, k);
        skyLight.copy(this.colDuskSkyLight).lerp(this.colDaySkyLight, k);
      } else {
        const k = t * 2;
        zenithColor.copy(this.colNightZenith).lerp(this.colDuskZenith, k);
        horizonColor.copy(this.colNightHorizon).lerp(this.colDuskHorizon, k);
        skyLight.copy(this.colNightSkyLight).lerp(this.colDuskSkyLight, k);
      }
    } else {
      zenithColor.copy(this.colNightZenith);
      horizonColor.copy(this.colNightHorizon);
      skyLight.copy(this.colNightSkyLight);
    }

    // Star opacity fades smoothly in during dusk -> night
    this.starFieldMat.opacity = THREE.MathUtils.clamp((-sunHeight + 0.05) * 2.2, 0, 0.92);

    const viewDistBlocks = Math.max(3, renderDistance) * CHUNK_SIZE;
    if (underwater) {
      this.bgColor.copy(this.colWaterFog);
      this.skyDomeMat.uniforms.uZenithColor.value.copy(this.colWaterFog);
      this.skyDomeMat.uniforms.uHorizonColor.value.copy(this.colWaterFog);
      this.sharedUniforms.uFogColor.value.copy(this.colWaterFog);
      this.sharedUniforms.uFogNear.value = 2;
      this.sharedUniforms.uFogFar.value = 26;
    } else {
      this.bgColor.copy(horizonColor);
      this.skyDomeMat.uniforms.uZenithColor.value.copy(zenithColor);
      this.skyDomeMat.uniforms.uHorizonColor.value.copy(horizonColor);
      this.sharedUniforms.uFogColor.value.copy(horizonColor);
      this.sharedUniforms.uFogNear.value = viewDistBlocks * 0.56;
      this.sharedUniforms.uFogFar.value = viewDistBlocks * 1.02;
    }

    this.sharedUniforms.uSkyLightColor.value.copy(skyLight);
    // Keep min ambient genuinely dark so unlit caves & midnight are dark and torches pop
    this.sharedUniforms.uMinAmbient.value.setRGB(0.02, 0.024, 0.036);

    // Sync entity Three.js lighting with day/night
    const daylightScalar = THREE.MathUtils.clamp((sunHeight + 0.15) / 0.5, 0.12, 1.0);
    this.ambientLight.intensity = 0.22 + daylightScalar * 0.5;
    this.sunLight.intensity = Math.max(0.05, sunHeight) * 0.9;
    this.sunLight.position.set(Math.cos(angle) * 60, Math.sin(angle) * 60 + 20, -20);

    // Tint shared cloud material by daylight (O(1))
    const cloudBright = 0.18 + daylightScalar * 0.82;
    this.cloudMat.color.setRGB(cloudBright, cloudBright * 0.98, cloudBright * 0.96);
  }

  private createBufferGeometry(buf: MeshBuffers): THREE.BufferGeometry | null {
    if (buf.indices.length === 0 || buf.positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buf.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(buf.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(buf.uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(buf.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(buf.indices, 1));
    // Exact conservative local chunk bounding sphere [0..16, 0..128, 0..16] avoids O(N vertices) CPU scan on upload
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 64, 8), 65.5);
    return geo;
  }

  setChunkMesh(cx: number, cz: number, data: ChunkMeshData): void {
    const key = `${cx},${cz}`;
    this.removeChunkMesh(cx, cz);

    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    const entry: ChunkRenderEntry = { group };

    const opaqueGeo = this.createBufferGeometry(data.opaque);
    if (opaqueGeo) {
      const m = new THREE.Mesh(opaqueGeo, this.opaqueMat);
      m.frustumCulled = true;
      group.add(m);
      entry.opaque = m;
    }

    const cutoutGeo = this.createBufferGeometry(data.cutout);
    if (cutoutGeo) {
      const m = new THREE.Mesh(cutoutGeo, this.cutoutMat);
      m.frustumCulled = true;
      group.add(m);
      entry.cutout = m;
    }

    const transGeo = this.createBufferGeometry(data.translucent);
    if (transGeo) {
      const m = new THREE.Mesh(transGeo, this.translucentMat);
      m.renderOrder = 2;
      m.frustumCulled = true;
      group.add(m);
      entry.translucent = m;
    }

    this.chunkGroup.add(group);
    this.chunkEntries.set(key, entry);
  }

  removeChunkMesh(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    const existing = this.chunkEntries.get(key);
    if (!existing) return;
    if (existing.opaque) existing.opaque.geometry.dispose();
    if (existing.cutout) existing.cutout.geometry.dispose();
    if (existing.translucent) existing.translucent.geometry.dispose();
    this.chunkGroup.remove(existing.group);
    this.chunkEntries.delete(key);
  }

  clearAllChunks(): void {
    for (const [key, entry] of this.chunkEntries) {
      if (entry.opaque) entry.opaque.geometry.dispose();
      if (entry.cutout) entry.cutout.geometry.dispose();
      if (entry.translucent) entry.translucent.geometry.dispose();
      this.chunkGroup.remove(entry.group);
      this.chunkEntries.delete(key);
    }
  }

  getChunkMeshCount(): number {
    return this.chunkEntries.size;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.lastDrawCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return { drawCalls: this.lastDrawCalls, triangles: this.lastTriangles };
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.clearAllChunks();
    for (const tex of this.iconTextureCache.values()) {
      tex.dispose();
    }
    this.iconTextureCache.clear();
    this.cloudMat.dispose();
    this.opaqueMat.dispose();
    this.cutoutMat.dispose();
    this.translucentMat.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
  }
}
