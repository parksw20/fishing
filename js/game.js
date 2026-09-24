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
let REGION = null;
function floorDepth(x, z){
  const [base, amp, mn, mx] = REGION.depthP, [sc, sx, sz, st] = REGION.depthQ;
  const qx = x*sc, qz = z*sc;
  const n = 0.5*Math.sin(qx + sx)*Math.sin(qz*0.83 + sz) + 0.3*Math.sin((qx*0.7 - qz*0.9)*2.1 + sx*2) + 0.2*Math.sin((qx*1.3 + qz*0.4)*4.3 + sz*3);
  const d = clamp(base + amp*n, mn, mx);
  const t = clamp((Math.hypot(x, z) - 12)/58, 0, 1);
  return lerp(st, d, t*t*(3 - 2*t));
}
function column(x, z){ return Math.min(floorDepth(x, z), VIS_DEPTH); }

/* ---------------- setup ---------------- */
const BOAT = { pos:[0,0,0], heading:0, pitch:0, roll:0 };
const HULL = { l:2.05, w:0.72 };
const SEAT = [0, 1.02, 1.30];               // eye position in the boat (sitting on the stern thwart)
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
const AU = { ctx: null, noise: null, reelT: 0, dragT: 0 };
function audioInit(){
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  try {
    AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const n = AU.ctx.sampleRate; const b = AU.ctx.createBuffer(1, n, n); const d = b.getChannelData(0);
    for (let i=0;i<n;i++) d[i] = Math.random()*2-1;
    AU.noise = b;
  } catch(e){ AU.ctx = null; }
}
function noise(dur, type, freq, q, gain, attack){
  if (!AU.ctx) return;
  const c = AU.ctx, t = c.currentTime;
  const s = c.createBufferSource(); s.buffer = AU.noise; s.loop = true;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + (attack||0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(c.destination); s.start(t, Math.random()*0.5); s.stop(t + dur + 0.05);
}
function tone(freq, dur, gain, type){
  if (!AU.ctx) return;
  const c = AU.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = type||'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq*0.6, t+dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+dur+0.02);
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
const GAME_HOUR = 45;   // real seconds per in-game hour
function yawDir(y){ return [Math.sin(y), 0, -Math.cos(y)]; }
function viewYaw(){ return G.aimYaw + (G.lookX || 0); }
function viewPitch(){ return clamp(G.aimPitch + (G.lookY || 0), -1.0, 0.45); }
// desktop: the view follows the mouse (and keeps turning when the pointer sits near a screen edge)
function mouseLook(dt){
  const on = !TOUCH.on && !G.mapOpen && !mouse.rdown && ['idle', 'charge', 'wait', 'fly', 'boat', 'result'].includes(G.state);
  let tx = 0, ty = 0;
  if (on && mouse.moved){
    const nx = clamp(mouse.x/innerWidth*2 - 1, -1, 1), ny = clamp(mouse.y/innerHeight*2 - 1, -1, 1);
    const edge = v => Math.sign(v)*Math.max(0, Math.abs(v) - 0.8)/0.2;
    if (G.state === 'idle' || G.state === 'charge'){
      G.aimYaw += edge(nx)*dt*1.4; G.aimPitch = clamp(G.aimPitch - edge(ny)*dt*0.7, -0.9, 0.35);
      tx = nx*0.35; ty = -ny*0.2;
    } else if (G.state !== 'result'){ G.orbit -= edge(nx)*dt*1.2; tx = -nx*0.45; ty = 0; }
  }
  const k = Math.min(1, dt*5);
  G.lookX = lerp(G.lookX || 0, tx, k); G.lookY = lerp(G.lookY || 0, ty, k);
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
function habitat(sp, fd){
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
function depthBand(sp){ const lo = Math.min(sp.dmin, VIS_DEPTH - 1); return [lo, Math.max(lo + 0.6, Math.min(sp.dmax, VIS_DEPTH + 1))]; }
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
      else { f.state = 'take'; f.timer = (sp.bite === 'rise' ? rand(1.6, 2.2) : rand(1.0, 1.5))*tierOf('hook').window; rig.take = { style: sp.bite, t: 0 }; }
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
  G.fly = { from: G.tip.slice(), to, t: 0, T: 0.55 + d*0.03, h: 1.2 + d*0.12, power: G.power };
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
  G.strike = { f, t: 0.5*tierOf('hook').window };
  say('바이트! 감아요!', 0.8, 'hot');
}

/* ---------------- fight ---------------- */
function hookFish(f){
  const tip = tipXZ();
  G.strike = null; G.engaged = null;
  G.hooked = f; f.state = 'hooked'; G.state = 'hooked';
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
  fishes.splice(fishes.indexOf(f), 1);
  G.hooked = null; G.fight = null; G.state = 'result';
  Rn.splash(f.pos[0], f.pos[2], 0.2, 0.05); sfx.splash(0.6); sfx.win();
  P.coins += pts;
  showCard(rec, isBest && !!prev, !prev);
  questEvent({ type: 'catch', rec });
  updateLog(); save();
}

/* ---------------- UI ---------------- */
function showCard(r, record, first){
  const c = $('card');
  c.querySelector('.sp').textContent = r.name;
  c.querySelector('.latin').textContent = r.sp.latin;
  c.querySelector('.len').textContent = (r.len*100).toFixed(1) + 'cm';
  c.querySelector('.wt').textContent = kg(r.weight);
  c.querySelector('.pts').textContent = '+' + r.pts + '점';
  c.querySelector('.badge').textContent = first ? '첫 포획! 도감 등록' : record ? '개인 최대어 갱신!' : '';
  c.querySelector('.tipc').textContent = r.sp.tip ? '💡 ' + r.sp.tip : '';
  c.querySelector('.pts').textContent = `+${r.pts}점 · +${r.pts}🪙`;
  // real photo (iNaturalist, CC-licensed) when available, otherwise the drawn icon
  const ph = (window.FISH_PHOTOS || {})[r.sp.id], img = c.querySelector('.photo'), cred = c.querySelector('.credit'), cv = c.querySelector('canvas');
  if (ph){ img.src = ph.file; img.alt = r.sp.name; img.hidden = false; cv.hidden = true; cred.hidden = false; cred.textContent = `📷 ${ph.author} · ${ph.license.toUpperCase()} · iNaturalist`; }
  else { img.hidden = true; cred.hidden = true; cv.hidden = false; drawFishIcon(cv, r.sp); }
  c.hidden = false;
}
function hideCard(){ $('card').hidden = true; if (G.state === 'result') G.state = 'idle'; }
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
  $('coins').textContent = P.coins.toLocaleString() + '🪙';
  $('count').textContent = G.catches.length;
  const ul = $('catches'); ul.innerHTML = '';
  for (const c of G.catches.slice(0, 7)){
    const li = document.createElement('li');
    li.innerHTML = `<b>${c.name}</b><span>${(c.len*100).toFixed(1)}cm · ${kg(c.weight)}</span>`;
    ul.appendChild(li);
  }
  const dex = $('dex'); dex.innerHTML = '';
  const got = SPECIES.filter(s => G.best[s.id]).length;
  $('dexcount').textContent = `도감 ${got}/${SPECIES.length} · 이 지역 어종`;
  for (const [id] of BIOMES[REGION.biome].fish){ const s = BY_ID[id]; const b = G.best[s.id]; const el = document.createElement('span'); el.className = b ? 'got' : ''; el.title = b ? `${s.name} 최대 ${(b.len*100).toFixed(1)}cm` : '미발견'; el.textContent = b ? s.name : '?'; dex.appendChild(el); }
  for (const [id] of BIOMES[REGION.biome].visitors || []){ const s = BY_ID[id]; if (!s.sight) continue; const n = P.sightings[id]; const el = document.createElement('span'); el.className = n ? 'got' : ''; el.title = n ? `${s.name} 목격 ${n}회` : '미목격 (관찰 대상)'; el.textContent = n ? (s.icon || '👀') + s.name : '👀?'; dex.appendChild(el); }
}
function buildToolbar(){
  const modes = $('modes'); modes.innerHTML = '';
  for (const k of ['pole', 'lure']){
    const b = document.createElement('button'); b.textContent = MODES[k].name; b.className = G.mode === k ? 'on' : '';
    b.onclick = e => { e.stopPropagation(); setMode(k); }; modes.appendChild(b);
  }
  const items = $('items'); items.innerHTML = '';
  modeCfg().items.forEach((it, i) => {
    if (!P.owned[it.id]) return;
    const b = document.createElement('button'); b.textContent = itemName(it); b.title = it.desc; b.className = G.item[G.mode] === i ? 'on' : '';
    b.onclick = e => { e.stopPropagation(); setItem(i); }; items.appendChild(b);
  });
  $('itemdesc').textContent = curItem().desc;
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
  idle: () => '<b>조그</b> 방향 · 화면 드래그 시점 · <b>던지기</b> 길게 눌렀다 놓기 · ⛵ 보트 · 🗺 지도',
  charge: () => '손을 떼면 던집니다',
  fly: () => '',
  wait: () => G.mode === 'pole' ? '찌가 <b>쑥 잠기거나 올라오면 챔질</b> (화면 탭도 가능) · +/− 수심' : '<b>감기</b>를 누르고 있기 · 감다 멈추기로 액션 · +/− 드랙',
  hooked: () => `<b>조그를 물고기 반대쪽</b>으로 · <b>${G.mode === 'pole' ? '들기' : '감기'}</b> 누르기`,
  result: () => '탭하여 계속',
  boat: () => '<b>조그</b> 위: 전진 · 아래: 후진 · 좌우: 조향 · 드래그 시점 · <b>⚓</b> 낚시',
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
    if (G.state === 'boat'){ G.orbit -= dx*0.006; G.camPitch = clamp((G.camPitch ?? 0.32) + dy*0.004, 0.08, 1.2); }
    else if (G.state === 'idle' || G.state === 'charge'){ G.aimYaw -= dx*0.005; G.aimPitch = clamp(G.aimPitch - dy*0.004, -0.9, 0.35); }
    else G.orbit -= dx*0.006;
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
  if (G.mapOpen){ if (!$('shop').hidden){ if (e.code === 'Escape' || e.code === 'KeyP') closeShop(); } else if (e.code === 'Escape' || e.code === 'KeyM') closeMap(); return; }
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
    case 'KeyT': skipTime(); break;
    case 'KeyR': retrieve(); break;
    case 'KeyH': G.help = !G.help; say(G.help ? '입질 표시 켬' : '입질 표시 끔', 1.2); break;
    case 'Space': e.preventDefault(); if (!mouse.down){ mouse.down = true; mouse.downT = G.time; press(); } break;
    case 'Escape': case 'Enter': if (G.state === 'result') hideCard(); break;
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
  const b = joyEl.getBoundingClientRect(), R = b.width/2;
  let x = (e.clientX - b.left - R)/(R*0.8), y = (e.clientY - b.top - R)/(R*0.8);
  const l = Math.hypot(x, y); if (l > 1){ x /= l; y /= l; }
  JOY.x = x; JOY.y = y; knob.style.transform = `translate(${x*R*0.8}px, ${y*R*0.8}px)`;
}
joyEl.addEventListener('pointerdown', e => { e.preventDefault(); audioInit(); joyEl.setPointerCapture(e.pointerId); JOY.active = true; JOY.id = e.pointerId; joyEl.classList.add('on'); joyMove(e); });
joyEl.addEventListener('pointermove', e => { if (JOY.active && e.pointerId === JOY.id) joyMove(e); });
const joyUp = e => { if (e.pointerId !== JOY.id) return; JOY.active = false; JOY.id = null; JOY.x = JOY.y = 0; knob.style.transform = ''; joyEl.classList.remove('on');
  if (G.state === 'hooked'){ mouse.x = innerWidth/2; mouse.y = innerHeight/2; } };
joyEl.addEventListener('pointerup', joyUp); joyEl.addEventListener('pointercancel', joyUp);
function applyJoy(dt){
  if (G.state === 'hooked'){
    if (JOY.active){ const R = ringRadius(); mouse.x = innerWidth/2 + JOY.x*R; mouse.y = innerHeight/2 + JOY.y*R; }
    return;
  }
  if (!JOY.active || G.state === 'boat') return;
  if (G.state === 'idle' || G.state === 'charge'){ G.aimYaw += JOY.x*dt*1.3; G.aimPitch = clamp(G.aimPitch - JOY.y*dt*0.8, -0.9, 0.35); }
  else G.orbit -= JOY.x*dt*1.4;
}
/* action button: hold = cast charge / reel / lift, tap = hook set; the label follows the situation */
const act = $('act');
act.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); audioInit(); act.setPointerCapture(e.pointerId); act.classList.add('down');
  if (G.state === 'boat'){ setNav(false); return; }
  if (!mouse.down){ mouse.down = true; mouse.downT = G.time; press(); }
});
const actUp = e => { act.classList.remove('down'); if (mouse.down){ mouse.down = false; release(); } };
act.addEventListener('pointerup', actUp); act.addEventListener('pointercancel', actUp);
act.addEventListener('contextmenu', e => e.preventDefault());
$('tplus').addEventListener('click', e => { e.stopPropagation(); wheel(1); });
$('tminus').addEventListener('click', e => { e.stopPropagation(); wheel(-1); });
$('tnav').addEventListener('click', e => { e.stopPropagation(); audioInit(); setNav(G.state !== 'boat'); });
$('tmap').addEventListener('click', e => { e.stopPropagation(); openMap(); });
$('tmenu').addEventListener('click', e => { e.stopPropagation(); $('toolbar').classList.toggle('open'); });
let actCache = '';
function updateTouchUI(){
  if (!TOUCH.on) return;
  const f = G.engaged, pole = G.mode === 'pole';
  const lbl = { idle: '던지기', charge: '놓으면<br>던짐', fly: '…', result: '계속', boat: '⚓<br>낚시',
    wait: pole ? '챔질' : '감기', hooked: pole ? '들기' : '감기' }[G.state];
  const hot = (G.state === 'wait' && pole && f && f.state === 'take') || (G.state === 'wait' && G.strike);
  const adj = G.state === 'boat' ? '줌' : pole ? '수심' : '드랙';
  const key = lbl + hot + adj + G.state;
  if (key !== actCache){ actCache = key; act.innerHTML = lbl; act.classList.toggle('hot', !!hot); $('tadj').textContent = adj; $('tnav').textContent = G.state === 'boat' ? '🎣' : '⛵'; }
}
function toggleQuests(){ const q = $('questbox'); q.hidden = !q.hidden; if (!q.hidden) renderQuests(); }
$('navquest').addEventListener('click', e => { e.stopPropagation(); toggleQuests(); });
$('questclose').addEventListener('click', e => { e.stopPropagation(); $('questbox').hidden = true; });
$('navshop').addEventListener('click', e => { e.stopPropagation(); openShop(); });
$('shopclose').addEventListener('click', closeShop);
$('shop').addEventListener('pointerdown', e => { if (e.target === $('shop')) closeShop(); });
$('navtime').addEventListener('click', e => { e.stopPropagation(); skipTime(); });
let targetT = 0;
function updateTarget(dt){
  $('clock').textContent = `${fmtClock()} ${PERIOD_NAME[period()]} · ${G.weather === 'clear' && period() === 'night' ? '🌙' : WEATHERS[G.weather].icon} ${WEATHERS[G.weather].name}`;
  targetT -= dt; if (targetT > 0) return; targetT = 0.4;
  const el = $('target'), sp = questTarget();
  if (!sp || !(G.state === 'idle' || G.state === 'wait' || G.state === 'charge')){ el.hidden = true; return; }
  const { v, parts } = matchRating(sp);
  const names = { bait: G.mode === 'pole' ? '미끼가 안 맞아요' : '루어가 안 맞아요', depth: `수심이 안 맞아요 (${depthBand(sp)[0].toFixed(1)}–${depthBand(sp)[1].toFixed(1)}m${sp.zone === 'bottom' ? ', 바닥층' : sp.zone === 'top' ? ', 수면층' : ''})`,
    time: `지금은 활성도가 낮아요 (${Object.entries(sp.act).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => PERIOD_NAME[k]).join('·')}에 활발)`, gear: '원줄이 너무 굵어 경계해요', weather: `날씨가 안 맞아요 (${WEATHERS[G.weather].name})`, retrieve: `감기 속도: ${ {slow:'느리게(감다 멈추기)', medium:'보통', fast:'빠르게 계속'}[sp.retrieve] }` };
  const worst = Object.entries(parts).sort((a, b) => a[1] - b[1])[0];
  const habitatNote = habitat(sp, floorDepth(...(G.rig ? [G.rig.pos[0], G.rig.pos[2]] : G.lure ? [G.lure.pos[0], G.lure.pos[2]] : [BOAT.pos[0], BOAT.pos[2]]))) < 0.5 ? ' · 여기는 서식 수심이 아니에요' : '';
  el.innerHTML = `🎯 <b>${sp.name}</b> 공략도 <span class="st">${stars(v)}</span><br><span class="why">${worst[1] < 0.6 ? names[worst[0]] : '좋은 조건이에요!'}${habitatNote}</span>`;
  el.hidden = false;
  el.style.top = TOUCH.on ? '' : ($('toolbar').offsetHeight + 24) + 'px';
}
$('navfish').addEventListener('click', e => { e.stopPropagation(); audioInit(); setNav(false); });
$('navboat').addEventListener('click', e => { e.stopPropagation(); audioInit(); setNav(true); });
$('navmap').addEventListener('click', e => { e.stopPropagation(); openMap(); });

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
    G.depthSet = clamp(Math.round((G.depthSet + s*0.1)*10)/10, 0.3, VIS_DEPTH);
    const r = G.rig;
    say(`찌 수심 ${G.depthSet.toFixed(1)}m${r && G.depthSet >= r.floor - 0.03 ? ' (바닥 닿음)' : ''}`, 1);
  }
}

/* ---------------- camera ---------------- */
function baitView(focus, back, up, side){
  const e = eyeWorld();
  let dx = focus[0] - e[0], dz = focus[2] - e[2]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const oa = G.orbit + (side||0) + (G.state === 'hooked' ? 0 : (G.lookX || 0));
  const c = Math.cos(oa), s = Math.sin(oa); const rx = dx*c - dz*s, rz = dx*s + dz*c;
  return { pos: [focus[0] - rx*back, up, focus[2] - rz*back], look: [focus[0], -0.25, focus[2]] };
}
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
      const s = smooth(clamp(G.fly.t/G.fly.T, 0, 1)), a = boatView(), b = baitView(G.fly.to, 3.4, 2.3);
      T = { pos: vlerp(a.pos, b.pos, s), look: vlerp(a.look, b.look, s) }; k = 8; break; }
    case 'wait': {
      if (G.rig){ T = baitView(G.rig.pos, 3.4, 2.3); k = 3.5; break; }
      const L = G.lure.pos, dp = Math.min(-L[1], 7);
      T = baitView([L[0], 0, L[2]], 3.0 + dp*0.25, 2.2 + dp*0.25);
      T.look = [L[0], -dp*0.9 - 0.2, L[2]]; k = 3.5; break; }
    case 'hooked': {
      const f = G.hooked.pos;
      const L = G.hooked.len; T = baitView([f[0], 0, f[2]], 2.6 + L*4, 1.8 + L*3, G.fightSide); k = 2.5; break; }
  }
  const a = 1 - Math.exp(-dt*k);
  cam.pos = vlerp(cam.pos, T.pos, a); cam.look = vlerp(cam.look, T.look, a);
  cam.pos[1] = Math.max(cam.pos[1], 0.45);
}

/* ---------------- scene assembly ---------------- */
function rodSpec(){
  const e = eyeWorld(), m = modeCfg();
  let yaw = viewYaw(), el = G.mode === 'pole' ? 0.2 : 0.5, bend = 0.04, target;
  if (G.state === 'charge') el += G.power*0.9;
  if (G.state === 'fly'){ const s = clamp(G.fly.t/0.22, 0, 1); el = lerp(el + G.fly.power*0.9, el - 0.12, s); }
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
  const S = { t: G.time, dt, cam: { pos: cam.pos, look: cam.look }, boat: BOAT, fish: [], lure: null, bobber: null, lineUnder: null, lineTo: null, lineSag: 0, flyObj: null };
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
    if (G.state === 'charge'){
      const w = Math.min(320, hudW*0.6), x = cx - w/2, y = hudH - 150;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x-3, y-3, w+6, 18);
      const gr = ctx.createLinearGradient(x, 0, x+w, 0); gr.addColorStop(0, '#6fd3ff'); gr.addColorStop(0.7, '#ffe27a'); gr.addColorStop(1, '#ff7a59');
      ctx.fillStyle = gr; ctx.fillRect(x, y, w*G.power, 12);
      label('캐스팅 파워', cx, y - 10, '#fff', 13);
    }
  }
  if (G.state === 'wait' && G.rig){
    const r = G.rig;
    if (G.help){
      const s = Rn.project([r.pos[0], 0.35, r.pos[2]]);
      const f = G.engaged;
      if (s && f && f.state === 'take') label('챔질!', s[0], s[1] - 10, '#ffdf4a', 22);
      else if (s && f && f.state === 'nibble') label('입질…', s[0], s[1] - 10, '#bfe9ff', 15);
    }
    if (r.baitGone){ const s = Rn.project([r.pos[0], 0.35, r.pos[2]]); if (s) label('미끼 없음', s[0], s[1] - 10, '#ff9a8a', 14); }
    { const s = Rn.project([r.pos[0], 0.12, r.pos[2]]); if (s) label(`수심 ${r.baitDepth.toFixed(1)}m${r.laid ? ' · 바닥' : ''}`, s[0] + 42, s[1] + 4, 'rgba(255,255,255,.85)', 12); }
  }
  if (G.state === 'wait' && G.lure){
    const L = G.lure, s = Rn.project(L.pos);
    if (s){ ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,230,120,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s[0], s[1], 14, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      label(`${(-L.pos[1]).toFixed(1)}m`, s[0] + 30, s[1] + 4, 'rgba(255,255,255,.85)', 12); }
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
  $('tfill').style.height = (clamp(T, 0, 1.1)/1.1*100).toFixed(1) + '%';
  $('tfill').className = T > 0.85 ? 'danger' : T > 0.6 ? 'warn' : '';
  $('dragmark').style.bottom = (clamp(G.drag, 0, 1.1)/1.1*100).toFixed(1) + '%';
  $('dragmark').style.display = G.mode === 'lure' ? 'block' : 'none';
  const lines = [];
  const lk = lineKg();
  $('tbar').hidden = G.state === 'boat';
  if (G.state === 'boat'){
    const hdg = ((BOAT.heading*180/Math.PI) % 360 + 360) % 360;
    lines.push(`<div><span>속도</span><b>${(Math.abs(G.boatV)*1.944).toFixed(1)}노트</b></div>`);
    lines.push(`<div><span>방위</span><b>${Math.round(hdg)}° ${['북','북동','동','남동','남','남서','서','북서'][Math.round(hdg/45)%8]}</b></div>`);
    lines.push(`<div><span>수심</span><b>${floorDepth(BOAT.pos[0], BOAT.pos[2]).toFixed(1)}m</b></div>`);
    lines.push(`<div><span>기점 거리</span><b>${Math.round(Math.hypot(BOAT.pos[0], BOAT.pos[2]))}m</b></div>`);
  } else {
  lines.push(`<div><span>장력</span><b>${(T*lk).toFixed(1)}kg</b></div>`);
  if (G.mode === 'lure') lines.push(`<div><span>드랙</span><b>${(G.drag*lk).toFixed(1)}kg${G.drag >= 1 ? ' 🔒' : ''}</b></div>`);
  else lines.push(`<div><span>찌 수심</span><b>${G.depthSet.toFixed(1)}m</b></div>`);
  lines.push(`<div><span>원줄</span><b>${lk.toFixed(0)}kg</b></div>`);
  }
  if (F) lines.push(`<div><span>거리</span><b>${F.lineOut.toFixed(1)}m</b></div>`);
  else if (G.rig) lines.push(`<div><span>바닥</span><b>${G.rig.floor.toFixed(1)}m</b></div>`);
  else if (G.lure) lines.push(`<div><span>거리</span><b>${dist2(G.lure.pos, tipXZ()).toFixed(1)}m</b></div>`);
  const h = lines.join('');
  if (h !== gaugeCache){ $('ginfo').innerHTML = h; gaugeCache = h; }
  $('retrieve').hidden = G.state !== 'wait';
  $('toolbar').classList.toggle('locked', G.state !== 'idle' && G.state !== 'charge' && G.state !== 'boat');
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
  if (G.state !== 'idle' && G.state !== 'boat') return;
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
    if (!AU.rain){ const c = AU.ctx, s0 = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s0.buffer = AU.noise; s0.loop = true; f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.4; g.gain.value = 0; s0.connect(f); f.connect(g); g.connect(c.destination); s0.start(); AU.rain = g; }
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
  return (sp.pref[curItem().id] || 0) * depthFactor(sp, d, x, z) * activity(sp) * weatherFactor(sp) * gearFactor(sp) * retrieveFactor(sp);
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
const P = { coins: 200, owned: {}, tier: { rod: 0, reel: 0, line: 0, hook: 0, sonar: 0, engine: 0 }, sightings: {}, quests: [], done: 0 };
for (const it of [...BAITS, ...LURES]) if (!it.cost) P.owned[it.id] = true;
function save(){
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ P, best: G.best, score: G.score, catches: G.catches.slice(0, 30).map(c => ({ id: c.sp.id, len: c.len, weight: c.weight, pts: c.pts })), clock: G.clock, spot: REGION && REGION.spot })); } catch(e){}
}
function load(){
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (!d) return null;
    Object.assign(P.tier, d.P.tier || {}); Object.assign(P.owned, d.P.owned || {}); P.coins = d.P.coins ?? P.coins;
    P.sightings = d.P.sightings || {}; P.quests = (d.P.quests || []).filter(q => q.sp ? BY_ID[q.sp] : true); P.done = d.P.done || 0;
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
  f.pos[1] = -clamp(rand(sp.dmin, Math.min(sp.dmax, VIS_DEPTH - 1)), 0.6 + f.len*0.12, Math.max(1, fd - f.len*0.2));
  f.state = 'cruise'; f.visitor = true; f.cruise = sp.speed*rand(0.7, 1);
  f.target = [c[0] + dir[0]*45 + perp[0]*side, 0, c[2] + dir[1]*45 + perp[1]*side]; f.ty = f.pos[1];
  f.heading = Math.atan2(dir[1], dir[0]);
  fishes.push(f);
}
function checkSightings(){
  for (const f of fishes){
    if (!f.visitor || f.seen) continue;
    const s = Rn.project(f.pos); if (!s) continue;
    if (s[0] < 0 || s[0] > innerWidth || s[1] < 0 || s[1] > innerHeight) continue;
    if (dist3(f.pos, cam.pos) > 38) continue;
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
function genQuest(){
  const pool = catchables(REGION.biome);
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
    q = { type: 'weight', kg: kgT, got: 0, n: 1, text: `이 지역에서 ${kgT}kg 이상 한 마리`, reward: Math.round(200 + kgT*90) };
  } else if (r < 0.92){
    const night = pool.filter(([sp]) => (sp.act?.night ?? 0) > 0.7 || (sp.act?.dawn ?? 0) > 0.8);
    const sp = (night.length ? night[Math.floor(Math.random()*night.length)] : pool[0])[0];
    const per = ['dawn', 'day', 'dusk', 'night'].reduce((a, b) => (sp.act?.[a] ?? 0) >= (sp.act?.[b] ?? 0) ? a : b);
    q = { type: 'time', sp: sp.id, period: per, got: 0, n: 1, text: `${PERIOD_NAME[per]}에 ${sp.name} 잡기`, reward: Math.round(220*rareMul(sp)) };
  } else {
    const vis = (BIOMES[REGION.biome].visitors || []).map(v => BY_ID[v[0]]);
    const all = Object.values(BIOMES).flatMap(b => (b.visitors || []).map(v => BY_ID[v[0]]));
    const sp = (vis.length ? vis : all)[Math.floor(Math.random()*(vis.length || all.length))];
    q = { type: 'sight', sp: sp.id, got: 0, n: 1, text: `${sp.name} 목격하기`, reward: Math.round((sp.sightCoins || 300)*1.2) };
  }
  q.id = Math.random().toString(36).slice(2, 8); q.where = REGION.spot.name;
  return q;
}
function fillQuests(){
  let guard = 0;
  while (P.quests.length < 3 && guard++ < 40){
    const q = genQuest();
    if (P.quests.some(o => o.text === q.text || (o.sp && o.sp === q.sp && o.type === q.type))) continue;
    P.quests.push(q);
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
      if (q.got >= q.n){ P.coins += q.reward; P.done++; say(`📜 퀘스트 완료: ${q.text} · +${q.reward}🪙`, 3.5, 'hot'); sfx.win(); q.doneAt = G.time; } }
  }
  if (changed){ setTimeout(() => { P.quests = P.quests.filter(q => q.got < q.n); fillQuests(); save(); }, 2500); renderQuests(); }
}
function questTarget(){
  const here = new Set(BIOMES[REGION.biome].fish.map(f => f[0]));
  const q = P.quests.find(q => q.sp && q.got < q.n && q.type !== 'sight' && here.has(q.sp));
  return q ? BY_ID[q.sp] : null;
}
function stars(v){ const n = v > 0.45 ? 5 : v > 0.25 ? 4 : v > 0.12 ? 3 : v > 0.05 ? 2 : v > 0.015 ? 1 : 0; return '★'.repeat(n) + '☆'.repeat(5 - n); }
function renderQuests(){
  const el = $('quests'); if (!el) return;
  el.innerHTML = P.quests.map(q => {
    const sp = q.sp ? BY_ID[q.sp] : null;
    const tip = sp ? `<div class="tip">💡 ${sp.tip || ''}</div>` : '';
    const prog = q.n > 1 ? ` <span class="prog">${q.got}/${q.n}</span>` : '';
    return `<div class="q${q.got >= q.n ? ' done' : ''}"><div class="qt"><b>${q.text}</b>${prog}<span class="rw">${q.reward}🪙</span></div>${tip}<div class="qw">${q.where}${q.type === 'sight' ? ' · 관찰 퀘스트' : ''}</div></div>`;
  }).join('') + `<div class="qfoot">완료한 퀘스트 ${P.done}개 <button id="qreroll">새 퀘스트로 바꾸기</button></div>`;
  $('qreroll').onclick = e => { e.stopPropagation(); P.quests = []; fillQuests(); save(); };
}

/* ---------------- shop ---------------- */
function openShop(){
  if (G.state !== 'idle' && G.state !== 'boat'){ say('채비를 회수한 뒤 상점을 열 수 있어요 (R)', 1.8); return; }
  G.mapOpen = true; $('shop').hidden = false; renderShop();
}
function closeShop(){ G.mapOpen = false; $('shop').hidden = true; buildToolbar(); }
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
  $('shopgrid').innerHTML = `<h3>장비 업그레이드</h3><div class="grid">${up}</div><h3>대낚시 미끼</h3><div class="grid">${itemCards(BAITS)}</div><h3>루어</h3><div class="grid">${itemCards(LURES)}</div>`;
  for (const b of $('shopgrid').querySelectorAll('[data-up]')) b.onclick = () => {
    const s = shopItem(b.dataset.up), next = s.tiers[P.tier[s.id] + 1]; if (!next || P.coins < next.cost) return;
    P.coins -= next.cost; P.tier[s.id]++; sfx.win(); say(`${s.name} → ${next.name}`, 1.8); save(); renderShop(); updateLog();
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
    G.state = 'boat'; G.orbit = 0; say('⛵ 보트 운전 — W/S 가속, A/D 방향', 1.8);
  } else {
    if (G.state !== 'boat') return;
    G.state = 'idle'; G.aimYaw = BOAT.heading; G.aimPitch = -0.2; G.orbit = 0;
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
    o.connect(f); o2.connect(f); f.connect(g); g.connect(c.destination); o.start(); o2.start();
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
  const d = floorDepth(BOAT.pos[0], BOAT.pos[2]);
  const echoes = [];
  for (const f of fishes) if (dist2(f.pos, BOAT.pos) < 6 + f.len*4) echoes.push([-f.pos[1], f.len, f.sp.name]);
  SONAR.cols.push({ d, echoes });
  if (SONAR.cols.length > SONAR.W) SONAR.cols.shift();
}
function drawSonar(){
  const W = TOUCH.on ? 132 : SONAR.W, H = TOUCH.on ? 70 : 96, x0 = 16, y0 = TOUCH.on ? 90 : hudH - H - 78;
  if (hudW < 520 && !TOUCH.on) return;
  let maxD = 5; for (const c of SONAR.cols) maxD = Math.max(maxD, c.d);
  // the range eases toward the next step instead of snapping (5 → 10 → 20 …)
  const want = [5, 10, 20, 30, 40, 60].find(r => r >= maxD*1.08) || 60;
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
function applyRegion(spot, first){
  const W = WATERS[spot.water];
  const seedA = hashf(spot.lat*3.1 + spot.lon*0.7)*6.28, seedB = hashf(spot.lon*1.7 - spot.lat)*6.28;
  REGION = { spot, biome: spot.biome, water: spot.water,
    depthP: W.depth.slice(), depthQ: [W.scale, seedA, seedB, spot.start || Math.min(3, W.depth[0])] };
  const sunEl = clamp(72 - Math.abs(spot.lat)*0.72, 18, 68), sunAz = (hashf(spot.lon) - 0.5)*40;
  Rn.setEnv({ sigA: W.sigA, sigS: W.sigS, depthP: REGION.depthP, depthQ: REGION.depthQ, bed: W.bed, land: W.land, sunEl, sunAz });
  BOAT.pos = [0, 0, 0]; BOAT.heading = 0; G.boatV = 0; G.aimYaw = 0; G.orbit = 0;
  G.rig = null; G.lure = null; G.hooked = null; G.fight = null; G.engaged = null; G.strike = null;
  if (G.state !== 'boat') G.state = 'idle';
  G.depthSet = Math.min(G.depthSet, spot.start || 2);
  SONAR.cols.length = 0; TRAIL.length = 0; PART.list.length = 0; RAIN.drops.length = 0;
  if (!first) setWeather(pickWeather(), true);
  fishes.length = 0;
  for (let i = 0; i < FISH_N; i++) fishes.push(newFish([0, 0, -6], 3, 20));
  const e = eyeWorld(); cam.pos = e.slice(); cam.look = add(e, [0, -2, -10]);
  $('place').textContent = spot.name;
  buildToolbar(); updateLog();
  if (!first) say(`📍 ${spot.name} · ${BIOMES[spot.biome].name}`, 3);
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
  if (G.state !== 'idle' && G.state !== 'boat'){ say('채비를 회수한 뒤 지도를 열 수 있어요 (R)', 1.8); return; }
  G.mapOpen = true; $('map').hidden = false; mouse.down = false;
  for (const k in keys) keys[k] = false;
  const r = REGION.spot; MAP.cx = r.lon; MAP.cy = r.lat; MAP.sel = null;
  sizeMap(); MAP.z = Math.max(MAP.minZ*2.2, MAP.z || 0); drawMap(); showSel(null);
}
function closeMap(){ G.mapOpen = false; $('map').hidden = true; }
function sizeMap(){
  const box = mapCv.parentElement.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
  MAP.w = box.width; MAP.h = box.height; mapCv.width = MAP.w*d; mapCv.height = MAP.h*d; mctx.setTransform(d, 0, 0, d, 0, 0);
  MAP.minZ = Math.max(MAP.w/360, MAP.h/150);
  MAP.z = clamp(MAP.z || MAP.minZ, MAP.minZ, 60);
}
function m2s(lon, lat){ return [MAP.w/2 + (lon - MAP.cx)*MAP.z, MAP.h/2 - (lat - MAP.cy)*MAP.z]; }
function s2m(x, y){ return [MAP.cx + (x - MAP.w/2)/MAP.z, MAP.cy - (y - MAP.h/2)/MAP.z]; }
function clampMap(){
  const hw = MAP.w/2/MAP.z, hh = MAP.h/2/MAP.z;
  MAP.cx = clamp(MAP.cx, -180 + hw, 180 - hw); if (hw >= 180) MAP.cx = 0;
  MAP.cy = clamp(MAP.cy, -62 + hh, 85 - hh); if (hh >= 73) MAP.cy = 11;
}
function drawMap(){
  clampMap();
  const c = mctx, W = MAP.w, H = MAP.h;
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0f3550'); g.addColorStop(0.5, '#0d4a66'); g.addColorStop(1, '#0f3550');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // graticule, tropics and polar circles
  c.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30){ const [x] = m2s(lon, 0); c.strokeStyle = 'rgba(255,255,255,.06)'; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
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
    for (const off of [0, -360, 360]){
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
    const [x, y] = m2s(s.lon, s.lat); if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const salt = BIOMES[s.biome].water === 'salt';
    c.fillStyle = salt ? '#4fd1ff' : '#8ff0a8'; c.strokeStyle = '#08202a'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill(); c.stroke();
    if (MAP.z > MAP.minZ*1.6 || s === MAP.sel){ c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText(s.name, x + 8, y + 4); c.fillStyle = '#fff'; c.fillText(s.name, x + 8, y + 4); }
  }
  // current location
  { const r = REGION.spot, [x, y] = m2s(r.lon, r.lat); c.strokeStyle = '#ffd84a'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 10, 0, TAU); c.stroke();
    c.fillStyle = '#ffd84a'; c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x - 5, y - 20); c.lineTo(x + 5, y - 20); c.fill(); }
  // selection / hover
  if (MAP.sel){ const [x, y] = m2s(MAP.sel.lon, MAP.sel.lat); c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 12, y); c.lineTo(x + 12, y); c.moveTo(x, y - 12); c.lineTo(x, y + 12); c.stroke(); c.beginPath(); c.arc(x, y, 7, 0, TAU); c.stroke(); }
  if (MAP.hover){ $('mapinfo').textContent = fmtLL(MAP.hover[1], MAP.hover[0]) + (isLand(MAP.hover[1], MAP.hover[0]) ? ' · 육지(호수·강)' : ' · 바다'); }
}
function showSel(sp){
  MAP.sel = sp;
  const P = $('mappanel');
  if (!sp){ P.innerHTML = '<p class="hint">지도에서 원하는 곳을 클릭하세요. 표시된 명소나 아무 바다·육지(호수)나 고를 수 있어요.<br><b>휠</b> 확대 · <b>드래그</b> 이동</p>'; return; }
  const W = WATERS[sp.water], B = BIOMES[sp.biome];
  const fish = B.fish.map(([id]) => BY_ID[id].name).join(', ');
  const here = sp === REGION.spot || (sp.lat === REGION.spot.lat && sp.lon === REGION.spot.lon);
  P.innerHTML = `<div class="st"><b>${sp.name}</b><span>${sp.country} · ${fmtLL(sp.lat, sp.lon)}</span></div>
    <div class="tags"><span>${B.name}</span><span>${W.name}</span><span>수심 ${W.depth[2]}–${W.depth[3]}m</span></div>
    <div class="fish">${fish}</div>
    <button id="go" class="on">${here ? '현재 위치' : '⛵ 이곳으로 출발'}</button>`;
  $('go').onclick = e => { e.stopPropagation(); if (!here) travel(sp); else closeMap(); };
}
function travel(sp){
  closeMap();
  const f = $('fade'); f.classList.add('on');
  setTimeout(() => { applyRegion(sp); setTimeout(() => f.classList.remove('on'), 150); }, 650);
}
mapCv.addEventListener('pointerdown', e => { mapCv.setPointerCapture(e.pointerId); MAP.drag = { x: e.clientX, y: e.clientY, cx: MAP.cx, cy: MAP.cy, moved: false }; });
mapCv.addEventListener('pointermove', e => {
  const b = mapCv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  MAP.hover = s2m(x, y);
  if (MAP.drag){ const dx = e.clientX - MAP.drag.x, dy = e.clientY - MAP.drag.y; if (Math.hypot(dx, dy) > 4) MAP.drag.moved = true;
    if (MAP.drag.moved){ MAP.cx = MAP.drag.cx - dx/MAP.z; MAP.cy = MAP.drag.cy + dy/MAP.z; } }
  drawMap();
});
mapCv.addEventListener('pointerup', e => {
  const d = MAP.drag; MAP.drag = null; if (!d || d.moved) return;
  const b = mapCv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  // snap to a spot marker if clicked near one
  let hit = null; for (const s of SPOTS){ const [sx, sy] = m2s(s.lon, s.lat); if (Math.hypot(sx - x, sy - y) < 10) hit = s; }
  const [lon, lat] = s2m(x, y);
  showSel(hit || classify(clamp(lat, -60, 84), clamp(lon, -180, 180))); drawMap();
});
mapCv.addEventListener('wheel', e => {
  e.preventDefault();
  const b = mapCv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  const [lon, lat] = s2m(x, y);
  MAP.z = clamp(MAP.z*(e.deltaY < 0 ? 1.25 : 0.8), MAP.minZ, 60);
  MAP.cx = lon - (x - MAP.w/2)/MAP.z; MAP.cy = lat + (y - MAP.h/2)/MAP.z;
  drawMap();
}, { passive: false });
$('mapclose').addEventListener('click', closeMap);
for (const [id, k] of [['mapin', 1.5], ['mapout', 1/1.5]]) $(id).addEventListener('click', () => { MAP.z = clamp(MAP.z*k, MAP.minZ, 60); drawMap(); });
$('map').addEventListener('pointerdown', e => { if (e.target === $('map')) closeMap(); });
addEventListener('resize', () => { if (G.mapOpen){ sizeMap(); drawMap(); } });

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
    if (keys.KeyW || keys.ArrowUp) G.aimPitch = clamp(G.aimPitch + dt*0.8, -0.9, 0.35);
    if (keys.KeyS || keys.ArrowDown) G.aimPitch = clamp(G.aimPitch - dt*0.8, -0.9, 0.35);
  }
  mouseLook(dt); updateWeather(dt); updateClock(dt); updateRain(dt); updateVisitors(dt); checkSightings(); updateTarget(dt);
  updateWake(); updateParticles(dt);
  applyJoy(dt); SONAR.dt = dt; updateSonar(dt); updateEngine(); updateTouchUI();
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
{ const saved = load(); applyRegion(saved ? (SPOTS.find(s => s.id === saved.id) || saved) : SPOTS[0], true); fillQuests(); }
{ const v = new URLSearchParams(location.search).get('visit'); if (v && BY_ID[v]) setTimeout(() => spawnVisitor(BY_ID[v]), 500); }
setInterval(save, 15000);
function frame(now){
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
window.__game = { G, fishes, cam, mouse, hookFish, newFish, applyRegion, classify, SPOTS, BOAT, floorDepth, spawnVisitor, P, openShop, closeShop, BY_ID: window.GameData.BY_ID };
})();
