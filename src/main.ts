import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';

// Keep the modeled camera tour on the 1180-frame reference timeline.
const DURATION = 1180 / 30;
const TAU = Math.PI * 2;
const narrow = window.innerWidth / window.innerHeight < 1.5;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const seekTime = Number(params.get('t'));

const app = document.querySelector<HTMLDivElement>('#app')!;
const mount = document.querySelector<HTMLDivElement>('#scene')!;
const loader = document.querySelector<HTMLDivElement>('#loader')!;
const errorText = document.querySelector<HTMLParagraphElement>('#error')!;
const playButton = document.querySelector<HTMLButtonElement>('#play-button')!;
const modeButton = document.querySelector<HTMLButtonElement>('#mode-button')!;
const exploreUi = document.querySelector<HTMLDivElement>('#explore-ui')!;
const fullscreenButton = document.querySelector<HTMLButtonElement>('#fullscreen-button')!;
const timeline = document.querySelector<HTMLInputElement>('#timeline')!;
const timecode = document.querySelector<HTMLSpanElement>('#timecode')!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071a31);
scene.fog = new THREE.FogExp2(0x0b2a47, 0.00013);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .1, 6500);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, narrow ? 1 : 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
mount.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .35, .42, .91));
composer.addPass(new OutputPass());

const clock = new THREE.Clock();
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const warmPalette = [0xffdf71, 0xf1c952, 0xffe9a1, 0xbfd0b0, 0xe2b945];
const skyPalette = [0x1a3764, 0x315784, 0x638eaa, 0x93b5b6, 0xc0c8b8, 0x54779a, 0x284b80];
const groundPalette = [0x26365b, 0x3e4a72, 0x316078, 0x506c75, 0x647891, 0x756a78, 0x8f8578, 0x183047];
const animated: Array<{ object: THREE.Object3D; speed: number; phase: number }> = [];
const billboards: THREE.Object3D[] = [];
const shaderTime = { value: 0 };
const tempV = new THREE.Vector3();
const baseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const turnQuat = new THREE.Quaternion();
const zAxis = new THREE.Vector3(0, 0, 1);

let seed = 188906;
function rand(): number { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function range(a: number, b: number): number { return a + (b - a) * rand(); }
function pick<T>(values: T[]): T { return values[Math.floor(rand() * values.length)]; }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

function makeStroke(): THREE.BufferGeometry {
  const ring = [[-.55,0],[-.43,.36],[-.15,.49],[.23,.41],[.51,.15],[.55,-.10],[.27,-.40],[-.15,-.48],[-.46,-.25]];
  const vertices = [0, 0, .16];
  const indices: number[] = [];
  ring.forEach(([x, y]) => vertices.push(x, y, 0));
  for (let i = 1; i <= ring.length; i++) indices.push(0, i, i === ring.length ? 1 : i + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
const strokeGeometry = makeStroke();

function brushMesh(count: number, opacity = 1): THREE.InstancedMesh {
  const opaque = opacity >= .85;
  const mesh = new THREE.InstancedMesh(strokeGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: !opaque, opacity: opaque ? 1 : opacity, side: THREE.DoubleSide, depthWrite: opaque }), count);
  mesh.frustumCulled = false;
  return mesh;
}
function finishInstances(mesh: THREE.InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
type Sampler = (u: number, v: number) => [number, number, number];
function imageSampler(texture: THREE.Texture): Sampler {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 380;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return (u, v) => {
    const x = Math.floor(clamp(u, 0, .999) * canvas.width);
    const y = Math.floor(clamp(v, 0, .999) * canvas.height);
    const i = (y * canvas.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
}

function addAtmosphere(texture: THREE.Texture): void {
  const shell = new THREE.Mesh(new THREE.SphereGeometry(4200, 48, 32), new THREE.ShaderMaterial({
    uniforms: { uTime: shaderTime }, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vP; void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      uniform float uTime; varying vec3 vP;
      void main(){
        vec3 d=normalize(vP);
        float a=atan(d.y,d.x);
        float wave=sin(a*24.0+sin(d.z*13.0+uTime*.035)*3.0)*.5+.5;
        float wave2=sin(a*49.0-d.z*21.0+uTime*.025)*.5+.5;
        vec3 deep=vec3(.011,.055,.105);
        vec3 teal=vec3(.054,.22,.28);
        vec3 ink=vec3(.009,.031,.083);
        vec3 c=mix(deep,teal,wave*.34+wave2*.11);
        c=mix(c,ink,smoothstep(-.5,.65,-d.y)*.37);
        gl_FragColor=vec4(c,1.0);
      }
    `,
  }));
  scene.add(shell);

  // A distant, blurred color echo continues the painted sky beyond the stroke cloud.
  const echo = new THREE.Mesh(new THREE.PlaneGeometry(14000, 7000), new THREE.ShaderMaterial({
    uniforms: { uTexture: { value: texture }, uTime: shaderTime }, side: THREE.DoubleSide, depthWrite: false, fog: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      uniform sampler2D uTexture;uniform float uTime;varying vec2 vUv;
      void main(){
        vec2 q=vUv+vec2(sin(vUv.y*12.0+uTime*.025),cos(vUv.x*9.0-uTime*.02))*.012;
        vec3 c=texture2D(uTexture,q).rgb*.22;
        c+=texture2D(uTexture,q+vec2(.012,.009)).rgb*.12;
        c+=texture2D(uTexture,q-vec2(.012,.009)).rgb*.12;
        c=mix(c,vec3(.015,.08,.14),.4);
        float edge=min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y));
        c*=smoothstep(0.0,.13,edge);
        gl_FragColor=vec4(c,1.0);
      }
    `,
  }));
  echo.position.set(0, 490, -2050);
  scene.add(echo);
}

function terrainHeight(x: number, z: number): number {
  const valley = -280 + 23 * Math.sin(x * .0058 + z * .0027) + 19 * Math.cos(z * .009 - x * .0034);
  const ridge = 105 * Math.exp(-Math.pow((z + 1160) / 330, 2));
  const mountain = 55 * Math.sin(x * .0032 + 1.2) * Math.exp(-Math.pow((z + 1030) / 470, 2));
  return valley + ridge + mountain;
}

function addTerrain(): void {
  const geometry = new THREE.PlaneGeometry(3900, 5300, 156, 180);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -200);
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const h = terrainHeight(x, z);
    positions.setY(i, h);
    const v = Math.sin(x * .013 + z * .009) * .5 + .5;
    const c = new THREE.Color(groundPalette[Math.floor(v * (groundPalette.length - 1))]);
    c.multiplyScalar(z < -650 ? .56 : .48);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  const count = narrow ? 23000 : 49000;
  const brush = brushMesh(count);
  for (let i = 0; i < count; i++) {
    const x = range(-1870, 1870), z = range(-1850, 2370);
    const y = terrainHeight(x, z) + range(1, 4);
    const angle = Math.sin(x * .004 + z * .003) * .38 + range(-.25, .25);
    dummy.position.set(x, y, z);
    turnQuat.setFromAxisAngle(zAxis, angle);
    dummy.quaternion.copy(baseQuat).multiply(turnQuat);
    dummy.scale.set(range(10, 38), range(2, 6), 1);
    dummy.updateMatrix();
    brush.setMatrixAt(i, dummy.matrix);
    color.set(pick(groundPalette));
    color.multiplyScalar(range(.53, 1.2));
    brush.setColorAt(i, color);
  }
  finishInstances(brush);
  scene.add(brush);
}

function addVillage(): void {
  const count = narrow ? 900 : 1900;
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
  const lights = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), count);
  const wallColors = [0x13273c, 0x1b3047, 0x314153, 0x4b5662, 0x283951, 0x5c6464];
  const roofColors = [0x14233d, 0x1c2c48, 0x2a3551, 0x353a4a, 0x433b43];
  let lightCount = 0;
  for (let i = 0; i < count; i++) {
    const x = range(-1210, 1210), z = range(-980, -230);
    const h = terrainHeight(x, z);
    const width = range(10, 28), height = range(9, 29);
    dummy.position.set(x, h + height / 2, z);
    dummy.quaternion.identity();
    dummy.scale.set(width, height, width * range(.65, 1.12));
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    color.set(pick(wallColors)).multiplyScalar(range(.72, 1.17));
    bodies.setColorAt(i, color);
    dummy.position.set(x, h + height + width * .2, z);
    dummy.rotation.set(0, Math.PI / 4, 0);
    dummy.scale.set(width * .85, width * .46, width * .85);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    roofs.setColorAt(i, new THREE.Color(pick(roofColors)));
    if (rand() > .24) {
      dummy.position.set(x + range(-width * .19, width * .19), h + height * range(.38, .72), z + width * .52 + .5);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(range(1.5, 3.4), range(2, 4.5), 1);
      dummy.updateMatrix();
      lights.setMatrixAt(lightCount, dummy.matrix);
      lights.setColorAt(lightCount, new THREE.Color(pick([0xe7c363, 0xffdb86, 0xaac5b8])));
      lightCount++;
    }
  }
  lights.count = lightCount;
  finishInstances(bodies); finishInstances(roofs); finishInstances(lights);
  scene.add(bodies, roofs, lights);

  const treeCount = narrow ? 600 : 1400;
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), treeCount);
  for (let i = 0; i < treeCount; i++) {
    const x = range(-1800, 1800), z = range(-1370, -350);
    const height = range(8, 36);
    dummy.position.set(x, terrainHeight(x, z) + height / 2, z);
    dummy.rotation.set(0, range(0, TAU), 0);
    dummy.scale.set(height * .19, height, height * .19);
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
    trees.setColorAt(i, new THREE.Color(pick([0x102d3d, 0x153549, 0x1a3b48, 0x263c50])));
  }
  finishInstances(trees);
  scene.add(trees);

  const church = new THREE.Group();
  church.position.set(-60, terrainHeight(-60, -590), -590);
  const wall = new THREE.MeshBasicMaterial({ color: 0x87928b });
  const slate = new THREE.MeshBasicMaterial({ color: 0x263d53 });
  const nave = new THREE.Mesh(new THREE.BoxGeometry(32, 47, 49), wall);
  nave.position.y = 24;
  church.add(nave);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(14, 100, 17), wall);
  tower.position.set(0, 74, 10);
  church.add(tower);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(20, 74, 4), slate);
  spire.position.set(0, 161, 10);
  spire.rotation.y = Math.PI / 4;
  church.add(spire);
  scene.add(church);
}

function flameGeometry(height: number, width: number): THREE.BufferGeometry {
  const sides = 9, rings = 27;
  const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let y = 0; y <= rings; y++) {
    const t = y / rings;
    const radius = width * Math.pow(1 - t, 1.13) * (.78 + Math.sin(t * 22) * .13);
    const drift = Math.sin(t * 8.4) * width * .15;
    for (let side = 0; side < sides; side++) {
      const a = side / sides * TAU;
      const rough = 1 + Math.sin(a * 5 + t * 32) * .13;
      vertices.push(drift + Math.cos(a) * radius * rough, t * height, Math.sin(a) * radius * .58 * rough);
      const c = new THREE.Color(pick([0x071f28, 0x0b2b32, 0x153b3e, 0x1c4540, 0x463c2f]));
      colors.push(c.r, c.g, c.b);
      if (y < rings) {
        const n = y * sides + side, m = y * sides + (side + 1) % sides;
        indices.push(n, m, n + sides, m, m + sides, n + sides);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addCypress(x: number, z: number, scale: number): void {
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(x, z) - 12, z);
  const spires = [
    { x: -48, z: -16, h: 440, w: 86 },
    { x: 22, z: 5, h: 585, w: 97 },
    { x: 90, z: -28, h: 290, w: 83 },
    { x: -93, z: -19, h: 235, w: 65 },
  ];
  for (const s of spires) {
    const mesh = new THREE.Mesh(flameGeometry(s.h, s.w), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.position.set(s.x, 0, s.z);
    group.add(mesh);
  }
  const count = narrow ? 3500 : 7600;
  const leaves = brushMesh(count);
  const leavesPalette = [0x0a2930, 0x10383a, 0x224840, 0x365243, 0x685740, 0x1c3741, 0x172b32];
  for (let i = 0; i < count; i++) {
    const s = pick(spires);
    const t = rand() * .98;
    const a = range(0, TAU);
    const radius = s.w * Math.pow(1 - t, 1.15) * range(.65, 1.13);
    const px = s.x + Math.sin(t * 8.4) * s.w * .15 + Math.cos(a) * radius;
    const py = t * s.h;
    const pz = s.z + Math.sin(a) * radius * .61 + range(-9, 9);
    dummy.position.set(px, py, pz);
    dummy.rotation.set(range(-.2, .2), range(-.22, .22), Math.PI / 2 + Math.sin(py * .018) * .27 + range(-.32, .32));
    dummy.scale.set(range(9, 35), range(1.5, 4.5), 1);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    color.set(pick(leavesPalette)).multiplyScalar(range(.75, 1.18));
    leaves.setColorAt(i, color);
  }
  finishInstances(leaves);
  group.add(leaves);
  group.scale.set(scale * .82, scale * 1.6, scale * .82);
  scene.add(group);
}

function swirlAngle(x: number, y: number): number {
  let angle = Math.sin(y * .005 + x * .002) * .16;
  for (const [cx, cy, r] of [[-180, 620, 630], [495, 570, 335]]) {
    const dx = x - cx, dy = y - cy;
    const weight = Math.exp(-(dx * dx + dy * dy) / (r * r));
    const tangent = Math.atan2(dy, dx) + Math.PI / 2;
    angle += Math.atan2(Math.sin(tangent - angle), Math.cos(tangent - angle)) * weight * .83;
  }
  return angle;
}

function addSkyStrokes(sample: Sampler): void {
  const count = narrow ? 41000 : 88000;
  const strokes = brushMesh(count, .96);
  for (let i = 0; i < count; i++) {
    const x = range(-1630, 1630), y = range(100, 1310);
    const u = (x + 1630) / 3260;
    const v = (1310 - y) / 1770;
    let [r, g, b] = sample(u, v);
    if (u < .41 && v > .08 && (r + g + b) / 3 < 62) [r, g, b] = sample(clamp(u + .31, 0, .99), v);
    if (u > .77 && v < .36) [r, g, b] = sample(.67, v);
    const wave = Math.sin(x * .0035 + y * .005) * 120 + Math.cos(x * .006 - y * .004) * 65;
    const moonDistance = Math.hypot(x - 1050, y - 865);
    const z = moonDistance < 355 ? -1240 + range(-140, 40) : -1060 + wave + range(-260, 250);
    dummy.position.set(x, y, z);
    dummy.rotation.set(range(-.12, .12), range(-.15, .15), swirlAngle(x, y) + range(-.32, .32));
    dummy.scale.set(range(8, 31), range(1.5, 6.5), 1);
    dummy.updateMatrix();
    strokes.setMatrixAt(i, dummy.matrix);
    color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    color.multiplyScalar(range(.7, 1.42));
    strokes.setColorAt(i, color);
  }
  finishInstances(strokes);
  scene.add(strokes);
}

function addVortex(cx: number, cy: number, cz: number, radius: number, count: number, direction: number): void {
  const group = new THREE.Group();
  group.position.set(cx, cy, cz);
  const strokes = brushMesh(count, .88);
  for (let i = 0; i < count; i++) {
    const t = rand();
    const a = direction * (t * Math.PI * 4.25 + range(-.24, .24));
    const r = 18 + radius * t + range(-21, 21);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * .66;
    const z = Math.sin(a * .7 + t * 4) * 105 + range(-95, 95);
    dummy.position.set(x, y, z);
    dummy.rotation.set(range(-.15, .15), range(-.15, .15), Math.atan2(Math.cos(a) * .66, -Math.sin(a)) + range(-.18, .18));
    dummy.scale.set(range(10, 44), range(1.6, 5.5), 1);
    dummy.updateMatrix();
    strokes.setMatrixAt(i, dummy.matrix);
    color.set(pick(skyPalette));
    if (rand() > .89) color.set(pick([0xd0d4b4, 0xefe0a4, 0xb7d2cc]));
    color.multiplyScalar(range(.61, 1.45));
    strokes.setColorAt(i, color);
  }
  finishInstances(strokes);
  group.add(strokes);
  scene.add(group);
  animated.push({ object: group, speed: direction * .0017, phase: 0 });
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,243,180,.82)');
  gradient.addColorStop(.17, 'rgba(255,216,96,.37)');
  gradient.addColorStop(.5, 'rgba(248,206,103,.13)');
  gradient.addColorStop(1, 'rgba(248,206,103,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const glowMap = glowTexture();

function addStar(x: number, y: number, z: number, radius: number): void {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xf7dc8b, transparent: true, opacity: .65, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.set(x, y, z);
  halo.scale.set(radius * 5.2, radius * 5.2, 1);
  scene.add(halo);
  const count = Math.floor(radius * (narrow ? 12 : 19));
  const strokes = brushMesh(count, .92);
  for (let i = 0; i < count; i++) {
    const a = range(0, TAU), r = radius * (.34 + rand() * 1.75);
    const thickness = range(-8, 8);
    dummy.position.set(x + Math.cos(a) * r, y + Math.sin(a) * r + thickness, z + range(-38, 50));
    dummy.rotation.set(0, 0, a + Math.PI / 2 + range(-.28, .28));
    dummy.scale.set(range(5, 18), range(1.2, 4), 1);
    dummy.updateMatrix();
    strokes.setMatrixAt(i, dummy.matrix);
    color.set(pick(warmPalette)).multiplyScalar(range(.74, 1.36));
    strokes.setColorAt(i, color);
  }
  finishInstances(strokes);
  scene.add(strokes);
}

function addMoon(): void {
  const x = 1050, y = 865, z = -890, R = 175;
  const crescent = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.1, R * 2.1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec2 vUv;
      void main(){
        vec2 p=(vUv-.5)*2.0;
        float outer=1.0-smoothstep(.94,1.0,length(p));
        float inner=1.0-smoothstep(.72,.77,length(p-vec2(.36,.05)));
        float edge=outer*(1.0-inner);
        vec3 gold=mix(vec3(.83,.52,.11),vec3(1.0,.82,.34),vUv.y);
        gl_FragColor=vec4(gold,edge*.91);
      }
    `,
  }));
  crescent.position.set(x, y, z + 82);
  scene.add(crescent);
  billboards.push(crescent);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xf5ca63, transparent: true, opacity: .44, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.set(x, y, z);
  glow.scale.set(920, 920, 1);
  scene.add(glow);
  const count = narrow ? 9400 : 18800;
  const strokes = brushMesh(count, .96);
  let i = 0;
  while (i < count) {
    const angle = range(0, TAU);
    const inBody = rand() < .57;
    let px: number, py: number, scale: number;
    if (inBody) {
      px = range(-R, R); py = range(-R, R);
      if (px * px + py * py > R * R) continue;
      if ((px - 47) ** 2 + (py - 9) ** 2 < (R * .76) ** 2) continue;
      scale = range(5, 18);
    } else {
      const r = range(R * .78, R * 2.2) + Math.sin(angle * 9) * 11;
      px = Math.cos(angle) * r;
      py = Math.sin(angle) * r * .84;
      scale = range(8, 28);
    }
    if ((px - 56) ** 2 + (py - 9) ** 2 < (R * .78) ** 2) continue;
    dummy.position.set(x + px, y + py, inBody ? z + range(120, 150) : z + range(-85, 95));
    dummy.rotation.set(range(-.15, .15), range(-.15, .15), inBody ? Math.atan2(py, px) + Math.PI / 2 + range(-.24, .24) : angle + Math.PI / 2 + range(-.19, .19));
    dummy.scale.set(scale, range(1.4, 4.5), 1);
    dummy.updateMatrix();
    strokes.setMatrixAt(i, dummy.matrix);
    color.set(pick(inBody ? [0xffd453, 0xf4c432, 0xeab83c, 0xffe179] : [0x6894a2, 0x9cbcb4, 0xd6c88f, 0xe8bd4c, 0x477f9d]));
    color.multiplyScalar(range(.68, 1.12));
    strokes.setColorAt(i, color);
    i++;
  }
  finishInstances(strokes);
  scene.add(strokes);
}

function addDust(): void {
  const count = narrow ? 4800 : 9800;
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = range(-2000, 2000);
    positions[i * 3 + 1] = range(-100, 1500);
    positions[i * 3 + 2] = range(-1500, 950);
    color.set(pick([0xd8e2ce, 0x94b9c6, 0xf6d782, 0x406a98])).multiplyScalar(range(.35, 1));
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2.7, vertexColors: true, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending }));
  points.frustumCulled = false;
  scene.add(points);
}

type Frame = { second: number; pos: [number, number, number]; look: [number, number, number]; fov: number };
const frames: Frame[] = [
  { second: 0, pos: [0, 170, 1130], look: [0, 285, -930], fov: 60 },
  { second: 3, pos: [0, 175, 1030], look: [0, 290, -930], fov: 60 },
  { second: 6, pos: [5, 215, 720], look: [0, 330, -1060], fov: 60 },
  { second: 9, pos: [30, 310, 350], look: [40, 470, -1090], fov: 62 },
  { second: 12, pos: [105, 440, -80], look: [225, 590, -1120], fov: 65 },
  { second: 15, pos: [280, 635, -320], look: [550, 685, -1040], fov: 66 },
  { second: 18, pos: [385, 710, -360], look: [780, 790, -1050], fov: 68 },
  { second: 21, pos: [500, 785, -340], look: [955, 850, -970], fov: 69 },
  { second: 24, pos: [610, 820, -385], look: [990, 865, -940], fov: 67 },
  { second: 27, pos: [590, 855, -450], look: [850, 850, -940], fov: 66 },
  { second: 30, pos: [200, 610, -145], look: [20, 560, -1100], fov: 65 },
  { second: 33, pos: [-350, 390, 130], look: [-500, 480, -1150], fov: 64 },
  { second: 36, pos: [-300, 240, 650], look: [-130, 310, -1040], fov: 61 },
  { second: DURATION, pos: [0, 170, 1130], look: [0, 285, -930], fov: 60 },
];
let elapsed = Number.isFinite(seekTime) && params.has('t') ? clamp(seekTime, 0, DURATION) : 0;
let playing = !reducedMotion && !params.has('paused');
let freeMode = false;
let resumeTour = false;
let lastUiTick = -1;
let dragging = false;
const lastPointer = new THREE.Vector2();
const pressed = new Set<string>();
const velocity = new THREE.Vector3();
const desiredVelocity = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
let yaw = 0;
let pitch = 0;
let hideHudTimer = 0;

function updateCamera(time: number): void {
  let i = 0;
  while (i < frames.length - 2 && time > frames[i + 1].second) i++;
  const a = frames[i], b = frames[i + 1];
  const t = clamp((time - a.second) / (b.second - a.second), 0, 1);
  const dt = b.second - a.second;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const hermite = (field: 'pos' | 'look', axis: number): number => {
    const last = frames.length - 1;
    const slope = (index: number): number => {
      const cyclic = index % last;
      const prev = (cyclic - 1 + last) % last;
      const next = (cyclic + 1) % last;
      const prevTime = frames[prev].second - (prev > cyclic ? DURATION : 0);
      const nextTime = frames[next].second + (next < cyclic ? DURATION : 0);
      return (frames[next][field][axis] - frames[prev][field][axis]) / (nextTime - prevTime);
    };
    return h00 * a[field][axis] + h10 * slope(i) * dt + h01 * b[field][axis] + h11 * slope(i + 1) * dt;
  };
  camera.position.set(
    hermite('pos', 0),
    hermite('pos', 1),
    hermite('pos', 2),
  );
  tempV.set(
    hermite('look', 0),
    hermite('look', 1),
    hermite('look', 2),
  );
  camera.lookAt(tempV);
  const fovSlope = (index: number): number => {
    const last = frames.length - 1;
    const cyclic = index % last;
    const prev = (cyclic - 1 + last) % last;
    const next = (cyclic + 1) % last;
    const prevTime = frames[prev].second - (prev > cyclic ? DURATION : 0);
    const nextTime = frames[next].second + (next < cyclic ? DURATION : 0);
    return (frames[next].fov - frames[prev].fov) / (nextTime - prevTime);
  };
  camera.fov = h00 * a.fov + h10 * fovSlope(i) * dt + h01 * b.fov + h11 * fovSlope(i + 1) * dt + (narrow ? 11 : 0);
  camera.updateProjectionMatrix();
}

function timeLabel(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
function updateControls(): void {
  const ratio = elapsed / DURATION;
  timeline.value = String(Math.min(1179, Math.floor(elapsed * 30)));
  timeline.style.setProperty('--progress', `${ratio * 100}%`);
  timecode.textContent = `${timeLabel(elapsed)} / 00:39`;
  playButton.textContent = playing ? 'Ⅱ' : '▶';
  playButton.setAttribute('aria-label', playing ? '暂停运镜' : '继续运镜');
  modeButton.textContent = freeMode ? '返回运镜' : '自由游玩 ↗';
  modeButton.setAttribute('aria-label', freeMode ? '返回复刻运镜' : '进入自由游玩模式');
}
function syncFreeOrientation(): void {
  camera.getWorldDirection(tempV);
  yaw = Math.atan2(-tempV.x, -tempV.z);
  pitch = Math.asin(clamp(tempV.y, -1, 1));
  camera.rotation.order = 'YXZ';
}
function setFreeMode(enabled: boolean): void {
  if (freeMode === enabled) return;
  if (enabled) {
    resumeTour = playing;
    playing = false;
    syncFreeOrientation();
  } else {
    playing = resumeTour;
    pressed.clear();
    velocity.set(0, 0, 0);
    dragging = false;
  }
  freeMode = enabled;
  app.classList.toggle('free', enabled);
  app.classList.toggle('tour', !enabled);
  exploreUi.setAttribute('aria-hidden', String(!enabled));
  renderer.domElement.focus({ preventScroll: true });
  updateControls();
}
function constrainFreePosition(): void {
  camera.position.x = clamp(camera.position.x, -1860, 1860);
  camera.position.z = clamp(camera.position.z, -1780, 2210);
  camera.position.y = clamp(camera.position.y, terrainHeight(camera.position.x, camera.position.z) + 18, 1650);
}
function updateFreeCamera(delta: number): void {
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  desiredVelocity.set(0, 0, 0);
  if (pressed.has('KeyW') || pressed.has('ArrowUp')) desiredVelocity.add(forward);
  if (pressed.has('KeyS') || pressed.has('ArrowDown')) desiredVelocity.sub(forward);
  if (pressed.has('KeyD') || pressed.has('ArrowRight')) desiredVelocity.add(right);
  if (pressed.has('KeyA') || pressed.has('ArrowLeft')) desiredVelocity.sub(right);
  if (pressed.has('Space')) desiredVelocity.y += 1;
  if (pressed.has('ShiftLeft') || pressed.has('ShiftRight')) desiredVelocity.y -= 1;
  if (desiredVelocity.lengthSq() > 0) desiredVelocity.normalize();
  desiredVelocity.multiplyScalar(290);
  velocity.lerp(desiredVelocity, 1 - Math.exp(-delta * 8));
  camera.position.addScaledVector(velocity, delta);
  constrainFreePosition();
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}
function revealHud(): void {
  app.classList.add('active');
  clearTimeout(hideHudTimer);
  hideHudTimer = window.setTimeout(() => app.classList.remove('active'), 2600);
}
playButton.addEventListener('click', () => { playing = !playing; updateControls(); revealHud(); });
modeButton.addEventListener('click', () => { setFreeMode(!freeMode); revealHud(); });
timeline.addEventListener('input', () => {
  elapsed = Number(timeline.value) / 30;
  updateControls(); revealHud();
});
fullscreenButton.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void app.requestFullscreen();
  revealHud();
});
renderer.domElement.addEventListener('pointerdown', e => {
  if (!freeMode) return;
  dragging = true;
  lastPointer.set(e.clientX, e.clientY);
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => {
  if (freeMode && dragging) {
    yaw -= (e.clientX - lastPointer.x) * .003;
    pitch = clamp(pitch - (e.clientY - lastPointer.y) * .003, -1.46, 1.46);
    lastPointer.set(e.clientX, e.clientY);
  }
  if (!freeMode) revealHud();
});
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('pointercancel', () => { dragging = false; });
window.addEventListener('wheel', e => {
  e.preventDefault();
  if (freeMode) {
    camera.getWorldDirection(tempV);
    camera.position.addScaledVector(tempV, clamp(-e.deltaY * .55, -140, 140));
    constrainFreePosition();
  } else elapsed = clamp(elapsed + e.deltaY * .012, 0, DURATION - 1 / 30);
  updateControls(); revealHud();
}, { passive: false });
window.addEventListener('keydown', e => {
  if (e.code === 'KeyV') { setFreeMode(!freeMode); revealHud(); return; }
  if (freeMode) {
    if (e.code === 'Escape') { setFreeMode(false); revealHud(); return; }
    if (e.code === 'KeyR') { updateCamera(elapsed); syncFreeOrientation(); velocity.set(0, 0, 0); return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    pressed.add(e.code);
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); playing = !playing; }
  if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    e.preventDefault();
    playing = false;
    elapsed = clamp(elapsed + (e.code === 'ArrowRight' ? 1 : -1) / 30, 0, DURATION - 1 / 30);
  }
  updateControls(); revealHud();
});
window.addEventListener('keyup', e => { pressed.delete(e.code); });
window.addEventListener('blur', () => { pressed.clear(); dragging = false; });
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
  const code = button.dataset.move!;
  button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); pressed.add(code); });
  button.addEventListener('pointerup', () => pressed.delete(code));
  button.addEventListener('pointercancel', () => pressed.delete(code));
  button.addEventListener('lostpointercapture', () => pressed.delete(code));
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.updateProjectionMatrix();
});

async function init(): Promise<void> {
  const texture = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}starry-night.jpg`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  const sample = imageSampler(texture);
  addAtmosphere(texture);
  addTerrain();
  addVillage();
  addCypress(-650, 325, 1.03);
  addCypress(-900, 50, .75);
  addSkyStrokes(sample);
  addVortex(-180, 620, -880, 565, narrow ? 9000 : 18300, 1);
  addVortex(495, 570, -950, 280, narrow ? 4900 : 9900, -1);
  [
    [-1040, 1100, -990, 38], [-720, 1190, -1080, 31], [-420, 1120, -1020, 25],
    [-130, 1230, -1080, 30], [220, 1170, -1030, 34], [520, 1060, -980, 37],
    [-835, 825, -860, 42], [-395, 770, -800, 37], [-85, 455, -780, 55],
    [310, 720, -855, 38], [690, 890, -850, 34],
  ].forEach(([x, y, z, r]) => addStar(x, y, z, r));
  addMoon();
  addDust();
  updateControls();
  updateCamera(elapsed);
  loader.classList.add('loaded');
  revealHud();
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), .05);
    if (!freeMode && playing) elapsed = (elapsed + delta) % DURATION;
    shaderTime.value = clock.elapsedTime;
    for (const item of animated) item.object.rotation.z = item.phase + clock.elapsedTime * item.speed;
    if (freeMode) updateFreeCamera(delta);
    else updateCamera(elapsed);
    for (const billboard of billboards) billboard.lookAt(camera.position);
    if (clock.elapsedTime - lastUiTick >= .08) {
      updateControls();
      lastUiTick = clock.elapsedTime;
    }
    composer.render();
  });
}
init().catch(error => {
  console.error(error);
  loader.classList.add('loaded');
  errorText.textContent = '场景加载失败，请刷新页面重试。';
});
