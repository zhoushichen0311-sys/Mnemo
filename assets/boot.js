/* ═══════════════════════════════════════════════════════════════════
   MNEMOSYNE v3 · 开场序列
   黑场进度条 → 纯黑舞台上的 cube → 点击（或 6s 超时）→ 粒子消散 → 首页

   移植自 hero5.html，只保留开场需要的部分：
   丢掉了 OrbitControls 之外的交互、ABOUT 悬浮面、背景网格涟漪、About 区。
   材质与灯光参数原样搬过来（用户 2026-07-23 在 cube-pbr 里调定的值），
   所以这里的 cube 和 hero5 里看到的是同一个。

   进度是真实的：0–15 引擎与程序化纹理，15–90 GLB 下载，90–100 首帧编译。
   ═══════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

RectAreaLightUniformsLib.init();

/* ── 用户调定的最终参数 ────────────────────────────────────── */
const P = {
  glass: { rough:.43, trans:.86, thick:.55, clearcoat:.25, ior:1.7, envInt:.9, normal:.56 },
  metal: { rough:.34, aniso:.39, envInt:1.15, normal:.08 },
  exposure: 1.15,
  envIntensity: 0.3,
  lights: [   /* [强度, 水平角°, 垂直角°, 距离, 宽, 高, 颜色] */
    [5.7, -153, 83, 4.2, 3.6, 3.6, 0xffffff],
    [1.2,  -37, -11, 4.2, 2.4, 3.4, 0xf2f7ff],
    [5.3,  110,   5, 4.2, 2.0, 3.2, 0xfff4e6]
  ]
};

const AUTO_MS  = 6000;    // 进入 cube 舞台后多久没人点，自己散
const WATCHDOG = 14000;   // 兜底：这么久还没进舞台就直接放行到首页

const boot  = document.getElementById('boot');
const stage = document.getElementById('boot-stage');

/* ═══ 收尾：把开场撤掉，让首页接管 ═══════════════════════════ */
let finished = false;
function finish(){
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  clearTimeout(autoTimer);

  try { sessionStorage.setItem('mnemo:intro', 'seen'); } catch(e){}

  boot.classList.add('is-gone');
  document.documentElement.classList.remove('booting');
  document.documentElement.classList.add('boot-done');

  /* 视频这时候才开始播 —— 开场期间它是暂停在第一帧的，
     否则 8 秒的片子在遮罩后面就放完了，用户看到的是停帧。 */
  window.dispatchEvent(new CustomEvent('mnemo:intro-done'));

  /* 等淡出走完再销毁 WebGL，省显存 */
  setTimeout(() => {
    try {
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.remove();
    } catch(e){}
    boot.remove();
  }, 1600);
}
const watchdog = setTimeout(finish, WATCHDOG);

/* ═══ 加载页：品牌逐字母浮现 + 左下大数字 + 底部细进度条 ═══════ */
const intro = {
  el:    document.getElementById('boot-intro'),
  brand: document.getElementById('boot-brand'),
  pct:   document.getElementById('boot-pct'),
  bar:   document.getElementById('boot-bar'),
  err:   document.getElementById('boot-err'),
  target: 0, shown: 0, t0: performance.now(),
  MIN_MS: 2400,
  letters: []
};
for (const ch of 'MNEMOSYNE'){
  const s = document.createElement('span');
  s.textContent = ch;
  intro.brand.appendChild(s);
  intro.letters.push(s);
}
function introSet(v){ intro.target = Math.max(intro.target, Math.min(v, 100)); }

let _lastTick = performance.now();
function introTick(){
  /* 显示值追赶目标值，按真实时间补间（掉帧时也不拖慢），
     同时受最短时长约束 —— 模型早就绪也不会闪一下就过去 */
  const now = performance.now();
  const dt = Math.min(100, now - _lastTick); _lastTick = now;
  const timeCap = Math.min(100, (now - intro.t0) / intro.MIN_MS * 100);
  const goal = Math.min(intro.target, timeCap);
  intro.shown += (goal - intro.shown) * Math.min(1, dt * 0.0075);

  const n = Math.round(intro.shown);
  intro.pct.textContent = n;
  intro.bar.style.width = n + '%';
  const lit = Math.floor(n / 100 * intro.letters.length);
  intro.letters.forEach((s, i) => s.classList.toggle('on', i < lit || n >= 99));

  if (n >= 100 && intro.target >= 100){
    intro.el.classList.add('done');     // 加载页淡出
    boot.classList.add('stage1');       // cube 浮现，灯光开始渐亮
    startLightRamp();
    autoTimer = setTimeout(dissolveCube, AUTO_MS);
    return;
  }
  requestAnimationFrame(introTick);
}
requestAnimationFrame(introTick);

/* ═══ 渲染器 / 场景 / 相机 ═══════════════════════════════════ */
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = P.exposure;
stage.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth/innerHeight, 0.05, 100);
camera.position.set(4.0, 3.0, 4.9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;
controls.enableZoom     = false;
controls.enablePan      = false;
controls.autoRotate     = true;
controls.autoRotateSpeed = 0.55;

/* 一旦用户动手转 cube，就别再倒计时逼他 —— 他显然在看 */
controls.addEventListener('start', () => {
  controls.autoRotate = false;
  clearTimeout(autoTimer);
});
controls.addEventListener('end', () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { controls.autoRotate = true; }, 3500);
  clearTimeout(autoTimer);
  autoTimer = setTimeout(dissolveCube, AUTO_MS);
});
let idleTimer = null, autoTimer = null;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ── 摄影棚环境（低强度，主光来自矩形灯） ── */
function studioEnv(){
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x101012);
  const geo = new THREE.PlaneGeometry(1, 1);
  const panel = (w,h,pos,color,intensity) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color:new THREE.Color(color).multiplyScalar(intensity), side:THREE.DoubleSide }));
    m.scale.set(w,h,1); m.position.set(...pos); m.lookAt(0,0,0); env.add(m);
  };
  env.add(new THREE.Mesh(new THREE.BoxGeometry(30,20,30),
    new THREE.MeshBasicMaterial({ color:0x6e7278, side:THREE.BackSide })));
  panel(20,12,[0,9,0],0xf2f5f8,1.5);
  panel(9,5,[0,6.5,1.5],0xffffff,2.2);
  panel(1.6,9,[-6.5,.5,2.5],0xdfe9ff,2.6);
  panel(1.2,9,[6.8,.8,1.5],0xfff0dc,2.2);
  panel(7,1.2,[0,1.5,-7],0xcfe0ff,2.8);
  panel(9,5,[0,-5.5,4.5],0xffe8cf,.9);
  return env;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studioEnv(), 0.02).texture;
introSet(8);

/* ═══ 程序化表面纹理（喷砂玻璃 + 喷砂金属）═════════════════ */
function heightToNormal(size, drawHeight, strength, repeat){
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  drawHeight(ctx, size);
  const src = ctx.getImageData(0,0,size,size).data;
  const out = ctx.createImageData(size,size);
  const H = (x,y) => { x=(x+size)%size; y=(y+size)%size; return src[(y*size+x)*4]/255; };
  for (let y=0;y<size;y++) for (let x=0;x<size;x++){
    const dx=(H(x+1,y)-H(x-1,y))*strength, dy=(H(x,y+1)-H(x,y-1))*strength;
    const nx=-dx, ny=-dy, nz=1, L=Math.hypot(nx,ny,nz), i=(y*size+x)*4;
    out.data[i]=(nx/L*.5+.5)*255; out.data[i+1]=(ny/L*.5+.5)*255;
    out.data[i+2]=(nz/L*.5+.5)*255; out.data[i+3]=255;
  }
  ctx.putImageData(out,0,0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat,repeat);
  return t;
}
function grayTex(size, draw, repeat){
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat,repeat);
  return t;
}
const frostNormal = heightToNormal(1024, (ctx,s)=>{
  ctx.fillStyle='#808080'; ctx.fillRect(0,0,s,s);
  for(let i=0;i<120000;i++){ const v=40+Math.random()*180;
    ctx.fillStyle=`rgb(${v},${v},${v})`; ctx.beginPath();
    ctx.arc(Math.random()*s,Math.random()*s,.7+Math.random()*2,0,6.2832); ctx.fill(); }
}, 9, 4);
const frostRough = grayTex(512, (ctx,s)=>{
  ctx.fillStyle='#9a9a9a'; ctx.fillRect(0,0,s,s);
  for(let i=0;i<40000;i++){ const v=130+Math.random()*90;
    ctx.fillStyle=`rgba(${v},${v},${v},.5)`; ctx.beginPath();
    ctx.arc(Math.random()*s,Math.random()*s,1+Math.random()*3,0,6.2832); ctx.fill(); }
}, 4);
const blastNormal = heightToNormal(1024, (ctx,s)=>{
  ctx.fillStyle='#808080'; ctx.fillRect(0,0,s,s);
  for(let i=0;i<90000;i++){ const v=55+Math.random()*170;
    ctx.fillStyle=`rgb(${v},${v},${v})`; ctx.beginPath();
    ctx.arc(Math.random()*s,Math.random()*s,.9+Math.random()*2.6,0,6.2832); ctx.fill(); }
  for(let i=0;i<60000;i++){ const v=80+Math.random()*120;
    ctx.fillStyle=`rgba(${v},${v},${v},.6)`; ctx.beginPath();
    ctx.arc(Math.random()*s,Math.random()*s,.5+Math.random()*1.2,0,6.2832); ctx.fill(); }
}, 5.5, 4);
const brushRough = grayTex(512, (ctx,s)=>{
  ctx.fillStyle='#808080'; ctx.fillRect(0,0,s,s);
  for(let i=0;i<9000;i++){ const y=Math.random()*s, len=20+Math.random()*180,
    v=112+Math.random()*32;
    ctx.strokeStyle=`rgba(${v},${v},${v},${.06+Math.random()*.14})`;
    ctx.lineWidth=.6+Math.random()*1.4;
    ctx.beginPath(); ctx.moveTo(Math.random()*s,y);
    ctx.lineTo(Math.random()*s+len,y+(Math.random()-.5)*1.5); ctx.stroke(); }
}, 3);

/* ── 材质 ── */
const glassMat = new THREE.MeshPhysicalMaterial({
  color:0xdfe4e8, metalness:0,
  roughness:P.glass.rough, transmission:P.glass.trans, thickness:P.glass.thick,
  ior:P.glass.ior, transparent:true, side:THREE.DoubleSide,
  clearcoat:P.glass.clearcoat, clearcoatRoughness:.35,
  envMapIntensity:P.glass.envInt,
  normalMap:frostNormal, normalScale:new THREE.Vector2(P.glass.normal,P.glass.normal),
  roughnessMap:frostRough
});
const metalMat = new THREE.MeshPhysicalMaterial({
  color:0xf0f1f3, metalness:1, roughness:P.metal.rough,
  roughnessMap:brushRough,
  normalMap:blastNormal, normalScale:new THREE.Vector2(P.metal.normal,P.metal.normal),
  anisotropy:P.metal.aniso, anisotropyRotation:Math.PI/2,
  envMapIntensity:P.metal.envInt
});
introSet(15);

/* ═══ 矩形灯与渐亮 ═══════════════════════════════════════════ */
const D2R = Math.PI/180;
const rectLights = P.lights.map(([inten, azim, elev, dist, w, h, color]) => {
  const L = new THREE.RectAreaLight(color, 0, w, h);   // 先 0，等亮灯序列
  L._base = inten;
  const a = azim*D2R, e = elev*D2R;
  L.position.set(dist*Math.cos(e)*Math.sin(a), dist*Math.sin(e), dist*Math.cos(e)*Math.cos(a));
  L.lookAt(0,0,0);
  scene.add(L);
  return L;
});
scene.environmentIntensity = 0;              // 环境也从黑起

let rampT0 = null;
function startLightRamp(){ rampT0 = performance.now(); }
function lightRampTick(){
  if (rampT0 === null) return;
  const t = Math.min(1, (performance.now() - rampT0) / 3200);
  const f = t*t*(3-2*t);                     // smoothstep
  rectLights.forEach(L => { L.intensity = L._base * f; });
  scene.environmentIntensity = P.envIntensity * f;
  if (t >= 1) rampT0 = null;
}

/* ═══ 模型 ═══════════════════════════════════════════════════ */
let cubeRoot = null;
const group = new THREE.Group();
scene.add(group);

new GLTFLoader().load('./assets/model/cube.glb', async gltf => {
  const root = gltf.scene;
  root.traverse(n => {
    if (!n.isMesh) return;
    const ms = Array.isArray(n.material) ? n.material : [n.material];
    const mapped = ms.map(m => (m.name||'').includes('玻璃') ? glassMat : metalMat);
    n.material = Array.isArray(n.material) ? mapped : mapped[0];
  });
  const b0 = new THREE.Box3().setFromObject(root);
  const s0 = b0.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(1.6/Math.max(s0.x,s0.y,s0.z));
  root.updateMatrixWorld(true);
  const b1 = new THREE.Box3().setFromObject(root);
  root.position.sub(b1.getCenter(new THREE.Vector3()));
  cubeRoot = root;
  introSet(93);

  /* 透光玻璃的着色器编译很重，不预编译会在首帧卡住主线程
     （表现为进度条停在 95 附近）——compileAsync 分帧编译 */
  group.add(root);
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  requestAnimationFrame(() => requestAnimationFrame(() => introSet(100)));
}, xhr => {
  if (xhr.lengthComputable && xhr.total > 0)
    introSet(15 + (xhr.loaded / xhr.total) * 75);
}, err => {
  /* 模型拿不到就别卡着用户 —— 说一句，然后直接进首页 */
  console.error('[boot] GLB 加载失败', err);
  intro.err.style.display = 'block';
  intro.err.textContent = 'Could not load the model — going straight in.';
  setTimeout(finish, 1200);
});

/* ═══ 点击 cube（或超时）→ 粒子消散 ═══════════════════════════ */
let burst = null;
function dissolveCube(){
  if (!cubeRoot || burst || finished) return;
  clearTimeout(autoTimer);
  boot.classList.add('bursting');

  /* 表面采样 ~4200 个点（按各 mesh 面积近似均分） */
  const meshes = [];
  cubeRoot.traverse(n => { if (n.isMesh) meshes.push(n); });
  if (!meshes.length){ finish(); return; }

  const N = 4200, per = Math.ceil(N / meshes.length);
  const pos = new Float32Array(N*3), vel = new Float32Array(N*3);
  const tmp = new THREE.Vector3();
  let i = 0;
  for (const m of meshes){
    let sampler;
    try { sampler = new MeshSurfaceSampler(m).build(); } catch(e){ continue; }
    for (let k = 0; k < per && i < N; k++, i++){
      sampler.sample(tmp);
      m.localToWorld(tmp);
      pos[i*3] = tmp.x; pos[i*3+1] = tmp.y; pos[i*3+2] = tmp.z;
      const d = tmp.clone().normalize();
      const sp = 0.9 + Math.random()*1.7;
      vel[i*3]   = d.x*sp + (Math.random()-.5)*.7;
      vel[i*3+1] = d.y*sp + (Math.random()-.5)*.7 + .25;   // 轻微上飘
      vel[i*3+2] = d.z*sp + (Math.random()-.5)*.7;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, i*3), 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color:0xdde6f0, size:0.016, sizeAttenuation:true,
    transparent:true, opacity:1, depthWrite:false,
    blending:THREE.AdditiveBlending }));
  scene.add(points);
  cubeRoot.visible = false;
  burst = { points, vel, n:i, t0:performance.now() };

  setTimeout(finish, 1100);      // 粒子还在飞的时候首页就开始接管
}
function burstTick(now){
  if (!burst) return;
  const age = (now - burst.t0) / 1000;
  if (age > 2.2){
    scene.remove(burst.points);
    burst.points.geometry.dispose(); burst.points.material.dispose();
    burst = null; return;
  }
  const a = burst.points.geometry.attributes.position.array, v = burst.vel, dt = 1/60;
  for (let i = 0; i < burst.n; i++){
    a[i*3]   += v[i*3]*dt;
    a[i*3+1] += v[i*3+1]*dt;
    a[i*3+2] += v[i*3+2]*dt;
    v[i*3] *= .985; v[i*3+1] *= .985; v[i*3+2] *= .985;
  }
  burst.points.geometry.attributes.position.needsUpdate = true;
  burst.points.material.opacity = Math.max(0, 1 - age/2.0);
}

/* 点中 cube 才算数；拖动超过 7px 视为在转模型，不触发 */
const rayc = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downX = 0, downY = 0;
stage.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; });
stage.addEventListener('pointerup', e => {
  if (!boot.classList.contains('stage1') || !cubeRoot) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) >= 7) return;
  ndc.x =  (e.clientX/innerWidth)*2 - 1;
  ndc.y = -(e.clientY/innerHeight)*2 + 1;
  rayc.setFromCamera(ndc, camera);
  if (rayc.intersectObject(cubeRoot, true).length > 0) dissolveCube();
});
/* 键盘也能过：Enter / Space / Esc */
addEventListener('keydown', e => {
  if (!boot.classList.contains('stage1')) return;
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dissolveCube();
});

/* ═══ 主循环 ═══════════════════════════════════════════════ */
renderer.setAnimationLoop(() => {
  const now = performance.now();
  lightRampTick();
  burstTick(now);
  controls.update();
  renderer.render(scene, camera);
});
