"use strict";
// 보트 낚시 — game logic: casting, float (대낚시) and lure fishing, fish AI, fight, HUD.
(function(){
const { SPECIES, BY_ID, BIOMES, WATERS, SPOTS, BAITS, LURES, SHOP } = window.GameData;
const Rn = window.Renderer;
const $ = id => document.getElementById(id);
const rand = (a,b) => a + Math.random()*(b-a);
const clamp = (x,a,b) => Math.max(a, Math.min(b, x));
const lerp = (a,b,t) => a + (b-a)*t;
const smooth = t => t*t*(3-2*t);
const TAU = Math.PI*2;
const wrapA = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const add = (a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const mul = (a,s) => [a[0]*s, a[1]*s, a[2]*s];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const vlerp = (a,b,t) => [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)];
const dist2 = (a,b) => Math.hypot(a[0]-b[0], a[2]-b[2]);
const dist3 = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);

// water depth (m, positive) — same large-scale formula as the water shader, driven by the current region
const VIS_DEPTH = 8;        // fish and rigs stay within the sunlit zone you can see into
// Depth scale: the scene is drawn in "screen metres" so everything stays visible, while every number shown and every
// ecology check uses real metres. Near the surface it is ~1:1, deeper it is compressed: real = v·(1 + A·v²)
// (1 m → 1.1 m, 2 → 2.6, 4 → 9, 6 → 23, 8 → 48 m).
const DEPTH_A = 0.078;
function toReal(v){ return v*(1 + DEPTH_A*v*v); }
function toVis(r){   // inverse (Cardano): A·v³ + v − r = 0
  const p = 1/DEPTH_A, q = -r/DEPTH_A, D = Math.sqrt(q*q/4 + p*p*p/27);
  return Math.cbrt(-q/2 + D) + Math.cbrt(-q/2 - D);
}
const fmtD = v => { const r = toReal(Math.max(0, v)); return r < 10 ? r.toFixed(1) : Math.round(r) + ''; };   // screen depth → "12" / "3.4"
let REGION = null;
function floorDepth(x, z){
  const [base, amp, mn, mx] = REGION.depthP, [sc, sx, sz, st] = REGION.depthQ;
  const qx = x*sc, qz = z*sc;
  const n = 0.5*Math.sin(qx + sx)*Math.sin(qz*0.83 + sz) + 0.3*Math.sin((qx*0.7 - qz*0.9)*2.1 + sx*2) + 0.2*Math.sin((qx*1.3 + qz*0.4)*4.3 + sz*3);
  const d = clamp(base + amp*n, mn, mx);
  const t = clamp((Math.hypot(x, z) - 12)/58, 0, 1);
  return toVis(lerp(st, d, t*t*(3 - 2*t)));    // the region data are real depths
}
function column(x, z){ return Math.min(floorDepth(x, z), VIS_DEPTH); }

/* ---------------- setup ---------------- */
const BOAT = { pos:[0,0,0], heading:0, pitch:0, roll:0 };
const HULL = { l:2.05, w:0.72 };
const SEAT = [0, 1.02, 1.30];               // eye position in the boat (sitting on the stern thwart)
// boat model per boat tier: b_1.glb RIB for every tier until the upgrades get their own models (rowboat = fallback if it fails to load)
const BOAT_MODELS = [{ key: 'b1', hull: [1.45, 0.36, 1.08], seat: [0, 1.55, 1.02] }];
const ROWBOAT = { key: null, hull: [2.05, 0.37, 0.72], seat: [0, 1.02, 1.30] };
function applyBoatModel(){
  let m = BOAT_MODELS[P.tier.boat] || BOAT_MODELS[0];   // tiers without their own model use b_1 for now
  if (!Rn.setBoat(m.key, m.hull)){ m = ROWBOAT; Rn.setBoat(null, m.hull); }
  HULL.l = m.hull[0]; HULL.w = m.hull[2]; SEAT.splice(0, 3, ...m.seat);
}
const MODES = {
  pole: { name:'대낚시', rodLen:4.5, minCast:4.0, maxCast:9.0, lineKg:4.0, items:BAITS },
  lure: { name:'루어',   rodLen:2.1, minCast:6.0, maxCast:36.0, lineKg:7.0, items:LURES },
};

const G = {
  time: 0, mode: 'pole', item: { pole:0, lure:0 },
  state: 'idle',             // idle | charge | fly | wait | hooked | result | boat
  clock: 6.0, weather: null, wv: [0, 0, 0, 0.1], weatherT: 5, boatV: 0, boatSteer: 0, camDist: 9, mapOpen: false,
  aimYaw: 0, aimPitch: -0.2, orbit: 0,
  power: 0, chargeT: 0,
  fly: null, rig: null, lure: null, engaged: null, strike: null,
  hooked: null, fight: null,
  drag: 0.55,                // fraction of line strength
  depthSet: 1.6,             // float-to-hook depth (m)
  help: true,
  tip: [0.3, 2.6, -2.5], tipS: [0.3, 2.6, -2.5],
  catches: [], score: 0, best: {},
};
const cam = { pos: [0, 1.02, 1.3], look: [0, 0.3, -8] };
const mouse = { x: innerWidth/2, y: innerHeight/2, down: false, rdown: false, lx: 0, ly: 0, downT: -10 };
const keys = {};

/* ---------------- audio (tiny synth, no assets) ---------------- */
/* ---------------- settings (menu → 환경설정), kept in the browser ---------------- */
const CFG_KEY = 'boatfish.cfg';
const CFG = Object.assign({ gfx: 'auto', res: null, fps: null, glare: true, showFps: false,
  vol: 0.8, sfx: 1, amb: 1, mute: false, tips: true,
  joy: 'm', look: 1, invY: false, lefty: false, pad: true, padSens: 1, dead: 0.18, rumble: true, vibe: true, shake: 0.5 },
  (() => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch(e){ return {}; } })());
function saveCfg(){ try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch(e){} }
const LOOK = () => CFG.look, INV = () => CFG.invY ? -1 : 1;

const AU = { ctx: null, noise: null, reelT: 0, dragT: 0 };
function audioInit(){
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  try {
    AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const n = AU.ctx.sampleRate; const b = AU.ctx.createBuffer(1, n, n); const d = b.getChannelData(0);
    for (let i=0;i<n;i++) d[i] = Math.random()*2-1;
    AU.noise = b;
    // mixer: effects and ambience (rain, engine) buses into a master volume
    const c = AU.ctx; AU.master = c.createGain(); AU.sfx = c.createGain(); AU.amb = c.createGain();
    AU.sfx.connect(AU.master); AU.amb.connect(AU.master); AU.master.connect(c.destination);
    applyVolume();
  } catch(e){ AU.ctx = null; }
}
function applyVolume(){
  if (!AU.master) return;
  AU.master.gain.value = CFG.mute ? 0 : CFG.vol; AU.sfx.gain.value = CFG.sfx; AU.amb.gain.value = CFG.amb;
}
function noise(dur, type, freq, q, gain, attack){
  if (!AU.ctx) return;
  const c = AU.ctx, t = c.currentTime;
  const s = c.createBufferSource(); s.buffer = AU.noise; s.loop = true;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + (attack||0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(AU.sfx); s.start(t, Math.random()*0.5); s.stop(t + dur + 0.05);
}
function tone(freq, dur, gain, type){
  if (!AU.ctx) return;
  const c = AU.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = type||'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq*0.6, t+dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  o.connect(g); g.connect(AU.sfx); o.start(t); o.stop(t+dur+0.02);
}
const sfx = {
  splash: s => { noise(0.25 + 0.5*s, 'lowpass', 700 + 900*s, 0.6, 0.25*s + 0.04, 0.01); noise(0.12, 'bandpass', 2500, 1.2, 0.05*s); },
  plop: () => { tone(420, 0.12, 0.08); noise(0.1, 'lowpass', 1200, 0.7, 0.05); },
  whoosh: p => noise(0.35, 'bandpass', 900 + 1500*p, 1.5, 0.08 + 0.1*p, 0.08),
  click: g => noise(0.018, 'bandpass', 3800, 3, g||0.06),
  drag: () => noise(0.03, 'bandpass', 2600, 6, 0.12),
  snap: () => { noise(0.08, 'highpass', 3000, 0.7, 0.35); tone(1800, 0.1, 0.12, 'square'); },
  hit: () => { tone(660, 0.12, 0.1, 'triangle'); setTimeout(() => tone(880, 0.16, 0.1, 'triangle'), 90); },
  win: () => [523,659,784,1046].forEach((f,i) => setTimeout(() => tone(f, 0.22, 0.08, 'triangle'), i*110)),
};

/* ---------------- helpers ---------------- */
function modeCfg(){ return MODES[G.mode]; }
function curItem(){ return modeCfg().items[G.item[G.mode]]; }
function boatF(){ return [Math.sin(BOAT.heading), 0, -Math.cos(BOAT.heading)]; }
function boatR(){ return [Math.cos(BOAT.heading), 0, Math.sin(BOAT.heading)]; }
function toBoatLocal(x, z){ const dx = x - BOAT.pos[0], dz = z - BOAT.pos[2], f = boatF(), r = boatR(); return [dx*r[0] + dz*r[2], dx*f[0] + dz*f[2]]; }
function boatToWorld(lat, y, back){ const f = boatF(), r = boatR(); return [BOAT.pos[0] + r[0]*lat - f[0]*back, y, BOAT.pos[2] + r[2]*lat - f[2]*back]; }
function eyeWorld(){ return boatToWorld(SEAT[0] + BOAT.roll*0.9, SEAT[1] + BOAT.pos[1], SEAT[2] + BOAT.pitch*0.4); }
function pushOutOfHull(p, m){
  const [a, b] = toBoatLocal(p[0], p[2]); const r = Math.hypot(a/(HULL.w+m), b/(HULL.l+m));
  if (r < 1 && r > 1e-4){ const f = boatF(), rr = boatR(), k = 1/r; p[0] = BOAT.pos[0] + rr[0]*a*k + f[0]*b*k; p[2] = BOAT.pos[2] + rr[2]*a*k + f[2]*b*k; }
}
function isSalt(){ return BIOMES[REGION.biome].water === 'salt'; }
function itemName(it){ return isSalt() && it.nameSea ? it.nameSea : it.name; }
function lineKg(){ return baseLineKg()*tierOf('line').mult; }
const GAME_HOUR = 225;   // real seconds per game hour (a game day ≈ 90 minutes)
function yawDir(y){ return [Math.sin(y), 0, -Math.cos(y)]; }
function viewYaw(){ return G.aimYaw + (G.lookX || 0); }
function viewPitch(){ return clamp(G.aimPitch + (G.lookY || 0), -1.0, 0.45); }
// desktop: the view follows the mouse (and keeps turning when the pointer sits near a screen edge)
// the view no longer follows the mouse pointer (only right-drag / keys / joystick turn it); any leftover offset eases out
function mouseLook(dt){
  const k = Math.min(1, dt*5);
  G.lookX = lerp(G.lookX || 0, 0, k); G.lookY = lerp(G.lookY || 0, 0, k);
}
function tipXZ(){ return [G.tipS[0], 0, G.tipS[2]]; }
function insideHull(x, z, margin){ const [a, b] = toBoatLocal(x, z); const lx = a/(HULL.w+margin), lz = b/(HULL.l+margin); return lx*lx + lz*lz < 1; }
let msgTimer = null;
function say(text, secs, cls){
  const el = $('msg'); el.textContent = text; el.className = 'show ' + (cls||'');
  clearTimeout(msgTimer); msgTimer = setTimeout(() => el.className = '', (secs||2.5)*1000);
}
function kg(w){ return w < 1 ? Math.round(w*1000) + 'g' : w.toFixed(2) + 'kg'; }

/* ---------------- fish ---------------- */
const FISH_N = 10;
const fishes = [];
// how well a spot suits a species: water depth under it vs the depth band anglers find it in
function habitat(sp, fdVis){
  const fd = toReal(fdVis);
  let h = 1;
  if (fd < sp.dmin*0.6) h *= 0.08 + 0.9*fd/(sp.dmin*0.6);          // too shallow for a deep-water fish
  if (sp.zone === 'bottom' && fd > sp.dmax + 6) h *= 0.35;           // bottom feeders stay where the bed is within reach
  return h;
}
function pickSpecies(x, z){
  const pool = BIOMES[REGION.biome].fish, fd = floorDepth(x, z);
  const ws = pool.map(([id, w]) => { const sp = BY_ID[id]; return w*habitat(sp, fd)*(0.35 + 0.65*activity(sp)); });
  let tot = 0; for (const w of ws) tot += w;
  let r = Math.random()*tot; for (let i = 0; i < pool.length; i++){ r -= ws[i]; if (r <= 0) return BY_ID[pool[i][0]]; }
  return BY_ID[pool[0][0]];
}
// the species' real depth range, in screen metres
function depthBand(sp){ const lo = Math.min(toVis(sp.dmin), VIS_DEPTH - 0.5); return [lo, Math.max(lo + 0.4, Math.min(toVis(sp.dmax), VIS_DEPTH + 0.5))]; }
function fishDepthFor(sp, x, z){
  const fd = floorDepth(x, z), [lo, hi] = depthBand(sp);
  let d = sp.zone === 'bottom' ? Math.min(fd - 0.3, hi) - rand(0, 0.6) : sp.zone === 'top' ? rand(0.3, Math.min(1.4, hi)) : rand(lo, hi);
  return -clamp(d, 0.35, Math.min(fd - 0.18, VIS_DEPTH));
}
function newFish(focus, rmin, rmax, spForce){
  let x, z, k = 0;
  do { const a = rand(0, TAU), d = rand(rmin, rmax); x = focus[0] + Math.cos(a)*d; z = focus[2] + Math.sin(a)*d; } while (insideHull(x, z, 1.5) && ++k < 20);
  const sp = spForce || pickSpecies(x, z);
  const L = lerp(sp.minLen, sp.maxLen, Math.pow(Math.random(), 1.9));
  return { sp, len: L, weight: sp.wk*Math.pow(L*100, 3), pos: [x, fishDepthFor(sp, x, z), z],
    heading: rand(-Math.PI, Math.PI), pitch: 0, speed: sp.speed*0.5, tailPh: rand(0, TAU), tail: 0,
    state: 'wander', target: null, ty: 0, timer: 0, think: rand(0, 1), cooldown: rand(0, 4) };
}
function fishDir(f){ const c = Math.cos(f.pitch); return [Math.cos(f.heading)*c, Math.sin(f.pitch), Math.sin(f.heading)*c]; }
function mouthOf(f){ return add(f.pos, mul(fishDir(f), f.len*0.5)); }
function focusPoint(){
  if (G.state === 'hooked' && G.hooked) return G.hooked.pos;
  if (G.rig) return G.rig.pos;
  if (G.lure) return G.lure.pos;
  if (G.fly) return G.fly.to;
  if (G.state === 'boat') return add(BOAT.pos, mul(boatF(), 10 + G.boatV*2));
  const e = eyeWorld(); return add(e, mul(yawDir(G.aimYaw), 10));
}
function turnToward(f, ang, maxStep){ f.heading = wrapA(f.heading + clamp(wrapA(ang - f.heading), -maxStep, maxStep)); }
function swim(f, tx, ty, tz, spd, dt, turn){
  const want = Math.atan2(tz - f.pos[2], tx - f.pos[0]);
  const da = wrapA(want - f.heading);
  turnToward(f, want, (turn||2.2)*dt);
  f.speed += (spd - f.speed)*Math.min(1, dt*2.5);
  const mv = f.speed*dt*(Math.abs(da) > 1.6 ? 0.45 : 1);
  f.pos[0] += Math.cos(f.heading)*mv; f.pos[2] += Math.sin(f.heading)*mv;
  moveY(f, ty, dt);
}
function moveY(f, ty, dt){
  const fd = floorDepth(f.pos[0], f.pos[2]);
  ty = clamp(ty, -Math.min(fd - f.len*0.22 - 0.05, VIS_DEPTH + 1), -0.1 - f.len*0.2);
  const vy = clamp((ty - f.pos[1])*0.9, -0.35, 0.35);
  f.pos[1] += vy*dt;
  f.pos[1] = clamp(f.pos[1], -(fd - f.len*0.2 - 0.03), -0.08 - f.len*0.18);
  f.pitch = lerp(f.pitch, clamp(Math.atan2(vy, Math.max(f.speed, 0.08))*0.8, -0.5, 0.5), Math.min(1, dt*4));
}
function avoidBoat(f){
  if (f.state === 'hooked') return;
  pushOutOfHull(f.pos, 0.5);
}
function flee(f, from, cool){
  f.state = 'flee'; f.timer = rand(1.8, 3.0); f.cooldown = cool || rand(10, 20);
  const a = Math.atan2(f.pos[2]-from[2], f.pos[0]-from[0]) + rand(-0.5, 0.5);
  f.target = [f.pos[0] + Math.cos(a)*8, 0, f.pos[2] + Math.sin(a)*8]; f.ty = f.pos[1] - 0.3;
  if (G.engaged === f) G.engaged = null;
  if (G.strike && G.strike.f === f) G.strike = null;
}
function wanderTarget(f){
  const c = focusPoint(); let x, z, k = 0;
  do { const a = rand(0, TAU), d = rand(1.5, 11); x = c[0] + Math.cos(a)*d; z = c[2] + Math.sin(a)*d; } while (insideHull(x, z, 1.6) && ++k < 20);
  f.target = [x, 0, z]; f.ty = fishDepthFor(f.sp, x, z); f.timer = rand(6, 14); f.cruise = f.sp.speed*rand(0.35, 0.75);
}
function depthMatch(sp, depth, x, z){
  const frac = depth/column(x, z);
  return clamp(1 - Math.abs(frac - sp.depth)*1.5, 0.15, 1);
}

function updateFish(f, dt){
  f.think -= dt; f.cooldown -= dt; f.timer -= dt;
  const sp = f.sp;
  switch (f.state){
  case 'wander': {
    if (!f.target || f.timer <= 0 || dist2(f.pos, f.target) < 0.8) wanderTarget(f);
    swim(f, f.target[0], f.ty, f.target[2], f.cruise, dt, 1.4);
    if (f.think <= 0){ f.think = 1; interest(f); }
    break; }
  case 'cruise':      // passing visitor (whale, shark, sunfish …): swims through and leaves
    swim(f, f.target[0], f.ty, f.target[2], f.cruise, dt, 0.5);
    if (f.pos[1] > -1.2 && Math.random() < dt*0.08) Rn.splash(f.pos[0], f.pos[2], 0.25, 0.04);
    if (dist2(f.pos, f.target) < 4){ fishes.splice(fishes.indexOf(f), 1); return; }
    if (f.think <= 0){ f.think = 1; if (!f.sp.sight) interest(f); }
    break;
  case 'flee':
    swim(f, f.target[0], f.ty, f.target[2], sp.speed*2.0, dt, 3.5);
    if (f.timer <= 0){ f.state = 'wander'; f.target = null; }
    break;
  case 'approach': {   // float rig: swim to the bait
    const rig = G.rig; if (!rig || rig.baitGone){ f.state = 'wander'; break; }
    const b = rig.bait, to = norm(sub(b, f.pos));
    const tgt = sub(b, mul(to, f.len*0.5 + 0.05));
    swim(f, tgt[0], tgt[1], tgt[2], sp.speed*0.55, dt, 2.2);
    if (dist3(mouthOf(f), b) < 0.22 + f.len*0.3){
      if (G.engaged && G.engaged !== f){ f.state = 'wander'; f.cooldown = 6; f.target = null; break; }
      G.engaged = f; f.state = 'inspect'; f.timer = rand(1.2, 3.5);
    }
    if (f.timer < -25) { f.state = 'wander'; f.target = null; }
    break; }
  case 'inspect': case 'nibble': case 'take': {
    const rig = G.rig; if (!rig){ f.state = 'wander'; break; }
    const b = rig.bait;
    const to = norm(sub(b, f.pos));
    const want = Math.atan2(to[2], to[0]);
    turnToward(f, want, 1.5*dt);
    let gap = f.state === 'inspect' ? 0.12 + 0.05*Math.sin(G.time*1.7) : 0.0;
    if (f.state === 'nibble') gap = 0.02 + 0.03*Math.max(0, Math.sin(G.time*14));
    const tgt = sub(b, mul(fishDir(f), f.len*0.5 + gap));
    const k = Math.min(1, dt*2.5);
    f.pos[0] = lerp(f.pos[0], tgt[0], k); f.pos[2] = lerp(f.pos[2], tgt[2], k); moveY(f, tgt[1], dt);
    f.speed = lerp(f.speed, 0.05, k);
    if (f.state === 'inspect' && f.timer <= 0){
      const bait = curItem();
      const size = (f.len - sp.minLen)/(sp.maxLen - sp.minLen);
      const p = Math.min(0.95, 1.6*biteFactor(sp, -rig.bait[1], rig.bait[0], rig.bait[2])) * (0.85 - sp.wary*0.45*size);
      if (Math.random() < p){ f.state = 'nibble'; f.nibbles = sp.bite === 'rise' ? Math.floor(rand(0, 3)) : Math.floor(rand(1, 4)); f.timer = rand(0.35, 0.8); }
      else flee(f, rig.bait, rand(12, 25));
    } else if (f.state === 'nibble' && f.timer <= 0){
      if (f.nibbles-- > 0){ rig.bobV -= sp.bite === 'rise' ? 0.45 : 0.7; f.timer = rand(0.4, 1.1); Rn.splash(rig.pos[0], rig.pos[2], 0.035, 0.008); }
      else { f.state = 'take'; f.timer = (sp.bite === 'rise' ? rand(1.6, 2.2) : rand(1.0, 1.5))*tierOf('hook').window; rig.take = { style: sp.bite, t: 0 }; padRumble(0.15, 0.6, 170); }
    } else if (f.state === 'take'){
      if (sp.bite === 'sink'){ // swim off with the bait, dragging the float under
        const a = f.heading; f.pos[0] += Math.cos(a)*0.22*dt; f.pos[2] += Math.sin(a)*0.22*dt; f.pos[1] -= 0.05*dt;
        rig.bait = add(mouthOf(f), [0,0,0]);
      } else {                 // lifts the bait: float rises
        f.pos[1] += 0.06*dt; f.pitch = lerp(f.pitch, 0.35, dt*2);
        rig.bait[1] = Math.min(rig.bait[1] + 0.06*dt, -0.2);
      }
      if (f.timer <= 0){
        rig.take = null;
        if (Math.random() < 0.5){ rig.baitGone = true; say('미끼를 따먹혔어요… R로 회수 후 다시 던지세요', 3.5); }
        else say('입질을 놓쳤어요', 2);
        flee(f, rig.bait, rand(15, 30)); resetBait();
      }
    }
    break; }
  case 'chase': {      // lure: follow it, maybe strike
    const L = G.lure; if (!L){ f.state = 'wander'; break; }
    const ld = L.dir;
    const tgt = sub(L.pos, mul(ld, f.len*0.5 + 0.12));
    const spd = clamp(L.speed*1.25 + 0.25, sp.speed*0.6, sp.speed*2.4);
    swim(f, tgt[0], tgt[1], tgt[2], spd, dt, 3.2);
    const dm = dist3(mouthOf(f), L.pos);
    if (dist2(L.pos, tipXZ()) < 3.6 || dm > 9){ flee(f, eyeWorld(), rand(8, 16)); break; }
    if (f.think <= 0 && dm < 0.6){
      f.think = 0.5;
      const recent = (G.time - L.toggleT) < 0.9;
      const p = 0.3*biteFactor(sp, -L.pos[1], L.pos[0], L.pos[2])*sp.aggr*(recent ? 2.0 : 1)*(L.falling ? 1.3 : 1)*(1 - 0.3*sp.wary);
      if (Math.random() < p){ strike(f); break; }
      if (Math.random() < 0.09) flee(f, L.pos, rand(8, 16));
    }
    break; }
  case 'strike': {
    const L = G.lure; if (!L){ f.state = 'wander'; break; }
    const tgt = sub(L.pos, mul(fishDir(f), f.len*0.5));
    f.pos = vlerp(f.pos, tgt, Math.min(1, dt*12)); turnToward(f, Math.atan2(L.pos[2]-f.pos[2], L.pos[0]-f.pos[0]), 6*dt);
    break; }
  case 'hooked': break;
  }
  if (f.state !== 'hooked'){
    avoidBoat(f);
    // animation
    const beat = 1.0 + 2.2*f.speed/Math.max(f.len, 0.1);
    f.tailPh += dt*TAU*beat;
    f.tail = Math.sin(f.tailPh)*(0.12 + 0.4*clamp(f.speed/(sp.speed*1.5), 0, 1));
  }
}
function interest(f){
  if (f.cooldown > 0 || f.sp.sight) return;
  const sp = f.sp;
  if (G.state === 'wait' && G.mode === 'pole' && G.rig && G.rig.settled && !G.rig.baitGone){
    const rig = G.rig, d = dist3(f.pos, rig.bait);
    const scent = Math.min(1, rig.age/20);
    const radius = 6 + (curItem().id === 'paste' ? 4*scent : 1.5*scent);
    if (d < radius){
      const p = 0.2*biteFactor(sp, -rig.bait[1], rig.bait[0], rig.bait[2])*(0.6 + 0.4*scent);
      if (Math.random() < p){ f.state = 'approach'; f.timer = 0; }
    }
  } else if (G.state === 'wait' && G.mode === 'lure' && G.lure && !G.strike){
    const L = G.lure, d = dist3(f.pos, L.pos);
    if (d < 7 && L.active && dist2(L.pos, tipXZ()) > 4.5){
      const p = 0.4*biteFactor(sp, -L.pos[1], L.pos[0], L.pos[2])*sp.aggr*(L.falling ? 1.3 : 1);
      if (Math.random() < p){ f.state = 'chase'; f.think = 0.5; }
    }
  }
}
function scareAround(p, r, except){
  for (const f of fishes) if (f !== except && f.state !== 'hooked' && dist3(f.pos, p) < r) flee(f, p, rand(6, 14));
}
function manageFish(dt){
  const c = focusPoint();
  for (let i = fishes.length-1; i >= 0; i--){
    const f = fishes[i];
    if (f.state !== 'hooked' && f !== G.engaged && dist2(f.pos, c) > (f.visitor ? 80 : 30)) fishes.splice(i, 1);
  }
  while (fishes.filter(f => f.state !== 'hooked' && !f.visitor).length < FISH_N) fishes.push(newFish(c, 15, 24));
  for (const f of fishes.slice()) updateFish(f, dt);
  if (Math.abs(G.boatV) > 1.2) for (const f of fishes) if (f.state === 'wander' && dist2(f.pos, BOAT.pos) < 4 + Math.abs(G.boatV)) flee(f, BOAT.pos, 4);
}

/* ---------------- casting ---------------- */
function startCharge(){
  if (G.state !== 'idle') return;
  G.state = 'charge'; G.chargeT = 0; G.power = 0;
}
function landingPoint(power){
  const m = modeCfg(), e = eyeWorld(), d = lerp(m.minCast, m.maxCast*castScale(), power);
  let p = add(e, mul(yawDir(viewYaw()), d)); p[1] = 0;
  let k = 0; while (insideHull(p[0], p[2], 0.6) && ++k < 40) p = add(p, mul(yawDir(viewYaw()), 0.2));
  return p;
}
function cast(){
  const m = modeCfg();
  const to = landingPoint(G.power);
  const d = dist2(to, eyeWorld());
  const scatter = d*0.035*(1 + 2*G.wv[3]);   // wind spoils the cast
  to[0] += rand(-scatter, scatter); to[2] += rand(-scatter, scatter);
  G.fly = { from: G.tip.slice(), to, t: 0, T: 0.75 + d*0.03, h: 1.2 + d*0.12, power: G.power };
  G.state = 'fly'; G.orbit = 0;
  sfx.whoosh(G.power);
  say(m.name + ' 캐스팅!', 1.2);
}
function flyPos(){
  const F = G.fly, s = clamp(F.t/F.T, 0, 1);
  const p = vlerp(F.from, F.to, s); p[1] += F.h*4*s*(1-s); return p;
}
function land(){
  const p = G.fly.to, it = curItem();
  const big = G.mode === 'pole' ? 0.5 : 0.35;
  Rn.splash(p[0], p[2], 0.10, 0.06*big + 0.02);
  sfx.splash(big);
  scareAround(p, 1.6);
  if (G.mode === 'pole'){
    const fd = floorDepth(p[0], p[2]);
    G.rig = { pos: [p[0], 0, p[2]], bobY: -0.12, bobV: 0, tilt: 1.3, settle: 0, settled: false, age: 0,
              bait: [p[0], -0.05, p[2]], baitDepth: Math.min(G.depthSet, fd - 0.03), take: null, baitGone: false, floor: fd };
  } else {
    G.lure = { pos: [p[0], -0.02, p[2]], hv: [0, 0], dir: norm(sub(tipXZ(), p)), reeling: false, toggleT: -10, speed: 0, falling: true, active: true, bottom: false };
    // a splash can draw nearby predators
    for (const f of fishes) if (f.state === 'wander' && dist3(f.pos, p) < 5 && Math.random() < 0.3*(f.sp.pref[it.id]||0)*f.sp.aggr){ f.state = 'chase'; f.think = 0.6; }
  }
  G.fly = null; G.state = 'wait';
}
function resetBait(){ G.engaged = null; if (G.rig) { G.rig.take = null; G.rig.bait = [G.rig.pos[0], -G.rig.baitDepth, G.rig.pos[2]]; } }
function retrieve(silent){
  if (G.state !== 'wait') return;
  if (G.engaged) flee(G.engaged, G.rig ? G.rig.bait : eyeWorld());
  for (const f of fishes) if (f.state === 'chase' || f.state === 'approach' || f.state === 'strike') { f.state = 'wander'; f.target = null; }
  const p = G.rig ? G.rig.pos : G.lure ? G.lure.pos : null;
  if (p){ Rn.splash(p[0], p[2], 0.06, 0.02); }
  G.rig = null; G.lure = null; G.strike = null; G.engaged = null;
  G.state = 'idle';
  if (!silent) say('채비 회수', 1.2);
}

/* ---------------- float rig (대낚시) ---------------- */
function updateRig(dt){
  const r = G.rig; if (!r) return;
  r.age += dt;
  // bait sinks to the set depth; the float stands up as the weight settles
  const tgtY = -Math.min(G.depthSet, r.floor - 0.03);
  r.baitDepth = -tgtY;
  if (!r.take && G.engaged == null){ r.bait[0] = r.pos[0]; r.bait[2] = r.pos[2]; r.bait[1] = Math.max(tgtY, r.bait[1] - 0.6*dt); if (r.bait[1] < tgtY + 0.3) r.bait[1] = lerp(r.bait[1], tgtY, dt*2); }
  r.settle = clamp((-r.bait[1]) / Math.max(0.1, -tgtY), 0, 1);
  if (r.settle > 0.97 && !r.settled){ r.settled = true; }
  let base = lerp(-0.12, 0.0, r.settle);
  // the sinker rests on the bed when the float is set deeper than the water: the float loses its weight and falls over
  const onBottom = G.depthSet > r.floor - 0.03 + 0.05 && r.settle > 0.9;
  if (onBottom && !r.laid){ r.laid = true; say('찌가 누웠어요 — 찌 수심이 바닥보다 깊어요 (휠로 조절)', 2.5); }
  if (!onBottom) r.laid = false;
  r.tilt = lerp(r.tilt, onBottom && !r.take ? 1.45 : (1 - r.settle)*1.3, dt*3);
  if (onBottom && !r.take) base = 0.01;
  if (r.take){
    r.take.t += dt;
    if (r.take.style === 'rise') base += 0.12*Math.min(1, r.take.t/1.3);
    else { base -= 0.4; r.pos[0] = lerp(r.pos[0], r.bait[0], dt*1.2); r.pos[2] = lerp(r.pos[2], r.bait[2], dt*1.2); }
  }
  const ef = G.engaged;
  if (ef && ef.state === 'nibble' && !onBottom) base += 0.028*Math.sin(G.time*11) + 0.015*Math.sin(G.time*17.3);   // 예신: 톡톡 까딱임
  else if (ef && ef.state === 'inspect') base += 0.006*Math.sin(G.time*7);
  base += 0.004*Math.sin(G.time*2.1) + 0.003*Math.sin(G.time*3.3+1);
  const acc = 70*(base - r.bobY) - 10*r.bobV;
  r.bobV += acc*dt; r.bobY += r.bobV*dt;
}
function hookSet(){
  const r = G.rig; if (!r) return;
  const f = G.engaged;
  sfx.whoosh(0.4);
  if (f && f.state === 'take'){ hookFish(f); return; }
  if (f && (f.state === 'nibble' || f.state === 'inspect')){ flee(f, r.bait, rand(10, 20)); resetBait(); say('헛챔질! 너무 일렀어요', 2); r.bobV += 0.5; return; }
  scareAround(r.bait, 2.5); say('헛챔질', 1.2); r.bobV += 0.5;
}

/* ---------------- lure ---------------- */
function updateLure(dt){
  const L = G.lure; if (!L) return;
  const it = curItem();
  const reeling = mouse.down;
  if (reeling !== L.reeling){ L.reeling = reeling; L.toggleT = G.time; }
  L.duty = lerp(L.duty ?? 0.6, reeling ? 1 : 0, Math.min(1, dt/3));   // share of time spent reeling: slow stop-and-go vs steady fast
  const t = tipXZ();
  const dx = t[0] - L.pos[0], dz = t[2] - L.pos[2], dh = Math.hypot(dx, dz) || 1;
  const fd = floorDepth(L.pos[0], L.pos[2]);
  const bottom = -Math.min(fd - 0.04, VIS_DEPTH);
  if (reeling){
    const sp = it.reel*reelScale();
    L.hv[0] = lerp(L.hv[0], dx/dh*sp, Math.min(1, dt*6)); L.hv[1] = lerp(L.hv[1], dz/dh*sp, Math.min(1, dt*6));
    const ty = it.idle === 'surface' ? -0.03 : it.diveDepth > 0 ? -Math.min(it.diveDepth, fd - 0.15) : bottom + 0.2;
    if (it.idle === 'surface'){ G.popT = (G.popT || 0) - dt; if (G.popT <= 0){ G.popT = 0.35; Rn.splash(L.pos[0], L.pos[2], 0.06, 0.02); } }
    // diving is quick, but a lure that sank below its running depth only climbs slowly as it comes in
    const climb = 0.1 + 0.08*L.speed;
    L.pos[1] += clamp(ty - L.pos[1], -0.55*dt, climb*dt);
    // the line angle lifts the lure as it comes close
    const ceil = -dh*0.3;   // the line angle near the rod tip
    if (L.pos[1] < ceil) L.pos[1] = Math.min(ceil, L.pos[1] + (0.15 + 0.1*L.speed)*dt);
    AU.reelT -= dt; if (AU.reelT <= 0){ sfx.click(0.025); AU.reelT = 0.06; }
  } else {
    const k = Math.exp(-dt*3); L.hv[0] *= k; L.hv[1] *= k;
    if (it.idle === 'float') L.pos[1] = Math.min(-0.02, L.pos[1] + 0.16*dt);
    else if (it.idle === 'sink') L.pos[1] -= 0.45*dt;
    else if (it.idle === 'fastsink') L.pos[1] -= 0.95*dt;
    else if (it.idle === 'surface') L.pos[1] = -0.03;
    else L.pos[1] -= 0.18*dt;
  }
  L.pos[1] = clamp(L.pos[1], bottom, -0.02);
  L.pos[0] += L.hv[0]*dt; L.pos[2] += L.hv[1]*dt;
  L.speed = Math.hypot(L.hv[0], L.hv[1]);
  L.bottom = L.pos[1] <= bottom + 0.005;
  L.falling = !reeling && it.idle !== 'float' && it.idle !== 'surface' && !L.bottom;
  L.active = L.speed > 0.12 || L.falling || (it.idle === 'float' && L.pos[1] < -0.05) || (it.idle === 'surface' && G.time - L.toggleT < 1.5);
  // orientation: faces the rod while moving, wobbles; nose down while sinking
  let yaw = Math.atan2(dz, dx);
  if (L.speed > 0.1) yaw += Math.sin(G.time*(it.id === 'spoon' ? 20 : 14))*(it.id === 'softworm' ? 0.1 : 0.28);
  const pitch = L.falling ? -0.5 : (reeling && it.diveDepth > 0 && L.pos[1] > -it.diveDepth + 0.05 ? -0.35 : 0);
  L.dir = [Math.cos(yaw)*Math.cos(pitch), Math.sin(pitch), Math.sin(yaw)*Math.cos(pitch)];
  if (dh < 2.6){ retrieve(true); say('루어 회수 — 다시 던지세요', 1.5); }
  // strike window
  if (G.strike){
    G.strike.t -= dt;
    if (reeling){ hookFish(G.strike.f); return; }
    if (G.strike.t <= 0){ const f = G.strike.f; G.strike = null; flee(f, L.pos, rand(10, 20)); say('놓쳤다! (바이트 후 바로 감으세요)', 2); }
  }
}
function strike(f){
  f.state = 'strike';
  const L = G.lure;
  if (L.pos[1] > -0.6){ Rn.splash(L.pos[0], L.pos[2], 0.12, 0.05); sfx.splash(0.3); }
  if (mouse.down){ hookFish(f); return; }
  G.strike = { f, t: 0.5*tierOf('hook').window }; padRumble(0.45, 0.8, 200);
  say('바이트! 감아요!', 0.8, 'hot');
}

/* ---------------- fight ---------------- */
function hookFish(f){
  const tip = tipXZ();
  G.strike = null; G.engaged = null;
  G.hooked = f; f.state = 'hooked'; G.state = 'hooked'; padRumble(0.9, 0.7, 260);
  f.stamina = 1;
  f.pull = clamp((0.15 + 0.22*Math.pow(f.weight, 0.6)*f.sp.power)*7/(lineKg()*(G.mode === 'pole' ? 1.75 : 1)), 0.15, 1.3);
  f.endur = Math.max(0.6, f.sp.endurance*(0.7 + 0.6*(f.len - f.sp.minLen)/(f.sp.maxLen - f.sp.minLen)));
  const a = Math.atan2(f.pos[2]-tip[2], f.pos[0]-tip[0]);
  f.run = { heading: a + rand(-0.6, 0.6), timer: rand(1, 2), burst: true };
  const d = dist2(f.pos, tip);
  G.fight = { tension: 0.3, lineOut: d + 0.2, maxReach: G.mode === 'pole' ? Math.max(d + 3.0, 8) : 150, breakT: 0, slackT: 0, cq: 0, payout: 0, t: 0 };
  G.rig = null; G.lure = null;
  G.fightSide = (Math.random() < 0.5 ? -1 : 1)*2.3; G.orbit = 0;
  Rn.splash(f.pos[0], f.pos[2], 0.15, 0.06);
  sfx.hit();
  say('히트! 물고기가 걸렸다!', 1.6, 'hot');
  scareAround(f.pos, 6, f);
}
function rodPressure(){
  const B = Rn.basis(); if (!B) return { w: [0, 0], m: 0 };
  if (!isFinite(mouse.x) || !isFinite(mouse.y)){ mouse.x = innerWidth/2; mouse.y = innerHeight/2; }
  const ox = mouse.x - innerWidth/2, oy = mouse.y - innerHeight/2;
  const rad = ringRadius();
  let m = clamp(Math.hypot(ox, oy)/rad, 0, 1); if (m < 0.12) m = 0;
  const rh = Math.hypot(B.r[0], B.r[2]) || 1, fh = Math.hypot(B.f[0], B.f[2]) || 1;
  const wx = B.r[0]/rh*ox - B.f[0]/fh*oy, wz = B.r[2]/rh*ox - B.f[2]/fh*oy;
  const wl = Math.hypot(wx, wz) || 1;
  return { w: [wx/wl, wz/wl], m };
}
function ringRadius(){ return 0.2*Math.min(innerWidth, innerHeight); }
function updateFight(dt){
  const f = G.hooked, F = G.fight, sp = f.sp, tip = tipXZ();
  F.t += dt;
  let ax = f.pos[0]-tip[0], az = f.pos[2]-tip[2], d = Math.hypot(ax, az) || 0.01;
  const away = [ax/d, az/d];
  // the fish picks runs: mostly away from the boat, sometimes hard sideways
  f.run.timer -= dt;
  if (f.run.timer <= 0){
    const base = Math.atan2(away[1], away[0]), r = Math.random();
    f.run.heading = base + (r < 0.45 ? rand(-0.6, 0.6) : r < 0.9 ? (Math.random() < 0.5 ? -1 : 1)*rand(1.0, 1.9) : rand(-3.1, 3.1));
    f.run.burst = Math.random() < 0.2 + 0.5*f.stamina;
    f.run.timer = f.run.burst ? rand(0.9, 2.0) : rand(1.5, 3.5);
  }
  const P = rodPressure();
  let dir2 = [Math.cos(f.heading), Math.sin(f.heading)];
  const cq = P.m*(-(P.w[0]*dir2[0] + P.w[1]*dir2[1]));
  F.cq = lerp(F.cq, cq, Math.min(1, dt*8));
  turnToward(f, f.run.heading, (1.0 + 1.6*f.stamina)*dt);
  if (cq > 0) turnToward(f, Math.atan2(P.w[1], P.w[0]), cq*(1.7 - f.stamina)*1.5*dt);
  dir2 = [Math.cos(f.heading), Math.sin(f.heading)];
  const spd = sp.speed*1.6*(0.3 + 0.7*f.stamina)*(f.run.burst ? 1.7 : 1);
  f.speed = lerp(f.speed, spd, Math.min(1, dt*3));
  f.pos[0] += dir2[0]*f.speed*dt; f.pos[2] += dir2[1]*f.speed*dt;
  // tension from the fish's pull, softened by good side pressure, spiked by pulling the wrong way
  const awayC = Math.max(0, dir2[0]*away[0] + dir2[1]*away[1]);
  const pullNow = f.pull*(0.3 + 0.7*f.stamina)*(f.run.burst ? 1.5 : 1);
  let T = pullNow*(0.25 + 0.75*awayC)*(1 - 0.45*Math.max(cq, 0)) + Math.max(-cq, 0)*0.35*f.pull;
  T += 0.07*f.pull*f.stamina*Math.max(0, Math.sin(F.t*17 + f.len*50))*(f.run.burst ? 2 : 1);   // head shakes
  const lift = mouse.down && (F.t > 0.7 || mouse.downT > G.time - F.t);   // ignore the hook-set click itself
  ax = f.pos[0]-tip[0]; az = f.pos[2]-tip[2]; d = Math.hypot(ax, az) || 0.01;
  if (G.mode === 'lure'){
    if (lift){
      T += 0.08 + 0.3*pullNow;
      F.lineOut -= (d < F.lineOut - 0.3 ? 1.7 : 1.25*(1 - 0.55*Math.min(F.tension, 1)))*reelScale()*dt;
      AU.reelT -= dt; if (AU.reelT <= 0){ sfx.click(0.03); AU.reelT = 0.07; }
    }
  } else {
    if (lift){ T += 0.12 + 0.45*pullNow; F.lineOut -= 0.75*dt*(0.4 + 0.6*(1 - f.stamina)); }
    if (d < F.lineOut - 0.3) F.lineOut = Math.max(d + 0.3, F.lineOut - 1.5*dt);   // the angler raises the pole to keep contact
    T *= 0.72;
  }
  T *= rodAbsorb();
  const slack = F.lineOut - d;
  if (slack > 0.2) T *= clamp(1 - (slack - 0.2)/1.2, 0, 1);
  if (G.mode === 'lure'){
    if (T > G.drag){ const pay = (T - G.drag)*7; F.lineOut += pay*dt; F.payout = pay; T = G.drag + (T - G.drag)*0.2;
      AU.dragT -= dt*pay*14; if (AU.dragT <= 0){ sfx.drag(); AU.dragT = 1; } }
    else F.payout = 0;
  } else if (T > 0.55 && F.lineOut < F.maxReach){ F.lineOut = Math.min(F.maxReach, F.lineOut + (T - 0.55)*2.5*dt); T -= (T - 0.55)*0.3; }
  F.lineOut = Math.max(F.lineOut, 1.2);
  if (d > F.lineOut){ const k = F.lineOut/d; f.pos[0] = tip[0] + ax*k; f.pos[2] = tip[2] + az*k; d = F.lineOut; }
  pushOutOfHull(f.pos, 0.25);
  F.tension = lerp(F.tension, T, Math.min(1, dt*10));
  // stamina
  f.stamina -= dt*(0.012 + 0.055*Math.max(cq, 0) + 0.035*F.tension)/f.endur;
  if (cq < -0.2) f.stamina += dt*0.025;
  f.stamina = clamp(f.stamina, 0, 1);
  // depth: tired fish come up
  const fd = floorDepth(f.pos[0], f.pos[2]);
  moveY(f, -clamp(0.25 + 0.85*f.stamina, 0.25, fd - 0.2), dt);
  if (f.pos[1] > -0.4 && Math.random() < dt*(0.6 + 2*f.stamina)){ Rn.splash(f.pos[0], f.pos[2], 0.10 + 0.1*f.len, 0.02 + 0.04*f.stamina); if (Math.random() < 0.3) sfx.splash(0.15); }
  const beat = 2.0 + 3.0*f.speed/Math.max(f.len, 0.1);
  f.tailPh += dt*TAU*beat; f.tail = Math.sin(f.tailPh)*(0.25 + 0.35*f.stamina);
  // outcomes
  if (F.tension > 1.0){ F.breakT += dt; if (F.breakT > 0.6) return lose('break'); } else F.breakT = Math.max(0, F.breakT - dt*0.7);
  if (G.mode === 'lure' && F.lineOut > 120) return lose('spool');
  if (F.tension < 0.05 && f.stamina > 0.15){ F.slackT += dt; if (F.slackT > 1.8 && Math.random() < dt*0.6*hookHold()) return lose('slack'); } else F.slackT = Math.max(0, F.slackT - dt);
  if (F.lineOut <= 2.4 && d <= 2.9){
    if (f.stamina < 0.4) return landFish();
    f.run.heading = Math.atan2(away[1], away[0]) + rand(-0.5, 0.5); f.run.burst = true; f.run.timer = 1.5; F.lineOut = 2.4;
  }
}
function lose(why){
  const f = G.hooked;
  const msgs = { break: '팅! 줄이 터졌습니다 — 장력을 조절하세요', spool: '원줄이 다 풀렸습니다…', slack: '줄이 느슨해져 바늘이 빠졌습니다' };
  if (why === 'break' || why === 'spool') sfx.snap();
  say(msgs[why], 3, 'bad');
  f.state = 'wander'; flee(f, eyeWorld(), 40);
  G.hooked = null; G.fight = null; G.state = 'idle';
}
function landFish(){
  const f = G.hooked, sp = f.sp;
  const pts = Math.round(20 + Math.sqrt(f.weight)*60*sp.rare + f.len*40);
  const rec = { name: sp.name, len: f.len, weight: f.weight, pts, sp };
  const prev = G.best[sp.id];
  const isBest = !prev || f.len > prev.len;
  if (isBest) G.best[sp.id] = rec;
  G.catches.unshift(rec); G.score += pts;
  P.caught[sp.id] = (P.caught[sp.id] || 0) + 1;
  const day = dayKey(); P.daily[day] = (P.daily[day] || 0) + 1;
  let netMsg = '';
  if (P.net.length < netCap()) P.net.unshift({ id: sp.id, len: f.len, weight: f.weight, price: pts });
  else netMsg = '살림망이 가득 차 방생했어요 — 판매하세요';
  fishes.splice(fishes.indexOf(f), 1);
  G.hooked = null; G.fight = null; G.state = 'result';
  Rn.splash(f.pos[0], f.pos[2], 0.2, 0.05); sfx.splash(0.6); sfx.win();
  showCard(rec, isBest && !!prev, !prev);
  if (netMsg) setTimeout(() => say(netMsg, 3, 'bad'), 400);
  questEvent({ type: 'catch', rec });
  updateLog(); save(); pushRankSoon();
}

/* ---------------- UI ---------------- */
// catch card: the photo first, then the name, then length and weight roll up from zero on an ease-out curve,
// then the price; a new personal record gets a fanfare, rays and confetti. A tap skips to the end, the next closes.
const CARD = { seq: 0, timers: [], running: false, finish: null, slow: 1.2 };   // slow: pace of the whole reveal (1.2 = 20% slower)
function showCard(r, record, first){
  const c = $('card'), seq = ++CARD.seq;
  CARD.timers.forEach(clearTimeout); CARD.timers = []; c.getAnimations({ subtree: true }).forEach(a => a.cancel());
  c.classList.remove('record'); c.querySelector('.rays')?.remove();
  const q = sel => c.querySelector(sel);
  q('.sp').textContent = r.name; q('.latin').textContent = r.sp.latin;
  q('.len').textContent = '0.0cm'; q('.wt').textContent = kg(0);
  q('.pts').textContent = `+${r.pts}점 · 🧺 판매가 ${r.pts}🪙`;
  q('.badge').textContent = record ? '🏆 개인 최대어 갱신!' : first ? '✨ 첫 포획! 도감 등록' : '';
  q('.tipc').textContent = r.sp.tip ? '💡 ' + r.sp.tip : '';
  const ph = (window.FISH_PHOTOS || {})[r.sp.id], img = q('.photo'), cred = q('.credit'), cv = q('canvas');
  if (ph){ img.src = ph.file; img.alt = r.sp.name; img.hidden = false; cv.hidden = true; cred.hidden = false; cred.textContent = `📷 ${ph.author} · ${ph.license.toUpperCase()} · iNaturalist`; }
  else { img.hidden = true; cred.hidden = true; cv.hidden = false; drawFishIcon(cv, r.sp); }
  const pic = ph ? img : cv;
  const parts = [pic, cred, q('.sp'), q('.latin'), q('.stats'), q('.pts'), q('.badge'), q('.tipc'), q('.foot')];
  for (const el of parts) el.style.opacity = 0;
  c.hidden = false; CARD.running = true;
  const K = CARD.slow;
  const show = (el, kf, dur) => { el.style.opacity = ''; el.animate(kf || [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: (dur || 320)*K, easing: 'cubic-bezier(.2,.8,.3,1)' }); };
  const at = (ms, fn) => CARD.timers.push(setTimeout(() => { if (CARD.seq === seq) fn(); }, ms*K));
  c.animate([{ transform: 'translate(-50%,-50%) scale(.85)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }], { duration: 260*K, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  at(60, () => { if (ph) mosaicReveal(img, seq, 1100*K); else show(pic, [{ opacity: 0, transform: 'scale(1.08)', filter: 'brightness(2)' }, { opacity: 1, transform: 'none', filter: 'none' }], 480); show(cred); });
  at(520, () => { show(q('.sp'), [{ opacity: 0, transform: 'scale(.7)', letterSpacing: '.3em' }, { opacity: 1, transform: 'none', letterSpacing: 'normal' }], 420); show(q('.latin')); sfx.plop(); });
  const L = r.len*100, Wt = r.weight, T = 1300;
  at(950, () => {
    show(q('.stats'), null, 200);
    const t0 = performance.now(); let lastTick = 0;
    const step = now => {
      if (CARD.seq !== seq) return;
      const u = Math.min(1, (now - t0)/(T*K)), e = 1 - Math.pow(1 - u, 3);          // ease-out cubic: fast first, settling on the value
      q('.len').textContent = (L*e).toFixed(1) + 'cm'; q('.wt').textContent = kg(Wt*e);
      if (now - lastTick > 70 && u < 1){ lastTick = now; sfx.click(0.03 + 0.03*e); }
      if (u < 1) requestAnimationFrame(step);
      else { q('.len').textContent = L.toFixed(1) + 'cm'; q('.wt').textContent = kg(Wt); for (const el of [q('.len'), q('.wt')]) el.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260 }); }
    };
    requestAnimationFrame(step);
  });
  at(950 + T + 150, () => { show(q('.pts'), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.12)', offset: 0.7 }, { opacity: 1, transform: 'none' }], 380); sfx.click(0.08); });
  at(950 + T + 550, () => {
    if (record){
      c.classList.add('record'); const rays = document.createElement('div'); rays.className = 'rays'; c.prepend(rays);
      show(q('.badge'), [{ opacity: 0, transform: 'scale(2)' }, { opacity: 1, transform: 'scale(.95)', offset: 0.6 }, { opacity: 1, transform: 'none' }], 520);
      fanfare(); const b = c.getBoundingClientRect(); confetti(90, b.left + b.width/2, b.top + b.height*0.35); padRumble(0.5, 0.8, 300, 120);
    } else if (first){ show(q('.badge')); const b = c.getBoundingClientRect(); confetti(30, b.left + b.width/2, b.top + b.height*0.3); sfx.win(); }
    else show(q('.badge'));
    show(q('.tipc')); show(q('.foot')); CARD.running = false;
  });
  CARD.finish = () => {    // tap during the reveal: jump to the end state
    CARD.timers.forEach(clearTimeout); CARD.timers = []; CARD.seq++;
    for (const el of parts) el.style.opacity = '';
    const mc = c.querySelector('canvas.mosaic'); if (mc) mc.hidden = true;
    q('.len').textContent = L.toFixed(1) + 'cm'; q('.wt').textContent = kg(Wt);
    if (record && !c.classList.contains('record')){ c.classList.add('record'); const rays = document.createElement('div'); rays.className = 'rays'; c.prepend(rays); fanfare(); }
    CARD.running = false;
  };
}
// photo reveal: coarse mosaic blocks that get finer until the original shows (block size eases 40px → 1px)
function mosaicReveal(img, seq, dur){
  const c = $('card'); let cv = c.querySelector('canvas.mosaic');
  if (!cv){ cv = document.createElement('canvas'); cv.className = 'mosaic'; cv.hidden = true; img.after(cv); }
  const cs = getComputedStyle(c), W = Math.max(1, Math.round(c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))), H = 180;
  cv.width = W; cv.height = H; const x = cv.getContext('2d'), tmp = document.createElement('canvas'), tx = tmp.getContext('2d');
  img.style.opacity = 0; cv.hidden = false;
  const go = () => {
    const iw = img.naturalWidth, ih = img.naturalHeight, s = Math.max(W/iw, H/ih), sw = W/s, sh = H/s, sx = (iw - sw)/2, sy = (ih - sh)/2;   // object-fit: cover
    const t0 = performance.now();
    const step = now => {
      if (CARD.seq !== seq){ cv.hidden = true; img.style.opacity = ''; return; }
      const u = Math.min(1, (now - t0)/dur), e = 1 - Math.pow(1 - u, 2.2), block = Math.max(1, Math.round(40*Math.pow(1/40, e)));
      const bw = Math.max(1, Math.ceil(W/block)), bh = Math.max(1, Math.ceil(H/block));
      tmp.width = bw; tmp.height = bh; tx.imageSmoothingEnabled = true; tx.drawImage(img, sx, sy, sw, sh, 0, 0, bw, bh);
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, W, H); x.globalAlpha = Math.min(1, u*4); x.drawImage(tmp, 0, 0, bw, bh, 0, 0, W, H); x.globalAlpha = 1;
      if (u < 1) requestAnimationFrame(step); else { img.style.opacity = ''; cv.hidden = true; }
    };
    requestAnimationFrame(step);
  };
  if (img.complete && img.naturalWidth) go(); else img.onload = () => { img.onload = null; if (CARD.seq === seq) go(); };
}
function hideCard(){
  if (CARD.running && CARD.finish){ CARD.finish(); return; }
  CARD.timers.forEach(clearTimeout); CARD.timers = []; CARD.seq++;
  $('card').hidden = true; if (G.state === 'result') G.state = 'idle';
}
// a short brass-like fanfare (no audio files): rising arpeggio and a held chord
function fanfare(){
  if (!AU.ctx) return;
  const c = AU.ctx, t0 = c.currentTime + 0.02;
  const note = (f, t, d, g) => {
    const o = c.createOscillator(), o2 = c.createOscillator(), fl = c.createBiquadFilter(), gn = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = f; o2.frequency.value = f*1.003; fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.linearRampToValueAtTime(2600, t + 0.06);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.03); gn.gain.setValueAtTime(g, t + d*0.7); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(fl); o2.connect(fl); fl.connect(gn); gn.connect(AU.sfx); o.start(t); o2.start(t); o.stop(t + d + 0.05); o2.stop(t + d + 0.05);
  };
  [[523.3, 0, 0.16], [659.3, 0.14, 0.16], [784, 0.28, 0.16], [1046.5, 0.42, 0.7]].forEach(([f, t, d]) => note(f, t0 + t, d, 0.06));
  [523.3, 659.3, 784].forEach(f => note(f, t0 + 0.42, 0.9, 0.035));
}
function drawFishIcon(cv, sp){
  const x = cv.getContext('2d'), w = cv.width, h = cv.height;
  x.clearRect(0,0,w,h);
  const toCss = c => `rgb(${c.map(v => Math.round(255*Math.pow(Math.min(1, v*1.6), 1/2.2))).join(',')})`;
  const bh = h*0.5*sp.hr/0.42*0.9;
  const g = x.createLinearGradient(0, h/2-bh, 0, h/2+bh);
  g.addColorStop(0, toCss(sp.back)); g.addColorStop(0.55, toCss(sp.belly)); g.addColorStop(1, toCss(sp.belly.map(v=>v*1.2)));
  x.fillStyle = toCss(sp.back);
  x.beginPath(); x.moveTo(w*0.18, h/2); x.lineTo(w*0.04, h/2-bh*0.9); x.lineTo(w*0.08, h/2); x.lineTo(w*0.04, h/2+bh*0.9); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(w*0.42, h/2-bh*0.85); x.quadraticCurveTo(w*0.5, h/2-bh*1.35, w*0.62, h/2-bh*0.85); x.fill();
  x.fillStyle = g; x.beginPath(); x.ellipse(w*0.52, h/2, w*0.36, bh, 0, 0, TAU); x.fill();
  x.save(); x.beginPath(); x.ellipse(w*0.52, h/2, w*0.36, bh, 0, 0, TAU); x.clip();
  const dark = 'rgba(10,14,8,.55)', L0 = w*0.16, LW = w*0.72;
  if (sp.pattern === 1) for (let i=0;i<7;i++){ x.fillStyle = dark; x.fillRect(L0 + LW*(0.12 + i*0.1), 0, LW*0.045, h); }
  if (sp.pattern === 2){ x.fillStyle = dark; x.beginPath(); for (let i=0;i<=20;i++){ const px = L0 + LW*0.05 + LW*0.75*i/20; x.lineTo(px, h/2 - bh*0.1 + Math.sin(i*1.7)*bh*0.08); } for (let i=20;i>=0;i--){ const px = L0 + LW*0.05 + LW*0.75*i/20; x.lineTo(px, h/2 + bh*0.12 + Math.sin(i*1.3)*bh*0.08); } x.fill(); }
  if (sp.pattern === 3 || sp.pattern === 5 || sp.pattern === 4){ const r = mulberry32(sp.id.length*977); x.fillStyle = sp.pattern === 4 ? 'rgba(0,0,0,.8)' : dark;
    for (let i=0;i<(sp.pattern === 4 ? 60 : 26);i++){ const px = L0 + LW*r(), py = h/2 + (r()*2-1)*bh*(sp.pattern === 4 ? 0.8 : 0.9), rr = sp.pattern === 4 ? 2 : bh*(0.08 + 0.12*r()); if (sp.pattern !== 4 || py < h/2 + bh*0.2){ x.beginPath(); x.arc(px, py, rr, 0, TAU); x.fill(); } } }
  if (sp.pattern === 4){ x.fillStyle = 'rgba(220,70,90,.45)'; x.fillRect(0, h/2 - bh*0.18, w, bh*0.36); }
  if (sp.pattern === 6){ x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 1.2; for (let i=0;i<14;i++) for (let j=-4;j<=4;j++){ x.beginPath(); x.arc(L0 + LW*i/13, h/2 + j*bh*0.25 + (i%2)*bh*0.12, bh*0.14, -1.2, 1.2); x.stroke(); } }
  x.restore();
  x.fillStyle = 'rgba(0,0,0,.85)'; x.beginPath(); x.arc(w*0.78, h/2-bh*0.2, Math.max(2, bh*0.12), 0, TAU); x.fill();
}
function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }
function updateLog(){
  $('score').textContent = G.score.toLocaleString();
  $('coins').textContent = '🪙 ' + P.coins.toLocaleString();
  $('count').textContent = P.net.length; $('cap').textContent = netCap();
  const val = P.net.reduce((a, f) => a + f.price, 0);
  $('netval').textContent = P.net.length ? `≈ ${val.toLocaleString()}🪙` : '';
  $('releaseall').title = '방생: 판매가의 25% + 🍀 한 마리당 1분간 입질 +20% (최대 20분)';
  const ul = $('catches'); ul.innerHTML = '';
  for (const [i, c] of P.net.entries()){
    const li = document.createElement('li'); const sp = BY_ID[c.id];
    li.innerHTML = `<b></b><span>${(c.len*100).toFixed(1)}cm · ${kg(c.weight)}</span>`; li.firstChild.textContent = sp.name;
    li.title = `클릭: ${c.price}🪙에 판매`; li.style.cursor = 'pointer';
    li.onclick = e => { e.stopPropagation(); askNet('sell', [i]); };
    ul.appendChild(li);
  }
  $('status').hidden = !P.net.length;   // an empty keep net takes no space
  $('tnetn').textContent = P.net.length || '';
  if (!$('netm').hidden) renderNet();
}
function netCap(){ return tierOf('net').cap; }
// confirm before selling or releasing; afterwards go back to the keep-net window if it was open
function askNet(kind, idx){
  if (!P.net.length) return;
  const fromNet = !$('netm').hidden, back = () => { if (fromNet && P.net.length) openNet(); else closeModal(); };
  let html, yes;
  if (kind === 'sell'){
    const list = idx.map(i => P.net[i]).filter(Boolean), sum = list.reduce((a, f) => a + f.price, 0);
    const what = list.length === 1 ? `<b>${esc(BY_ID[list[0].id].name)}</b> ${(list[0].len*100).toFixed(1)}cm` : `<b>${list.length}마리</b>를 모두`;
    html = `${what} 판매할까요?<br><span style="color:#ffd84a;font-weight:700">+${sum.toLocaleString()}🪙</span>`; yes = '🪙 판매';
    confirmBox(html, yes, () => { sellFish(idx); back(); }, back);
  } else {
    const idx = releasePick();
    if (!idx.length){ say('🍀 행운이 이미 최대(20분)예요 — 살림망에 그대로 둘게요', 2.6, 'bad'); return; }
    const n = idx.length, kept = P.net.length - n, bonus = Math.round(idx.reduce((a, i) => a + P.net[i].price, 0)*0.25);
    const after = Math.min(LUCK_MAX, luckLeft() + n*60);
    html = `<b>${n}마리</b>를 ${kept ? '' : '모두 '}방생할까요?<br><span style="opacity:.8;font-size:12px">판매가의 25% <b style="color:#ffd84a">+${bonus.toLocaleString()}🪙</b> · 🍀 행운 ${Math.round(after/60)}분 (입질 +20%)` +
      (kept ? `<br>행운은 최대 20분이라 ${kept}마리는 살림망에 남아요 (싼 물고기부터 방생)` : '') + `</span>`; yes = '🐟 방생';
    confirmBox(html, yes, () => { releaseAll(); back(); }, back);
  }
}
// keep-net window (phones: the 🧺 button next to boat/fishing)
function openNet(){ openModal('netm'); renderNet(); }
function renderNet(){
  const val = P.net.reduce((a, f) => a + f.price, 0);
  $('netsub').textContent = `${P.net.length}/${netCap()}마리${P.net.length ? ` · 판매가 합계 ${val.toLocaleString()}🪙` : ''}`;
  const el = $('netlist'); el.innerHTML = '';
  if (!P.net.length){ el.innerHTML = '<div class="empty">비어 있어요 — 잡은 물고기가 여기 담겨요</div>'; }
  for (const [i, c] of P.net.entries()){
    const row = document.createElement('div'); row.className = 'nrow';
    row.innerHTML = `<div><b></b><br><span>${(c.len*100).toFixed(1)}cm · ${kg(c.weight)}</span></div><span>${c.price}🪙</span><button>판매</button>`;
    row.querySelector('b').textContent = BY_ID[c.id].name;
    row.querySelector('button').onclick = e => { e.stopPropagation(); askNet('sell', [i]); };
    el.appendChild(row);
  }
  $('nsell').disabled = $('nrel').disabled = !P.net.length;
}
$('nsell').addEventListener('click', e => { e.stopPropagation(); askNet('sell', P.net.map((f, i) => i)); });
$('nrel').addEventListener('click', e => { e.stopPropagation(); askNet('release'); });
$('tnet').addEventListener('click', e => { e.stopPropagation(); audioInit(); if (!$('netm').hidden) closeModal(); else openNet(); });
// keep net: catches wait here until sold (full price) or released (small good-will bonus)
function sellFish(idx){
  const list = idx.map(i => P.net[i]).filter(Boolean); if (!list.length) return;
  const sum = list.reduce((a, f) => a + f.price, 0);
  P.net = P.net.filter((f, i) => !idx.includes(i)); P.coins += sum;
  say(`🪙 ${list.length}마리 판매 +${sum.toLocaleString()}🪙`, 2); sfx.win(); updateLog(); save();
}
// release luck caps at 20 minutes: only as many fish as still add time are released, the rest stay in the net
const LUCK_MAX = 20*60;
function releasable(){ return Math.max(0, Math.min(P.net.length, Math.round((LUCK_MAX - luckLeft())/60))); }
function releasePick(){ return P.net.map((f, i) => i).sort((a, b) => P.net[a].price - P.net[b].price).slice(0, releasable()); }   // cheapest first
function releaseAll(){
  if (!P.net.length) return;
  const idx = releasePick();
  if (!idx.length){ say('🍀 행운이 이미 최대(20분)예요 — 살림망에 그대로 둘게요', 2.6, 'bad'); return; }
  const list = idx.map(i => P.net[i]), bonus = Math.round(list.reduce((a, f) => a + f.price, 0)*0.25), n = list.length, kept = P.net.length - n;
  P.luckUntil = Math.min(Math.max(Date.now(), P.luckUntil || 0) + n*60000, Date.now() + LUCK_MAX*1000);
  P.net = P.net.filter((f, i) => !idx.includes(i)); P.coins += bonus;
  say(`🐟 ${n}마리 방생 · +${bonus}🪙 · 🍀 행운 ${Math.round(luckLeft()/60)}분 (입질 +20%)`, 3, 'hot');
  if (kept) setTimeout(() => say(`🍀 행운이 최대(20분)라 ${kept}마리는 살림망에 남겨뒀어요`, 3), 1600);
  updateLog(); save();
}
$('status').querySelector('.neth').addEventListener('click', e => { if (!TOUCH.on) return; e.stopPropagation(); $('status').querySelector('.net').classList.toggle('open'); });
$('sellall').addEventListener('click', e => { e.stopPropagation(); askNet('sell', P.net.map((f, i) => i)); });
$('releaseall').addEventListener('click', e => { e.stopPropagation(); askNet('release'); });
function buildToolbar(){
  const modes = $('modes'); modes.innerHTML = '';
  for (const k of ['pole', 'lure']){
    const b = document.createElement('button'); b.className = G.mode === k ? 'on' : '';
    const it = MODES[k].items[G.item[k]];
    b.innerHTML = `${MODES[k].name}<small></small> ▴`; b.querySelector('small').textContent = itemName(it);
    b.onclick = e => { e.stopPropagation(); if (G.mode !== k) setMode(k); const pop = $('itempop'); pop.hidden = !(pop.hidden || G.mode !== pop.dataset.mode); pop.dataset.mode = k; buildItems(); requestAnimationFrame(placeItems); };
    modes.appendChild(b);
  }
  buildItems();
}
function buildItems(){
  // vertical, left-aligned dropdown (like a combo box) opening from the active tackle button
  const items = $('items'); items.innerHTML = '';
  modeCfg().items.forEach((it, i) => {
    if (!P.owned[it.id]) return;
    const b = document.createElement('button'); b.className = G.item[G.mode] === i ? 'on' : '';
    b.innerHTML = '<b></b><small></small>'; b.firstChild.textContent = (G.item[G.mode] === i ? '✓ ' : '') + itemName(it); b.lastChild.textContent = it.desc;
    b.onclick = e => { e.stopPropagation(); setItem(i); $('itempop').hidden = true; }; items.appendChild(b);
  });
  placeItems();
}
// line the dropdown up with the tackle buttons (the bar may be CSS-scaled, so measure on screen)
function placeItems(){
  const mb = $('modes'), bar = $('bottombar'); if (!mb) return;   // same spot for bait and lure: the left edge of the tackle buttons
  const br = bar.getBoundingClientRect(), k = br.width/(bar.offsetWidth || 1);
  $('itempop').style.left = (mb.getBoundingClientRect().left - br.left)/k + 'px';
}
function setMode(k){
  if (G.state !== 'idle' && G.state !== 'charge' && G.state !== 'boat'){ say('채비를 회수한 뒤 바꿀 수 있어요 (R)', 1.8); return; }
  G.mode = k; if (G.state === 'charge') G.state = 'idle'; buildToolbar(); say(MODES[k].name + ' 채비로 변경', 1.2);
}
function setItem(i){
  if (G.state !== 'idle' && G.state !== 'charge' && G.state !== 'boat'){ say('채비를 회수한 뒤 바꿀 수 있어요 (R)', 1.8); return; }
  if (!P.owned[modeCfg().items[i].id]) return;
  G.item[G.mode] = i; buildToolbar(); say((G.mode === 'pole' ? '미끼: ' : '루어: ') + itemName(curItem()), 1.2);
}
const HELP = {
  idle: () => (G.mode === 'pole'
    ? '<b>좌클릭 길게</b> 캐스팅 · <b>우클릭 드래그 / A·D</b> 방향 · <b>휠</b> 찌 수심 · <b>1/2</b> 채비 · <b>B</b> 미끼'
    : '<b>좌클릭 길게</b> 캐스팅 · <b>우클릭 드래그 / A·D</b> 방향 · <b>휠</b> 드랙 · <b>1/2</b> 채비 · <b>B</b> 루어') + ' · <b>Tab</b> 보트 · <b>M</b> 지도 · <b>Q</b> 퀘스트 · <b>P</b> 상점 · <b>T</b> 시간',
  boat: () => '<b>W/S</b> 전진·후진 · <b>A/D</b> 방향 · <b>드래그</b> 시점 · <b>휠</b> 줌 · 어탐기로 수심·어군 확인 · <b>Tab</b> 낚시 · <b>M</b> 지도',
  charge: () => '버튼을 놓으면 던집니다',
  fly: () => '',
  wait: () => G.mode === 'pole'
    ? '찌를 지켜보세요 · 찌가 <b>쑥 잠기거나 올라오면 클릭</b>(챔질) · <b>휠</b> 수심 · <b>우클릭 드래그</b> 시점 · <b>R</b> 회수'
    : '<b>누르고 있으면 릴 감기</b> · 감다 멈추기로 액션을 주세요 · <b>휠</b> 드랙 · <b>우클릭 드래그</b> 시점 · <b>R</b> 회수',
  hooked: () => G.mode === 'pole'
    ? '마우스를 <b>물고기 진행 방향의 반대쪽</b>으로! · <b>누르면 들어올리기</b> (장력 주의)'
    : '마우스를 <b>물고기 진행 방향의 반대쪽</b>으로! · <b>누르면 릴 감기</b> · <b>휠</b> 드랙',
  result: () => '<b>클릭</b>하여 계속',
};
let lastHelp = '';
const HELP_TOUCH = {
  idle: () => '화면 드래그로 방향 · <b>던지기</b> 길게 눌렀다 놓기 · ⛵ 보트 · ☰ 메뉴',
  charge: () => '손을 떼면 던집니다',
  fly: () => '',
  wait: () => G.mode === 'pole' ? '찌가 <b>쑥 잠기거나 올라오면 챔질</b> (화면 탭도 가능) · +/− 수심' : '<b>감기</b>를 누르고 있기 · 감다 멈추기로 액션 · +/− 드랙',
  hooked: () => `가운데 조그를 <b>누른 채</b> ${G.mode === 'pole' ? '들기' : '감기'} · <b>물고기 반대쪽</b>으로 밀기`,
  result: () => '탭하여 계속',
  boat: () => '<b>조그</b> 위: 전진 · 아래: 후진 · 좌우: 조향 · 드래그 시점 · 오른쪽 아래 🎣 낚시',
};
function updateHelp(){ const h = (TOUCH.on ? HELP_TOUCH : HELP)[G.state](); if (h !== lastHelp){ $('help').innerHTML = h; lastHelp = h; } }

/* ---------------- input ---------------- */
const hud = $('hud'), ctx = hud.getContext('2d');
hud.addEventListener('contextmenu', e => e.preventDefault());
/* touch: one finger on the scene looks around (or leans on the rod while fighting); tap = hook set / continue */
const TOUCH = { on: false, id: null, x0: 0, y0: 0, t0: 0, moved: false };
function enableTouch(){ if (TOUCH.on) return; TOUCH.on = true; document.body.classList.add('touch'); lastHelp = ''; }
if (matchMedia('(pointer: coarse)').matches) enableTouch();
function touchDown(e){
  hud.setPointerCapture(e.pointerId);
  Object.assign(TOUCH, { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
  if (G.state === 'hooked'){ mouse.x = e.clientX; mouse.y = e.clientY; }
  else { mouse.rdown = true; mouse.lx = e.clientX; mouse.ly = e.clientY; }
}
function touchUp(e){
  if (e.pointerId !== TOUCH.id) return;
  TOUCH.id = null; mouse.rdown = false;
  if (G.state === 'hooked' && !JOY.active){ mouse.x = innerWidth/2; mouse.y = innerHeight/2; }
  if (!TOUCH.moved && performance.now() - TOUCH.t0 < 350){
    if (G.state === 'wait' && G.mode === 'pole'){ press(); mouse.down = false; }
    else if (G.state === 'result') hideCard();
  }
}
hud.addEventListener('pointerdown', e => {
  audioInit();
  if (e.pointerType === 'touch'){ enableTouch(); touchDown(e); return; }
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (e.button === 2 || e.button === 1 || e.pointerType === 'touch' && e.isPrimary === false){ mouse.rdown = true; mouse.lx = e.clientX; mouse.ly = e.clientY; return; }
  if (e.button !== 0) return;
  hud.setPointerCapture(e.pointerId);
  mouse.down = true; mouse.downT = G.time; mouse.lx = e.clientX; mouse.ly = e.clientY;
  press();
});
hud.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch'){
    if (e.pointerId !== TOUCH.id) return;
    if (Math.hypot(e.clientX - TOUCH.x0, e.clientY - TOUCH.y0) > 10) TOUCH.moved = true;
    if (G.state === 'hooked'){ if (!JOY.active){ mouse.x = e.clientX; mouse.y = e.clientY; } return; }
  }
  if (mouse.rdown || (mouse.down && G.state === 'boat')){
    const dx = e.clientX - mouse.lx, dy = e.clientY - mouse.ly; mouse.lx = e.clientX; mouse.ly = e.clientY;
    const lk = LOOK(), iy = INV();
    if (G.state === 'boat'){ G.orbit -= dx*0.006*lk; G.camPitch = clamp((G.camPitch ?? 0.32) + dy*0.004*lk*iy, 0.08, 1.2); }
    else if (G.state === 'idle' || G.state === 'charge'){ G.aimYaw += dx*0.005*lk; G.aimPitch = clamp(G.aimPitch - dy*0.004*lk*iy, -0.9, 0.35); }
    else { G.orbit -= dx*0.006*lk; tiltView(dy*0.004*lk*iy); }
  }
  if (e.pointerType !== 'touch' || G.state !== 'hooked') { mouse.x = e.clientX; mouse.y = e.clientY; if (e.pointerType === 'mouse') mouse.moved = true; }
});
const up = e => {
  if (e.pointerType === 'touch'){ touchUp(e); return; }
  if (e.button === 2 || e.button === 1){ mouse.rdown = false; return; }
  if (e.button !== 0 && e.type !== 'pointercancel') return;
  if (mouse.down){ mouse.down = false; release(); }
};
hud.addEventListener('pointerup', up); hud.addEventListener('pointercancel', up);
window.addEventListener('blur', () => { mouse.down = false; mouse.rdown = false; for (const k in keys) keys[k] = false; });
hud.addEventListener('wheel', e => { e.preventDefault(); wheel(e.deltaY < 0 ? 1 : -1); }, { passive: false });
window.addEventListener('keydown', e => {
  if (G.mapOpen){ const own = { KeyM: 'map', KeyP: 'shop', KeyQ: 'questm', KeyK: 'rankm', KeyI: 'dexm', KeyO: 'setm' }[e.code];
    if (e.code === 'Escape' || own && !$(own).hidden) closeModal();
    else if (own && !MAP.anim && $('confirm').hidden){ closeModal(); ({ map: openMap, shop: openShop, questm: openQuests, rankm: openRank, dexm: openDex, setm: openSettings })[own](); }
    return; }
  if (e.repeat && !['KeyA','KeyD','KeyW','KeyS','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) return;
  keys[e.code] = true; audioInit();
  switch (e.code){
    case 'Tab': e.preventDefault(); setNav(G.state !== 'boat'); break;
    case 'KeyM': openMap(); break;
    case 'Digit1': setMode('pole'); break;
    case 'Digit2': setMode('lure'); break;
    case 'KeyB': { const its = modeCfg().items; let i = G.item[G.mode]; do { i = (i + 1) % its.length; } while (!P.owned[its[i].id]); setItem(i); break; }
    case 'KeyQ': toggleQuests(); break;
    case 'KeyP': openShop(); break;
    case 'KeyK': openRank(); break;
    case 'KeyI': openDex(); break;
    case 'KeyO': openSettings(); break;
    case 'KeyT': skipTime(); break;
    case 'KeyR': retrieve(); break;
    case 'KeyH': G.help = !G.help; say(G.help ? '입질 표시 켬' : '입질 표시 끔', 1.2); break;
    case 'Space': e.preventDefault(); if (!mouse.down){ mouse.down = true; mouse.downT = G.time; press(); } break;
    case 'Enter': if (G.state === 'result') hideCard(); break;
    case 'Escape':   // Esc: close whatever is up (catch card, menu, tackle popup), otherwise open the menu
      if (G.state === 'result') hideCard();
      else if (!$('menu').hidden) $('menu').hidden = true;
      else if (!$('itempop').hidden) $('itempop').hidden = true;
      else $('menu').hidden = false;
      break;
    case 'BracketRight': case 'Equal': wheel(1); break;
    case 'BracketLeft': case 'Minus': wheel(-1); break;
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Space' && mouse.down){ mouse.down = false; release(); } });
$('card').addEventListener('pointerdown', e => { e.stopPropagation(); hideCard(); });
$('retrieve').addEventListener('click', e => { e.stopPropagation(); retrieve(); });
/* joystick (조그) */
const JOY = { x: 0, y: 0, active: false, id: null, wasFight: false };
const joyEl = $('joy'), knob = $('knob');
function joyMove(e){
  // the joystick may still be hidden in the very frame a quick hook set starts the fight: measure the cast button then
  // (a zero-size joystick divided by zero and sent NaN through the rod, camera and fish — black screen, dead fight)
  const el = joyEl.offsetWidth ? joyEl : act, b = el.getBoundingClientRect(), R = Math.max(b.width/2, 20);
  let x = (e.clientX - b.left - R)/(R*0.8), y = (e.clientY - b.top - R)/(R*0.8);
  const l = Math.hypot(x, y); if (l > 1){ x /= l; y /= l; }
  JOY.x = x; JOY.y = y; knob.style.transform = `translate(${x*R*0.8}px, ${y*R*0.8}px)`;
}
joyEl.addEventListener('pointerdown', e => { e.preventDefault(); audioInit(); joyEl.setPointerCapture(e.pointerId); JOY.pad = false; JOY.active = true; JOY.id = e.pointerId; joyEl.classList.add('on'); joyMove(e);
  // fighting: the centre joystick also reels / lifts while it is held
  if (G.state === 'hooked' && !mouse.down){ mouse.down = true; mouse.downT = G.time; press(); } });
joyEl.addEventListener('pointermove', e => { if (JOY.active && e.pointerId === JOY.id) joyMove(e); });
const joyUp = e => { if (e.pointerId !== JOY.id) return; JOY.active = false; JOY.id = null; JOY.x = JOY.y = 0; knob.style.transform = ''; joyEl.classList.remove('on');
  if (G.state === 'hooked'){ mouse.x = innerWidth/2; mouse.y = innerHeight/2; }
  if (mouse.down && !act.classList.contains('down')){ mouse.down = false; release(); } };
joyEl.addEventListener('pointerup', joyUp); joyEl.addEventListener('pointercancel', joyUp);
function applyJoy(dt){
  if (G.state === 'hooked'){
    if (JOY.active){ const R = ringRadius(); mouse.x = innerWidth/2 + JOY.x*R; mouse.y = innerHeight/2 + JOY.y*R; }
    return;
  }
  if (!JOY.active || G.state === 'boat') return;
  const lk = LOOK(), iy = INV();
  if (G.state === 'idle' || G.state === 'charge'){ G.aimYaw += JOY.x*dt*1.3*lk; G.aimPitch = clamp(G.aimPitch - JOY.y*dt*0.8*lk*iy, -0.9, 0.35); }
  else { G.orbit -= JOY.x*dt*1.4*lk; tiltView(JOY.y*dt*0.9*lk*iy); }
}
/* action button: hold = cast charge / reel / lift, tap = hook set; the label follows the situation */
const act = $('act');
act.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); audioInit(); act.setPointerCapture(e.pointerId); act.classList.add('down');
  if (G.state === 'boat'){ setNav(false); return; }
  if (!mouse.down){ mouse.down = true; mouse.downT = G.time; press(); }
});
// hook set → fight without lifting the finger: while fighting, the held cast button steers like the joystick
act.addEventListener('pointermove', e => {
  if (G.state !== 'hooked' || !act.classList.contains('down')) return;
  if (JOY.id !== 'act'){ if (JOY.active) return; JOY.active = true; JOY.id = 'act'; JOY.pad = false; joyEl.classList.add('on'); }
  joyMove(e);
});
const actUp = e => { act.classList.remove('down');
  if (JOY.id === 'act'){ JOY.active = false; JOY.id = null; JOY.x = JOY.y = 0; knob.style.transform = ''; joyEl.classList.remove('on'); if (G.state === 'hooked'){ mouse.x = innerWidth/2; mouse.y = innerHeight/2; } }
  if (mouse.down){ mouse.down = false; release(); } };
act.addEventListener('pointerup', actUp); act.addEventListener('pointercancel', actUp);
act.addEventListener('contextmenu', e => e.preventDefault());
// +/− repeat while held: one step at once, then faster steps after a short pause
for (const [id, dir] of [['tplus', 1], ['tminus', -1]]){
  const b = $(id); let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId); wheel(dir);
    let delay = 380;
    const rep = () => { wheel(dir); delay = Math.max(60, delay*0.8); timer = setTimeout(rep, delay); };
    timer = setTimeout(rep, delay);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, stop);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
$('tnav').addEventListener('click', e => { e.stopPropagation(); audioInit(); setNav(G.state !== 'boat'); });
$('tmap').addEventListener('click', e => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; });
let actCache = '';
function updateTouchUI(){
  if (!TOUCH.on) return;
  // one centre control: joystick while driving or fighting, the cast / action button otherwise
  const cj = G.state === 'boat' || G.state === 'hooked';
  if (cj !== G.centerJoy){ G.centerJoy = cj; document.body.classList.toggle('tc-joy', cj); }
  const f = G.engaged, pole = G.mode === 'pole';
  const lbl = { idle: '던지기', charge: '놓으면<br>던짐', fly: '…', result: '계속', boat: '⚓<br>낚시',
    wait: pole ? '챔질' : '감기', hooked: pole ? '들기' : '감기' }[G.state];
  const hot = (G.state === 'wait' && pole && f && f.state === 'take') || (G.state === 'wait' && G.strike);
  const adj = G.state === 'boat' ? '줌' : pole ? '수심' : '드랙';
  const key = lbl + hot + adj + G.state;
  if (key !== actCache){ actCache = key; act.innerHTML = lbl; act.classList.toggle('hot', !!hot); $('tadj').textContent = adj; $('tnav').textContent = G.state === 'boat' ? '🎣' : '⛵'; }
}
function toggleQuests(){ if (!$('questm').hidden) closeModal(); else openQuests(); }
// buttons never keep keyboard focus: otherwise Space (cast) or Enter would click the last button again (e.g. reopen the menu)
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); }, true);
$('menubtn').addEventListener('click', e => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; });
const MENU_IDLE_ONLY = ['shop', 'map', 'time'];
function menuBusy(){ return ['charge', 'fly', 'wait', 'hooked'].includes(G.state); }
function updateMenuState(){
  const busy = menuBusy(); if (busy === G.menuBusy) return; G.menuBusy = busy;
  for (const b of document.querySelectorAll('#menu button')) b.classList.toggle('dis', busy && MENU_IDLE_ONLY.includes(b.dataset.m));
}
for (const b of document.querySelectorAll('#menu button')) b.addEventListener('click', e => {
  if (b.classList.contains('dis')){ e.stopPropagation(); say('채비를 회수한 뒤 이용할 수 있어요 (R)', 1.8); return; }
  e.stopPropagation(); $('menu').hidden = true;
  ({ shop: openShop, quest: openQuests, map: openMap, rank: openRank, dex: openDex, time: skipTime, set: openSettings })[b.dataset.m]();
});
$('qtrack').addEventListener('click', e => { e.stopPropagation(); openQuests(); });
document.addEventListener('pointerdown', e => {
  if (!$('menu').hidden && !e.target.closest('#menu, #menubtn, #tmap')) $('menu').hidden = true;
  if (!$('itempop').hidden && !e.target.closest('#bottombar')) $('itempop').hidden = true;
});
$('shopclose').addEventListener('click', closeShop);
$('shop').addEventListener('pointerdown', e => { if (e.target === $('shop')) closeShop(); });

let targetT = 0;
function updateTarget(dt){
  $('clock').textContent = `${fmtClock()} ${PERIOD_NAME[period()]}`;
  const wi = `${G.weather === 'clear' && period() === 'night' ? '🌙' : WEATHERS[G.weather].icon} ${WEATHERS[G.weather].name}`;
  if ($('wicon').textContent !== wi) $('wicon').textContent = wi;
  const lk = luckLeft(); $('luck').hidden = !(lk > 0); if (lk > 0) $('luck').textContent = `🍀 ${Math.ceil(lk/60)}분`;
  targetT -= dt; if (targetT > 0) return; targetT = 0.4;
  $('gauges').style.top = TOUCH.on && G.state === 'boat' ? (SONAR.bottom || 150) + 12 + 'px' : '';   // phones: under the fish finder while driving
  const el = $('target'), sp = questTarget();
  if (!sp || !(G.state === 'idle' || G.state === 'wait' || G.state === 'charge')){ el.hidden = true; return; }
  const { v, parts } = matchRating(sp);
  const names = { bait: G.mode === 'pole' ? '미끼가 안 맞아요' : '루어가 안 맞아요', depth: `수심이 안 맞아요 (${sp.dmin}–${sp.dmax}m${sp.zone === 'bottom' ? ', 바닥층' : sp.zone === 'top' ? ', 수면층' : ''})`,
    time: `지금은 활성도가 낮아요 (${Object.entries(sp.act).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => PERIOD_NAME[k]).join('·')}에 활발)`, gear: '원줄이 너무 굵어 경계해요', weather: `날씨가 안 맞아요 (${WEATHERS[G.weather].name})`, retrieve: `감기 속도: ${ {slow:'느리게(감다 멈추기)', medium:'보통', fast:'빠르게 계속'}[sp.retrieve] }` };
  const worst = Object.entries(parts).sort((a, b) => a[1] - b[1])[0];
  const habitatNote = habitat(sp, floorDepth(...(G.rig ? [G.rig.pos[0], G.rig.pos[2]] : G.lure ? [G.lure.pos[0], G.lure.pos[2]] : [BOAT.pos[0], BOAT.pos[2]]))) < 0.5 ? ' · 여기는 서식 수심이 아니에요' : '';
  el.innerHTML = `🎯 <b>${sp.name}</b> 공략도 <span class="st">${stars(v)}</span><br><span class="why">${worst[1] < 0.6 ? names[worst[0]] : '좋은 조건이에요!'}${habitatNote}</span>`;
  el.hidden = false;
  el.style.top = TOUCH.on ? '' : ($('qtrack').getBoundingClientRect().bottom + 10) + 'px';
}
$('navfish').addEventListener('click', e => { e.stopPropagation(); audioInit(); setNav(false); });
$('navboat').addEventListener('click', e => { e.stopPropagation(); audioInit(); setNav(true); });


function press(){
  switch (G.state){
    case 'idle': startCharge(); break;
    case 'wait': if (G.mode === 'pole') hookSet(); break;
    case 'result': hideCard(); mouse.down = false; break;
  }
}
function release(){
  if (G.state === 'charge') cast();
}
function wheel(s){
  if (G.state === 'boat'){ G.camDist = clamp(G.camDist*(s > 0 ? 0.88 : 1.14), 4.5, 30); return; }
  if (G.mode === 'lure'){ G.drag = clamp(Math.round((G.drag + s*0.05)*100)/100, 0.05, 1.2); say(`드랙 ${s > 0 ? '조임' : '풀기'} · ${(G.drag*lineKg()).toFixed(1)}kg${G.drag >= 1 ? ' (잠김!)' : ''}`, 1); sfx.click(0.05); }
  else {
    // step in real metres: 0.1 m near the surface, coarser when fishing deep
    const cur = toReal(G.depthSet), st = cur < 3 ? 0.1 : cur < 10 ? 0.5 : cur < 25 ? 1 : 2;
    const nr = clamp(Math.round((cur + s*st)/st)*st, 0.3, toReal(VIS_DEPTH));
    G.depthSet = Math.min(toVis(nr), VIS_DEPTH);
    const r = G.rig;
    say(`찌 수심 ${fmtD(G.depthSet)}m${r && G.depthSet >= r.floor - 0.03 ? ' (바닥 닿음)' : ''}`, 1);
  }
}

/* ---------------- camera ---------------- */
function baitView(focus, back, up, side){
  const e = eyeWorld();
  let dx = focus[0] - e[0], dz = focus[2] - e[2]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const oa = G.orbit + (side||0) + (G.state === 'hooked' ? 0 : (G.lookX || 0));
  const c = Math.cos(oa), s = Math.sin(oa); const rx = dx*c - dz*s, rz = dx*s + dz*c;
  // after casting the view can be tilted up/down around the rig (drag, W/S, joystick), but the camera stays above the water
  // after casting the camera may tilt below the surface to watch the bait / lure / fish underwater
  const under = G.state === 'wait' || G.state === 'hooked';
  const R = Math.hypot(back, up), el = clamp(Math.atan2(up, back) + (G.viewTilt || 0), under ? -0.6 : 0.1, 1.35);
  let h = el >= 0.12 ? Math.max(0.45, R*Math.sin(el)) : R*Math.sin(el), b = R*Math.cos(el);
  // never put the camera inside the boat: come closer to the rig, and if that is not enough rise above the gunwale
  for (let i = 0; i < 8 && insideHull(focus[0] - rx*b, focus[2] - rz*b, 0.35); i++) b *= 0.75;
  if (insideHull(focus[0] - rx*b, focus[2] - rz*b, 0.35)) h = Math.max(h, SEAT[1] + 0.2);
  const px = focus[0] - rx*b, pz = focus[2] - rz*b;
  if (h < 0) h = Math.max(h, -(floorDepth(px, pz) - 0.35));            // stay above the bottom
  const k = clamp(-h/0.6, 0, 1), ty = underTargetY();                    // underwater: look at the bait itself
  return { pos: [px, h, pz], look: [focus[0], lerp(-0.25 + Math.max(0, 0.35 - el)*2.5, ty, k), focus[2]] };
}
function underTargetY(){
  if (G.state === 'hooked' && G.hooked) return G.hooked.pos[1];
  if (G.rig) return G.rig.bait[1];
  if (G.lure) return G.lure.pos[1];
  return -1;
}
function tiltView(d){ G.viewTilt = clamp((G.viewTilt || 0) + d, -1.6, 0.8); }
function boatView(){
  const e = eyeWorld(), yw = viewYaw(), pt = viewPitch(), cp = Math.cos(pt);
  return { pos: e, look: add(e, [Math.sin(yw)*cp*10, Math.sin(pt)*10, -Math.cos(yw)*cp*10]) };
}
function updateCamera(dt){
  let T, k;
  switch (G.state){
    case 'idle': case 'charge': case 'result': T = boatView(); k = G.state === 'result' ? 3 : 10; break;
    case 'boat': {
      const a = BOAT.heading + G.orbit + (G.lookX || 0), cp = G.camPitch ?? 0.32, D = G.camDist;
      const back = [-Math.sin(a)*Math.cos(cp)*D, Math.sin(cp)*D + 1.2, Math.cos(a)*Math.cos(cp)*D];
      T = { pos: add(BOAT.pos, back), look: add(add(BOAT.pos, mul(boatF(), 4)), [0, 0.3, 0]) }; T.pos[1] = back[1]; k = 5; break; }
    case 'fly': {
      const s = smooth(clamp((G.fly.t - 0.3)/Math.max(0.2, G.fly.T - 0.3), 0, 1)), a = boatView(), b = baitView(G.fly.to, 3.4, 2.3);
      T = { pos: vlerp(a.pos, b.pos, s), look: vlerp(a.look, b.look, s) }; k = 8; break; }
    case 'wait': {
      if (G.rig){ T = baitView(G.rig.pos, 3.4, 2.3); k = 3.5; break; }
      const L = G.lure.pos, dp = Math.min(-L[1], 7);
      T = baitView([L[0], 0, L[2]], 3.0 + dp*0.25, 2.2 + dp*0.25);
      T.look = [L[0], -dp*0.9 - 0.2, L[2]]; k = 3.5; break; }
    case 'hooked': {
      const f = G.hooked.pos;
      // hook set: the camera pulls in a little (quick at first, then settles)
      const L = G.hooked.len, ft = G.fight ? G.fight.t : 9;
      T = baitView([f[0], 0, f[2]], (2.6 + L*4)*0.72, (1.8 + L*3)*0.8, G.fightSide); k = ft < 0.8 ? 6 : 3.6; break; }
  }
  // after switching boat ↔ fishing the camera glides slowly from its current angle to the new one
  const tr = clamp((G.time - (G.navT ?? -9))/1.6, 0, 1);
  if (tr < 1 && (G.state === 'idle' || G.state === 'boat')) k = Math.min(k, lerp(1.6, k, tr*tr));
  const a = 1 - Math.exp(-dt*k);
  if (![...T.pos, ...T.look].every(isFinite)){ T = boatView(); }            // never feed NaN to the renderer
  cam.pos = vlerp(cam.pos, T.pos, a); cam.look = vlerp(cam.look, T.look, a);
  if (![...cam.pos, ...cam.look].every(isFinite)){ const e = eyeWorld(); cam.pos = e.slice(); cam.look = add(e, [0, -2, -10]); }
  if (G.state === 'wait' || G.state === 'hooked') cam.pos[1] = Math.max(cam.pos[1], -(floorDepth(cam.pos[0], cam.pos[2]) - 0.3));
  else cam.pos[1] = Math.max(cam.pos[1], Math.min(0.45, cam.pos[1] + dt*4));   // back above the water after retrieving
  const uw = cam.pos[1] < -0.03;
  if (uw !== G.camUnder){ G.camUnder = uw; if (uw && !G.underTold){ G.underTold = true; say('🤿 물속 시점 — 위로 기울이면 물 밖으로', 2.2); } }
}

/* ---------------- scene assembly ---------------- */
// camera shake while a hooked fish fights: bursts, head shakes and high line tension; a jolt on the hook set
const SHAKE = { a: 0, t: 0 };
function camShake(dt){
  let want = 0;
  if (G.state === 'hooked' && G.hooked && G.fight){
    const f = G.hooked, F = G.fight, str = clamp(f.pull, 0.3, 1)*(0.35 + 0.65*f.stamina);
    want = str*((f.run && f.run.burst ? 0.8 : 0.25) + clamp((F.tension - 0.55)/0.45, 0, 1)*0.8);
    if (F.t < 0.35) want = Math.max(want, 1.2*(1 - F.t/0.35));
  }
  SHAKE.a += (want - SHAKE.a)*Math.min(1, dt*(want > SHAKE.a ? 12 : 4)); SHAKE.t += dt;
  const a = SHAKE.a*0.045*(CFG.shake/0.5), t = SHAKE.t;   // setting 50% = the original strength
  if (a < 1e-4) return { pos: [0, 0, 0], look: [0, 0, 0] };
  const n = (w, p) => Math.sin(t*w + p)*0.6 + Math.sin(t*w*1.73 + p*2.1)*0.4;
  return { pos: [n(31, 0)*a, n(27, 1.3)*a*0.8, n(35, 2.7)*a], look: [n(23, 4.1)*a*2.2, n(29, 5.3)*a*1.6, n(19, 0.7)*a*2.2] };
}
// small rings where the rig touches the water: around a floating float, where the line cuts the surface,
// and stronger/faster at the line entry while a fish fights
function waterRings(S, dt){
  G.ringT = (G.ringT || 0) - dt; G.ringGap = (G.ringGap || 0) - dt;
  let p = null, every = 0, r = 0, k = 0, kick = false;
  if (G.state === 'hooked' && S.lineUnder){
    const t = G.fight ? G.fight.tension : 0.5, f = G.hooked;
    p = S.lineUnder[0]; every = 0.22 - 0.1*t; r = 0.07 + 0.04*t; k = 0.010 + 0.014*t;
    kick = f && f.run && f.run.burst && G.ringGap <= 0;            // the fish surges: an extra ring
  } else if (G.state === 'wait' && S.bobber && !S.bobber.flying){
    const rig = G.rig; p = S.bobber.pos; every = 1.4; r = 0.065; k = 0.006;
    kick = rig && Math.abs(rig.bobV || 0) > 0.12 && G.ringGap <= 0;  // the float bobs (nibble, bite, settling)
  } else if (G.state === 'wait' && S.lineUnder){
    const reel = !!(G.lure && G.lure.reeling);
    p = S.lineUnder[0]; every = reel ? 0.4 : 1.1; r = 0.06; k = reel ? 0.006 : 0.004;
    kick = reel !== G.ringReel && G.ringGap <= 0; G.ringReel = reel;  // start / stop reeling
  }
  if (!p) return;
  if (kick){ G.ringGap = 0.3; Rn.splash(p[0], p[2], r*1.2, k*1.8); }
  if (G.ringT > 0) return;
  G.ringT = every*rand(0.8, 1.2);
  Rn.splash(p[0], p[2], r, k);
}
function rodSpec(){
  const e = eyeWorld(), m = modeCfg();
  let yaw = viewYaw(), el = G.mode === 'pole' ? 0.2 : 0.5, bend = 0.04, target;
  // wind-up: the rod swings back over the right shoulder (stays in view) and whips forward on release
  if (G.state === 'charge'){ el += G.power*0.35; yaw += G.power*0.6; }
  if (G.state === 'fly'){ const s = smooth(clamp(G.fly.t/0.3, 0, 1)); el = lerp(el + G.fly.power*0.35, el - 0.1, s); yaw += lerp(G.fly.power*0.6, -0.08, s); }
  let focus = null;
  if (G.state === 'wait') focus = G.rig ? G.rig.pos : G.lure.pos;
  if (G.state === 'hooked') focus = G.hooked.pos;
  if (focus){
    yaw = Math.atan2(focus[0] - e[0], -(focus[2] - e[2]));
    if (G.state === 'hooked'){
      const P = rodPressure(); const fx = Math.sin(yaw), fz = -Math.cos(yaw);
      const hx = fx + P.w[0]*P.m*1.3, hz = fz + P.w[1]*P.m*1.3;
      yaw = Math.atan2(hx, -hz); el = 0.75 + 0.35*G.fight.tension*(mouse.down ? 1.4 : 1);
      bend = G.fight.tension*0.95;
    } else bend = G.mode === 'lure' && G.lure && G.lure.reeling ? 0.15 : 0.06;
  }
  const fw = yawDir(yaw), right = [Math.cos(yaw), 0, Math.sin(yaw)];
  const base = add(add(add(e, mul(right, 0.26)), [0, -0.42, 0]), mul(fw, 0.32));
  const dir = [fw[0]*Math.cos(el), Math.sin(el), fw[2]*Math.cos(el)];
  return { base, dir, len: m.rodLen, bend, kind: G.mode, target: null };
}
function scene(dt){
  const sh = camShake(dt);
  const S = { t: G.time, dt, cam: { pos: add(cam.pos, sh.pos), look: add(cam.look, sh.look) }, boat: BOAT, fish: [], lure: null, bobber: null, lineUnder: null, lineTo: null, lineSag: 0, flyObj: null };
  const byDist = fishes.slice().sort((a, b) => dist3(a.pos, cam.pos) - (a.visitor ? 25 : 0) - dist3(b.pos, cam.pos) + (b.visitor ? 25 : 0));
  S.fish = byDist.slice(0, 12).map(f => ({ pos: f.pos, len: f.len, dir: fishDir(f), tail: f.tail, back: f.sp.back, belly: f.sp.belly, pattern: f.sp.pattern, hr: f.sp.hr, shape: f.sp.shape }));
  const rod = rodSpec(); S.rod = G.state === 'boat' ? null : rod;
  S.hideRod = dist3(cam.pos, eyeWorld()) > 2.0;
  S.wake = wakeTrack(); S.particles = PART; S.rain = RAIN;
  if (G.state === 'boat') return S;
  const it = curItem();
  const tip = G.tip;
  if (G.state === 'idle' || G.state === 'charge' || G.state === 'result'){
    if (G.mode === 'pole'){ const p = add(tip, [0, -1.0, 0]); S.bobber = { pos: p, flying: true }; S.lineTo = add(p, [0, 0.2, 0]); }
    else { const p = add(tip, [0, -0.28, 0]); S.flyObj = { pos: p, r: 0.022 }; S.lineTo = p; }
  } else if (G.state === 'fly'){
    const p = flyPos();
    if (G.mode === 'pole'){ S.bobber = { pos: add(p, [0, 0.1, 0]), flying: true, tilt: 1.2 }; S.lineTo = add(p, [0, 0.3, 0]); }
    else { S.flyObj = { pos: p, r: 0.025 }; S.lineTo = p; }
    S.lineSag = 0.05;
  } else if (G.state === 'wait' && G.rig){
    const r = G.rig;
    S.bobber = { pos: [r.pos[0], r.bobY, r.pos[2]], tilt: r.tilt };
    S.lineTo = [r.pos[0], r.bobY + 0.2*Math.cos(r.tilt), r.pos[2] + 0.2*Math.sin(r.tilt)];
    S.lineSag = 0.02*dist2(r.pos, tip);
    if (!r.baitGone) S.lure = { pos: r.bait, dir: [1, 0, 0], size: it.size, color: it.color, kind: 0, metal: it.metal };
    S.lineUnder = [[r.pos[0], r.bobY - 0.3, r.pos[2]], r.bait];
  } else if (G.state === 'wait' && G.lure){
    const L = G.lure, t = tipXZ();
    const dh = dist2(L.pos, t) || 1, k = Math.min(1, (-L.pos[1])*0.8/dh);
    const entry = [L.pos[0] + (t[0]-L.pos[0])*k, 0, L.pos[2] + (t[2]-L.pos[2])*k];
    S.lure = { pos: L.pos, dir: L.dir, size: it.size, color: it.color, kind: it.kind, metal: it.metal };
    S.lineTo = entry; S.lineUnder = [[entry[0], -0.01, entry[2]], L.pos];
    S.lineSag = L.reeling ? 0.01*dh : 0.03*dh;
  } else if (G.state === 'hooked'){
    const f = G.hooked, t = tipXZ(), m = mouthOf(f);
    const dh = dist2(m, t) || 1, k = Math.min(1, (-m[1])*0.8/dh);
    const entry = [m[0] + (t[0]-m[0])*k, 0, m[2] + (t[2]-m[2])*k];
    S.lineTo = entry; S.lineUnder = [[entry[0], -0.01, entry[2]], m];
    S.lineSag = Math.max(0, 0.25 - G.fight.tension*0.4)*dh*0.08;
    if (G.mode === 'pole') S.bobber = { pos: [entry[0], -0.05, entry[2]], tilt: 1.3, flying: true };
  }
  rod.target = S.lineTo || add(rod.base, mul(rod.dir, 10));
  waterRings(S, dt);
  return S;
}

/* ---------------- HUD ---------------- */
let hudW = 0, hudH = 0;
function sizeHud(){ const d = Math.min(devicePixelRatio || 1, 2); hudW = innerWidth; hudH = innerHeight; hud.width = hudW*d; hud.height = hudH*d; ctx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', sizeHud); sizeHud();
function label(text, x, y, color, size){
  ctx.font = `700 ${size||15}px system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(text, x, y); ctx.fillStyle = color || '#fff'; ctx.fillText(text, x, y);
}
function ringAt(p, r, color, w){ const s = Rn.project(p); if (!s) return null; ctx.strokeStyle = color; ctx.lineWidth = w||2; ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, TAU); ctx.stroke(); return s; }
function drawHUD(){
  ctx.clearRect(0, 0, hudW, hudH);
  if (G.state === 'boat' || G.state === 'idle') drawSonar();
  const cx = hudW/2, cy = hudH/2;
  if (G.state === 'idle' || G.state === 'charge'){
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx-9, cy); ctx.lineTo(cx-3, cy); ctx.moveTo(cx+3, cy); ctx.lineTo(cx+9, cy); ctx.moveTo(cx, cy-9); ctx.lineTo(cx, cy-3); ctx.moveTo(cx, cy+3); ctx.lineTo(cx, cy+9); ctx.stroke();
    const pw = G.state === 'charge' ? G.power : 0;
    const p = landingPoint(pw);
    const s = ringAt(p, G.state === 'charge' ? 14 : 9, G.state === 'charge' ? 'rgba(255,220,90,.95)' : 'rgba(255,255,255,.35)', 2);
    if (s && G.state === 'charge') label(dist2(p, eyeWorld()).toFixed(1) + 'm', s[0], s[1] - 20, '#ffe27a', 13);
  }
  if (G.state === 'wait' && G.rig){
    const r = G.rig;
    // labels follow the float from above; underwater they sit by the bait (the float may be far above the view),
    // and they are kept on screen
    const uw = cam.pos[1] < -0.03;
    const tag = (y, dx = 0, dy = 0) => {
      const s = Rn.project(uw ? [r.bait[0], r.bait[1] + y*0.6, r.bait[2]] : [r.pos[0], y, r.pos[2]]); if (!s) return null;
      return [clamp(s[0] + dx, 60, hudW - 60), clamp(s[1] + dy, 90, hudH - 150)];
    };
    if (G.help){
      const s = tag(0.35);
      const f = G.engaged;
      if (s && f && f.state === 'take') label('챔질!', s[0], s[1] - 10, '#ffdf4a', 22);
      else if (s && f && f.state === 'nibble') label('입질…', s[0], s[1] - 10, '#bfe9ff', 15);
    }
    if (r.baitGone){ const s = tag(0.35, 0, -10); if (s) label('미끼 없음', s[0], s[1], '#ff9a8a', 14); }
    { const s = tag(0.12, 42, 4); if (s) label(`수심 ${fmtD(r.baitDepth)}m${r.laid ? ' · 바닥' : ''}`, s[0], s[1], 'rgba(255,255,255,.85)', 12); }
  }
  if (G.state === 'wait' && G.lure){
    const L = G.lure, s = Rn.project(L.pos);
    if (s){ ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,230,120,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s[0], s[1], 14, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      label(`${fmtD(-L.pos[1])}m`, s[0] + 30, s[1] + 4, 'rgba(255,255,255,.85)', 12); }
    if (G.strike){ const q = Rn.project([L.pos[0], 0.2, L.pos[2]]); if (q) label('바이트!', q[0], q[1] - 10, '#ffdf4a', 22); }
  }
  if (G.state === 'hooked') drawFightRing(cx, cy);
  updateGauges();
}
function drawFightRing(cx, cy){
  const f = G.hooked, F = G.fight, R = ringRadius();
  const cq = F.cq;
  const col = cq > 0.45 ? '110,230,140' : cq > 0.05 ? '255,220,90' : '255,110,90';
  const fp = Rn.project(f.pos);
  if (fp){ ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(fp[0], fp[1], 26, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${col},.55)`; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(cx, cy, R*0.12, 0, TAU); ctx.stroke();
  // fish swimming direction on screen
  const a = Rn.project(f.pos), b = Rn.project(add(f.pos, [Math.cos(f.heading), 0, Math.sin(f.heading)]));
  if (a && b){
    let dx = b[0]-a[0], dy = b[1]-a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const x0 = cx + dx*R*0.25, y0 = cy + dy*R*0.25, x1 = cx + dx*R*1.08, y1 = cy + dy*R*1.08;
    ctx.strokeStyle = 'rgba(255,90,70,.95)'; ctx.fillStyle = 'rgba(255,90,70,.95)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1 + dx*14, y1 + dy*14); ctx.lineTo(x1 - dy*10, y1 + dx*10); ctx.lineTo(x1 + dy*10, y1 - dx*10); ctx.fill();
    label('물고기', x1 + dx*34, y1 + dy*34 + 5, '#ff8a70', 13);
    // ideal counter direction hint
    ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(110,230,140,.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx - dx*R, cy - dy*R, 12, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  // angler's rod pressure
  let ox = mouse.x - cx, oy = mouse.y - cy; const ol = Math.hypot(ox, oy); if (ol > R){ ox *= R/ol; oy *= R/ol; }
  ctx.strokeStyle = `rgba(${col},.9)`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + ox, cy + oy); ctx.stroke();
  ctx.fillStyle = `rgba(${col},1)`; ctx.beginPath(); ctx.arc(cx + ox, cy + oy, 9, 0, TAU); ctx.fill();
  // stamina
  const w = R*1.4, x = cx - w/2, y = cy + R + 26;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x-2, y-2, w+4, 10);
  ctx.fillStyle = f.stamina < 0.4 ? '#6fe38c' : '#ffb35c'; ctx.fillRect(x, y, w*f.stamina, 6);
  label(f.stamina < 0.4 ? '물고기가 지쳤다! 끌어오세요' : '물고기 힘', cx, y + 24, f.stamina < 0.4 ? '#8ff0a8' : '#fff', 13);
}
let gaugeCache = '';
function updateGauges(){
  const m = modeCfg();
  const F = G.fight;
  const T = F ? F.tension : 0;
  $('tfill').style.width = (clamp(T, 0, 1.1)/1.1*100).toFixed(1) + '%';
  $('tfill').className = T > 0.85 ? 'danger' : T > 0.6 ? 'warn' : '';
  $('dragmark').style.left = (clamp(G.drag, 0, 1.1)/1.1*100).toFixed(1) + '%';
  $('dragmark').style.display = G.mode === 'lure' ? 'block' : 'none';
  const lines = [];
  const lk = lineKg();
  $('tbar').hidden = G.state === 'boat';
  if (G.state === 'boat'){
    const hdg = ((BOAT.heading*180/Math.PI) % 360 + 360) % 360;
    lines.push(`<div><span>속도</span><b>${(Math.abs(G.boatV)*1.944).toFixed(1)}노트</b></div>`);
    lines.push(`<div><span>방위</span><b>${Math.round(hdg)}° ${['북','북동','동','남동','남','남서','서','북서'][Math.round(hdg/45)%8]}</b></div>`);
    lines.push(`<div><span>수심</span><b>${fmtD(floorDepth(BOAT.pos[0], BOAT.pos[2]))}m</b></div>`);
    lines.push(`<div><span>기점 거리</span><b>${Math.round(Math.hypot(BOAT.pos[0], BOAT.pos[2]))}m</b></div>`);
  } else {
  if (G.mode === 'lure') lines.push(`<div><span>드랙</span><b>${(G.drag*lk).toFixed(1)}kg${G.drag >= 1 ? ' 🔒' : ''}</b></div>`);
  else lines.push(`<div><span>찌 수심</span><b>${fmtD(G.depthSet)}m</b></div>`);
  lines.push(`<div><span>원줄</span><b>${lk.toFixed(0)}kg</b></div>`);
  }
  if (F) lines.push(`<div><span>거리</span><b>${F.lineOut.toFixed(1)}m</b></div>`);
  else if (G.rig) lines.push(`<div><span>바닥</span><b>${fmtD(G.rig.floor)}m</b></div>`);
  else if (G.lure) lines.push(`<div><span>거리</span><b>${dist2(G.lure.pos, tipXZ()).toFixed(1)}m</b></div>`);
  if (G.state !== 'boat') lines.push(`<div><span>장력</span><b>${(T*lk).toFixed(1)}kg</b></div>`);   // last, right above the tension bar
  const h = lines.join('');
  if (h !== gaugeCache){ $('ginfo').innerHTML = h; gaugeCache = h; }
  $('retrieve').hidden = G.state !== 'wait';
  $('bottombar').classList.toggle('locked', G.state !== 'idle' && G.state !== 'charge' && G.state !== 'boat');
  $('navfish').className = G.state === 'boat' ? '' : 'on'; $('navboat').className = G.state === 'boat' ? 'on' : '';
}

/* ---------------- time of day ---------------- */
const PERIOD_NAME = { dawn: '새벽', day: '낮', dusk: '해질녘', night: '밤' };
function period(h){ h = h ?? G.clock; return h >= 4.5 && h < 7.5 ? 'dawn' : h >= 7.5 && h < 17 ? 'day' : h >= 17 && h < 19.8 ? 'dusk' : 'night'; }
function activity(sp){ return Math.max(0.05, (sp.act || {})[period()] ?? 0.7); }
function updateClock(dt){
  G.clock = (G.clock + dt/GAME_HOUR) % 24;
  const lat = REGION.spot.lat, h = G.clock;
  const noon = clamp(90 - Math.abs(lat - 10), 22, 82);
  const el = noon*Math.sin(Math.PI*(h - 5.5)/13.5);           // sunrise 05:30, sunset 19:00
  const az = lat >= 0 ? 90 + (h - 5.5)*13.3 : 90 - (h - 5.5)*13.3;
  const dayK = clamp((el + 6)/16, 0, 1), warm = el > 0 ? 1 - clamp((el - 2)/22, 0, 1) : 1;
  Rn.setLight(el, az, dayK, warm);
}
function skipTime(){
  if (G.state === 'result') hideCard();
  if (G.state !== 'idle' && G.state !== 'boat'){ say('채비를 회수한 뒤 이용할 수 있어요 (R)', 1.8); return; }
  const order = [['dawn', 5], ['day', 10], ['dusk', 17.5], ['night', 21]];
  const i = order.findIndex(o => o[0] === period());
  const [p, h] = order[(i + 1) % order.length];
  G.clock = h; say(`⏩ ${PERIOD_NAME[p]} (${fmtClock()})`, 1.6);
}
function fmtClock(){ const h = Math.floor(G.clock), m = Math.floor((G.clock - h)*60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

/* ---------------- weather ---------------- */
// vector: cloud cover, fog, rain, wind (0..1)
const WEATHERS = {
  clear:  { name:'맑음', icon:'☀️', v:[0.0, 0.0, 0.0, 0.1] },
  cloudy: { name:'흐림', icon:'☁️', v:[0.75, 0.1, 0.0, 0.3] },
  rain:   { name:'비',   icon:'🌧️', v:[0.9, 0.25, 1.0, 0.45] },
  fog:    { name:'안개', icon:'🌫️', v:[0.45, 1.0, 0.0, 0.05] },
  windy:  { name:'강풍', icon:'💨', v:[0.35, 0.0, 0.0, 1.0] },
};
function weatherOdds(){
  const b = REGION.biome;
  if (b.startsWith('trop')) return { clear: 4, cloudy: 3, rain: 3, fog: 0.5, windy: 1 };
  if (b.startsWith('cold')) return { clear: 2, cloudy: 3, rain: 2, fog: 2.5, windy: 2 };
  return { clear: 4, cloudy: 3, rain: 2, fog: 1.5, windy: 1.5 };
}
function pickWeather(){
  const o = weatherOdds(); let t = 0; for (const k in o) t += o[k];
  let r = Math.random()*t; for (const k in o){ r -= o[k]; if (r <= 0) return k; } return 'clear';
}
function setWeather(k, instant){
  G.weather = k; G.weatherT = rand(3, 7);
  if (instant) G.wv = WEATHERS[k].v.slice();
}
function updateWeather(dt){
  if (!G.weather) setWeather(new URLSearchParams(location.search).get('weather') || 'clear', true);
  G.weatherT -= dt/GAME_HOUR;
  if (G.weatherT <= 0){ const prev = G.weather; setWeather(pickWeather()); if (G.weather !== prev) say(`${WEATHERS[G.weather].icon} 날씨가 바뀌었어요: ${WEATHERS[G.weather].name}`, 2.5); }
  const tv = WEATHERS[G.weather].v, k = Math.min(1, dt*0.06);
  for (let i = 0; i < 4; i++) G.wv[i] += (tv[i] - G.wv[i])*k;
  Rn.setWeather(G.wv);
}
// rain streaks around the camera
const RAIN = { drops: [], data: new Float32Array(500*6), n: 0 };
function updateRain(dt){
  const want = Math.round(480*G.wv[2]), wind = G.wv[3]*3;
  while (RAIN.drops.length < want) RAIN.drops.push([cam.pos[0] + rand(-14, 14), cam.pos[1] + rand(-2, 9), cam.pos[2] + rand(-14, 14)]);
  RAIN.drops.length = Math.min(RAIN.drops.length, want);
  let n = 0;
  for (const d of RAIN.drops){
    d[0] += wind*dt; d[1] -= 9*dt;
    if (d[1] < 0 || Math.abs(d[0] - cam.pos[0]) > 15 || Math.abs(d[2] - cam.pos[2]) > 15){ d[0] = cam.pos[0] + rand(-14, 14); d[1] = cam.pos[1] + rand(5, 10); d[2] = cam.pos[2] + rand(-14, 14); }
    RAIN.data.set([d[0], d[1], d[2], d[0] - wind*0.04, d[1] + 0.34, d[2]], n*6); n++;
  }
  RAIN.n = n;
  // rain hiss
  if (AU.ctx){
    if (!AU.rain){ const c = AU.ctx, s0 = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s0.buffer = AU.noise; s0.loop = true; f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.4; g.gain.value = 0; s0.connect(f); f.connect(g); g.connect(AU.amb); s0.start(); AU.rain = g; }
    AU.rain.gain.setTargetAtTime(0.05*G.wv[2] + 0.015*G.wv[3], AU.ctx.currentTime, 0.5);
  }
}
// weather and fish: low light (clouds, fog, rain) brings predators on and relaxes wary fish;
// rain muddies the water for bottom feeders; strong wind turns off surface feeding
function weatherFactor(sp){
  const [cl, fog, rain, wind] = G.wv, low = Math.max(cl, fog);
  let f = 1;
  if (sp.aggr >= 0.8) f *= 1 + 0.35*low;
  if (sp.wary >= 0.55) f *= (period() === 'day' ? 0.75 + 0.35*low : 1) + 0.15*rain;
  if (sp.zone === 'bottom') f *= 1 + 0.25*rain;
  f *= 1 - 0.4*wind*(sp.zone === 'top' ? 1 : 0.4);
  return f;
}

/* ---------------- bite model: does the angler's approach match how this species feeds? ---------------- */
function depthFactor(sp, d, x, z){
  const fd = floorDepth(x, z), [lo, hi] = depthBand(sp);
  let f = d < lo ? Math.exp(-(lo - d)/1.2) : d > hi ? Math.exp(-(d - hi)/1.2) : 1;
  if (sp.zone === 'bottom' && fd - d > 0.8) f *= 0.3;        // bottom feeders want the bait on or near the bed
  if (sp.zone === 'top' && d > 1.6) f *= 0.45;
  return Math.max(0.03, f);
}
function retrieveFactor(sp){
  if (G.mode !== 'lure' || !G.lure) return 1;
  const duty = G.lure.duty, got = duty < 0.45 ? 'slow' : duty > 0.85 ? 'fast' : 'medium';
  if (got === sp.retrieve) return 1.25;
  return (got === 'medium' || sp.retrieve === 'medium') ? 0.7 : 0.35;
}
function gearFactor(sp){ const k = lineKg()/baseLineKg(); return 1 - sp.wary*clamp((k - 1)*0.3, 0, 0.6); }   // thick line spooks wary fish
function biteFactor(sp, d, x, z){
  if (sp.sight) return 0;
  return (sp.pref[curItem().id] || 0) * depthFactor(sp, d, x, z) * activity(sp) * weatherFactor(sp) * gearFactor(sp) * retrieveFactor(sp) * luckFactor();
}
// 0..1 rating of the current rig for a species (shown for the quest target)
function matchRating(sp){
  let d, x, z;
  if (G.rig){ d = -G.rig.bait[1]; x = G.rig.pos[0]; z = G.rig.pos[2]; }
  else if (G.lure){ d = -G.lure.pos[1]; x = G.lure.pos[0]; z = G.lure.pos[2]; }
  else { const p = landingPoint(0.5); x = p[0]; z = p[2]; d = G.mode === 'pole' ? Math.min(G.depthSet, floorDepth(x, z) - 0.03) : 1; }
  const parts = { bait: sp.pref[curItem().id] || 0, depth: depthFactor(sp, d, x, z), time: activity(sp), weather: Math.min(1, weatherFactor(sp)), gear: gearFactor(sp), retrieve: Math.min(1, retrieveFactor(sp)) };
  const v = parts.bait*parts.depth*parts.time*parts.gear*parts.retrieve*weatherFactor(sp);
  return { v, parts };
}

/* ---------------- save data ---------------- */
const SAVE_KEY = 'boatfish.v2';
const P = { coins: 200, owned: {}, tier: { rod: 0, reel: 0, line: 0, hook: 0, sonar: 0, engine: 0, boat: 0, net: 0 }, sightings: {}, quests: [], done: 0,
  net: [], caught: {}, daily: {}, luckUntil: 0, att: { last: '', streak: 0, log: [] }, week: { key: '', issued: 0, done: 0 } };
for (const it of [...BAITS, ...LURES]) if (!it.cost) P.owned[it.id] = true;
function save(){
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ P, best: G.best, score: G.score, catches: G.catches.slice(0, 30).map(c => ({ id: c.sp.id, len: c.len, weight: c.weight, pts: c.pts })), clock: G.clock, spot: REGION && REGION.spot })); } catch(e){}
}
function load(){
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (!d) return null;
    Object.assign(P.tier, d.P.tier || {}); Object.assign(P.owned, d.P.owned || {}); P.coins = d.P.coins ?? P.coins;
    P.sightings = d.P.sightings || {};
    P.net = (d.P.net || []).filter(f => BY_ID[f.id]); P.caught = d.P.caught || {}; P.daily = d.P.daily || {}; P.luckUntil = d.P.luckUntil || 0;
    Object.assign(P.att, d.P.att || {}); Object.assign(P.week, d.P.week || {});
    if (!d.P.caught) for (const c of d.catches || []) if (BY_ID[c.id]) P.caught[c.id] = (P.caught[c.id] || 0) + 1;
    P.quests = (d.P.quests || []).filter(q => q.sp ? BY_ID[q.sp] : true); P.done = d.P.done || 0;
    G.score = d.score || 0; G.clock = d.clock ?? G.clock;
    for (const k in (d.best || {})) if (BY_ID[k]) G.best[k] = Object.assign(d.best[k], { sp: BY_ID[k] });
    G.catches = (d.catches || []).filter(c => BY_ID[c.id]).map(c => ({ ...c, sp: BY_ID[c.id], name: BY_ID[c.id].name }));
    return d.spot || null;
  } catch(e){ return null; }
}

/* ---------------- gear ---------------- */
function shopItem(id){ return SHOP.find(s => s.id === id); }
function tierOf(id){ return shopItem(id).tiers[P.tier[id]]; }
function baseLineKg(){ return G.mode === 'pole' ? (isSalt() ? 6 : 4) : (isSalt() ? 14 : 7); }
function castScale(){ return tierOf('rod').cast; }
function rodAbsorb(){ return tierOf('rod').absorb; }
function reelScale(){ return tierOf('reel').speed; }
function hookHold(){ return tierOf('hook').hold; }
function boatMax(){ return tierOf('engine').speed; }

/* ---------------- rare visitors: whales, sharks, sunfish … sometimes just swim past ---------------- */
function updateVisitors(dt){
  G.visitT = (G.visitT ?? 8) - dt;
  if (G.visitT > 0) return;
  G.visitT = 10;
  if (fishes.some(f => f.visitor)) return;
  const list = BIOMES[REGION.biome].visitors || [];
  for (const [id, perMin] of list){
    if (Math.random() < perMin*10/60){ spawnVisitor(BY_ID[id]); break; }
  }
}
function spawnVisitor(sp){
  const c = focusPoint(), a = rand(0, TAU), side = rand(-9, 9);
  const dir = [Math.cos(a), Math.sin(a)], perp = [-dir[1], dir[0]];
  const start = [c[0] - dir[0]*38 + perp[0]*side, 0, c[2] - dir[1]*38 + perp[1]*side];
  const f = newFish(start, 0, 0.1, sp);
  f.pos = [start[0], 0, start[2]];
  const fd = floorDepth(start[0], start[2]);
  f.pos[1] = -clamp(toVis(rand(sp.dmin, sp.dmax)), 0.6 + f.len*0.12, Math.min(VIS_DEPTH - 1, Math.max(1, fd - f.len*0.2)));
  f.state = 'cruise'; f.visitor = true; f.cruise = sp.speed*rand(0.7, 1);
  f.target = [c[0] + dir[0]*45 + perp[0]*side, 0, c[2] + dir[1]*45 + perp[1]*side]; f.ty = f.pos[1];
  f.heading = Math.atan2(dir[1], dir[0]);
  fishes.push(f);
}
// release luck: every fish set free adds a minute of +20% bites (up to 10 minutes)
function luckLeft(){ return Math.max(0, (P.luckUntil || 0) - Date.now())/1000; }
function luckFactor(){ return luckLeft() > 0 ? 1.2 : 1; }
// a visitor only counts once you have really looked at it: on screen near the middle, close enough to see through
// this water (murky lakes hide a whale a few metres down), and in view for a moment
function waterVis(){ const W = WATERS[REGION.spot.water], k = (W.sigA[1] + W.sigS[1] + W.sigA[2] + W.sigS[2])/2; return clamp(2.2/k, 3, 30); }
function checkSightings(dt){
  if (G.mapOpen) return;
  const vis = waterVis();
  for (const f of fishes){
    if (!f.visitor || f.seen) continue;
    const s = Rn.project(f.pos), d = dist3(f.pos, cam.pos), depth = Math.max(0, -f.pos[1] - f.len*0.25);
    const under = d*depth/Math.max(0.3, depth + cam.pos[1]);   // how much of the sight line runs underwater
    const ok = s && s[0] > innerWidth*0.12 && s[0] < innerWidth*0.88 && s[1] > innerHeight*0.1 && s[1] < innerHeight*0.9
      && d < 32 && under < vis && !insideHull(f.pos[0], f.pos[2], 0.2);
    f.lookT = ok ? (f.lookT || 0) + dt : Math.max(0, (f.lookT || 0) - dt*0.5);
    if (f.lookT < 1.2) continue;
    f.seen = true;
    const first = !P.sightings[f.sp.id];
    P.sightings[f.sp.id] = (P.sightings[f.sp.id] || 0) + 1;
    const bonus = first ? f.sp.sightCoins || 300 : Math.round((f.sp.sightCoins || 300)*0.2);
    P.coins += bonus;
    say(`${f.sp.icon || '👀'} ${f.sp.name} 목격! +${bonus}🪙${first ? ' (첫 목격)' : ''}`, 3.5, 'hot');
    sfx.win();
    questEvent({ type: 'sight', sp: f.sp });
    updateLog(); save();
  }
}

/* ---------------- quests ---------------- */
function catchables(biome){ return BIOMES[biome].fish.map(([id, w]) => [BY_ID[id], w]).filter(([sp]) => !sp.sight); }
function questSpots(){ const z = boatZone(); return SPOTS.filter(s => spotZone(s) <= z); }
function genQuest(){
  // half the quests send you somewhere else your boat can reach
  let loc = REGION.spot;
  if (Math.random() < 0.5){ const l = questSpots().filter(s => s.name !== loc.name); if (l.length) loc = l[Math.floor(Math.random()*l.length)]; }
  const pool = catchables(loc.biome);
  const pick = () => { let t = 0; for (const [, w] of pool) t += w; let r = Math.random()*t; for (const [sp, w] of pool){ r -= w; if (r <= 0) return sp; } return pool[0][0]; };
  const r = Math.random(); let q;
  const rareMul = sp => 1 + sp.rare;
  if (r < 0.34){
    const sp = pick(), n = sp.rare < 1.2 ? Math.floor(rand(2, 4)) : 1;
    q = { type: 'species', sp: sp.id, n, got: 0, text: `${sp.name} ${n}마리 잡기`, reward: Math.round(120*n*rareMul(sp)) };
  } else if (r < 0.6){
    const sp = pick(), L = Math.round(lerp(sp.minLen, sp.maxLen, rand(0.35, 0.7))*100);
    q = { type: 'length', sp: sp.id, len: L, got: 0, n: 1, text: `${sp.name} ${L}cm 이상`, reward: Math.round(260*rareMul(sp)*(1 + L/100)) };
  } else if (r < 0.78){
    const maxW = Math.max(...pool.map(([sp]) => sp.wk*Math.pow(sp.maxLen*100, 3)));
    const kgT = Math.max(0.3, Math.round(maxW*rand(0.15, 0.35)*10)/10);
    q = { type: 'weight', kg: kgT, got: 0, n: 1, text: `${loc.name}에서 ${kgT}kg 이상 한 마리`, reward: Math.round(200 + kgT*90) };
  } else if (r < 0.92){
    const night = pool.filter(([sp]) => (sp.act?.night ?? 0) > 0.7 || (sp.act?.dawn ?? 0) > 0.8);
    const sp = (night.length ? night[Math.floor(Math.random()*night.length)] : pool[0])[0];
    const per = ['dawn', 'day', 'dusk', 'night'].reduce((a, b) => (sp.act?.[a] ?? 0) >= (sp.act?.[b] ?? 0) ? a : b);
    q = { type: 'time', sp: sp.id, period: per, got: 0, n: 1, text: `${PERIOD_NAME[per]}에 ${sp.name} 잡기`, reward: Math.round(220*rareMul(sp)) };
  } else {
    const vis = (BIOMES[loc.biome].visitors || []).map(v => BY_ID[v[0]]);
    const all = Object.values(BIOMES).flatMap(b => (b.visitors || []).map(v => BY_ID[v[0]]));
    const sp = (vis.length ? vis : all)[Math.floor(Math.random()*(vis.length || all.length))];
    q = { type: 'sight', sp: sp.id, got: 0, n: 1, text: `${sp.name} 목격하기`, reward: Math.round((sp.sightCoins || 300)*1.2) };
  }
  q.id = Math.random().toString(36).slice(2, 8); q.where = loc.name;
  q.spot = SPOTS.includes(loc) ? loc.id : null; q.lat = loc.lat; q.lon = loc.lon;
  return q;
}
function questSpot(q){
  if (q.spot) return SPOTS.find(s => s.id === q.spot) || null;
  const named = SPOTS.find(s => s.name === q.where); if (named) return named;   // quests saved before locations were stored
  if (q.lat != null){ const s = classify(q.lat, q.lon); s.name = q.where; return s; }
  return null;
}
function questHere(q){ return !q.where || q.where === REGION.spot.name; }
function questReachable(q){ const s = questSpot(q); return !s || questHere(q) || spotZone(s) <= boatZone(); }
function fillQuests(){
  weekRoll();
  let guard = 0;
  while (P.quests.length < 3 && guard++ < 40){
    const q = genQuest();
    if (P.quests.some(o => o.text === q.text || (o.sp && o.sp === q.sp && o.type === q.type))) continue;
    P.quests.push(q); P.week.issued++;
  }
  renderQuests();
}
function questEvent(e){
  let changed = false;
  for (const q of P.quests){
    if (q.got >= q.n) continue;
    let ok = false;
    if (e.type === 'catch'){
      const c = e.rec;
      if (q.type === 'species') ok = c.sp.id === q.sp;
      else if (q.type === 'length') ok = c.sp.id === q.sp && c.len*100 >= q.len;
      else if (q.type === 'weight') ok = c.weight >= q.kg && q.where === REGION.spot.name;
      else if (q.type === 'time') ok = c.sp.id === q.sp && period() === q.period;
    } else if (e.type === 'sight') ok = q.type === 'sight' && e.sp.id === q.sp;
    if (ok){ q.got++; changed = true;
      if (q.got >= q.n){ weekRoll(); P.done++; P.week.done++; q.claim = true; q.doneAt = G.time;
        celebrate('🎉 퀘스트 완료!', `${q.text} · 퀘스트 창에서 보상 ${q.reward.toLocaleString()}🪙 받기`); } }
  }
  if (changed){ renderQuests(); save(); }
}
function questTarget(){
  const here = new Set(BIOMES[REGION.biome].fish.map(f => f[0]));
  const q = P.quests.find(q => q.sp && q.got < q.n && q.type !== 'sight' && here.has(q.sp));
  return q ? BY_ID[q.sp] : null;
}
function stars(v){ const n = v > 0.45 ? 5 : v > 0.25 ? 4 : v > 0.12 ? 3 : v > 0.05 ? 2 : v > 0.015 ? 1 : 0; return '★'.repeat(n) + '☆'.repeat(5 - n); }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
// top-left tracker: titles only, always visible
function renderQuests(){
  const list = P.quests.filter(questReachable);
  $('qlist').innerHTML = list.map(q => `<div class="${q.got >= q.n ? 'done' : ''}"><b>${q.got >= q.n ? '✅ ' : ''}${esc(q.text)}</b><span>${q.got >= q.n ? '🎁 보상' : questHere(q) ? (q.n > 1 ? `${q.got}/${q.n}` : '') : '📍' + esc(q.where)}</span></div>`).join('')
    || '<div><span>새 퀘스트를 준비 중…</span></div>';
  if (!$('questm').hidden) renderQuestModal();
}

/* ---------------- celebration effects ---------------- */
function fxLayer(){ let l = $('fx'); if (!l){ l = document.createElement('div'); l.id = 'fx'; document.body.appendChild(l); } return l; }
function confetti(n, x, y){
  const L = fxLayer(), cols = ['#ffd84a', '#8ff0a8', '#6fd3ff', '#ff7a59', '#ff9ad5', '#ffffff'];
  for (let i = 0; i < n; i++){
    const c = document.createElement('i'); c.className = 'cf';
    c.style.background = cols[i % cols.length]; c.style.left = x + 'px'; c.style.top = y + 'px';
    if (i % 3 === 0) c.style.borderRadius = '50%';
    L.appendChild(c);
    const a = Math.random()*Math.PI*2, v = 120 + Math.random()*260, dx = Math.cos(a)*v, dy = Math.sin(a)*v - 160, rot = (Math.random() - 0.5)*900;
    c.animate([{ transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
               { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot/2}deg)`, opacity: 1, offset: 0.35 },
               { transform: `translate(calc(-50% + ${dx*1.25}px), calc(-50% + ${dy + 420}px)) rotate(${rot}deg)`, opacity: 0 }],
              { duration: 1500 + Math.random()*900, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => c.remove();
  }
}
function celebrate(title, sub){
  const L = fxLayer(), b = document.createElement('div'); b.className = 'cbanner';
  b.innerHTML = '<b></b><span></span>'; b.firstChild.textContent = title; b.lastChild.textContent = sub || '';
  L.appendChild(b);
  b.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.12)', opacity: 1, offset: 0.18 },
             { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.28 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.85 },
             { transform: 'translate(-50%,-60%) scale(.96)', opacity: 0 }], { duration: 3200, easing: 'ease-out' }).onfinish = () => b.remove();
  confetti(70, innerWidth/2, innerHeight*0.36);
  sfx.win(); setTimeout(() => sfx.plop(), 180); padRumble(0.3, 0.6, 200, 60);
}
function coinBurst(amount, from){
  const L = fxLayer(), r = from ? from.getBoundingClientRect() : { left: innerWidth/2, top: innerHeight/2, width: 0, height: 0 };
  const x0 = r.left + r.width/2, y0 = r.top + r.height/2, t = $('coins').getBoundingClientRect(), x1 = t.left + 12, y1 = t.top + t.height/2;
  const lbl = document.createElement('div'); lbl.className = 'cplus'; lbl.textContent = `+${amount.toLocaleString()} 🪙`; lbl.style.left = x0 + 'px'; lbl.style.top = y0 + 'px';
  L.appendChild(lbl);
  lbl.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-120%) scale(1.25)', opacity: 1, offset: 0.25 },
               { transform: 'translate(-50%,-190%) scale(1)', opacity: 0 }], { duration: 1500, easing: 'ease-out' }).onfinish = () => lbl.remove();
  for (let i = 0; i < 14; i++){
    const c = document.createElement('i'); c.className = 'coin'; c.textContent = '🪙'; c.style.left = x0 + 'px'; c.style.top = y0 + 'px'; L.appendChild(c);
    const mx = (x0 + x1)/2 + (Math.random() - 0.5)*220, my = Math.min(y0, y1) - 60 - Math.random()*120;
    c.animate([{ transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
               { transform: `translate(calc(-50% + ${mx - x0}px), calc(-50% + ${my - y0}px)) scale(1.2)`, opacity: 1, offset: 0.45 },
               { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.6)`, opacity: 0.2 }],
              { duration: 800 + i*45, delay: i*35, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'backwards' }).onfinish = () => c.remove();
  }
  confetti(26, x0, y0);
  setTimeout(() => { const cc = $('coins'); cc.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 380 }); sfx.click(0.08); }, 900);
}

/* ---------------- modals ---------------- */
const MODALS = ['map', 'shop', 'questm', 'rankm', 'dexm', 'confirm', 'setm', 'netm'];
function openModal(id){
  for (const m of MODALS) $(m).hidden = m !== id;
  G.mapOpen = true; mouse.down = false; mouse.rdown = false; $('menu').hidden = true; $('itempop').hidden = true;
  for (const k in keys) keys[k] = false;
}
function closeModal(){
  if (MAP.anim) return;
  const shop = !$('shop').hidden;
  for (const m of MODALS) $(m).hidden = true;
  G.mapOpen = false;
  if (shop) buildToolbar();
}
function idleOnly(what){ if (G.state === 'result') hideCard(); if (G.state === 'idle' || G.state === 'boat' || G.state === 'result') return true; say(`채비를 회수한 뒤 ${what} (R)`, 1.8); return false; }
for (const b of document.querySelectorAll('.mclose')) b.addEventListener('click', e => { e.stopPropagation(); closeModal(); });
for (const id of ['questm', 'rankm', 'dexm', 'setm', 'netm']) $(id).addEventListener('pointerdown', e => { if (e.target === $(id)) closeModal(); });
$('confirm').addEventListener('pointerdown', e => { if (e.target === $('confirm')) $('cno').click(); });
function confirmBox(html, yes, onYes, onNo){
  openModal('confirm'); $('ctext').innerHTML = html; $('cyes').textContent = yes;
  $('cyes').onclick = e => { e.stopPropagation(); onYes(); };
  $('cno').onclick = e => { e?.stopPropagation?.(); if (onNo) onNo(); else closeModal(); };
}

/* ---------------- dates: attendance and weekly stats ---------------- */
function dayKey(d = new Date()){ return d.getFullYear()*10000 + (d.getMonth() + 1)*100 + d.getDate() + ''; }
function weekDays(){ const d = new Date(), m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6)%7); return [...Array(7)].map((_, i) => dayKey(new Date(m.getFullYear(), m.getMonth(), m.getDate() + i))); }
function weekKey(){ return weekDays()[0]; }
function weekRoll(){ const k = weekKey(); if (P.week.key !== k){ P.week.key = k; P.week.issued = P.quests.filter(q => q.got < q.n).length; P.week.done = 0; } }
function yesterdayKey(){ const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); }
function attReward(streak){ return 100 + 50*Math.min(streak - 1, 6); }
function attend(){
  const a = P.att, t = dayKey(); if (a.last === t) return;
  a.streak = a.last === yesterdayKey() ? a.streak + 1 : 1; a.last = t;
  a.log = [...a.log.filter(k => k !== t), t].slice(-60);
  const r = attReward(a.streak); P.coins += r;
  say(`📅 출석 ${a.streak}일째 · +${r}🪙`, 2.5, 'hot'); sfx.win(); updateLog(); save(); renderQuestModal();
}
$('attbtn').addEventListener('click', e => { e.stopPropagation(); attend(); });

function openQuests(){ openModal('questm'); renderQuestModal(); }
function renderQuestModal(){
  weekRoll();
  const a = P.att, t = dayKey(), alive = a.last === t || a.last === yesterdayKey(), streak = alive ? a.streak : 0;
  $('qsub').textContent = '';
  $('streak').textContent = `🔥 ${streak}일 연속`;
  const names = ['월', '화', '수', '목', '금', '토', '일'];
  $('attdays').innerHTML = weekDays().map((k, i) => `<i class="${a.log.includes(k) ? 'got' : ''}${k === t ? ' today' : ''}">${names[i]}<br>${a.log.includes(k) ? '✓' : '·'}</i>`).join('');
  const done = a.last === t;
  $('attbtn').disabled = done;
  $('attbtn').textContent = done ? `오늘 출석 완료 ✓ · 내일 +${attReward(streak + 1)}🪙` : `출석하기 +${attReward(alive ? a.streak + 1 : 1)}🪙`;
  const w = P.week, pct = w.issued ? Math.round(w.done/w.issued*100) : 0;
  const wkCatch = weekDays().reduce((s, k) => s + (P.daily[k] || 0), 0);
  const best = Math.max(0, ...weekDays().map(k => P.daily[k] || 0));
  $('wkpct').textContent = pct + '%'; $('wkfill').style.width = pct + '%';
  $('wkstat').innerHTML = `완료 <b>${w.done}</b> / 받은 퀘스트 <b>${w.issued}</b><br>이번 주 포획 <b>${wkCatch}</b>마리 · 하루 최다 <b>${best}</b>마리 · 오늘 <b>${P.daily[t] || 0}</b>마리`;
  const list = P.quests.filter(questReachable);
  $('quests').innerHTML = list.map(q => {
    const sp = q.sp ? BY_ID[q.sp] : null, here = questHere(q);
    const tip = sp && sp.tip ? `<div class="tip">💡 ${esc(sp.tip)}</div>` : '';
    const prog = q.n > 1 ? `<span class="prog">${q.got}/${q.n}</span>` : '';
    return `<div class="q${q.got >= q.n ? ' done' : ''}"><div class="qt">${esc(q.text)}${prog}</div><div class="rw">${q.reward}🪙</div>
      <div class="qw">📍 ${esc(q.where || REGION.spot.name)}${q.type === 'sight' ? ' · 관찰 퀘스트' : ''}${here ? ' · 현재 위치' : ''}</div>
      ${q.got >= q.n ? `<button class="go claim" data-c="${q.id}">🎁 보상 받기</button>` : here ? '<span></span>' : `<button class="go" data-q="${q.id}">⛵ 이동</button>`}${tip}</div>`;
  }).join('') || '<div class="q"><div class="qt">받을 수 있는 퀘스트가 없어요</div></div>';
  $('quests').insertAdjacentHTML('beforeend', `<div class="qfoot">보트 등급에 따라 갈 수 있는 지역의 퀘스트만 나와요 <button id="qreroll">새 퀘스트로 바꾸기</button></div>`);
  $('qreroll').onclick = e => { e.stopPropagation(); P.quests = []; fillQuests(); save(); };
  for (const b of $('quests').querySelectorAll('[data-q]')) b.onclick = e => { e.stopPropagation(); askTravel(P.quests.find(q => q.id === b.dataset.q)); };
  for (const b of $('quests').querySelectorAll('[data-c]')) b.onclick = e => { e.stopPropagation(); claimQuest(b.dataset.c, b); };
}
function claimQuest(id, btn){
  const q = P.quests.find(q => q.id === id); if (!q || q.got < q.n) return;
  P.coins += q.reward; P.quests = P.quests.filter(o => o !== q);
  coinBurst(q.reward, btn); sfx.win();
  fillQuests(); updateLog(); save(); renderQuestModal();
}
function kmBetween(a, b){
  const R = Math.PI/180, s = Math.sin((b.lat - a.lat)*R/2)**2 + Math.cos(a.lat*R)*Math.cos(b.lat*R)*Math.sin((b.lon - a.lon)*R/2)**2;
  return Math.round(12742*Math.asin(Math.min(1, Math.sqrt(s))));
}
function askTravel(q){
  const sp = q && questSpot(q), back = () => openQuests();
  const info = (html, yes = '확인') => confirmBox(html, yes, back, back);
  if (!sp){ info(`<b>${esc(q ? q.where : '')}</b>의 위치 정보가 없어요.<br><span style="opacity:.7;font-size:12px">지도(M)에서 직접 찾아가 주세요.</span>`); return; }
  if (spotZone(sp) > boatZone()){ info(`🔒 <b>${esc(sp.name)}</b>에 가려면 <b>${zoneBoat(spotZone(sp)).name}</b> 이상이 필요해요.`); return; }
  if (G.state === 'hooked' || G.state === 'fly' || G.state === 'charge'){ info('물고기와 싸우는 중이거나 던지는 중에는 이동할 수 없어요.'); return; }
  const cast = G.state === 'wait';
  confirmBox(`<b>${esc(sp.name)}</b>(으)로 이동할까요?<br><span style="opacity:.7;font-size:12px">약 ${kmBetween(REGION.spot, sp).toLocaleString()}km · ${esc(q.text)}${cast ? '<br>던져 둔 채비는 회수해요' : ''}</span>`,
    '⛵ 이동', () => { if (G.state === 'result') hideCard(); if (G.state === 'wait') retrieve(true); voyage(sp); }, back);
}

/* ---------------- shop ---------------- */
function openShop(){
  if (!idleOnly('상점을 열 수 있어요')) return;
  openModal('shop'); renderShop();
}
function closeShop(){ closeModal(); }
const SHOP_TAB = { t: 'all' };
for (const b of document.querySelectorAll('#shoptabs button')) b.addEventListener('click', e => { e.stopPropagation(); SHOP_TAB.t = b.dataset.t; renderShop(); $('shop').querySelector('.shopbox').scrollTop = 0; });
function renderShop(){
  $('coins2').textContent = P.coins.toLocaleString();
  const up = SHOP.map(s => {
    const cur = s.tiers[P.tier[s.id]], next = s.tiers[P.tier[s.id] + 1];
    return `<div class="card"><div class="ct">${s.icon} ${s.name}</div><div class="cur">현재: <b>${cur.name}</b><br><span>${cur.desc}</span></div>` +
      (next ? `<div class="nx">다음: <b>${next.name}</b><br><span>${next.desc}</span></div><button data-up="${s.id}" ${P.coins < next.cost ? 'disabled' : ''}>${next.cost.toLocaleString()}🪙 업그레이드</button>`
            : `<div class="nx max">최고 등급</div>`) + `</div>`;
  }).join('');
  const itemCards = list => list.filter(it => it.cost).map(it => [it, '']).map(([it, kind]) =>
    `<div class="card"><div class="ct">${it.name}</div><div class="cur"><span>${it.desc}</span></div>` +
    (P.owned[it.id] ? `<div class="nx max">보유 중</div>` : `<button data-buy="${it.id}" ${P.coins < it.cost ? 'disabled' : ''}>${it.cost.toLocaleString()}🪙 구매</button>`) + `</div>`).join('');
  // tabs: all / gear / bait / lures
  const T = SHOP_TAB.t, sec = (k, title, html) => (T === 'all' || T === k) ? `${T === 'all' ? `<h3>${title}</h3>` : ''}<div class="grid">${html}</div>` : '';
  $('shopgrid').innerHTML = sec('gear', '장비 업그레이드', up) + sec('bait', '대낚시 미끼', itemCards(BAITS)) + sec('lure', '루어', itemCards(LURES));
  for (const b of document.querySelectorAll('#shoptabs button')) b.classList.toggle('on', b.dataset.t === T);
  for (const b of $('shopgrid').querySelectorAll('[data-up]')) b.onclick = () => {
    const s = shopItem(b.dataset.up), next = s.tiers[P.tier[s.id] + 1]; if (!next || P.coins < next.cost) return;
    P.coins -= next.cost; P.tier[s.id]++; if (s.id === 'boat') applyBoatModel(); sfx.win(); say(`${s.name} → ${next.name}`, 1.8); save(); renderShop(); updateLog();
  };
  for (const b of $('shopgrid').querySelectorAll('[data-buy]')) b.onclick = () => {
    const it = [...BAITS, ...LURES].find(i => i.id === b.dataset.buy); if (P.coins < it.cost) return;
    P.coins -= it.cost; P.owned[it.id] = true; sfx.win(); say(`${it.name} 구매!`, 1.6); save(); renderShop(); updateLog();
  };
}

/* ---------------- boat driving ---------------- */
function setNav(boat){
  if (G.mapOpen) return;
  if (boat){
    if (G.state !== 'idle'){ say(G.state === 'boat' ? '' : '채비를 회수한 뒤 보트를 운전할 수 있어요 (R)', 1.8); return; }
    G.state = 'boat'; G.orbit = 0; G.navT = G.time; say(TOUCH.on ? '⛵ 보트 운전 — 가운데 조그로 조종' : '⛵ 보트 운전 — W/S 가속, A/D 방향', 1.8);
  } else {
    if (G.state !== 'boat') return;
    // fish off the side of the boat (starboard); the camera glides there from wherever the boat view was
    G.state = 'idle'; G.aimYaw = BOAT.heading + Math.PI/2; G.aimPitch = -0.2; G.orbit = 0; G.navT = G.time;
    say(G.boatV > 1 ? '엔진 정지 — 배가 멈추면 던지세요' : '🎣 낚시 모드', 1.6);
  }
}
function moveBoat(dt){
  const f = boatF(), dir = Math.sign(G.boatV) || 1;
  const nx = BOAT.pos[0] + f[0]*G.boatV*dt, nz = BOAT.pos[2] + f[2]*G.boatV*dt;
  const probe = [nx + f[0]*2.3*dir, nz + f[2]*2.3*dir];
  if (floorDepth(probe[0], probe[1]) < 0.8){
    G.boatV = -G.boatV*0.25; sfx.splash(0.2);
    if (G.time - (G.groundT||-9) > 2){ say('여울이에요! 수심이 너무 얕아요', 1.6, 'bad'); G.groundT = G.time; }
    return;
  }
  if (Math.hypot(nx, nz) > 1500){
    G.boatV *= 0.5;
    if (G.time - (G.edgeT||-9) > 4){ say('이 지역의 끝이에요 — 지도(M)로 다른 곳에 가 보세요', 2.5); G.edgeT = G.time; }
    return;
  }
  BOAT.pos[0] = nx; BOAT.pos[2] = nz;
}
function updateBoat(dt){
  let thr = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  let st = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  if (JOY.active){ if (Math.abs(JOY.y) > 0.15) thr = -JOY.y; if (Math.abs(JOY.x) > 0.12) st = JOY.x; }
  if (thr > 0.05) G.boatV = Math.min(boatMax()*Math.max(thr, 0.35), G.boatV + (G.boatV < 0 ? 4 : 1.8)*thr*dt) || G.boatV;
  else if (thr < -0.05) G.boatV = Math.max(-2.2, G.boatV + (G.boatV > 0 ? 4 : 1.2)*thr*dt);
  else G.boatV *= Math.exp(-dt*0.45);
  G.boatSteer = lerp(G.boatSteer, st, Math.min(1, dt*4));
  const auth = clamp(Math.abs(G.boatV)/2.5, 0.15, 1)*(G.boatV < -0.05 ? -1 : 1);
  BOAT.heading = wrapA(BOAT.heading + G.boatSteer*0.75*auth*dt);
  moveBoat(dt);
  // wake: little splashes off the stern quarters
  G.wakeT = (G.wakeT||0) - dt*Math.abs(G.boatV);
  if (G.wakeT <= 0 && Math.abs(G.boatV) > 0.6){
    G.wakeT = 0.9;
    for (const sd of [-1, 1]){ const p = boatToWorld(sd*0.75, 0, 1.9); Rn.splash(p[0], p[2], 0.14, 0.012 + 0.004*Math.abs(G.boatV)); }
    const b = boatToWorld(0, 0, -2.0); if (G.boatV > 3) Rn.splash(b[0], b[2], 0.1, 0.015);
  }
  G.aimYaw = BOAT.heading;
}
/* ---------------- wake, spray and mist ---------------- */
const TRAIL = [];                                    // recent boat positions for the Kelvin wake: [x, z, strength, time]
function updateWake(){
  const v = Math.abs(G.boatV);
  const last = TRAIL[0];
  if (v > 0.4 && (!last || Math.hypot(BOAT.pos[0] - last[0], BOAT.pos[2] - last[1]) > 2.5)) TRAIL.unshift([BOAT.pos[0], BOAT.pos[2], clamp(v/7, 0, 1), G.time]);
  while (TRAIL.length > 19) TRAIL.pop();
}
function wakeTrack(){
  const out = [[BOAT.pos[0], BOAT.pos[2], clamp(Math.abs(G.boatV)/7, 0, 1), 0]];
  for (const p of TRAIL) out.push([p[0], p[1], p[2]*Math.exp(-(G.time - p[3])/10), 0]);
  return out;
}
const PART = { list: [], data: new Float32Array(700*5), n: 0, acc: 0, mistAcc: 0 };
function emitSpray(p, vel, size, life, alpha, mist){ if (PART.list.length < 700) PART.list.push({ p, v: vel, s: size, life, age: 0, a: alpha, mist }); }
function updateParticles(dt){
  const v = G.boatV, av = Math.abs(v), f = boatF(), r = boatR();
  if (av > 1.0){
    // bow spray: droplets thrown out and up from both sides of the bow
    PART.acc += dt*(av - 0.8)*16;
    while (PART.acc >= 1){ PART.acc -= 1;
      const sd = Math.random() < 0.5 ? -1 : 1, p = boatToWorld(sd*rand(0.35, 0.7), 0.06, v > 0 ? rand(-1.9, -1.2) : rand(1.6, 2.0));
      const out = rand(0.5, 1.2)*(0.6 + av*0.22), upv = rand(0.8, 1.6)*(0.7 + av*0.3);
      emitSpray(p, [r[0]*sd*out + f[0]*v*0.35, upv, r[2]*sd*out + f[2]*v*0.35], rand(0.035, 0.09), rand(0.5, 0.9), rand(0.55, 0.9), false);
    }
    // mist: fine water vapour hanging over the spray and drifting behind the boat
    PART.mistAcc += dt*av*2.2;
    while (PART.mistAcc >= 1){ PART.mistAcc -= 1;
      const sd = Math.random() < 0.5 ? -1 : 1, p = boatToWorld(sd*rand(0.4, 1.1), rand(0.1, 0.35), rand(-1.8, 2.4));
      emitSpray(p, [-f[0]*v*0.25 + rand(-0.2, 0.2), rand(0.1, 0.35), -f[2]*v*0.25 + rand(-0.2, 0.2)], rand(0.4, 0.9), rand(2.0, 3.2), 0.1 + 0.08*clamp(av/8, 0, 1), true);
    }
    // prop wash at the stern
    if (Math.random() < dt*av*6){ const p = boatToWorld(rand(-0.2, 0.2), 0.03, 2.15); emitSpray(p, [rand(-0.4, 0.4) - f[0]*v*0.2, rand(0.4, 1.0), rand(-0.4, 0.4) - f[2]*v*0.2], rand(0.04, 0.08), 0.5, 0.6, false); }
  }
  let n = 0; const D = PART.data;
  for (let i = PART.list.length - 1; i >= 0; i--){
    const q = PART.list[i]; q.age += dt;
    if (q.mist){ const k = Math.exp(-dt*0.9); q.v[0] *= k; q.v[2] *= k; q.v[1] *= Math.exp(-dt*0.5); q.s += dt*0.45; }
    else q.v[1] -= 9.8*dt;
    q.p[0] += q.v[0]*dt; q.p[1] += q.v[1]*dt; q.p[2] += q.v[2]*dt;
    if (q.age >= q.life || (!q.mist && q.p[1] < -0.02)){
      if (!q.mist && q.p[1] < 0 && Math.random() < 0.08) Rn.splash(q.p[0], q.p[2], 0.05, 0.006);
      PART.list.splice(i, 1); continue;
    }
    const lf = q.age/q.life, a = q.mist ? q.a*Math.sin(Math.PI*lf) : q.a*(1 - lf*lf);
    D.set([q.p[0], q.p[1], q.p[2], q.s, a], n*5); n++;
  }
  PART.n = n;
}
function updateEngine(){
  if (!AU.ctx) return;
  if (!AU.eng){
    const c = AU.ctx, o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(AU.amb); o.start(); o2.start();
    AU.eng = { o, o2, g };
  }
  const on = G.state === 'boat', v = Math.abs(G.boatV), t = AU.ctx.currentTime;
  AU.eng.o.frequency.setTargetAtTime(38 + v*9, t, 0.15); AU.eng.o2.frequency.setTargetAtTime(19 + v*4.5, t, 0.15);
  AU.eng.g.gain.setTargetAtTime(on ? 0.018 + v*0.006 : 0, t, 0.3);
}

/* ---------------- sonar (fish finder) ---------------- */
const SONAR = { cols: [], t: 0, W: 176 };
function updateSonar(dt){
  SONAR.t -= dt*(0.4 + Math.abs(G.boatV)*0.6);
  if (SONAR.t > 0) return;
  SONAR.t = 0.12;
  const d = toReal(floorDepth(BOAT.pos[0], BOAT.pos[2]));   // the finder reads real depths
  const echoes = [];
  for (const f of fishes) if (dist2(f.pos, BOAT.pos) < 6 + f.len*4) echoes.push([toReal(-f.pos[1]), f.len, f.sp.name]);
  SONAR.cols.push({ d, echoes });
  if (SONAR.cols.length > SONAR.W) SONAR.cols.shift();
}
function drawSonar(){
  const W = TOUCH.on ? 132 : SONAR.W, H = TOUCH.on ? (hudH < 500 ? 56 : 70) : 96, x0 = TOUCH.on ? hudW - W - 16 : 16;
  // desktop: sits right above the gauge panel (bottom-left); touch: under the quest tracker
  if (TOUCH.on && G.state !== 'boat') return;   // on phones the fish finder only shows while driving the boat
  // phones: top-right under the top line, the boat readout goes under it
  const y0 = TOUCH.on ? $('topline').getBoundingClientRect().bottom + 30 : $('gauges').getBoundingClientRect().top - H - 18;
  SONAR.bottom = y0 + H + 8;
  if (hudW < 520 && !TOUCH.on) return;
  let maxD = 5; for (const c of SONAR.cols) maxD = Math.max(maxD, c.d);
  // the range eases toward the next step instead of snapping (5 → 10 → 20 …)
  const want = [5, 10, 20, 30, 40, 60, 80, 100].find(r => r >= maxD*1.08) || 100;
  SONAR.range = SONAR.range ? SONAR.range + (want - SONAR.range)*Math.min(1, (SONAR.dt || 0.016)*3) : want;
  const range = SONAR.range;
  ctx.save();
  ctx.fillStyle = 'rgba(4,14,22,.82)'; ctx.fillRect(x0 - 6, y0 - 22, W + 12, H + 30);
  const top = y0, sy = H/range;
  const g = ctx.createLinearGradient(0, top, 0, top + H); g.addColorStop(0, '#0b3c6e'); g.addColorStop(1, '#041a33');
  ctx.fillStyle = g; ctx.fillRect(x0, top, W, H);
  const n = Math.min(SONAR.cols.length, W), off = SONAR.cols.length - n;
  for (let i = 0; i < n; i++){
    const c = SONAR.cols[off + i], x = x0 + W - n + i, by = top + c.d*sy;
    ctx.fillStyle = '#ff5a2a'; ctx.fillRect(x, by, 1, 2);
    ctx.fillStyle = '#b8401c'; ctx.fillRect(x, by + 2, 1, 3);
    ctx.fillStyle = '#6b2a14'; ctx.fillRect(x, by + 5, 1, Math.max(0, top + H - by - 5));
    for (const [ed, el] of c.echoes){ ctx.fillStyle = P.tier.sonar ? (el > 1.2 ? '#ff3bd4' : el > 0.5 ? '#ff3b3b' : el > 0.25 ? '#ffd84a' : '#8ff0a8') : '#ffd84a'; ctx.fillRect(x, top + ed*sy - 1, 1, el > 0.5 ? 3 : 2); }
  }
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'right';
  const step = range > 32 ? 20 : range > 16 ? 10 : range > 8 ? 5 : 2;
  for (let r = step; r <= range + 0.01; r += step){ const y = top + r*sy; if (y > top + H + 1) break;
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x0, y, W, 1); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(r + 'm', x0 + W - 2, y - 2); }
  const d = SONAR.cols.length ? SONAR.cols[SONAR.cols.length - 1].d : 0;
  ctx.textAlign = 'left'; ctx.fillStyle = '#9fe8ff'; ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText('어탐기', x0, y0 - 8);
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = '800 14px system-ui, sans-serif';
  ctx.fillText(d.toFixed(1) + 'm', x0 + W, y0 - 7);
  if (P.tier.sonar >= 2 && n){
    const last = SONAR.cols[SONAR.cols.length - 1].echoes;
    if (last.length){ const big = last.reduce((a, b) => b[1] > a[1] ? b : a); ctx.textAlign = 'left'; ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = '#ffd84a';
      ctx.fillText(`${big[2]} ${Math.round(big[1]*100)}cm · ${big[0].toFixed(1)}m`, x0 + 2, top + H - 4); }
  }
  ctx.restore();
}

/* ---------------- regions & world map ---------------- */
function hashf(a){ const x = Math.sin(a*127.1 + 311.7)*43758.5453; return x - Math.floor(x); }
// Horizon from the world map: in 32 directions find how far the nearest land is (sea spots march over the
// coastline data; lakes are ringed by their shore) and turn it into an elevation angle for the terrain's height.
function computeHorizon(spot){
  const hor = new Float32Array(32), horD = new Float32Array(32);
  const lake = BIOMES[spot.biome].water === 'fresh';
  const H = spot.relief ?? (lake ? 200 + 500*hashf(spot.lat*7 + spot.lon) : 350);
  const s1 = hashf(spot.lat)*6.28, s2 = hashf(spot.lon)*6.28, clat = Math.max(0.2, Math.cos(spot.lat*Math.PI/180));
  // a sea spot that falls on land at this map resolution is moved to the nearest open water
  let lat0 = spot.lat, lon0 = spot.lon;
  if (!lake && isLand(lat0, lon0)){
    search: for (const rk of [1, 2, 4, 7, 11, 16, 24]) for (let k = 0; k < 12; k++){
      const b = k/12*TAU, la = spot.lat + Math.cos(b)*rk/111, lo = spot.lon + Math.sin(b)*rk/(111*clat);
      if (!isLand(la, lo)){ lat0 = la; lon0 = lo; break search; }
    }
  }
  for (let i = 0; i < 32; i++){
    const a = -Math.PI + TAU*i/32, east = Math.cos(a), north = -Math.sin(a);
    let dist = -1;
    if (lake){
      const shore = spot.shore ?? (0.8 + 3*hashf(spot.lon*3 + spot.lat));
      dist = shore*(1 + 0.45*Math.sin(a*2 + s1) + 0.25*Math.sin(a*3 + s2));
      if (shore > 10 && Math.sin(a + s1) > 0.3) dist = -1;            // big lakes: open water to the horizon on one side
    } else {
      for (const dk of [0.4, 1, 2, 3, 5, 8, 12, 18, 25, 35, 50, 70, 100, 140]){
        if (isLand(lat0 + north*dk/111, lon0 + east*dk/(111*clat))){ dist = dk; break; }
      }
    }
    if (dist <= 0){ hor[i] = 0; horD[i] = 200; continue; }
    // terrain climbs from the shore and peaks a few km inland; earth curvature hides far land
    const peak = dist + 1.5 + H/400, h = H - peak*peak/(2*6371)*1000;
    hor[i] = h > 0 ? Math.min(0.14, Math.atan2(h, peak*1000)) : 0; horD[i] = dist;
  }
  // directions with no land borrow the nearest land's distance so the haze fades smoothly where the coast ends
  for (let pass = 0; pass < 16; pass++) for (let i = 0; i < 32; i++) if (hor[i] === 0){
    const l = horD[(i + 31) % 32], r = horD[(i + 1) % 32]; horD[i] = Math.min(horD[i], Math.min(l, r) + 1);
  }
  const snow = (H > 1200 && Math.abs(spot.lat) > 38) || (H > 600 && Math.abs(spot.lat) > 58) || H > 3000 ? 1 : 0;
  return { hor, horD, snow };
}
function applyRegion(spot, first){
  const W = WATERS[spot.water];
  const seedA = hashf(spot.lat*3.1 + spot.lon*0.7)*6.28, seedB = hashf(spot.lon*1.7 - spot.lat)*6.28;
  REGION = { spot, biome: spot.biome, water: spot.water,
    depthP: W.depth.slice(), depthQ: [W.scale, seedA, seedB, spot.start || Math.min(3, W.depth[0])] };
  const sunEl = clamp(72 - Math.abs(spot.lat)*0.72, 18, 68), sunAz = (hashf(spot.lon) - 0.5)*40;
  Rn.setEnv(computeHorizon(spot));
  Rn.setEnv({ sigA: W.sigA, sigS: W.sigS, depthP: REGION.depthP, depthQ: REGION.depthQ, bed: W.bed, land: W.land, sunEl, sunAz });
  BOAT.pos = [0, 0, 0]; BOAT.heading = 0; G.boatV = 0; G.aimYaw = Math.PI/2; G.orbit = 0;   // start looking out over the side
  G.rig = null; G.lure = null; G.hooked = null; G.fight = null; G.engaged = null; G.strike = null;
  if (G.state !== 'boat') G.state = 'idle';
  G.depthSet = Math.min(G.depthSet, toVis(spot.start || 2));
  SONAR.cols.length = 0; TRAIL.length = 0; PART.list.length = 0; RAIN.drops.length = 0;
  if (!first) setWeather(pickWeather(), true);
  fishes.length = 0;
  for (let i = 0; i < FISH_N; i++) fishes.push(newFish([0, 0, -6], 3, 20));
  const e = eyeWorld(); cam.pos = e.slice(); cam.look = add(e, [0, -2, -10]);
  $('place').textContent = spot.name;
  buildToolbar(); updateLog();
  if (!first){ say(`📍 ${spot.name} · ${WEATHERS[G.weather].icon} ${WEATHERS[G.weather].name}`, 3); fillQuests(); }
}
// land rings unwrapped across the 180° meridian; rings that circle a pole are closed through it
const LAND = (window.WORLD_LAND || []).map(r => {
  const p = [r[0], r[1]];
  for (let i = 2; i < r.length; i += 2){ let x = r[i]; const px = p[p.length-2]; while (x - px > 180) x -= 360; while (x - px < -180) x += 360; p.push(x, r[i+1]); }
  const span = p[p.length-2] - p[0];
  if (Math.abs(span) > 180){ let sy = 0; for (let i = 1; i < p.length; i += 2) sy += p[i]; const pole = sy > 0 ? 90 : -90; p.push(p[p.length-2], pole, p[0], pole); }
  let a = 1e9, b = 90, c = -1e9, d = -90;
  for (let i = 0; i < p.length; i += 2){ a = Math.min(a, p[i]); c = Math.max(c, p[i]); b = Math.min(b, p[i+1]); d = Math.max(d, p[i+1]); }
  return { p, bb: [a, b, c, d] };
});
function isLand(lat, lon){
  let inside = false;
  for (const R of LAND){
    const bb = R.bb; if (lat < bb[1] || lat > bb[3]) continue;
    for (const L0 of [lon, lon - 360, lon + 360]){
      if (L0 < bb[0] || L0 > bb[2]) continue;
      const r = R.p; let c = false;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2){
        const xi = r[i], yi = r[i+1], xj = r[j], yj = r[j+1];
        if ((yi > lat) !== (yj > lat) && L0 < (xj - xi)*(lat - yi)/(yj - yi) + xi) c = !c;
      }
      if (c){ inside = !inside; break; }
    }
  }
  return inside;
}
function fmtLL(lat, lon){ return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`; }
function classify(lat, lon){
  let best = null, bd = 1e9;
  for (const s of SPOTS){ const d = Math.hypot(s.lat - lat, (s.lon - lon)*Math.cos(lat*Math.PI/180)); if (d < bd){ bd = d; best = s; } }
  if (bd < 1.2) return best;
  const land = isLand(lat, lon), a = Math.abs(lat);
  let biome, water;
  if (!land){
    if (a < 23.5){ biome = 'trop_sea'; water = 'sea_trop'; }
    else if (a < 52){ biome = 'temp_sea'; water = 'sea_temp'; }
    else { biome = 'cold_sea'; water = 'sea_cold'; }
  } else {
    if (a < 23.5){ biome = 'trop_fresh'; water = hashf(lat + lon) < 0.5 ? 'river_brown' : 'lake_green'; }
    else if (a >= 52){ biome = 'cold_fresh'; water = 'cold_lake'; }
    else { biome = lon > 60 ? 'kr_fresh' : 'na_fresh'; water = hashf(lat*2 + lon) < 0.55 ? 'lake_clear' : 'lake_green'; }
  }
  return { id: 'custom', name: `${fmtLL(lat, lon)} ${land ? '호수' : '해역'}`, country: land ? '내륙 호수' : '바다', lat, lon, biome, water, start: land ? 2.6 : 4.5, custom: true };
}

const MAP = { cx: 128, cy: 30, z: 0, drag: null, hover: null, sel: null };
const mapCv = $('mapcv'), mctx = mapCv.getContext('2d');
function openMap(){
  if (!idleOnly('지도를 열 수 있어요')) return;
  openModal('map');
  const r = REGION.spot; MAP.cx = r.lon; MAP.cy = r.lat; MAP.sel = null;
  sizeMap(); MAP.z = Math.max(MAP.minZ*2.2, MAP.z || 0); drawMap(); showSel(null);
}
function closeMap(){ closeModal(); }
function sizeMap(){
  const box = mapCv.parentElement.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
  MAP.w = box.width; MAP.h = box.height; mapCv.width = MAP.w*d; mapCv.height = MAP.h*d; mctx.setTransform(d, 0, 0, d, 0, 0);
  MAP.minZ = Math.max(MAP.h/150, MAP.w/1080);
  MAP.z = clamp(MAP.z || MAP.minZ, MAP.minZ, 60);
}
// the world repeats left/right forever: longitudes are drawn at the copy nearest the view centre
const wrapLon = lon => ((lon + 180)%360 + 360)%360 - 180;
const nearLon = lon => MAP.cx + wrapLon(lon - MAP.cx);
function m2s(lon, lat){ return [MAP.w/2 + (lon - MAP.cx)*MAP.z, MAP.h/2 - (lat - MAP.cy)*MAP.z]; }
function s2m(x, y){ return [MAP.cx + (x - MAP.w/2)/MAP.z, MAP.cy - (y - MAP.h/2)/MAP.z]; }
function clampMap(){
  const hh = MAP.h/2/MAP.z;
  MAP.cx = wrapLon(MAP.cx);
  MAP.cy = clamp(MAP.cy, -62 + hh, 85 - hh); if (hh >= 73) MAP.cy = 11;
}
function drawMap(){
  clampMap();
  const c = mctx, W = MAP.w, H = MAP.h;
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0f3550'); g.addColorStop(0.5, '#0d4a66'); g.addColorStop(1, '#0f3550');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // graticule, tropics and polar circles
  c.lineWidth = 1;
  const [gl0] = s2m(0, 0), [gl1] = s2m(W, 0);
  for (let lon = Math.floor(gl0/30)*30; lon <= gl1; lon += 30){ const [x] = m2s(lon, 0); c.strokeStyle = 'rgba(255,255,255,.06)'; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (const [lat, col] of [[0,'rgba(255,255,255,.14)'],[23.44,'rgba(255,200,90,.22)'],[-23.44,'rgba(255,200,90,.22)'],[66.56,'rgba(160,220,255,.22)'],[-66.56,'rgba(160,220,255,.22)'],[30,'rgba(255,255,255,.05)'],[-30,'rgba(255,255,255,.05)'],[60,'rgba(255,255,255,.05)']]){
    const [, y] = m2s(0, lat); c.strokeStyle = col; c.setLineDash(lat % 30 ? [4, 5] : []); c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  }
  c.setLineDash([]);
  // land
  c.fillStyle = '#5d6b4a'; c.strokeStyle = 'rgba(20,30,20,.55)'; c.lineWidth = 0.7;
  const [l0, t0] = s2m(0, 0), [l1, t1] = s2m(W, H);
  c.beginPath();
  for (const R of LAND){
    const bb = R.bb; if (bb[3] < t1 || bb[1] > t0) continue;
    for (let off = Math.floor((l0 - bb[2])/360)*360; bb[0] + off <= l1; off += 360){
      if (bb[2] + off < l0 || bb[0] + off > l1) continue;
      const r = R.p;
      for (let i = 0; i < r.length; i += 2){ const x = W/2 + (r[i] + off - MAP.cx)*MAP.z, y = H/2 - (r[i+1] - MAP.cy)*MAP.z; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.closePath();
    }
  }
  c.fill('evenodd'); c.stroke();
  // spots
  c.font = '600 12px system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'; c.textAlign = 'left';
  for (const s of SPOTS){
    const salt = BIOMES[s.biome].water === 'salt', locked = spotZone(s) > boatZone() && s !== REGION.spot;
    for (let lon = nearLon(s.lon) - 720; lon <= nearLon(s.lon) + 720; lon += 360){
      const [x, y] = m2s(lon, s.lat); if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      c.fillStyle = locked ? '#5b6770' : salt ? '#4fd1ff' : '#8ff0a8'; c.strokeStyle = '#08202a'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill(); c.stroke();
      const lbl = (locked ? '🔒' : '') + s.name;
      if (MAP.z > MAP.minZ*1.6 || s === MAP.sel){ c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText(lbl, x + 8, y + 4); c.fillStyle = locked ? '#b8c2c8' : '#fff'; c.fillText(lbl, x + 8, y + 4); }
    }
  }
  // current location
  { const r = REGION.spot, [x, y] = m2s(nearLon(r.lon), r.lat); c.strokeStyle = '#ffd84a'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 10, 0, TAU); c.stroke();
    c.fillStyle = '#ffd84a'; c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x - 5, y - 20); c.lineTo(x + 5, y - 20); c.fill(); }
  // voyage: a line grows from here to the destination with the boat riding its tip
  if (MAP.anim){
    const A = MAP.anim, e = voyageE();
    const a = m2s(nearLon(A.from.lon), A.from.lat), bl = nearLon(A.from.lon) + wrapLon(A.to.lon - A.from.lon), b = m2s(bl, A.to.lat);
    const p = [a[0] + (b[0] - a[0])*e, a[1] + (b[1] - a[1])*e];
    c.setLineDash([6, 6]); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    c.setLineDash([]); c.strokeStyle = '#ffd84a'; c.lineWidth = 3.5; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(p[0], p[1]); c.stroke();
    c.fillStyle = '#ff6a4a'; c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(b[0], b[1], 7, 0, TAU); c.fill(); c.stroke();
    c.font = '22px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; c.textAlign = 'center'; c.fillText('⛵', p[0], p[1] - 6); c.textAlign = 'left';
    c.font = '700 13px system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.6)';
    const t = `${A.to.name} · ${Math.round(A.km*e).toLocaleString()} / ${A.km.toLocaleString()}km`; c.strokeText(t, b[0] + 12, b[1] + 5); c.fillStyle = '#fff'; c.fillText(t, b[0] + 12, b[1] + 5);
  }
  // selection / hover
  if (MAP.sel && !MAP.anim){ const [x, y] = m2s(nearLon(MAP.sel.lon), MAP.sel.lat); c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 12, y); c.lineTo(x + 12, y); c.moveTo(x, y - 12); c.lineTo(x, y + 12); c.stroke(); c.beginPath(); c.arc(x, y, 7, 0, TAU); c.stroke(); }
  if (MAP.hover && !MAP.anim){ const hl = wrapLon(MAP.hover[0]); $('mapinfo').textContent = fmtLL(MAP.hover[1], hl) + (isLand(MAP.hover[1], hl) ? ' · 육지(호수·강)' : ' · 바다'); }
}
/* ---------------- navigation zones: the boat decides how far from land you may go ---------------- */
const ZONES = ['내륙', '연안', '근해', '원양'];
function seaDistKm(lat, lon){   // distance to the nearest land (km), ~coarse ray search over the coastline data
  if (isLand(lat, lon)) return 0;
  const clat = Math.max(0.2, Math.cos(lat*Math.PI/180)); let best = 400;
  for (let k = 0; k < 16; k++){
    const b = k/16*TAU, n = Math.cos(b), e = Math.sin(b);
    for (const d of [1, 2, 4, 7, 12, 20, 30, 45, 65, 100, 150, 220, 320]){
      if (d >= best) break;
      if (isLand(lat + n*d/111, lon + e*d/(111*clat))){ best = d; break; }
    }
  }
  return best;
}
function spotZone(sp){
  if (sp.zone !== undefined) return sp.zone;
  if (BIOMES[sp.biome].water === 'fresh') sp.zone = 0;
  else { const d = seaDistKm(sp.lat, sp.lon); sp.distKm = d; sp.zone = d <= 20 ? 1 : d <= 100 ? 2 : 3; }
  return sp.zone;
}
function boatZone(){ return tierOf('boat').zone; }
function zoneBoat(z){ return shopItem('boat').tiers.find(t => t.zone >= z); }
function showSel(sp){
  MAP.sel = sp;
  const P = $('mappanel');
  if (!sp){ P.innerHTML = `<p class="hint">지도에서 원하는 곳을 클릭하세요. 표시된 명소나 아무 바다·육지(호수)나 고를 수 있어요.<br><b>휠</b> 확대 · <b>드래그</b> 이동</p>
    <p class="hint">🚤 지금 보트: <b>${tierOf('boat').name}</b> — ${ZONES.slice(0, boatZone() + 1).join('·')}까지 갈 수 있어요.${boatZone() < 3 ? ' 더 먼 바다는 상점에서 보트를 업그레이드하세요.' : ''}</p>`; return; }
  const W = WATERS[sp.water], B = BIOMES[sp.biome];
  const fish = B.fish.map(([id]) => BY_ID[id].name).join(', ');
  const here = sp === REGION.spot || (sp.lat === REGION.spot.lat && sp.lon === REGION.spot.lon);
  const z = spotZone(sp), locked = !here && z > boatZone();
  const zoneTxt = z === 0 ? '내륙 수역' : `${ZONES[z]} · 해안에서 약 ${sp.distKm >= 400 ? '400km+' : sp.distKm + 'km'}`;
  if (locked){   // somewhere the boat cannot reach: just the name and why
    P.innerHTML = `<div class="st"><b>${sp.name}</b><span>${sp.country}</span></div>
      <div class="need">🔒 ${ZONES[z]} 지역이에요 — <b>${zoneBoat(z).name}</b> 이상이 필요해요<br><span>지금 보트: ${tierOf('boat').name} (${ZONES[boatZone()]}까지) · 상점 → 보트에서 업그레이드</span></div>`;
    return;
  }
  P.innerHTML = `<div class="st"><b>${sp.name}</b><span>${sp.country} · ${fmtLL(sp.lat, sp.lon)}</span></div>
    <div class="tags"><span>${B.name}</span><span>${W.name}</span><span>수심 ${W.depth[2]}–${W.depth[3]}m</span><span class="zone${locked ? ' lock' : ''}">${zoneTxt}</span></div>
    <div class="fish">${fish}</div>
    ${locked ? `<div class="need">🔒 <b>${zoneBoat(z).name}</b> 이상이 필요해요<br><span>상점(P) → 보트에서 업그레이드 · 지금 보트: ${tierOf('boat').name} (${ZONES[boatZone()]}까지)</span></div>` : ''}
    <button id="go" class="on" ${locked ? 'disabled' : ''}>${here ? '현재 위치' : locked ? '🔒 갈 수 없음' : '⛵ 이곳으로 출발'}</button>`;
  $('go').onclick = e => { e.stopPropagation(); if (locked) return; if (!here) voyage(sp); else closeMap(); };
}
function travel(sp){
  if (spotZone(sp) > boatZone()){ say(`🔒 ${zoneBoat(spotZone(sp)).name}가 필요해요`, 2); return; }
  MAP.anim = null; closeModal();
  const f = $('fade'); f.classList.add('on');
  setTimeout(() => { applyRegion(sp); setTimeout(() => f.classList.remove('on'), 150); }, 650);
}
// quest travel: show the route on the map, sail it, then arrive
function voyageE(){ const A = MAP.anim, k = clamp((performance.now() - A.t0)/A.T, 0, 1); return k < 0.5 ? 2*k*k : 1 - (-2*k + 2)**2/2; }
function voyage(sp){
  openModal('map'); sizeMap();
  const from = REGION.spot, dl = wrapLon(sp.lon - from.lon);
  MAP.cx = from.lon; MAP.cy = from.lat;
  // the map camera rides with the boat, zoomed so the route is a couple of screens long (short hops: a regional view)
  MAP.z = clamp(Math.min(MAP.w/(Math.abs(dl)*0.6 + 10), MAP.h/(Math.abs(sp.lat - from.lat)*0.6 + 7)), MAP.minZ*1.5, 30);
  MAP.sel = null; $('mapinfo').textContent = `⛵ ${from.name} → ${sp.name}`;
  $('mappanel').innerHTML = `<div class="st"><b>${esc(sp.name)}</b><span>${esc(sp.country || '')} · ${fmtLL(sp.lat, sp.lon)}</span></div><p class="hint">⛵ ${esc(from.name)}에서 출발해 항해 중…</p>`;
  const km = kmBetween(from, sp);
  MAP.anim = { from, to: sp, km, t0: performance.now(), T: clamp(1400 + km*0.12, 1600, 3200) };
  const tick = () => {
    if (!MAP.anim) return;
    const e = voyageE(); MAP.cx = from.lon + dl*e; MAP.cy = from.lat + (sp.lat - from.lat)*e;
    drawMap();
    if (performance.now() - MAP.anim.t0 < MAP.anim.T + 350) requestAnimationFrame(tick); else travel(sp);
  };
  requestAnimationFrame(tick);
}
// map input: one finger/mouse drags, two fingers pinch to zoom around their midpoint; a tap selects
const MPTR = new Map();
function pinchState(){ const [a, b] = [...MPTR.values()], r = mapCv.getBoundingClientRect(); return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x)/2 - r.left, my: (a.y + b.y)/2 - r.top }; }
mapCv.addEventListener('pointerdown', e => {
  if (MAP.anim) return; mapCv.setPointerCapture(e.pointerId); MPTR.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (MPTR.size === 2){ const P = pinchState(); MAP.pinch = { d0: P.d, z0: MAP.z, anchor: s2m(P.mx, P.my) }; if (MAP.drag) MAP.drag.moved = true; }
  else if (MPTR.size === 1) MAP.drag = { x: e.clientX, y: e.clientY, cx: MAP.cx, cy: MAP.cy, moved: false };
});
mapCv.addEventListener('pointermove', e => {
  const b = mapCv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  if (MPTR.has(e.pointerId)) MPTR.set(e.pointerId, { x: e.clientX, y: e.clientY });
  MAP.hover = s2m(x, y);
  if (MAP.pinch && MPTR.size >= 2){
    const P = pinchState(), [lon, lat] = MAP.pinch.anchor;
    MAP.z = clamp(MAP.pinch.z0*P.d/Math.max(10, MAP.pinch.d0), MAP.minZ, 60);
    MAP.cx = lon - (P.mx - MAP.w/2)/MAP.z; MAP.cy = lat + (P.my - MAP.h/2)/MAP.z;   // keep the pinched spot under the fingers
  } else if (MAP.drag){ const dx = e.clientX - MAP.drag.x, dy = e.clientY - MAP.drag.y; if (Math.hypot(dx, dy) > 4) MAP.drag.moved = true;
    if (MAP.drag.moved){ MAP.cx = MAP.drag.cx - dx/MAP.z; MAP.cy = MAP.drag.cy + dy/MAP.z; } }
  drawMap();
});
const mapUp = e => {
  MPTR.delete(e.pointerId);
  if (MAP.pinch){ if (MPTR.size < 2){ MAP.pinch = null; MAP.drag = null;
    if (MPTR.size === 1){ const [q] = [...MPTR.values()]; MAP.drag = { x: q.x, y: q.y, cx: MAP.cx, cy: MAP.cy, moved: true }; } } return; }
  if (e.type === 'pointercancel'){ MAP.drag = null; return; }
  const d = MAP.drag; MAP.drag = null; if (!d || d.moved || MAP.anim) return;
  const b = mapCv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  // snap to a spot marker if clicked near one
  let hit = null; for (const s of SPOTS){ const [sx, sy] = m2s(nearLon(s.lon), s.lat); if (Math.hypot(sx - x, sy - y) < 10) hit = s; }
  const [lon, lat] = s2m(x, y);
  showSel(hit || classify(clamp(lat, -60, 84), wrapLon(lon))); drawMap();
};
mapCv.addEventListener('pointerup', mapUp); mapCv.addEventListener('pointercancel', mapUp);
mapCv.addEventListener('wheel', e => {
  e.preventDefault(); if (MAP.anim) return;
  const b = mapCv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  const [lon, lat] = s2m(x, y);
  MAP.z = clamp(MAP.z*(e.deltaY < 0 ? 1.25 : 0.8), MAP.minZ, 60);
  MAP.cx = lon - (x - MAP.w/2)/MAP.z; MAP.cy = lat + (y - MAP.h/2)/MAP.z;
  drawMap();
}, { passive: false });
$('mapclose').addEventListener('click', closeMap);
for (const [id, k] of [['mapin', 1.5], ['mapout', 1/1.5]]) $(id).addEventListener('click', () => { MAP.z = clamp(MAP.z*k, MAP.minZ, 60); drawMap(); });
$('map').addEventListener('pointerdown', e => { if (e.target === $('map')) closeModal(); });
addEventListener('resize', () => { if (!$('map').hidden){ sizeMap(); drawMap(); } });
// the map area can change size without a window resize (info panel content, rotation): keep the canvas matched,
// otherwise taps land off from where the map is drawn
if (window.ResizeObserver) new ResizeObserver(() => { if (!$('map').hidden){ sizeMap(); drawMap(); } }).observe(mapCv.parentElement);

/* ---------------- ranking (shared across players via the artifact db; local-only elsewhere) ---------------- */
const RANK = { db: null, user: null, me: null, docs: {}, tab: 'len', sp: null, live: false, t: 0, lastPush: '' };
(async () => {
  try {
    if (!window.claude || !window.claude.use) return;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    RANK.db = db; RANK.user = user;
    if (user) RANK.me = await user.id();
    if (!db) return;
    db.collection('ranks').onSnapshot(snap => {
      RANK.docs = {}; for (const d of snap.docs) RANK.docs[d.id] = d.data();
      RANK.live = true; if (!$('rankm').hidden) renderRank();
    }, err => { RANK.live = false; RANK.err = err && err.code; });
    pushRankSoon();
  } catch(e){}
})();
function myRankDoc(){
  const best = {};
  for (const k in G.best){ const b = G.best[k]; best[k] = { len: Math.round(b.len*1000)/10, kg: Math.round(b.weight*100)/100 }; }
  let dayBest = { n: 0, day: '' }; for (const [d, n] of Object.entries(P.daily)) if (n > dayBest.n) dayBest = { n, day: d };
  const t = dayKey();
  return { best, dayBest, today: { day: t, n: P.daily[t] || 0 }, total: Object.values(P.caught).reduce((a, b) => a + b, 0) };
}
function pushRankSoon(){ clearTimeout(RANK.t); RANK.t = setTimeout(pushRank, 1500); }
async function pushRank(){
  if (!RANK.db || !RANK.me) return;
  const d = myRankDoc(), j = JSON.stringify(d); if (j === RANK.lastPush) return;
  try { await RANK.db.doc('ranks/' + RANK.me).set({ ...d, updated: Date.now() }); RANK.lastPush = j; } catch(e){ RANK.err = e && e.code; }
}
function rankRows(){
  // everyone's docs (or only mine when there is no shared store)
  const docs = { ...RANK.docs }; docs[RANK.me || 'me'] = myRankDoc();
  const rows = [];
  for (const [id, d] of Object.entries(docs)){
    if (RANK.tab === 'day'){ if (d.dayBest && d.dayBest.n) rows.push({ id, v: d.dayBest.n, sub: fmtDay(d.dayBest.day), extra: `총 ${d.total || 0}마리` }); }
    else { const b = d.best && d.best[RANK.sp]; if (b) rows.push({ id, v: RANK.tab === 'len' ? b.len : b.kg, sub: RANK.tab === 'len' ? kg(b.kg) : b.len.toFixed(1) + 'cm' }); }
  }
  return rows.sort((a, b) => b.v - a.v).slice(0, 50);
}
function fmtDay(k){ return k ? `${+k.slice(4, 6)}월 ${+k.slice(6)}일` : ''; }
function openRank(){
  openModal('rankm');
  if (!RANK.sp){ const mine = Object.keys(G.best); RANK.sp = G.catches[0] ? G.catches[0].sp.id : mine[0] || SPECIES.find(s => !s.sight).id; }
  const counts = {}; for (const d of Object.values(RANK.docs)) for (const k in (d.best || {})) counts[k] = (counts[k] || 0) + 1;
  for (const k in G.best) counts[k] = Math.max(counts[k] || 0, 1);
  const opts = SPECIES.filter(s => !s.sight).sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.name.localeCompare(b.name, 'ko'));
  $('rsp').innerHTML = opts.map(s => `<option value="${s.id}"${s.id === RANK.sp ? ' selected' : ''}>${esc(s.name)}${counts[s.id] ? ` (${counts[s.id]})` : ''}</option>`).join('');
  renderRank();
}
async function renderRank(){
  for (const b of document.querySelectorAll('#rankm .rtabs [data-t]')) b.classList.toggle('on', b.dataset.t === RANK.tab);
  $('rsp').hidden = RANK.tab === 'day';
  const n = Object.keys(RANK.docs).length;
  $('rsub').textContent = RANK.live ? `참가자 ${Math.max(1, n)}명 · 실시간` : '내 기록만 표시 중 (공유 랭킹은 claude.ai에서 열었을 때)';
  const rows = rankRows(), el = $('rlist');
  if (!rows.length){ el.innerHTML = `<div class="empty">${RANK.tab === 'day' ? '아직 기록이 없어요. 물고기를 잡아 보세요!' : `아직 ${esc(BY_ID[RANK.sp].name)} 기록이 없어요.`}</div>`; return; }
  const ids = rows.map(r => r.id).filter(id => id !== 'me');
  const ps = RANK.user && ids.length ? await RANK.user.profiles(ids) : {};
  const head = RANK.tab === 'day' ? ['하루 최다', '날짜', '누적'] : RANK.tab === 'len' ? ['크기', '무게', ''] : ['무게', '크기', ''];
  el.innerHTML = `<table><thead><tr><th>#</th><th>낚시꾼</th><th>${head[0]}</th><th>${head[1]}</th><th>${head[2]}</th></tr></thead><tbody></tbody></table>`;
  const tb = el.querySelector('tbody');
  rows.forEach((r, i) => {
    const me = r.id === RANK.me || r.id === 'me', tr = document.createElement('tr'); if (me) tr.className = 'me';
    const name = me ? '나' : (ps[r.id] && ps[r.id].name) || '익명 낚시꾼';
    const v = RANK.tab === 'day' ? r.v + '마리' : RANK.tab === 'len' ? r.v.toFixed(1) + 'cm' : kg(r.v);
    for (const [cls, txt] of [['rk', i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1], ['', name], ['', v], ['', r.sub], ['', r.extra || '']]){ const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = txt; tr.appendChild(td); }
    tb.appendChild(tr);
  });
}
for (const b of document.querySelectorAll('#rankm .rtabs [data-t]')) b.addEventListener('click', e => { e.stopPropagation(); RANK.tab = b.dataset.t; renderRank(); });
$('rsp').addEventListener('change', () => { RANK.sp = $('rsp').value; renderRank(); });

/* ---------------- fish guide (도감): names shown, photos hidden until caught ---------------- */
function openDex(){ openModal('dexm'); renderDex(); }
function renderDex(){
  const photos = window.FISH_PHOTOS || {};
  let got = 0;
  const cards = SPECIES.map(sp => {
    const n = P.caught[sp.id] || (G.best[sp.id] ? 1 : 0), seen = P.sightings[sp.id] || 0;
    const open = n > 0 || (sp.sight && seen > 0); if (open) got++;
    const b = G.best[sp.id], ph = photos[sp.id];
    const salt = Object.values(BIOMES).some(B => B.water === 'salt' && (B.fish.some(f => f[0] === sp.id) || (B.visitors || []).some(v => v[0] === sp.id)));
    const info = sp.sight ? (seen ? `관찰 ${seen}회` : '관찰 대상 · 아직 못 봤어요')
      : n ? `최대 ${(b ? b.len*100 : 0).toFixed(1)}cm · ${b ? kg(b.weight) : '-'}<br>잡은 수 ${n}마리${seen ? ` · 목격 ${seen}` : ''}` : `아직 못 잡았어요${seen ? ` · 목격 ${seen}` : ''}`;
    return `<div class="dx${open ? '' : ' locked'}" data-sp="${sp.id}"><div class="ph">${ph ? `<img loading="lazy" src="${ph.file}" alt="">` : `<span style="font-size:34px">${open ? sp.icon || '🐟' : ''}</span>`}${open ? '' : '<b class="qm">?</b>'}</div>
      <div class="nm">${esc(sp.name)}<span class="tag${salt ? '' : ' fresh'}">${salt ? '바다' : '민물'}</span>${sp.sight ? '<span class="tag">관찰</span>' : ''}</div><div class="dd">${info}</div></div>`;
  });
  $('dexgrid').innerHTML = cards.join('');
  $('dcount').textContent = `(${got}/${SPECIES.length})`; $('dsub').textContent = '';
  $('dexgrid').hidden = false; $('dexdet').hidden = true; $('dexback').hidden = true;
  for (const c of $('dexgrid').querySelectorAll('[data-sp]')) c.onclick = e => { e.stopPropagation(); showDexEntry(c.dataset.sp); };
}
// one species in detail: photo and records once caught, plus where it lives and how to catch it
function showDexEntry(id){
  const sp = BY_ID[id], ph = (window.FISH_PHOTOS || {})[id];
  const n = P.caught[id] || (G.best[id] ? 1 : 0), seen = P.sightings[id] || 0, open = n > 0 || (sp.sight && seen > 0), b = G.best[id];
  const biomes = Object.entries(BIOMES).filter(([, B]) => B.fish.some(f => f[0] === id) || (B.visitors || []).some(v => v[0] === id));
  const salt = biomes.some(([, B]) => B.water === 'salt');
  const spots = SPOTS.filter(s => biomes.some(([k]) => k === s.biome)).map(s => s.name);
  const items = [...BAITS, ...LURES];
  const prefs = Object.entries(sp.pref || {}).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => { const it = items.find(i => i.id === k); return it ? `<span class="pf">${esc(it.name)} <em>${'★'.repeat(Math.max(1, Math.round(v*5)))}</em></span>` : ''; }).join('');
  const act = sp.act ? ['dawn', 'day', 'dusk', 'night'].map(k => `<div class="ab"><i style="height:${Math.round((sp.act[k] || 0)*100)}%"></i><span>${PERIOD_NAME[k]}</span></div>`).join('') : '';
  const zone = { bottom: '바닥층', mid: '중층', top: '수면층' }[sp.zone] || '';
  const ret = { slow: '느리게 (감다 멈추기)', medium: '보통', fast: '빠르게 계속' }[sp.retrieve] || '';
  const rec = sp.sight ? (seen ? `관찰 <b>${seen}</b>회` : '아직 못 봤어요')
    : n ? `최대 <b>${(b.len*100).toFixed(1)}cm</b> · <b>${kg(b.weight)}</b> · 잡은 수 <b>${n}</b>마리${seen ? ` · 목격 ${seen}` : ''}` : '아직 못 잡았어요';
  $('dexgrid').hidden = true; const d = $('dexdet'); d.hidden = false;
  $('dexback').hidden = false;
  d.innerHTML = `<div class="dtop"><div class="dph${open ? '' : ' locked'}">${ph ? `<img src="${ph.file}" alt="">` : `<span>${sp.icon || '🐟'}</span>`}${open ? '' : '<b class="qm">?</b>'}</div>
      <div class="dhead"><h3>${esc(sp.name)}</h3><div class="latin">${esc(sp.latin || '')}</div>
        <div class="tags"><span class="tag${salt ? '' : ' fresh'}">${salt ? '바다' : '민물'}</span>${sp.sight ? '<span class="tag">관찰</span>' : ''}${zone ? `<span class="tag">${zone}</span>` : ''}</div>
        <div class="drec">${rec}</div>
        ${open && ph ? `<div class="dcred">📷 ${esc(ph.author)} · ${esc(ph.license.toUpperCase())} · iNaturalist</div>` : ''}</div></div>
    <div class="dgrid">
      ${sp.sight ? '' : `<div><h4>크기</h4><p>${Math.round(sp.minLen*100)}–${Math.round(sp.maxLen*100)}cm</p></div>`}
      ${sp.dmin != null ? `<div><h4>서식 수심</h4><p>${sp.dmin}–${sp.dmax}m${zone ? ' · ' + zone : ''}</p></div>` : ''}
      ${act ? `<div><h4>활동 시간</h4><div class="abars">${act}</div></div>` : ''}
      ${prefs ? `<div class="wide"><h4>좋아하는 미끼·루어</h4><div class="pfs">${prefs}</div></div>` : ''}
      ${ret && !sp.sight ? `<div><h4>루어 감기 속도</h4><p>${ret}</p></div>` : ''}
      <div class="wide"><h4>사는 곳</h4><p>${biomes.map(([, B]) => esc(B.name)).join(' · ') || '-'}${spots.length ? `<br><small>명소: ${spots.map(esc).join(', ')}</small>` : ''}</p></div>
      ${sp.tip ? `<div class="wide"><h4>💡 공략</h4><p>${esc(sp.tip)}</p></div>` : ''}
    </div>`;
  $('dexback').onclick = e => { e.stopPropagation(); d.hidden = true; $('dexgrid').hidden = false; $('dexback').hidden = true; };
  $('dexm').querySelector('.mbox').scrollTop = 0;
}


/* ---------------- settings window: graphics · sound · controls ---------------- */
const SET = { tab: 'gfx' };
function openSettings(){ openModal('setm'); renderSettings(); }
function setRow(label, ctl, note){ return `<div class="srow2"><div><b>${label}</b>${note ? `<small>${note}</small>` : ''}</div><div class="sctl">${ctl}</div></div>`; }
function segCtl(key, opts){ return `<div class="seg sseg">${opts.map(([v, t]) => `<button data-k="${key}" data-v='${JSON.stringify(v)}' class="${JSON.stringify(CFG[key]) === JSON.stringify(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`; }
function rangeCtl(key, min, max, step, fmt){ const v = CFG[key]; return `<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="sval" data-for="${key}">${fmt(v)}</span>`; }
function toggleCtl(key){ return `<button class="tog${CFG[key] ? ' on' : ''}" data-t="${key}">${CFG[key] ? '켜짐' : '꺼짐'}</button>`; }
const FMT = { pct: v => Math.round(v*100) + '%', x: v => '×' + (+v).toFixed(2), res: v => v == null ? '자동' : Math.round(v*100) + '%' };
function renderSettings(){
  for (const b of document.querySelectorAll('#setm .stabs button')) b.classList.toggle('on', b.dataset.st === SET.tab);
  const info = Rn.gfxInfo(), el = $('setbody');
  if (SET.tab === 'gfx'){
    const needReload = JSON.stringify([CFG.gfx, CFG.glare]) !== SET.bootGfx;
    el.innerHTML =
      setRow('그래픽 품질', segCtl('gfx', [['auto', '자동'], ['low', '낮음'], ['mid', '보통'], ['high', '높음']]), '낮음: 가벼운 물빛·빛 번짐 없음 · 보통: 빛 번짐 없음 · 높음: 전부 켬') +
      setRow('빛 번짐(글레어)', toggleCtl('glare'), '해 반사가 번지는 효과 (보통·낮음에서는 항상 꺼짐)') +
      setRow('해상도', `<button class="tog${CFG.res == null ? ' on' : ''}" data-res="auto">자동</button>` + rangeCtl('res', 0.4, 1, 0.05, FMT.res).replace(`value="null"`, `value="${Rn.quality.toFixed(2)}"`), '자동: 속도에 맞춰 조절 · 낮출수록 가볍고 흐려져요') +
      setRow('프레임 제한', segCtl('fps', [[null, '자동'], [30, '30'], [60, '60'], [0, '제한 없음']]), '30으로 두면 발열과 배터리 소모가 크게 줄어요') +
      setRow('FPS 표시', toggleCtl('showFps')) +
      setRow('하단 팁 표시', toggleCtl('tips'), '화면 아래 조작 설명') +
      `<div class="snote">지금: ${info.lite ? '가벼운 모드' : '일반 모드'} · 글레어 ${info.glare ? '켬' : '끔'} · ${info.w}×${info.h} · ${info.fps ? info.fps + 'fps 제한' : '제한 없음'}</div>` +
      (needReload ? `<div class="snote warn">그래픽 품질·글레어는 새로고침 후 적용돼요 <button id="sreload">지금 새로고침</button></div>` : '');
  } else if (SET.tab === 'snd'){
    el.innerHTML =
      setRow('전체 볼륨', rangeCtl('vol', 0, 1, 0.05, FMT.pct)) +
      setRow('효과음', rangeCtl('sfx', 0, 1, 0.05, FMT.pct), '캐스팅·물소리·릴·챔질') +
      setRow('환경음', rangeCtl('amb', 0, 1, 0.05, FMT.pct), '빗소리·엔진') +
      setRow('음소거', toggleCtl('mute')) +
      `<div class="snote"><button id="stest">🔊 테스트 소리</button></div>`;
  } else {
    const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
    el.innerHTML =
      `<h4>화면 조작 (터치)</h4>` +
      setRow('조그 크기', segCtl('joy', [['s', '작게'], ['m', '보통'], ['l', '크게']])) +
      setRow('왼손 모드', toggleCtl('lefty'), '메뉴·보트 버튼 좌우와 +/− 위치를 바꿔요') +
      setRow('휴대폰 진동', toggleCtl('vibe'), '입질·챔질·파이팅 때 진동 (안드로이드 · 아이폰 Safari는 지원 안 함)') +
      `<h4>시점</h4>` +
      setRow('카메라 흔들림', rangeCtl('shake', 0, 1, 0.05, FMT.pct), '챔질·파이팅 때 화면 흔들림 · 0%면 끔') +
      setRow('시점 회전 속도', rangeCtl('look', 0.4, 2, 0.05, FMT.x), '마우스 드래그 · 조그 · 패드 오른쪽 스틱') +
      setRow('상하 반전', toggleCtl('invY')) +
      `<h4>게임패드</h4>` +
      setRow('게임패드 사용', toggleCtl('pad'), pads.length ? '연결됨: ' + esc(pads[0].id.slice(0, 40)) : '연결된 패드 없음 — 버튼을 한 번 누르면 인식돼요') +
      setRow('스틱 감도', rangeCtl('padSens', 0.5, 2, 0.05, FMT.x)) +
      setRow('데드존', rangeCtl('dead', 0.05, 0.4, 0.01, FMT.pct), '스틱이 살짝 기울어도 움직이지 않는 범위') +
      setRow('패드 진동', toggleCtl('rumble'), '입질·챔질·파이팅 때 패드 진동') +
      `<div class="snote">A 던지기·챔질·감기 · B 회수 · X 대낚시/루어 · Y 보트 · LB/RB 드랙·찌 수심 · 왼쪽 스틱 방향/파이팅 · 오른쪽 스틱 시점 · Start 메뉴 · Back 지도</div>`;
  }
  // wire controls
  for (const b of el.querySelectorAll('[data-k][data-v]')) b.onclick = e => { e.stopPropagation(); setCfg(b.dataset.k, JSON.parse(b.dataset.v)); };
  for (const b of el.querySelectorAll('[data-t]')) b.onclick = e => { e.stopPropagation(); setCfg(b.dataset.t, !CFG[b.dataset.t]); };
  for (const r of el.querySelectorAll('input[type=range]')) r.oninput = () => { setCfg(r.dataset.k, +r.value, true); const sv = el.querySelector(`[data-for="${r.dataset.k}"]`); if (sv) sv.textContent = (r.dataset.k === 'res' ? FMT.res : r.dataset.k === 'look' || r.dataset.k === 'padSens' ? FMT.x : FMT.pct)(+r.value); };
  const ra = el.querySelector('[data-res]'); if (ra) ra.onclick = e => { e.stopPropagation(); setCfg('res', null); };
  const rl = $('sreload'); if (rl) rl.onclick = () => location.reload();
  const st = $('stest'); if (st) st.onclick = e => { e.stopPropagation(); audioInit(); sfx.splash(0.6); setTimeout(() => sfx.plop(), 350); };
}
function setCfg(k, v, quiet){
  CFG[k] = v; saveCfg(); applyCfg();
  if (!quiet) renderSettings();
}
function applyCfg(){
  applyVolume();
  if (Rn.setFps) Rn.setFps(CFG.fps != null ? CFG.fps : (Rn.gfxInfo().lite ? 30 : 0));
  if (Rn.setRes && JSON.stringify(CFG.res) !== SET.lastRes){ SET.lastRes = JSON.stringify(CFG.res); Rn.setRes(CFG.res); }
  if (Rn.setDebug) Rn.setDebug(CFG.showFps || new URLSearchParams(location.search).has('debug'));
  document.body.classList.toggle('lefty', !!CFG.lefty);
  document.body.classList.toggle('notips', !CFG.tips);
  document.body.dataset.joy = CFG.joy;
}
for (const b of document.querySelectorAll('#setm .stabs button')) b.addEventListener('click', e => { e.stopPropagation(); SET.tab = b.dataset.st; renderSettings(); });
SET.bootGfx = JSON.stringify([CFG.gfx, CFG.glare]); SET.lastRes = JSON.stringify(CFG.res);
applyCfg();

/* ---------------- gamepad (standard mapping) ---------------- */
const PAD = { prev: [], rumT: 0, repT: 0, fighting: false };
// haptics: gamepad rumble and, on phones, the vibration motor (Android browsers; iPhone Safari has no vibration API)
function padRumble(strong, weak, ms, phoneMs){
  if (CFG.pad && CFG.rumble && navigator.getGamepads){
    const gp = [...navigator.getGamepads()].find(Boolean); const a = gp && gp.vibrationActuator;
    if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
  if (TOUCH.on && CFG.vibe && navigator.vibrate){ try { navigator.vibrate(phoneMs ?? Math.round(ms*(0.25 + 0.75*Math.max(strong, weak)))); } catch(e){} }
}
// fighting: an unbroken buzz — gentle by default, strong while the fish surges or the line is heavily loaded.
// Phones cannot set vibration strength, so gentle = short ticks, strong = nearly continuous.
function fightHaptics(dt){
  if (G.state !== 'hooked' || !G.fight){
    if (PAD.fighting){ PAD.fighting = false; PAD.rumT = 0; if (TOUCH.on && navigator.vibrate) try { navigator.vibrate(0); } catch(e){} }
    return;
  }
  PAD.fighting = true;
  PAD.rumT -= dt; if (PAD.rumT > 0) return;
  const f = G.hooked, t = G.fight.tension, hard = (f.run && f.run.burst && f.stamina > 0.15) || t > 0.72;
  PAD.rumT = 0.22;
  if (hard) padRumble(0.55 + 0.45*clamp(t, 0, 1), 0.9, 260, 210);
  else padRumble(0, 0.14 + 0.18*clamp(t, 0, 1), 260, Math.round(22 + 26*clamp(t, 0, 1)));
}
function pollPad(dt){
  if (!CFG.pad || !navigator.getGamepads) return;
  const gp = [...navigator.getGamepads()].find(p => p && p.connected); if (!gp) return;
  const dz = CFG.dead, sens = CFG.padSens;
  const axis = v => Math.abs(v) < dz ? 0 : Math.sign(v)*Math.min(1, (Math.abs(v) - dz)/(1 - dz)*sens);
  const lx = axis(gp.axes[0] || 0), ly = axis(gp.axes[1] || 0), rx = axis(gp.axes[2] || 0), ry = axis(gp.axes[3] || 0);
  const btn = i => !!(gp.buttons[i] && gp.buttons[i].pressed), down = i => btn(i) && !PAD.prev[i], up = i => !btn(i) && PAD.prev[i];
  if (btn(0) || btn(1) || lx || ly || rx || ry) audioInit();
  // left stick = the on-screen joystick (aim, fight direction, boat)
  if (lx || ly){ JOY.pad = true; JOY.active = true; JOY.x = lx; JOY.y = ly; }
  else if (JOY.pad){ JOY.pad = false; JOY.active = false; JOY.x = JOY.y = 0; if (G.state === 'hooked'){ mouse.x = innerWidth/2; mouse.y = innerHeight/2; } }
  // right stick = look around
  if (!G.mapOpen && (rx || ry)){
    const lk = LOOK()*dt, iy = INV();
    if (G.state === 'boat'){ G.orbit -= rx*2.2*lk; G.camPitch = clamp((G.camPitch ?? 0.32) + ry*1.2*lk*iy, 0.08, 1.2); }
    else if (G.state === 'idle' || G.state === 'charge'){ G.aimYaw += rx*1.6*lk; G.aimPitch = clamp(G.aimPitch - ry*0.9*lk*iy, -0.9, 0.35); }
    else { G.orbit -= rx*1.6*lk; tiltView(ry*1.0*lk*iy); }
  }
  if (G.mapOpen){
    if (down(1) || down(9)) closeModal();
  } else {
    if (down(0)){ if (G.state === 'boat') setNav(false); else if (!mouse.down){ mouse.down = true; mouse.downT = G.time; press(); } }
    if (up(0) && mouse.down){ mouse.down = false; release(); }
    if (down(1)){ if (G.state === 'result') hideCard(); else retrieve(); }
    if (down(2)) setMode(G.mode === 'pole' ? 'lure' : 'pole');
    if (down(3)) setNav(G.state !== 'boat');
    if (down(9)) $('menu').hidden = !$('menu').hidden;
    if (down(8)) openMap();
    // bumpers: drag / float depth / zoom, repeating while held
    const bump = btn(5) ? 1 : btn(4) ? -1 : 0;
    if (bump){ PAD.repT -= dt; if (down(4) || down(5) || PAD.repT <= 0){ wheel(bump); PAD.repT = down(4) || down(5) ? 0.35 : 0.08; } }
  }
  PAD.prev = gp.buttons.map(b => b.pressed);
}
addEventListener('gamepadconnected', e => { if (CFG.pad) say(`🎮 게임패드 연결됨`, 1.8); if (!$('setm').hidden) renderSettings(); });


/* ---------------- underwater scenery: rocks, coral, weed placed on the bed around the boat ---------------- */
const DECOR = { cx: 1e9, cz: 1e9, key: '' };
function cellHash(ix, iz, k){ const x = Math.sin(ix*127.1 + iz*311.7 + k*74.7 + REGION.depthQ[1]*13.3)*43758.5453; return x - Math.floor(x); }
function updateDecor(){
  const c = G.state === 'boat' || !(G.rig || G.lure || G.hooked) ? BOAT.pos : focusPoint();
  const key = REGION.spot.name;
  if (key === DECOR.key && Math.hypot(c[0] - DECOR.cx, c[2] - DECOR.cz) < 14) return;
  DECOR.key = key; DECOR.cx = c[0]; DECOR.cz = c[2];
  const wt = REGION.spot.water, trop = wt === 'sea_trop', sea = wt.startsWith('sea'), river = wt === 'river_brown';
  const items = [], CELL = 2.2, RAD = 30;
  const i0 = Math.floor((c[0] - RAD)/CELL), i1 = Math.floor((c[0] + RAD)/CELL), j0 = Math.floor((c[2] - RAD)/CELL), j1 = Math.floor((c[2] + RAD)/CELL);
  const pick = (arr, r) => arr[Math.floor(r*arr.length) % arr.length];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++){
    const h = cellHash(i, j, 1); if (h > 0.55) continue;
    const x = (i + cellHash(i, j, 2))*CELL, z = (j + cellHash(i, j, 3))*CELL;
    if (Math.hypot(x - c[0], z - c[2]) > RAD || insideHull(x, z, 0.6)) continue;
    const fd = floorDepth(x, z), real = toReal(fd); if (fd < 0.5) continue;
    const r = cellHash(i, j, 4), r2 = cellHash(i, j, 5), yaw = r2*Math.PI*2, y = -fd;
    const shallow = real < 12;   // plants and coral need light
    let it = null;
    if (trop){
      if (shallow && r < 0.30) it = { k: 'coral', s: 0.6 + r2*0.7, c: pick([[0.85,0.35,0.45],[0.95,0.6,0.25],[0.55,0.35,0.8],[0.9,0.8,0.4],[0.3,0.7,0.7]], r2*5) };
      else if (shallow && r < 0.45) it = { k: 'brain', s: 0.35 + r2*0.4, c: pick([[0.75,0.65,0.4],[0.55,0.7,0.45],[0.8,0.5,0.55]], r2*3) };
      else if (shallow && r < 0.58) it = { k: 'fan', s: 0.6 + r2*0.6, c: pick([[0.8,0.3,0.55],[0.9,0.55,0.2],[0.6,0.4,0.85]], r2*3) };
      else if (r < 0.72) it = { k: 'grass', s: 0.8, c: [0.18,0.38,0.12] };
      else it = { k: 'rock', s: 0.3 + r2*0.9, c: [0.55,0.52,0.46] };
    } else if (sea){
      if (shallow && r < 0.28) it = { k: 'kelp', s: 0.9 + r2*0.6, c: wt === 'sea_cold' ? [0.30,0.24,0.08] : [0.32,0.28,0.10] };
      else if (shallow && r < 0.42) it = { k: 'grass', s: 0.9, c: [0.15,0.32,0.10] };
      else it = { k: 'rock', s: 0.3 + r2*1.2, c: [0.42,0.42,0.40].map(v => v*(0.8 + r*0.4)) };
    } else {
      if (real < 6 && r < 0.40) it = { k: 'reed', s: 0.9 + r2*0.5, c: [0.22,0.40,0.10] };
      else if (real < 9 && r < 0.62) it = { k: 'grass', s: 1.0, c: river ? [0.26,0.30,0.10] : [0.16,0.38,0.12] };
      else if (river && r < 0.72) it = { k: 'log', s: 0.8 + r2*1.2, c: [0.22,0.16,0.10] };
      else it = { k: 'rock', s: 0.25 + r2*0.8, c: [0.40,0.38,0.34].map(v => v*(0.8 + r*0.4)) };
    }
    it.p = [x, y, z]; it.r = yaw; it.h = i*7.13 + j*3.71 + 0.5;
    items.push(it);
  }
  Rn.setDecor(items);
}

/* ---------------- main loop ---------------- */
function update(dt){
  G.time += dt;
  const vN = G.boatV/8;
  BOAT.pos[1] = 0.012*Math.sin(G.time*1.1) + 0.03*Math.abs(vN);
  BOAT.pitch = 0.010*Math.sin(G.time*0.8)*(1 + 2*Math.abs(vN)) + 0.05*vN;
  BOAT.roll = 0.014*Math.sin(G.time*0.63 + 1) - 0.07*G.boatSteer*vN;
  if (G.state === 'boat') updateBoat(dt);
  else {
    G.boatV *= Math.exp(-dt*1.5); G.boatSteer = 0;
    if (Math.abs(G.boatV) > 0.02) moveBoat(dt);
    if (keys.KeyA || keys.ArrowLeft) { if (G.state === 'idle' || G.state === 'charge') G.aimYaw -= dt*1.2; else G.orbit += dt*1.2; }
    if (keys.KeyD || keys.ArrowRight){ if (G.state === 'idle' || G.state === 'charge') G.aimYaw += dt*1.2; else G.orbit -= dt*1.2; }
    const aiming = G.state === 'idle' || G.state === 'charge';
    if (keys.KeyW || keys.ArrowUp){ if (aiming) G.aimPitch = clamp(G.aimPitch + dt*0.8, -0.9, 0.35); else tiltView(-dt*0.9); }
    if (keys.KeyS || keys.ArrowDown){ if (aiming) G.aimPitch = clamp(G.aimPitch - dt*0.8, -0.9, 0.35); else tiltView(dt*0.9); }
  }
  pollPad(dt); fightHaptics(dt); updateMenuState(); mouseLook(dt); updateWeather(dt); updateClock(dt); updateRain(dt); updateVisitors(dt); checkSightings(dt); updateTarget(dt);
  updateWake(); updateParticles(dt); updateDecor();
  applyJoy(dt); SONAR.dt = dt; updateSonar(dt); updateEngine(); updateTouchUI();
  { const c = ['charge', 'fly', 'wait', 'hooked', 'result'].includes(G.state); if (c !== G.castingUI){ G.castingUI = c; document.body.classList.toggle('casting', c); if (c) $('itempop').hidden = true; } }
  // casting power gauge sits where the tackle buttons were
  { const ch = G.state === 'charge'; if (ch !== G.powerUI){ G.powerUI = ch; $('power').hidden = !ch; } if (ch) $('pwfill').style.width = ((1 - G.power)*100).toFixed(1) + '%'; }
  if (G.state === 'charge'){ G.chargeT += dt; const p = (G.chargeT/1.15) % 2; G.power = p < 1 ? p : 2 - p; }
  if (G.state === 'fly'){ G.fly.t += dt; if (G.fly.t >= G.fly.T) land(); }
  if (G.state === 'wait'){ if (G.mode === 'pole') updateRig(dt); else updateLure(dt); }
  if (G.state === 'hooked') updateFight(dt);
  manageFish(dt);
  updateCamera(dt);
  updateHelp();
}
let last = performance.now(), started = false;
const SUBSTEPS = Math.max(1, +(new URLSearchParams(location.search).get('sim')) || 1);   // test aid: extra simulation steps per frame
{ const saved = load(); applyBoatModel(); applyRegion(saved ? (SPOTS.find(s => s.id === saved.id) || saved) : SPOTS[0], true); fillQuests(); }
{ const v = new URLSearchParams(location.search).get('visit'); if (v && BY_ID[v]) setTimeout(() => spawnVisitor(BY_ID[v]), 500); }
setInterval(save, 15000);
function frame(now){
  // frame pacing: phones run at 30 fps; behind a full-screen window (map, shop, quests…) the world only ticks at ~8 fps
  const cap = G.mapOpen && !MAP.anim ? 8 : Rn.fpsCap;
  if (cap && now - last < 1000/cap - 3){ requestAnimationFrame(frame); return; }
  const dt = Math.min(0.05, (now - last)/1000); last = now;
  if (Rn.ready()){
    if (!started){ started = true; $('loading').classList.add('off'); }
    for (let i = 0; i < SUBSTEPS; i++) update(SUBSTEPS > 1 ? 0.05 : dt);
    const res = Rn.render(scene(dt));
    if (res && res.tip){ G.tip = res.tip; G.tipS = vlerp(G.tipS, res.tip, Math.min(1, dt*(G.state === 'hooked' ? 2.5 : 20))); }
    drawHUD();
  }
  requestAnimationFrame(frame);
}
buildToolbar(); updateLog();
requestAnimationFrame(frame);
window.__mapS = (lon, lat) => m2s(nearLon(lon), lat); window.__mapZ = () => MAP.z;
window.__game = { toReal, toVis, showCard, questEvent, updateLog, G, fishes, cam, mouse, hookFish, newFish, applyRegion, classify, SPOTS, BOAT, floorDepth, computeHorizon, spotZone, spawnVisitor, P, openShop, closeShop, BY_ID: window.GameData.BY_ID };
})();
