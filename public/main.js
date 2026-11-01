// ÁNIMAS: a little skeleton, one night, and ghosts written by an open-weight model.
// Three.js, hand-written shaders, no build step.
import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const Q = new URLSearchParams(location.search);
const API_BASE = String(window.ANIMAS_CONFIG?.apiBase || "").replace(/\/$/, "");
const api = (p) => API_BASE + p;
const SOLO = !Q.has("multi"); // single-player by default; ?multi turns the shared town back on
const LOW = Q.has("low") || /Mobi|Android/i.test(navigator.userAgent);
const $ = (s) => document.querySelector(s);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// the marigold road winds the same way on the server, so lanterns land near it
export const pathX = (z) => 18 * Math.sin(z * 0.012) + 6 * Math.sin(z * 0.031);
const PATH_START = 44, PATH_END = -430;

const PALETTE = {
  marigold: 0xff8c1a, rose: 0xff3d8b, violet: 0x9d5cff, turquoise: 0x1fd1c1,
  gold: 0xffc93c, crimson: 0xe0213f, jade: 0x2fd67b, indigo: 0x4b5bff,
};
const MOTIFS = ["flower", "heart", "star", "bird", "music", "cup", "book", "sun", "moon", "wave", "hand", "leaf"];
const FOG = new THREE.Color(0x140b20);
const FOG_DENSITY = 0.0046;

// ============================================================================ renderer
const canvas = $("#gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2400);
camera.position.set(0, 70, 60);

const U = { uTime: { value: 0 }, uFogColor: { value: FOG }, uFogDensity: { value: FOG_DENSITY } };
const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor; uniform float uFogDensity;
  vec3 applyFog(vec3 c, float d){ float f = 1.0 - exp(-uFogDensity*uFogDensity*d*d); return mix(c, uFogColor, clamp(f,0.0,1.0)); }`;

// ============================================================================ sky
{
  const geo = new THREE.SphereGeometry(1800, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { ...U },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir; uniform float uTime;
      float h(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 zen = vec3(0.006,0.004,0.016), mid = vec3(0.035,0.012,0.06), hor = vec3(0.2,0.04,0.11), low = vec3(0.03,0.012,0.04);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.1, y));
        col = mix(col, zen, smoothstep(0.15, 0.7, y));
        col = mix(low, col, smoothstep(-0.08, 0.02, y));
        float haze = exp(-pow((d.z+1.0)*2.2,2.0)) * exp(-abs(y)*12.0);
        col += vec3(1.0,0.32,0.06) * haze * 0.42;
        float haze2 = exp(-pow((d.z-1.0)*2.4,2.0)) * exp(-abs(y)*14.0);
        col += vec3(1.0,0.2,0.35) * haze2 * 0.18;
        vec3 sp = floor(d*420.0);
        float s = h(sp);
        float tw = 0.6 + 0.4*sin(uTime*2.0 + s*60.0);
        col += vec3(0.9,0.85,1.0) * step(0.9982, s) * tw * smoothstep(0.05,0.35,y) * 0.9;
        vec3 md = normalize(vec3(-0.45, 0.32, -0.83));
        float m = dot(d, md);
        col += vec3(1.0,0.9,0.78) * smoothstep(0.99935, 0.9995, m) * 0.7;
        col += vec3(0.8,0.45,0.6) * pow(max(m,0.0), 300.0) * 0.16;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
}

// ============================================================================ water (a real mirror, rippled)
let water;
{
  const geo = new THREE.PlaneGeometry(3200, 3200);
  const shader = {
    uniforms: { color: { value: new THREE.Color(0x05030a) }, tDiffuse: { value: null }, textureMatrix: { value: null }, ...U },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
      void main(){ vUv = textureMatrix*vec4(position,1.0); vWorld = (modelMatrix*vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform sampler2D tDiffuse; uniform float uTime; varying vec4 vUv; varying vec3 vWorld;
      ${FOG_GLSL}
      void main(){
        vec2 p = vWorld.xz;
        vec2 dist = vec2(sin(p.y*0.31+uTime*0.9)+sin(p.x*0.23-uTime*0.7)+0.5*sin((p.x+p.y)*0.9+uTime*1.7),
                         cos(p.x*0.29+uTime*0.8)+sin(p.y*0.19+uTime*0.6)+0.5*cos((p.x-p.y)*0.8-uTime*1.3)) * 0.010;
        vec4 uv = vUv; uv.xy += dist * uv.w;
        vec3 refl = texture2DProj(tDiffuse, uv).rgb;
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.18 + 0.82*pow(1.0 - clamp(V.y,0.0,1.0), 4.0);
        vec3 col = color + refl * fres * 0.85;
        gl_FragColor = vec4(applyFog(col, length(cameraPosition - vWorld)*0.85), 1.0);
      }`,
  };
  if (LOW) {
    water = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x07040d }));
  } else {
    water = new Reflector(geo, { shader, textureWidth: innerWidth * 0.5, textureHeight: innerHeight * 0.5, clipBias: 0.003, color: 0x05030a });
    water.material.uniforms.uTime = U.uTime;
  }
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
}


const flameMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { ...U, uScale: { value: innerHeight * 0.5 } },
  vertexShader: /* glsl */ `
    attribute float aSeed; attribute float aSize; uniform float uTime; uniform float uScale; varying float vF; varying float vD;
    void main(){
      vec3 p = position; float f = 0.8 + 0.2*sin(uTime*14.0 + aSeed*80.0) + 0.1*sin(uTime*23.0 + aSeed*30.0);
      p.y += 0.03*sin(uTime*9.0+aSeed*40.0);
      vec4 mv = modelViewMatrix*vec4(p,1.0); vF = f; vD = -mv.z;
      gl_PointSize = aSize * f * uScale / -mv.z; gl_Position = projectionMatrix*mv;
    }`,
  fragmentShader: /* glsl */ `
    varying float vF; varying float vD; ${FOG_GLSL}
    void main(){
      vec2 c = gl_PointCoord - 0.5; c.y *= 0.75;
      float d = length(c);
      float core = smoothstep(0.18, 0.0, d), halo = smoothstep(0.5, 0.0, d);
      vec3 col = vec3(1.0,0.85,0.55)*core*2.2 + vec3(1.0,0.42,0.08)*halo*halo*0.8;
      float fogK = exp(-uFogDensity*uFogDensity*vD*vD*0.6);
      gl_FragColor = vec4(col*vF*fogK, 1.0);
    }`,
});

function picadoTexture(color, variant) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 320;
  const g = c.getContext("2d");
  g.fillStyle = color; g.fillRect(0, 0, 256, 320);
  g.globalCompositeOperation = "destination-out";
  // scalloped bottom edge
  for (let x = 0; x <= 256; x += 32) { g.beginPath(); g.arc(x, 320, 16, 0, Math.PI * 2); g.fill(); }
  // border holes
  for (let x = 20; x < 240; x += 18) { g.fillRect(x, 16, 9, 9); g.fillRect(x, 270, 9, 9); }
  for (let y = 40; y < 260; y += 18) { g.fillRect(14, y, 9, 9); g.fillRect(233, y, 9, 9); }
  g.save(); g.translate(128, 150);
  if (variant === 0) { // calavera
    g.beginPath(); g.ellipse(0, -14, 62, 58, 0, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over"; g.fillStyle = color;
    g.beginPath(); g.ellipse(-24, -16, 17, 19, 0, 0, Math.PI * 2); g.ellipse(24, -16, 17, 19, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(0, 6); g.lineTo(-8, 22); g.lineTo(8, 22); g.fill();
    for (let i = -3; i <= 3; i++) g.fillRect(i * 10 - 3, 34, 6, 14);
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.ellipse(-24, -16, 6, 6, 0, 0, Math.PI * 2); g.ellipse(24, -16, 6, 6, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.beginPath(); g.ellipse(Math.cos(a) * 86, -14 + Math.sin(a) * 86, 9, 5, a, 0, Math.PI * 2); g.fill(); }
  } else { // marigold rosette
    for (let r = 0; r < 3; r++) for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + r * 0.26, d = 18 + r * 26;
      g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d, 10 + r * 3, 5 + r, a, 0, Math.PI * 2); g.fill();
    }
    g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.save(); g.rotate(a); g.beginPath(); g.moveTo(96, 0); g.lineTo(78, 9); g.lineTo(78, -9); g.fill(); g.restore(); }
  }
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ============================================================================ floating petals (wrap around the camera)
const petals = (() => {
  const N = LOW ? 600 : 1500, B = 70;
  const pos = new Float32Array(N * 3), sd = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos.set([Math.random() * B, Math.random() * 26, Math.random() * B], i * 3); sd[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(sd, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...U, uCam: { value: new THREE.Vector3() }, uB: { value: B }, uScale: { value: innerHeight * 0.5 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform float uB; uniform float uScale; varying float vS; varying float vA;
      void main(){
        vec3 p = position;
        p.x += uTime*(0.6+aSeed*0.8) + sin(uTime*0.7+aSeed*20.0)*2.0;
        p.z += sin(uTime*0.4+aSeed*13.0)*3.0 - uTime*0.4;
        p.y = mod(p.y - uTime*(0.25+aSeed*0.35), 26.0);
        p.xz = mod(p.xz - uCam.xz + uB*0.5, uB) + uCam.xz - uB*0.5;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vS = aSeed; vA = smoothstep(0.0, 3.0, p.y) * smoothstep(26.0, 20.0, p.y);
        gl_PointSize = (1.2+aSeed*1.8) * uScale / -mv.z * 0.1; gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vS; varying float vA;
      void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c*vec2(1.0,1.8)); float a = smoothstep(0.5,0.1,d)*vA;
        gl_FragColor = vec4(mix(vec3(1.0,0.4,0.04), vec3(1.0,0.62,0.15), vS)*a*0.7, 1.0); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
  return mat;
})();


// ============================================================================ monarch butterflies (souls returning)
const monarchs = (() => {
  const N = LOW ? 40 : 110;
  const g = new THREE.BufferGeometry();
  // two wings in the XZ plane, body along Z
  const v = [], uv = [];
  const wing = (sx) => {
    const quad = [[0, -0.5], [sx, -0.5], [sx, 0.5], [0, 0.5]];
    const tri = [0, 1, 2, 0, 2, 3];
    tri.forEach((k) => { v.push(quad[k][0], 0, quad[k][1]); uv.push(Math.abs(quad[k][0]), 0.5 - quad[k][1]); });
  };
  wing(1); wing(-1);
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: { ...U },
    vertexShader: /* glsl */ `
      attribute float aPhase; uniform float uTime; varying vec2 vUv; varying float vD;
      void main(){
        vec3 p = position; float a = sin(uTime*13.0 + aPhase*20.0)*0.95 + 0.25;
        float s = sign(p.x); float r = abs(p.x);
        p.x = s*r*cos(a); p.y = r*sin(a);
        vUv = uv; vec4 mv = modelViewMatrix * instanceMatrix * vec4(p,1.0); vD = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vD; ${FOG_GLSL}
      void main(){
        vec2 u = vUv; // x: distance from body (0..1), y: front(1) to back(0)
        // forewing + hindwing as two soft ellipses
        vec2 f = (u - vec2(0.52, 0.66)) / vec2(0.5, 0.34);
        vec2 h = (u - vec2(0.36, 0.28)) / vec2(0.36, 0.27);
        float df = dot(f,f), dh = dot(h,h), d = min(df, dh);
        if (d > 1.0 || u.x < 0.04) discard;
        float border = smoothstep(0.62, 0.8, d);
        float ang = atan(u.y - 0.47, u.x);
        float vein = smoothstep(0.06, 0.0, abs(fract(ang * 2.6) - 0.5) - 0.42) * smoothstep(0.1, 0.3, u.x);
        vec3 col = mix(vec3(1.0, 0.5, 0.03), vec3(1.0, 0.3, 0.0), u.x) * 1.35;
        col = mix(col, vec3(0.015), max(border, vein * 0.85));
        float dots = step(0.82, d) * step(d, 0.93) * step(0.55, fract(ang * 9.0)) * step(fract(ang * 9.0), 0.8);
        col = mix(col, vec3(1.3), dots);
        gl_FragColor = vec4(applyFog(col, vD), 1.0);
      }`,
  });
  const ph = new Float32Array(N); for (let i = 0; i < N; i++) ph[i] = Math.random();
  g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(ph, 1));
  const mesh = new THREE.InstancedMesh(g, mat, N); mesh.frustumCulled = false; scene.add(mesh);
  const state = Array.from({ length: N }, (_, i) => ({ r: 8 + Math.random() * 18, h: 3 + Math.random() * 9, w: (0.15 + Math.random() * 0.35) * (Math.random() < 0.5 ? -1 : 1), o: Math.random() * 6.28, s: 0.18 + Math.random() * 0.22, p: new THREE.Vector3(), last: new THREE.Vector3() }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), look = new THREE.Matrix4();
  return {
    update(t, center) {
      state.forEach((b, i) => {
        const a = b.o + t * b.w;
        b.last.copy(b.p);
        b.p.set(center.x + Math.cos(a) * b.r + Math.sin(t * 0.7 + i) * 1.5, b.h + Math.sin(t * 1.3 + i) * 0.8, center.z + Math.sin(a) * b.r * 1.4 - 6);
        look.lookAt(b.last, b.p, up); q.setFromRotationMatrix(look);
        sc.setScalar(b.s); m.compose(b.p, q, sc); mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
})();


// ============================================================================ lanterns
function motifAtlas() {
  const S = 256, c = document.createElement("canvas"); c.width = S * 4; c.height = S * 3;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineCap = "round"; g.lineJoin = "round";
  const draw = {
    flower() { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.ellipse(Math.cos(a) * 46, Math.sin(a) * 46, 30, 16, a, 0, 7); g.fill(); } g.beginPath(); g.arc(0, 0, 24, 0, 7); g.fill(); },
    heart() { g.beginPath(); g.moveTo(0, 70); g.bezierCurveTo(-110, 0, -60, -90, 0, -36); g.bezierCurveTo(60, -90, 110, 0, 0, 70); g.fill(); },
    star() { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 36 : 92, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); },
    bird() { g.beginPath(); g.moveTo(-95, -10); g.quadraticCurveTo(-40, -60, 0, 0); g.quadraticCurveTo(40, -60, 95, -10); g.quadraticCurveTo(40, -25, 0, 30); g.quadraticCurveTo(-40, -25, -95, -10); g.fill(); },
    music() { g.lineWidth = 14; g.beginPath(); g.moveTo(-28, 50); g.lineTo(-28, -60); g.lineTo(52, -78); g.lineTo(52, 32); g.stroke(); g.beginPath(); g.ellipse(-46, 52, 26, 19, -0.4, 0, 7); g.ellipse(34, 34, 26, 19, -0.4, 0, 7); g.fill(); },
    cup() { g.beginPath(); g.moveTo(-60, -40); g.lineTo(46, -40); g.lineTo(36, 60); g.lineTo(-50, 60); g.fill(); g.lineWidth = 14; g.beginPath(); g.arc(52, 4, 24, -1.4, 1.4); g.stroke(); g.lineWidth = 9; for (const x of [-30, -6, 18]) { g.beginPath(); g.moveTo(x, -56); g.bezierCurveTo(x - 12, -72, x + 12, -82, x, -98); g.stroke(); } },
    book() { g.beginPath(); g.moveTo(0, -40); g.quadraticCurveTo(-50, -66, -96, -48); g.lineTo(-96, 58); g.quadraticCurveTo(-50, 40, 0, 64); g.quadraticCurveTo(50, 40, 96, 58); g.lineTo(96, -48); g.quadraticCurveTo(50, -66, 0, -40); g.fill(); },
    sun() { g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fill(); g.lineWidth = 12; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(Math.cos(a) * 56, Math.sin(a) * 56); g.lineTo(Math.cos(a) * 92, Math.sin(a) * 92); g.stroke(); } },
    moon() { g.beginPath(); g.arc(0, 0, 80, 0, 7); g.fill(); g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(36, -20, 70, 0, 7); g.fill(); g.globalCompositeOperation = "source-over"; },
    wave() { g.lineWidth = 16; for (const y of [-44, 0, 44]) { g.beginPath(); for (let x = -96; x <= 96; x += 4) g.lineTo(x, y + Math.sin(x * 0.06) * 16); g.stroke(); } },
    hand() { g.beginPath(); g.roundRect(-50, -10, 100, 84, 34); g.fill(); [-40, -14, 12, 38].forEach((x, i) => { g.beginPath(); g.roundRect(x - 11, -86 + Math.abs(i - 1.5) * 12, 24, 96, 12); g.fill(); }); g.beginPath(); g.roundRect(-84, -6, 24, 64, 12); g.fill(); },
    leaf() { g.beginPath(); g.moveTo(0, -96); g.bezierCurveTo(84, -40, 60, 60, 0, 92); g.bezierCurveTo(-60, 60, -84, -40, 0, -96); g.fill(); g.globalCompositeOperation = "destination-out"; g.lineWidth = 7; g.beginPath(); g.moveTo(0, -80); g.lineTo(0, 84); for (const y of [-40, 0, 40]) { g.moveTo(0, y); g.lineTo(34, y - 26); g.moveTo(0, y); g.lineTo(-34, y - 26); } g.stroke(); g.globalCompositeOperation = "source-over"; },
  };
  MOTIFS.forEach((name, i) => { g.save(); g.translate((i % 4) * S + S / 2, Math.floor(i / 4) * S + S / 2); draw[name](); g.restore(); });
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}

const lanternMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uAtlas: { value: motifAtlas() }, uHover: { value: -1 } },
  vertexShader: /* glsl */ `
    attribute vec3 aC1; attribute vec3 aC2; attribute float aMotif; attribute float aGlow; attribute float aSeed;
    varying vec2 vUv; varying vec3 vC1; varying vec3 vC2; varying float vMotif; varying float vGlow; varying float vSeed; varying float vD; varying float vHover;
    uniform float uHover;
    void main(){
      vUv = uv; vC1 = aC1; vC2 = aC2; vMotif = aMotif; vGlow = aGlow; vSeed = aSeed;
      vHover = (abs(float(gl_InstanceID) - uHover) < 0.5) ? 1.0 : 0.0;
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0); vD = -mv.z;
      gl_Position = projectionMatrix*mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uAtlas; uniform float uTime;
    varying vec2 vUv; varying vec3 vC1; varying vec3 vC2; varying float vMotif; varying float vGlow; varying float vSeed; varying float vD; varying float vHover;
    ${FOG_GLSL}
    void main(){
      vec2 uv = vUv;
      float band = smoothstep(0.2, 0.3, uv.y) * smoothstep(0.84, 0.74, uv.y);
      vec2 mu = vec2(fract(uv.x*3.0), (uv.y - 0.24)/0.52);
      float col_ = mod(vMotif, 4.0), row = floor(vMotif/4.0);
      vec2 a = vec2((col_ + 0.1 + mu.x*0.8)/4.0, (2.0 - row + 0.1 + clamp(mu.y,0.0,1.0)*0.8)/3.0);
      float m = texture2D(uAtlas, a).a * band * step(0.0, mu.y) * step(mu.y, 1.0);
      vec3 base = mix(vC2, vC1, smoothstep(0.05, 0.95, uv.y));
      float ribs = 1.0 - 0.45*pow(abs(sin(uv.x*3.14159*12.0)), 24.0);
      float inner = 0.5 + 0.5*sin(uv.y*3.14159);
      float flick = 0.88 + 0.08*sin(uTime*7.0 + vSeed*60.0) + 0.04*sin(uTime*17.0 + vSeed*13.0);
      vec3 c = base * inner * ribs * (1.0 + m*1.4) + vec3(1.0,0.9,0.7) * m * 0.9;
      float cap = step(uv.y, 0.06) + step(0.95, uv.y);
      c = mix(c, base*0.12, cap);
      float glow = vGlow * flick * (1.0 + vHover*1.2);
      c *= 2.1 * glow * mix(0.4, 1.0, smoothstep(4.0, 26.0, vD));
      gl_FragColor = vec4(applyFog(c, vD*0.55), 1.0);
    }`,
});
const lanternGeo = (() => {
  const pts = [[0.0, -0.58], [0.2, -0.58], [0.42, -0.42], [0.53, -0.14], [0.55, 0.12], [0.48, 0.38], [0.28, 0.56], [0.14, 0.62], [0.0, 0.62]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 18);
})();

const MAXL = 4000;
const lanternMesh = (() => {
  const g = lanternGeo.clone();
  const attr = (n, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAXL * s), s); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
  const mesh = new THREE.InstancedMesh(g, lanternMat, MAXL);
  mesh.count = 0; mesh.frustumCulled = false;
  mesh.userData.attrs = { c1: attr("aC1", 3), c2: attr("aC2", 3), motif: attr("aMotif", 1), glow: attr("aGlow", 1), seed: attr("aSeed", 1) };
  scene.add(mesh);
  return mesh;
})();

const lanterns = []; // {data, i, born, target:{x,y,z}, pos}
const lanternById = new Map();
const glowOf = (l) => { const idle = (Date.now() - (l.lastVisit || l.t)) / 3600e3; return 0.28 + 0.72 * Math.exp(-idle / 14) + Math.min(l.visits || 0, 40) * 0.006; };

function addLantern(l, { rising = false, from = null } = {}) {
  if (lanternById.has(l.id) || lanterns.length >= MAXL) return;
  const i = lanterns.length;
  const A = lanternMesh.userData.attrs;
  const c1 = new THREE.Color(PALETTE[l.primary] || PALETTE.marigold), c2 = new THREE.Color(PALETTE[l.secondary] || PALETTE.rose);
  const js = l.seed ?? 0.5; // no two lanterns of the same color are quite the same
  c1.offsetHSL((hash(js * 11) - 0.5) * 0.07, 0, (hash(js * 13) - 0.5) * 0.08); c2.offsetHSL((hash(js * 17) - 0.5) * 0.07, 0, 0);
  A.c1.setXYZ(i, c1.r, c1.g, c1.b); A.c2.setXYZ(i, c2.r, c2.g, c2.b);
  A.motif.setX(i, Math.max(0, MOTIFS.indexOf(l.motif))); A.seed.setX(i, l.seed ?? Math.random());
  A.glow.setX(i, glowOf(l) * (0.75 + (l.warmth || 6) * 0.05));
  for (const a of Object.values(A)) a.needsUpdate = true;
  const s = l.seed ?? Math.random();
  const target = new THREE.Vector3(l.x + (hash(s * 9) - 0.5) * 30, 14 + hash(s * 3) * 30, l.z + (hash(s * 5) - 0.5) * 30);
  const entry = { data: l, i, born: rising ? performance.now() / 1000 : -1e9, target, from: from ? from.clone() : new THREE.Vector3(l.x, 1.5, l.z), pos: new THREE.Vector3(), scale: 1.6 + (l.warmth || 6) * 0.08 };
  lanterns.push(entry); lanternById.set(l.id, entry);
  lanternMesh.count = lanterns.length;
  updateCounts();
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function updateLanterns(t) {
  const now = performance.now() / 1000;
  for (const L of lanterns) {
    const k = clamp((now - L.born) / 14, 0, 1), e = 1 - Math.pow(1 - k, 3);
    const s = L.data.seed ?? 0.5;
    const dx = Math.sin(t * 0.05 + s * 40) * 4, dz = Math.cos(t * 0.04 + s * 30) * 4, bob = Math.sin(t * 0.6 + s * 20) * 0.5;
    L.pos.set(lerp(L.from.x, L.target.x, e) + dx * e, lerp(L.from.y, L.target.y, e) + bob, lerp(L.from.z, L.target.z, e) + dz * e);
    if (k < 1) L.pos.x += Math.sin(now * 1.4 + s * 9) * 0.6 * (1 - k);
    _q.setFromAxisAngle(_s.set(0, 1, 0), t * 0.15 + s * 6); _s.setScalar(L.scale);
    _m.compose(L.pos, _q, _s); lanternMesh.setMatrixAt(L.i, _m);
  }
  lanternMesh.instanceMatrix.needsUpdate = true;
}


// ============================================================================ post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.55, 0.86);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: U.uTime, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = dot(c,c);
      vec2 off = c * r * 0.006;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - r*1.0;                                   // vignette
      col += (rnd(vUv*uRes + fract(uTime)*100.0) - 0.5) * 0.018; // grain
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());


// ============================================================================ audio (procedural, no files)
const audio = (() => {
  let ctx, master, on = false;
  function start() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.connect(master);
    [55, 82.4, 110.2, 164.8].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? "sawtooth" : "triangle"; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 14;
      const g = ctx.createGain(); g.gain.value = 0.05 / (i + 1);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03; const lg = ctx.createGain(); lg.gain.value = 0.02 / (i + 1);
      lfo.connect(lg).connect(g.gain); o.connect(g).connect(lp); o.start(); lfo.start();
    });
    // water & wind: filtered noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 400; bp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.05; n.connect(bp).connect(ng).connect(master); n.start();
    setInterval(() => { if (on && Math.random() < 0.35) chime(0.04); }, 2600);
  }
  const SCALE = [392, 440, 523.25, 587.33, 659.25, 783.99, 880];
  function chime(vol = 0.08, f) {
    if (!ctx || !on) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = "sine"; o.frequency.value = f || SCALE[(Math.random() * SCALE.length) | 0];
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    const o2 = ctx.createOscillator(); o2.frequency.value = o.frequency.value * 2.76; const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o2.connect(g2).connect(g); o.connect(g).connect(master); o.start(t); o2.start(t); o.stop(t + 3.6); o2.stop(t + 3.6);
  }
  return {
    toggle(force) {
      start(); on = force ?? !on;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(on ? 0.9 : 0, ctx.currentTime + 1.2);
      $("#sound").classList.toggle("on", on);
      if (ctx.state === "suspended") ctx.resume();
    },
    step() { if (!ctx || !on) return; const t = ctx.currentTime, n = ctx.createBufferSource(), b = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700 + Math.random() * 400; const g = ctx.createGain(); g.gain.value = 0.18; n.buffer = b; n.connect(f).connect(g).connect(master); n.start(t); },
    jump(k = 1) { if (!ctx || !on) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "triangle"; o.frequency.setValueAtTime(260 * k, t); o.frequency.exponentialRampToValueAtTime(620 * k, t + 0.14);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g).connect(master); o.start(t); o.stop(t + 0.22); },
    land() { this.step(); },
    flap(tier = 1) { if (!ctx || !on) return; const t = ctx.currentTime, n = ctx.createBufferSource(), b = ctx.createBuffer(1, ctx.sampleRate * 0.35, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(Math.sin(Math.PI * i / d.length), 2);
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.3); const g = ctx.createGain(); g.gain.value = 0.35; n.buffer = b; n.connect(f).connect(g).connect(master); n.start(t); chime(0.03, [659.25, 783.99, 1046.5][tier - 1]); },
    splash() { if (!ctx || !on) return; this.whoosh(); },
    pickup() { [0, 0.08, 0.16].forEach((d, i) => setTimeout(() => chime(0.09, [659.25, 783.99, 1046.5][i]), d * 1000)); },
    blip(base, ch) { if (!ctx || !on) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square";
      o.frequency.value = base * (1 + ((ch.toLowerCase().charCodeAt(0) * 7) % 12) / 24); g.gain.setValueAtTime(0.035, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1800; o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.07); },
    whoosh() { if (!ctx || !on) return; const t = ctx.currentTime, n = ctx.createBufferSource(), b = ctx.createBuffer(1, ctx.sampleRate * 0.8, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / d.length);
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.6);
      const g = ctx.createGain(); g.gain.value = 0.22; n.buffer = b; n.connect(f).connect(g).connect(master); n.start(t); },
    thud() { if (!ctx || !on) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500; o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.65); },
    chime, rise() { [0, 0.25, 0.5, 0.9].forEach((d, i) => setTimeout(() => chime(0.09, SCALE[[2, 4, 5, 6][i]]), d * 1000)); },
  };
})();


// ============================================================================ light
scene.add(new THREE.HemisphereLight(0x9c80d6, 0x2a1630, 1.9));
const moonLight = new THREE.DirectionalLight(0xcab8ff, 1.1); moonLight.position.set(-60, 90, -70); scene.add(moonLight);
const warm = (x, y, z, i = 18, d = 26) => { const l = new THREE.PointLight(0xff9a3c, i, d, 1.6); l.position.set(x, y, z); scene.add(l); return l; };

// ============================================================================ warm haze, marigold wisps, rising souls
const mistMat = (alpha, scale, speed, tint) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { ...U, uA: { value: alpha }, uS: { value: scale }, uV: { value: speed }, uTint: { value: tint } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uA, uS, uV; uniform vec3 uTint; varying vec3 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < ${LOW ? 3 : 4}; i++){ v += a*noise(p); p = p*2.03 + 7.1; a *= 0.5; } return v; }
    void main(){
      vec2 p = vW.xz * uS; float n = fbm(p + vec2(uTime*uV, uTime*uV*0.6)); n = fbm(p*0.7 + n*1.8);
      float d = length(cameraPosition.xz - vW.xz);
      float a = smoothstep(0.45, 0.85, n) * uA * smoothstep(2.0, 12.0, d) * (1.0 - smoothstep(160.0, 300.0, d));
      gl_FragColor = vec4(uTint * (0.6 + n*0.5), a);
    }`,
});
{ const m = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mistMat(0.3, 0.035, 0.02, new THREE.Color(0.42, 0.2, 0.42))); m.rotation.x = -Math.PI / 2; m.position.y = 0.3; m.renderOrder = 2; scene.add(m); }
const glowPts = (n, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aSeed", new THREE.BufferAttribute(Float32Array.from({ length: n }, Math.random), 1)); const p = new THREE.Points(g, mat); p.frustumCulled = false; scene.add(p); return p; };
const wispMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...U, uScale: { value: innerHeight * 0.5 } },
  vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime, uScale; varying float vA; varying float vS;
    void main(){ vS = aSeed; float f = 0.55 + 0.45*sin(uTime*(1.5+aSeed*2.0) + aSeed*40.0); vA = f*f;
      vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = (1.3 + aSeed) * uScale / -mv.z * (0.8 + 0.4*f); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying float vA; varying float vS; void main(){ float d = length(gl_PointCoord-0.5); float c = smoothstep(0.5,0.0,d);
    vec3 col = mix(vec3(1.0,0.55,0.12), vec3(1.0,0.35,0.55), vS); gl_FragColor = vec4(col*(c*c*1.2 + smoothstep(0.12,0.0,d)*1.4)*vA, 1.0); }` });
const WISPS = LOW ? 40 : 80, wisps = glowPts(WISPS, wispMat);
const wispState = Array.from({ length: WISPS }, () => { const a = Math.random() * 6.283, r = 66 + Math.random() * 90; return { c: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), r: 3 + Math.random() * 10, w: (0.05 + Math.random() * 0.15) * (Math.random() < 0.5 ? -1 : 1), o: Math.random() * 6.3, h: 0.8 + Math.random() * 3.5 }; });
function updateWisps(t) { const P = wisps.geometry.attributes.position;
  wispState.forEach((w, i) => { const a = w.o + t * w.w; P.setXYZ(i, w.c.x + Math.cos(a) * w.r, w.h + Math.sin(t * 0.9 + i * 1.7) * 0.6, w.c.z + Math.sin(a) * w.r); }); P.needsUpdate = true; }
const moteMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...U, uCam: { value: new THREE.Vector3() }, uScale: { value: innerHeight * 0.5 } },
  vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime, uScale; uniform vec3 uCam; varying float vA;
    void main(){ vec3 p = position; float B = 60.0; p.y = mod(p.y + uTime*(0.4 + aSeed*0.6), 26.0) - 2.0;
      p.x += sin(uTime*0.5 + aSeed*30.0)*1.5; p.z += cos(uTime*0.4 + aSeed*20.0)*1.5; p.xz = mod(p.xz - uCam.xz + B*0.5, B) + uCam.xz - B*0.5;
      vA = smoothstep(-2.0, 2.0, p.y) * smoothstep(24.0, 16.0, p.y) * (0.5 + 0.5*sin(uTime*3.0 + aSeed*50.0));
      vec4 mv = modelViewMatrix*vec4(p,1.0); gl_PointSize = (0.6 + aSeed*0.8) * uScale / -mv.z * 0.12; gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(vec3(1.0,0.72,0.35)*smoothstep(0.5,0.0,d)*vA*0.8, 1.0); }` });
{ const N = LOW ? 400 : 1100, m = glowPts(N, moteMat), P = m.geometry.attributes.position; for (let i = 0; i < N; i++) P.setXYZ(i, Math.random() * 60, Math.random() * 26, Math.random() * 60); }

// ============================================================================ world: colliders
// Three kinds of walkable things: PADS (round islands, cliffs are walls), BOXES (buildings, crates:
// a walkable top and solid sides), BRIDGES (ramps, stairs, planks: walkable, no walls).
const V3 = THREE.Vector3;
const TOWN_H = 1.0;
export const ISLANDS = [
  { name: "the town", x: 0, z: 0, r: 64, h: TOWN_H, key: "town" },
  { name: "El Panteón", x: 0, z: -100, r: 20, h: 2.5, key: "panteon" },
  { name: "El Muelle", x: 0, z: 98, r: 15, h: 0.8, key: "muelle" },
  { name: "La Huerta", x: -102, z: 0, r: 20, h: 3.2, key: "huerta" },
  { name: "El Mercado Flotante", x: 102, z: 0, r: 18, h: 1.6, key: "mercado" },
  { name: "El Mirador", x: 42, z: -142, r: 8, h: 16, key: "mirador" },
  { name: "La Isleta", x: 44, z: 132, r: 5.5, h: 0.9, key: "isleta" },
];
const STONES = [];
const stonePath = (ax, az, ah, bx, bz, bh, n) => { for (let i = 1; i <= n; i++) { const t = i / (n + 1); STONES.push({ x: lerp(ax, bx, t) + Math.sin(i * 1.7) * 0.6, z: lerp(az, bz, t) + Math.cos(i * 2.1) * 0.5, r: 1.5, h: lerp(ah, bh, t), stone: true }); } };
stonePath(14, -112, 2.5, 38, -136, 16, 12);   // the climb to El Mirador
stonePath(0, 125.5, 0.8, 39, 131, 0.9, 13);       // across the water from the end of the dock to La Isleta
ISLANDS.push({ name: "La Nube", x: -46, z: -74, r: 6.5, h: 22, key: "nube" }); // only wings reach the cloud island
const PADS = [...ISLANDS, ...STONES];
const BOXES = [];   // {x0,x1,z0,z1,y0,y1}
const BRIDGES = []; // {ax,az,ah,bx,bz,bh,w,flat}
const solid = (x, z, w, d, y0, y1) => { const b = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0, y1 }; BOXES.push(b); return b; };
const ramp = (ax, az, ah, bx, bz, bh, w = 1.8, flat = true) => { const b = { ax, az, ah, bx, bz, bh, w, flat }; BRIDGES.push(b); return b; };
const bridgeH = (b, t) => b.ah + (b.bh - b.ah) * t + (b.flat ? 0 : Math.sin(t * Math.PI) * 0.7);

export function groundAt(x, z, y) {
  let best = -Infinity;
  for (const s of PADS) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r && s.h <= y + 0.8 && s.h > best) best = s.h;
  for (const b of BOXES) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= y + 0.8 && b.y1 > best) best = b.y1;
  for (const b of BRIDGES) {
    const dx = b.bx - b.ax, dz = b.bz - b.az, L2 = dx * dx + dz * dz;
    const t = ((x - b.ax) * dx + (z - b.az) * dz) / L2; if (t < -0.02 || t > 1.02) continue;
    const px = b.ax + dx * t, pz = b.az + dz * t;
    if ((x - px) ** 2 + (z - pz) ** 2 < (b.w / 2) ** 2) { const h = bridgeH(b, clamp(t, 0, 1)); if (h <= y + 0.8 && h > best) best = h; }
  }
  return best;
}
// push a body of radius r out of every wall it overlaps at height y
function collideWalls(p, y, r = 0.38) {
  for (const s of PADS) { if (s.h <= y + 0.8) continue; const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz), R = s.r + r; if (d < R && d > 0.001) { p.x = s.x + (dx / d) * R; p.z = s.z + (dz / d) * R; } }
  for (const b of BOXES) {
    if (b.y1 <= y + 0.8 || b.y0 >= y + 1.7) continue;
    if (p.x <= b.x0 - r || p.x >= b.x1 + r || p.z <= b.z0 - r || p.z >= b.z1 + r) continue;
    const pen = [p.x - (b.x0 - r), b.x1 + r - p.x, p.z - (b.z0 - r), b.z1 + r - p.z], m = Math.min(...pen);
    if (m === pen[0]) p.x = b.x0 - r; else if (m === pen[1]) p.x = b.x1 + r; else if (m === pen[2]) p.z = b.z0 - r; else p.z = b.z1 + r;
  }
  for (const b of BRIDGES) { // the side of a staircase is a wall too: you can't walk into it, only up it
    if (!b.solid) continue;
    const dx = b.bx - b.ax, dz = b.bz - b.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    const along = (p.x - b.ax) * ux + (p.z - b.az) * uz, side = -(p.x - b.ax) * uz + (p.z - b.az) * ux, half = b.w / 2 + r;
    if (along < -r || along > L + r || Math.abs(side) >= half) continue;
    const h = bridgeH(b, clamp(along / L, 0, 1)); if (h <= y + 0.8 || Math.min(b.ah, b.bh) >= y + 1.7) continue;
    const toSide = half - Math.abs(side), toLow = b.ah < b.bh ? along + r : L + r - along;
    if (toSide <= toLow) { const ns = Math.sign(side || 1) * half; p.x = b.ax + ux * along - uz * ns; p.z = b.az + uz * along + ux * ns; }
    else { const a2 = b.ah < b.bh ? -r : L + r; p.x = b.ax + ux * a2 - uz * side; p.z = b.az + uz * a2 + ux * side; }
  }
}
let insideCasa = -1;
const insideSolid = (x, y, z) => BOXES.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1);
const groundTop = (x, z) => groundAt(x, z, 200);
export const SPOT = {};  // named places filled in while building: item pedestals, ghost homes, secrets

// ============================================================================ materials + builders
const M = {
  rock: new THREE.MeshLambertMaterial({ color: 0x3a2850, flatShading: true }),
  top: new THREE.MeshLambertMaterial({ color: 0xffffff, map: (() => { const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d"); g.fillStyle = "#3a2b4a"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = Math.random(); g.fillStyle = v < 0.5 ? "rgba(80,58,96,.55)" : v < 0.85 ? "rgba(28,20,40,.5)" : v < 0.95 ? "rgba(60,90,70,.5)" : "rgba(255,140,30,.5)"; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 14); t.colorSpace = THREE.SRGBColorSpace; return t; })() }),
  street: new THREE.MeshLambertMaterial({ color: 0x4a3a52 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x5a3527 }),
  crate: new THREE.MeshLambertMaterial({ color: 0x7a4a2c }),
  stone: new THREE.MeshLambertMaterial({ color: 0x8b80a6, flatShading: true }),
  dark: new THREE.MeshLambertMaterial({ color: 0x150c20 }),
  wall: new THREE.MeshLambertMaterial({ color: 0xd7c3ad }),
  roof: new THREE.MeshLambertMaterial({ color: 0x6e3b3b }),
  leaf: new THREE.MeshLambertMaterial({ color: 0x24402f, flatShading: true }),
  cypress: new THREE.MeshLambertMaterial({ color: 0x1a3330, flatShading: true }),
  glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.0, 0.3) }),
  window: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 0.85, 0.32) }),
  door: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.35, 0.12) }),
  gold: new THREE.MeshLambertMaterial({ color: 0xd8a640, emissive: 0x3a2200 }),
};
const cloth = (c) => new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(0.18) });
const box = (w, h, d, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m; };
const cyl = (rt, rb, h, mat, x, y, z, seg = 10) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); scene.add(m); return m; };
const flowerSpots = [], flameSpots = [], stickSpots = [];
const marigold = (x, y, z, s = 1) => flowerSpots.push([x, y, z, s]);
const candle = (x, y, z, big = 1) => { const h = 0.22 + Math.random() * 0.3; stickSpots.push([x, y, z, h, big]); flameSpots.push([x, y + h * big + 0.1, z, big]); };
let seedR = 7; const rnd = () => ((seedR = (seedR * 16807) % 2147483647) / 2147483647); // deterministic, so every player gets the same town

const flags = [];
const flagGeo = new THREE.PlaneGeometry(0.8, 1.0, 4, 4); flagGeo.translate(0, -0.5, 0);
const flagMats = ["#ff2e88", "#ff8c1a", "#1fd1c1", "#9d5cff", "#ffd23c", "#2fd67b"].flatMap((c) => [0, 1].map((v) =>
  new THREE.MeshBasicMaterial({ map: picadoTexture(c, v), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(1.15, 1.15, 1.15) })));
function picadoLine(a, b, sag = 1.0) {
  const curve = new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).add(new V3(0, -sag, 0)), b);
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(24)), new THREE.LineBasicMaterial({ color: 0x5b4a5e })));
  const n = Math.max(3, Math.floor(a.distanceTo(b) / 1.25));
  for (let i = 0; i < n; i++) { const f = new THREE.Mesh(flagGeo, flagMats[(rnd() * flagMats.length) | 0]); f.position.copy(curve.getPoint((i + 0.5) / n));
    f.lookAt(f.position.clone().add(new V3(-(b.z - a.z), 0, b.x - a.x))); f.userData.seed = rnd() * 10; scene.add(f); flags.push(f); }
}
function grave(x, y, z, ry) { box(0.9, 1.1, 0.22, M.stone, x, y + 0.55, z, ry); cyl(0.45, 0.45, 0.22, M.stone, x, y + 1.1, z, 12).rotation.set(Math.PI / 2, 0, ry); candle(x + Math.sin(ry) * 0.5, y, z + Math.cos(ry) * 0.5); for (let k = 0; k < 5; k++) marigold(x + Math.sin(ry) * 0.7 + (rnd() - .5) * .6, y + .06, z + Math.cos(ry) * 0.7 + (rnd() - .5) * .6); }
function cypress(x, y, z, h = 4) { cyl(0.12, 0.15, 0.6, M.wood, x, y + 0.3, z, 6); const c = new THREE.Mesh(new THREE.ConeGeometry(0.75, h, 7), M.cypress); c.position.set(x, y + 0.5 + h / 2, z); scene.add(c); }
function tree(x, y, z) { cyl(0.18, 0.26, 2.2, M.wood, x, y + 1.1, z, 7); const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), M.leaf); c.position.set(x, y + 3, z); c.scale.y = 0.8; scene.add(c);
  for (let k = 0; k < 6; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), M.glow); f.position.set(x + Math.cos(k * 1.1) * 1.3, y + 2.6 + Math.sin(k * 2.3) * 0.5, z + Math.sin(k * 1.1) * 1.3); scene.add(f); } }
function stall(x, y, z, ry, colA, colB) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 8; const g = c.getContext("2d"); for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? colA : colB; g.fillRect(k * 8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = ry; scene.add(grp);
  for (const [px, pz] of [[-1.3, -0.8], [1.3, -0.8], [-1.3, 0.8], [1.3, 0.8]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5), M.wood); p.position.set(px, 1.15, pz); grp.add(p); }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 2.1), new THREE.MeshLambertMaterial({ map: t, emissive: 0x1a0a10 })); roof.position.y = 2.35; grp.add(roof);
  const table = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.0), M.wood); table.position.set(0, 0.45, 0.2); grp.add(table);
  const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M.glow); l.position.set(0, 2.1, 0); grp.add(l);
  solid(x, z, 2.9, 2.1, y + 2.25, y + 2.42); // you can land on the awning
}
function crates(x, z, y, n) { // a little climbable stack
  const sizes = [[1.2, 1.0], [1.0, 0.9], [0.9, 0.9]];
  let top = y;
  for (let i = 0; i < n; i++) { const [w, h] = sizes[i], ox = i * 0.15, oz = -i * 0.1; box(w, h, w, M.crate, x + ox, top + h / 2, z + oz, i * 0.3); solid(x + ox, z + oz, w, w, top, top + h); top += h; }
  return top;
}
function steps(ax, az, ah, bx, bz, bh, w = 1.8) { // visible stairs + a ramp collider (solid underneath)
  ramp(ax, az, ah, bx, bz, bh, w, true).solid = true;
  const n = Math.max(2, Math.round(Math.abs(bh - ah) / 0.35)), ry = Math.atan2(bx - ax, bz - az), L = Math.hypot(bx - ax, bz - az);
  const base = Math.min(ah, bh);
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, h = lerp(ah, bh, t), hh = Math.max(0.25, h - base); const m = box(w, hh, L / n + 0.05, M.stone, lerp(ax, bx, t), h - hh / 2, lerp(az, bz, t)); m.rotation.y = ry; }
}
function plank(ax, az, ah, bx, bz, bh, w = 1.4) {
  ramp(ax, az, ah, bx, bz, bh, w, true);
  const L = Math.hypot(bx - ax, bz - az), ry = Math.atan2(bx - ax, bz - az), n = Math.ceil(L / 0.6);
  for (let i = 0; i <= n; i++) { const t = i / n; const m = box(w, 0.1, 0.5, M.wood, lerp(ax, bx, t), lerp(ah, bh, t) - 0.05, lerp(az, bz, t)); m.rotation.y = ry; }
  if (L > 3) for (const t of [0.02, 0.98]) for (const s of [-1, 1]) cyl(0.04, 0.04, 0.9, M.wood, lerp(ax, bx, t) + Math.cos(ry) * s * w / 2, lerp(ah, bh, t) + 0.4, lerp(az, bz, t) - Math.sin(ry) * s * w / 2, 5);
  if (L > 5) for (let i = 1; i < 3; i++) { const t = i / 3; candle(lerp(ax, bx, t) + Math.cos(ry) * w * 0.4, lerp(ah, bh, t), lerp(az, bz, t) - Math.sin(ry) * w * 0.4, 0.9); }
}
function swingBridge(ax, az, ah, bx, bz, bh, w = 3.2) { // rope bridges between islands
  ramp(ax, az, ah, bx, bz, bh, w, false);
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ry = Math.atan2(dx, dz), n = Math.floor(L / 0.62), b = BRIDGES[BRIDGES.length - 1];
  const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(w, 0.12, 0.5), M.wood, n + 1), mm = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), ry);
  for (let k = 0; k <= n; k++) { const t = k / n, x = ax + dx * t, z = az + dz * t, h = bridgeH(b, t); mm.compose(new V3(x, h - 0.08, z), q, new V3(1, 1, 1)); planks.setMatrixAt(k, mm);
    if (k % 7 === 0) for (const s of [-1, 1]) { const ox = Math.cos(ry) * s * (w / 2), oz = -Math.sin(ry) * s * (w / 2); cyl(0.06, 0.07, 1.0, M.wood, x + ox, h + 0.42, z + oz, 6); if (k % 14 === 0) candle(x + ox, h + 0.92, z + oz, 1.1); }
    if (rnd() < 0.5) marigold(x + (rnd() - 0.5) * w * 0.9, h + 0.02, z + (rnd() - 0.5) * 0.4, 0.6); }
  scene.add(planks);
}
const WALLS = [0xe8a0b4, 0x6fc7c0, 0xf0c060, 0xb99be0, 0xe0805a, 0x8fd09a, 0xf2e0c8, 0x5aa0e0, 0xff9a7a];
function windowsOn(x0, x1, z, y0, y1, ry, n) { // glowing windows on one facade
  for (let fl = y0 + 1.6; fl < y1 - 0.6; fl += 2.2) for (let i = 0; i < n; i++) { if (rnd() < 0.25) continue; const t = (i + 0.5) / n;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.0), rnd() < 0.8 ? M.window : M.dark); w.position.set(lerp(x0, x1, t), fl, z); w.rotation.y = ry; scene.add(w); }
}
// a house: solid walls, a walkable flat roof with a low parapet, windows that glow, a door
function house(x, z, w, d, h, color, o = {}) {
  const y0 = o.y0 ?? TOWN_H, y1 = y0 + h;
  box(w, h, d, new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.06) }), x, y0 + h / 2, z);
  box(w + 0.3, 0.25, d + 0.3, M.roof, x, y1 + 0.1, z);
  const lip = 0.35; for (const [px, pz, pw, pd] of [[x, z - d / 2, w + 0.3, 0.22], [x, z + d / 2, w + 0.3, 0.22], [x - w / 2, z, 0.22, d + 0.3], [x + w / 2, z, 0.22, d + 0.3]]) box(pw, lip, pd, M.roof, px, y1 + 0.25 + lip / 2, pz);
  solid(x, z, w, d, y0, y1 + 0.22);
  const nx = Math.max(2, Math.round(w / 2.2)), nz = Math.max(2, Math.round(d / 2.2));
  windowsOn(x - w / 2 + 0.4, x + w / 2 - 0.4, z + d / 2 + 0.01, y0, y1, 0, nx); windowsOn(x - w / 2 + 0.4, x + w / 2 - 0.4, z - d / 2 - 0.01, y0, y1, Math.PI, nx);
  const side = (zz, ry) => { for (let fl = y0 + 1.6; fl < y1 - 0.6; fl += 2.2) for (let i = 0; i < nz; i++) { if (rnd() < 0.3) continue; const wq = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.0), M.window); wq.position.set(zz, fl, z - d / 2 + 0.4 + ((i + 0.5) / nz) * (d - 0.8)); wq.rotation.y = ry; scene.add(wq); } };
  side(x + w / 2 + 0.01, Math.PI / 2); side(x - w / 2 - 0.01, -Math.PI / 2);
  const df = o.door || "s", dp = { s: [x, z + d / 2 + 0.02, 0], n: [x, z - d / 2 - 0.02, Math.PI], e: [x + w / 2 + 0.02, z, Math.PI / 2], w: [x - w / 2 - 0.02, z, -Math.PI / 2] }[df];
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.1), M.door); door.position.set(dp[0], y0 + 1.05, dp[1]); door.rotation.y = dp[2]; scene.add(door);
  candle(dp[0] + Math.sin(dp[2] + 1.57) * 0.9 + Math.sin(dp[2]) * 0.5, y0, dp[1] + Math.cos(dp[2] + 1.57) * 0.9 + Math.cos(dp[2]) * 0.5);
  // rooftop life: marigold pots, candles on the parapet, sometimes a water tank or a laundry line
  for (let i = 0; i < 4; i++) { const px = x + (rnd() - 0.5) * (w - 1.5), pz = z + (rnd() - 0.5) * (d - 1.5); cyl(0.28, 0.22, 0.4, M.crate, px, y1 + 0.42, pz, 8); for (let k = 0; k < 5; k++) marigold(px + (rnd() - .5) * .4, y1 + 0.7, pz + (rnd() - .5) * .4, 1.1); }
  for (const [cx, cz] of [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x - w / 2, z + d / 2], [x + w / 2, z + d / 2]]) candle(cx, y1 + 0.6, cz, 1.1);
  if (rnd() < 0.35) { const tx = x + w / 2 - 1.2, tz = z - d / 2 + 1.2; cyl(0.8, 0.8, 1.4, M.stone, tx, y1 + 1.0, tz, 10); solid(tx, tz, 1.5, 1.5, y1, y1 + 1.7); }
  else if (rnd() < 0.5) picadoLine(new V3(x - w / 2 + 0.3, y1 + 1.6, z), new V3(x + w / 2 - 0.3, y1 + 1.6, z), 0.4);
  if (o.lamp !== false && rnd() < 0.15) warm(x, y1 + 2, z, 6, 12);
  return { x, z, w, d, y0, y1, top: y1 + 0.22 };
}


// ============================================================================ houses you can walk into
// Walls with a doorway, furniture inside, a staircase up to a hatch in the roof. The roof hides while you're inside.
const CASAS = [];
function casa(x, z, w, d, color, o) {
  const before = scene.children.length;
  const y0 = TOWN_H, h = 4.4, y1 = y0 + h, t = 0.3, top = y1 + 0.22, door = o.door || "s";
  const wallMat = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.06) });
  const inMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xf4e3c8), 0.55), side: THREE.DoubleSide });
  const roofParts = [];
  const wall = (cx, cz, ww, dd, a, b) => { const m = box(ww, b - a, dd, wallMat, cx, (a + b) / 2, cz); const bx = solid(cx, cz, ww, dd, a, b); bx.roofOf = CASAS.length; return m; };
  // floor + rug
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(w - t * 2, d - t * 2), new THREE.MeshLambertMaterial({ color: 0x6a4030 })); fl.rotation.x = -Math.PI / 2; fl.position.set(x, y0 + 0.02, z); scene.add(fl);
  // walls: the door side gets a 1.7 m gap and a lintel
  const gap = 1.7, side = { s: [z + d / 2, "x"], n: [z - d / 2, "x"], e: [x + w / 2, "z"], w: [x - w / 2, "z"] };
  for (const k of ["s", "n", "e", "w"]) {
    const [c, axis] = side[k], len = axis === "x" ? w : d, mid = axis === "x" ? x : z;
    const piece = (a, b, ya, yb) => axis === "x" ? wall((a + b) / 2, c, b - a, t, ya, yb) : wall(c, (a + b) / 2, t, b - a, ya, yb);
    if (k !== door) { piece(mid - len / 2, mid + len / 2, y0, top); continue; }
    const g0 = mid - gap / 2, g1 = mid + gap / 2;
    piece(mid - len / 2, g0, y0, top); piece(g1, mid + len / 2, y0, top); piece(g0, g1, y0 + 2.4, top);
    const dm = new THREE.Mesh(new THREE.PlaneGeometry(gap, 2.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.8, 0.35), transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    if (axis === "x") dm.position.set(mid, y0 + 1.2, c); else { dm.position.set(c, y0 + 1.2, mid); dm.rotation.y = Math.PI / 2; } scene.add(dm);
  }
  // inside faces of the walls in a softer plaster
  // stairs along the east inner wall, front to back, ending under a hatch
  const sx = x + w / 2 - t - 0.85, L = 7.0, zFront = z + d / 2 - t - 0.6, zTop = zFront - L;
  steps(sx, zFront, y0, sx, zTop, top, 1.5);
  for (let i = 0; i < 6; i++) cyl(0.03, 0.03, 0.9, M.wood, sx - 0.78, lerp(y0, top, i / 5) + 0.45, lerp(zFront, zTop, i / 5), 5);
  // roof slab with a hatch over the last stretch of stairs (so you never bump your head)
  const hx0 = sx - 0.85, hx1 = sx + 0.85, hz0 = zTop - 0.4, hz1 = zTop + 5.0, X0 = x - w / 2, X1 = x + w / 2, Z0 = z - d / 2, Z1 = z + d / 2;
  const slab = (a, b, c2, d2) => { if (b - a < 0.05 || d2 - c2 < 0.05) return; const m = box(b - a, 0.25, d2 - c2, M.roof, (a + b) / 2, y1 + 0.1, (c2 + d2) / 2); roofParts.push(m); const bx = solid((a + b) / 2, (c2 + d2) / 2, b - a, d2 - c2, y1, top); bx.roofOf = CASAS.length; };
  slab(X0, hx0, Z0, Z1); slab(hx1, X1, Z0, Z1); slab(hx0, hx1, Z0, hz0); slab(hx0, hx1, hz1, Z1);
  for (const [px, pz, pw, pd] of [[x, Z0, w + 0.3, 0.22], [x, Z1, w + 0.3, 0.22], [X0, z, 0.22, d + 0.3], [X1, z, 0.22, d + 0.3]]) roofParts.push(box(pw, 0.35, pd, M.roof, px, top + 0.17, pz));
  windowsOn(X0 + 0.4, X1 - 0.4, Z1 + 0.16, y0, y1, 0, 3); windowsOn(X0 + 0.4, X1 - 0.4, Z0 - 0.16, y0, y1, Math.PI, 3);
  const lamp = new THREE.PointLight(0xffa04a, 14, 11, 1.5); lamp.position.set(x - 0.5, y1 - 0.9, z); scene.add(lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), M.glow); bulb.position.copy(lamp.position); scene.add(bulb);
  const glows = scene.children.slice(before).filter((m) => m.isMesh && (m.material === M.window || m.material === M.dark || (m.material.transparent && m.material.opacity < 0.3)));
  const c = { glows, name: o.name, wallMat, x, z, w, d, y0, y1, top, roofParts, x0: X0 + t, x1: X1 - t, z0: Z0 + t, z1: Z1 - t, x: x, sx };
  CASAS.push(c);
  o.furnish(c);
  return { x, z, w, d, y0, y1, top, casa: c };
}
const furn = {
  table(x, z, y) { box(1.6, 0.08, 1.0, M.wood, x, y + 0.78, z); for (const [a, b] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]]) box(0.08, 0.76, 0.08, M.wood, x + a, y + 0.38, z + b); solid(x, z, 1.6, 1.0, y, y + 0.82); },
  chair(x, z, y, ry = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), cloth(0xd14b2b)); seat.position.y = 0.48; g.add(seat); const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.06), M.wood); back.position.set(0, 0.8, -0.22); g.add(back); for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.05), M.wood); l.position.set(a, 0.24, b); g.add(l); } },
  bed(x, z, y, ry = 0, col = 0xb3125a) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); const fr = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 2.1), M.wood); fr.position.y = 0.2; g.add(fr); const mat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 2.0), cloth(0xf2e6cc)); mat.position.y = 0.48; g.add(mat); const bl = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.06, 1.3), cloth(col)); bl.position.set(0, 0.6, 0.3); g.add(bl); const pil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.35), cloth(0xffffff)); pil.position.set(0, 0.64, -0.75); g.add(pil); const hb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.08), M.wood); hb.position.set(0, 0.55, -1.05); g.add(hb); solid(x, z, ry ? 2.1 : 1.3, ry ? 1.3 : 2.1, y, y + 0.66); },
  shelf(x, z, y, ry = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); const fr = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.0, 0.4), M.wood); fr.position.y = 1; g.add(fr);
    const cols = [0xd14b2b, 0x1fa59a, 0xffc93c, 0x6b2bd6, 0x2f7a3a, 0xff8c1a]; for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4 + ((i * 7 + r) % 3) * 0.06, 0.28), cloth(cols[(i + r) % 6])); b.position.set(-0.6 + i * 0.24, 0.45 + r * 0.6, 0.08); g.add(b); } },
  stove(x, z, y) { box(1.1, 0.9, 0.7, cloth(0x2d6fb0), x, y + 0.45, z); box(1.15, 0.06, 0.75, M.dark, x, y + 0.92, z); const pot = cyl(0.22, 0.2, 0.28, M.dark, x - 0.25, y + 1.09, z, 12); const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), M.glow); f.position.set(x + 0.25, y + 0.98, z); scene.add(f); solid(x, z, 1.1, 0.7, y, y + 0.95); },
  altar(x, z, y, ry = 0) { box(1.4, 0.7, 0.5, cloth(0xb3125a), x, y + 0.35, z, ry); box(1.0, 0.45, 0.4, cloth(0xff7a00), x, y + 0.92, z - 0.05, ry); for (let i = 0; i < 4; i++) candle(x - 0.55 + i * 0.37, y + 0.7, z + 0.15, 0.8); for (let i = 0; i < 9; i++) marigold(x - 0.6 + i * 0.15, y + 0.74, z + 0.2, 0.9); box(0.36, 0.46, 0.04, M.gold, x, y + 1.38, z - 0.15, ry); },
  rug(x, z, y, w, d, col) { const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: serapeTexture(col) })); r.rotation.x = -Math.PI / 2; r.rotation.z = Math.PI / 2; r.position.set(x, y + 0.03, z); scene.add(r); },
  sofa(x, z, y, ry = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g); const b = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 0.8), cloth(0x1fa59a)); b.position.y = 0.25; g.add(b); const bk = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 0.2), cloth(0x168a80)); bk.position.set(0, 0.7, -0.32); g.add(bk); for (const s2 of [-1, 1]) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.8), cloth(0x168a80)); a.position.set(s2 * 1.0, 0.45, 0); g.add(a); } solid(x, z, ry ? 0.8 : 2.0, ry ? 2.0 : 0.8, y, y + 0.5); },
  bench(x, z, y, ry = 0) { box(2.2, 0.1, 0.8, M.wood, x, y + 0.9, z, ry); box(2.2, 0.85, 0.1, M.wood, x, y + 0.45, z + 0.35, ry); solid(x, z, ry ? 0.8 : 2.2, ry ? 2.2 : 0.8, y, y + 0.95);
    for (let i = 0; i < 5; i++) { const gear = new THREE.Mesh(new THREE.TorusGeometry(0.08 + (i % 3) * 0.04, 0.025, 6, 12), M.gold); gear.rotation.x = Math.PI / 2; gear.position.set(x - 0.8 + i * 0.4, y + 0.97, z - 0.1); scene.add(gear); } },
  clocks(x, z, y) { for (let i = 0; i < 4; i++) { const cl = cyl(0.26, 0.26, 0.06, M.gold, x - 1.0 + i * 0.66, y + 2.2 + (i % 2) * 0.35, z, 18); cl.rotation.x = Math.PI / 2; const face = new THREE.Mesh(new THREE.CircleGeometry(0.21, 18), new THREE.MeshBasicMaterial({ color: 0xfff6e0 })); face.position.set(cl.position.x, cl.position.y, z + 0.04); scene.add(face); } },
};
// ============================================================================ islands (terrain)
ISLANDS.forEach((s, i) => {
  const depth = s.h + 9, g = new THREE.CylinderGeometry(s.r, s.r * 0.55, depth, s.r > 30 ? 80 : 44, 4);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const y = p.getY(k); if (y > depth / 2 - 0.01) continue;
    const a = Math.atan2(p.getZ(k), p.getX(k)), n = 1 + 0.07 * Math.sin(a * 7 + i) + 0.05 * Math.sin(a * 13 + y); p.setX(k, p.getX(k) * n); p.setZ(k, p.getZ(k) * n); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, [M.rock, M.top, M.rock]); m.position.set(s.x, s.h - depth / 2, s.z); scene.add(m);
  const ring = Math.floor(s.r * 7);
  for (let k = 0; k < ring; k++) { const a = (k / ring) * Math.PI * 2, d = s.r - 0.5 - rnd() * 1.4; marigold(s.x + Math.cos(a) * d, s.h + 0.08, s.z + Math.sin(a) * d, 0.8 + rnd() * 0.6); }
  const nc = Math.floor(s.r * 1.6); for (let k = 0; k < nc; k++) { const a = (k / nc) * Math.PI * 2; candle(s.x + Math.cos(a) * (s.r - 0.35), s.h, s.z + Math.sin(a) * (s.r - 0.35)); }
});
STONES.forEach((s) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r * 0.4, 1.4, 9), M.stone); m.position.set(s.x, s.h - 0.7, s.z); scene.add(m);
  candle(s.x, s.h, s.z, 1.2); for (let k = 0; k < 6; k++) marigold(s.x + Math.cos(k) * 1.1, s.h + 0.05, s.z + Math.sin(k) * 1.1); });
// streets: two marigold-lined avenues and a ring road, slightly darker than the ground
{ const y = TOWN_H + 0.01;
  for (const [w, d] of [[8, 124], [124, 8]]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.street); s.rotation.x = -Math.PI / 2; s.position.y = y; scene.add(s); }
  const ring = new THREE.Mesh(new THREE.RingGeometry(16, 19.5, 64), M.street); ring.rotation.x = -Math.PI / 2; ring.position.y = y; scene.add(ring);
  for (let i = -58; i <= 58; i += 2.2) for (const s of [-1, 1]) { if (Math.abs(i) < 18) continue; marigold(s * 4.3, y + 0.05, i, 0.9); marigold(i, y + 0.05, s * 4.3, 0.9); }
  for (let i = -56; i <= 56; i += 11) for (const s of [-1, 1]) { if (Math.abs(i) < 20) continue; for (const [lx, lz] of [[s * 4.8, i], [i, s * 4.8]]) { cyl(0.07, 0.09, 3.2, M.dark, lx, y + 1.6, lz, 6); const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), M.glow); l.position.set(lx, y + 3.3, lz); scene.add(l); } }
}

// ============================================================================ the plaza and the great ofrenda
{ const y = TOWN_H, az = -6;
  [[9, 1.2, 4, 0xb3125a], [7, 1.2, 3, 0xff7a00], [5, 1.2, 2, 0x6b2bd6]].forEach(([w, h, d, c], k) => {
    box(w, h, d, cloth(c), 0, y + h / 2 + k * h, az - k * 0.6); solid(0, az - k * 0.6, w, d, y + k * h, y + (k + 1) * h);
    for (let i = 0; i < w * 1.6; i++) candle(-w / 2 + 0.3 + (i / (w * 1.6)) * (w - 0.6), y + (k + 1) * h, az - k * 0.6 + d / 2 - 0.25, 1.1); });
  for (let i = 0; i < 5; i++) { const fx = -2 + i, fy = y + 3.6 + (i % 2) * 0.25; box(0.62, 0.8, 0.06, M.gold, fx, fy, az - 1.25);
    const ph = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9 + i * 0.05, 0.7, 0.5) })); ph.position.set(fx, fy, az - 1.21); scene.add(ph); }
  for (let k = 0; k <= 60; k++) { const a = (k / 60) * Math.PI; for (let j = 0; j < 7; j++) marigold(Math.cos(a) * 5.5 + (rnd() - .5) * .5, y + Math.sin(a) * 6.5 + (rnd() - .5) * .5, az + 3.2 + (rnd() - .5) * .5, 1.5); }
  cyl(0.12, 0.14, 10, M.wood, 0, y + 5, 6, 8);
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2 + 0.2, px = Math.cos(a) * 15, pz = Math.sin(a) * 15; cyl(0.07, 0.09, 4.2, M.wood, px, y + 2.1, pz, 6); picadoLine(new V3(0, y + 9.6, 6), new V3(px, y + 4.1, pz)); }
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.4; const bx = Math.cos(a) * 11, bz = Math.sin(a) * 11 + 2; box(1.6, 0.45, 0.5, M.wood, bx, y + 0.35, bz, -a); }
  warm(0, y + 4, az + 3, 40, 30); warm(0, y + 3, 9, 12, 20);
  SPOT.altar = new V3(0, y, az + 2.6);
  SPOT.homes = [new V3(6, y, 8), new V3(-8, y, 4)];
  SPOT.secrets = [new V3(0, y + 3.6, az - 1.2)]; // on top of the ofrenda, if you can get up there
}

// three houses you can walk into, and what's inside them
const CASA_LOTS = [
  { q: "Barrio del Correo", lot: [0, 2], name: "Casa de la Abuela", color: 0xe8a0b4, furnish: (c) => { const y = c.y0;
      furn.rug(c.x - 1.4, c.z + 0.5, y, 2.4, 3.2, 0.95); furn.table(c.x - 1.5, c.z + 0.4, y); furn.chair(c.x - 1.5, c.z - 0.5, y, 0); furn.chair(c.x - 1.5, c.z + 1.3, y, Math.PI);
      furn.stove(c.x - 2.8, c.z0 + 0.5, y); furn.bed(c.x - 2.6, c.z1 - 2.4, y, Math.PI / 2, 0xb3125a); furn.altar(c.x + 0.2, c.z0 + 0.4, y);
      SPOT.casaAbuela = new V3(c.x - 1.5, y, c.z + 0.4); SPOT.homes.push(new V3(c.x - 0.6, y, c.z + 2.6)); SPOT.secrets.push(new V3(c.x - 3.1, y, c.z1 - 0.9)); } },
  { q: "Barrio Alto", lot: [2, 0], name: "Taller del Relojero", color: 0x6fc7c0, furnish: (c) => { const y = c.y0;
      furn.bench(c.x - 1.6, c.z0 + 0.7, y); furn.clocks(c.x - 1.6, c.z0 + 0.32, y); furn.shelf(c.x - 3.2, c.z + 1.5, y, Math.PI / 2); furn.chair(c.x - 1.6, c.z0 + 1.8, y, Math.PI);
      for (let i = 0; i < 3; i++) crates(c.x - 2.8 + i * 0.1, c.z1 - 1.0 - i * 1.25, y, 1);
      SPOT.taller = new V3(c.x - 0.6, y, c.z + 1.2); SPOT.secrets.push(new V3(c.x - 2.8, y + 1.0, c.z1 - 1.0)); } },
  { q: "Barrio de la Cantina", lot: [2, 0], name: "Casa Azul", color: 0x5aa0e0, furnish: (c) => { const y = c.y0;
      furn.rug(c.x - 1.3, c.z, y, 3, 4, 0.55); furn.sofa(c.x - 1.3, c.z0 + 1.0, y, 0); furn.shelf(c.x - 3.2, c.z + 1.2, y, Math.PI / 2); furn.table(c.x - 1.3, c.z + 0.4, y);
      furn.bed(c.x - 2.5, c.z1 - 1.6, y, Math.PI / 2, 0x6b2bd6);
      SPOT.casaAzul = new V3(c.x - 1.3, y + 0.82, c.z + 0.4); SPOT.secrets.push(new V3(c.x - 0.4, y, c.z1 - 0.8)); } },
];
// ============================================================================ the four barrios
// lots: 12 x 12 blocks between the avenues; each quadrant has a landmark on lot (1,1)
const LOTS = [[1, 0], [2, 0], [0, 1], [0, 2], [1, 1]];
const lotCenter = (i) => 16 + i * 16;
const houses = [];
const QUADS = [[1, -1, "Barrio Alto"], [-1, -1, "Barrio de la Capilla"], [1, 1, "Barrio del Correo"], [-1, 1, "Barrio de la Cantina"]];
export const BARRIO = (x, z) => QUADS.find(([sx, sz]) => Math.sign(x) === sx && Math.sign(z) === sz)?.[2] || "the plaza";
for (const [sx, sz, name] of QUADS) {
  const mine = [];
  for (const [a, b] of LOTS) {
    const cx = sx * lotCenter(a), cz = sz * lotCenter(b);
    if (a === 1 && b === 1) continue; // landmark lot, built below
    const w = 7 + rnd() * 4, d = 7 + rnd() * 4, h = [3.2, 4.4, 5.6, 6.8, 8][(rnd() * 5) | 0];
    const door = Math.abs(cx) < Math.abs(cz) ? (sx > 0 ? "w" : "e") : (sz > 0 ? "n" : "s");
    const special = CASA_LOTS.find((c) => c.q === name && c.lot[0] === a && c.lot[1] === b);
    const hs = special ? casa(cx, cz, 9, 11, special.color, { door, name: special.name, furnish: special.furnish })
                       : house(cx + (rnd() - 0.5) * 2, cz + (rnd() - 0.5) * 2, w, d, h, WALLS[(rnd() * WALLS.length) | 0], { door });
    hs.barrio = name; mine.push(hs); houses.push(hs);
  }
  // every house gets a way up: outside stairs for some, crates + awnings for others
  mine.forEach((hs, i) => {
    // outside stairs only where they don't run into another staircase or another house; otherwise crates + awning
    let stair = null;
    if (i % 2 === 0) { const L = (hs.top - TOWN_H) * 1.6, sx2 = Math.sign(hs.x) || 1, sz2 = Math.sign(hs.z) || 1;
      if (hs.d >= hs.w) { const xx = hs.x - sx2 * (hs.w / 2 + 1.0), zTop = hs.z - sz2 * (hs.d / 2 - 1.0); stair = [xx, zTop + sz2 * L, xx, zTop, xx, zTop, hs.x - sx2 * (hs.w / 2 - 0.6), zTop]; }
      else { const zz = hs.z - sz2 * (hs.d / 2 + 1.0), xTop = hs.x - sx2 * (hs.w / 2 - 1.0); stair = [xTop + sx2 * L, zz, xTop, zz, xTop, zz, xTop, hs.z - sz2 * (hs.d / 2 - 0.6)]; }
      const pts = []; for (let k = 0; k <= 12; k++) pts.push([lerp(stair[0], stair[2], k / 12), lerp(stair[1], stair[3], k / 12)]);
      const nearStair = BRIDGES.some((q) => q.solid && pts.some(([x, z]) => { for (let k = 0; k <= 12; k++) if (Math.hypot(x - lerp(q.ax, q.bx, k / 12), z - lerp(q.az, q.bz, k / 12)) < 3.2) return true; return false; }));
      const inHouse = BOXES.some((q) => q.y1 > 2 && pts.some(([x, z]) => x > q.x0 - 1.1 && x < q.x1 + 1.1 && z > q.z0 - 1.1 && z < q.z1 + 1.1));
      if (nearStair || inHouse) stair = null;
    }
    if (stair) { steps(stair[0], stair[1], TOWN_H, stair[2], stair[3], hs.top, 1.7); plank(stair[4], stair[5], hs.top, stair[6], stair[7], hs.top, 1.7);
    } else { // crates under an awning: crate (1) → crate (1.9) → awning → roof, a little parkour
      const ax = hs.x - hs.w / 2 - 0.9, az = hs.z; const ct = crates(ax - 0.4, az + 1.6, TOWN_H, 2);
      const aw = Math.min(hs.top - 0.3, ct + 1.7); box(1.6, 0.12, 3.0, cloth(WALLS[i % WALLS.length]), ax + 0.1, aw, az - 0.6); solid(ax + 0.1, az - 0.6, 1.6, 3.0, aw - 0.06, aw + 0.06);
      if (hs.top - aw > 1.9) { const mid = aw + (hs.top - aw) / 2; box(1.2, 0.12, 1.6, M.wood, ax + 0.1, mid, az - 2.6); solid(ax + 0.1, az - 2.6, 1.2, 1.6, mid - 0.06, mid + 0.06); }
    }
  });
  // planks between neighbouring roofs: a rooftop route through every barrio
  for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
    const A = mine[i], B = mine[j], dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
    if (L > 19 || Math.abs(A.top - B.top) > 3.2) continue;
    const ux = dx / L, uz = dz / L, ea = Math.min(Math.abs(A.w / 2 / (ux || 1e-6)), Math.abs(A.d / 2 / (uz || 1e-6))) - 0.4, eb = Math.min(Math.abs(B.w / 2 / (ux || 1e-6)), Math.abs(B.d / 2 / (uz || 1e-6))) - 0.4;
    plank(A.x + ux * ea, A.z + uz * ea, A.top, B.x - ux * eb, B.z - uz * eb, B.top, 1.3);
  }
}
// secret rooftops: the three tallest houses hide a golden calavera each
houses.slice().sort((a, b) => b.top - a.top).slice(0, 4).forEach((hs, i) => SPOT.secrets.push(new V3(hs.x + (i % 2 ? 1 : -1) * (hs.w / 2 - 1), hs.top, hs.z + (hs.d / 2 - 1))));

// --- Barrio de la Capilla: a chapel with a climbable bell tower
{ const cx = -32, cz = -32, y = TOWN_H;
  const ch = house(cx, cz, 9, 13, 6, 0xf2e0c8, { door: "e", lamp: false }); houses.push({ ...ch, barrio: "Barrio de la Capilla" });
  const tx = cx - 2.5, tz = cz + 8.5, th = 13;
  box(3.4, th, 3.4, M.wall, tx, y + th / 2, tz); solid(tx, tz, 3.4, 3.4, y, y + th);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 1.0, 12, 1, true), M.gold); bell.position.set(tx, y + th + 1.0, tz); scene.add(bell);
  for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) cyl(0.15, 0.15, 2.4, M.wall, tx + px, y + th + 1.2, tz + pz, 6);
  const tr = new THREE.Mesh(new THREE.ConeGeometry(2.8, 2.2, 4), cloth(0x8a2c2c)); tr.position.set(tx, y + th + 3.4, tz); tr.rotation.y = Math.PI / 4; scene.add(tr);
  // stairs: street → chapel roof, then wrapping up the tower
  steps(cx + 5.6, cz + 6.5, y, cx + 5.6, cz - 3.5, ch.top, 1.7); plank(cx + 5.6, cz - 3.5, ch.top, cx + 4.0, cz - 3.5, ch.top, 1.7);
  steps(tx + 2.6, tz - 1.8 - 3.4, ch.top, tx + 2.6, tz + 1.9, ch.top + 3.4, 1.4);
  solid(tx + 2.6, tz + 2.8, 1.6, 1.8, ch.top + 3.2, ch.top + 3.4); box(1.6, 0.2, 1.8, M.stone, tx + 2.6, ch.top + 3.3, tz + 2.8);
  steps(tx + 1.9, tz + 2.6, ch.top + 3.4, tx - 1.9, tz + 2.6, ch.top + 5.4, 1.2);
  solid(tx - 2.6, tz + 2.6, 1.6, 1.6, ch.top + 5.2, ch.top + 5.4); box(1.6, 0.2, 1.6, M.stone, tx - 2.6, ch.top + 5.3, tz + 2.6);
  steps(tx - 2.6, tz + 1.9, ch.top + 5.4, tx - 2.6, tz - 0.4, y + th, 1.2); plank(tx - 2.6, tz - 0.4, y + th, tx - 0.6, tz - 0.4, y + th, 1.2);
  for (const dz of [-3.6, -1.2, 1.2, 3.6]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), M.window); w.position.set(cx - 4.51, y + 3, cz + dz); w.rotation.y = -Math.PI / 2; scene.add(w); }
  for (let i = 0; i < 5; i++) cypress(cx - 9, y, cz - 6 + i * 3.4, 3.5 + (i % 2));
  warm(cx + 6, y + 3, cz, 18, 20);
  SPOT.chapelRoof = new V3(cx + 1.5, ch.top, cz - 3); SPOT.tower = new V3(tx, y + th, tz);
  SPOT.homes.push(new V3(cx + 8, y, cz + 2), new V3(cx - 1, ch.top, cz - 4.5));
  SPOT.secrets.push(new V3(tx + 0.6, y + th, tz - 0.6), new V3(cx - 3.5, ch.top, cz - 5.5));
}
// --- Barrio Alto: terraces stepping up a hill to a high lookout, with a long plank out to La Campana
{ const cx = 32, cz = -32, y = TOWN_H;
  const T = [[14, 14, 2.2], [10.5, 10.5, 4.6], [7, 7, 7.2], [4, 4, 9.8]];
  T.forEach(([w, d, h], i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [M.rock, M.rock, M.top, M.rock, M.rock, M.rock]); m.position.set(cx, y + h / 2, cz); scene.add(m); solid(cx, cz, w, d, y, y + h);
    for (let k = 0; k < w * 2; k++) { const a = (k / (w * 2)) * Math.PI * 2; marigold(cx + Math.cos(a) * w * 0.45, y + h + 0.06, cz + Math.sin(a) * d * 0.45, 1); }
    candle(cx - w / 2 + 0.4, y + h, cz - d / 2 + 0.4); candle(cx + w / 2 - 0.4, y + h, cz + d / 2 - 0.4); });
  steps(cx - 9.2, cz + 5.5, y, cx - 9.2, cz + 1.5, y + 2.2, 1.8); plank(cx - 9.2, cz + 1.5, y + 2.2, cx - 6.6, cz + 1.5, y + 2.2, 1.8);
  steps(cx - 6.1, cz - 2.5, y + 2.2, cx - 6.1, cz - 6.5 + 0.0, y + 4.6, 1.4); plank(cx - 6.1, cz - 6.5, y + 4.6, cx - 4.8, cz - 4.6, y + 4.6, 1.4);
  steps(cx + 4.2, cz - 4.8, y + 4.6, cx + 4.2, cz - 0.5, y + 7.2, 1.2);
  steps(cx + 2.6, cz + 2.4, y + 7.2, cx - 0.6, cz + 2.4, y + 9.8, 1.1);
  for (let k = 0; k <= 30; k++) { const a = (k / 30) * Math.PI; for (let j = 0; j < 4; j++) marigold(cx + Math.cos(a) * 1.8, y + 9.8 + Math.sin(a) * 2.4, cz - 1.5, 1.2); }
  warm(cx, y + 12, cz, 18, 24);
  // La Campana: a floating rock reached by a long, high plank from the lookout
  const bx = 58, bz = -58, bh = y + 9.8;
  ISLANDS.push({ name: "La Campana", x: bx, z: bz, r: 5, h: bh, key: "campana" }); PADS.push(ISLANDS[ISLANDS.length - 1]);
  { const s = ISLANDS[ISLANDS.length - 1], g = new THREE.CylinderGeometry(s.r, 1.5, 6, 18); const m = new THREE.Mesh(g, [M.rock, M.top, M.rock]); m.position.set(bx, bh - 3, bz); scene.add(m);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 1.3, 14, 1, true), M.gold); bell.position.set(bx, bh + 3, bz); scene.add(bell);
    for (const s2 of [-1, 1]) cyl(0.12, 0.12, 4, M.wood, bx + s2 * 1.6, bh + 2, bz, 6); box(3.6, 0.2, 0.2, M.wood, bx, bh + 4, bz); candle(bx + 2, bh, bz + 2); candle(bx - 2, bh, bz - 2); }
  plank(cx + 1.4, cz - 1.4, bh, bx - 3.6, bz + 3.6, bh, 1.1);
  SPOT.hilltop = new V3(cx, y + 9.8, cz); SPOT.campana = new V3(bx, bh, bz);
  SPOT.homes.push(new V3(cx - 10, y, cz + 8), new V3(cx + 3, y + 4.6, cz + 3.5));
  SPOT.secrets.push(new V3(bx + 1, bh, bz - 1.5), new V3(cx + 6.5, y + 2.2, cz + 6.5));
}
// --- Barrio del Correo: the post office of Mictlán, with the mailbox to the other side
{ const cx = 32, cz = 32, y = TOWN_H;
  const po = house(cx, cz, 12, 9, 5.2, 0xd14b2b, { door: "n", lamp: false }); houses.push({ ...po, barrio: "Barrio del Correo" });
  const sign = document.createElement("canvas"); sign.width = 512; sign.height = 96; const g = sign.getContext("2d"); g.fillStyle = "#2a1630"; g.fillRect(0, 0, 512, 96);
  g.fillStyle = "#ffc93c"; g.font = "bold 54px Georgia"; g.textAlign = "center"; g.fillText("CORREO DE MICTLÁN", 256, 66);
  const st = new THREE.CanvasTexture(sign); st.colorSpace = THREE.SRGBColorSpace;
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), new THREE.MeshBasicMaterial({ map: st })); sm.position.set(cx, y + 4.3, cz - 4.52); sm.rotation.y = Math.PI; scene.add(sm);
  const mbx = cx + 3.4, mbz = cz - 6.2; box(0.8, 1.2, 0.6, cloth(0xd14b2b), mbx, y + 0.9, mbz); const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.6, 12, 1, false, 0, Math.PI), cloth(0xd14b2b)); top.rotation.set(0, 0, Math.PI / 2); top.position.set(mbx, y + 1.5, mbz); scene.add(top);
  cyl(0.06, 0.06, 0.9, M.dark, mbx, y + 0.3, mbz, 6); box(0.5, 0.06, 0.05, M.dark, mbx, y + 1.25, mbz - 0.31); solid(mbx, mbz, 0.8, 0.6, y, y + 1.8);
  steps(cx - 7.0, cz + 4.5, y, cx - 7.0, cz - 3.0, po.top, 1.6); plank(cx - 7.0, cz - 3.0, po.top, cx - 5.5, cz - 3.0, po.top, 1.6);
  for (let i = 0; i < 3; i++) { const lx = cx - 4 + i * 4; picadoLine(new V3(lx, y + 5.2, cz - 4.5), new V3(lx + 1.5, y + 3.5, cz - 10), 0.5); }
  warm(cx, y + 3, cz - 7, 20, 20);
  SPOT.mailbox = new V3(mbx, y, mbz - 0.9); SPOT.postRoof = new V3(cx + 3, po.top, cz + 2);
  SPOT.homes.push(new V3(cx - 2, y, cz - 8.5), new V3(cx, po.top, cz));
  SPOT.secrets.push(new V3(cx + 5.4, po.top, cz + 3.8));
}
// --- Barrio de la Cantina: an open courtyard of stalls under papel picado
{ const cx = -32, cz = 32, y = TOWN_H;
  const cols = [["#ff2e88", "#ffd23c"], ["#1fd1c1", "#ff8c1a"], ["#9d5cff", "#2fd67b"], ["#ff8c1a", "#ff2e88"], ["#ffd23c", "#9d5cff"]];
  cols.forEach((c, i) => { const a = i * 1.257 + 0.3; stall(cx + Math.cos(a) * 6.5, y, cz + Math.sin(a) * 6.5, -a - Math.PI / 2, c[0], c[1]); });
  for (let i = 0; i < 6; i++) { const a = i * 1.047; cyl(0.07, 0.09, 4.6, M.wood, cx + Math.cos(a) * 10, y + 2.3, cz + Math.sin(a) * 10, 6); picadoLine(new V3(cx + Math.cos(a) * 10, y + 4.5, cz + Math.sin(a) * 10), new V3(cx, y + 6.5, cz), 0.6); }
  cyl(0.12, 0.14, 6.6, M.wood, cx, y + 3.3, cz, 8);
  cyl(1.6, 1.8, 0.8, M.stone, cx, y + 0.4, cz, 12); solid(cx, cz, 3, 3, y, y + 0.8);
  warm(cx, y + 3.5, cz, 22, 22);
  SPOT.cantina = new V3(cx, y + 0.8, cz);
  SPOT.homes.push(new V3(cx + 3, y, cz - 3.5), new V3(cx - 4, y, cz + 4));
  SPOT.secrets.push(new V3(cx + Math.cos(0.3) * 6.5, y + 2.42, cz + Math.sin(0.3) * 6.5));
}

// ============================================================================ the outer islands
swingBridge(0, -63, TOWN_H, 0, -81, 2.5); swingBridge(0, 63, TOWN_H, 0, 84, 0.8); swingBridge(-63, 0, TOWN_H, -83, 0, 3.2); swingBridge(63, 0, TOWN_H, 85, 0, 1.6);
// El Panteón
{ const s = ISLANDS[1]; for (let i = 0; i < 26; i++) { const a = i * 2.4, d = 3 + (i % 5) * 3.0; grave(s.x + Math.cos(a) * d, s.h, s.z + Math.sin(a) * d, -a + Math.PI / 2); }
  for (let i = 0; i < 10; i++) { const a = i * 0.63 + 0.4; cypress(s.x + Math.cos(a) * 17, s.h, s.z + Math.sin(a) * 17, 3.5 + (i % 3)); }
  const cr = house(s.x - 9, s.z - 6, 5, 5, 3.4, 0x8b80a6, { y0: s.h, door: "e", lamp: false });
  warm(s.x, s.h + 3, s.z, 16, 26);
  SPOT.panteon = [new V3(s.x + 8, s.h, s.z - 5), new V3(s.x - 6, s.h, s.z + 8)]; SPOT.homes.push(new V3(s.x + 3, s.h, s.z + 10));
  SPOT.secrets.push(new V3(cr.x - 1.2, cr.top, cr.z - 1.2), new V3(s.x + 12, s.h, s.z - 12)); }
// El Muelle, a long dock, and the stones to La Isleta
{ const s = ISLANDS[2];
  plank(0, 110, s.h, 0, 126, 0.6, 2.6); for (const z of [114, 120, 126]) for (const xx of [-1.2, 1.2]) cyl(0.2, 0.2, 2.6, M.wood, xx, -0.7, z, 8);
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3.4, 12, 1, false, 0, Math.PI), cloth([0x1fa59a, 0xd14b2b, 0x6b2bd6][i])); b.rotation.set(Math.PI, 0, Math.PI / 2); b.position.set(-5 + i * 3.4 + (i === 1 ? 10 : 0), 0.1, 116 + i * 4); scene.add(b); }
  for (let i = 0; i < 6; i++) { const a = i * 1.05; const x = s.x + Math.cos(a) * 11, z = s.z + Math.sin(a) * 11; cyl(0.06, 0.08, 3, M.wood, x, s.h + 1.5, z, 6); const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), M.glow); l.position.set(x, s.h + 3.1, z); scene.add(l); }
  const shed = house(s.x + 7, s.z - 2, 4.5, 5, 3, 0x1fa59a, { y0: s.h, door: "w" });
  crates(shed.x - 3.2, shed.z + 3, s.h, 2);
  const is = ISLANDS[6]; tree(is.x, is.h, is.z); candle(is.x + 2, is.h, is.z); candle(is.x - 2, is.h, is.z + 1);
  warm(s.x, s.h + 3, s.z, 14, 22);
  SPOT.dock = new V3(0, 0.6, 124); SPOT.isleta = new V3(is.x + 1.5, is.h, is.z - 1.5); SPOT.homes.push(new V3(s.x - 6, s.h, s.z + 3), new V3(0, 0.62, 121));
  SPOT.secrets.push(new V3(is.x - 2, is.h, is.z - 2), new V3(shed.x + 1, shed.top, shed.z + 1)); }
// La Huerta: an orchard and a field of cempasúchil
{ const s = ISLANDS[3]; for (let i = 0; i < 10; i++) { const a = i * 0.63; tree(s.x + Math.cos(a) * 13, s.h, s.z + Math.sin(a) * 13); }
  for (let i = 0; i < 1400; i++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * 9; marigold(s.x + Math.cos(a) * d, s.h + 0.06 + rnd() * 0.15, s.z + Math.sin(a) * d, 1.1); }
  const barn = house(s.x - 11, s.z - 9, 6, 5, 4, 0xb3125a, { y0: s.h, door: "e" }); crates(barn.x + 4, barn.z + 3.5, s.h, 3);
  warm(s.x, s.h + 3, s.z, 16, 24);
  SPOT.huerta = new V3(s.x, s.h, s.z); SPOT.homes.push(new V3(s.x + 6, s.h, s.z + 10));
  SPOT.secrets.push(new V3(barn.x - 1.5, barn.top, barn.z + 1)); }
// El Mercado Flotante: stalls on the water
{ const s = ISLANDS[4]; const cols = [["#ff2e88", "#ffd23c"], ["#1fd1c1", "#ff8c1a"], ["#9d5cff", "#2fd67b"], ["#ff8c1a", "#ff2e88"], ["#2fd67b", "#ff2e88"], ["#ffd23c", "#1fd1c1"]];
  cols.forEach((c, i) => { const a = i * 1.047 + 0.5; stall(s.x + Math.cos(a) * 8, s.h, s.z + Math.sin(a) * 8, -a - Math.PI / 2, c[0], c[1]); });
  for (let i = 0; i < 6; i++) { const a1 = i * 1.047 + 1.0, a2 = a1 + 1.047; picadoLine(new V3(s.x + Math.cos(a1) * 13, s.h + 4.1, s.z + Math.sin(a1) * 13), new V3(s.x + Math.cos(a2) * 13, s.h + 4.1, s.z + Math.sin(a2) * 13)); cyl(0.06, 0.08, 4.2, M.wood, s.x + Math.cos(a1) * 13, s.h + 2.1, s.z + Math.sin(a1) * 13, 6); }
  warm(s.x, s.h + 3, s.z, 18, 24);
  SPOT.mercado = [new V3(s.x + 2.5, s.h, s.z + 1.5), new V3(s.x - 2, s.h, s.z - 3)]; SPOT.homes.push(new V3(s.x - 4, s.h, s.z + 5));
  SPOT.secrets.push(new V3(s.x + Math.cos(0.5) * 8, s.h + 2.42, s.z + Math.sin(0.5) * 8)); }
// El Mirador: the top of the world
{ const s = ISLANDS[5]; for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI; for (let j = 0; j < 5; j++) marigold(s.x + Math.cos(a) * 3.6 + (rnd() - .5) * .5, s.h + Math.sin(a) * 4.5, s.z - 3 + (rnd() - .5) * .5, 1.4); }
  { const n = ISLANDS.find((i) => i.key === "nube"), cm = new THREE.MeshLambertMaterial({ color: 0xffe6f0, emissive: 0x5a3050, transparent: true, opacity: 0.85 });
    for (let k = 0; k < 14; k++) { const a = rnd() * 6.283, d = 3 + rnd() * 6; const c = new THREE.Mesh(new THREE.SphereGeometry(1.6 + rnd() * 2, 10, 8), cm); c.position.set(n.x + Math.cos(a) * d, n.h - 2.5 + rnd() * 1.5, n.z + Math.sin(a) * d); c.scale.y = 0.55; scene.add(c); }
    tree(n.x, n.h, n.z); candle(n.x + 2, n.h, n.z + 1, 1.3); candle(n.x - 2, n.h, n.z - 1, 1.3); warm(n.x, n.h + 3, n.z, 14, 18);
    SPOT.secrets.push(new V3(n.x + 2.5, n.h, n.z - 2.5), new V3(SPOT.tower.x, SPOT.tower.y + 5.2, SPOT.tower.z), new V3(SPOT.campana.x, SPOT.campana.y + 8, SPOT.campana.z)); SPOT.nube = new V3(n.x, n.h, n.z); }
  warm(s.x, s.h + 3, s.z, 16, 20); SPOT.mirador = new V3(s.x, s.h, s.z + 1); SPOT.secrets.push(new V3(s.x + 3, s.h, s.z + 4), new V3(STONES[5].x, STONES[5].h, STONES[5].z)); }

// --- build the instanced marigolds + candles
{
  const geo = new THREE.IcosahedronGeometry(0.16, 0);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ fog: true }), flowerSpots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), e = new THREE.Euler(), c = new THREE.Color();
  const golds = [[1.0, 0.36, 0.02], [1.0, 0.5, 0.03], [0.95, 0.22, 0.02], [1.0, 0.62, 0.08]];
  flowerSpots.forEach(([x, y, z, s], i) => { e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e); sc.set(s, s * 0.65, s); m.compose(new V3(x, y, z), q, sc); im.setMatrixAt(i, m);
    const g = golds[(rnd() * 4) | 0], k = 0.55 + rnd() * 0.35; im.setColorAt(i, c.setRGB(g[0] * k, g[1] * k, g[2] * k)); });
  scene.add(im);
  const pos = [], sd = [], sz = [];
  flameSpots.forEach(([x, y, z, b]) => { pos.push(x, y, z); sd.push(rnd()); sz.push((0.9 + rnd() * 0.4) * b); });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("aSeed", new THREE.Float32BufferAttribute(sd, 1)); g.setAttribute("aSize", new THREE.Float32BufferAttribute(sz, 1));
  const pts = new THREE.Points(g, flameMat); pts.frustumCulled = false; scene.add(pts);
  const st = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 1, 6), new THREE.MeshLambertMaterial({ color: 0xf1e6cf }), stickSpots.length);
  stickSpots.forEach(([x, y, z, h, b], i) => { m.makeScale(b, h * b, b); m.setPosition(x, y + (h * b) / 2, z); st.setMatrixAt(i, m); });
  scene.add(st);
}
// where am I? (for dialogue, quest HUD and the map)
export function placeName(x, z, y = 0) {
  const cs = CASAS.find((c) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1 && y < c.y1 - 0.2); if (cs) return cs.name;
  const isl = ISLANDS.slice(1).find((s) => (x - s.x) ** 2 + (z - s.z) ** 2 < (s.r + 3) ** 2);
  if (isl) return isl.name;
  if (Math.hypot(x, z) < 20) return "the plaza";
  const b = BARRIO(x, z); return y > TOWN_H + 2.5 ? `the rooftops of ${b}` : b;
}

// ============================================================================ every prop is solid
// anything built so far (crates, lamps, tombstones, furniture, trees, fences...) that has no collider gets a box: nothing small is walk-through
const AUTO = [];
{ const bb = new THREE.Box3(), skipMat = new Set([M.door, M.window]), sz = new V3();
  const covered = (b) => { let hit = 0, n = 0; // already represented by a wall, floor, stair or island?
    for (let i = 0.2; i < 1; i += 0.3) for (let j = 0.2; j < 1; j += 0.3) for (let k = 0.2; k < 1; k += 0.3) { n++;
      const x = lerp(b.min.x, b.max.x, i), y = lerp(b.min.y, b.max.y, j), z = lerp(b.min.z, b.max.z, k);
      if (insideSolid(x, y, z) || groundAt(x, z, y) > y - 0.15) hit++; }
    return hit / n; };
  scene.updateMatrixWorld(true);
  const list = []; scene.traverse((o) => { if (!o.isMesh || o.isInstancedMesh || o.userData.ghost || !o.visible) return;
    const m = o.material; if (Array.isArray(m) || m.isShaderMaterial || m.transparent || skipMat.has(m) || m === M.glow) return; list.push(o); });
  for (const o of list) {
    bb.setFromObject(o); bb.getSize(sz);
    if (sz.x > 7 || sz.z > 7 || sz.y > 14 || Math.max(sz.x, sz.y, sz.z) < 0.08 || bb.max.y < 0.05) continue; // terrain, roofs, slabs, specks
    if (covered(bb) > 0.5) continue;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    if (BRIDGES.some((b) => { const dx = b.bx - b.ax, dz = b.bz - b.az, L2 = dx * dx + dz * dz, t = ((cx - b.ax) * dx + (cz - b.az) * dz) / L2; if (t < -0.05 || t > 1.05) return false;
      return Math.hypot(cx - b.ax - dx * t, cz - b.az - dz * t) < b.w / 2 + 0.1 && bb.max.y <= bridgeH(b, clamp(t, 0, 1)) + 0.4; })) continue; // a stair step: the ramp already is the step
    const pad = 0.04; AUTO.push(solid((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2, Math.max(sz.x, 0.12) + pad, Math.max(sz.z, 0.12) + pad, bb.min.y, bb.max.y));
  } }

// ============================================================================ items the ghosts miss
export const ITEMS = ["guitar", "photograph", "letter", "pan_dulce", "sugar_skull", "hot_chocolate", "candle", "marigold_crown", "ball", "book", "pocket_watch", "wooden_toy"];
const ITEM_NAME = { guitar: "guitar", photograph: "photograph", letter: "letter", pan_dulce: "pan dulce", sugar_skull: "sugar skull", hot_chocolate: "cup of chocolate",
  candle: "candle", marigold_crown: "marigold crown", ball: "ball", book: "book", pocket_watch: "pocket watch", wooden_toy: "wooden toy" };
const ITEM_MOTIF = { guitar: "music", photograph: "heart", letter: "book", pan_dulce: "sun", sugar_skull: "flower", hot_chocolate: "cup", candle: "star", marigold_crown: "flower", ball: "moon", book: "book", pocket_watch: "star", wooden_toy: "bird" };
const ITEM_SPOT = { guitar: SPOT.mirador, photograph: SPOT.panteon[0], sugar_skull: SPOT.panteon[1], pan_dulce: SPOT.mercado[0], hot_chocolate: SPOT.mercado[1], book: SPOT.casaAbuela,
  candle: SPOT.tower, wooden_toy: SPOT.casaAzul, letter: SPOT.dock, marigold_crown: SPOT.huerta, pocket_watch: SPOT.taller, ball: SPOT.hilltop };
SPOT.secrets.push(SPOT.isleta.clone(), SPOT.campana.clone()); // the old item spots become calavera spots
function makeItem(name) {
  const g = new THREE.Group(), L = (c, e = 0.25) => new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(e) });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  switch (name) {
    case "guitar": add(new THREE.SphereGeometry(0.22, 14, 10), L(0xc9782e), 0, -0.12, 0).scale.z = 0.35; add(new THREE.SphereGeometry(0.17, 14, 10), L(0xc9782e), 0, 0.14, 0).scale.z = 0.35; add(new THREE.BoxGeometry(0.06, 0.5, 0.05), L(0x3a2014), 0, 0.5, 0); add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), L(0x111111), 0, 0, 0.08, Math.PI / 2); break;
    case "photograph": add(new THREE.BoxGeometry(0.45, 0.55, 0.05), M.gold); add(new THREE.PlaneGeometry(0.34, 0.44), new THREE.MeshBasicMaterial({ color: 0xe8c9a0 }), 0, 0, 0.03); break;
    case "letter": add(new THREE.BoxGeometry(0.5, 0.32, 0.02), L(0xf2e6cc, 0.4)); add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), L(0xc0182f, 0.5), 0, 0, 0.02, Math.PI / 2); break;
    case "pan_dulce": add(new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), L(0xe4a95a)); add(new THREE.TorusGeometry(0.12, 0.025, 6, 12), L(0xffe9c4, 0.4), 0, 0.2, 0, Math.PI / 2); break;
    case "sugar_skull": add(new THREE.SphereGeometry(0.22, 14, 10), L(0xffffff, 0.35)); add(new THREE.SphereGeometry(0.06, 8, 6), L(0xff2e88, 0.6), -0.08, 0.03, 0.17); add(new THREE.SphereGeometry(0.06, 8, 6), L(0x1fd1c1, 0.6), 0.08, 0.03, 0.17); break;
    case "hot_chocolate": add(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 14), L(0x2d6fb0)); add(new THREE.CircleGeometry(0.15, 14), L(0x5a2c14), 0, 0.151, 0, -Math.PI / 2); add(new THREE.TorusGeometry(0.08, 0.02, 6, 10, Math.PI), L(0x2d6fb0), 0.18, 0, 0, 0, 0, -Math.PI / 2); break;
    case "candle": add(new THREE.CylinderGeometry(0.09, 0.09, 0.45, 12), L(0xfff3dc, 0.4)); add(new THREE.SphereGeometry(0.06, 8, 6), M.glow, 0, 0.3, 0).scale.y = 1.6; break;
    case "marigold_crown": { add(new THREE.TorusGeometry(0.22, 0.03, 6, 20), L(0x2f7a3a), 0, 0, 0, Math.PI / 2); for (let k = 0; k < 8; k++) add(new THREE.IcosahedronGeometry(0.07, 0), L(0xff8c1a, 0.6), Math.cos(k * 0.785) * 0.22, 0.02, Math.sin(k * 0.785) * 0.22); break; }
    case "ball": { const c = document.createElement("canvas"); c.width = 64; c.height = 32; const x = c.getContext("2d"); ["#ff2e88", "#ffd23c", "#1fd1c1", "#ff8c1a"].forEach((col, k) => { x.fillStyle = col; x.fillRect(k * 16, 0, 16, 32); }); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; add(new THREE.SphereGeometry(0.24, 16, 12), new THREE.MeshLambertMaterial({ map: t, emissive: 0x221111 })); break; }
    case "book": add(new THREE.BoxGeometry(0.4, 0.1, 0.52), L(0x6b2bd6)); add(new THREE.BoxGeometry(0.37, 0.08, 0.5), L(0xf2e6cc, 0.3), 0.02, 0, 0); break;
    case "pocket_watch": add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 20), M.gold, 0, 0, 0, Math.PI / 2); add(new THREE.CircleGeometry(0.16, 20), L(0xfff6e0, 0.5), 0, 0, 0.032); add(new THREE.TorusGeometry(0.05, 0.015, 6, 10), M.gold, 0, 0.24, 0); break;
    case "wooden_toy": add(new THREE.BoxGeometry(0.36, 0.2, 0.14), L(0xd14b2b)); add(new THREE.BoxGeometry(0.14, 0.22, 0.12), L(0xd14b2b), 0.2, 0.15, 0); for (const [x, z] of [[-0.12, 0.08], [0.12, 0.08], [-0.12, -0.08], [0.12, -0.08]]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), L(0x222222), x, -0.12, z, Math.PI / 2); break;
  }
  return g;
}
const beamMat = () => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { ...U, uOn: { value: 0.15 } },
  vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying float vY; uniform float uOn; uniform float uTime; void main(){ float a = (1.0 - smoothstep(0.0, 40.0, vY)) * (0.7 + 0.3*sin(uTime*3.0 - vY*0.6)); gl_FragColor = vec4(vec3(1.0,0.72,0.25)*a*uOn, 1.0); }` });
const items = ITEMS.map((name) => {
  const at = ITEM_SPOT[name].clone();
  cyl(0.45, 0.55, 0.6, M.stone, at.x, at.y + 0.3, at.z, 10); solid(at.x, at.z, 0.9, 0.9, at.y, at.y + 0.6);
  const mesh = makeItem(name); mesh.position.set(at.x, at.y + 1.2, at.z); scene.add(mesh);
  const bg = new THREE.CylinderGeometry(0.4, 0.4, 40, 16, 1, true); bg.translate(0, 20, 0);
  const beam = new THREE.Mesh(bg, beamMat()); beam.position.set(at.x, at.y + 0.6, at.z); scene.add(beam);
  return { name, at, mesh, beam, home: true, island: placeName(at.x, at.z, at.y) };
});
const itemByName = Object.fromEntries(items.map((i) => [i.name, i]));
// ghost homes need elbow room: they drift ~1.4 m around home, so keep 2.3 m clear of every wall, prop and pedestal, on solid ground, apart from each other
{ const R = 2.3, placed = [];
  const clear = (x, z, y) => {
    for (const b of BOXES) { if (b.y1 <= y + 0.1 || b.y0 >= y + 2.7) continue; const qx = clamp(x, b.x0, b.x1), qz = clamp(z, b.z0, b.z1); if ((x - qx) ** 2 + (z - qz) ** 2 < R * R) return false; }
    for (let k = 0; k < 13; k++) { const r = k ? (k < 7 ? 1.1 : 2) : 0, a = k * 1.05, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (Math.abs(groundAt(px, pz, y + 0.5) - y) > 0.3) return false; }
    if (items.some((i) => Math.hypot(i.at.x - x, i.at.z - z) < 3)) return false;
    return !placed.some((p) => Math.abs(p.y - y) < 3 && Math.hypot(p.x - x, p.z - z) < 4); };
  for (const h of SPOT.homes) {
    let done = clear(h.x, h.z, h.y);
    for (let r = 0.5; r <= 14 && !done; r += 0.5) for (let a = 0; a < 6.283 && !done; a += 0.5 / r) { const x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r, y = groundAt(x, z, h.y + 0.5);
      if (Math.abs(y - h.y) < 0.6 && clear(x, z, y)) { h.set(x, y, z); done = true; } }
    if (!done) console.warn("no roomy spot near ghost home", h);
    placed.push(h.clone()); } }

// ============================================================================ the calaca (player character, procedurally built and animated)
const BONE = new THREE.MeshLambertMaterial({ color: 0xf3ead8, emissive: 0x5e5446 });
const SOCKET = new THREE.MeshBasicMaterial({ color: 0x14081c });
function skullTexture(hue) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256; const g = c.getContext("2d");
  g.fillStyle = "#f4ecdc"; g.fillRect(0, 0, 512, 256);
  const cx = 128, col = (h, l = 60) => `hsl(${((h % 1) + 1) % 1 * 360},85%,${l}%)`;
  const petal = (x, y, r, n, color) => { g.fillStyle = color; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; g.beginPath(); g.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.55, r * 0.28, a, 0, 7); g.fill(); } };
  for (const dx of [-26, 26]) petal(cx + dx, 118, 17, 10, col(hue + 0.5, 62));
  petal(cx, 58, 13, 8, col(hue, 58)); g.fillStyle = col(hue + 0.15, 55); g.beginPath(); g.arc(cx, 58, 6, 0, 7); g.fill();
  g.fillStyle = col(hue + 0.3, 60); for (const dx of [-46, 46]) for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(cx + dx + (i - 1) * 7, 150, 3.5, 0, 7); g.fill(); }
  g.strokeStyle = "#2a1630"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx - 26, 176); g.quadraticCurveTo(cx, 186, cx + 26, 176); g.stroke();
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(cx + i * 7, 172 + Math.abs(i)); g.lineTo(cx + i * 7, 188 - Math.abs(i)); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function serapeTexture(hue) {
  const c = document.createElement("canvas"); c.width = 16; c.height = 128; const g = c.getContext("2d");
  const stripes = [0, 0.08, 0.5, 0.12, 0.9, 0.55, 0.02, 0.33];
  for (let i = 0; i < 16; i++) { g.fillStyle = `hsl(${((hue + stripes[i % 8]) % 1) * 360},${i % 3 ? 80 : 30}%,${i % 4 === 3 ? 18 : 52}%)`; g.fillRect(0, i * 8, 16, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
const limbGeo = (r, len) => { const g = new THREE.CylinderGeometry(r, r * 0.85, len, 8); g.translate(0, -len / 2, 0); return g; };
const blobGeo = new THREE.CircleGeometry(0.55, 20), blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false });
function makeCalaca(hue = 0.08) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const pivot = (x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); body.add(p); return p; };
  const legL = pivot(-0.14, 0.74, 0), legR = pivot(0.14, 0.74, 0);
  for (const leg of [legL, legR]) {
    leg.add(new THREE.Mesh(limbGeo(0.065, 0.62), BONE));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.13, 0.28), M.dark); boot.position.set(0, -0.66, 0.05); leg.add(boot);
  }
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), BONE); pelvis.scale.set(1.3, 0.7, 1); pelvis.position.y = 0.78; body.add(pelvis);
  const serape = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.43, 0.66, 14), new THREE.MeshLambertMaterial({ map: serapeTexture(hue) })); serape.position.y = 1.08; body.add(serape);
  const fringe = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.47, 0.06, 14), new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(hue, 0.8, 0.55) })); fringe.position.y = 0.74; body.add(fringe);
  const armL = pivot(-0.27, 1.32, 0), armR = pivot(0.27, 1.32, 0);
  for (const arm of [armL, armR]) { arm.add(new THREE.Mesh(limbGeo(0.05, 0.5), BONE)); const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), BONE); hand.position.y = -0.53; arm.add(hand); }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 6), BONE); neck.position.y = 1.44; body.add(neck);
  const head = pivot(0, 1.48, 0);
  const skullMat = new THREE.MeshLambertMaterial({ map: skullTexture(hue), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 });
  skullMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb * 0.92, 0.55);\n#include <dithering_fragment>'); };
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.38, 28, 18), skullMat); skull.position.y = 0.33; skull.scale.set(1, 1.02, 0.95); head.add(skull);
  const pupils = [];
  for (const sx of [-1, 1]) {
    const so = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), SOCKET); so.scale.set(1, 1.15, 0.55); so.position.set(sx * 0.135, 0.36, 0.31); head.add(so);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL((hue + 0.5) % 1, 1, 0.6).multiplyScalar(2.2) })); pu.position.set(sx * 0.135, 0.36, 0.356); head.add(pu); pupils.push(pu);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.08, 3), SOCKET); nose.rotation.x = Math.PI; nose.position.set(0, 0.25, 0.36); nose.scale.z = 0.5; head.add(nose);
  const crown = new THREE.Group(); crown.position.y = 0.6; crown.rotation.x = -0.15; head.add(crown);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.03, 6, 22), new THREE.MeshLambertMaterial({ color: 0x2f7a3a })); ring.rotation.x = Math.PI / 2; crown.add(ring);
  for (let k = 0; k < 7; k++) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(k % 2 ? 0.07 : 0.09, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(k % 3 === 0 ? 0.94 : 0.07, 1, 0.55).multiplyScalar(1.3) })); f.position.set(Math.cos(k * 0.9) * 0.31, 0.03, Math.sin(k * 0.9) * 0.31); crown.add(f); }
  const socket = new THREE.Group(); socket.position.y = 2.45; body.add(socket);
  // wings: hidden until the souls give them to you
  const wings = new THREE.Group(); wings.position.set(0, 1.22, -0.2); wings.visible = false; body.add(wings);
  const wingL = new THREE.Group(), wingR = new THREE.Group(); wings.add(wingL, wingR);
  for (const [w, side] of [[wingL, -1], [wingR, 1]]) for (let k = 0; k < 6; k++) {
    const f = new THREE.Mesh(featherGeo, featherMat); f.renderOrder = 3; const a = 0.2 + k * 0.26, len = 1.25 - k * 0.11;
    f.scale.set(len, 1, 1); f.position.set(side * Math.cos(a) * 0.12, Math.sin(a) * 0.12, -k * 0.012); f.rotation.set(0, 0, side > 0 ? a : Math.PI - a);
    w.add(f);
  }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.6) })); halo.rotation.x = Math.PI / 2; halo.position.y = 0.95; halo.visible = false; head.add(halo);
  const shadow = new THREE.Mesh(blobGeo, blobMat); shadow.rotation.x = -Math.PI / 2; scene.add(shadow); scene.add(root);
  return { root, body, head, legL, legR, armL, armR, pupils, shadow, socket, wings, wingL, wingR, halo, phase: 0, squash: 1, blink: 0, flip: 0, held: null, heldName: null };
}
// a feather: a long soft leaf, glowing marigold at the tip
const featherGeo = (() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(0.3, 0.13, 0.8, 0.1, 1, 0); s.bezierCurveTo(0.8, -0.07, 0.3, -0.09, 0, 0); return new THREE.ShapeGeometry(s, 10); })();
const featherMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { ...U, uTier: { value: 1 } },
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying vec2 vP; uniform float uTime; uniform float uTier;
    void main(){ float x = clamp(vP.x, 0.0, 1.0), w = abs(vP.y) / max(0.001, 0.12*sin(3.14159*min(x*1.15,1.0)) + 0.01);
      float edge = smoothstep(0.75, 1.0, w), vein = smoothstep(0.08, 0.0, w);
      vec3 root = uTier > 2.5 ? vec3(1.0,0.97,0.9) : vec3(1.0,0.9,0.75), tip = uTier > 1.5 ? vec3(1.0,0.48,0.05) : vec3(1.0,0.62,0.35);
      vec3 col = mix(root, tip, smoothstep(0.25, 1.0, x));
      col = mix(col, col*0.55, edge) + vein*0.25;
      col *= 0.72 + 0.14*sin(uTime*2.5 - x*5.0) + (uTier > 2.5 ? 0.08 : 0.0);
      gl_FragColor = vec4(col, 0.94 - edge*0.25); }` });
function animateCalaca(c, dt, t, speed, air, dancing, carrying, talking) {
  const k = Math.min(speed / 6.5, 1.5);
  if (speed > 0.3 && !air) { const before = Math.sin(c.phase); c.phase += dt * (5 + speed * 1.15); if (Math.sign(Math.sin(c.phase)) !== Math.sign(before) && c.onStep) c.onStep(); }
  const L = (o, x, z = 0, r = 12) => { o.rotation.x = lerp(o.rotation.x, x, 1 - Math.exp(-dt * r)); o.rotation.z = lerp(o.rotation.z, z, 1 - Math.exp(-dt * r)); };
  let bob = 0, lean = 0, twist = 0, headTilt = Math.sin(t * 1.4) * 0.05;
  if (dancing) {
    const p = t * 7.5; bob = Math.abs(Math.sin(p)) * 0.12; twist = Math.sin(p * 0.5) * 0.5; headTilt = Math.sin(p) * 0.25;
    L(c.legL, Math.max(0, Math.sin(p)) * -0.9, 0.1); L(c.legR, Math.max(0, -Math.sin(p)) * -0.9, -0.1);
    L(c.armL, -2.6 + Math.sin(p) * 0.4, -0.5 + Math.cos(p) * 0.3); L(c.armR, -2.6 - Math.sin(p) * 0.4, 0.5 - Math.cos(p) * 0.3);
  } else if (air) {
    L(c.legL, -1.0, 0.1, 10); L(c.legR, -0.35, -0.1, 10);
    if (carrying) { L(c.armL, -2.9, -0.2); L(c.armR, -2.9, 0.2); } else { L(c.armL, -0.4, -1.9, 10); L(c.armR, -0.4, 1.9, 10); }
  } else {
    const s = Math.sin(c.phase) * 0.8 * k; bob = Math.abs(Math.sin(c.phase)) * 0.08 * k; lean = 0.13 * k;
    L(c.legL, s, 0.04); L(c.legR, -s, -0.04);
    if (carrying) { L(c.armL, -2.9 + s * 0.05, -0.22); L(c.armR, -2.9 - s * 0.05, 0.22); }
    else if (talking) { L(c.armL, -0.25, -0.25); L(c.armR, -0.9 + Math.sin(t * 6) * 0.25, 0.4); }
    else { L(c.armL, -s * 0.9, -0.18 - (1 - k) * 0.05 + Math.sin(t * 1.4) * 0.03); L(c.armR, s * 0.9, 0.18 + (1 - k) * 0.05 - Math.sin(t * 1.4) * 0.03); }
  }
  c.flip = Math.max(0, c.flip - dt * 2.6);
  c.body.position.y = bob; c.body.rotation.x = lean + Math.sin(c.flip * Math.PI) * 0 ; c.body.rotation.y = twist;
  c.body.rotation.x += c.flip > 0 ? (1 - c.flip) * Math.PI * 2 : 0;
  c.head.rotation.z = headTilt;
  c.squash = lerp(c.squash, 1, 1 - Math.exp(-dt * 10)); const sq = c.squash; c.root.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  c.blink -= dt; if (c.blink < -0.12) c.blink = 2 + Math.random() * 3; const open = c.blink < 0 ? 0.1 : 1; c.pupils.forEach((p) => (p.scale.y = open));
}
function holdItem(c, name) {
  if (c.heldName === name) return;
  if (c.held) { c.socket.remove(c.held); c.held = null; }
  c.heldName = name; if (name) { c.held = makeItem(name); c.held.scale.setScalar(1.25); c.socket.add(c.held); }
}

// ============================================================================ ghosts (ánimas): Gemma writes them, a shader makes them
const anchorOf = (slot) => SPOT.homes[slot % SPOT.homes.length].clone();
const ghostGeo = (() => {
  const pts = [[0, 2.25], [0.2, 2.21], [0.36, 2.1], [0.47, 1.92], [0.52, 1.7], [0.52, 1.4], [0.55, 1.1], [0.6, 0.8], [0.68, 0.5], [0.76, 0.22], [0.8, 0.12]].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 36);
})();
const ghostMat = (color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { ...U, uColor: { value: color }, uFade: { value: 0 }, uTalk: { value: 0 } },
  vertexShader: /* glsl */ `
    uniform float uTime; varying vec3 vP; varying vec3 vN; varying vec3 vW;
    void main(){ vec3 p = position; float hem = 1.0 - smoothstep(0.1, 0.9, p.y); float a = atan(p.z, p.x);
      p.y += sin(a*7.0 + uTime*3.2) * 0.12 * hem; p.xz *= 1.0 + sin(a*5.0 - uTime*2.0)*0.06*hem;
      vP = position; vN = normalize(normalMatrix*normal); vec4 w = modelMatrix*vec4(p,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uFade; uniform float uTime; uniform float uTalk; varying vec3 vP; varying vec3 vN; varying vec3 vW;
    ${FOG_GLSL}
    void main(){
      vec3 V = normalize(cameraPosition - vW); float rim = pow(1.0 - abs(dot(normalize(vN), V)), 2.2);
      float body = 0.16 + 0.1*sin(vP.y*8.0 - uTime*2.0);
      float flick = 0.9 + 0.1*sin(uTime*13.0 + vP.y*3.0) * sin(uTime*7.3);
      vec3 col = (uColor * (rim*1.7 + body) + vec3(1.0)*rim*0.25) * flick;
      // face on the front (+z): eyes and a little mouth
      vec2 f = vec2(vP.x, vP.y - 1.78);
      float front = smoothstep(0.1, 0.35, vP.z);
      float eyes = smoothstep(0.075, 0.055, length((vec2(abs(f.x), f.y) - vec2(0.17, 0.0)) * vec2(1.0, 0.75)));
      float mouth = smoothstep(0.06, 0.045, length((f - vec2(0.0, -0.24 - 0.02*uTalk)) * vec2(1.0, 1.4 - uTalk*0.9)));
      col *= 1.0 - max(eyes, mouth) * front * 0.92;
      float fade = uFade * smoothstep(0.0, 0.25, vP.y);
      gl_FragColor = vec4(applyFog(col, length(cameraPosition - vW)) * fade, 1.0);
    }`,
});
const ghosts = new Map(); // id -> ghost
const labelsEl = $("#labels");
function spawnGhost(data, appear = true) {
  if (ghosts.has(data.id)) return ghosts.get(data.id);
  for (const g of ghosts.values()) if (g.data.slot === data.slot && g.state !== "rising") removeGhost(g);
  const color = new THREE.Color(PALETTE[data.color] || PALETTE.marigold).multiplyScalar(1.1);
  const mesh = new THREE.Mesh(ghostGeo, ghostMat(color)); scene.add(mesh);
  const light = null;
  const label = tagSprite(); drawTag(label, "!", data.name, data.from || "", "");
  const g = { data, mesh, light, label, home: anchorOf(data.slot), pos: anchorOf(data.slot).clone(), ph: Math.random() * 6, fade: appear ? 0 : 1, state: "wander", t: 0, face: 0, voice: 160 + (hashStr(data.name) % 160) };
  g.pos.y += 0.3; ghosts.set(data.id, g); return g;
}

// name tags are drawn INSIDE the 3D scene (sprites), so they move in the same frame as the ghost they belong to
const tagScene = new THREE.Scene(); // name tags live here, drawn on top AFTER bloom/grain, so ghost glow never touches them
function tagSprite() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 176;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sp.center.set(0.5, 0); sp.renderOrder = 20; tagScene.add(sp);
  sp.userData = { c, tex, key: "" };
  return sp;
}
function drawTag(sp, icon, name, sub, style) {
  const key = icon + "|" + name + "|" + sub + "|" + style; if (sp.userData.key === key) return; sp.userData.key = key;
  const { c, tex } = sp.userData, g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height); g.textAlign = "center";
  g.shadowColor = "rgba(0,0,0,.85)"; g.shadowBlur = 10;
  if (style === "player" || style === "me") {
    g.font = "600 40px 'Bricolage Grotesque', system-ui"; const w = g.measureText(name).width; g.font = "500 26px 'Geist Mono', monospace"; const w2 = g.measureText(sub).width;
    const W = w + w2 + 54, x0 = 256 - W / 2; g.shadowBlur = 0; g.fillStyle = style === "me" ? "rgba(60,30,0,.62)" : "rgba(10,30,40,.62)"; g.strokeStyle = style === "me" ? "rgba(255,201,60,.7)" : "rgba(160,240,255,.5)"; g.lineWidth = 2;
    g.beginPath(); g.roundRect(x0, 108, W, 56, 28); g.fill(); g.stroke();
    g.textAlign = "left"; g.font = "600 40px 'Bricolage Grotesque', system-ui"; g.fillStyle = style === "me" ? "#ffe3a0" : "#c8f6ff"; g.fillText(name, x0 + 22, 150);
    g.font = "500 26px 'Geist Mono', monospace"; g.fillStyle = style === "me" ? "#ffb84d" : "#7fd8e8"; g.fillText(sub, x0 + 32 + w, 148);
  } else {
    g.font = "800 58px 'Bricolage Grotesque', system-ui"; g.fillStyle = style === "quest" ? "#cfe8ff" : "#ffc93c"; g.fillText(icon, 256, 58);
    g.font = "600 44px 'Bricolage Grotesque', system-ui"; g.fillStyle = "#fbf3e6"; g.fillText(name, 256, 118);
    g.font = "500 24px 'Geist Mono', monospace"; g.fillStyle = "#c9bcdc"; g.fillText(sub.toUpperCase(), 256, 160);
  }
  tex.needsUpdate = true;
}
// can the camera actually see this point? (walls, roofs, props and hills hide names)
function blocked(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz), tEnd = Math.max(0, 1 - 0.45 / L);
  for (const b of BOXES) {
    let t0 = 0, t1 = tEnd;
    for (const [o, d, lo, hi] of [[ax, dx, b.x0, b.x1], [ay, dy, b.y0, b.y1], [az, dz, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) { t1 = -1; break; } continue; }
      let u = (lo - o) / d, v = (hi - o) / d; if (u > v) [u, v] = [v, u];
      if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) break;
    }
    if (t0 < t1 && t1 > 0) return true;
  }
  const n = Math.ceil(L / 1.5); // the hills of the islands
  for (let i = 1; i < n; i++) { const k = (i / n) * tEnd, x = ax + dx * k, y = ay + dy * k, z = az + dz * k; if (PADS.some((p) => p.h > y && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r)) return true; }
  return false;
}
const inSight = (sp, pos, lift) => { const c = camera.position;
  if (((sp.userData.lt = (sp.userData.lt || 0) + 1) % 3) && sp.userData.seen !== undefined) return sp.userData.seen; // re-check every 3rd frame
  return (sp.userData.seen = !blocked(c.x, c.y, c.z, pos.x, pos.y + lift, pos.z) || !blocked(c.x, c.y, c.z, pos.x, pos.y + 1.1, pos.z)); };
function placeTag(sp, pos, lift, dist, max, show) {
  if (show && dist > 0) show = inSight(sp, pos, lift);
  sp.position.set(pos.x, pos.y + lift, pos.z);
  const camD = camera.position.distanceTo(sp.position), h = camD * Math.tan((camera.fov * Math.PI) / 360) * 2; // world height of the screen at that depth
  const near = clamp(1 - (dist - 12) / 60, 0.55, 1), px = (innerHeight < 600 ? 62 : 74) * near; sp.scale.set((h * px) / innerHeight * (512 / 176), (h * px) / innerHeight, 1); // constant size on screen
  const want = show ? clamp(1.25 - dist / 220, 0.5, 1) : 0; sp.material.opacity += (want - sp.material.opacity) * 0.2; sp.visible = sp.material.opacity > 0.02;
}
function removeGhost(g) { scene.remove(g.mesh); tagScene.remove(g.label); g.label.material.map.dispose(); ghosts.delete(g.data.id); }
const hashStr = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

// ============================================================================ player + other calacas
const me = {
  id: (() => { try { return sessionStorage.getItem("animas-id") || Math.random().toString(36).slice(2, 10); } catch { return Math.random().toString(36).slice(2, 10); } })(),
  hue: (() => { try { const h = parseFloat(localStorage.getItem("animas-hue")); if (h >= 0) return h; const r = Math.random(); localStorage.setItem("animas-hue", r); return r; } catch { return Math.random(); } })(),
  name: (() => { try { return localStorage.getItem("animas-name") || ""; } catch { return ""; } })(),
  tag: SOLO ? (() => { try { let v = +localStorage.getItem("animas-tag"); if (!v) { v = 100 + ((Math.random() * 880) | 0); localStorage.setItem("animas-tag", v); } return v; } catch { return 100 + ((Math.random() * 880) | 0); } })() : null,
  pos: new V3(0, ISLANDS[0].h, 10), vel: new V3(), face: Math.PI, grounded: true, jumps: 0, coyote: 0, safe: new V3(0, ISLANDS[0].h, 10), item: null, dancing: false, speed: 0, airT: 0,
};
try { sessionStorage.setItem("animas-id", me.id); } catch {}
const hero = makeCalaca(me.hue);
hero.onStep = () => audio.step();
const others = new Map(); // id -> {c, pos, target, face, v, air, dance, item}

// ============================================================================ input
const keys = {}, cam = { yaw: 0, pitch: 0.3, dist: 7.2, locked: false };
const isTouch = matchMedia("(hover: none), (pointer: coarse)").matches || "ontouchstart" in window;
if (isTouch) document.body.classList.add("touch");
const typing = (e) => /TEXTAREA|INPUT/.test(e.target.tagName);
const SENS = 0.0042;
const look = (dx, dy, k = 1) => { cam.yaw -= dx * SENS * k; cam.pitch = clamp(cam.pitch + dy * SENS * 0.8 * k, -0.12, 1.15); };
addEventListener("keydown", (e) => {
  if (e.target.id === "name") { if (e.key === "Enter") { e.preventDefault(); enter(); } return; }
  if (typing(e)) { if (e.key === "Escape") closeSummon(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doSummon(); return; }
  if (!entered) { if (["Enter", "Space"].includes(e.code)) { e.preventDefault(); enter(); } return; }
  keys[e.code] = true;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (talk.open) {
    if (["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].includes(e.code)) choose(+e.code.slice(-1) - 1);
    else if (["Space", "Enter", "KeyE"].includes(e.code)) advance();
    else if (e.code === "Escape") closeTalk();
    return;
  }
  if (e.code === "Space") jump();
  if (e.code === "KeyE") interact();
  if (e.code === "KeyH") toggleHelp();
  if (e.code === "KeyF") { me.dancing = !me.dancing; if (me.dancing) audio.chime(0.06, 659.25); }
  if (e.code === "Escape") closeSummon();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

// --- mouse: click locks the pointer (move = look, Esc releases). If the browser refuses
// (sandboxed iframes), holding any mouse button and moving looks around instead.
const mdrag = { on: false, x: 0, y: 0, moved: 0 };
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => { if (!entered) return; mdrag.on = true; mdrag.x = e.clientX; mdrag.y = e.clientY; mdrag.moved = 0; canvas.focus(); });
addEventListener("mouseup", () => {
  if (mdrag.on && mdrag.moved < 5 && entered && !talk.open && !summonOpen() && !cam.locked && !isTouch) {
    try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => { cam.lockFailed = true; }); } catch { cam.lockFailed = true; }
  }
  mdrag.on = false;
});
document.addEventListener("pointerlockchange", () => { cam.locked = document.pointerLockElement === canvas; document.body.classList.toggle("locked", cam.locked); });
document.addEventListener("pointerlockerror", () => { cam.lockFailed = true; toast("Hold the mouse button and move to look around.", 2600); });
addEventListener("mousemove", (e) => {
  if (cam.locked) { look(e.movementX, e.movementY, 0.75); return; }
  if (mdrag.on) { const dx = e.clientX - mdrag.x, dy = e.clientY - mdrag.y; mdrag.moved += Math.abs(dx) + Math.abs(dy); mdrag.x = e.clientX; mdrag.y = e.clientY; look(dx, dy, 1.1); }
});
addEventListener("wheel", (e) => { if (entered) cam.dist = clamp(cam.dist + e.deltaY * 0.004, 3.5, 13); }, { passive: true });

// --- touch: a floating thumbstick on the left half, drag to look on the right half
const joy = { on: false, id: null, x: 0, y: 0, sx: 0, sy: 0 }, joyEl = $("#joy"), knob = $("#joy i");
const showJoy = () => { joyEl.style.transform = `translate(${joy.sx}px, ${joy.sy}px)`; knob.style.transform = `translate(${joy.x * 46}px, ${joy.y * 46}px)`; };
canvas.addEventListener("touchstart", (e) => {
  e.preventDefault(); if (!entered) return;
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth * 0.45 && !joy.on) { joy.on = true; joy.id = t.identifier; joy.sx = t.clientX; joy.sy = t.clientY; joy.x = joy.y = 0; joyEl.classList.add("on"); showJoy(); }
    else if (!cam.touch) cam.touch = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now() };
  }
}, { passive: false });
canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (joy.on && t.identifier === joy.id) {
      let dx = (t.clientX - joy.sx) / 46, dy = (t.clientY - joy.sy) / 46; const L = Math.hypot(dx, dy);
      if (L > 1) { joy.sx += (dx / L) * (L - 1) * 46; joy.sy += (dy / L) * (L - 1) * 46; dx /= L; dy /= L; } // the stick follows your thumb
      joy.x = dx; joy.y = dy; showJoy();
    } else if (cam.touch && t.identifier === cam.touch.id) { look(t.clientX - cam.touch.x, t.clientY - cam.touch.y, 1.35); cam.touch.x = t.clientX; cam.touch.y = t.clientY; }
  }
}, { passive: false });
const touchEnd = (e) => { for (const t of e.changedTouches) {
  if (t.identifier === joy.id) { joy.on = false; joy.x = joy.y = 0; joyEl.classList.remove("on"); }
  if (cam.touch && t.identifier === cam.touch.id) { const c = cam.touch; cam.touch = null;
    if (Math.hypot(t.clientX - c.sx, t.clientY - c.sy) < 10 && performance.now() - c.t < 260) { ndcTap(t.clientX, t.clientY); } } } };
canvas.addEventListener("touchend", touchEnd); canvas.addEventListener("touchcancel", touchEnd);
function ndcTap() { if (!talk.open) interact(); }
const tbtn = (id, fn) => { const el = $(id); el.addEventListener("touchstart", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("down"); fn(); }, { passive: false }); el.addEventListener("touchend", () => el.classList.remove("down")); el.addEventListener("click", fn); };
tbtn("#t-jump", () => (talk.open ? advance() : jump()));
$("#t-jump").addEventListener("touchstart", () => { keys.TouchJump = true; }); $("#t-jump").addEventListener("touchend", () => { keys.TouchJump = false; }); $("#t-jump").addEventListener("touchcancel", () => { keys.TouchJump = false; });
tbtn("#t-act", () => (talk.open ? advance() : interact()));
tbtn("#t-dance", () => { if (!talk.open) { me.dancing = !me.dancing; } });
$("#prompt").addEventListener("click", () => interact());
function toggleHelp(force) { const on = force ?? !document.body.classList.contains("showhelp"); document.body.classList.toggle("showhelp", on); try { localStorage.setItem("animas-help", on ? "1" : "0"); } catch {} }
$("#help-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleHelp(); });
$("#d-text").addEventListener("click", () => advance());
$("#sound").onclick = () => audio.toggle();

// ============================================================================ movement
const GRAV = 30, WALK = 6.2, SPRINT = 10;
// wings: unlocked by the souls you free. tier 1 at 3, tier 2 at 6, tier 3 (angel) at 10
const WING = [null, { at: 3, flaps: 2, name: "Alas de papel", glide: 1.35 }, { at: 6, flaps: 5, name: "Alas de cempasúchil", glide: 1.6 }, { at: 10, flaps: 14, name: "Ángel de Mictlán", glide: 1.9 }];
const prog = { total: (() => { try { return +localStorage.getItem("animas-freed-total") || 0; } catch { return 0; } })() };
if (Q.has("wings")) prog.total = Math.max(prog.total, WING[clamp(+Q.get("wings") || 1, 1, 3)].at);
const wingTier = () => (prog.total >= 10 ? 3 : prog.total >= 6 ? 2 : prog.total >= 3 ? 1 : 0);
Object.assign(me, { flaps: 0, gliding: false, flapT: 0 });
function jump() {
  if (!entered || talk.open || summonOpen()) return;
  me.dancing = false;
  const tier = wingTier();
  if (me.grounded || me.coyote > 0) { me.vel.y = 10.8; me.grounded = false; me.coyote = 0; me.jumps = 1; hero.squash = 0.75; audio.jump(1); }
  else if (me.jumps < 2) { me.vel.y = 9.6; me.jumps = 2; hero.flip = tier ? 0 : 1; me.flapT = 1; audio.jump(1.5); burst(me.pos.clone().add(new V3(0, 0.3, 0)), new THREE.Color(1, 0.6, 0.2), 14, 3, 0.3); }
  else if (tier && me.flaps > 0) { // a wing beat
    me.flaps--; me.vel.y = Math.max(me.vel.y, 0) + (tier === 3 ? 9 : 8.2); me.flapT = 1; audio.flap(tier);
    burst(me.pos.clone().add(new V3(0, 1.2, 0)), new THREE.Color(1, 0.7, 0.3), 18, 3.5, 0.32); updateWingHud();
  }
}
function updateWingHud() {
  const tier = wingTier(), el = $("#wings"); el.classList.toggle("on", tier > 0 && entered);
  if (!tier) { const next = WING[1]; $("#w-name").textContent = `free ${next.at - prog.total} more soul${next.at - prog.total === 1 ? "" : "s"} for wings`; el.classList.add("on", "locked"); $("#w-pips").innerHTML = ""; return; }
  el.classList.remove("locked"); const W = WING[tier];
  $("#w-name").textContent = W.name + (tier < 3 ? ` · next at ${WING[tier + 1].at}` : "");
  $("#w-pips").innerHTML = Array.from({ length: Math.min(W.flaps, 14) }, (_, i) => `<i class="${i < me.flaps ? "f" : ""}"></i>`).join("");
}
function grantWings(tier) {
  const W = WING[tier]; hero.wings.visible = true; featherMat.uniforms.uTier.value = tier; hero.halo.visible = tier === 3;
  hero.wings.scale.setScalar(0.01); me.wingGrow = 0; audio.rise();
  burst(me.pos.clone().add(new V3(0, 1.5, 0)), new THREE.Color(1, 0.75, 0.3), 120, 8, 0.6);
  const el = $("#gift"); el.querySelector("b").textContent = W.name; el.querySelector(".s").textContent = tier === 1 ? "The souls you freed have given you wings." : tier === 2 ? "Your wings fill with marigolds. They carry you further." : "You are the angel of Mictlán now. Fly.";
  el.querySelector(".h").innerHTML = isTouch ? "In the air: tap JUMP to beat your wings · hold JUMP to glide" : "In the air: press <kbd>space</kbd> to beat your wings · hold <kbd>space</kbd> to glide";
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); updateWingHud();
}
function updatePlayer(dt) {
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
  let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joy.y;
  if (talk.open || summonOpen()) ix = iz = 0;
  const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  const wx = fx * iz + rx * ix, wz = fz * iz + rz * ix, moving = Math.hypot(wx, wz) > 0.05;
  if (moving) me.dancing = false;
  const glideK = me.gliding ? WING[wingTier()].glide : 1;
  const top = ((keys.ShiftLeft || keys.ShiftRight || joy.on && Math.hypot(joy.x, joy.y) > 0.97) ? SPRINT : WALK) * glideK;
  const acc = me.grounded ? 12 : me.gliding ? 6 : 4;
  me.vel.x = lerp(me.vel.x, wx * top, 1 - Math.exp(-dt * acc)); me.vel.z = lerp(me.vel.z, wz * top, 1 - Math.exp(-dt * acc));
  if (moving) { const want = Math.atan2(wx, wz); let d = want - me.face; d = Math.atan2(Math.sin(d), Math.cos(d)); me.face += d * (1 - Math.exp(-dt * 12)); }
  const tier = wingTier(), holding = keys.Space || keys.TouchJump;
  me.gliding = !!(tier && !me.grounded && holding && me.vel.y < 0 && me.airT > 0.15);
  me.vel.y -= GRAV * dt * (me.vel.y < 0 ? (me.gliding ? 0.25 : 1.35) : 1);
  if (me.gliding) me.vel.y = Math.max(me.vel.y, tier === 3 ? -1.2 : -2.4);
  if (me.grounded && tier && me.flaps < WING[tier].flaps) { me.flaps = WING[tier].flaps; updateWingHud(); }
  { const mx = me.vel.x * dt, mz = me.vel.z * dt, n = Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.15));
    for (let i = 0; i < n; i++) { me.pos.x += mx / n; me.pos.z += mz / n; collideWalls(me.pos, me.pos.y); } }
  { const y0 = me.pos.y, y1 = y0 + me.vel.y * dt; me.pos.y = y1;
    if (me.vel.y > 0) for (const b of BOXES) { // head = feet + 1.75: bump it on ceilings, awnings, roof slabs
      if (b.y0 < y0 + 1.75 - 0.05 || b.y0 > y1 + 1.75) continue;
      if (me.pos.x > b.x0 - 0.25 && me.pos.x < b.x1 + 0.25 && me.pos.z > b.z0 - 0.25 && me.pos.z < b.z1 + 0.25) { me.pos.y = b.y0 - 1.75; me.vel.y = 0; me.flaps = 0; break; } } }
  const gy = groundAt(me.pos.x, me.pos.z, me.pos.y - me.vel.y * dt);
  if (me.pos.y <= gy && me.vel.y <= 0) {
    if (!me.grounded) { hero.squash = clamp(1 - me.airT * 0.25, 0.7, 0.95); if (me.airT > 0.3) { audio.land(); burst(me.pos.clone(), new THREE.Color(1, 0.55, 0.15), 10, 2.5, 0.28); } }
    me.pos.y = gy; me.vel.y = 0; me.grounded = true; me.jumps = 0; me.coyote = 0.12; me.airT = 0;
    if (Math.random() < 0.05) me.safe.copy(me.pos);
  } else {
    if (me.grounded && gy > -Infinity && me.pos.y - gy < 0.35 && me.vel.y <= 0) { me.pos.y = gy; } // walk down slopes
    else { if (me.grounded) me.coyote = 0.12; me.grounded = false; me.coyote -= dt; me.airT += dt; }
  }
  if (me.pos.y < -2.2) { // fell into the river of the dead
    burst(new V3(me.pos.x, 0.2, me.pos.z), new THREE.Color(0.6, 0.55, 1), 40, 6, 0.4); audio.splash();
    me.pos.copy(me.safe); me.pos.y += 0.5; me.vel.set(0, 0, 0); toast("The river carries you back to the shore.", 2600);
  }
  me.speed = Math.hypot(me.vel.x, me.vel.z);
  hero.root.position.copy(me.pos); hero.root.rotation.y = me.face;
  const sg = groundAt(me.pos.x, me.pos.z, me.pos.y + 0.1);
  hero.shadow.visible = sg > -Infinity; hero.shadow.position.set(me.pos.x, sg + 0.03, me.pos.z); hero.shadow.scale.setScalar(clamp(1 - (me.pos.y - sg) * 0.12, 0.4, 1));
}

// ============================================================================ wings
function updateWings(dt, t) {
  const tier = wingTier(); if (!tier || !hero.wings.visible) return;
  const target = [0, 0.85, 1.05, 1.3][tier]; me.wingGrow = Math.min(1, (me.wingGrow ?? 1) + dt * 0.8);
  me.wingFold = lerp(me.wingFold ?? 1, insideCasa >= 0 ? 0.45 : 1, 1 - Math.exp(-dt * 6)); // fold them indoors
  hero.wings.scale.setScalar(target * ease(me.wingGrow) * me.wingFold);
  me.flapT = Math.max(0, me.flapT - dt * 2.2);
  const air = !me.grounded, open = air ? 1 : 0.02;
  let flap = 0;
  if (me.flapT > 0) flap = Math.sin((1 - me.flapT) * Math.PI * 2.5) * 0.9;
  else if (me.gliding) flap = 0.12 + Math.sin(t * 3) * 0.05;
  else if (air) flap = Math.sin(t * 9) * 0.35;
  else flap = 0.1 + Math.sin(t * 1.6) * 0.06;
  for (const [w, side] of [[hero.wingL, -1], [hero.wingR, 1]]) {
    w.rotation.y = lerp(w.rotation.y, side * (1 - open) * 1.42, 1 - Math.exp(-dt * 8));
    w.rotation.z = lerp(w.rotation.z, side * -flap, 1 - Math.exp(-dt * 18));
  }
  hero.halo.rotation.z += dt;
  if ((me.gliding || (air && tier === 3)) && Math.random() < 0.8) { // a trail of light from the wing tips
    const back = new V3(Math.sin(me.face), 0, Math.cos(me.face)).multiplyScalar(-0.4), side = new V3(Math.cos(me.face), 0, -Math.sin(me.face)).multiplyScalar(1.1 * target);
    for (const k of [-1, 1]) burst(me.pos.clone().add(new V3(0, 1.3, 0)).add(back).addScaledVector(side, k), new THREE.Color(1, 0.7, 0.3), 1, 0.4, 0.3);
  }
}
function showWingsQuiet() { const tier = wingTier(); if (!tier) return; hero.wings.visible = true; featherMat.uniforms.uTier.value = tier; hero.halo.visible = tier === 3; me.flaps = WING[tier].flaps; me.wingGrow = 1; }

// ============================================================================ camera
const camTarget = new V3(), smoothT = new V3(); let camDist = 7;
let entered = false, introT = 0;
function updateCamera(t, dt) {
  const now = performance.now() / 1000;
  if (!entered) { const a = t * 0.05; camera.position.set(Math.sin(a) * 70, 26 + Math.sin(t * 0.2) * 2, Math.cos(a) * 70); camera.lookAt(0, 4, 0); smoothT.set(0, 4, 0); return; }
  // the camera only turns when YOU turn it: WASD always moves relative to where you're looking
  if (keys.KeyQ) cam.yaw += dt * 2.2; if (keys.KeyR) cam.yaw -= dt * 2.2;
  let dist = cam.dist, pitch = cam.pitch;
  camTarget.copy(me.pos).add(new V3(0, 1.5, 0));
  let yaw = cam.yaw;
  insideCasa = CASAS.findIndex((c) => me.pos.x > c.x0 && me.pos.x < c.x1 && me.pos.z > c.z0 && me.pos.z < c.z1 && me.pos.y < c.y1 - 0.3);
  const shoulder = false; // indoors: same follow camera, walls and ceilings just pull it in
  if (talk.open && talk.g) { camTarget.lerpVectors(me.pos, talk.g.pos, 0.55).add(new V3(0, 1.5, 0)); dist = 4.6; pitch = 0.14; yaw = Math.atan2(me.pos.x - talk.g.pos.x, me.pos.z - talk.g.pos.z) + 0.45; }
  const pos = new V3(camTarget.x + Math.sin(yaw) * Math.cos(pitch) * dist, camTarget.y + Math.sin(pitch) * dist, camTarget.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  const clip = (from, to) => { const dir = to.clone().sub(from), L = dir.length(); if (L < 1e-4) return to; dir.divideScalar(L);
    const N = Math.ceil(L / 0.1); for (let i = 1; i <= N; i++) { const d = (i / N) * L, q = from.clone().addScaledVector(dir, d); if (insideSolid(q.x, q.y, q.z) || q.y < groundAt(q.x, q.z, q.y) + 0.25) return from.clone().addScaledVector(dir, Math.max(0.3, d - 0.35)); } return to; };
  pos.copy(clip(camTarget, pos));
  if (!talk.open && pos.distanceTo(camTarget) < Math.min(dist, 2.4)) { // backed into a wall: swing the camera up and over instead of jamming it into your skull
    let best = pos.clone(), bd = pos.distanceTo(camTarget);
    for (let p = pitch + 0.15; p <= 0.95; p += 0.15) {
      const c = clip(camTarget, new V3(camTarget.x + Math.sin(yaw) * Math.cos(p) * dist, camTarget.y + Math.sin(p) * dist, camTarget.z + Math.cos(yaw) * Math.cos(p) * dist)), d = c.distanceTo(camTarget);
      if (d > bd + 0.3) { best = c; bd = d; } if (d >= Math.min(dist, 2.4)) break; }
    pos.copy(best);
  }
  pos.y = Math.max(pos.y, 0.6);
  introT = Math.min(1, introT + dt / 2.6);
  if (introT < 1) { const k = ease(introT); camera.position.lerpVectors(new V3(Math.sin(t * 0.05) * 70, 26, Math.cos(t * 0.05) * 70), pos, k); smoothT.lerpVectors(new V3(0, 4, 0), camTarget, k); }
  else { camera.position.lerp(pos, 1 - Math.exp(-dt * (shoulder ? 20 : 9))); smoothT.lerp(camTarget, 1 - Math.exp(-dt * (shoulder ? 24 : 14))); camera.position.copy(clip(smoothT, camera.position)); }
  const fov = me.gliding ? 64 : 55; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix(); }
  camera.lookAt(smoothT);
  { // camera squeezed close (back to a wall): your calaca turns see-through so it never fills the screen
    const d = camera.position.distanceTo(me.pos.clone().add(new V3(0, 1.3, 0))), want = clamp((d - 1.0) / 1.4, 0.12, 1);
    if (!hero.mats) { hero.mats = []; const own = new Map(); hero.root.traverse((o) => { if (!o.isMesh || Array.isArray(o.material) || o.material.isShaderMaterial) return; // own copies: bots share these materials
      if (!own.has(o.material)) { const c = o.material.clone(); if (o.material.onBeforeCompile) c.onBeforeCompile = o.material.onBeforeCompile; own.set(o.material, c); hero.mats.push(c); } o.material = own.get(o.material); }); }
    hero.fadeK = lerp(hero.fadeK ?? 1, want, 1 - Math.exp(-dt * 10));
    for (const m of hero.mats) { const tr = hero.fadeK < 0.98; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.opacity = hero.fadeK; m.depthWrite = !tr; }
    hero.wings.visible = wingTier() > 0 && hero.fadeK > 0.5;
  }
  camera.updateMatrixWorld(true); // labels and markers are projected right after this: use this frame's camera, not last frame's
}

// ============================================================================ sparks
const fxGeo = new THREE.BufferGeometry(), FXN = 900;
fxGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FXN * 3), 3).setUsage(THREE.DynamicDrawUsage));
fxGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(FXN * 3), 3).setUsage(THREE.DynamicDrawUsage));
fxGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(FXN), 1).setUsage(THREE.DynamicDrawUsage));
const fxMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: innerHeight * 0.5 } },
  vertexShader: `attribute vec3 aColor; attribute float aSize; uniform float uScale; varying vec3 vC; void main(){ vC = aColor; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uScale/-mv.z; gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5); gl_FragColor = vec4(vC*smoothstep(0.5,0.0,d)*1.6, 1.0); }` });
const fxPts = new THREE.Points(fxGeo, fxMat); fxPts.frustumCulled = false; scene.add(fxPts);
const sparks = [];
const burst = (pos, color, n = 30, power = 6, size = 0.4) => { for (let i = 0; i < n && sparks.length < FXN; i++) sparks.push({ p: pos.clone(), v: new V3().randomDirection().multiplyScalar(power * (0.3 + Math.random())).add(new V3(0, power * 0.4, 0)), c: color, life: 0.6 + Math.random() * 0.7, max: 1.3, s: size }); };
function updateSparks(dt) {
  const P = fxGeo.attributes.position, C = fxGeo.attributes.aColor, S = fxGeo.attributes.aSize; let n = 0;
  for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.life -= dt; if (s.life <= 0) { sparks.splice(i, 1); continue; } s.v.y -= dt * 6; s.v.multiplyScalar(1 - dt * 1.5); s.p.addScaledVector(s.v, dt);
    P.setXYZ(n, s.p.x, s.p.y, s.p.z); const k = s.life / s.max; C.setXYZ(n, s.c.r * k, s.c.g * k, s.c.b * k); S.setX(n, s.s * (0.4 + k)); n++; }
  fxGeo.setDrawRange(0, n); P.needsUpdate = C.needsUpdate = S.needsUpdate = true;
}

// ============================================================================ quests, letters, secrets, places
// A quest is either { type: "item", g } (find what they miss) or { type: "letter", g, to } (carry their
// letter, written by Gemma, to another ghost). You can carry up to 4 at once, like a real mail carrier.
const quests = [];
const MAX_QUESTS = 4;
const stats = { mine: 0, tonight: 0, letters: 0 };
const talk = { open: false, g: null, full: "", shown: 0, opts: [], typing: false, acc: 0 };
const summonOpen = () => document.body.classList.contains("summoning");
const ghostById = (id) => ghosts.get(id);
const wandering = (g) => g && g.state === "wander";
const questFor = (g) => quests.find((q) => q.g === g);
const letterFor = (g) => quests.find((q) => q.type === "letter" && q.to === g.data.id);
const recipientOf = (g) => g.data.letter && ghostById(g.data.letter.to);
function nearestGhost(r = 3.4) { let best = null, bd = r * r; for (const g of ghosts.values()) { if (g.state !== "wander") continue; const d = g.pos.distanceToSquared(me.pos); if (d < bd) { bd = d; best = g; } } return best; }
const ALTAR = SPOT.altar, MAILBOX = SPOT.mailbox;
const near = (p, r) => p && Math.hypot(me.pos.x - p.x, me.pos.z - p.z) < r && Math.abs(me.pos.y - p.y) < 2.5;
const orphanLetters = () => quests.filter((q) => q.type === "letter" && !wandering(ghostById(q.to)));
function interact() {
  if (!entered || talk.open) return;
  const g = nearestGhost(); if (g) return openTalk(g);
  if (near(MAILBOX, 3)) return useMailbox();
  if (near(ALTAR, 4.5)) { if (!net.online) return toast("The ofrenda is quiet tonight. Summoning needs the keeper (the AI server may be offline; you can still play and deliver letters).", 5200); return openSummon(); }
}
function useMailbox() {
  const lost = orphanLetters();
  if (!lost.length) { toast(quests.some((q) => q.type === "letter") ? "Letters go to their readers in person. The mailbox is only for those who've already crossed over." : "The mailbox of Mictlán. Letters for souls who have already crossed over can be posted here.", 4200); return; }
  for (const q of lost) { quests.splice(quests.indexOf(q), 1); stats.letters++; if (wandering(q.g)) free(q.g, false, `${q.g.data.name}'s letter went through the mailbox to the other side`); }
  audio.pickup(); updateQuestHud(); updateCounts(); callout("Posted", `${lost.length} letter${lost.length > 1 ? "s" : ""} sent to the other side`);
}
const ITEM_A = (n) => ({ pan_dulce: "a piece of pan dulce", hot_chocolate: "a cup of chocolate", marigold_crown: "a crown of marigolds", sugar_skull: "a sugar skull", wooden_toy: "a wooden toy", pocket_watch: "a pocket watch", photograph: "a photograph" }[n] || `a ${ITEM_NAME[n]}`);
function openTalk(g) {
  talk.open = true; talk.g = g; me.dancing = false; document.body.classList.add("talking"); if (document.pointerLockElement) document.exitPointerLock();
  $("#d-name").textContent = g.data.name; $("#d-from").textContent = `${g.data.from} · ${g.data.life}`;
  $("#dialog").style.setProperty("--gc", "#" + new THREE.Color(PALETTE[g.data.color] || PALETTE.marigold).getHexString());
  const opts = [];
  const mail = letterFor(g), q = questFor(g);
  if (mail) opts.push([`✉ A letter for you, from ${mail.g.data.name}`, () => deliver(mail)]);
  if (q && q.type === "item" && me.item === g.data.item) opts.push([`Give the ${ITEM_NAME[g.data.item]}`, give]);
  if (q && q.type === "item" && me.item !== g.data.item) return say(`My ${ITEM_NAME[g.data.item]}… I think it's somewhere around ${itemByName[g.data.item].island}. Follow the golden light.`, [...opts, ["On my way", closeTalk], ["Why does it matter?", () => say(g.data.ask, [["I'll find it", closeTalk]])]]);
  if (q && q.type === "letter") { const r = ghostById(q.to); return say(wandering(r) ? `Please, take my letter to ${r.data.name}. Last I saw, they were near ${placeName(r.home.x, r.home.z, r.home.y)}.` : `${g.data.letter.toName} has already crossed over? Then post it in the red mailbox by the Correo. It will find them.`, [...opts, ["On my way", closeTalk]]); }
  say(g.data.greeting, [...opts, ["Tell me about yourself", () => say(g.data.memory, [["Do you need something?", ask], ["Goodbye", closeTalk]])], ["Do you need something?", ask], ["Goodbye", closeTalk]].slice(0, 4));
}
function ask() {
  const g = talk.g, r = recipientOf(g);
  if (quests.length >= MAX_QUESTS) return say("Your bag looks full, little one. Come back when you've delivered a few things.", [["Okay", closeTalk]]);
  if (g.data.letter && wandering(r)) return say(g.data.letter.ask || `Could you take a letter to ${r.data.name} for me?`, [[`I'll deliver it to ${r.data.name}`, () => accept("letter")], ["Maybe later", closeTalk]]);
  say(g.data.ask, [[`I'll find your ${ITEM_NAME[g.data.item]}`, () => accept("item")], ["Maybe later", closeTalk]]);
}
function accept(type) {
  const g = talk.g; audio.chime(0.08, 783.99);
  if (type === "letter") { const r = recipientOf(g); quests.push({ type, g, to: r.data.id }); audio.pickup();
    say(`Thank you. ${r.data.name} should be somewhere around ${placeName(r.home.x, r.home.z, r.home.y)}.`, [["Into the mail bag ✉", closeTalk]]); }
  else { quests.push({ type, g }); say(`Look around ${itemByName[g.data.item].island}. Follow the golden light, little one.`, [["On my way!", closeTalk]]); }
  updateQuestHud();
}
function deliver(q) {
  const r = talk.g, s = q.g, L = s.data.letter;
  quests.splice(quests.indexOf(q), 1); stats.letters++; updateQuestHud(); updateCounts();
  closeTalk(); showLetter(s, r, L, () => { openTalk(r); say(L.reply || "Oh… thank you, little one.", [["✿", () => { closeTalk(); if (wandering(s)) free(s, false, `${s.data.name}'s letter reached ${r.data.name}`); }]]); });
}
function showLetter(from, to, L, after) {
  const el = $("#letter"); el.querySelector(".to").textContent = `Dear ${to.data.name},`;
  el.querySelector(".body").textContent = L.letter.replace(/^dear [^,]+,\s*/i, "");
  el.querySelector(".from").textContent = `— ${from.data.name}`; el.querySelector(".rel").textContent = L.relation || "";
  el.classList.add("on"); document.body.classList.add("reading"); audio.chime(0.07, 659.25);
  let done = false;
  const close = () => { if (done) return; done = true; el.classList.remove("on"); document.body.classList.remove("reading"); removeEventListener("keydown", key, true); after(); };
  const key = (e) => { if (["Space", "Enter", "KeyE", "Escape", "Digit1"].includes(e.code)) { e.preventDefault(); e.stopPropagation(); close(); } };
  setTimeout(() => { if (!done) addEventListener("keydown", key, true); }, 300);
  el.querySelector("button").onclick = close;
}
function say(text, opts) { talk.full = text; talk.shown = 0; talk.rendered = 0; talk.opts = opts; talk.typing = true; talk.acc = 0; $("#d-text").textContent = ""; $("#d-opts").innerHTML = ""; }
function showOpts() { const box = $("#d-opts"); box.innerHTML = ""; talk.opts.forEach(([label, fn], i) => { const b = document.createElement("button"); b.innerHTML = `<kbd>${i + 1}</kbd>`; b.append(label); b.onclick = () => choose(i); box.appendChild(b); }); }
function advance() { if (document.body.classList.contains("reading")) return; if (talk.typing) talk.shown = talk.full.length; else if (talk.opts.length) choose(0); }
function choose(i) { if (talk.typing) { talk.shown = talk.full.length; return; } const o = talk.opts[i]; if (o) { audio.chime(0.04, 880); o[1](); } }
function closeTalk() { talk.open = false; talk.g = null; document.body.classList.remove("talking"); }
function updateTalk(dt) {
  if (!talk.open || !talk.typing) return;
  talk.acc += dt * 46; talk.shown = Math.min(talk.full.length, Math.max(talk.shown, Math.floor(talk.acc)));
  if (talk.shown > (talk.rendered || 0)) { talk.rendered = talk.shown; $("#d-text").textContent = talk.full.slice(0, talk.shown); const ch = talk.full[talk.shown - 1]; if (/[a-zA-ZÀ-ỹ]/.test(ch) && talk.shown % 2 === 0) audio.blip(talk.g.voice, ch); }
  if (talk.shown >= talk.full.length) { talk.typing = false; showOpts(); }
}
function give() {
  const g = talk.g; const q = questFor(g); if (q) quests.splice(quests.indexOf(q), 1);
  say(g.data.thanks, [["Goodbye… ✿", () => { closeTalk(); free(g); }]]);
  me.item = null; holdItem(hero, null); updateQuestHud();
  const it = itemByName[g.data.item]; setTimeout(() => { it.home = true; it.mesh.visible = true; }, 1500);
}
function free(g, remote = false, why = "") {
  if (g.state === "rising") return;
  g.state = "rising"; g.t = 0; g.label.visible = false;
  for (const q of quests.filter((q) => q.g === g && q.type === "item")) quests.splice(quests.indexOf(q), 1);
  if (!remote) { stats.mine++; const before = wingTier(); prog.total++; try { localStorage.setItem("animas-freed-total", prog.total); } catch {} const after = wingTier(); if (after > before) setTimeout(() => grantWings(after), 3600); else updateWingHud();
    if (net.online) fetch(api("/api/free"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.data.id }) }).catch(() => {}); else stats.tonight++; }
  updateQuestHud();
  audio.rise(); burst(g.pos.clone().add(new V3(0, 1.2, 0)), new THREE.Color(PALETTE[g.data.color] || 0xffffff), 70, 7, 0.55);
  if (!remote) { const el = $("#crossed"); el.querySelector(".n").textContent = why ? `${why} · ${g.data.name} crossed over` : `${g.data.name} crossed over`; el.querySelector(".e").textContent = g.data.epitaph.replace(/\s*\/\s*/g, "\n"); el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); }
  updateCounts();
}
function lanternFor(l, from) {
  const a = anchorOf(l.slot ?? 0);
  addLantern({ id: l.id, primary: l.primary || "marigold", secondary: ["rose", "gold", "violet", "turquoise"][hashStr(l.id) % 4], motif: ITEM_MOTIF[l.item] || "star", warmth: 7,
    seed: l.seed ?? Math.random(), x: a.x, z: a.z, t: l.t || Date.now(), lastVisit: l.t || Date.now(), visits: 3 }, { rising: !!from, from });
}
const ghostLights = [0, 1, 2, 3, 4].map(() => { const l = new THREE.PointLight(0xffffff, 0, 9, 1.7); scene.add(l); return l; });
function updateGhosts(t, dt) {
  const list = [...ghosts.values()];
  for (const g of list) {
    g.fade = Math.min(1, g.fade + dt * 0.6);
    const dist = g.pos.distanceTo(me.pos);
    if (g.state === "wander") {
      const talking = talk.g === g;
      if (dist > 7 && !talking) g.pos.lerp(new V3(g.home.x + Math.cos(t * 0.3 + g.ph) * 1.4, g.home.y + 0.35 + Math.sin(t * 1.4 + g.ph) * 0.18, g.home.z + Math.sin(t * 0.3 + g.ph) * 1.4), 1 - Math.exp(-dt * 1.5));
      else g.pos.y = lerp(g.pos.y, g.home.y + 0.35 + Math.sin(t * 1.4 + g.ph) * 0.12, 1 - Math.exp(-dt * 3));
      const want = dist < 9 ? Math.atan2(me.pos.x - g.pos.x, me.pos.z - g.pos.z) : t * 0.3 + g.ph;
      let d = want - g.face; d = Math.atan2(Math.sin(d), Math.cos(d)); g.face += d * (1 - Math.exp(-dt * 4));
    } else if (g.state === "rising") {
      g.t += dt; g.pos.y += dt * (1 + g.t * 2.2); g.face += dt * (3 + g.t * 4); g.fade = Math.max(0, 1 - g.t / 3.2);
      if (Math.random() < 0.5) burst(g.pos.clone().add(new V3(0, 1, 0)), new THREE.Color(PALETTE[g.data.color] || 0xffffff), 2, 2, 0.4);
      if (g.t > 3.2) { lanternFor({ id: g.data.id, primary: g.data.color, item: g.data.item, slot: g.data.slot, t: Date.now() }, g.pos.clone().add(new V3(0, 1.5, 0))); removeGhost(g); continue; }
    }
    g.mesh.position.copy(g.pos); g.mesh.rotation.y = g.face; g.mesh.material.uniforms.uFade.value = g.fade;
    g.mesh.material.uniforms.uTalk.value = talk.g === g && talk.typing ? 0.5 + 0.5 * Math.sin(t * 22) : 0;
    const q = questFor(g), mail = letterFor(g);
    const icon = mail ? "✉" : q ? (q.type === "item" && me.item === g.data.item ? "★" : "…") : "!";
    drawTag(g.label, icon, g.data.name, g.data.from || "", q && !mail && !(q.type === "item" && me.item === g.data.item) ? "quest" : "");
    placeTag(g.label, g.pos, 2.55, dist, 34, entered && g.state === "wander" && !talk.open);
  }
  // only the five ghosts closest to you cast light (lights are expensive)
  list.filter((g) => g.fade > 0.05).sort((a, b) => a.pos.distanceToSquared(me.pos) - b.pos.distanceToSquared(me.pos)).slice(0, 5)
    .concat([null, null, null, null, null]).slice(0, 5).forEach((g, i) => { const l = ghostLights[i]; if (!g) { l.intensity = 0; return; } l.color.copy(g.mesh.material.uniforms.uColor.value); l.position.copy(g.pos).add(new V3(0, 1.4, 0)); l.intensity = 5 * g.fade; });
}
function updateItems(t, dt) {
  const wanted = new Set(quests.filter((q) => q.type === "item").map((q) => q.g.data.item));
  for (const it of items) {
    const target = wanted.has(it.name) && it.home;
    const camD = Math.hypot(it.beam.position.x - camera.position.x, it.beam.position.z - camera.position.z), fade = clamp((camD - 3) / 14, 0, 1);
    it.beam.material.uniforms.uOn.value = lerp(it.beam.material.uniforms.uOn.value, (target ? 0.9 : it.home ? 0.04 : 0) * fade, 1 - Math.exp(-dt * 3));
    it.beam.visible = camD > 2.5;
    if (!it.home) continue;
    it.mesh.rotation.y = t * 1.2; it.mesh.position.y = it.at.y + 1.45 + Math.sin(t * 2 + it.at.x) * 0.12;
    if (me.item !== it.name && !it.lock && Math.hypot(me.pos.x - it.at.x, me.pos.z - it.at.z) < 1.7 && Math.abs(me.pos.y - it.at.y) < 2.2) {
      if (me.item) { const old = itemByName[me.item]; old.home = true; old.mesh.visible = true; } // swap: what you carried flies home
      it.lock = true;
      it.home = false; it.mesh.visible = false; me.item = it.name; holdItem(hero, it.name); hero.squash = 0.8; audio.pickup();
      burst(it.mesh.position.clone(), new THREE.Color(1, 0.75, 0.3), 30, 4, 0.35);
      const owner = [...ghosts.values()].find((g) => g.data.item === it.name && g.state === "wander");
      callout(`The ${ITEM_NAME[it.name]}`, owner ? (questFor(owner) ? `bring it back to ${owner.data.name}` : `${owner.data.name}, near ${placeName(owner.home.x, owner.home.z, owner.home.y)}, has been missing this`) : "someone here must miss it");
      updateQuestHud();
    }
  }
  for (const it of items) if (it.lock && Math.hypot(me.pos.x - it.at.x, me.pos.z - it.at.z) > 2.5) it.lock = false;
  me.itemT = me.item ? (me.itemT || 0) + dt : 0;
}

// --- golden calaveras: little secrets on rooftops, towers, islets and odd corners
const secrets = SPOT.secrets.map((p, i) => {
  const g = new THREE.Group(); const sk = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshLambertMaterial({ color: 0xffc93c, emissive: 0x7a4400 })); g.add(sk);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2a1300 })); e.position.set(sx * 0.09, 0.03, 0.22); g.add(e); }
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 0.4) })); halo.rotation.x = Math.PI / 2; g.add(halo);
  g.position.set(p.x, p.y + 0.9, p.z); scene.add(g); return { i, p, g, found: false };
});
const foundSecrets = (() => { try { return new Set(JSON.parse(localStorage.getItem("animas-secrets") || "[]")); } catch { return new Set(); } })();
secrets.forEach((s) => { if (foundSecrets.has(s.i)) { s.found = true; s.g.visible = false; } });
function updateSecrets(t) {
  for (const s of secrets) {
    if (s.found) continue; s.g.rotation.y = t * 2; s.g.position.y = s.p.y + 0.9 + Math.sin(t * 2.5 + s.i) * 0.12;
    if (Math.hypot(me.pos.x - s.p.x, me.pos.z - s.p.z) < 1.3 && Math.abs(me.pos.y - s.p.y) < 1.6) {
      s.found = true; s.g.visible = false; foundSecrets.add(s.i); try { localStorage.setItem("animas-secrets", JSON.stringify([...foundSecrets])); } catch {}
      burst(s.g.position.clone(), new THREE.Color(1, 0.8, 0.3), 50, 6, 0.45); audio.pickup();
      const n = foundSecrets.size, N = secrets.length;
      callout(n === N ? "Every calavera found!" : "A golden calavera", n === N ? "you know every corner of Mictlán" : `${n} of ${N} · somewhere up high, or out on the water`); updateCounts();
    }
  }
}
// --- places: a little "discovered" moment the first time you set foot somewhere
const visited = new Set();
let placeT = 0;
function visitPlace(dt) {
  placeT += dt; if (placeT < 0.5) return; placeT = 0;
  if (!me.grounded) return;
  const n = placeName(me.pos.x, me.pos.z, me.pos.y), key = n.startsWith("the rooftops") ? "rooftops" : n;
  if (visited.has(key)) return; visited.add(key);
  if (visited.size > 1) { const el = $("#place"); el.querySelector("b").textContent = n.startsWith("the rooftops") ? "The rooftops" : n.replace(/^the /, "The "); el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); audio.chime(0.05, 523.25); }
  updateCounts();
}

// ============================================================================ HUD, minimap, big map
const hud = { marker: $("#marker"), mlabel: $("#marker span"), prompt: $("#prompt") };
function toast(msg, ms = 3200) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), ms); }
function callout(big, small) { const el = $("#callout"); el.querySelector("b").textContent = big; el.querySelector("span").textContent = small || ""; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); }
function updateCounts() {
  $("#c-mine").textContent = prog.total; $("#c-tonight").textContent = stats.tonight; $("#c-wander").textContent = [...ghosts.values()].filter((g) => g.state === "wander").length;
  $("#c-secrets").textContent = `${foundSecrets.size}/${secrets.length}`; $("#c-letters").textContent = stats.letters;
}
function questTarget(q) {
  if (q.type === "letter") { const r = ghostById(q.to); return wandering(r) ? { p: r.pos.clone().add(new V3(0, 1.4, 0)), label: `✉ to ${r.data.name}`, where: placeName(r.home.x, r.home.z, r.home.y) } : { p: MAILBOX.clone().add(new V3(0, 1.4, 0)), label: `✉ post ${q.g.data.name}'s letter`, where: "the red mailbox, Barrio del Correo" }; }
  if (me.item === q.g.data.item) return { p: q.g.pos.clone().add(new V3(0, 1.4, 0)), label: `★ return to ${q.g.data.name}`, where: placeName(q.g.home.x, q.g.home.z, q.g.home.y) };
  const it = itemByName[q.g.data.item]; return { p: it.mesh.position.clone(), label: `find ${q.g.data.name}'s ${ITEM_NAME[q.g.data.item]}`, where: it.island };
}
let focus = 0;
function updateQuestHud() {
  const box = $("#quest");
  if (!quests.length) { box.classList.remove("on"); box.innerHTML = ""; return; }
  focus = Math.min(focus, quests.length - 1);
  box.innerHTML = `<div class="k mono">mail bag · ${quests.length}/${MAX_QUESTS}${quests.length > 1 ? `<span class="kb-only"> · <kbd>Tab</kbd> switch</span><span class="tap-only"> · tap to track</span>` : ""}</div>` + quests.map((q, i) => { const t = questTarget(q);
    return `<div class="row ${i === focus ? "on" : ""}"><div class="t">${t.label}</div><div class="w mono">${t.where}<span class="d"></span></div></div>`; }).join("");
  box.classList.add("on");
  box.querySelectorAll(".row").forEach((r, i) => r.addEventListener("click", () => { focus = i; updateQuestHud(); }));
}
function updateHud() {
  let msg = "";
  if (!talk.open && !summonOpen() && entered) { const g = nearestGhost(); if (g) msg = `<kbd>E</kbd> ${letterFor(g) ? "deliver to" : "talk to"} ${g.data.name}`; else if (near(MAILBOX, 3)) msg = `<kbd>E</kbd> the mailbox to the other side`; else if (near(ALTAR, 4.5)) msg = `<kbd>E</kbd> summon someone you miss`; }
  if (hud.prompt._m !== msg) { hud.prompt.innerHTML = msg; hud.prompt._m = msg; hud.prompt.classList.toggle("on", !!msg); }
  const q = quests[focus], t = q && questTarget(q);
  if (t && !talk.open && introT >= 1) {
    const dist = t.p.distanceTo(me.pos), p = t.p.clone().project(camera), behind = p.z > 1;
    let x = p.x, y = p.y; if (behind) { x = -x; y = -y; }
    const off = behind || Math.abs(x) > 0.9 || Math.abs(y) > 0.85;
    if (off) { const m = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.85); x /= m; y /= m; }
    hud.marker.style.transform = `translate(${(x * 0.5 + 0.5) * innerWidth}px, ${(-y * 0.5 + 0.5) * innerHeight}px)`;
    hud.marker.classList.toggle("edge", off); hud.marker.classList.add("on"); hud.marker.querySelector("em").style.transform = `rotate(${Math.atan2(-y, x)}rad)`;
    hud.mlabel.textContent = `${Math.round(dist)}m`; const d = $("#quest .row.on .d"); if (d) d.textContent = ` · ${Math.round(dist)} m`;
  } else hud.marker.classList.remove("on");
}
addEventListener("keydown", (e) => { if (!entered || talk.open || /TEXTAREA|INPUT/.test(e.target.tagName)) return;
  if (e.code === "Tab") { e.preventDefault(); if (quests.length) { focus = (focus + 1) % quests.length; updateQuestHud(); } }
  if (e.code === "KeyM") { e.stopImmediatePropagation(); toggleMap(); } }, { capture: true });
// the maps: the minimap turns with your camera; the big map (M) is north-up with every place named
const mini = $("#minimap"), mctx = mini.getContext("2d"), big = $("#bigmap"), bctx = big.getContext("2d");
function drawMap(ctx, W, H, scale, rotate, cx, cz, labels) {
  ctx.save(); ctx.clearRect(0, 0, W, H); ctx.translate(W / 2, H / 2); if (rotate) ctx.rotate(cam.yaw); ctx.scale(scale, scale); ctx.translate(-cx, -cz);
  ctx.fillStyle = "rgba(255,140,26,.10)"; ctx.strokeStyle = "rgba(255,170,90,.45)"; ctx.lineWidth = 1 / scale;
  for (const s of PADS) { ctx.beginPath(); ctx.arc(s.x, s.z, s.r, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.strokeStyle = "rgba(240,200,160,.55)"; for (const b of BRIDGES) { ctx.lineWidth = Math.max(b.w * 0.6, 1.2 / scale); ctx.beginPath(); ctx.moveTo(b.ax, b.az); ctx.lineTo(b.bx, b.bz); ctx.stroke(); }
  for (const b of BOXES) { if (b.x1 - b.x0 < 2.5 && b.z1 - b.z0 < 2.5) continue; const h = clamp((b.y1 - 1) / 12, 0, 1); ctx.fillStyle = `rgba(${200 + h * 55},${120 + h * 60},${170 - h * 80},${0.35 + h * 0.4})`; ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0); }
  for (const g of ghosts.values()) { if (g.state !== "wander") continue; const tgt = quests.some((q) => (q.type === "letter" ? q.to === g.data.id : q.g === g && me.item === g.data.item)) || letterFor(g);
    ctx.fillStyle = tgt ? "#ffc93c" : questFor(g) ? "#9fd0ff" : "#ff8c1a"; ctx.beginPath(); ctx.arc(g.home.x, g.home.z, (tgt ? 2.6 : 1.8) / Math.sqrt(scale), 0, 7); ctx.fill(); }
  for (const q of quests) { const t = questTarget(q); ctx.strokeStyle = "#ffc93c"; ctx.lineWidth = 2 / scale; ctx.beginPath(); ctx.arc(t.p.x, t.p.z, 4 / scale + 1.2, 0, 7); ctx.stroke(); }
  ctx.fillStyle = "#ff3d8b"; ctx.beginPath(); ctx.arc(MAILBOX.x, MAILBOX.z, 1.4, 0, 7); ctx.fill();
  ctx.fillStyle = "#9ff3ff"; for (const o of others.values()) { ctx.beginPath(); ctx.arc(o.pos.x, o.pos.z, 2.2 / Math.sqrt(scale), 0, 7); ctx.fill(); } // other mail carriers
  if (labels) { ctx.font = `${12 / scale}px Geist Mono, monospace`; ctx.textAlign = "center"; ctx.fillStyle = "rgba(251,243,230,.8)";
    for (const s of ISLANDS.slice(1)) ctx.fillText(s.name.toUpperCase(), s.x, s.z - s.r - 3);
    for (const [sx, sz, n] of QUADS) ctx.fillText(n.toUpperCase(), sx * 32, sz * 32 + (sz > 0 ? 14 : -12));
    ctx.fillText("LA OFRENDA", 0, 3); }
  ctx.translate(me.pos.x, me.pos.z); ctx.rotate(-me.face + Math.PI); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(0, -4 / Math.sqrt(scale) * 1.6); ctx.lineTo(2.6 / Math.sqrt(scale) * 1.4, 3 / Math.sqrt(scale) * 1.4); ctx.lineTo(-2.6 / Math.sqrt(scale) * 1.4, 3 / Math.sqrt(scale) * 1.4); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function toggleMap(force) { const on = force ?? !document.body.classList.contains("mapping"); document.body.classList.toggle("mapping", on); if (on && document.pointerLockElement) document.exitPointerLock(); }
$("#minimap").addEventListener("click", () => toggleMap(true)); big.addEventListener("click", () => toggleMap(false));
let mapT = 0;
function updateMaps(dt) {
  mapT += dt; if (mapT < 0.06) return; mapT = 0;
  drawMap(mctx, mini.width, mini.height, mini.width / 90, true, me.pos.x, me.pos.z, false);
  if (document.body.classList.contains("mapping")) { const W = big.width, H = big.height; drawMap(bctx, W, H, Math.min(W, H) / 330, false, 20, -5, true); }
}
function sizeMaps() { const dpr = Math.min(devicePixelRatio, 2); const r = mini.getBoundingClientRect(); mini.width = r.width * dpr; mini.height = r.height * dpr; big.width = innerWidth * dpr; big.height = innerHeight * dpr; }
addEventListener("resize", sizeMaps); setTimeout(sizeMaps, 100);

// ============================================================================ summon (optional: the only place you type)
function openSummon() { document.body.classList.add("summoning"); if (document.pointerLockElement) document.exitPointerLock(); setTimeout(() => $("#s-text").focus(), 250); }
function closeSummon() { document.body.classList.remove("summoning"); }
$("#s-close").onclick = closeSummon; $("#s-go").onclick = () => doSummon();
async function doSummon() {
  const memory = $("#s-text").value.trim(); if (memory.length < 10) { $("#s-status").textContent = "Describe someone and one memory (at least 10 characters)."; return; }
  $("#s-go").disabled = true; $("#s-go").textContent = "Writing…"; $("#s-status").textContent = "Gemma is creating a ghost. CPU generation may take a few minutes."; $("#s-raw").textContent = ""; let created = false;
  try {
    const r = await fetch(api("/api/summon"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory }), signal: AbortSignal.timeout(300000) });
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "The ofrenda stays quiet."); }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "", raw = "";
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k;
      while ((k = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, k); buf = buf.slice(k + 2);
        const ev = (block.match(/^event: (.*)$/m) || [])[1], data = JSON.parse((block.match(/^data: (.*)$/m) || [, "null"])[1]);
        if (ev === "token") { raw += data; $("#s-raw").textContent = raw.slice(Math.max(0, raw.indexOf("{"))); }
        else if (ev === "ghost") { created = true; const g = spawnGhost(data); closeSummon(); $("#s-text").value = ""; toast(`${data.name} is here, at the ofrenda. Written live by Gemma. Find them near the plaza.`, 5200); audio.rise(); burst(g.pos.clone().add(new V3(0, 1, 0)), new THREE.Color(1, 0.7, 0.3), 80, 7, 0.5); }
        else if (ev === "refused") throw new Error("Please describe a person and one memory about them. Summon creates a ghost; it is not a chat.");
        else if (ev === "error") throw new Error(data.message); } }
    if (!created) throw new Error("No ghost was received. Please try again when the keeper is ready.");
    $("#s-status").textContent = "Ghost created by Gemma.";
  } catch (e) { $("#s-status").textContent = e.name === "TimeoutError" ? "Gemma took too long. You can keep playing and try again later." : (e.message || String(e)); }
  finally { $("#s-go").disabled = false; $("#s-go").textContent = "Summon"; }
}

// ============================================================================ network (shared world)
const net = { online: false, model: "Gemma 4" };
function connect() {
  return new Promise((resolve) => {
    let done = false; let es; const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      es = new EventSource(api("/events"));
      es.addEventListener("hello", (e) => { const d = JSON.parse(e.data); net.online = true; net.model = d.model || net.model; $("#model").textContent = net.model;
        d.ghosts.forEach((g) => spawnGhost(g, false)); d.lanterns.forEach((l) => lanternFor(l)); stats.tonight = d.freedTonight || 0; updateCounts(); finish(); });
      es.addEventListener("full", (e) => { es.close(); const d = JSON.parse(e.data); toast(`${d.reason}. Playing solo for now.`, 6000); offline().then(finish); });
      es.addEventListener("ghost", (e) => { const d = JSON.parse(e.data); spawnGhost(d); updateCounts(); });
      es.addEventListener("letter", (e) => { const d = JSON.parse(e.data); const g = ghosts.get(d.id); if (g && !questFor(g)) g.data.letter = d.letter; });
      es.addEventListener("freed", (e) => { const d = JSON.parse(e.data); stats.tonight = d.freedTonight; const g = ghosts.get(d.id); if (g && g.state !== "rising") { if (questFor(g)) toast(`Someone else helped ${g.data.name} cross over.`); free(g, true); } updateCounts(); });
      if (!SOLO) es.addEventListener("players", (e) => {
        const seen = new Set();
        for (const [id, x, y, z, r, v, hue, item, dance, air, name, tag] of JSON.parse(e.data)) {
          if (id === me.id) { if (me.tag !== tag) { me.tag = tag; showMe(); } continue; } seen.add(id); let o = others.get(id);
          if (!o) { o = { c: makeCalaca(hue), pos: new V3(x, y, z), target: new V3(), face: r, label: playerLabel() }; others.set(id, o); }
          if (o.name !== name || o.tag !== tag) { o.name = name; o.tag = tag; drawTag(o.label, "", name, `#${String(tag).padStart(4, "0")}`, "player"); }
          o.target.set(x, y, z); o.tface = r; o.v = v; o.dance = !!dance; o.air = !!air; holdItem(o.c, item >= 0 ? ITEMS[item] : null);
        }
        for (const [id, o] of others) if (!seen.has(id) && !o.bot) { scene.remove(o.c.root); scene.remove(o.c.shadow); tagScene.remove(o.label); others.delete(id); }
        $("#c-players").textContent = others.size + 1;
      });
      es.onerror = () => { const wasOnline = net.online; net.online = false; $("model").textContent = "Gemma 4 · pre-written"; if (!wasOnline) { es.close(); offline().then(finish); } };
    } catch { offline().then(finish); }
    setTimeout(() => { if (!done) { es?.close(); offline().then(finish); } }, 6000);
  });
}
async function offline() {
  $("model").textContent = "Gemma 4 · pre-written";
  if (net.online || ghosts.size) return;
  let seed = window.__DEMO?.ghosts; if (!seed) try { seed = await (await fetch("/seed-ghosts.json")).json(); } catch { seed = []; }
  seed.slice(0, 14).forEach((g, i) => spawnGhost({ ...g, slot: i }, false));
  window.__offlinePool = seed.slice(14).map((g) => ({ ...g, letter: undefined })); updateCounts();
}
let lastSent = 0;
function sendMove(t) {
  if (SOLO) return;
  if (!net.online || t - lastSent < 0.12) return; lastSent = t;
  if (net.blockedUntil && t < net.blockedUntil) return; // backing off after a "full" answer
  fetch(api("/api/move"), { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ id: me.id, name: me.name || "Calaca", x: me.pos.x, y: me.pos.y, z: me.pos.z, r: Math.atan2(Math.sin(me.face), Math.cos(me.face)), v: me.speed, hue: me.hue, item: me.item ? ITEMS.indexOf(me.item) : -1, dance: me.dancing, air: !me.grounded }) })
    .then(async (r) => { if (r.status === 429) { const d = await r.json().catch(() => ({})); net.blockedUntil = t + 12; showBlocked(d.reason || "Mictlán is full tonight"); } else if (net.blocked) hideBlocked(); })
    .catch(() => {});
}
// you can still walk around and deliver mail while blocked: you just can't be seen by others until a place opens up
function showBlocked(reason) { net.blocked = true; $("#blocked b").textContent = reason; $("#blocked").classList.add("on"); $("#c-players").textContent = "–"; }
function hideBlocked() { net.blocked = false; $("#blocked").classList.remove("on"); toast("A place opened up. Others can see you again.", 3500); }
function updateOthers(t, dt) {
  for (const o of others.values()) {
    o.pos.lerp(o.target, 1 - Math.exp(-dt * 10)); let d = (o.tface ?? 0) - o.face; d = Math.atan2(Math.sin(d), Math.cos(d)); o.face += d * (1 - Math.exp(-dt * 10));
    if (o.bot) o.pos.copy(o.target);
    o.c.root.position.copy(o.pos); o.c.root.rotation.y = o.face; animateCalaca(o.c, dt, t, o.air ? 0 : o.v || 0, o.air, o.dance, !!o.c.heldName, false);
    if (o.c.wings.visible) { const open = o.air ? 1 : 0.02, flap = o.air ? (o.flapping ? Math.sin(t * 9 + o.pos.x) * 0.8 : 0.12 + Math.sin(t * 3) * 0.05) : 0.1;
      for (const [w, side] of [[o.c.wingL, -1], [o.c.wingR, 1]]) { w.rotation.y = lerp(w.rotation.y, side * (1 - open) * 1.42, 1 - Math.exp(-dt * 6)); w.rotation.z = lerp(w.rotation.z, side * -flap, 1 - Math.exp(-dt * 14)); }
      o.c.halo.rotation.z += dt;
      if (o.air && Math.random() < 0.35) burst(o.pos.clone().add(new V3(0, 1.3, 0)), new THREE.Color(1, 0.7, 0.3), 1, 0.4, 0.28); }
    const sg = groundAt(o.pos.x, o.pos.z, o.pos.y + 0.1); o.c.shadow.visible = sg > -Infinity; o.c.shadow.position.set(o.pos.x, sg + 0.03, o.pos.z);
    placeTag(o.label, o.pos, 2.75, o.pos.distanceTo(me.pos), 34, !talk.open);
  }
}
// ============================================================================ the other mail carriers (solo mode: friendly bots)
// In single-player the town still feels alive: a few calacas walk the streets doing their rounds, and one or
// two who already earned their wings fly over the rooftops. They never interact with you.
const BOT_NAMES = ["candlelight", "marigold_mia", "bonesy", "night_courier", "skelly", "ghostpepper", "lantern_lou", "sugarskull", "crowfeather", "moonpie", "wick",
  "hollow_hank", "tombstone_tim", "spooky_sam", "bramble", "ember", "pumpkin_pie", "midnight_mail", "boo_berry", "foggy", "willow", "copper_bell", "raven", "nightjar"];
const bots = [];
const botGraph = (() => { // walkable street nodes, linked when the straight line between them is clear
  const nodes = [], G = [0, 24, -24, 40, -40, 52, -52], clear = (a, b) => { const n = Math.max(1, Math.ceil(a.distanceTo(b))); for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n);
    if (groundAt(p.x, p.z, 1.5) < 0.5 || BOXES.some((q) => p.x > q.x0 - 0.7 && p.x < q.x1 + 0.7 && p.z > q.z0 - 0.7 && p.z < q.z1 + 0.7 && q.y1 > 1.6 && q.y0 < 3)) return false; } return true; };
  for (const x of G) for (const z of G) { const p = new V3(x, TOWN_H, z); if (Math.hypot(x, z) < 58 && Math.hypot(x, z) > 9 && clear(p, p)) nodes.push(p); }
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; nodes.push(new V3(Math.cos(a) * 17.5, TOWN_H, Math.sin(a) * 17.5)); }
  const isl = [[0, -63], [0, -92], [8, -104], [-8, -96], [0, 63], [0, 92], [0, 112], [0, 124], [-63, 0], [-95, 4], [-104, -6], [63, 0], [96, 4], [104, -4]].map(([x, z]) => new V3(x, Math.max(0.6, groundTop(x, z)), z));
  nodes.push(...isl);
  const edges = nodes.map(() => []);
  nodes.forEach((a, i) => nodes.forEach((b, j) => { if (i < j && a.distanceTo(b) < 26 && (isl.includes(a) || isl.includes(b) ? Math.abs(a.x - b.x) < 1 || Math.abs(a.z - b.z) < 1 || a.distanceTo(b) < 15 : clear(a, b))) { edges[i].push(j); edges[j].push(i); } }));
  return { nodes, edges };
})();
const SKY = () => [SPOT.tower.clone().setY(SPOT.tower.y + 4), SPOT.nube.clone().setY(SPOT.nube.y + 3), SPOT.campana.clone().setY(SPOT.campana.y + 5), new V3(0, 20, 0), SPOT.mirador.clone().setY(SPOT.mirador.y + 4),
  ...houses.slice(0, 12).map((h) => new V3(h.x, h.top + 7, h.z)), new V3(-60, 14, 40), new V3(60, 16, 40), new V3(0, 12, 80)];
const ROOFS = () => [SPOT.nube, SPOT.campana, SPOT.hilltop, SPOT.postRoof, SPOT.chapelRoof, ...houses.slice(0, 10).map((h) => new V3(h.x, h.top, h.z))];
function spawnBot(flyer) {
  const used = new Set(bots.map((b) => b.name)), name = BOT_NAMES.filter((n) => !used.has(n))[(Math.random() * 20) | 0] || "calaca" + ((Math.random() * 99) | 0);
  const hue = Math.random(), c = makeCalaca(hue), label = playerLabel();
  const n = (Math.random() * botGraph.nodes.length) | 0, start = flyer ? SKY()[(Math.random() * 5) | 0].clone() : botGraph.nodes[n].clone();
  const b = { id: "bot-" + name, name, tag: 100 + ((Math.random() * 880) | 0), flyer, node: n, at: start.clone(), goal: null, wait: Math.random() * 3, act: null, speed: flyer ? 8 + Math.random() * 3 : 4.5 + Math.random() * 2.5 };
  if (flyer) { c.wings.visible = true; c.halo.visible = Math.random() < 0.5; c.wings.scale.setScalar(1.1); }
  drawTag(label, "", name, `#${String(b.tag).padStart(4, "0")}`, "player");
  others.set(b.id, { c, pos: start.clone(), target: start.clone(), face: 0, tface: 0, v: 0, air: flyer, dance: false, label, bot: b });
  bots.push(b); updatePlayersCount();
}
function removeBot(b) { const o = others.get(b.id); if (!o) return; scene.remove(o.c.root); scene.remove(o.c.shadow); tagScene.remove(o.label); others.delete(b.id); bots.splice(bots.indexOf(b), 1); updatePlayersCount(); }
const updatePlayersCount = () => { $("#c-players").textContent = others.size + 1; };
function botBrain(b, o, dt, t) {
  if (b.wait > 0) { b.wait -= dt; o.v = 0; if (b.act === "talk") o.tface = Math.atan2(b.look.x - o.target.x, b.look.z - o.target.z); return; }
  if (b.act === "talk" && Math.random() < 0.45) holdItem(o.c, ITEMS[(Math.random() * ITEMS.length) | 0]); // "picked up an errand"
  else if (b.act && Math.random() < 0.3) holdItem(o.c, null);
  o.dance = false; b.act = null;
  if (!b.goal) {
    if (b.flyer) {
      if (o.air && Math.random() < 0.22) { const r = ROOFS()[(Math.random() * ROOFS().length) | 0]; b.goal = r.clone(); b.landing = true; }
      else { const s = SKY(); b.goal = s[(Math.random() * s.length) | 0].clone().add(new V3((Math.random() - 0.5) * 8, Math.random() * 4, (Math.random() - 0.5) * 8)); b.landing = false; }
    } else {
      const next = botGraph.edges[b.node]; if (!next.length) { b.node = (Math.random() * botGraph.nodes.length) | 0; b.at.copy(botGraph.nodes[b.node]); o.target.copy(b.at); return; }
      b.prev = b.node; let pick = next[(Math.random() * next.length) | 0]; if (pick === b.prev && next.length > 1) pick = next[(Math.random() * next.length) | 0];
      b.node = pick; b.goal = botGraph.nodes[pick].clone();
    }
  }
  const to = b.goal.clone().sub(b.at), d = to.length();
  if (b.flyer) {
    const sp = b.speed * dt; o.air = !(b.landing && d < 0.4);
    if (d < 0.5) { b.at.copy(b.goal); b.goal = null;
      if (b.landing) { o.air = false; b.wait = 4 + Math.random() * 6; b.act = Math.random() < 0.4 ? "dance" : "rest"; o.dance = b.act === "dance"; } return; }
    b.at.addScaledVector(to.normalize(), Math.min(sp, d)); if (!b.landing) b.at.y += Math.sin(t * 2 + b.tag) * dt * 0.8;
    o.tface = Math.atan2(to.x, to.z); o.v = b.speed; o.target.copy(b.at); o.flapping = to.y > 0.05 || Math.sin(t * 0.7 + b.tag) > 0.5;
    return;
  }
  if (d < 0.3) { b.at.copy(b.goal); b.goal = null;
    const r = Math.random();
    if (r < 0.25) { const g = [...ghosts.values()].filter((x) => x.state === "wander").sort((p, q) => p.home.distanceToSquared(b.at) - q.home.distanceToSquared(b.at))[0];
      if (g && g.home.distanceTo(b.at) < 30) { b.goal = g.home.clone().add(new V3(1.6, 0, 1.6)); b.goal.y = Math.max(0.6, groundAt(b.goal.x, b.goal.z, g.home.y + 1)); b.look = g.home; b.toGhost = true; return; } }
    else if (r < 0.35) { b.wait = 3 + Math.random() * 3; b.act = "dance"; o.dance = true; }
    else if (r < 0.55) { b.wait = 1 + Math.random() * 3; b.act = "rest"; }
    if (b.toGhost) { b.toGhost = false; b.wait = 5 + Math.random() * 5; b.act = "talk"; b.goal = botGraph.nodes[b.node].clone(); }
    return; }
  b.at.addScaledVector(to.normalize(), Math.min(b.speed * dt, d)); b.at.y = Math.max(0.6, groundAt(b.at.x, b.at.z, b.at.y + 0.6));
  o.tface = Math.atan2(to.x, to.z); o.v = b.speed; o.air = false; o.target.copy(b.at);
}
let botClock = 0;
function updateBots(dt, t) {
  if (!SOLO || !entered || Q.has("nobots")) return;
  botClock += dt;
  // they "join" one by one in the first minute, then every few minutes someone leaves and someone new arrives
  if (!updateBots.plan) updateBots.plan = { walkers: 3 + ((Math.random() * 2) | 0), flyers: 1 + ((Math.random() * 2) | 0), next: 4, churn: 180 + Math.random() * 120 };
  const P = updateBots.plan, w = bots.filter((b) => !b.flyer).length, f = bots.filter((b) => b.flyer).length;
  if (botClock > P.next && (w < P.walkers || f < P.flyers)) { spawnBot(f < P.flyers && (w >= P.walkers || Math.random() < 0.35)); P.next = botClock + 6 + Math.random() * 12; }
  if (botClock > P.churn && bots.length) { removeBot(bots[(Math.random() * bots.length) | 0]); P.churn = botClock + 150 + Math.random() * 180; P.next = botClock + 10 + Math.random() * 20; }
  for (const b of bots) { const o = others.get(b.id); if (o) botBrain(b, o, dt, t); }
}
function playerLabel() { return tagSprite(); }
function showMe() { $("#me-name").textContent = me.name || "Calaca"; $("#me-tag").textContent = me.tag ? `#${String(me.tag).padStart(4, "0")}` : (net.online ? "#····" : "solo"); }
$("#me").addEventListener("click", () => { const n = prompt("Your name in Mictlán (16 letters max):", me.name || ""); if (n === null) return; setName(n); });
function setName(n) { me.name = String(n).replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16); try { localStorage.setItem("animas-name", me.name); } catch {} showMe(); }
// offline: freed ghosts come back as new ones from the seed pool, like the server does
function offlineRefill() {
  if (net.online || !window.__offlinePool) return;
  for (let s = 0; s < 14; s++) if (![...ghosts.values()].some((g) => g.data.slot === s && g.state === "wander") && window.__offlinePool.length) {
    if ([...ghosts.values()].some((g) => g.data.slot === s)) continue;
    const d = window.__offlinePool.shift(); spawnGhost({ ...d, id: d.id + "-" + Date.now().toString(36), slot: s }); window.__offlinePool.push(d); updateCounts(); return;
  }
}
setInterval(offlineRefill, 9000);

// ============================================================================ main loop
const timer = new THREE.Timer(); timer.connect?.(document);
let frames = 0, fpsT = 0, slow = 0;
function tick() {
  timer.update(); const dt = window.__dt || Math.min(timer.getDelta(), 0.05), t = timer.getElapsed();
  U.uTime.value = t;
  if (entered) updatePlayer(dt);
  animateCalaca(hero, dt, t, me.grounded ? me.speed : 0, !me.grounded, me.dancing, !!me.item, talk.open);
  updateWings(dt, t);
  if (!hero.tag) hero.tag = tagSprite(); drawTag(hero.tag, "", me.name || "Calaca", me.tag ? `#${String(me.tag).padStart(4, "0")}` : "", "me"); placeTag(hero.tag, me.pos, 2.75, 0, 34, entered && !talk.open && !nearestGhost(7)); // step aside when a ghost's name is right there

  updateCamera(t, dt);
  updateGhosts(t, dt); updateItems(t, dt); updateSecrets(t); updateBots(dt, t); updateOthers(t, dt); updateTalk(dt); updateSparks(dt); updateLanterns(t);
  if (entered) { visitPlace(dt); updateMaps(dt); }
  petals.uniforms.uCam.value.copy(camera.position); moteMat.uniforms.uCam.value.copy(camera.position); updateWisps(t); monarchs.update(t, me.pos);
  flags.forEach((f) => { f.rotation.z = Math.sin(t * 1.6 + f.userData.seed) * 0.12; f.visible = f.position.distanceToSquared(camera.position) > 10; });
  if (entered) { updateHud(); sendMove(t); }
  composer.render();
  renderer.autoClear = false; renderer.clearDepth(); renderer.render(tagScene, camera); renderer.autoClear = true;
  frames++; fpsT += dt;
  if (fpsT > 2) { const fps = frames / fpsT; frames = 0; fpsT = 0; if (fps < 32 && renderer.getPixelRatio() > 0.8 && ++slow > 1) { renderer.setPixelRatio(renderer.getPixelRatio() * 0.8); onResize(); } }
  if (!window.__pause) requestAnimationFrame(tick);
}
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight); grade.uniforms.uRes.value.set(innerWidth, innerHeight);
  for (const m of [flameMat, petals, fxMat, wispMat, moteMat]) m.uniforms.uScale.value = innerHeight * 0.5;
  sizeMaps();
}
addEventListener("resize", onResize);

// ============================================================================ boot
(async function boot() {
  const pctEl = $("#pct"); let shown = 0, goal = 30, lastC = performance.now();
  const counter = setInterval(() => { const now = performance.now(), k = Math.max(1, (now - lastC) / 30); lastC = now; shown = Math.min(goal, Math.ceil(shown + k * (1 + (goal - shown) * 0.08))); pctEl.textContent = String(shown).padStart(3, "0"); }, 30);
  await document.fonts.ready; goal = 60;
  renderer.compile(scene, camera); requestAnimationFrame(tick); goal = 85;
  await connect(); goal = 100;
  await new Promise((r) => { const w = () => (shown >= 100 ? r() : setTimeout(w, 40)); w(); });
  clearInterval(counter); document.body.classList.add("ready");
  $("#loadmsg").textContent = net.online ? `${ghosts.size} ánimas are waiting tonight` : "static demo · ghosts written earlier by Gemma 4";
  $("#play").onclick = () => { $("#play").blur(); enter(); };
  $("#name").value = me.name; showMe();
  if (Q.has("enter")) enter();
})();
function enter() {
  if (entered || !document.body.classList.contains("ready")) return;
  const nf = $("#name"); if (nf) { setName(nf.value.trim() || me.name || "Calaca"); nf.blur(); }
  entered = true; introT = Q.has("enter") ? 1 : 0; document.body.classList.add("entered");
  audio.toggle(true); audio.chime(0.1, 523.25);
  $("#brand").appendChild($("#wings")); showWingsQuiet(); updateWingHud(); if (SOLO) document.body.classList.add("solo");
  setTimeout(() => document.body.classList.add("hinted"), 12000);
  setTimeout(() => { $("#howto").classList.add("on"); document.body.classList.add("tips"); setTimeout(() => { $("#howto").classList.remove("on"); document.body.classList.remove("tips"); let pref = null; try { pref = localStorage.getItem("animas-help"); } catch {} if (pref !== "0") toggleHelp(true); }, 9000); }, Q.has("enter") ? 0 : 2400);
}
window.__animas = { AUTO, physics: (dt) => updatePlayer(dt), BRIDGES, keys, jump, CASAS, updateQuestHud, camera, bots, others, botGraph, spawnBot, prog, wingTier, grantWings, quests, secrets, SPOT, BOXES, placeName, groundAt, toggleMap, skipIntro: () => { introT = 1; }, me, hero, ghosts, items, quest, talk, cam, keys, frame: () => { window.__pause = true; tick(); }, resume: () => { window.__pause = false; requestAnimationFrame(tick); }, openTalk, choose, interact, jump, free, stats };
