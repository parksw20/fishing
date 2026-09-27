/*
  Water renderer for the fishing game.
  Derived from Clearwater — real-time, photoreal shallow-water rendering (WebGL2, no dependencies)
  https://github.com/Aureliengmz/clearwater — MIT License, Copyright (c) 2026 Lumaris (see LICENSE-clearwater).
  FFT ocean spectrum, refracted light caustics with dispersion, physically based Fresnel and sun glints,
  lens-diffraction glare by FFT convolution, interactive ripples.
  Additions: ray-traced underwater fish / lure / float / hull / line inside the water shader,
  depth output so the rasterised boat, rod and float composite correctly with the water.
*/
window.Renderer = (function(){
"use strict";
const $err = document.getElementById('err');
function fail(msg){ $err.hidden=false; $err.textContent += (typeof msg==='string'?msg:(msg&&msg.stack)||String(msg)) + '\n'; }
window.addEventListener('error', e => fail(e.message + (e.filename? `\n  @ ${e.filename.split('/').pop()}:${e.lineno}`:'')));

const Q = new URLSearchParams(location.search);
const FIXED_T = Q.has('t') ? parseFloat(Q.get('t')) : null;
let DEBUG = Q.has('debug');
// player settings (menu → 환경설정), saved by the game; URL parameters still win
const CFG = (() => { try { return JSON.parse(localStorage.getItem('boatfish.cfg') || '{}') || {}; } catch(e){ return {}; } })();
const GFX = CFG.gfx || 'auto';   // auto | low | mid | high

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, depth:false, stencil:false, powerPreference:'high-performance', preserveDrawingBuffer: FIXED_T!==null });
if (!gl) { fail("WebGL2 is not available in this browser."); throw 0; }
const extF32 = gl.getExtension('EXT_color_buffer_float');
const extF16 = gl.getExtension('EXT_color_buffer_half_float');
const extAniso = gl.getExtension('EXT_texture_filter_anisotropic');
if (!extF32 && !extF16) { fail("This GPU cannot render to floating-point textures (EXT_color_buffer_float / EXT_color_buffer_half_float missing)."); throw 0; }
const FFT_FMT = extF32 ? gl.RGBA32F : gl.RGBA16F;

/* ---------------- GL helpers ---------------- */
function sh(type, src, name){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l,i)=>`${String(i+1).padStart(3)}  ${l}`);
    const m = /ERROR: \d+:(\d+)/.exec(log); const ln = m? +m[1] : 0;
    fail(`Shader "${name}":\n${log}\n` + (ln? lines.slice(Math.max(0,ln-4), ln+2).join('\n') : ''));
    throw new Error('shader '+name);
  }
  return s;
}
function prog(vs, fs, name){
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs, name+'.vs'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs, name+'.fs'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { fail(`Link "${name}": ${gl.getProgramInfoLog(p)}`); throw 0; }
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i=0;i<n;i++){ const info = gl.getActiveUniform(p,i); u[info.name.replace(/\[0\]$/,'')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
function tex(w, h, fmt, { filter=gl.LINEAR, wrap=gl.CLAMP_TO_EDGE, mip=false, aniso=0 } = {}){
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  const levels = mip ? Math.floor(Math.log2(Math.max(w,h)))+1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (aniso && extAniso) gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(aniso, gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return t;
}
function rt(w, h, fmt, opts){
  const t = tex(w,h,fmt,opts); const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) fail('Incomplete framebuffer ('+st+') '+w+'x'+h);
  return { t, fb, w, h };
}
function bindT(unit, t){ gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D, t); }
function target(r){ gl.bindFramebuffer(gl.FRAMEBUFFER, r? r.fb : null); gl.viewport(0,0, r? r.w : canvas.width, r? r.h : canvas.height); }

const triVAO = gl.createVertexArray(); gl.bindVertexArray(triVAO);
{ const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); }
function fullscreen(){ gl.bindVertexArray(triVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }

const VS = `#version 300 es
layout(location=0) in vec2 p; out vec2 vUv;
void main(){ vUv = p*.5+.5; gl_Position = vec4(p,0.,1.); }`;
const HEAD = `#version 300 es
precision highp float; precision highp sampler2D; precision highp int;
in vec2 vUv; out vec4 o;
`;

/* ---------------- Ocean spectrum (FFT) ---------------- */
const N = 256, LOGN = 8;
const L = 4.6;               // patch size (m)
const DEPTH = 2.4;          // mean depth (m): caustics focus plane
const TARGET_SLOPE = 0.078;  // RMS slope

function mulberry(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const rnd = mulberry(7);
function gauss(){ let u=0,v=0; while(!u) u=rnd(); v=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

function buildH0(){
  const kp = 2*Math.PI/0.62, kcut = 2*Math.PI/0.045;
  const wd = [0.8, 0.6];
  const re = new Float32Array(N*N), im = new Float32Array(N*N);
  let s2 = 0;
  for (let m=0;m<N;m++) for (let n=0;n<N;n++){
    const nx = n<N/2? n : n-N, nz = m<N/2? m : m-N;
    const kx = 2*Math.PI*nx/L, kz = 2*Math.PI*nz/L, k = Math.hypot(kx,kz);
    let P = 0;
    if (k>1e-6){
      const lk = Math.log(k/kp);
      const bump = Math.exp(-0.5*(lk/0.36)**2);
      const tail = 0.035*Math.exp(-((kp/k)**2))*Math.exp(-((k/kcut)**2));
      const swell = 0.35*Math.exp(-0.5*(Math.log(k/(2*Math.PI/1.6))/0.3)**2);
      const c = (kx*wd[0]+kz*wd[1])/k;
      const spread = (0.3 + 0.7*c*c) * (c<0? 0.35 : 1);
      P = (bump + tail + swell) * spread / (k*k*k*k);
    }
    const a = Math.sqrt(P/2);
    const i = m*N+n; re[i] = gauss()*a; im[i] = gauss()*a;
    s2 += 2*k*k*(re[i]*re[i]+im[i]*im[i]);
  }
  const sc = TARGET_SLOPE/Math.sqrt(s2);
  const data = new Float32Array(N*N*4);
  for (let m=0;m<N;m++) for (let n=0;n<N;n++){
    const i=m*N+n, j=((N-m)%N)*N + ((N-n)%N);
    data[i*4]=re[i]*sc; data[i*4+1]=im[i]*sc; data[i*4+2]=re[j]*sc; data[i*4+3]=-im[j]*sc;
  }
  const t = tex(N,N,gl.RGBA32F,{filter:gl.NEAREST, wrap:gl.REPEAT});
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,N,N,gl.RGBA,gl.FLOAT,data);
  return t;
}
const h0Tex = buildH0();
const fftA = rt(N,N,FFT_FMT,{filter:gl.NEAREST, wrap:gl.REPEAT});
const fftB = rt(N,N,FFT_FMT,{filter:gl.NEAREST, wrap:gl.REPEAT});
const surfRT = rt(N,N,gl.RGBA16F,{wrap:gl.REPEAT, mip:true, aniso:8});

const pSpec = prog(VS, HEAD+`
uniform sampler2D uH0; uniform float uT, uL;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
void main(){
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uH0, id, 0);
  vec2 n = vec2(id); n -= step(${N/2}.0, n) * ${N}.0;
  vec2 k = 6.28318530718*n/uL; float kl = length(k);
  float w = sqrt(9.81*kl + 7.4e-5*kl*kl*kl);
  // gentle dispersion quantisation keeps the loop seamless over 60 s
  float w0 = 6.28318530718/60.0; w = floor(w/w0)*w0;
  float c = cos(w*uT), sn = sin(w*uT);
  vec2 H = cmul(s.xy, vec2(c,sn)) + cmul(s.zw, vec2(c,-sn));
  vec2 C1 = H - k.x*H;                    // h + i*dh/dx
  vec2 C2 = vec2(-k.y*H.y, k.y*H.x);      // dh/dz
  o = vec4(C1, C2);
}`, 'spectrum');

const pFFT = prog(VS, HEAD+`
uniform sampler2D uSrc; uniform int uP, uHoriz;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
void main(){
  ivec2 id = ivec2(gl_FragCoord.xy);
  int j = uHoriz==1 ? id.x : id.y;
  int k = j & (uP-1);
  int i = ((j - (j & (2*uP-1))) >> 1) + k;
  bool y1 = (j & uP) != 0;
  ivec2 a = uHoriz==1 ? ivec2(i, id.y) : ivec2(id.x, i);
  ivec2 b = uHoriz==1 ? ivec2(i+${N/2}, id.y) : ivec2(id.x, i+${N/2});
  vec4 x0 = texelFetch(uSrc, a, 0), x1 = texelFetch(uSrc, b, 0);
  float ang = 3.14159265359*float(k)/float(uP);
  vec2 w = vec2(cos(ang), sin(ang));
  vec4 wx = vec4(cmul(w,x1.xy), cmul(w,x1.zw));
  o = y1 ? x0-wx : x0+wx;
}`, 'fft');

const pResolve = prog(VS, HEAD+`
uniform sampler2D uSrc;
void main(){
  vec4 s = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  vec2 sl = vec2(s.y, s.z);
  o = vec4(s.x, sl, dot(sl,sl));
}`, 'resolve');

function runFFT(t){
  gl.disable(gl.BLEND);
  target(fftA); gl.useProgram(pSpec.p); bindT(0,h0Tex); gl.uniform1i(pSpec.u.uH0,0); gl.uniform1f(pSpec.u.uT,t); gl.uniform1f(pSpec.u.uL,L); fullscreen();
  gl.useProgram(pFFT.p); gl.uniform1i(pFFT.u.uSrc,0);
  let src=fftA, dst=fftB;
  for (let horiz=1; horiz>=0; horiz--) for (let s=0;s<LOGN;s++){
    target(dst); bindT(0,src.t); gl.uniform1i(pFFT.u.uP, 1<<s); gl.uniform1i(pFFT.u.uHoriz, horiz); fullscreen();
    [src,dst]=[dst,src];
  }
  target(surfRT); gl.useProgram(pResolve.p); bindT(0,src.t); gl.uniform1i(pResolve.u.uSrc,0); fullscreen();
  gl.bindTexture(gl.TEXTURE_2D, surfRT.t); gl.generateMipmap(gl.TEXTURE_2D);
}

/* ---------------- Interactive ripples (wave equation) ---------------- */
const RN = 256, RSIZE = 7.0;   // local simulation, metres
const rip = [0,1].map(()=>rt(RN,RN,gl.RGBA16F,{wrap:gl.CLAMP_TO_EDGE}));
let ripIdx = 0, ripCenter = [0,0];
const pRipple = prog(VS, HEAD+`
uniform sampler2D uSrc; uniform vec2 uShift; uniform vec4 uDrop; // xy uv, z radius(uv), w strength
void main(){
  vec2 px = 1.0/vec2(textureSize(uSrc,0));
  vec2 uv = vUv + uShift;
  vec4 c = texture(uSrc, uv);
  float avg = 0.25*(texture(uSrc, uv+vec2(px.x,0)).r + texture(uSrc, uv-vec2(px.x,0)).r + texture(uSrc, uv+vec2(0,px.y)).r + texture(uSrc, uv-vec2(0,px.y)).r);
  float v = c.g + (avg - c.r)*0.9;
  v *= 0.9955;
  float h = c.r + v;
  h *= 0.9985;
  if (uDrop.w != 0.0){ float d = length((vUv - uDrop.xy)); float r = uDrop.z; if (d < r){ float f = 0.5+0.5*cos(3.14159*d/r); h -= uDrop.w*f; } }
  // fade out near borders so the local field blends into open water
  vec2 e = min(vUv, 1.0-vUv); float edge = smoothstep(0.0, 0.06, min(e.x,e.y));
  h *= mix(0.9, 1.0, edge); v *= mix(0.9, 1.0, edge);
  if (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) { h=0.; v=0.; }
  o = vec4(h, v, 0, 1);
}`, 'ripple');
const pRipN = prog(VS, HEAD+`
uniform sampler2D uSrc; uniform float uTexel;  // metres per texel
void main(){
  vec2 px = 1.0/vec2(textureSize(uSrc,0));
  float hx = texture(uSrc, vUv+vec2(px.x,0)).r - texture(uSrc, vUv-vec2(px.x,0)).r;
  float hz = texture(uSrc, vUv+vec2(0,px.y)).r - texture(uSrc, vUv-vec2(0,px.y)).r;
  float h = texture(uSrc,vUv).r;
  float lap = (texture(uSrc, vUv+vec2(px.x,0)).r + texture(uSrc, vUv-vec2(px.x,0)).r + texture(uSrc, vUv+vec2(0,px.y)).r + texture(uSrc, vUv-vec2(0,px.y)).r - 4.0*h)/(uTexel*uTexel);
  o = vec4(h, hx/(2.0*uTexel), hz/(2.0*uTexel), lap);
}`, 'rippleNormals');
const ripN = rt(RN,RN,gl.RGBA16F,{wrap:gl.CLAMP_TO_EDGE});
gl.bindFramebuffer(gl.FRAMEBUFFER, rip[0].fb); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
gl.bindFramebuffer(gl.FRAMEBUFFER, rip[1].fb); gl.clear(gl.COLOR_BUFFER_BIT);
gl.bindFramebuffer(gl.FRAMEBUFFER, ripN.fb); gl.clear(gl.COLOR_BUFFER_BIT);
const drops = [];
let ripActive = 0; // frames since last disturbance, to skip work when calm

function stepRipples(shiftUV){
  gl.disable(gl.BLEND); gl.useProgram(pRipple.p); gl.uniform1i(pRipple.u.uSrc,0);
  for (let s=0;s<1;s++){
    const src = rip[ripIdx], dst = rip[1-ripIdx];
    target(dst); bindT(0, src.t);
    gl.uniform2f(pRipple.u.uShift, s===0? shiftUV[0]:0, s===0? shiftUV[1]:0);
    const d = drops.shift();
    gl.uniform4f(pRipple.u.uDrop, d? d[0]:0, d? d[1]:0, d? d[2]:0, d? d[3]:0);
    fullscreen(); ripIdx = 1-ripIdx;
  }
  target(ripN); gl.useProgram(pRipN.p); bindT(0, rip[ripIdx].t); gl.uniform1i(pRipN.u.uSrc,0); gl.uniform1f(pRipN.u.uTexel, RSIZE/RN); fullscreen();
}

/* ---------------- Caustics ---------------- */
// phones and tablets default to the lighter caustics / no glare path (?full forces the desktop quality)
const LITE = Q.has('lite') || GFX === 'low' || (!Q.has('full') && GFX === 'auto' && matchMedia('(pointer: coarse)').matches);
const G = LITE ? 96 : 256, C = LITE ? 512 : 1024;
const causRT = rt(C,C,gl.RGBA16F,{wrap:gl.REPEAT, mip:true, aniso:8});
const gridVAO = gl.createVertexArray(); gl.bindVertexArray(gridVAO);
{
  const v = new Float32Array((G+1)*(G+1)*2); let o=0;
  for (let j=0;j<=G;j++) for (let i=0;i<=G;i++){ v[o++]=i/G; v[o++]=j/G; }
  const idx = new Uint32Array(G*G*6); o=0;
  for (let j=0;j<G;j++) for (let i=0;i<G;i++){ const a=j*(G+1)+i, b=a+1, c=a+G+1, d=c+1; idx[o++]=a; idx[o++]=b; idx[o++]=c; idx[o++]=b; idx[o++]=d; idx[o++]=c; }
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
}
gl.bindVertexArray(null);
const pCaus = prog(`#version 300 es
precision highp float; precision highp sampler2D;
layout(location=0) in vec2 aUV;
uniform sampler2D uSurf; uniform float uL, uDepth, uIor; uniform vec3 uSun; uniform vec2 uShift;
out vec2 vSrc;
void main(){
  ivec2 off = ivec2(gl_InstanceID % 3 - 1, gl_InstanceID / 3 - 1);
  vec4 s = textureLod(uSurf, aUV, 0.0);
  vec3 n = normalize(vec3(-s.y, 1.0, -s.z));
  vec3 r = refract(-uSun, n, 1.0/uIor);
  vec3 P = vec3(aUV.x*uL, s.x, aUV.y*uL);
  vec3 F = P + r*((-uDepth - s.x)/r.y);
  vSrc = aUV*uL;
  vec2 c = (F.xz - uShift)/uL + vec2(off);
  gl_Position = vec4(c*2.0-1.0, 0.0, 1.0);
}`, `#version 300 es
precision highp float;
in vec2 vSrc; out vec4 o; uniform float uNorm;
void main(){
  vec2 a = dFdx(vSrc), b = dFdy(vSrc);
  float area = abs(a.x*b.y - a.y*b.x);
  float I = min(area*uNorm, 40.0);
  o = vec4(I);
}`, 'caustics');

const IORS = [1.3315, 1.3335, 1.3365];
let causShift = [0,0];
function renderCaustics(sun){
  target(causRT); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(pCaus.p); bindT(0, surfRT.t); gl.uniform1i(pCaus.u.uSurf,0);
  gl.uniform1f(pCaus.u.uL, L); gl.uniform1f(pCaus.u.uDepth, DEPTH); gl.uniform3fv(pCaus.u.uSun, sun);
  gl.uniform1f(pCaus.u.uNorm, (C/L)*(C/L));
  // flat-surface refraction shift (green) keeps the pattern registered; per-channel residual = dispersion fringes
  const sy = sun[1], sinI = Math.sqrt(1-sy*sy), sinT = sinI/IORS[1], cosT = Math.sqrt(1-sinT*sinT);
  const hd = Math.hypot(sun[0],sun[2]) || 1, tanT = sinT/cosT;
  causShift = [-sun[0]/hd*DEPTH*tanT, -sun[2]/hd*DEPTH*tanT];
  gl.uniform2fv(pCaus.u.uShift, causShift);
  gl.bindVertexArray(gridVAO);
  const masks = [[1,0,0,0],[0,1,0,0],[0,0,1,0]];
  for (let c=0;c<3;c++){ gl.colorMask(...masks[c]); gl.uniform1f(pCaus.u.uIor, IORS[c]); gl.drawElementsInstanced(gl.TRIANGLES, G*G*6, gl.UNSIGNED_INT, 0, 9); }
  gl.colorMask(true,true,true,true); gl.disable(gl.BLEND);
  gl.bindTexture(gl.TEXTURE_2D, causRT.t); gl.generateMipmap(gl.TEXTURE_2D);
}

/* ---------------- Pebbles ---------------- */
const pebTex = tex(1024, 1024, gl.SRGB8_ALPHA8, { wrap:gl.REPEAT, mip:true, aniso:16 });
let pebReady = false;
{ const img = new Image(); img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, pebTex); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,img); gl.generateMipmap(gl.TEXTURE_2D); pebReady = true; };
  img.onerror = () => fail('Could not decode the pebble texture.');
  // the texture is embedded as base64 in js/pebbles.js (works from file:// without CORS issues)
  img.src = 'data:image/jpeg;base64,' + window.PEBBLES_B64; }

/* ---------------- Fish photo atlas ---------------- */
// colour (sRGB) + body thickness; until both have loaded (or if they can't, e.g. from file://) fish are drawn procedurally
const FA = window.FISH_ATLAS || { w:1, h:1, sp:{} };
const fishCTex = tex(FA.w, FA.h, gl.SRGB8_ALPHA8, { mip:true, aniso:4 }), fishTTex = tex(FA.w, FA.h, gl.R8, { mip:true });
let fishAtlasN = 0;
function loadAtlas(src, t, fmt){
  const img = new Image();
  img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    try { gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FA.w, FA.h, fmt, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D); fishAtlasN++; } catch (e) {}
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); };
  img.src = src;
}
if (window.FISH_ATLAS){ loadAtlas('img/fish/atlas.jpg', fishCTex, gl.RGBA); loadAtlas('img/fish/atlas_t.png', fishTTex, gl.RED); }

/* ---------------- Main water shader (+ underwater scene: fish, lure, float, hull, line) ---------------- */
// Everything below the surface is ray-traced along the refracted view ray, so fish get the same
// refraction, absorption, in-scatter and caustic light as the seabed.
// Water column seen from below (after Tidewater's Underwater pass): light at depth z is E·exp(-σt·z/μ); integrating the
// sun and sky in-scatter along a view ray through that gradient has a closed form, so the water darkens and turns
// bluer with depth and toward the bottom on its own. Henyey-Greenstein forward peak toward the sun plus a
// multiple-scattering term. Shared by the traced underwater view and the rasterised objects.
const UW_GLSL = `
#define UW_GAIN 2.2
vec3 uwLit(float m, vec3 sT, float zc, float dy, float dist){
  vec3 a = sT*zc/m, k = sT*(1.0 - dy/m);
  vec3 e0 = exp(-a), e1 = exp(-max(a + k*dist, 0.0));
  vec3 ks = sign(k)*max(abs(k), vec3(1e-4));
  return mix((e0 - e1)/ks, e0*dist, step(abs(k), vec3(1e-4)));
}
vec3 uwScatter(vec3 sA, vec3 sS, vec3 sunE, vec3 skyE, vec3 Ls, float zc, vec3 rd, float dist){
  vec3 sT = sA + sS;
  float mu = max(Ls.y, 0.15), c = dot(rd, Ls), g = 0.85;
  float ph = (1.0 - g*g)/(12.566371*pow(1.0 + g*g - 2.0*g*c, 1.5))*0.75 + 0.25/12.566371;
  vec3 bb = sS*0.035, ms = bb*1.3/(sA + bb);
  vec3 inSun = sunE*(sS*ph + ms*sT/3.14159)*uwLit(mu, sT, zc, rd.y, dist);
  vec3 inAmb = skyE*0.9*(sS/12.566371 + ms*sT/3.14159)*uwLit(0.8, sT, zc, rd.y, dist);
  return (inSun + inAmb)*UW_GAIN;
}
`;
// the same for rasterised meshes (decor, boat, rod) when the camera is below the surface
const UWR_GLSL = `
uniform vec4 uUW;                                   // w: camera under water
uniform vec3 uUWsA, uUWsS, uUWsun, uUWsky, uUWls;  // absorption, scattering (with murk), sun and sky light, direction toward the sun below the surface
` + UW_GLSL + `
vec3 uwFog(vec3 col, vec3 P, vec3 cam){
  vec3 d = P - cam; float dist = max(length(d), 1e-3); vec3 rd = d/dist;
  return col*exp(-(uUWsA + uUWsS)*dist) + uwScatter(uUWsA, uUWsS, uUWsun, uUWsky, uUWls, max(-cam.y, 0.0), rd, dist);
}
`;
const MAXF = 12;
const ZNEAR = 0.05, ZFAR = 5000.0;
const ZA = (ZFAR+ZNEAR)/(ZFAR-ZNEAR), ZB = -2*ZFAR*ZNEAR/(ZFAR-ZNEAR);
const pMain = prog(VS, HEAD+`
#define MAXF ${MAXF}
uniform sampler2D uSurf, uCaus, uPeb, uRip, uCloud;
uniform vec3 uCam, uR, uU, uF, uSun;
uniform float uTanF, uAspect, uL, uDepth, uTime, uRipSize, uPixAng;
uniform vec2 uCausShift, uRipCenter;
uniform int uFishN;
uniform vec4 uFP[MAXF];   // fish: centre xyz, length
uniform vec4 uFD[MAXF];   // fish: forward xyz, tail angle
uniform vec4 uFA[MAXF];   // fish: back colour, pattern id
uniform vec4 uFB[MAXF];   // fish: belly colour, body height ratio
uniform vec4 uFC[MAXF];   // fish shape: width/length, tail mode (0 fin, 1 fluke, 2 none, 3 sunfish), dorsal scale, tail scale
uniform vec4 uFE[MAXF];   // photo fish: atlas rect u0 v0 u1 v1 (head to the right)
uniform vec4 uFG[MAXF];   // photo fish: height/length (0 = drawn procedurally, < 0 = flatfish lying on its side), tail phase, tail amplitude, bend into the turn
uniform sampler2D uFishC, uFishT;   // photo atlas: colour, body thickness
uniform vec3 uSunC, uSkyK; uniform float uNight;   // time of day: sun (or moon) radiance, sky tint, night amount
uniform vec4 uLP[4]; uniform vec3 uLC[4];   // boat lamps at night
uniform float uWaveK;    // wave strength (debug: calm 0.45 / normal 1 / rough 1.8 / very rough 2.8 / storm 4)
uniform vec4 uWeather;   // cloud cover, fog, rain, wind (0..1)
#define WAKEN 20
uniform vec4 uWake[WAKEN]; uniform int uWakeN;       // boat track, newest first: xz, strength (speed and age)
uniform vec4 uLure;       // lure/bait centre xyz, visible
uniform vec4 uLureD;      // lure forward xyz, kind
uniform vec3 uLureS;      // lure semi-axes
uniform vec4 uLureC;      // lure colour, metallic
uniform vec4 uBob;        // float body centre xyz; w = 1 + tilt when shown (0 = hidden)
uniform vec4 uLnA, uLnB;  // underwater line segment (w of A = visible)
uniform vec4 uBoat;       // hull centre xyz, heading

const float IOR = 1.3335;
uniform vec3 uSigA, uSigS;   // per-region water: absorption / scattering (1/m)
uniform vec4 uDepthP, uDepthQ; // depth profile: base, amp, min, max | scale, seed x, seed z, depth at the start anchor
uniform vec4 uDepthS;         // bed shape (0 = water-type profile; then uDepthP = min, max), drop-off / river direction xz
uniform vec4 uBed;             // seabed: sand fraction, tint rgb
uniform float uLand;           // distant shoreline height (0 = open sea)
uniform float uHor[32], uHorD[32];   // horizon: land elevation angle (rad) and distance (km) per direction, from the world map
uniform float uSnow;                 // snow on high cold peaks
float horizonAt(float a, out float dkm){
  float x = (a + 3.14159265)/6.2831853*32.0; int i = int(floor(x)); float f = fract(x);
  i = (i % 32 + 32) % 32; int j = (i + 1) % 32;
  dkm = mix(uHorD[i], uHorD[j], f);
  return mix(uHor[i], uHor[j], f*f*(3.0 - 2.0*f));
}
#define SIG_A uSigA
#define SIG_S uSigS
#define SIG_T (uSigA + uSigS)
#define SUN uSunC
const float PI = 3.14159265359;
uniform vec3 uHullR;       // traced hull ellipsoid radii (half-length, draft, half-width) of the current boat
#define HULL uHullR

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }

float ridge(float a){ // periodic headland silhouette, elevation in radians (~1.5-4 deg)
  return 0.040 + 0.016*sin(a*2.0+0.7) + 0.011*sin(a*5.0+2.1) + 0.006*sin(a*11.0+0.3) + 0.003*sin(a*23.0+1.7);
}
float fbm2(vec2 p){ float v=0., a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p=p*2.03+17.1; a*=0.5; } return v; }
// ridged multi-octave profile: separate peaks and saddles for real mountain ranges
// noise around the horizon circle, so it wraps seamlessly all the way round
vec2 ring(float a, float f){ return vec2(cos(a), sin(a))*f; }
float mountains(float a){
  float n = 0.0, amp = 0.55, f = 4.0;
  for (int i = 0; i < 5; i++){ float v = vnoise(ring(a, f) + float(i)*13.7); n += amp*(1.0 - abs(2.0*v - 1.0)); f *= 2.3; amp *= 0.5; }
  return n;
}
float gLand = 0.0;   // set by sky(): how much distant land covers this direction (hides the sun disk behind it)
float gCloud = 0.0;  // set by sky(): cloud cover in this direction (dims the sun disk)
vec3 sky(vec3 d, float soft){
  gLand = 0.0; gCloud = 0.0;
  float e = d.y;
  float mu = dot(d, uSun);
  vec3 zen = vec3(0.11, 0.27, 0.62), hor = vec3(0.66, 0.78, 0.90);
  // low sun (after Tidewater's atmosphere): a deeper zenith, the horizon glowing orange toward the sun and a pink
  // band (belt of Venus) on the opposite side
  float low = 1.0 - smoothstep(0.02, 0.4, uSun.y), sunA = max(dot(normalize(d.xz + 1e-5), normalize(uSun.xz + 1e-5)), -1.0);
  zen = mix(zen, vec3(0.06, 0.14, 0.40), low*0.6);
  float band = pow(1.0 - clamp(e, 0.0, 1.0), 5.0);
  hor = mix(hor, mix(vec3(0.80, 0.62, 0.72), vec3(1.15, 0.62, 0.30), smoothstep(-0.6, 0.9, sunA)), low*band*0.85);
  vec3 c = mix(hor, zen, pow(clamp(e,0.,1.), 0.42));
  c += vec3(1.0, 0.86, 0.66) * (0.22*pow(max(mu,0.),6.) + 0.30*pow(max(mu,0.),64.) + 1.6*pow(max(mu,0.),2400.));
  c += vec3(1.0, 0.55, 0.25)*low*0.55*pow(max(mu, 0.0), 4.0)*band;
  // clouds: a drifting layer projected on a plane ~2 km up (tileable noise texture, two scales), lit toward the sun
  // with a bright silver lining around it; coverage follows the weather. Reflections take one tap only.
  if (e > 0.0){
    vec2 cp = d.xz/(e + 0.06)*0.30 + uTime*vec2(0.0045, 0.0018);
    float cov = mix(0.22, 0.95, uWeather.x);
    float n = texture(uCloud, cp*0.22).r;
    if (soft == 0.0) n = n*0.7 + texture(uCloud, cp*0.85 + 0.37).g*0.3;
    float den = smoothstep(1.0 - cov, 1.0 - cov + 0.3, n);
    if (den > 0.0){
      float shade = 1.0;
      if (soft == 0.0){ float ns = texture(uCloud, (cp + uSun.xz*0.05)*0.22).r; shade = clamp(1.0 - (ns - n)*4.0, 0.45, 1.15); }
      vec3 cc = mix(vec3(0.50, 0.55, 0.63), vec3(1.02, 0.99, 0.95), shade*(0.55 + 0.45*clamp(uSun.y*3.0, 0.0, 1.0)));
      cc += vec3(1.0, 0.88, 0.7)*1.4*pow(max(mu, 0.0), 10.0)*(1.0 - den*0.8);      // silver lining toward the sun
      cc = mix(cc, cc*vec3(1.25, 0.72, 0.52), low*0.75);                           // sunset undersides
      float fade = smoothstep(0.0, 0.10, e);
      gCloud = den*fade;
      c = mix(c, cc, gCloud*0.96);
    }
  }
  // distant headland: pine canopy over pale limestone, softened by ~2 km of air
  float a = atan(d.z, d.x);
  float dkm; float base = uLand*horizonAt(a, dkm);
  float rough = min(1.0, base/0.03), tall = smoothstep(0.015, 0.06, base);
  float hills = base*(0.62 + 0.38*ridge(a)/0.04) + rough*(0.0045*(vnoise(ring(a, 260.0))-0.5) + 0.002*(vnoise(ring(a, 900.0) + 3.0)-0.5));
  float r = mix(hills, base*(0.3 + 0.85*mountains(a)), tall)
          + min(base, 0.004)*0.5*(vnoise(ring(a, 1400.0) + 7.0) - 0.3);   // tree line on low shores
  float back = smoothstep(-0.3, 0.95, dot(normalize(vec2(d.x,d.z)+1e-5), normalize(vec2(uSun.x,uSun.z))));
  float u = clamp(e / max(r, 1e-3), 0.0, 1.0);
  vec2 q = ring(a, 420.0) + vec2(0.0, e*420.0);
  float tex = fbm2(q);
  vec3 pine = vec3(0.045, 0.070, 0.042) * (0.6 + 0.8*tex);
  vec3 rock = vec3(0.30, 0.28, 0.23) * (0.55 + 0.7*fbm2(q*1.7+5.0));
  // low shores: pale limestone at the waterline; mountains: bare rock on the steep upper slopes
  float cliffLow = smoothstep(0.42, 0.18, u + 0.25*(tex-0.5)) * smoothstep(0.35, 0.75, vnoise(ring(a, 18.0) + 1.0));
  float cliffHigh = smoothstep(0.52, 0.72, fbm2(ring(a, 55.0) + vec2(e*120.0, 3.0))) * smoothstep(0.25, 0.6, u);
  float cliff = mix(cliffLow, cliffHigh, tall);
  vec3 land = mix(pine, rock, cliff);
  // detail, only where land is actually seen straight on (not in the blurred water reflections, so the water
  // pixels pay nothing): sun-facing vs shaded slopes, erosion gullies running down the faces, darker forest bands
  if (soft == 0.0 && e < r + 0.002 && e > -0.01 && tall > 0.0){
    float da = 0.0035, sunA = atan(uSun.z, uSun.x);
    float dm = mountains(a + da) - mountains(a - da);                    // + : the ridge climbs toward +a
    float lit = -dm*sign(sin(sunA - a));                                 // slopes turned toward the sun's side
    land *= 1.0 + tall*clamp(lit*3.5, -0.45, 0.35);
    float gul = vnoise(vec2(a*1500.0, e*38.0 + 3.0*vnoise(ring(a, 70.0))));   // long vertical streaks
    land *= 1.0 - tall*0.35*smoothstep(0.5, 0.85, gul)*smoothstep(0.1, 0.5, u);
    land *= 1.0 - 0.18*smoothstep(0.55, 0.8, vnoise(ring(a, 160.0) + vec2(0.0, e*90.0)))*(1.0 - cliff);
  }
  land *= mix(1.0, 0.45, back);                         // backlit toward the sun
  // snow only above the snow line, so it caps the high peaks instead of lining every ridge
  float snowK = uSnow*tall*smoothstep(base*0.68, base*0.8, e + base*0.12*(fbm2(ring(a, 80.0) + vec2(e*200.0, 0.0)) - 0.5));
  land = mix(land, vec3(0.86, 0.88, 0.90)*(0.75 + 0.25*tex), snowK);
  land = mix(land, hor*0.92, clamp(0.2 + dkm/70.0, 0.2, 0.85) + 0.2*back);          // aerial perspective grows with distance
  // where the land meets the water: a low band of haze over the water softens the foot of the hills into the
  // horizon, with a thin darker shoreline strip right at the waterline on nearby shores
  float foot = smoothstep(0.30, 0.0, u);
  land = mix(land, hor*0.95, foot*0.38*(1.0 - 0.5*uWeather.x));
  land *= 1.0 - 0.22*smoothstep(0.0025, 0.0, e)*smoothstep(12.0, 2.0, dkm);
  float w = fwidth(e)*1.2 + 2e-4 + soft;
  gLand = smoothstep(r+w, r-w, e) * step(-0.3, e) * step(0.0002, base);
  c = mix(c, land, gLand * (soft > 0.0 ? 0.45 : 1.0));
  // overcast: sky flattens to grey, sun glow goes, distant land fades into the murk
  c = mix(c, vec3(0.64, 0.67, 0.70)*(0.75 + 0.25*clamp(e*3.0 + 0.5, 0.0, 1.0)), uWeather.x*0.85);
  c = mix(c, vec3(0.70, 0.72, 0.74), uWeather.y*0.7*smoothstep(0.25, 0.0, abs(e)));
  c *= uSkyK;
  // stars at night
  if (uNight > 0.01 && e > 0.02){ vec2 sq = floor(d.xz/(d.y + 0.25)*260.0); float st = (1.0 - uWeather.x)*step(0.9993, hash12(sq))*(0.4 + 0.6*hash12(sq + 7.1)); c += vec3(0.9,0.95,1.0)*st*uNight*0.6*smoothstep(0.02, 0.2, e); }
  return c;
}

vec4 texBS(sampler2D t, vec2 uv){ // cubic B-spline filtering in 4 bilinear taps: smooth slopes -> smooth highlights
  vec2 ts = vec2(textureSize(t,0)); vec2 p = uv*ts - 0.5; vec2 f = fract(p); p = floor(p);
  vec2 f2 = f*f, f3 = f2*f;
  vec2 w0 = (-f3 + 3.0*f2 - 3.0*f + 1.0)/6.0, w1 = (3.0*f3 - 6.0*f2 + 4.0)/6.0;
  vec2 w2 = (-3.0*f3 + 3.0*f2 + 3.0*f + 1.0)/6.0, w3 = f3/6.0;
  vec2 g0 = w0+w1, g1 = w2+w3; vec2 h0 = (w1/g0 - 0.5 + p)/ts, h1 = (w3/g1 + 1.5 + p)/ts;
  return (texture(t, vec2(h0.x,h0.y))*g0.x + texture(t, vec2(h1.x,h0.y))*g1.x)*g0.y
       + (texture(t, vec2(h0.x,h1.y))*g0.x + texture(t, vec2(h1.x,h1.y))*g1.x)*g1.y;
}
// real depth → screen depth (inverse of game.js toReal: v·(1 + 0.078·v²)); the scene is drawn in screen metres
float toReal(float v){ return v*(1.0 + 0.078*v*v); }
float cbrt1(float x){ return sign(x)*pow(abs(x), 1.0/3.0); }
float toVis(float r){ const float A = 0.078; float p = 1.0/A, q = -r/A, D = sqrt(q*q*0.25 + p*p*p/27.0); return cbrt1(-q*0.5 + D) + cbrt1(-q*0.5 - D); }
// touch-ripple simulation: a small window that follows the action; fades out at its border so the clamped
// edge texels never smear into straight streaks across the water outside it
vec4 ripAt(vec2 uv){ vec2 d = abs(uv - 0.5); return texture(uRip, uv)*smoothstep(0.5, 0.42, max(d.x, d.y)); }
// long-period swell: three trains from one direction (per region), height + slope, applied the same to the
// surface intersection and the shading so the swell reads as one consistent sea
vec3 swell(vec2 x){
  vec3 r = vec3(0.0);
  float ang = uDepthQ.y*0.5;                       // region seed: the swell's heading
  for (int i = 0; i < 3; i++){
    float fi = float(i), a = ang + (fi - 1.0)*0.28;
    vec2 d = vec2(cos(a), sin(a));
    float lam = 22.0/(1.0 + fi*0.55), k = 6.2832/lam, w = sqrt(9.81*k), A = 0.045/(1.0 + fi*0.8);
    float ph = k*dot(d, x) - w*uTime + fi*1.7;
    r.x += A*sin(ph); r.yz += A*k*cos(ph)*d;
  }
  return r*uWaveK;
}
// integer-hash value noise, bit-identical to game.js (so fish and the line meet the same hills the eye sees)
uint uhash(uvec2 q){ uint h = (q.x*0x8da6b343u) ^ (q.y*0xd8163841u); h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16; return h; }
float inoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f); uvec2 c = uvec2(ivec2(i));
  float a = float(uhash(c))/4294967295.0, b = float(uhash(c + uvec2(1u, 0u)))/4294967295.0,
        cc = float(uhash(c + uvec2(0u, 1u)))/4294967295.0, e = float(uhash(c + uvec2(1u, 1u)))/4294967295.0;
  return a + (b - a)*f.x + (cc - a)*f.y + (a - b - cc + e)*f.x*f.y;
}
float bedRelief(vec2 x){
  float r1 = 1.0 - abs(2.0*inoise(x/34.0 + vec2(11.3, -7.1)) - 1.0), r2 = 1.0 - abs(2.0*inoise(x/13.0 + vec2(-3.7, 5.9)) - 1.0);
  r1 *= r1; r2 *= r2;
  return 0.7*r1 + 0.3*r1*r2;
}
float smin1(float a, float b, float k){ float h = max(k - abs(a - b), 0.0)/k; return min(a, b) - h*h*k*0.25; }
float floorDepth(vec2 xz){
  // region depth profile (same formula as game.js), plus fine shader-only noise
  float sc = uDepthQ.x; vec2 q = xz*sc;
  float n = 0.5*sin(q.x + uDepthQ.y)*sin(q.y*0.83 + uDepthQ.z) + 0.3*sin((q.x*0.7 - q.y*0.9)*2.1 + uDepthQ.y*2.0) + 0.2*sin((q.x*1.3 + q.y*0.4)*4.3 + uDepthQ.z*3.0);
  float d;
  if (uDepthS.x < 0.5){ float k = 0.3*uDepthP.y; d = smin1(-smin1(-(uDepthP.x + uDepthP.y*n), -uDepthP.z, k), uDepthP.w, k); }   // same smooth clamp as game.js
  else {   // the spot's own bed shape (bedShare in game.js)
    float u = clamp(0.5 + 0.5*n, 0.0, 1.0), r = length(xz), al = dot(xz, uDepthS.yz), s = uDepthS.x, g;
    if (s < 1.5) g = 0.55*pow(u, 1.3) + 0.45*smoothstep(20.0, 250.0, r);
    else if (s < 2.5) g = 0.6*pow(u, 0.8) + 0.4*smoothstep(10.0, 150.0, r);
    else if (s < 3.5) g = 0.85*exp(-pow(abs(al - 18.0)/14.0, 2.0)) + 0.15*u;
    else if (s < 4.5) g = 0.35*u*u*u + 0.65*smoothstep(90.0, 170.0, r);
    else if (s < 5.5) g = 0.25*u + 0.75*smoothstep(150.0, 300.0, r);
    else if (s < 6.5) g = 0.15*u + 0.85*smoothstep(15.0, 70.0, al);
    else g = u;
    d = mix(uDepthP.x, uDepthP.y, clamp(g, 0.0, 1.0));
  }
  float tt = smoothstep(12.0, 70.0, length(xz));
  d = toVis(mix(uDepthQ.w, d, tt)*(1.0 - uDepthS.w*smoothstep(4.0, 25.0, length(xz))*bedRelief(xz)));   // underwater hills (same as game.js)
  return d + 0.10*(vnoise(xz*0.9+7.0)-0.5);
}
vec3 pebbles(vec2 x, float sc, out float hgt){
  vec2 uv = x / (vec2(0.78, 0.78)*sc);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float k = vnoise(x*0.85);
  float l = k*8.0; float ia = floor(l), f = fract(l);
  vec2 oa = sin(vec2(3.0,7.0)*ia), ob = sin(vec2(3.0,7.0)*(ia+1.0));
  vec3 a = textureGrad(uPeb, uv+oa, dx, dy).rgb, b = textureGrad(uPeb, uv+ob, dx, dy).rgb;
  float s = dot(a-b, vec3(1));
  float m = smoothstep(0.2, 0.8, f - 0.1*s);
  // coarse luminance as pseudo-height (pale stone tops, dark gaps)
  vec3 ca = textureGrad(uPeb, uv+oa, dx*6.0, dy*6.0).rgb, cb = textureGrad(uPeb, uv+ob, dx*6.0, dy*6.0).rgb;
  hgt = dot(mix(ca,cb,m), vec3(0.3,0.55,0.15));
  return mix(a, b, m);
}
// Seabed material (after Tidewater's seabed): pebbles and cobbles, sand that fills the gaps and takes over on
// sandy beds, with swell-aligned megaripples and fine ripples (albedo + bump, faded out where they would alias),
// greyer and paler with depth; seagrass meadows streaked along the surge in the shallows. Returns albedo,
// pseudo height (0..1) and the bump normal.
vec3 bedAlbedo(vec2 x, float dep, out float hgt, out vec3 nb){
  float h1, h2;
  vec3 pf = pebbles(x, 1.0, h1), pc = pebbles(x.yx*vec2(-1.0, 1.0) + 5.3, 1.7, h2);
  float coarse = smoothstep(0.45, 0.62, fbm2(x*0.21 + 40.0));
  vec3 alb = mix(pf, pc, coarse); hgt = mix(h1, h2, coarse);
  alb = mix(vec3(dot(alb, vec3(0.3, 0.55, 0.15))), alb, 0.8)*vec3(1.10, 1.0, 0.86);
  alb = mix(vec3(0.30, 0.29, 0.27), pow(alb, vec3(1.2)), 0.72)*0.6;
  // sand
  float zone = fbm2(x*0.16 + 3.0) + 0.10*(vnoise(x*2.5) - 0.5);
  float sandM = max(smoothstep(hgt + 0.02, hgt + 0.16, (zone - 0.40)*1.6), uBed.x*smoothstep(-0.3, 0.2, zone - 0.35 + uBed.x));
  float ang = uDepthQ.y*0.5; vec2 sw = vec2(cos(ang), sin(ang));
  float warp = vnoise(x/6.7)*16.0 + vnoise(x*0.02 + 3.0)*24.0;
  float ph2 = dot(x, sw)*8.3776 + warp, ph1 = dot(x, sw)*39.27 + warp*2.3 + vnoise(x*1.3)*6.0;   // 0.75 m and 0.16 m
  float f2 = 1.0 - smoothstep(0.5, 2.0, fwidth(ph2)), f1 = 1.0 - smoothstep(0.5, 2.0, fwidth(ph1));
  float field = smoothstep(0.25, 0.6, vnoise(x*0.07 + 9.0));                    // ripple fields come and go
  float rip2 = pow(sin(ph2)*0.5 + 0.5, 1.4);
  vec3 sandC = mix(vec3(0.68, 0.58, 0.37), vec3(0.48, 0.45, 0.30), smoothstep(toVis(1.0), toVis(9.0), dep));
  sandC *= (vnoise(x/6.7) - 0.5)*0.14 + 1.0; sandC *= (vnoise(x*40.0) - 0.45)*0.25 + 1.0;
  sandC *= (rip2 - 0.55)*0.22*field*f2 + 1.0;
  sandC *= 0.75;
  alb = mix(alb, sandC, sandM); hgt = mix(hgt, 0.42 + 0.08*rip2*field, sandM);
  // bump from the ripples (analytic slopes along the swell direction)
  float sl = (0.035*8.3776*cos(ph2)*0.5*field*f2 + 0.012*39.27*cos(ph1)*0.5*f1)*sandM;
  nb = normalize(vec3(-sw.x*sl, 1.0, -sw.y*sl));
  // seagrass meadows in the shallows: dark green streaks lying along the surge, paler tips
  float realD = toReal(dep);
  float mead = smoothstep(0.58, 0.72, fbm2(x*0.035 + vec2(vnoise(x*0.01)*3.0, 17.0)))*smoothstep(1.2, 2.5, realD)*smoothstep(14.0, 8.0, realD);
  if (mead > 0.0){
    vec2 sp = vec2(-sw.y, sw.x);
    float bl = vnoise(vec2(dot(x, sw)/0.9, dot(x, sp)/0.05));
    float fb = 1.0 - smoothstep(0.3, 1.2, fwidth(dot(x, sp)/0.05));
    vec3 meadC = mix(vec3(0.045, 0.07, 0.02), vec3(0.12, 0.14, 0.05), mix(0.5, smoothstep(0.35, 0.75, bl), fb));
    meadC = mix(meadC, vec3(0.10, 0.08, 0.04), 0.25*vnoise(x*1.7));   // epiphytes, dead blades
    alb = mix(alb, meadC*1.6, mead); hgt = mix(hgt, 0.5, mead);
    nb = normalize(mix(nb, vec3(0.0, 1.0, 0.0), mead));
  }
  // large-scale variation: sun-bleached patches, darker weedy hollows
  float big = vnoise(x*0.45)*0.65 + vnoise(x*1.3 + 3.1)*0.35;
  float weed = smoothstep(0.50, 0.85, vnoise(x*0.32 + 11.0));
  alb *= mix(0.72, 1.15, big);
  alb = mix(alb, alb*vec3(0.45, 0.62, 0.30), weed*0.6*(1.0 - uBed.x));
  return alb*uBed.yzw;
}
float fresnel(float ci, float n){
  ci = clamp(ci, 0.0, 1.0);
  float st2 = (1.0-ci*ci)/(n*n); if (st2 >= 1.0) return 1.0;
  float ct = sqrt(1.0-st2);
  float rs = (ci - n*ct)/(ci + n*ct), rp = (n*ci - ct)/(n*ci + ct);
  return 0.5*(rs*rs + rp*rp);
}

/* ---- underwater objects ---- */
// ray vs ellipsoid in frame B (columns: forward, up, side); lp = hit point in unit-sphere coordinates
float iEll(vec3 ro, vec3 rd, vec3 c, mat3 B, vec3 rad, out vec3 lp){
  vec3 o = (transpose(B)*(ro-c))/rad, d = (transpose(B)*rd)/rad;
  float a = dot(d,d), b = dot(o,d), cc = dot(o,o)-1.0, h = b*b - a*cc;
  lp = vec3(0);
  if (h < 0.0) return -1.0;
  float t = (-b - sqrt(h))/a;
  lp = o + d*t;
  return t;
}
// soft occlusion of a ray by an ellipsoid (for shadows): 0 = fully blocked
float oEll(vec3 ro, vec3 rd, vec3 c, mat3 B, vec3 rad, float soft){
  vec3 o = (transpose(B)*(ro-c))/rad, d = (transpose(B)*rd)/rad;
  float t = -dot(o,d)/dot(d,d);
  if (t < 0.0) return 1.0;
  return smoothstep(1.0-soft, 1.0+soft, length(o + d*t));
}
mat3 fishFrame(vec3 f){ vec3 up = normalize(vec3(0,1,0) - f*f.y); return mat3(f, up, cross(f, up)); }
mat3 hullFrame(){ float h = uBoat.w; vec3 f = vec3(sin(h), 0.0, -cos(h)); return mat3(f, vec3(0,1,0), vec3(cos(h), 0.0, sin(h))); }

vec3 fishAlb(vec3 lp, vec4 A, vec4 Bc){
  vec3 back = A.rgb, belly = Bc.rgb; float pat = A.w;
  float x = lp.x, y = lp.y;
  vec3 c = mix(belly, back, smoothstep(-0.25, 0.85, y));
  if (pat < 0.5){                        // plain
  } else if (pat < 1.5){                 // vertical bars (bluegill, peacock bass)
    float bar = smoothstep(0.3, 0.7, sin(x*11.0+1.0)) * smoothstep(-0.6, 0.1, y) * step(x, 0.62);
    c = mix(c, back*0.35, bar*0.75);
    c = mix(c, vec3(0.55,0.22,0.04), smoothstep(-0.35,-0.75,y)*0.7);   // orange breast
  } else if (pat < 2.5){                 // ragged lateral stripe (bass)
    float st = smoothstep(0.22, 0.08, abs(y - 0.02 + 0.07*sin(x*13.0))) * step(x, 0.72);
    c = mix(c, back*0.3, st*0.85);
  } else if (pat < 3.5){                 // leopard blotches (mandarin fish)
    float n = vnoise(vec2(x*6.5, y*4.5)*1.4 + 2.0);
    c = mix(c, vec3(0.03,0.025,0.01), smoothstep(0.58,0.68,n)*0.9);
  } else if (pat < 4.5){                 // pink band + black dots (rainbow trout)
    c = mix(c, vec3(0.62,0.16,0.20), smoothstep(0.26,0.04,abs(y+0.02))*0.75);
    float d = step(0.78, hash12(floor(vec2(x*20.0, y*14.0))));
    c = mix(c, vec3(0.02), d*smoothstep(-0.15,0.35,y)*0.85);
  } else if (pat < 5.5){                 // mottled (catfish)
    c = mix(c, back*0.45, smoothstep(0.45,0.7,vnoise(vec2(x*6.0,y*6.0)+3.0))*0.85);
  } else if (pat < 6.5){                 // large scales (carp family)
    vec2 q = vec2(x*15.0, y*9.0 + 0.5*floor(x*15.0));
    c *= 1.0 - 0.22*smoothstep(0.32, 0.5, length(fract(q)-0.5));
  } else if (pat < 7.5){                 // silver with faint rose flank (chub)
    c = mix(c, vec3(0.55,0.35,0.40), smoothstep(0.3,0.0,abs(y+0.25))*0.35);
  } else if (pat < 8.5){                 // dark spots all over (grouper, pike)
    float d = smoothstep(0.62, 0.72, vnoise(vec2(x*9.0, y*7.0) + 5.0));
    c = mix(c, back*0.35 + vec3(0.04,0.02,0.0), d*0.8);
  } else if (pat < 9.5){                 // mackerel: wavy dark lines on the back
    float w = step(0.5, fract(x*6.0 + sin(y*9.0)*0.6)) * smoothstep(0.15, 0.45, y);
    c = mix(c, back*0.25, w*0.8);
  } else if (pat < 10.5){                // red breast (piranha, red snapper flank)
    c = mix(c, vec3(0.55,0.10,0.05), smoothstep(-0.05,-0.6,y)*0.85);
  } else if (pat < 11.5){               // bright reef colours with scale mesh (parrotfish)
    vec2 q = vec2(x*14.0, y*9.0 + 0.5*floor(x*14.0));
    c = mix(c, c*vec3(1.4,0.8,1.3), 0.25*smoothstep(0.3, 0.5, length(fract(q)-0.5)));
  } else {                               // pale spots on a dark back (whale shark)
    vec2 q = vec2(x*16.0, y*9.0); vec2 id = floor(q); vec2 f = fract(q) - 0.5 + (vec2(hash12(id), hash12(id+3.7)) - 0.5)*0.5;
    c = mix(c, vec3(0.75,0.76,0.72), smoothstep(0.2, 0.12, length(f))*smoothstep(-0.2, 0.2, y));
  }
  c *= 1.9;   // game readability: fish a little brighter than true camouflage
  vec2 e = vec2(x - 0.74, y - 0.16);
  if (dot(e,e) < 0.0065 && abs(lp.z) > 0.25) c = mix(vec3(0.75,0.6,0.2), vec3(0.005), step(dot(e,e), 0.0035));
  return c;
}

// Fish from photographs: the cut-out photo (head to the right) is the side view, its thickness map (from the
// distance to the silhouette edge, a rounded cross-section) gives the body depth, so fins come out thin and the
// belly and back round off. The body follows a travelling wave that grows toward the tail and bends into turns.
float fishOff(float x, float Lf, vec4 G){   // lateral offset of the midline at x (head at +Lf/2)
  float s = clamp(0.5 - x/Lf, 0.0, 1.0);
  return Lf*(G.z*(0.02 + 0.22*s*s)*sin(G.y - 4.8*s) + G.w*0.35*s*s);
}
float photoFish(vec3 ro, vec3 rd, float tMax, vec3 c, float Lf, mat3 B, vec4 E, vec4 G, float wr, out vec3 N, out vec3 alb){
  float asp = abs(G.x), T = Lf*max(wr, 0.05)*0.55;
  vec3 hb = vec3(Lf*0.5, Lf*asp*0.5, T + Lf*(abs(G.z)*0.24 + abs(G.w)*0.35) + 0.002);
  vec3 o = transpose(B)*(ro - c), d = transpose(B)*rd;
  vec3 id = 1.0/(d + vec3(1e-6)), ta = (-hb - o)*id, tb = (hb - o)*id;
  vec3 tn = min(ta, tb), tf = max(ta, tb);
  float t0 = max(max(tn.x, tn.y), max(tn.z, 0.0)), t1 = min(min(tf.x, tf.y), min(tf.z, tMax));
  if (t0 >= t1) return -1.0;
  vec2 uv0 = E.xy, duv = E.zw - E.xy;
  float lod = log2(max(1.0, max(t0, 0.3)*uPixAng*duv.x*float(textureSize(uFishT, 0).x)/Lf));
  // the map stores 0.1 + 0.9·thickness inside and a short ramp below 0.1 outside, so the silhouette (0.1) is smooth
  #define FTR(q) (textureLod(uFishT, uv0 + duv*vec2(0.5 + (q).x/Lf, 0.5 - (q).y/(Lf*asp)), lod).r)
  #define FTH(q) (max(FTR(q) - 0.1, 0.0)*1.1111)
  // Thin parts (fins, tail) are far thinner than a march step, so besides the thickness test each step also
  // checks whether the ray crossed the body's midline sheet; a crossing inside the silhouette is a hit.
  const int NS = 16;
  float dt = (t1 - t0)/float(NS), ta0 = t0, t = -1.0;
  vec3 q0 = o + d*t0; float gp = q0.z - fishOff(q0.x, Lf, G);
  bool sheet = false;
  for (int k=0; k<=NS; k++){
    float tt = t0 + dt*float(k); vec3 q = o + d*tt; float th = FTH(q);
    float g = q.z - fishOff(q.x, Lf, G);
    if (th > 0.0 && T*th > abs(g)){ t = tt; break; }
    if (k > 0 && g*gp <= 0.0){
      float tc = mix(ta0, tt, gp/(gp - g + 1e-9)); vec3 qc = o + d*tc;
      if (FTR(qc) > 0.1){ t = tc; sheet = true; break; }
    }
    ta0 = tt; gp = g;
  }
  if (t < 0.0) return -1.0;
  if (!sheet) for (int j=0; j<5; j++){   // refine between the last outside and the first inside sample
    float m = 0.5*(ta0 + t); vec3 q = o + d*m; float th = FTH(q);
    if (th > 0.0 && T*th > abs(q.z - fishOff(q.x, Lf, G))) t = m; else ta0 = m;
  }
  vec3 q = o + d*t;
  float e = Lf*0.012, off = fishOff(q.x, Lf, G), s = q.z >= off ? 1.0 : -1.0;
  float thx = (FTH(q + vec3(e,0,0)) - FTH(q - vec3(e,0,0)))/(2.0*e);
  float thy = (FTH(q + vec3(0,e,0)) - FTH(q - vec3(0,e,0)))/(2.0*e);
  float ofx = (fishOff(q.x + e, Lf, G) - fishOff(q.x - e, Lf, G))/(2.0*e);
  // fins: the steep thickness gradient at their thin edge would tilt the normal sideways; use the sheet's own normal
  float thq = FTH(q);
  s = sheet ? -sign(d.z + 1e-6) : s;
  N = normalize(B*mix(vec3(-s*ofx, 0.0, s), vec3(-T*thx - s*ofx, -T*thy, s), smoothstep(0.05, 0.25, thq)));
  alb = textureLod(uFishC, uv0 + duv*vec2(0.5 + q.x/Lf, 0.5 - q.y/(Lf*asp)), lod).rgb*1.6;
  #undef FTH
  #undef FTR
  return t;
}

// nearest underwater object along (ro, rd) before tMax; returns t or -1
bool lureHit = false;
float traceObjects(vec3 ro, vec3 rd, float tMax, out vec3 N, out vec3 alb, out float spec){
  float bt = tMax; N = vec3(0,1,0); alb = vec3(0); spec = 0.0;
  vec3 lp; float t;
  for (int i=0;i<MAXF;i++){
    if (i >= uFishN) break;
    vec4 P4 = uFP[i]; float Lf = P4.w;
    float br = Lf*max(max(0.71, 0.5*uFC[i].x + 0.1), 0.5*sqrt(1.0 + uFG[i].x*uFG[i].x) + 0.2);   // bounding radius (wide rays need more)
    vec3 oc = ro - P4.xyz; float b = dot(oc, rd), c = dot(oc,oc) - br*br;
    if (c > 0.0 && (b > 0.0 || b*b < c)) continue;
    vec3 f = uFD[i].xyz; mat3 Bm = fishFrame(f); vec3 up = Bm[1], sd = Bm[2];
    float hr = uFB[i].w; vec4 sh = uFC[i];
    if (uFG[i].x != 0.0){
      vec3 pN, pA;
      t = photoFish(ro, rd, bt, P4.xyz, Lf, uFG[i].x < 0.0 ? mat3(f, sd, -up) : Bm, uFE[i], uFG[i], sh.x, pN, pA);
      if (t > 0.0 && t < bt){ bt = t; N = pN; alb = pA; spec = 0.35; }
      continue;
    }
    // body flexes with the tail beat
    float w = uFD[i].w;
    vec3 ctr = P4.xyz + sd*(sin(w)*0.035*Lf);
    vec3 rad = Lf*vec3(0.5, 0.5*hr, 0.5*sh.x);
    t = iEll(ro, rd, ctr, Bm, rad, lp);
    if (t > 0.0 && t < bt){ bt = t; N = normalize(Bm*(lp/rad)); alb = fishAlb(lp, uFA[i], uFB[i]); spec = sh.x > 0.5 ? 0.04 : 0.45; }
    // tail: vertical fin, horizontal fluke (whales), or the sunfish's stubby clavus
    if (sh.y < 1.5 || sh.y > 2.5){
      vec3 tf = f*cos(w) + sd*sin(w);
      mat3 Bt = sh.y > 0.5 && sh.y < 1.5 ? mat3(tf, cross(tf, up), up) : mat3(tf, up, cross(tf, up));
      vec3 trad = sh.y > 2.5 ? Lf*vec3(0.05, 0.45*hr, 0.02) : Lf*sh.w*vec3(0.11, 0.42*hr, 0.012);
      if (sh.y > 0.5 && sh.y < 1.5) trad = Lf*sh.w*vec3(0.09, 0.30, 0.012);
      vec3 tc = sh.y > 2.5 ? P4.xyz - f*0.5*Lf : P4.xyz - f*0.44*Lf - tf*0.09*Lf*sh.w;
      t = iEll(ro, rd, tc, Bt, trad, lp);
      if (t > 0.0 && t < bt){ bt = t; N = normalize(Bt*(lp/trad)); alb = uFA[i].rgb*1.5 + uFB[i].rgb*0.3; spec = 0.15; }
    }
    // dorsal fin (mirrored as an anal fin on the sunfish)
    if (sh.z > 0.01){
      vec3 drad = Lf*vec3(0.17/max(sh.z,1.0)*1.2, 0.20*hr*sh.z, 0.010);
      t = iEll(ro, rd, P4.xyz + up*(0.40*hr*Lf*min(sh.z,1.6)) - f*(sh.y > 2.5 ? 0.3 : 0.04)*Lf, Bm, drad, lp);
      if (t > 0.0 && t < bt){ bt = t; N = normalize(Bm*(lp/drad)); alb = uFA[i].rgb*1.3; spec = 0.1; }
      if (sh.y > 2.5){
        t = iEll(ro, rd, P4.xyz - up*(0.40*hr*Lf*1.6) - f*0.3*Lf, Bm, drad, lp);
        if (t > 0.0 && t < bt){ bt = t; N = normalize(Bm*(lp/drad)); alb = uFB[i].rgb*1.1; spec = 0.1; }
      }
    }
  }
  if (uLure.w > 0.5){
    mat3 Bl = fishFrame(uLureD.xyz);
    t = iEll(ro, rd, uLure.xyz, Bl, uLureS, lp);
    if (t > 0.0 && t < bt){ bt = t; N = normalize(Bl*(lp/uLureS)); spec = uLureC.w;
      alb = uLureC.rgb;
      float k = uLureD.w;
      if (k > 0.5 && k < 1.5) alb = mix(vec3(0.75), uLureC.rgb, smoothstep(-0.2, 0.3, lp.y));            // minnow: silver belly
      if (k > 2.5) alb = uLureC.rgb*(0.8 + 0.3*sin(lp.x*30.0));                                         // soft worm: rings
      if (k > 0.5 && k < 1.5 && lp.x > 0.55 && abs(lp.z) > 0.3 && lp.y > 0.0) alb = vec3(0.01);          // eye
    }
  }
  float lureT = bt;
  if (uBob.w > 0.5){
    float tl = uBob.w - 1.0; vec3 up = vec3(0.0, cos(tl), sin(tl));   // tilted about x like the raster float
    mat3 Bb = mat3(up, vec3(1,0,0), vec3(0.0, sin(tl), -cos(tl))); vec3 brad = vec3(0.10, 0.017, 0.017);
    t = iEll(ro, rd, uBob.xyz, Bb, brad, lp);
    if (t > 0.0 && t < bt){ bt = t; N = normalize(Bb*(lp/brad)); alb = mix(vec3(0.9,0.25,0.03), vec3(0.9), step(0.55, lp.x)); spec = 0.3; }
  }
  { mat3 Bh = hullFrame();
    t = iEll(ro, rd, uBoat.xyz, Bh, HULL, lp);
    if (t > 0.0 && t < bt){ bt = t; N = normalize(Bh*(lp/HULL));
      alb = mix(vec3(0.05,0.10,0.14), vec3(0.08,0.10,0.05), smoothstep(-0.2, -0.9, lp.y)*0.7) * (0.8 + 0.4*vnoise(lp.xz*vec2(40.0,8.0)));
      spec = 0.2; }
  }
  lureHit = uLure.w > 0.5 && bt == lureT && bt < tMax && length(ro + rd*bt - uLure.xyz) < max(uLureS.x, 0.05)*1.2;
  return bt < tMax ? bt : -1.0;
}
float shadowAt(vec3 X, vec3 ld){
  float sh = 1.0;
  for (int i=0;i<MAXF;i++){
    if (i >= uFishN) break;
    vec4 P4 = uFP[i]; float Lf = P4.w; float hr = uFB[i].w;
    float soft = 0.25 + 0.25*clamp((P4.y - X.y)/1.5, 0.0, 1.0);
    sh *= mix(0.45, 1.0, oEll(X, ld, P4.xyz, fishFrame(uFD[i].xyz), Lf*vec3(0.5, 0.5*hr, 0.5*max(uFC[i].x, hr*0.5)), soft));
  }
  sh *= mix(0.3, 1.0, oEll(X, ld, uBoat.xyz, hullFrame(), HULL, 0.12));
  return sh;
}

// Kelvin wake behind the boat: two divergent arms at ~19.5 deg, transverse waves inside, turbulent foam on the track.
// Measured along the boat's recent track so the wake curves with the turns. Returns (height, foam).
vec2 wakeAt(vec2 x){
  if (uWakeN < 2 || length(x - uWake[0].xy) > 110.0) return vec2(0.0);
  float best = 1e9, bd = 0.0, amp = 0.0, acc = 0.0;
  for (int i=0;i<WAKEN-1;i++){
    if (i+1 >= uWakeN) break;
    vec2 a = uWake[i].xy, b = uWake[i+1].xy, ab = b - a; float L = length(ab);
    if (L < 1e-3) continue;
    vec2 t = ab/L; float u = clamp(dot(x - a, t), 0.0, L); float dd = length(x - a - t*u);
    if (dd < best){ best = dd; bd = acc + u; amp = mix(uWake[i].z, uWake[i+1].z, u/L); }
    acc += L;
  }
  if (amp < 0.01) return vec2(0.0);
  float bl = best, edge = 0.36*bd;
  float arms = exp(-pow((bl - edge)/(0.9 + 0.16*bd), 2.0));
  float inside = smoothstep(edge + 0.6, edge - 0.6, bl);
  float h = amp*exp(-bd/55.0)*(arms*sin(1.6*(0.9*bl + 0.45*bd) - uTime*1.5)*0.13 + inside*sin(1.5*bd - uTime*1.2)*0.065);
  float foam = amp*(exp(-pow(bl/(1.0 + 0.07*bd), 2.0))*exp(-bd/22.0)*1.4 + arms*exp(-bd/10.0)*1.1);
  return vec2(h, foam);
}

// ---- camera below the surface: look around inside the water column ----
${UW_GLSL}
vec3 underwaterView(vec3 rd, out float tHit){
  vec3 ro = uCam;
  vec3 sunT = refract(-uSun, vec3(0,1,0), 1.0/IOR);
  float Ts = 1.0 - fresnel(uSun.y, IOR);
  vec3 skyIrr = vec3(0.62, 0.70, 0.78) * PI * 0.22 * uSkyK;
  const float FAR = 45.0;
  // bottom: march outwards (fine steps near the eye) and refine by bisection; the fixed-point step used from
  // above the water breaks down at the grazing angles you get down here and drew false shelves and rings
  float sB = FAR, prevT = 0.0;
  for (int i = 1; i <= 36; i++){
    float tt = FAR*pow(float(i)/36.0, 1.7); vec3 q = ro + rd*tt;
    if (q.y > 0.05 && rd.y > 0.0) break;
    if (q.y < -floorDepth(q.xz)){
      float a = prevT, b = tt;
      for (int j = 0; j < 6; j++){ float m = 0.5*(a + b); vec3 qm = ro + rd*m; if (qm.y < -floorDepth(qm.xz)) b = m; else a = m; }
      sB = b; break;
    }
    prevT = tt;
  }
  // underside of the surface (mean level; the normal carries the waves)
  float sS = rd.y > 1e-4 ? min(-ro.y/rd.y, FAR) : FAR;
  float sMax = min(sB, sS);
  vec3 oN, oAlb; float oSpec;
  float so = traceObjects(ro, rd, sMax, oN, oAlb, oSpec);
  float sHit = so > 0.0 ? so : sMax;
  tHit = (so > 0.0 || (sB <= sS && sB < FAR)) ? sHit : -1.0;   // fish / bottom: real depth for the rasterised decor
  vec3 X = ro + rd*sHit;
  float dep = max(-X.y, 0.0);
  vec3 L = vec3(0.0);
  if (so > 0.0){
    float focus = clamp(dep/uDepth, 0.0, 1.0);
    vec3 caus = mix(vec3(1.0), texture(uCaus, (X.xz - uCausShift*focus)/uL, 1.0).rgb, focus);
    vec3 att = exp(-SIG_T*dep/(-sunT.y));
    L = oAlb/PI*(SUN*Ts*att*caus*max(dot(oN, -sunT), 0.0) + skyIrr*exp(-(SIG_A + 0.4*SIG_S)*dep*1.25)*(0.45 + 0.55*oN.y));
    L += oSpec*SUN*Ts*att*caus*pow(max(dot(oN, normalize(-sunT - rd)), 0.0), 48.0)*0.35;
    if (lureHit) L += oAlb*0.35 + vec3(0.02);
  } else if (sB <= sS && sB < FAR){
    float hgt; vec3 nb; vec3 alb = bedAlbedo(X.xz, dep, hgt, nb);
    float ao = mix(0.5, 1.0, smoothstep(0.08, 0.45, hgt));
    vec3 caus = texture(uCaus, (X.xz - uCausShift)/uL, 1.0).rgb;
    float shd = shadowAt(X, -sunT);
    L = alb/PI*(SUN*Ts*exp(-SIG_T*dep/(-sunT.y))*caus*max(dot(nb, -sunT), 0.0)*shd*mix(0.75, 1.0, ao) + skyIrr*exp(-(SIG_A + 0.4*SIG_S)*dep*1.25)*ao);
  } else if (sS < FAR){
    // the surface from below: Snell's window (sky and sun) inside ~49°, mirror of the dark water outside it
    vec4 A = texture(uSurf, X.xz/uL); vec4 R = ripAt((X.xz - uRipCenter)/uRipSize + 0.5);
    vec3 n = normalize(vec3(-(uWaveK*A.y + R.y), 1.0, -(uWaveK*A.z + R.z)));
    vec3 tr = refract(rd, -n, IOR);
    vec3 Rr = reflect(rd, -n);   // outside Snell's window: total internal reflection of the endless water column
    vec3 deepC = uwScatter(SIG_A, SIG_S + vec3(0.030, 0.026, 0.022), SUN*Ts, skyIrr, -sunT, 0.0, Rr, 300.0);
    if (dot(tr, tr) < 0.01) L = deepC*0.8;
    else {
      float Fw = fresnel(max(dot(-rd, -n), 0.0), 1.0/IOR);
      vec3 sk = sky(tr, 0.0); L = (1.0 - Fw)*(sk*1.1 + SUN*6.0*smoothstep(0.9990, 0.99975, dot(tr, uSun))*(1.0 - uWeather.x)*(1.0 - gLand)*(1.0 - 0.9*gCloud)) + Fw*deepC;
    }
  }
  // the water column between the eye and what it sees: absorption plus the analytic sun and sky in-scatter;
  // suspended matter adds scattering (murk) so the distance fades out
  vec3 wS = SIG_S + vec3(0.030, 0.026, 0.022), wA = SIG_A, sTv = wA + wS;
  vec3 Ls = -sunT, sunE = SUN*Ts;
  float zc = max(-ro.y, 0.0);
  vec3 Tv = exp(-sTv*sHit);
  vec3 fogC = uwScatter(wA, wS, sunE, skyIrr, Ls, zc, rd, 300.0);   // an endless column: the water colour this way
  vec3 col = L*Tv + uwScatter(wA, wS, sunE, skyIrr, Ls, zc, rd, sHit);
  // light shafts: march toward the hit through the caustic pattern each point receives; only the deviation from
  // the mean adds, so they are bright and dark streaks around the smooth in-scatter (interleaved-gradient dither)
  {
    float jit = fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float sm = min(sHit, 18.0), ds = sm/10.0, mu = max(Ls.y, 0.15);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 10; i++){
      float st = (float(i) + jit)*ds; vec3 q = ro + rd*st; float z = max(-q.y, 0.01);
      float focus = clamp(z/uDepth, 0.0, 1.0);
      vec3 c = mix(vec3(1.0), texture(uCaus, (q.xz - uCausShift*focus)/uL, 2.0).rgb, focus);
      acc += (c - 1.0)*exp(-sTv*(st + z/mu))*ds;
    }
    float g = 0.85, cc = dot(rd, Ls);
    float ph = (1.0 - g*g)/(12.566371*pow(1.0 + g*g - 2.0*g*cc, 1.5))*0.75 + 0.25/12.566371;
    col += max(acc*sunE*wS*ph*2.5*UW_GAIN, vec3(-0.5)*col);
  }
  // deep water: the bed fades into the water colour from 50m real depth and is gone past 100m (no decor down there either)
  if (so <= 0.0 && sB <= sS && sB < FAR){
    float gone = smoothstep(toVis(50.0), toVis(100.0), dep);
    col = mix(col, fogC, gone);
    if (gone > 0.98) tHit = -1.0;
  }
  // fishing line in the water: thin nylon a touch brighter than the water around it
  if (uLnA.w > 0.5){
    vec3 a = uLnA.xyz, ba = uLnB.xyz - a, w0 = ro - a;
    float bb = dot(rd, ba), cc = dot(ba, ba), dd = dot(rd, w0), ee = dot(ba, w0);
    float den = max(cc - bb*bb, 1e-6);
    float u = clamp((ee - bb*dd)/den, 0.0, 1.0);
    vec3 q = a + ba*u; float tl = max(dot(q - ro, rd), 0.0);
    float dl = length(ro + rd*tl - q);
    float pw = max(tl, 0.05)*uPixAng, lw = max(pw*0.9, 0.0012);
    float al = smoothstep(lw, lw*0.25, dl)*clamp(0.0035/pw, 0.3, 0.85)*step(tl, sHit + 0.05);
    vec3 Tl = exp(-sTv*tl);
    vec3 lc = fogC*(1.0 - Tl)*1.25 + (fogC*1.6 + SUN*Ts*0.01*exp(-SIG_T*max(-q.y, 0.0)))*Tl;
    col = mix(col, lc, al);
    if (al > 0.2) tHit = tl;   // the line's own depth, so weed and rocks behind it don't paint over it
  }
  return col;
}

void main(){
  vec2 ndc = vUv*2.0-1.0;
  vec3 rd = normalize(uF + ndc.x*uAspect*uTanF*uR + ndc.y*uTanF*uU);
  vec3 wd = rd; wd.y = min(wd.y, -0.0015); wd = normalize(wd);
  if (uCam.y < -0.03){
    float th; o = vec4(max(underwaterView(rd, th), 0.0), 1.0);
    // write the depth of what was hit so rocks, weed and coral sort correctly against fish and the bed
    if (th > 0.0){ float dz = max(dot(rd*th, uF), ${ZNEAR}); gl_FragDepth = clamp((${ZA.toFixed(8)} + (${ZB.toFixed(8)})/dz)*0.5 + 0.5, 0.0, 0.999999); }
    else gl_FragDepth = 1.0;
    return; }

  // ---- surface intersection (height field, fixed-point) ----
  float t = -uCam.y / wd.y;
  vec2 xz; vec4 A; vec4 B; vec4 R;
  const mat2 M = mat2(0.8, -0.6, 0.6, 0.8);
  const float SC = 0.41, WB = 0.10;
  float hsum = 0.0;
  for (int i=0;i<3;i++){
    xz = uCam.xz + wd.xz*t;
    A = texture(uSurf, xz/uL);
    B = texture(uSurf, (M*xz)/(uL*SC) + 0.37);
    vec2 ruv = (xz - uRipCenter)/uRipSize + 0.5;
    R = ripAt(ruv);
    hsum = uWaveK*(A.x + WB*SC*B.x) + swell(xz).x + R.x;
    t = (hsum - uCam.y) / wd.y;
  }
  vec3 P = uCam + wd*t;
  A = texBS(uSurf, P.xz/uL);
  B = texBS(uSurf, (M*P.xz)/(uL*SC) + 0.37);
  // break up the 4.6 m tile: a slow noise field trades weight between the two differently rotated and scaled
  // layers, and a third large rotated layer adds a swell that never lines up with them (one extra fetch)
  // (the tile's repetition is broken by a gentle, large-scale trade between the two layers and the swell on top)
  float gm = vnoise(P.xz*0.018 + 5.7);
  float wa = mix(0.82, 1.18, gm), wb = mix(1.3, 0.8, gm);
  vec3 SW = swell(P.xz);
  vec2 slope = uWaveK*(wa*A.yz + wb*WB*(transpose(M)*B.yz)) + SW.yz + R.yz;
  // boat wake: slope by finite differences of the analytic wake height
  vec2 wk = vec2(0.0);
  if (uWakeN > 1){
    wk = wakeAt(P.xz);
    float e = 0.12;
    slope += vec2(wakeAt(P.xz + vec2(e, 0.0)).x - wk.x, wakeAt(P.xz + vec2(0.0, e)).x - wk.x)/e;
  }
  const mat2 M2 = mat2(0.28, 0.96, -0.96, 0.28);
  vec4 Cm = texture(uSurf, (M2*P.xz)/(uL*0.13) + 0.71);
  slope += uWaveK*0.13*exp(-t*0.18)*(transpose(M2)*Cm.yz);
  slope *= 1.0 + 1.3*uWeather.w;                       // wind: rougher water
  if (uWeather.z > 0.01 && t < 40.0){                  // rain: expanding rings from drops
    vec2 g = vec2(0.0);
    for (int k = 0; k < 2; k++){
      vec2 q = P.xz*3.0 + float(k)*17.3; vec2 id = floor(q); vec2 fq = fract(q) - 0.5;
      vec2 o = vec2(hash12(id), hash12(id + 5.3)) - 0.5; float ph = fract(uTime*0.8 + hash12(id + 9.1));
      vec2 d = fq - o*0.5; float r = length(d), rr = 0.45*ph;
      float ring = sin((r - rr)*55.0)*smoothstep(0.07, 0.0, abs(r - rr))*(1.0 - ph);
      g += d/(r + 1e-4)*ring;
    }
    slope += g*uWeather.z*0.22*exp(-t*0.06);
  }
  float var = (wa*wa*max(A.w - dot(A.yz,A.yz), 0.0) + wb*wb*WB*WB*max(B.w - dot(B.yz,B.yz), 0.0))*uWaveK*uWaveK;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  float dist = t;

  vec3 v = -wd;
  float nv = dot(n, v);
  if (nv < 0.02) { n = normalize(n + v*(0.02-nv)); nv = dot(n,v); }
  float F = fresnel(nv, IOR);

  // ---- reflection ----
  vec3 rr = reflect(wd, n); rr.y = abs(rr.y);
  // the distant shore in the reflection is blurred and faded: waves break a sharp mirror image into a blotchy band
  vec3 refl = sky(rr, 0.012) * 1.25;

  // sun glints: GGX with slope-variance widening (LEAN-style)
  float a2 = 0.00012 + 1.2*var;
  vec3 h = normalize(v + uSun);
  float nh = max(dot(n,h),0.0), nl = max(dot(n,uSun),0.0);
  float c2 = max(nh*nh, 1e-4); float tan2 = (1.0-c2)/c2;
  float D = exp(-tan2/a2)/(PI*a2*c2*c2);             // Beckmann: no long GGX tail, crisp glints
  float Vis = 0.5/(nl*sqrt(nv*nv*(1.0-a2)+a2) + nv*sqrt(nl*nl*(1.0-a2)+a2) + 1e-5);
  float Fh = fresnel(max(dot(h,v),0.0), IOR);
  vec3 spec = SUN * min(D*Vis*Fh*nl, 12000.0) * 0.183;   // sun glitter on the waves: toned down to a third for readability

  // ---- refraction / underwater ----
  vec3 tr = refract(wd, n, 1.0/IOR);
  float fy = -floorDepth(P.xz);
  float s = (fy - P.y)/tr.y; vec3 FP = P + tr*s;
  for (int i=0;i<2;i++){ fy = -floorDepth(FP.xz); s = (fy - P.y)/tr.y; FP = P + tr*s; }
  s = max(s, 0.0);

  vec3 sunT = refract(-uSun, vec3(0,1,0), 1.0/IOR);
  float Ts = 1.0 - fresnel(uSun.y, IOR);
  vec3 skyIrr = vec3(0.62, 0.70, 0.78) * PI * 0.22 * uSkyK;

  vec3 oN, oAlb; float oSpec;
  float so = dist < 60.0 ? traceObjects(P, tr, s, oN, oAlb, oSpec) : -1.0;
  float sHit = so > 0.0 ? so : s;
  vec3 X = P + tr*sHit;
  float depthHere = max(P.y - X.y, 0.0);
  vec3 Lsurf;

  if (so > 0.0){
    // lit like the seabed: attenuated sun with caustics (less focused near the surface), sky fill, a wet sheen
    float dep = max(-X.y, 0.0);
    float focus = clamp(dep/uDepth, 0.0, 1.0);
    vec3 caus = mix(vec3(1.0), texture(uCaus, (X.xz - uCausShift*focus)/uL, 1.0).rgb, focus);
    vec3 att = exp(-SIG_T*dep/(-sunT.y));
    float ndl = max(dot(oN, -sunT), 0.0);
    vec3 Esun = SUN*Ts*att*caus*ndl;
    vec3 Esky = skyIrr*exp(-(SIG_A + 0.4*SIG_S)*dep*1.25)*(0.45 + 0.55*oN.y);
    Lsurf = oAlb/PI*(Esun + Esky);
    vec3 hh = normalize(-sunT - tr);
    Lsurf += oSpec * SUN*Ts*att*caus * pow(max(dot(oN,hh),0.0), 48.0) * 0.35;
    Lsurf += oSpec * skyIrr * 0.04 * pow(1.0 - max(dot(oN, -tr), 0.0), 3.0);   // rim sheen
    if (lureHit) Lsurf += oAlb*0.35 + vec3(0.02);   // game aid: the lure stays readable deep down
  } else {
    float hgt; vec3 nb; vec3 alb = bedAlbedo(FP.xz, depthHere, hgt, nb);
    // relief: nudge caustic lookup by pseudo height along the sun path; darken gaps a little
    vec2 cuv = (FP.xz - uCausShift + sunT.xz/(-sunT.y)*(hgt-0.35)*0.05)/uL;
    vec3 caus = texture(uCaus, cuv, 1.0).rgb;
    // touch ripples focus light too: first-order lensing from the local curvature where the sun ray entered
    vec2 S = FP.xz - sunT.xz*depthHere/(-sunT.y);
    float lap = ripAt((S - uRipCenter)/uRipSize + 0.5).a;
    caus *= clamp(1.0/(1.0 + 0.12*depthHere*lap), 0.45, 3.0);
    float ao = mix(0.55, 1.0, smoothstep(0.08, 0.42, hgt));
    float shd = dist < 60.0 ? shadowAt(FP, -sunT) : 1.0;
    vec3 Esun = SUN * Ts * exp(-SIG_T*depthHere/(-sunT.y)) * caus * max(dot(nb, -sunT), 0.0) * mix(0.75, 1.0, ao) * shd;
    vec3 Esky = skyIrr * exp(-(SIG_A + 0.4*SIG_S)*depthHere*1.25) * ao;
    Lsurf = alb/PI * (Esun + Esky) * (1.0 - smoothstep(toVis(50.0), toVis(100.0), depthHere));   // a bed past 100m is lost in the dark
  }

  vec3 Tv = exp(-SIG_T*sHit);
  float cosS = dot(sunT, -tr);
  float g = 0.8; float ph = (1.0-g*g)/(4.0*PI*pow(1.0+g*g-2.0*g*cosS, 1.5));
  vec3 dmid = min(vec3(depthHere*0.5), 0.8/SIG_T);
  vec3 Lmid = SUN*Ts*exp(-SIG_T*dmid/(-sunT.y))*(ph+0.02) + skyIrr*exp(-SIG_A*dmid*1.2)/(4.0*PI);
  vec3 Lin = SIG_S/SIG_T * Lmid * (1.0 - Tv) * 3.2;
  vec3 under = Lsurf*Tv + Lin;
  // suspended specks at three depths: tiny sunlit particles that give the water column volume
  for (int k=0;k<3;k++){
    float dz = 0.22 + 0.38*float(k);
    float tt = dz / max(-tr.y, 0.05);
    vec2 q = (P.xz + tr.xz*tt)*48.0 + vec2(uTime*(0.05+0.03*float(k)), uTime*0.02) + float(k)*17.0;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float r = hash12(id + float(k)*13.1);
    vec2 of = vec2(hash12(id+3.1), hash12(id+7.7)) - 0.5;
    float fw = fwidth(q.x) + fwidth(q.y);
    float dot_ = smoothstep(0.10 + fw, 0.0, length(f - of*0.6)) * step(0.996, r) * step(tt, sHit);
    float fade = exp(-SIG_T.g*tt*2.0) * smoothstep(1.2, 0.3, fw);
    under += dot_ * fade * SUN * Ts * 0.016 * mix(vec3(0.9,1.0,0.95), vec3(0.4,0.35,0.3), step(0.998, r));
  }
  // fishing line below the surface: thin, faintly sunlit nylon
  if (uLnA.w > 0.5){
    vec3 a = uLnA.xyz, ba = uLnB.xyz - a, w0 = P - a;
    float bb = dot(tr, ba), cc = dot(ba, ba), dd = dot(tr, w0), ee = dot(ba, w0);
    float den = max(cc - bb*bb, 1e-6);
    float u = clamp((ee - bb*dd)/den, 0.0, 1.0);
    vec3 q = a + ba*u; float tl = max(dot(q - P, tr), 0.0);
    float dl = length(P + tr*tl - q);
    float pw = (dist + tl)*uPixAng;
    float lw = max(pw*0.9, 0.0008);
    float al = smoothstep(lw, lw*0.25, dl) * clamp(0.0025/pw, 0.25, 0.9) * step(tl, sHit + 0.05);
    vec3 lc = (SUN*Ts*0.03 + skyIrr*0.25) * exp(-SIG_T*(tl + max(-q.y,0.0)));
    under = mix(under, lc, al);
  }

  vec3 col = F*refl + (1.0-F)*under + spec;
  // touch ripples (line, float, splashes): from above the surface reflects little, so the rings would only show
  // on the bed. Their steep flanks catch the sky and the crests a little sun, so they read on the surface too.
  {
    float rs = length(R.yz)*exp(-dist*0.03);
    col += (refl*0.55 + SUN*max(uSun.y, 0.05)*0.004)*smoothstep(0.015, 0.25, rs) + refl*0.12*clamp(R.x*25.0, 0.0, 1.0);
  }

  // boat lamps on the water: a soft pool under each and a shimmering glint streak where the waves reflect it
  for (int i = 0; i < 4; i++){
    if (uLP[i].w <= 0.0) continue;
    vec3 L = uLP[i].xyz - P; float d2 = dot(L, L); vec3 l = L*inversesqrt(d2);
    col += uLC[i]*uLP[i].w*(0.015*max(dot(n, l), 0.0)/(d2 + 0.3) + F*2.2*pow(max(dot(rr, l), 0.0), 220.0));
  }
  // crest translucency (after Tidewater's WaterMaterial): sun shining through thin wave tips glows green-teal,
  // strongest looking toward the sun, side-lit waves a little too
  {
    vec2 vH = normalize(v.xz + 1e-5), lH = normalize(uSun.xz + 1e-5);
    float back = pow(clamp(dot(vH, -lH)*0.6 + 0.4, 0.0, 1.0), 2.5);
    float crest = clamp(hsum*5.0*uWaveK + 0.1, 0.0, 1.0)*(clamp((1.0 - n.y)*4.0, 0.0, 1.0) + 0.25);
    col += SUN*Ts*vec3(0.12, 0.55, 0.45)*0.05*back*crest*smoothstep(0.0, 0.25, uSun.y)*(1.0 - F)*exp(-dist*0.01);
  }
  // whitecaps: in wind or a rough sea the steepest crests break into foam
  {
    float wind = max(uWeather.w - 0.25, 0.0)*1.4 + max(uWaveK - 1.4, 0.0)*0.5;
    if (wind > 0.0 && dist < 80.0){
      float steep = length(slope)/max(uWaveK, 0.5);
      float br = vnoise(P.xz*2.3 + uTime*vec2(0.3, -0.2))*0.6 + vnoise(P.xz*7.0 - uTime*0.5)*0.4;
      float wc = smoothstep(0.30, 0.55, steep*(0.7 + 0.6*br))*min(wind, 1.0)*smoothstep(80.0, 20.0, dist);
      vec3 foamC = 0.8/PI*(SUN*max(uSun.y, 0.05) + skyIrr*2.2);
      col = mix(col, foamC, wc*0.75);
    }
  }
  // wake foam: broken white water on the track and the arms near the boat
  if (wk.y > 0.01){
    float br = vnoise(P.xz*3.1 + uTime*vec2(0.35, -0.25))*0.7 + vnoise(P.xz*9.0 - uTime*0.4)*0.3;
    float fm = clamp(wk.y*(0.25 + 1.1*br) - 0.08, 0.0, 0.85);
    vec3 foamL = 0.75/PI*(SUN*max(uSun.y, 0.05) + skyIrr*2.2);
    col = mix(col, foamL, fm);
  }

  // distant haze over the water
  float haze = 1.0 - exp(-dist*0.004*(1.0 + 12.0*uWeather.y + 2.0*uWeather.z));
  float muh = max(dot(normalize(vec3(wd.x,0.0,wd.z)), uSun), 0.0);
  vec3 hazeC = (vec3(0.60, 0.71, 0.82) + vec3(1.0,0.86,0.66)*(0.22*pow(muh,6.0)+0.3*pow(muh,64.0))*(1.0 - uWeather.x))*uSkyK;
  hazeC = mix(hazeC, vec3(0.68, 0.70, 0.72)*uSkyK, max(uWeather.x, uWeather.y)*0.8);
  col = mix(col, hazeC*0.95, haze*(0.8 + 0.18*uWeather.y));

  // sky above horizon
  vec3 skyc = sky(rd, 0.0);
  float mu = dot(rd, uSun);
  skyc += SUN*18.0*smoothstep(0.99996, 0.999985, mu)*(1.0 - uWeather.x)*(1.0 - gLand)*(1.0 - 0.9*gCloud);
  float hz = smoothstep(-0.0005, 0.0015, rd.y);
  col = mix(col, skyc, hz);

  o = vec4(max(col, 0.0), 1.0);

  // depth for the rasterised boat / rod / float; no water inside the hull
  vec2 bl = P.xz - uBoat.xz; mat3 Bh = hullFrame();
  vec2 hl = vec2(dot(bl, Bh[0].xz)/HULL.x, dot(bl, Bh[2].xz)/HULL.z);
  float dz = max(dot(P - uCam, uF), ${ZNEAR});
  float zn = ${ZA.toFixed(8)} + (${ZB.toFixed(8)})/dz;
  gl_FragDepth = (hz > 0.5 || dot(hl,hl) < 1.0) ? 1.0 : clamp(zn*0.5+0.5, 0.0, 0.999999);
}`, 'water');


/* ---------------- Post: glare streaks + bloom + tonemap ---------------- */
const pBright = prog(VS, HEAD+`
uniform sampler2D uSrc; uniform float uThr;
void main(){
  vec2 px = 1.0/vec2(textureSize(uSrc,0));
  vec3 c = vec3(0);
  for (int y=-1;y<=2;y++) for (int x=-1;x<=2;x++) c += texture(uSrc, vUv + (vec2(x,y)-0.5)*px*1.0).rgb;
  c /= 16.0;
  float l = max(max(c.r,c.g),c.b);
  float k = max(l - uThr, 0.0) / max(l, 1e-4);
  o = vec4(min(c*k, vec3(160.0)), 1);
}`, 'bright');
const pStreak = prog(VS, HEAD+`
uniform sampler2D uSrc; uniform vec2 uDir; uniform float uStep, uAtt;
void main(){
  vec2 px = 1.0/vec2(textureSize(uSrc,0));
  vec3 c = vec3(0); float ws = 0.0;
  for (int s=0;s<4;s++){ float w = pow(uAtt, uStep*float(s)); c += w*texture(uSrc, vUv + uDir*px*uStep*float(s)).rgb; ws += w; }
  o = vec4(c/ws, 1);
}`, 'streak');
const pBlur = prog(VS, HEAD+`
uniform sampler2D uSrc; uniform vec2 uDir;
void main(){
  vec2 px = uDir/vec2(textureSize(uSrc,0));
  vec3 c = texture(uSrc, vUv).rgb*0.2270270270;
  c += (texture(uSrc, vUv+px*1.3846153846).rgb + texture(uSrc, vUv-px*1.3846153846).rgb)*0.3162162162;
  c += (texture(uSrc, vUv+px*3.2307692308).rgb + texture(uSrc, vUv-px*3.2307692308).rgb)*0.0702702703;
  o = vec4(c,1);
}`, 'blur');
const pCopy = prog(VS, HEAD+`uniform sampler2D uSrc; uniform float uK; void main(){ o = vec4(texture(uSrc,vUv).rgb*uK,1); }`, 'copy');
const pRaw = prog(VS, HEAD+`uniform sampler2D uSrc; void main(){ o = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); }`, 'raw');
const pFinal = prog(VS, HEAD+`
uniform sampler2D uHdr, uStreak, uB1, uB2; uniform float uExp, uTime, uNoPost; uniform vec2 uRes;
vec3 bicubic(sampler2D t, vec2 uv){
  vec2 ts = vec2(textureSize(t,0)); vec2 p = uv*ts - 0.5; vec2 f = fract(p); p = floor(p);
  vec2 w0 = f*(-0.5+f*(1.0-0.5*f)), w1 = 1.0+f*f*(-2.5+1.5*f), w2 = f*(0.5+f*(2.0-1.5*f)), w3 = f*f*(-0.5+0.5*f);
  vec2 g0 = w0+w1, g1 = w2+w3; vec2 h0 = (w1/g0 - 0.5 + p)/ts, h1 = (w3/g1 + 1.5 + p)/ts;
  return (texture(t, vec2(h0.x,h0.y)).rgb*g0.x + texture(t, vec2(h1.x,h0.y)).rgb*g1.x)*g0.y + (texture(t, vec2(h0.x,h1.y)).rgb*g0.x + texture(t, vec2(h1.x,h1.y)).rgb*g1.x)*g1.y;
}
vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.,1.); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 uv = vUv;
  // faint lateral chromatic aberration, like a phone lens
  vec2 cc = uv-0.5; float ca = 0.0012*dot(cc,cc)*4.0;
  vec3 c;
  c.r = texture(uHdr, uv + cc*ca).r; c.g = texture(uHdr, uv).g; c.b = texture(uHdr, uv - cc*ca).b;
  if (uNoPost < 0.5) c += texture(uStreak, uv).rgb * 0.35;
  if (uNoPost < 0.5) c += texture(uB1, uv).rgb * 0.022 + bicubic(uB2, uv) * 0.022;
  if (uNoPost > 1.5) c = texture(uStreak, uv).rgb * 0.55 * 20.0;
  c *= uExp;
  float vig = 1.0 - 0.22*dot(cc*vec2(1.0,0.8), cc*vec2(1.0,0.8))*2.2;
  c *= vig;
  c = aces(c);
  float lum = dot(c, vec3(0.2126,0.7152,0.0722));
  c = mix(vec3(lum), c, 0.90);
  c = mix(c, c*vec3(0.96,1.0,1.05), 1.0 - smoothstep(0.0, 0.35, lum));
  c = pow(c, vec3(1.0/2.2));
  float g = hash(gl_FragCoord.xy + fract(uTime*7.13)*917.0) - 0.5;
  c += g * 0.018 * (1.0 - c*0.6);
  o = vec4(c, 1);
}`, 'final');


/* ---------------- Lens diffraction glare ----------------
   The star around each sun glint is the lens aperture's diffraction pattern (its Fourier transform),
   integrated over wavelengths so the spikes carry faint rainbow tints. The bright image is convolved
   with it by FFT every frame, so the cost does not depend on how many glints there are. */
const GLARE_ON = !!extF32 && !Q.has('noglare') && !LITE && GFX !== 'mid' && CFG.glare !== false;
const pFFTg = prog(VS, HEAD+`
uniform sampler2D uSrc; uniform int uP, uHoriz, uHalf; uniform float uSign;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
void main(){
  ivec2 id = ivec2(gl_FragCoord.xy);
  int j = uHoriz==1 ? id.x : id.y;
  int k = j & (uP-1);
  int i = ((j - (j & (2*uP-1))) >> 1) + k;
  bool y1 = (j & uP) != 0;
  ivec2 a = uHoriz==1 ? ivec2(i, id.y) : ivec2(id.x, i);
  ivec2 b = uHoriz==1 ? ivec2(i+uHalf, id.y) : ivec2(id.x, i+uHalf);
  vec4 x0 = texelFetch(uSrc, a, 0), x1 = texelFetch(uSrc, b, 0);
  float ang = uSign*3.14159265359*float(k)/float(uP);
  vec2 w = vec2(cos(ang), sin(ang));
  vec4 wx = vec4(cmul(w,x1.xy), cmul(w,x1.zw));
  o = y1 ? x0-wx : x0+wx;
}`, 'fftGlare');
const pGSrc = prog(VS, HEAD+`
uniform sampler2D uSrc; uniform float uThr, uWhich;
void main(){
  vec2 px = 1.0/vec2(textureSize(uSrc,0));
  vec2 st = 1.0/vec2(textureSize(uSrc,0)) * vec2(textureSize(uSrc,0)) / vec2(textureSize(uSrc,0));
  vec3 c = vec3(0);
  // 4 bilinear taps = 16 texels, enough for the ~4-5x downscale
  for (int y=0;y<2;y++) for (int x=0;x<2;x++) c += texture(uSrc, vUv + (vec2(x,y)-0.5)*px*2.0).rgb;
  c *= 0.25;
  float l = max(max(c.r,c.g),c.b);
  c *= max(l - uThr, 0.0)/max(l, 1e-4);
  c = min(c, vec3(80000.0)) * 1e-3;
  o = uWhich < 0.5 ? vec4(c.r, 0.0, c.g, 0.0) : vec4(c.b, 0.0, 0.0, 0.0);
}`, 'glareSrc');
const pGMul = prog(VS, HEAD+`
uniform sampler2D uSrc, uK;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
void main(){ ivec2 id = ivec2(gl_FragCoord.xy); vec4 a = texelFetch(uSrc,id,0), k = texelFetch(uK,id,0); o = vec4(cmul(a.xy,k.xy), cmul(a.zw,k.zw)); }`, 'glareMul');
const pGOut = prog(VS, HEAD+`
uniform sampler2D uA, uB; uniform vec2 uScale;
void main(){ ivec2 id = ivec2(gl_FragCoord.xy); vec4 a = texelFetch(uA,id,0), b = texelFetch(uB,id,0);
  o = vec4(max(vec3(a.x, a.z, b.x), 0.0)*1e3, 1); }`, 'glareOut');

function fft1(re, im, n, inv){
  for (let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit;
    if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for (let len=2; len<=n; len<<=1){
    const ang=2*Math.PI/len*(inv?1:-1), wr=Math.cos(ang), wi=Math.sin(ang), h=len>>1;
    for (let i=0;i<n;i+=len){ let cr=1, ci=0;
      for (let k=0;k<h;k++){ const a=i+k, b=a+h; const xr=re[b]*cr-im[b]*ci, xi=re[b]*ci+im[b]*cr;
        re[b]=re[a]-xr; im[b]=im[a]-xi; re[a]+=xr; im[a]+=xi; const t=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=t; } } }
}
function fft2(re, im, w, h, inv){
  const rr=new Float32Array(w), ri=new Float32Array(w);
  for (let y=0;y<h;y++){ const o=y*w; rr.set(re.subarray(o,o+w)); ri.set(im.subarray(o,o+w)); fft1(rr,ri,w,inv); re.set(rr,o); im.set(ri,o); }
  const cr=new Float32Array(h), ci=new Float32Array(h);
  for (let x=0;x<w;x++){ for (let y=0;y<h;y++){ cr[y]=re[y*w+x]; ci[y]=im[y*w+x]; } fft1(cr,ci,h,inv); for (let y=0;y<h;y++){ re[y*w+x]=cr[y]; im[y*w+x]=ci[y]; } }
}
// Aperture: round lens with slightly flattened hexagonal edge, two hairline scratches and a few dust specks.
let PSF = null;
function buildPSF(){
  const n = 512, R = n*0.11, SS = 3, D = Math.PI/180;
  const re = new Float32Array(n*n), im = new Float32Array(n*n);
  const flats = [0,1,2,3,4,5].map(k => (15 + k*60)*D);
  const scratches = [ {a:21*D, o:0.12*R, w:2.2}, {a:22.5*D, o:-0.38*R, w:1.6}, {a:19*D, o:0.55*R, w:1.2}, {a:152*D, o:0.25*R, w:1.0}, {a:84*D, o:-0.2*R, w:0.8} ];
  const r2 = mulberry(3); const dust = Array.from({length:7}, () => ({x:(r2()-0.5)*1.4*R, y:(r2()-0.5)*1.4*R, r:(0.015+0.03*r2())*R}));
  for (let y=0;y<n;y++) for (let x=0;x<n;x++){
    let acc = 0;
    for (let sy=0; sy<SS; sy++) for (let sx=0; sx<SS; sx++){
      const dx = x - n/2 + (sx+0.5)/SS - 0.5, dy = y - n/2 + (sy+0.5)/SS - 0.5;
      if (dx*dx+dy*dy > R*R) continue;
      let ok = true;
      for (const f of flats) if (dx*Math.cos(f)+dy*Math.sin(f) > R*0.955) { ok=false; break; }
      if (ok) for (const sc of scratches) if (Math.abs(dx*Math.cos(sc.a)+dy*Math.sin(sc.a) - sc.o) < sc.w*0.5) { ok=false; break; }
      if (ok) for (const d of dust) if ((dx-d.x)**2+(dy-d.y)**2 < d.r*d.r) { ok=false; break; }
      if (ok) acc++;
    }
    re[y*n+x] = acc/(SS*SS);
  }
  fft2(re, im, n, n, false);
  const P = new Float32Array(n*n);
  for (let y=0;y<n;y++) for (let x=0;x<n;x++){ const i=((y+n/2)%n)*n + ((x+n/2)%n); P[y*n+x] = re[i]*re[i]+im[i]*im[i]; }
  // integrate over the visible spectrum: the pattern scales with wavelength
  const bands = [[440,[0.10,0.00,0.85]],[470,[0.00,0.15,1.00]],[500,[0.00,0.60,0.55]],[530,[0.05,1.00,0.15]],[560,[0.45,0.95,0.00]],[590,[0.95,0.55,0.00]],[620,[1.00,0.20,0.00]],[650,[0.70,0.05,0.00]]];
  const out = new Float32Array(n*n*3), sum=[0,0,0];
  const samp = (u,v) => { if (u<0||v<0||u>=n-1||v>=n-1) return 0; const x0=u|0, y0=v|0, fx=u-x0, fy=v-y0, i=y0*n+x0;
    return (P[i]*(1-fx)+P[i+1]*fx)*(1-fy) + (P[i+n]*(1-fx)+P[i+n+1]*fx)*fy; };
  for (const [lam, w] of bands){ const s = lam/550;
    for (let y=0;y<n;y++) for (let x=0;x<n;x++){ const v = samp(n/2+(x-n/2)/s, n/2+(y-n/2)/s)/(s*s); const o=(y*n+x)*3;
      out[o]+=v*w[0]; out[o+1]+=v*w[1]; out[o+2]+=v*w[2]; } }
  // phone lenses flare harder than an ideal aperture: lift the far field relative to the core
  for (let y=0;y<n;y++) for (let x=0;x<n;x++){ const r = Math.hypot(x-n/2, y-n/2); const w = 1 + 7*Math.min(1, Math.max(0, (r-3)/30)); const o=(y*n+x)*3; out[o]*=w; out[o+1]*=w; out[o+2]*=w; }
  for (let i=0;i<n*n;i++) for (let c=0;c<3;c++) sum[c]+=out[i*3+c];
  for (let i=0;i<n*n;i++) for (let c=0;c<3;c++) out[i*3+c]/=sum[c];
  PSF = { n, rgb: out };
}
let glareTick = 0, gX=0, gY=0, gSW=0, gSH=0, gA=[], gB=[], gK1=null, gK2=null;
function allocGlare(){
  for (const r of [...gA, ...gB]) { gl.deleteTexture(r.t); gl.deleteFramebuffer(r.fb); }
  if (gK1) { gl.deleteTexture(gK1); gl.deleteTexture(gK2); }
  gX = W>=H ? 512 : 256; gY = W>=H ? 256 : 512;
  // fit the frame inside ~75% of the grid so the spikes have room to fade before wrapping around
  const f = Math.min(gX*0.75/W, gY*0.75/H); gSW = Math.max(1, Math.round(W*f)); gSH = Math.max(1, Math.round(H*f));
  gA = [0,1].map(()=>rt(gX,gY,FFT_FMT,{filter:gl.NEAREST})); gB = [0,1].map(()=>rt(gX,gY,FFT_FMT,{filter:gl.NEAREST}));
  if (!PSF) buildPSF();
  // resample the PSF onto the grid: its full width spans ~1.15x the frame height
  const n = PSF.n, KH = 1.15*gSH, sc = n/KH;
  const kr = [0,1,2].map(()=>({re:new Float32Array(gX*gY), im:new Float32Array(gX*gY)}));
  const tot=[0,0,0];
  for (let gy=-gY/2; gy<gY/2; gy++) for (let gx=-gX/2; gx<gX/2; gx++){
    const u = n/2 + gx*sc, v = n/2 + gy*sc; if (u<0||v<0||u>=n-1||v>=n-1) continue;
    const x0=u|0, y0=v|0, fx=u-x0, fy=v-y0, i=((gy+gY)%gY)*gX + ((gx+gX)%gX);
    for (let c=0;c<3;c++){ const P = PSF.rgb, a=(y0*n+x0)*3+c;
      const val = (P[a]*(1-fx)+P[a+3]*fx)*(1-fy) + (P[a+n*3]*(1-fx)+P[a+n*3+3]*fx)*fy;
      kr[c].re[i] = val; tot[c] += val; } }
  const norm = 1/(gX*gY);
  for (let c=0;c<3;c++){ for (let i=0;i<gX*gY;i++) kr[c].re[i] *= norm/tot[c]; fft2(kr[c].re, kr[c].im, gX, gY, false); }
  const d1 = new Float32Array(gX*gY*4), d2 = new Float32Array(gX*gY*4);
  for (let i=0;i<gX*gY;i++){ d1[i*4]=kr[0].re[i]; d1[i*4+1]=kr[0].im[i]; d1[i*4+2]=kr[1].re[i]; d1[i*4+3]=kr[1].im[i]; d2[i*4]=kr[2].re[i]; d2[i*4+1]=kr[2].im[i]; }
  gK1 = tex(gX,gY,gl.RGBA32F,{filter:gl.NEAREST}); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gX,gY,gl.RGBA,gl.FLOAT,d1);
  gK2 = tex(gX,gY,gl.RGBA32F,{filter:gl.NEAREST}); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gX,gY,gl.RGBA,gl.FLOAT,d2);
}
function fftGrid(pair, sign){
  gl.useProgram(pFFTg.p); gl.uniform1i(pFFTg.u.uSrc,0); gl.uniform1f(pFFTg.u.uSign, sign);
  let src = 0;
  for (const [horiz, len] of [[1,gX],[0,gY]]){
    gl.uniform1i(pFFTg.u.uHoriz, horiz); gl.uniform1i(pFFTg.u.uHalf, len/2);
    for (let p=1; p<len; p<<=1){ target(pair[1-src]); bindT(0, pair[src].t); gl.uniform1i(pFFTg.u.uP, p); fullscreen(); src = 1-src; }
  }
  return src;
}
function renderGlare(){
  gl.disable(gl.BLEND);
  gl.useProgram(pGSrc.p); bindT(0, hdrRT.t); gl.uniform1i(pGSrc.u.uSrc,0); gl.uniform1f(pGSrc.u.uThr, 14.0);
  for (const [pair, which] of [[gA,0],[gB,1]]){
    gl.bindFramebuffer(gl.FRAMEBUFFER, pair[0].fb); gl.viewport(0,0,gX,gY); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0,0,gSW,gSH); gl.uniform1f(pGSrc.u.uWhich, which); fullscreen();
  }
  const res = [];
  for (const [pair, K] of [[gA,gK1],[gB,gK2]]){
    let s = fftGrid(pair, -1);
    target(pair[1-s]); gl.useProgram(pGMul.p); bindT(0, pair[s].t); bindT(1, K); gl.uniform1i(pGMul.u.uSrc,0); gl.uniform1i(pGMul.u.uK,1); fullscreen(); s = 1-s;
    if (s !== 0) { /* fftGrid always starts from index 0: copy back */ target(pair[0]); gl.useProgram(pRaw.p); bindT(0,pair[1].t); gl.uniform1i(pRaw.u.uSrc,0); fullscreen(); }
    res.push(pair[fftGrid(pair, 1)]);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, streakRT.fb); gl.viewport(0,0,streakRT.w,streakRT.h);
  gl.useProgram(pGOut.p); bindT(0,res[0].t); bindT(1,res[1].t); gl.uniform1i(pGOut.u.uA,0); gl.uniform1i(pGOut.u.uB,1); fullscreen();
}
let hdrDepth = null;
let W=0, H=0, scale = 1.0, hdrRT, qA, qS, qB, qC, streakRT, b1, b2, b2t;
const DPR = Math.min(window.devicePixelRatio||1, 2);
// phones (LITE): about 1.1x CSS pixels at most and 30 fps, to keep the GPU (and the phone) cool; ?fps=60 / ?full override
let FPS_CAP = Q.has('fps') ? parseFloat(Q.get('fps')) || 0 : CFG.fps != null ? CFG.fps : (LITE ? 30 : 0);
const Q_MAX = LITE && !Q.has('q') ? (DPR > 1.5 ? 0.55 : 0.8) : 1.0;
let FIXED_RES = Q.has('q') || CFG.res != null;   // a chosen resolution turns the adaptive scaling off
let quality = Q.has('q') ? parseFloat(Q.get('q')) : CFG.res != null ? CFG.res : FIXED_T!==null ? 1.0 : LITE ? Q_MAX : (DPR > 1.5 ? 0.72 : 0.95);
function alloc(){
  const cw = Math.max(1, Math.round(innerWidth*DPR*quality)), ch = Math.max(1, Math.round(innerHeight*DPR*quality));
  if (cw===W && ch===H) return;
  W=cw; H=ch; canvas.width=W; canvas.height=H;
  for (const r of [hdrRT,qA,qS,qB,qC,streakRT,b1,b2,b2t]) if (r){ gl.deleteTexture(r.t); gl.deleteFramebuffer(r.fb); }
  hdrRT = rt(W,H,gl.RGBA16F);
  if (hdrDepth) gl.deleteRenderbuffer(hdrDepth);
  hdrDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, hdrDepth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, hdrRT.fb); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, hdrDepth);
  const qw = Math.max(1,W>>1), qh = Math.max(1,H>>1);
  qA = rt(qw,qh,gl.RGBA16F); qS = rt(qw,qh,gl.RGBA16F); qB = rt(qw,qh,gl.RGBA16F); qC = rt(qw,qh,gl.RGBA16F);
  if (GLARE_ON) { allocGlare(); streakRT = rt(gSW,gSH,gl.RGBA16F); } else { streakRT = rt(4,4,gl.RGBA16F); gl.bindFramebuffer(gl.FRAMEBUFFER, streakRT.fb); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
  b1 = rt(qw,qh,gl.RGBA16F);
  b2 = rt(Math.max(1,qw>>2),Math.max(1,qh>>2),gl.RGBA16F,{}); b2t = rt(b2.w,b2.h,gl.RGBA16F);
}
window.addEventListener('resize', alloc);

function post(t){
  gl.disable(gl.BLEND);
  gl.useProgram(pBright.p); bindT(0,hdrRT.t); gl.uniform1i(pBright.u.uSrc,0);
  target(qA); gl.uniform1f(pBright.u.uThr, 2.5); fullscreen();
  // the glare is the heaviest post step: on phones refresh it every other frame (every third when struggling)
  const every = FIXED_T!==null ? 1 : (quality < 0.55 ? 3 : (DPR > 1.5 ? 2 : 1));
  if (GLARE_ON && (glareTick++ % every === 0)) renderGlare();
  // bloom
  gl.useProgram(pBlur.p); gl.uniform1i(pBlur.u.uSrc,0);
  target(qB); bindT(0,qA.t); gl.uniform2f(pBlur.u.uDir,1,0); fullscreen();
  target(b1); bindT(0,qB.t); gl.uniform2f(pBlur.u.uDir,0,1); fullscreen();
  gl.useProgram(pCopy.p); target(b2); bindT(0,b1.t); gl.uniform1i(pCopy.u.uSrc,0); gl.uniform1f(pCopy.u.uK,1.0); fullscreen();
  gl.useProgram(pBlur.p);
  for (let i=0;i<2;i++){ target(b2t); bindT(0,b2.t); gl.uniform2f(pBlur.u.uDir,1.5,0); fullscreen(); target(b2); bindT(0,b2t.t); gl.uniform2f(pBlur.u.uDir,0,1.5); fullscreen(); }
  // final
  if (Q.get('view')==='caus'){ target(null); gl.useProgram(pCopy.p); bindT(0,causRT.t); gl.uniform1i(pCopy.u.uSrc,0); gl.uniform1f(pCopy.u.uK,0.25); fullscreen(); return; }
  target(null); gl.useProgram(pFinal.p);
  bindT(0,hdrRT.t); bindT(1,streakRT.t); bindT(2,b1.t); bindT(3,b2.t);
  gl.uniform1i(pFinal.u.uHdr,0); gl.uniform1i(pFinal.u.uStreak,1); gl.uniform1i(pFinal.u.uB1,2); gl.uniform1i(pFinal.u.uB2,3);
  gl.uniform1f(pFinal.u.uExp, 0.63*ENV.expo); gl.uniform1f(pFinal.u.uNoPost, Q.get('view')==='nopost'?1:(Q.get('view')==='glare'?2:0)); gl.uniform1f(pFinal.u.uTime, t); gl.uniform2f(pFinal.u.uRes, W, H);
  fullscreen();
}

/* ---------------- Above-water scene: boat, rod, float, line (rasterised, depth-tested against the water) ---------------- */
let SUNV = [0,1,0];
const ENV = { hor: new Float32Array(32).fill(0.04), horD: new Float32Array(32).fill(3), snow: 0, weather:[0,0,0,0], expo:1, sunC:[6,5.4,4.44], skyK:[1,1,1], night:0, sigA:[0.40,0.074,0.088], sigS:[0.028,0.052,0.068], depthP:[2.5,1.0,1.5,3.5], depthQ:[0.02,1.3,0.4,2.4], depthS:[0,0,0,0], bed:[0,1,1,1], land:1, hull:[2.05,0.37,0.72], boat:null, waveK:1 };
function setEnv(e){
  Object.assign(ENV, e);
  const el = (e.sunEl ?? 31)*Math.PI/180, az = (e.sunAz ?? 6)*Math.PI/180;
  SUNV = [Math.sin(az)*Math.cos(el), Math.sin(el), -Math.cos(az)*Math.cos(el)];
}
setEnv({});
// sun / moon by time of day: dayK 1 = noon-ish daylight, 0 = night (moonlight)
function setLight(sunEl, sunAz, dayK, warm){
  const el = sunEl*Math.PI/180, az = sunAz*Math.PI/180;
  if (sunEl > -4){
    SUNV = [Math.sin(az)*Math.cos(Math.max(el, 0.03)), Math.sin(Math.max(el, 0.03)), -Math.cos(az)*Math.cos(Math.max(el, 0.03))];
  } else {   // moon on the other side of the sky
    const me = 35*Math.PI/180; SUNV = [-Math.sin(az)*Math.cos(me), Math.sin(me), Math.cos(az)*Math.cos(me)];
  }
  const k = Math.max(dayK, 0);
  const moon = [0.06, 0.08, 0.13];
  const sun = [6*(1), 5.4*(1 - 0.35*warm), 4.44*(1 - 0.6*warm)];
  const cl = ENV.weather[0];
  ENV.sunC = (sunEl > -4 ? sun.map((v, i) => v*Math.max(0.05, k) + moon[i]*(1-k)) : moon).map(v => v*(1 - 0.8*cl));
  ENV.skyK = [lerp1(0.03, 1 + 0.15*warm, k), lerp1(0.04, 1 - 0.1*warm, k), lerp1(0.09, 1 - 0.3*warm, k)].map(v => v*(1 - 0.25*cl));
  ENV.night = 1 - Math.min(1, k*4);
  ENV.expo = 1 + 2.2*(1 - k);
}
function lerp1(a, b, t){ return a + (b - a)*t; }
// tileable cloud noise (256², R: billowy fbm for the cloud shapes, G: finer detail), built once
const cloudTex = (() => {
  const N = 256, data = new Uint8Array(N*N*2);
  const hash = (x, y, s) => { const h = Math.sin(x*127.1 + y*311.7 + s*74.7)*43758.5453; return h - Math.floor(h); };
  const vn = (x, y, P, s) => {   // periodic value noise, period P cells
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx*fx*(3 - 2*fx), v = fy*fy*(3 - 2*fy);
    const a = hash(((xi % P) + P) % P, ((yi % P) + P) % P, s), b = hash((((xi + 1) % P) + P) % P, ((yi % P) + P) % P, s);
    const c = hash(((xi % P) + P) % P, (((yi + 1) % P) + P) % P, s), d = hash((((xi + 1) % P) + P) % P, (((yi + 1) % P) + P) % P, s);
    return a + (b - a)*u + (c - a)*v + (a - b - c + d)*u*v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    let r = 0, g = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < 5; o++){ const P = 4 << o, k = P/N; r += amp*(1 - Math.abs(2*vn(x*k, y*k, P, o) - 1)*0.6); tot += amp; amp *= 0.5; }
    r /= tot; amp = 0.5; tot = 0;
    for (let o = 0; o < 4; o++){ const P = 16 << o, k = P/N; g += amp*vn(x*k, y*k, P, o + 11); tot += amp; amp *= 0.5; }
    g /= tot;
    const i = (y*N + x)*2; data[i] = Math.round(Math.min(1, Math.max(0, (r - 0.35)*1.9))*255); data[i + 1] = Math.round(g*255);
  }
  const t = tex(N, N, gl.RG8, { wrap: gl.REPEAT, mip: true });
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RG, gl.UNSIGNED_BYTE, data); gl.generateMipmap(gl.TEXTURE_2D);
  return t;
})();
const VFOV = 60*Math.PI/180;


/* ---------------- underwater decor: rocks, coral, weed (rasterised; only seen from below the surface) ---------------- */
const pDecor = prog(`#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; layout(location=3) in float aS;
uniform vec3 uCam, uR, uU, uF; uniform float uTanF, uAspect, uTime; uniform vec2 uSw;
out vec3 vN, vC, vW; out float vS;
void main(){
  vec3 p = aP; vS = aS;   // aS < -0.5: rock (-1 - occlusion); else how far up a swaying blade (0 root .. 1 tip, × flex)
  // plants sway with the swell's surge (after Tidewater's reef sway): three long waves along and across the
  // swell direction, weaker deeper down, plus a little flutter per blade; t² weighting and a droop that
  // roughly keeps the blade length
  if (aS > 0.0){
    vec2 sp = vec2(-uSw.y, uSw.x); float al = dot(p.xz, uSw), ac = dot(p.xz, sp);
    float a = sin(uTime*0.7662 - al*0.0898 + sin(ac*0.021)*1.5)*0.30;
    float b = sin(uTime*1.1855 - al*0.1848 + ac*0.09)*0.10;
    float c = sin(uTime*0.5370 + ac*0.1396)*0.07;
    float ph = uTime*1.7 + p.x*3.1 + p.z*2.3;
    float w = aS*aS, deep = exp(-max(-p.y, 0.0)*0.06);
    vec2 d = ((uSw*(a + b) + sp*c)*1.3*deep + vec2(sin(ph), cos(ph*0.77))*0.07)*w;
    p.xz += d; p.y -= dot(d, d)/(2.0*max(aS*0.9, 0.12));
  }
  vW = p; vN = aN; vC = aC;
  vec3 v = p - uCam; float dz = dot(v, uF);
  gl_Position = vec4(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF, ${ZA.toFixed(8)}*dz + (${ZB.toFixed(8)}), dz);
}`, `#version 300 es
precision highp float;
in vec3 vN, vC, vW; in float vS; out vec4 o;
uniform vec3 uCam, uSkyK, uSigT; uniform float uSea, uL, uDepth; uniform vec2 uCausShift; uniform sampler2D uCaus;
${UWR_GLSL}
float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  vec3 n = normalize(vN), v = normalize(uCam - vW);
  vec3 alb = vC; float ao = 1.0, thin = 0.0;
  if (vS < -0.5){
    // stone after Tidewater's rock shading: three noise scales make the tone, dark joints, lighter faces;
    // algae and pink coralline crusts (sea) or an olive film (fresh water) on the faces that look up
    ao = clamp(-vS - 1.0, 0.0, 1.0);
    float big = n3(vW*0.9), mid = n3(vW*3.1 + 4.0), fine = n3(vW*11.0 + 9.0);
    float hr = big*0.45 + mid*0.35 + fine*0.2;
    float tone = hr*0.9 + (n3(vW*0.37 + 7.0) - 0.5)*0.7 + (mid - 0.5)*0.3;
    vec3 rc = mix(vec3(0.020, 0.019, 0.017), vec3(0.073, 0.066, 0.058), smoothstep(0.1, 0.5, tone));
    rc = mix(rc, vec3(0.195, 0.175, 0.150), smoothstep(0.5, 0.85, tone));
    rc *= smoothstep(0.05, 0.3, big)*0.35 + 0.65;
    rc *= vC/max(dot(vC, vec3(0.3333)), 0.01)*2.4;
    float top = smoothstep(0.35, 0.85, n.y + (big - 0.5)*0.5 + (mid - 0.5)*0.4);
    vec3 grow = uSea > 0.5 ? mix(vec3(0.05, 0.09, 0.02), vec3(0.40, 0.19, 0.21), smoothstep(0.45, 0.7, n3(vW*1.7 + 2.0)))
                           : mix(vec3(0.06, 0.08, 0.025), vec3(0.10, 0.09, 0.04), fine);
    alb = mix(rc, grow*1.6, top*0.8);
  } else if (vS > 0.001){
    // blades: darker toward the root, paler aged tips; thin enough to let light through
    float t = clamp(vS, 0.0, 1.0);
    ao = 0.45 + 0.55*t;
    alb = mix(vC, vec3(0.30, 0.26, 0.12), smoothstep(0.55, 1.0, t)*0.5*n3(vW*7.0));
    thin = 0.55;
  }
  vec3 nf = dot(n, v) < 0.0 ? -n : n;
  float dep = max(-vW.y, 0.0), mu = max(uUWls.y, 0.2);
  vec3 att = exp(-uSigT*dep/mu);
  float focus = clamp(dep/uDepth, 0.0, 1.0);
  vec3 caus = mix(vec3(1.0), texture(uCaus, (vW.xz - uCausShift*focus)/uL, 1.0).rgb, focus);
  vec3 sunL = uUWsun*att*caus;
  vec3 sky = uUWsky*exp(-uSigT*dep*1.2)*(0.55 + 0.45*nf.y);
  alb *= 1.3;   // a little kinder than physics so coral and weed colours read
  vec3 col = alb/3.14159*(sunL*(max(dot(nf, uUWls), 0.0) + thin*(clamp(-dot(nf, uUWls), 0.0, 1.0)*0.8 + 0.2)) + sky)*ao;
  if (uUW.w > 0.5) col = uwFog(col, vW, uCam);
  o = vec4(col, 1);
}`, 'decor');
const decor = { vao: gl.createVertexArray(), vb: gl.createBuffer(), n: 0 };
gl.bindVertexArray(decor.vao); gl.bindBuffer(gl.ARRAY_BUFFER, decor.vb);
for (let i = 0; i < 4; i++){ gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, i === 3 ? 1 : 3, gl.FLOAT, false, 40, i*12); }
gl.bindVertexArray(null);
// unit icosphere (2 subdivisions, 162 vertices / 320 faces) with vertex neighbours, for the rocks
const ICO = (() => {
  const t = (1 + Math.sqrt(5))/2; let v = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(norm3);
  let f = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  for (let k = 0; k < 2; k++){
    const mid = new Map(), m = (a, b) => { const key = a < b ? a + '_' + b : b + '_' + a; if (!mid.has(key)){ mid.set(key, v.length); v.push(norm3([(v[a][0] + v[b][0])/2, (v[a][1] + v[b][1])/2, (v[a][2] + v[b][2])/2])); } return mid.get(key); };
    f = f.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  const nb = v.map(() => new Set());
  for (const [a, b, c] of f){ nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  return { v, f, nb: nb.map(x => [...x]) };
})();
function vn3(x, y, z){   // 3D value noise 0..1
  const h = (i, j, k) => { const q = Math.sin(i*127.1 + j*311.7 + k*74.7)*43758.5453; return q - Math.floor(q); };
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx*fx*(3 - 2*fx); fy = fy*fy*(3 - 2*fy); fz = fz*fz*(3 - 2*fz);
  const L = (a, b, t) => a + (b - a)*t;
  return L(L(L(h(ix,iy,iz), h(ix+1,iy,iz), fx), L(h(ix,iy+1,iz), h(ix+1,iy+1,iz), fx), fy),
           L(L(h(ix,iy,iz+1), h(ix+1,iy,iz+1), fx), L(h(ix,iy+1,iz+1), h(ix+1,iy+1,iz+1), fx), fy), fz);
}
// items: { k: kind, p: [x, y (floor), z], s: size, r: yaw, c: [r,g,b], h: seed }
function buildDecor(items){
  const V = [];
  const put = (p, n, c, sw) => V.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], sw);
  const tri = (a, b, c, na, nb, nc, ca, cb, cc, sa, sb, sc) => { put(a, na, ca, sa); put(b, nb, cb, sb); put(c, nc, cc, sc); };
  const rnd = seed => { let x = Math.sin(seed*127.1)*43758.5453; return () => { x = Math.sin(x*12.9898 + 78.233)*43758.5453; return x - Math.floor(x); }; };
  const blob = (o, rad, col, seg, R, squash, jag, kind = 0) => {   // lumpy ellipsoid (rocks, brain coral)
    const P = (i, j) => { const th = i/seg*Math.PI, ph = j/seg*2*Math.PI, d = 1 + jag*(Math.sin(th*3.1 + R*9)*Math.cos(ph*2 + R*5)*0.6 + Math.sin(ph*5 + th*2 + R*3)*0.4);
      const u = [Math.sin(th)*Math.cos(ph), Math.cos(th), Math.sin(th)*Math.sin(ph)];
      return { p: [o[0] + u[0]*rad[0]*d, o[1] + Math.max(u[1], -0.35)*rad[1]*d*squash, o[2] + u[2]*rad[2]*d], n: norm3([u[0]/rad[0], u[1]/rad[1], u[2]/rad[2]]) }; };
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++){ const a = P(i, j), b = P(i + 1, j), d = P(i, j + 1), e = P(i + 1, j + 1);
      const sh = 0.65 + 0.6*((i*7 + j*3 + Math.floor(R*3)) % 5)/4, c = col.map(v => v*sh);   // blotchy facets stand in for a texture
      tri(a.p, b.p, e.p, a.n, b.n, e.n, c, c, c, kind, kind, kind); tri(a.p, e.p, d.p, a.n, e.n, d.n, c, c, c, kind, kind, kind); }
  };
  const blade = (o, ang, h, w, bend, col, col2, sway) => {   // a flat ribbon of weed/grass, 5 segments, swaying towards the tip
    const dx = Math.cos(ang), dz = Math.sin(ang), nx = -dz, nz = dx; let prev = null;
    for (let i = 0; i <= 5; i++){ const t = i/5, ww = w*(1 - t*0.85), b = bend*t*t;
      const c = [o[0] + dx*b, o[1] + h*t, o[2] + dz*b], l = [c[0] - nx*ww, c[1], c[2] - nz*ww], r = [c[0] + nx*ww, c[1], c[2] + nz*ww];
      const cc = col.map((v, k) => v + (col2[k] - v)*t), n = [dx, 0.25, dz], s = sway*t;
      if (prev){ tri(prev.l, prev.r, r, n, n, n, prev.c, prev.c, cc, prev.s, prev.s, s); tri(prev.l, r, l, n, n, n, prev.c, cc, cc, prev.s, s, s); }
      prev = { l, r, c: cc, s };
    }
  };
  const branch = (a, b, r0, r1, col, sway) => {   // tapered 5-sided tube (coral branches)
    const d = norm3(sub3(b, a)); let X = cross3(d, [0, 1, 0]); if (len3(X) < 1e-3) X = [1, 0, 0]; X = norm3(X); const Y = cross3(X, d);
    for (let k = 0; k < 5; k++){ const a0 = k/5*Math.PI*2, a1 = (k + 1)/5*Math.PI*2;
      const q = (ang, r, o) => [o[0] + (X[0]*Math.cos(ang) + Y[0]*Math.sin(ang))*r, o[1] + (X[1]*Math.cos(ang) + Y[1]*Math.sin(ang))*r, o[2] + (X[2]*Math.cos(ang) + Y[2]*Math.sin(ang))*r];
      const n0 = norm3(sub3(q(a0, 1, [0,0,0]), [0,0,0])), n1 = norm3(q(a1, 1, [0,0,0]));
      const p00 = q(a0, r0, a), p01 = q(a1, r0, a), p10 = q(a0, r1, b), p11 = q(a1, r1, b), c2 = col.map(v => Math.min(1, v*1.25));
      tri(p00, p01, p11, n0, n1, n1, col, col, c2, 0, 0, sway); tri(p00, p11, p10, n0, n1, n0, col, c2, c2, 0, sway, sway);
    }
  };
  // Rocks after Tidewater's RockGeometry: an icosphere cut by random fracture planes (flat broken faces, rounded
  // edges), a little noise for weathering, sunk into the bed; per-vertex cavity occlusion from how far a vertex
  // sits below its neighbours, darker where it meets the ground. aS carries -1 - ao (rock marker + occlusion).
  const rock = (o, rad, col, R, yaw) => {
    const nPl = 9 + Math.floor(R()*4), pl = [];
    for (let q = 0; q < nPl; q++){ const a = R()*Math.PI*2, y = (R()*2 - 1)*0.85, h = Math.sqrt(1 - y*y); pl.push([Math.cos(a)*h, y, Math.sin(a)*h, 0.62 + R()*0.26]); }
    pl.push([0, -1, 0, 0.62 + R()*0.15]);
    const soft = 0.07, rough = 0.055, sd = R()*100, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const r = ICO.v.map(d => {
      let rp = 1.6;
      for (const P of pl){ const k = d[0]*P[0] + d[1]*P[1] + d[2]*P[2]; if (k > 1e-3) rp = Math.min(rp, P[3]/k); }
      const hh = Math.max(soft - Math.abs(1 - rp), 0)/soft;
      return Math.min(1, rp) - hh*hh*soft*0.25 + (vn3(d[0]*2.1 + sd, d[1]*2.1, d[2]*2.1) - 0.5)*rough*1.6 - Math.abs(vn3(d[0]*5.3, d[1]*5.3 + sd, d[2]*5.3) - 0.5)*rough*0.7;
    });
    const P = ICO.v.map((d, i) => { const x = d[0]*r[i]*rad[0], z = d[2]*r[i]*rad[2]; return [o[0] + x*cy - z*sy, o[1] + d[1]*r[i]*rad[1], o[2] + x*sy + z*cy]; });
    const N = P.map(() => [0, 0, 0]);
    for (const [a, b, e] of ICO.f){ const n = cross3(sub3(P[b], P[a]), sub3(P[e], P[a])); for (const i of [a, b, e]){ N[i][0] += n[0]; N[i][1] += n[1]; N[i][2] += n[2]; } }
    const ao = r.map((ri, i) => { let m = 0; for (const j of ICO.nb[i]) m += r[j]; m /= ICO.nb[i].length;
      const low = Math.min(1, Math.max(0, (P[i][1] - o[1] + 0.05*rad[1])/(0.35*rad[1])));   // ground contact
      return Math.max(0.3, Math.min(1, 1 - (m - ri)*9))*(0.55 + 0.45*low); });
    for (const [a, b, e] of ICO.f) tri(P[a], P[b], P[e], norm3(N[a]), norm3(N[b]), norm3(N[e]), col, col, col, -1 - ao[a]*0.98, -1 - ao[b]*0.98, -1 - ao[e]*0.98);
  };
  for (const it of items){
    const R = rnd(it.h), o = it.p, s = it.s, c = it.c;
    if (it.k === 'rock'){ const rad = [s*(0.8 + 0.5*R()), s*(0.5 + 0.45*R()), s*(0.8 + 0.5*R())]; rock([o[0], o[1] + rad[1]*(0.25 - 0.3*R()), o[2]], rad, c, R, it.r); }
    else if (it.k === 'brain') blob(o, [s, s*0.7, s], c, 8, R()*10, 1, 0.08);
    else if (it.k === 'coral'){   // branching coral: a few forks
      const grow = (a, dir, len, r, depth) => { const b = [a[0] + dir[0]*len, a[1] + dir[1]*len, a[2] + dir[2]*len]; branch(a, b, r, r*0.7, c, 0); if (depth > 0) for (let q = 0; q < 2; q++){ const t = R()*Math.PI*2, sp = 0.5 + R()*0.4; grow(b, norm3([dir[0] + Math.cos(t)*sp, dir[1], dir[2] + Math.sin(t)*sp]), len*0.72, r*0.7, depth - 1); } };
      for (let q = 0; q < 3; q++){ const t = R()*Math.PI*2; grow([o[0] + Math.cos(t)*s*0.15, o[1], o[2] + Math.sin(t)*s*0.15], norm3([Math.cos(t)*0.35, 1, Math.sin(t)*0.35]), s*0.45, s*0.07, 2); }
    }
    else if (it.k === 'fan'){   // sea fan: a wide fan of thin swaying blades
      for (let q = 0; q < 9; q++){ const t = -0.9 + q*0.225; blade(o, it.r + Math.PI/2, s*(0.9 + 0.3*R()), s*0.09, s*Math.sin(t)*0.8, c, c.map(v => Math.min(1, v*1.4)), 0.5); }
    }
    else if (it.k === 'grass' || it.k === 'kelp' || it.k === 'reed'){
      // a clump: blades fan out from a few shoots (seagrass meadows after Tidewater: many narrow ribbons)
      const nb = it.k === 'kelp' ? 3 + Math.floor(R()*3) : it.k === 'reed' ? 6 + Math.floor(R()*6) : 16 + Math.floor(R()*12);
      for (let q = 0; q < nb; q++){ const a = R()*Math.PI*2, off = s*(it.k === 'grass' ? 0.45 : 0.25)*Math.sqrt(R());
        const h = it.k === 'kelp' ? s*(2.2 + 1.5*R()) : it.k === 'reed' ? s*(1.2 + 0.8*R()) : s*(0.25 + 0.45*R()), w = it.k === 'kelp' ? s*0.12 : it.k === 'grass' ? s*(0.012 + 0.012*R()) : s*0.035;
        blade([o[0] + Math.cos(a)*off, o[1] - 0.02, o[2] + Math.sin(a)*off], a, h, w, (R() - 0.5)*h*0.5, c, c.map(v => Math.min(1, v*1.5 + 0.03)), it.k === 'reed' ? 0.35 : 1); }
    }
    else if (it.k === 'log') branch([o[0] - Math.cos(it.r)*s, o[1] + 0.08*s, o[2] - Math.sin(it.r)*s], [o[0] + Math.cos(it.r)*s, o[1] + 0.12*s, o[2] + Math.sin(it.r)*s], s*0.14, s*0.11, c, 0);
  }
  const arr = new Float32Array(V);
  gl.bindBuffer(gl.ARRAY_BUFFER, decor.vb); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); decor.n = arr.length/10;
}
function drawDecor(B, t){
  if (!decor.n || !UW.on) return;
  gl.useProgram(pDecor.p); setCamUniforms(pDecor, B); setUW(pDecor);
  const u = pDecor.u, sa = ENV.depthQ[1]*0.5;
  gl.uniform1f(u.uTime, t); gl.uniform3fv(u.uSkyK, ENV.skyK); gl.uniform2f(u.uSw, Math.cos(sa), Math.sin(sa));
  gl.uniform3fv(u.uSigT, ENV.sigA.map((a, i) => a + ENV.sigS[i])); gl.uniform1f(u.uSea, ENV.sea ? 1 : 0);
  gl.uniform1f(u.uL, L); gl.uniform1f(u.uDepth, DEPTH); gl.uniform2fv(u.uCausShift, causShift);
  bindT(1, causRT.t); gl.uniform1i(u.uCaus, 1);
  gl.bindVertexArray(decor.vao); gl.drawArrays(gl.TRIANGLES, 0, decor.n);
}

/* ---------------- marine snow (after Tidewater's MarineSnow): specks in an 8 m box that wraps around the eye ---------------- */
const SNOW_N = 2600;
const pSnow = prog(`#version 300 es
uniform vec3 uCam, uR, uU, uF; uniform float uTanF, uAspect, uTime, uPxK, uDens;
uniform vec3 uSigT, uSunC, uSkyE;
out vec3 vC; out float vA;
void main(){
  float n = float(gl_VertexID);
  vec3 h = fract(sin(vec3(n, n + 17.13, n + 43.71))*vec3(43758.5453, 22578.1459, 19642.3490));
  vec3 h2 = fract(sin(vec3(n + 5.1, n + 9.7, n + 2.3))*vec3(24634.6345, 37241.217, 16271.37));
  const float B = 8.0;
  vec3 drift = vec3(0.05, -0.012, 0.03)*uTime + (h2 - 0.5)*uTime*0.02;
  vec3 local = (fract(h + drift/B - uCam/B) - 0.5)*B, p = uCam + local;
  vec3 v = p - uCam; float dz = dot(v, uF);
  float size = mix(0.003, 0.008, h2.x*h2.x) + (h2.y > 0.98 ? 0.008 : 0.0);
  float px = size*uPxK/max(dz, 0.05);
  vA = smoothstep(B*0.5, B*0.3, length(local))*smoothstep(0.08, 0.3, dz)*smoothstep(0.0, 0.04, -p.y)*min(px*px, 1.0)*step(h.z*1.0, uDens);
  vC = (uSunC*0.1 + uSkyE*1.2)*exp(-uSigT*max(-p.y, 0.0))*vec3(0.9, 1.0, 0.95)*mix(1.3, 0.8, h.x)*0.35;
  gl_PointSize = max(px, 1.0);
  gl_Position = vec4(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF, ${ZA.toFixed(8)}*dz + (${ZB.toFixed(8)}), dz);
}`, `#version 300 es
precision highp float;
in vec3 vC; in float vA; out vec4 o;
void main(){ vec2 q = gl_PointCoord*2.0 - 1.0; float r = dot(q, q); if (r > 1.0 || vA < 0.004) discard; o = vec4(vC, vA*(1.0 - r*0.5)); }`, 'snow');
const snowVAO = gl.createVertexArray();
function drawSnow(B, t){
  if (!UW.on) return;
  gl.useProgram(pSnow.p); setCamUniforms(pSnow, B); const u = pSnow.u;
  gl.uniform1f(u.uTime, t); gl.uniform1f(u.uPxK, H/(2*Math.tan(VFOV/2)));
  // murkier water carries more particles
  const turb = Math.min(1, (ENV.sigS[0] + ENV.sigS[1] + ENV.sigS[2])/0.15);
  gl.uniform1f(u.uDens, 0.45 + 0.55*turb);
  gl.uniform3fv(u.uSigT, ENV.sigA.map((a, i) => a + ENV.sigS[i])); gl.uniform3fv(u.uSunC, UW.sun); gl.uniform3fv(u.uSkyE, UW.sky);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.bindVertexArray(snowVAO); gl.drawArrays(gl.POINTS, 0, SNOW_N);
  gl.depthMask(true); gl.disable(gl.BLEND);
}

const MESH_VS = `#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC;
uniform mat4 uM; uniform vec3 uCam, uR, uU, uF; uniform float uTanF, uAspect;
out vec3 vN, vC, vW;
void main(){
  vec4 w = uM*vec4(aP,1.0); vW = w.xyz; vN = mat3(uM)*aN; vC = aC;
  vec3 v = w.xyz - uCam; float dz = dot(v, uF);
  gl_Position = vec4(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF, ${ZA.toFixed(8)}*dz + (${ZB.toFixed(8)}), dz);
}`;
const pMesh = prog(MESH_VS, `#version 300 es
precision highp float;
in vec3 vN, vC, vW; out vec4 o;
uniform vec3 uSun, uCam, uSunC, uSkyK, uGlow; uniform float uEmis, uInner;
${UWR_GLSL}
uniform vec4 uLP[4]; uniform vec3 uLC[4];   // boat lamps at night: position + intensity, colour
vec3 lampLight(vec3 W, vec3 n, vec3 alb){
  vec3 r = vec3(0.0);
  for (int i = 0; i < 4; i++){
    if (uLP[i].w <= 0.0) continue;
    vec3 L = uLP[i].xyz - W; float d2 = dot(L, L); vec3 l = L*inversesqrt(d2);
    r += alb/3.14159*uLC[i]*uLP[i].w*max(dot(n, l)*0.8 + 0.2, 0.0)/(d2 + 0.08);
  }
  return r;
}
void main(){
  vec3 n = normalize(vN), v = normalize(uCam - vW), c = vC;
  if (dot(n, v) < 0.0){ n = -n; if (uInner > 0.5) c = vec3(0.26,0.16,0.08)*(0.85+0.3*fract(sin(floor(vW.x*9.0+vW.z*1.3)*91.7)*437.5)); }
  vec3 SUN = uSunC;
  float nl = max(dot(n,uSun),0.0);
  vec3 skyE = (vec3(0.62,0.70,0.78)*1.5*(0.55+0.45*n.y) + vec3(0.30,0.40,0.40)*0.5*max(-n.y,0.0))*uSkyK;
  vec3 col = c/3.14159*(SUN*nl + skyE);
  vec3 h = normalize(v+uSun); col += SUN*0.05*pow(max(dot(n,h),0.0),48.0)*nl;
  col += c*uEmis + uGlow + lampLight(vW, n, c);
  if (uUW.w > 0.5) col = uwFog(col*(vW.y > 0.02 ? 0.3 : 1.0), vW, uCam);
  o = vec4(col,1);
}`, 'mesh');
const pLine = prog(`#version 300 es
layout(location=0) in vec3 aP;
uniform vec3 uCam, uR, uU, uF; uniform float uTanF, uAspect;
void main(){ vec3 v = aP - uCam; float dz = dot(v, uF);
  gl_Position = vec4(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF, ${ZA.toFixed(8)}*dz + (${ZB.toFixed(8)}), dz); }`,
`#version 300 es
precision highp float; out vec4 o; uniform vec3 uCol;
void main(){ o = vec4(uCol,1); }`, 'line');

function makeMesh(dynamic){
  const vao = gl.createVertexArray(), vb = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  for (let i=0;i<3;i++){ gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12); }
  gl.bindVertexArray(null);
  const m = { vao, vb, n:0, dynamic };
  m.set = (arr) => { gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, arr, dynamic? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); m.n = arr.length/9; };
  return m;
}
// geometry builder: triangles with per-vertex normal & colour
function Geo(){ this.v = []; }
Geo.prototype.tri = function(a,b,c,na,nb,nc,ca,cb,cc){ this.v.push(...a,...na,...ca, ...b,...nb,...cb, ...c,...nc,...cc); };
Geo.prototype.quad = function(a,b,c,d,n,col){ this.tri(a,b,c,n,n,n,col,col,col); this.tri(a,c,d,n,n,n,col,col,col); };
Geo.prototype.box = function(cx,cy,cz, sx,sy,sz, col){
  const x0=cx-sx, x1=cx+sx, y0=cy-sy, y1=cy+sy, z0=cz-sz, z1=cz+sz;
  this.quad([x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[0,1,0],col);
  this.quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0],col);
  this.quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1],col);
  this.quad([x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0],[0,0,-1],col);
  this.quad([x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1],[1,0,0],col);
  this.quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0],col);
};
// tube along a polyline, radius and colour per point
Geo.prototype.tube = function(pts, radii, cols, sides){
  const up0 = [0,1,0];
  let prevRing = null;
  for (let i=0;i<pts.length;i++){
    const a = pts[Math.max(0,i-1)], b = pts[Math.min(pts.length-1,i+1)];
    const T = norm3(sub3(b,a)); let X = cross3(T, up0); if (len3(X) < 1e-3) X = cross3(T,[1,0,0]); X = norm3(X); const Y = cross3(X, T);
    const ring = [];
    for (let k=0;k<=sides;k++){ const an = k/sides*Math.PI*2, cs=Math.cos(an), sn=Math.sin(an);
      const nn = [X[0]*cs+Y[0]*sn, X[1]*cs+Y[1]*sn, X[2]*cs+Y[2]*sn];
      ring.push({p:[pts[i][0]+nn[0]*radii[i], pts[i][1]+nn[1]*radii[i], pts[i][2]+nn[2]*radii[i]], n:nn, c:cols[i]}); }
    if (prevRing) for (let k=0;k<sides;k++){ const p0=prevRing[k], p1=prevRing[k+1], q0=ring[k], q1=ring[k+1];
      this.tri(p0.p,q0.p,q1.p,p0.n,q0.n,q1.n,p0.c,q0.c,q1.c); this.tri(p0.p,q1.p,p1.p,p0.n,q1.n,p1.n,p0.c,q1.c,p1.c); }
    prevRing = ring;
  }
};
Geo.prototype.ellipsoid = function(c, r, col, seg){
  seg = seg||10;
  const P = (i,j) => { const th = i/seg*Math.PI, ph = j/seg*2*Math.PI; const n=[Math.sin(th)*Math.cos(ph), Math.cos(th), Math.sin(th)*Math.sin(ph)];
    return { p:[c[0]+n[0]*r[0], c[1]+n[1]*r[1], c[2]+n[2]*r[2]], n:norm3([n[0]/r[0], n[1]/r[1], n[2]/r[2]]) }; };
  for (let i=0;i<seg;i++) for (let j=0;j<seg;j++){ const a=P(i,j), b=P(i+1,j), d=P(i,j+1), e=P(i+1,j+1);
    const ca = typeof col === 'function' ? col(a.p) : col;
    this.tri(a.p,b.p,e.p,a.n,b.n,e.n,ca,ca,ca); this.tri(a.p,e.p,d.p,a.n,e.n,d.n,ca,ca,ca); }
};
Geo.prototype.array = function(){ return new Float32Array(this.v); };

function sub3(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function len3(a){ return Math.hypot(a[0],a[1],a[2]); }
function norm3(a){ const l = len3(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; }
function cross3(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot3(a,b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

// Rowboat: the hull below the waterline is exactly the ellipsoid the water shader traces (2.05 x 0.37 x 0.72),
// topped by flared topsides with a sheer line. Local frame: bow toward -z, starboard +x.
function buildBoat(){
  const g = new Geo();
  const NS = 36, NJ = 14, HX = 0.72, HL = 2.05, HD = 0.37, WL = 0.02;
  const grid = [];
  for (let i=0;i<=NS;i++){
    const u = -1 + 2*i/NS; const e = Math.sqrt(Math.max(0, 1-u*u)); const z = u*HL;
    const ring = [];
    const sheer = 0.40 + 0.10*u*u + (u<0? 0.06*u*u : 0);
    const flare = HX*e*1.06 + 0.03*e;
    ring.push({ p:[-flare, sheer, z], c:[0.62,0.12,0.08] });
    ring.push({ p:[-(HX*e*1.03+0.015*e), WL+0.16, z], c:[0.70,0.72,0.70] });
    for (let j=0;j<=NJ;j++){ const th = -Math.PI/2 + Math.PI*j/NJ;
      ring.push({ p:[HX*e*Math.sin(th), WL - HD*e*Math.cos(th), z], c: j===0||j===NJ ? [0.70,0.72,0.70] : [0.06,0.12,0.17] }); }
    ring.push({ p:[(HX*e*1.03+0.015*e), WL+0.16, z], c:[0.70,0.72,0.70] });
    ring.push({ p:[flare, sheer, z], c:[0.62,0.12,0.08] });
    grid.push(ring);
  }
  const M = grid[0].length;
  const nrm = (i,j) => { const a = grid[Math.min(NS,i+1)][j].p, b = grid[Math.max(0,i-1)][j].p, c = grid[i][Math.min(M-1,j+1)].p, d = grid[i][Math.max(0,j-1)].p;
    let n = cross3(sub3(a,b), sub3(c,d)); const p = grid[i][j].p;
    if (n[0]*p[0]/(HX*HX) + n[1]*(p[1]-0.1)/(HD*HD) + n[2]*p[2]/(HL*HL) < 0) n = n.map(x=>-x);   // outward
    return len3(n) < 1e-6 ? [0,0,Math.sign(p[2])||1] : norm3(n); };
  for (let i=0;i<NS;i++) for (let j=0;j<M-1;j++){
    const a=grid[i][j], b=grid[i+1][j], c=grid[i+1][j+1], d=grid[i][j+1];
    g.tri(a.p,b.p,c.p, nrm(i,j),nrm(i+1,j),nrm(i+1,j+1), a.c,b.c,c.c);
    g.tri(a.p,c.p,d.p, nrm(i,j),nrm(i+1,j+1),nrm(i,j+1), a.c,c.c,d.c);
  }
  // gunwale rails
  for (const sd of [-1,1]){
    const pts=[], rad=[], col=[];
    for (let i=1;i<NS;i++){ const u=-1+2*i/NS, e=Math.sqrt(1-u*u); pts.push([sd*(HX*e*1.06+0.03*e), 0.40+0.10*u*u+(u<0?0.06*u*u:0)+0.012, u*HL]); rad.push(0.025); col.push([0.42,0.26,0.12]); }
    g.tube(pts, rad, col, 6);
  }
  // floorboards, thwarts, oarlocks
  const wood = [0.45,0.30,0.16], wood2=[0.38,0.24,0.12];
  for (let k=-4;k<=4;k++) g.box(k*0.075, -0.20, 0.05, 0.03, 0.012, 1.25 - Math.abs(k)*0.06, k%2? wood : wood2);
  g.box(0, 0.24, -0.95, 0.60, 0.02, 0.13, wood);
  g.box(0, 0.24, 0.35, 0.68, 0.02, 0.14, wood);
  g.box(0, 0.24, 1.40, 0.52, 0.02, 0.16, wood);
  for (const z of [-0.95, 0.35, 1.40]) g.box(0, 0.02, z, 0.02, 0.22, 0.02, wood2);
  for (const sd of [-1,1]) g.box(sd*0.70, 0.52, 0.30, 0.012, 0.05, 0.012, [0.35,0.35,0.36]);
  // tackle box and bait can
  g.box(0.30, -0.10, 0.85, 0.16, 0.09, 0.10, [0.10,0.30,0.12]);
  g.box(0.30, -0.005, 0.85, 0.165, 0.012, 0.105, [0.08,0.22,0.10]);
  g.tube([[-0.30,-0.19,0.80],[-0.30,-0.07,0.80]], [0.07,0.07], [[0.55,0.55,0.52],[0.55,0.55,0.52]], 12);
  // anchor rope over the bow
  g.tube([[0,0.47,-1.85],[0.05,0.25,-2.25],[0.08,-0.02,-2.45],[0.1,-0.6,-2.9]], [0.012,0.012,0.012,0.012], [[0.55,0.48,0.32],[0.55,0.48,0.32],[0.55,0.48,0.32],[0.55,0.48,0.32]], 5);
  return g.array();
}
const boatMesh = makeMesh(false); boatMesh.set(buildBoat());

// Textured boat models from .glb (one primitive with a baseColor texture, e.g. Tripo exports), embedded as base64
// so they also load from file://. The fit bakes them into the boat frame: bow toward -z, waterline at y = 0.
const pTexMesh = prog(`#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec2 aT;
uniform mat4 uM; uniform vec3 uCam, uR, uU, uF; uniform float uTanF, uAspect;
out vec3 vN, vW; out vec2 vT;
void main(){
  vec4 w = uM*vec4(aP,1.0); vW = w.xyz; vN = mat3(uM)*aN; vT = aT;
  vec3 v = w.xyz - uCam; float dz = dot(v, uF);
  gl_Position = vec4(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF, ${ZA.toFixed(8)}*dz + (${ZB.toFixed(8)}), dz);
}`, `#version 300 es
precision highp float;
in vec3 vN, vW; in vec2 vT; out vec4 o;
uniform sampler2D uTex; uniform vec3 uSun, uCam, uSunC, uSkyK; uniform float uGain;
${UWR_GLSL}
uniform vec4 uLP[4]; uniform vec3 uLC[4];   // boat lamps at night: position + intensity, colour
vec3 lampLight(vec3 W, vec3 n, vec3 alb){
  vec3 r = vec3(0.0);
  for (int i = 0; i < 4; i++){
    if (uLP[i].w <= 0.0) continue;
    vec3 L = uLP[i].xyz - W; float d2 = dot(L, L); vec3 l = L*inversesqrt(d2);
    r += alb/3.14159*uLC[i]*uLP[i].w*max(dot(n, l)*0.8 + 0.2, 0.0)/(d2 + 0.08);
  }
  return r;
}
void main(){
  vec3 n = normalize(vN), v = normalize(uCam - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 c = texture(uTex, vT).rgb*uGain;
  float nl = max(dot(n,uSun),0.0);
  vec3 skyE = (vec3(0.62,0.70,0.78)*1.5*(0.55+0.45*n.y) + vec3(0.30,0.40,0.40)*0.5*max(-n.y,0.0))*uSkyK;
  vec3 col = c/3.14159*(uSunC*nl + skyE);
  vec3 h = normalize(v+uSun); col += uSunC*0.04*pow(max(dot(n,h),0.0),40.0)*nl + lampLight(vW, n, c);
  // seen from under the water: the hull fades into the water colour with distance; parts above the surface
  // are only glimpsed through the waves
  if (uUW.w > 0.5) col = uwFog(col*(vW.y > 0.02 ? 0.3 : 1.0), vW, uCam);
  o = vec4(col,1);
}`, 'texmesh');
const glbModels = {};
function loadGLB(key, b64, fit){
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), buf = bytes.buffer, dv = new DataView(buf);
  const jl = dv.getUint32(12, true), J = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl))), bin = 20 + jl + 8;
  const acc = i => { const a = J.accessors[i], v = J.bufferViews[a.bufferView], n = { SCALAR:1, VEC2:2, VEC3:3 }[a.type], off = bin + (v.byteOffset||0) + (a.byteOffset||0);
    const T = a.componentType === 5126 ? Float32Array : a.componentType === 5123 ? Uint16Array : a.componentType === 5125 ? Uint32Array : Uint8Array;
    return new T(buf.slice(off, off + a.count*n*T.BYTES_PER_ELEMENT)); };
  const pr = J.meshes[0].primitives[0];
  const P = acc(pr.attributes.POSITION), N = acc(pr.attributes.NORMAL), UV = acc(pr.attributes.TEXCOORD_0), I = acc(pr.indices);
  const s = fit.scale, ct = Math.cos(fit.tilt), st = Math.sin(fit.tilt), nv = P.length/3, V = new Float32Array(nv*8);
  for (let i = 0; i < nv; i++){
    const x = P[i*3]*s, y = P[i*3+1]*s, z = P[i*3+2]*s, nx = N[i*3], ny = N[i*3+1], nz = N[i*3+2];
    V.set([x, y*ct + z*st + fit.lift, -y*st + z*ct + fit.zoff, nx, ny*ct + nz*st, -ny*st + nz*ct, UV[i*2], UV[i*2+1]], i*8);   // bow-down tilt about x
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, V, gl.STATIC_DRAW);
  for (let k = 0; k < 3; k++){ gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, k === 2 ? 2 : 3, gl.FLOAT, false, 32, k*12); }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([60, 64, 70, 255]));
  const m = { vao, n: I.length, type: I instanceof Uint32Array ? gl.UNSIGNED_INT : I instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE, tex: t, gain: fit.gain || 1 };
  glbModels[key] = m;
  const mat = J.materials && J.materials[pr.material], bt = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
  if (bt){
    const im = J.images[J.textures[bt.index].source], v = J.bufferViews[im.bufferView];
    const size = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    createImageBitmap(new Blob([bytes.subarray(bin + (v.byteOffset||0), bin + (v.byteOffset||0) + v.byteLength)], { type: im.mimeType }), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' })
      .then(img => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        if (extAniso) gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      }).catch(() => {});
  }
}
// starter boat: inflatable RIB (b_1.glb, 1 x 0.75 x 0.79 model units)
if (window.BOAT_GLB) try { loadGLB('b1', window.BOAT_GLB, { scale: 3.0, tilt: 0.10, lift: -0.42, zoff: 0, gain: 1.6 }); } catch(e){ console.warn('b_1.glb', e); }
function drawBoat(M){
  const m = ENV.boat && glbModels[ENV.boat];
  if (!m){ drawMesh(boatMesh, M, { inner:true }); return; }
  gl.useProgram(pTexMesh.p); setCamUniforms(pTexMesh, lastBasis);
  gl.uniform3fv(pTexMesh.u.uSun, SUNV); gl.uniform3fv(pTexMesh.u.uSunC, ENV.sunC); gl.uniform3fv(pTexMesh.u.uSkyK, ENV.skyK);
  gl.uniformMatrix4fv(pTexMesh.u.uM, false, M); gl.uniform1f(pTexMesh.u.uGain, m.gain); setUW(pTexMesh); setLamps(pTexMesh);
  gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, m.tex); gl.uniform1i(pTexMesh.u.uTex, 15); gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.n, m.type, 0);
  gl.useProgram(pMesh.p);
}
const bobMesh = makeMesh(true);
{ // float: fluorescent antenna with bands above a slim body; origin at the nominal waterline mark
  const g = new Geo();
  const bands = [[1.0,0.25,0.05],[1.0,0.9,0.1],[0.2,1.0,0.25]];
  const N = 8, top = 0.20, ra = 0.011;
  for (let i=0;i<N;i++){ const y0 = i ? i*top/N : -0.03, y1 = (i+1)*top/N; const c = i===N-1 ? [1.0,0.15,0.05] : bands[i%3];   // the antenna reaches into the body: no gap
    g.tube([[0,y0,0],[0,y1,0]], [ra,ra], [c,c], 8); }
  g.ellipsoid([0,top,0],[ra,0.008,ra],[1.0,0.15,0.05],6);
  g.ellipsoid([0,-0.10,0],[0.017,0.10,0.017], p => p[1] > -0.05 ? [0.9,0.9,0.9] : [0.9,0.25,0.03], 10);
  g.tube([[0,-0.21,0],[0,-0.30,0]], [0.003,0.002], [[0.15,0.15,0.15],[0.15,0.15,0.15]], 5);
  bobMesh.set(g.array());
}
const ballMesh = makeMesh(false);
{ const g = new Geo(); g.ellipsoid([0,0,0],[1,1,1],[1,1,1],10); ballMesh.set(g.array()); }
// spray droplets and mist: soft round point sprites, depth-tested against the water and boat
const pPart = prog(`#version 300 es
layout(location=0) in vec4 aP;   // xyz, size (m)
layout(location=1) in vec4 aV;   // velocity, alpha
layout(location=2) in float aK;  // kind: 0 drop, 1 mist, 3 spray
uniform vec3 uCam, uR, uU, uF; uniform float uTanF, uAspect, uPxH;
out float vA, vK, vHalf, vR; out vec2 vDir;
vec2 ndc(vec3 p){ vec3 v = p - uCam; float dz = max(dot(v, uF), 0.05); return vec2(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF)/dz; }
void main(){ vec3 v = aP.xyz - uCam; float dz = dot(v, uF);
  gl_Position = vec4(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF, ${ZA.toFixed(8)}*dz + (${ZB.toFixed(8)}), dz);
  vK = aK;
  float rPx = aP.w*uPxH/(max(dz, 0.1)*uTanF)*0.5;                     // drop radius in pixels
  // motion blur (Tidewater): the streak a drop draws in 1/40 s (spray 1/30 s); mist is never stretched
  vec2 d = (ndc(aP.xyz + aV.xyz*(aK > 2.5 ? 1.0/30.0 : 1.0/40.0)) - ndc(aP.xyz))*vec2(uPxH*uAspect, uPxH);
  float hl = aK > 0.5 && aK < 1.5 ? 0.0 : min(length(d)*0.5, 60.0);
  vDir = hl > 1e-3 ? normalize(vec2(d.x, -d.y)) : vec2(1.0, 0.0);
  float ext = max(rPx, 0.8);
  float S = clamp(2.0*(hl + ext*2.2), 2.0, 256.0);
  gl_PointSize = S; vHalf = hl/(S*0.5); vR = ext/(S*0.5);
  // sub-pixel drops: opacity follows the water they carry (cross-section spread over the streak)
  float cov = min(1.0, rPx*rPx/(0.8*0.8));
  vA = aV.w*(aK < 0.5 ? cov/(1.0 + hl/max(ext, 0.8)*0.6) : 1.0); }`,
`#version 300 es
precision highp float; in float vA, vK, vHalf, vR; in vec2 vDir; out vec4 o; uniform vec3 uCol;
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
void main(){ vec2 q = gl_PointCoord*2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
  if (vK > 0.5 && vK < 1.5){ o = vec4(uCol, vA*(1.0 - r)*(1.0 - r)); return; }   // mist: soft veil
  float t = clamp(dot(q, vDir), -vHalf, vHalf), dd = length(q - vDir*t)/vR;
  if (vK < 0.5){   // drop: a gaussian streak of clear water, bright with the sky it refracts
    o = vec4(uCol*1.15, vA*exp(-dd*dd*1.6)); return;
  }
  // spray: a see-through white cloud, fibrous along its motion
  float along = dot(q, vDir), across = dot(q, vec2(-vDir.y, vDir.x));
  float fib = 0.55 + 0.45*h21(floor(vec2(across*9.0, along*2.0) + 3.7));
  o = vec4(uCol, vA*exp(-dd*dd*0.9)*fib*0.8); }`, 'particles');
const partVAO = gl.createVertexArray(), partVB = gl.createBuffer();
gl.bindVertexArray(partVAO); gl.bindBuffer(gl.ARRAY_BUFFER, partVB);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,4,gl.FLOAT,false,36,0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,36,16);
gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,36,32);
gl.bindVertexArray(null);
const wakeBuf = new Float32Array(20*4);
const lineVAO = gl.createVertexArray(), lineVB = gl.createBuffer();
gl.bindVertexArray(lineVAO); gl.bindBuffer(gl.ARRAY_BUFFER, lineVB); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0); gl.bindVertexArray(null);

function mat4TRS(p, yaw, pitch, roll, s){
  // world = T * Ry(-yaw) * Rx(pitch) * Rz(roll) * S   (yaw: 0 -> local -z faces world -z)
  s = s===undefined? [1,1,1] : (typeof s === 'number' ? [s,s,s] : s);
  const cy=Math.cos(yaw), sy=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch), cr=Math.cos(roll), sr=Math.sin(roll);
  const Ry = [cy,0,sy, 0,1,0, -sy,0,cy];                     // column-major 3x3: x'=x cy - z sy, z'=x sy + z cy
  const Rx = [1,0,0, 0,cp,sp, 0,-sp,cp];
  const Rz = [cr,sr,0, -sr,cr,0, 0,0,1];
  const mul = (A,B) => { const C = new Array(9); for (let c=0;c<3;c++) for (let r=0;r<3;r++){ let v=0; for (let k=0;k<3;k++) v += A[k*3+r]*B[c*3+k]; C[c*3+r]=v; } return C; };
  const M3 = mul(mul(Ry,Rx),Rz);
  return new Float32Array([M3[0]*s[0],M3[1]*s[0],M3[2]*s[0],0, M3[3]*s[1],M3[4]*s[1],M3[5]*s[1],0, M3[6]*s[2],M3[7]*s[2],M3[8]*s[2],0, p[0],p[1],p[2],1]);
}
const IDENT = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

/* ---------------- fishing rods (models in rodmodel.js, ported from Tidewater) ----------------
   Static geometry per rod; the vertex shader turns the reel's rotor / bail / crank / spool and bends the blank
   toward the line (fast action: the deflection exponent drops as the load grows, so a heavy fish bends it deep). */
const pRod = prog(`#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; layout(location=3) in vec2 aA;
uniform mat4 uM; uniform vec3 uCam, uR, uU, uF; uniform float uTanF, uAspect;
uniform vec4 uRodK;    // rod length, blank start, reel axis z, crank axis y
uniform float uPivot;  // bail pivot height
uniform vec4 uBend;    // bend direction x, z (rod space), bend (tip deflection / length), exponent
uniform vec4 uReel;    // rotor angle, bail open 0..1, crank angle, spool angle
uniform vec4 uReel2;   // spool in/out (m), line left on the spool
out vec3 vN, vC, vW; out float vS;
void main(){
  vec3 P = aP, Nn = aN; float part = aA.x;
  vec3 axisC = vec3(0.0, 0.0, uRodK.z);
  if (part > 0.5){
    if (part < 2.5){
      if (part > 1.5){   // bail flips back about its pivots
        float a = -uReel.y*1.95, ca = cos(a), sa = sin(a); vec3 c = vec3(0.0, uPivot, uRodK.z), q = P - c;
        P = c + vec3(q.x, q.y*ca - q.z*sa, q.y*sa + q.z*ca); Nn = vec3(Nn.x, Nn.y*ca - Nn.z*sa, Nn.y*sa + Nn.z*ca);
      }
      float a = uReel.x, ca = cos(a), sa = sin(a); vec3 q = P - axisC;   // rotor about the reel axis
      P = vec3(q.x*ca + q.z*sa, P.y, -q.x*sa + q.z*ca) + vec3(0.0, 0.0, axisC.z); Nn = vec3(Nn.x*ca + Nn.z*sa, Nn.y, -Nn.x*sa + Nn.z*ca);
    } else if (part < 3.5){   // crank about its shaft
      float a = uReel.z, ca = cos(a), sa = sin(a); vec3 c = vec3(0.0, uRodK.w, uRodK.z), q = P - c;
      P = c + vec3(q.x, q.y*ca - q.z*sa, q.y*sa + q.z*ca); Nn = vec3(Nn.x, Nn.y*ca - Nn.z*sa, Nn.y*sa + Nn.z*ca);
    } else {                  // spool: oscillates with the crank, slips back with the drag; the braid shrinks as line goes out
      vec3 q = P - axisC;
      if (part > 4.5){ float r = length(q.xz), r2 = mix(0.0205, r, uReel2.y); q.xz *= r2/max(r, 1e-5); }
      float a = uReel.w, ca = cos(a), sa = sin(a);
      P = vec3(q.x*ca + q.z*sa, P.y + uReel2.x, -q.x*sa + q.z*ca) + vec3(0.0, 0.0, axisC.z); Nn = vec3(Nn.x*ca + Nn.z*sa, Nn.y, -Nn.x*sa + Nn.z*ca);
    }
  }
  // the blank bends toward the line
  float span = uRodK.x - uRodK.y, s = clamp((P.y - uRodK.y)/span, 0.0, 1.0), pw = uBend.w;
  float lat = uBend.z*uRodK.x*pow(s, pw), slope = uBend.z*uRodK.x*pw*pow(max(s, 1e-4), pw - 1.0)/span;
  float drop = 0.5*lat*lat/(max(P.y - uRodK.y, 0.0) + 0.06);
  vec3 bd = vec3(uBend.x, 0.0, uBend.y);
  P += bd*lat - vec3(0.0, drop, 0.0); Nn = normalize(Nn - vec3(0.0, slope*dot(Nn, bd), 0.0));
  vec4 w = uM*vec4(P, 1.0); vW = w.xyz; vN = mat3(uM)*Nn; vC = aC; vS = aA.y;
  vec3 v = w.xyz - uCam; float dz = dot(v, uF);
  gl_Position = vec4(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF, ${ZA.toFixed(8)}*dz + (${ZB.toFixed(8)}), dz);
}`, `#version 300 es
precision highp float;
in vec3 vN, vC, vW; in float vS; out vec4 o;
uniform vec3 uSun, uCam, uSunC, uSkyK;
uniform vec4 uLP[4]; uniform vec3 uLC[4];   // boat lamps at night: position + intensity, colour
vec3 lampLight(vec3 W, vec3 n, vec3 alb){
  vec3 r = vec3(0.0);
  for (int i = 0; i < 4; i++){
    if (uLP[i].w <= 0.0) continue;
    vec3 L = uLP[i].xyz - W; float d2 = dot(L, L); vec3 l = L*inversesqrt(d2);
    r += alb/3.14159*uLC[i]*uLP[i].w*max(dot(n, l)*0.8 + 0.2, 0.0)/(d2 + 0.08);
  }
  return r;
}
void main(){
  vec3 n = normalize(vN), v = normalize(uCam - vW); if (dot(n, v) < 0.0) n = -n;
  float nl = max(dot(n, uSun), 0.0);
  vec3 skyE = (vec3(0.62,0.70,0.78)*1.5*(0.55 + 0.45*n.y) + vec3(0.30,0.40,0.40)*0.5*max(-n.y, 0.0))*uSkyK;
  vec3 col = vC/3.14159*(uSunC*nl + skyE) + lampLight(vW, n, vC);
  // clear coat / machined metal: a sharp sun highlight and a faint sky reflection, stronger on shiny parts
  vec3 h = normalize(v + uSun); float fr = 0.04 + 0.96*pow(1.0 - max(dot(n, v), 0.0), 5.0);
  col += uSunC*vS*0.35*pow(max(dot(n, h), 0.0), 20.0 + 140.0*vS)*nl;
  vec3 rr = reflect(-v, n); col += vec3(0.55,0.66,0.8)*uSkyK*vS*(0.08 + 0.5*fr)*(0.4 + 0.6*max(rr.y, 0.0));
  o = vec4(col, 1);
}`, 'rod');
// boat lamps (night): red / green side lights at the bow, white stern light on the transom fitting.
// Positions in the boat's model frame (bow toward -z, starboard +x).
const BOAT_LAMPS = [
  { p: [-0.92, 0.55, -1.0], c: [1.0, 0.07, 0.04], i: 0.35, s: 0.09 },
  { p: [0.92, 0.55, -1.0],  c: [0.05, 1.0, 0.3],  i: 0.35, s: 0.09 },
  { p: [0.02, 0.86, 1.05],  c: [1.0, 0.95, 0.85], i: 0.8,  s: 0.11 },   // stern light on the white fitting at the transom
];
const LAMP = { P: new Float32Array(16), C: new Float32Array(12), on: 0, spr: new Float32Array(4*8) };
function updateLamps(M){
  LAMP.on = Math.max(0, Math.min(1, (ENV.night - 0.25)/0.35));
  LAMP.P.fill(0); LAMP.spr.fill(0);   // unused slots stay dark
  for (let k = 0; k < BOAT_LAMPS.length; k++){
    const L = BOAT_LAMPS[k], x = L.p[0], y = L.p[1], z = L.p[2];
    const w = [M[0]*x + M[4]*y + M[8]*z + M[12], M[1]*x + M[5]*y + M[9]*z + M[13], M[2]*x + M[6]*y + M[10]*z + M[14]];
    LAMP.P.set([w[0], w[1], w[2], L.i*LAMP.on], k*4); LAMP.C.set(L.c, k*3);
    LAMP.spr.set([w[0], w[1], w[2], L.s, L.c[0], L.c[1], L.c[2], LAMP.on], k*8);
  }
}
function setLamps(P){ if (P.u.uLP){ gl.uniform4fv(P.u.uLP, LAMP.P); gl.uniform3fv(P.u.uLC, LAMP.C); } }
const pGlow = prog(`#version 300 es
layout(location=0) in vec4 aP; layout(location=1) in vec4 aC;   // xyz, size (m) | colour, strength
uniform vec3 uCam, uR, uU, uF; uniform float uTanF, uAspect, uPxH;
out vec4 vC;
void main(){ vec3 v = aP.xyz - uCam; float dz = dot(v, uF);
  gl_Position = vec4(dot(v,uR)/(uAspect*uTanF), dot(v,uU)/uTanF, ${ZA.toFixed(8)}*dz + (${ZB.toFixed(8)}), dz);
  gl_PointSize = clamp(aP.w*uPxH/(max(dz, 0.1)*uTanF)*4.0, 10.0, 180.0); vC = aC; }`,
`#version 300 es
precision highp float; in vec4 vC; out vec4 o;
void main(){ vec2 q = gl_PointCoord*2.0 - 1.0; float r = length(q); if (r > 1.0) discard;
  float core = exp(-r*r*60.0), halo = exp(-r*4.5)*0.35;
  o = vec4(vC.rgb*(core*6.0 + halo) + vec3(core*2.5), 1.0)*vC.a; }`, 'glow');
const glowVAO = gl.createVertexArray(), glowVB = gl.createBuffer();
gl.bindVertexArray(glowVAO); gl.bindBuffer(gl.ARRAY_BUFFER, glowVB);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
gl.bindVertexArray(null);
function drawLampGlows(B){
  if (LAMP.on <= 0 || UW.on) return;
  gl.useProgram(pGlow.p); setCamUniforms(pGlow, B); gl.uniform1f(pGlow.u.uPxH, H);
  gl.bindVertexArray(glowVAO); gl.bindBuffer(gl.ARRAY_BUFFER, glowVB); gl.bufferData(gl.ARRAY_BUFFER, LAMP.spr, gl.DYNAMIC_DRAW);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
  gl.drawArrays(gl.POINTS, 0, BOAT_LAMPS.length);
  gl.depthMask(true); gl.disable(gl.BLEND); gl.useProgram(pMesh.p);
}
const RODS = {};
function rodGL(kind){
  if (RODS[kind]) return RODS[kind];
  const m = kind === 'pole' ? RodModel.floatPole() : RodModel.spinningRod();
  const vao = gl.createVertexArray(), vb = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.data, gl.STATIC_DRAW);
  const st = RodModel.FL*4;
  for (let i = 0; i < 3; i++){ gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 3, gl.FLOAT, false, st, i*12); }
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, st, 36);
  gl.bindVertexArray(null);
  return RODS[kind] = { ...m, vao, n: m.data.length/RodModel.FL };
}
// r: { kind, hand (world, the reel seat), dir (along the rod), bendDir (world, toward the line), bend, load, reel }
function drawRod(r, B, draw){
  const R = rodGL(r.kind);
  const y = norm3(r.dir); let z = sub3([0, 1, 0], [y[0]*y[1], y[1]*y[1], y[2]*y[1]]); z = len3(z) < 1e-4 ? [0, 0, 1] : norm3(z);
  const x = cross3(y, z);
  const o = sub3(r.hand, [y[0]*R.seat, y[1]*R.seat, y[2]*R.seat]);
  // bend direction in rod space (across the blank)
  let bx = 0, bz = -1;
  if (r.bendDir){ bx = dot3(r.bendDir, x); bz = dot3(r.bendDir, z); const l = Math.hypot(bx, bz); if (l > 1e-5){ bx /= l; bz /= l; } else { bx = 0; bz = -1; } }
  const bend = r.bend || 0, pw = 3.4 + (1.7 - 3.4)*Math.max(0, Math.min(1, r.load || 0));
  const lat = bend*R.L, drop = 0.5*lat*lat/(R.L - R.blankStart + 0.06);
  const tl = [bx*lat, R.L - drop, bz*lat];
  const tip = [o[0] + x[0]*tl[0] + y[0]*tl[1] + z[0]*tl[2], o[1] + x[1]*tl[0] + y[1]*tl[1] + z[1]*tl[2], o[2] + x[2]*tl[0] + y[2]*tl[1] + z[2]*tl[2]];
  if (!draw) return tip;
  gl.useProgram(pRod.p); setCamUniforms(pRod, B);
  gl.uniform3fv(pRod.u.uSun, SUNV); gl.uniform3fv(pRod.u.uSunC, ENV.sunC); gl.uniform3fv(pRod.u.uSkyK, ENV.skyK); setLamps(pRod);
  gl.uniformMatrix4fv(pRod.u.uM, false, new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1]));
  gl.uniform4f(pRod.u.uRodK, R.L, R.blankStart, R.reelZ, R.bodyY); gl.uniform1f(pRod.u.uPivot, R.pivotY);
  gl.uniform4f(pRod.u.uBend, bx, bz, bend, pw);
  const q = r.reel || {};
  gl.uniform4f(pRod.u.uReel, q.rotor || 0, q.bail || 0, q.crank || 0, q.spool || 0);
  gl.uniform4f(pRod.u.uReel2, q.osc || 0, q.fill ?? 1, 0, 0);
  gl.bindVertexArray(R.vao); gl.drawArrays(gl.TRIANGLES, 0, R.n);
  gl.useProgram(pMesh.p);
  return tip;
}

/* ---------------- Public API ---------------- */
alloc();
const drops_pending = [];
let t0 = performance.now(), frames = 0, ftAvg = 16;
let lastBasis = null;

function basisFrom(pos, look){
  const f = norm3(sub3(look, pos));
  let r = cross3(f, [0,1,0]); if (len3(r) < 1e-4) r = [1,0,0]; r = norm3(r);
  const u = cross3(r, f);
  return { pos, f, r, u };
}
// underwater fog for rasterised objects: same water column model as the underwater view (approximate colour)
const UW = { on: 0, sA: [0,0,0], sS: [0,0,0], sun: [0,0,0], sky: [0,0,0], ls: [0,1,0] };
function updateUW(B){
  UW.on = B.pos[1] < -0.03 ? 1 : 0; if (!UW.on) return;
  const n = 1/1.333, ci = Math.max(SUNV[1], 0), k = 1 - n*n*(1 - ci*ci);
  // direction toward the sun below the surface (refracted), and the light that gets in
  const ls = [SUNV[0]*n, Math.sqrt(Math.max(k, 0)), SUNV[2]*n];   // -refract(-sun, up, 1/1.333)
  const l = Math.hypot(ls[0], ls[1], ls[2]) || 1; UW.ls = ls.map(v => v/l);
  const r0 = ((1.333 - 1)/(1.333 + 1))**2, Ts = 1 - (r0 + (1 - r0)*Math.pow(1 - ci, 5));
  UW.sA = ENV.sigA; UW.sS = ENV.sigS.map((v, i) => v + [0.030, 0.026, 0.022][i]);
  UW.sun = ENV.sunC.map(v => v*Ts); UW.sky = [0.62, 0.70, 0.78].map((v, i) => v*Math.PI*0.22*ENV.skyK[i]);
}
function setUW(P){ const u = P.u; gl.uniform4f(u.uUW, 0, 0, 0, UW.on);
  gl.uniform3fv(u.uUWsA, UW.sA); gl.uniform3fv(u.uUWsS, UW.sS); gl.uniform3fv(u.uUWsun, UW.sun); gl.uniform3fv(u.uUWsky, UW.sky); gl.uniform3fv(u.uUWls, UW.ls); }
function drawMesh(m, M, opts){
  if (!m.n) return;
  gl.useProgram(pMesh.p); setUW(pMesh);
  gl.uniformMatrix4fv(pMesh.u.uM, false, M);
  gl.uniform1f(pMesh.u.uEmis, (opts&&opts.emis)||0); gl.uniform1f(pMesh.u.uInner, (opts&&opts.inner)?1:0);
  gl.uniform3fv(pMesh.u.uGlow, (opts&&opts.glow)||[0,0,0]);
  gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES, 0, m.n);
}
function setCamUniforms(P, B){
  gl.uniform3fv(P.u.uCam, B.pos); gl.uniform3fv(P.u.uR, B.r); gl.uniform3fv(P.u.uU, B.u); gl.uniform3fv(P.u.uF, B.f);
  gl.uniform1f(P.u.uTanF, Math.tan(VFOV/2)); gl.uniform1f(P.u.uAspect, W/H);
}

const fishBuf = { P:new Float32Array(MAXF*4), D:new Float32Array(MAXF*4), A:new Float32Array(MAXF*4), B:new Float32Array(MAXF*4), C:new Float32Array(MAXF*4), E:new Float32Array(MAXF*4), G:new Float32Array(MAXF*4) };

function render(S){
  const dt = S.dt, t = S.t;
  if (!pebReady) return false;
  const B = basisFrom(S.cam.pos, S.cam.look); lastBasis = B; updateUW(B);

  runFFT(t*0.9);
  // keep the ripple window centred under the view, snapped to whole texels
  const look = Math.abs(B.pos[1])/Math.max(Math.abs(B.f[1]),0.2);
  const want = [B.pos[0]+B.f[0]*look*0.9, B.pos[2]+B.f[2]*look*0.9];
  const tx = RSIZE/RN;
  const dxT = Math.round((want[0]-ripCenter[0])/tx), dzT = Math.round((want[1]-ripCenter[1])/tx);
  // world-space splashes: queue until they fall inside the (moving) ripple window
  for (let i=drops_pending.length-1;i>=0;i--){
    const d = drops_pending[i];
    const u = (d.x - ripCenter[0])/RSIZE + 0.5, v = (d.z - ripCenter[1])/RSIZE + 0.5;
    if (u>0.06&&u<0.94&&v>0.06&&v<0.94){ drops.push([u, v, d.r/RSIZE, d.s]); drops_pending.splice(i,1); ripActive = 0; }
    else if (--d.ttl <= 0) drops_pending.splice(i,1);
  }
  if (ripActive < 900){
    stepRipples([dxT/RN, dzT/RN]); ripCenter = [ripCenter[0]+dxT*tx, ripCenter[1]+dzT*tx]; ripActive++;
  } else { ripCenter = [ripCenter[0]+dxT*tx, ripCenter[1]+dzT*tx]; }

  renderCaustics(SUNV);

  // ---- water + underwater scene ----
  target(hdrRT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.ALWAYS); gl.depthMask(true);
  gl.disable(gl.BLEND); gl.useProgram(pMain.p);
  bindT(0,surfRT.t); bindT(1,causRT.t); bindT(2,pebTex); bindT(3,ripN.t); bindT(4,cloudTex); bindT(5,fishCTex); bindT(6,fishTTex);
  const u = pMain.u;
  gl.uniform1i(u.uFishC,5); gl.uniform1i(u.uFishT,6);
  gl.uniform1i(u.uSurf,0); gl.uniform1i(u.uCaus,1); gl.uniform1i(u.uPeb,2); gl.uniform1i(u.uRip,3); gl.uniform1i(u.uCloud,4);
  setCamUniforms(pMain, B); gl.uniform3fv(u.uSun, SUNV);
  gl.uniform1f(u.uL, L); gl.uniform1f(u.uWaveK, ENV.waveK); gl.uniform1f(u.uDepth, DEPTH); gl.uniform1f(u.uTime, t);
  gl.uniform1f(u.uRipSize, RSIZE); gl.uniform2fv(u.uRipCenter, ripCenter); gl.uniform2fv(u.uCausShift, causShift);
  gl.uniform1f(u.uPixAng, 2*Math.tan(VFOV/2)/H);
  gl.uniform3fv(u.uSigA, ENV.sigA); gl.uniform3fv(u.uSigS, ENV.sigS); gl.uniform4fv(u.uDepthP, ENV.depthP); gl.uniform4fv(u.uDepthQ, ENV.depthQ); gl.uniform4fv(u.uDepthS, ENV.depthS);
  gl.uniform4fv(u.uBed, ENV.bed); gl.uniform1f(u.uLand, 1.0);
  gl.uniform1fv(u.uHor, ENV.hor); gl.uniform1fv(u.uHorD, ENV.horD); gl.uniform1f(u.uSnow, ENV.snow);
  gl.uniform3fv(u.uSunC, ENV.sunC); gl.uniform4fv(u.uWeather, ENV.weather); gl.uniform3fv(u.uSkyK, ENV.skyK); gl.uniform1f(u.uNight, ENV.night);
  const fl = S.fish.slice(0, MAXF);
  fl.forEach((f,i) => {
    fishBuf.P.set([f.pos[0],f.pos[1],f.pos[2],f.len], i*4);
    fishBuf.D.set([f.dir[0],f.dir[1],f.dir[2],f.tail], i*4);
    fishBuf.A.set([f.back[0],f.back[1],f.back[2],f.pattern], i*4);
    fishBuf.B.set([f.belly[0],f.belly[1],f.belly[2],f.hr], i*4);
    fishBuf.C.set(f.shape || [f.hr*0.55, 0, 1, 1], i*4);
    const ph = fishAtlasN === 2 && FA.sp[f.id];
    fishBuf.E.set(ph ? ph.slice(0, 4) : [0,0,0,0], i*4);
    fishBuf.G.set(ph ? [ph[5] ? -ph[4] : ph[4], f.tailPh || 0, f.tailAmp || 0, ph[5] ? 0 : f.bend || 0] : [0,0,0,0], i*4);
  });
  gl.uniform1i(u.uFishN, fl.length);
  gl.uniform4fv(u.uFP, fishBuf.P); gl.uniform4fv(u.uFD, fishBuf.D); gl.uniform4fv(u.uFA, fishBuf.A); gl.uniform4fv(u.uFB, fishBuf.B); gl.uniform4fv(u.uFC, fishBuf.C); gl.uniform4fv(u.uFE, fishBuf.E); gl.uniform4fv(u.uFG, fishBuf.G);
  const lu = S.lure;
  if (lu && lu.pos[1] < -0.005){
    gl.uniform4f(u.uLure, lu.pos[0], lu.pos[1], lu.pos[2], 1);
    gl.uniform4f(u.uLureD, lu.dir[0], lu.dir[1], lu.dir[2], lu.kind);
    gl.uniform3fv(u.uLureS, lu.size); gl.uniform4f(u.uLureC, lu.color[0], lu.color[1], lu.color[2], lu.metal);
  } else gl.uniform4f(u.uLure, 0,0,0,0);
  const bo = S.bobber;
  if (bo && !bo.flying){ const tl = bo.tilt || 0; gl.uniform4f(u.uBob, bo.pos[0], bo.pos[1] - 0.10*Math.cos(tl), bo.pos[2] - 0.10*Math.sin(tl), 1 + tl); }
  else gl.uniform4f(u.uBob, 0,0,0,0);
  if (S.lineUnder){ gl.uniform4f(u.uLnA, ...S.lineUnder[0], 1); gl.uniform4f(u.uLnB, ...S.lineUnder[1], 1); } else gl.uniform4f(u.uLnA, 0,0,0,0);
  const wk = S.wake || [];
  wakeBuf.fill(0); for (let i = 0; i < Math.min(20, wk.length); i++) wakeBuf.set(wk[i], i*4);
  gl.uniform4fv(u.uWake, wakeBuf); gl.uniform1i(u.uWakeN, Math.min(20, wk.length));
  const bt = S.boat, boatM = mat4TRS(bt.pos, bt.heading, bt.pitch, bt.roll);
  updateLamps(boatM); setLamps(pMain);
  gl.uniform4f(u.uBoat, bt.pos[0], 0.02 + bt.pos[1], bt.pos[2], bt.heading); gl.uniform3fv(u.uHullR, ENV.hull);
  fullscreen();

  // ---- boat, rod, float, line ----
  gl.depthFunc(gl.LESS);
  gl.useProgram(pMesh.p); setCamUniforms(pMesh, B); gl.uniform3fv(pMesh.u.uSun, SUNV); gl.uniform3fv(pMesh.u.uSunC, ENV.sunC); gl.uniform3fv(pMesh.u.uSkyK, ENV.skyK); setLamps(pMesh);
  drawDecor(B, t);
  drawBoat(boatM);
  drawLampGlows(B);
  let tip = null;
  // from under the water the rod and the line above the surface are not drawn: without refraction they pointed off
  // at odd angles; the line is seen only from where it enters the water
  if (S.rod) tip = drawRod(S.rod, B, !S.hideRod && !UW.on);
    // night: glows fluorescent lime like a chemical light stick (야광찌) instead of washing out white
  if (bo) drawMesh(bobMesh, mat4TRS(bo.pos, 0, bo.tilt||0, 0), { emis: 0.55*(1 - 0.9*ENV.night), glow: [0.07*ENV.night, 0.40*ENV.night, 0.012*ENV.night] });
  drawSnow(B, t);
  if (S.rain && S.rain.n && !UW.on){   // no rain streaks below the surface
    gl.useProgram(pLine.p); setCamUniforms(pLine, B);
    const k = 0.35*(ENV.skyK[1] + 0.15); gl.uniform3f(pLine.u.uCol, k, k*1.02, k*1.06);
    gl.bindVertexArray(lineVAO); gl.bindBuffer(gl.ARRAY_BUFFER, lineVB); gl.bufferData(gl.ARRAY_BUFFER, S.rain.data.subarray(0, S.rain.n*6), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, S.rain.n*2);
  }
  if (S.flyObj){ gl.useProgram(pMesh.p); drawMesh(ballMesh, mat4TRS(S.flyObj.pos, 0,0,0, S.flyObj.r)); }
  if (tip && S.lineTo && !UW.on){
    const pts = [], e = S.lineTo, sag = S.lineSag||0;
    for (let i=0;i<=24;i++){ const a=i/24; pts.push(tip[0]+(e[0]-tip[0])*a, tip[1]+(e[1]-tip[1])*a - sag*4*a*(1-a), tip[2]+(e[2]-tip[2])*a); }
    gl.useProgram(pLine.p); setCamUniforms(pLine, B);
    if (B.pos[1] < -0.03){ const k = 0.10*(ENV.sunC[1]/5.4) + 0.05*ENV.skyK[1]; gl.uniform3f(pLine.u.uCol, k*0.75, k*1.25, k*1.2); }   // seen from below: a faint line through the water
    else gl.uniform3f(pLine.u.uCol, 1.6,1.6,1.5);
    gl.bindVertexArray(lineVAO); gl.bindBuffer(gl.ARRAY_BUFFER, lineVB); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    // the above-water line always reads: waves would otherwise swallow its last metre where it meets the water
    gl.disable(gl.DEPTH_TEST); gl.drawArrays(gl.LINE_STRIP, 0, 25); gl.enable(gl.DEPTH_TEST);
  }
  if (S.particles && S.particles.n){
    gl.useProgram(pPart.p); setCamUniforms(pPart, B); gl.uniform1f(pPart.u.uPxH, H*0.5);
    const lum = [ENV.sunC[0]*0.12 + ENV.skyK[0]*0.75, ENV.sunC[1]*0.12 + ENV.skyK[1]*0.78, ENV.sunC[2]*0.12 + ENV.skyK[2]*0.82];
    gl.uniform3fv(pPart.u.uCol, lum);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.bindVertexArray(partVAO); gl.bindBuffer(gl.ARRAY_BUFFER, partVB); gl.bufferData(gl.ARRAY_BUFFER, S.particles.data.subarray(0, S.particles.n*9), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, S.particles.n);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  gl.bindVertexArray(null);
  gl.disable(gl.DEPTH_TEST);
  post(t);

  // adaptive resolution
  // (frames the game deliberately skipped, e.g. behind a menu, are not counted as slow)
  const TF = FPS_CAP ? 1000/FPS_CAP : 16.7;
  if (dt*1000 < TF*2.2){ ftAvg = ftAvg*0.95 + (dt*1000)*0.05; frames++; }
  if (frames > 90 && !FIXED_RES){
    if (ftAvg > TF*1.26 && quality > 0.42){ quality = Math.max(0.42, quality*0.87); alloc(); frames = 0; }
    else if (ftAvg < TF*0.87 && quality < Q_MAX){ quality = Math.min(Q_MAX, quality*1.06); alloc(); frames = 0; }
  }
  if (DEBUG && $dbg && frames%15===0) $dbg.textContent = `${(1000/ftAvg).toFixed(0)} fps · ${W}×${H} · q ${quality.toFixed(2)}`;
  return { tip };
}
const $dbg = document.getElementById('dbg'); if (DEBUG && $dbg) $dbg.hidden = false;

return {
  render,
  get fpsCap(){ return FPS_CAP; },
  get quality(){ return quality; },
  gfxInfo: () => ({ lite: LITE, glare: GLARE_ON, gfx: GFX, fps: FPS_CAP, res: FIXED_RES ? quality : null, w: W, h: H }),
  setFps(n){ FPS_CAP = n; },
  setRes(q){ if (q == null){ FIXED_RES = false; } else { FIXED_RES = true; quality = q; } frames = 0; alloc(); },
  setDebug(on){ DEBUG = on; if ($dbg) $dbg.hidden = !on; },
  setDecor: buildDecor,
  setBoat(key, hull){ ENV.boat = key && glbModels[key] ? key : null; if (hull) ENV.hull = hull; return !!ENV.boat; },
  ready: () => pebReady,
  // radius is kept to at least ~2.5 ripple texels, smaller drops fall between texels and never show
  splash(x, z, r, s){ drops_pending.push({x, z, r: Math.max(r, 2.5*RSIZE/RN), s, ttl: 90}); },
  project(p){
    const B = lastBasis; if (!B) return null;
    const v = sub3(p, B.pos); const dz = v[0]*B.f[0]+v[1]*B.f[1]+v[2]*B.f[2]; if (dz < 0.05) return null;
    const tf = Math.tan(VFOV/2), asp = innerWidth/innerHeight;
    const x = (v[0]*B.r[0]+v[1]*B.r[1]+v[2]*B.r[2])/(dz*tf*asp), y = (v[0]*B.u[0]+v[1]*B.u[1]+v[2]*B.u[2])/(dz*tf);
    return [(x*0.5+0.5)*innerWidth, (0.5-y*0.5)*innerHeight];
  },
  basis: () => lastBasis,
  setEnv, setLight, setWeather(w){ ENV.weather = w; }, setWaves(k){ ENV.waveK = k; },
};

})();
