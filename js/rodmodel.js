/* Fishing rod models (static geometry; the renderer animates reel parts and bends the blank in its vertex shader).

   The spinning rod + reel is ported from Tidewater's FishingRod.js (MIT, © 2026 DRG Software Solutions LLC,
   https://github.com/dgreenheck/tidewater): a 7 ft carbon blank with split EVA grip, reel seat, eight guides and
   tip-top, and a 3000-size spinning reel (gearbox body, rotor with bail and line roller, spool with braid, drag
   knob, crank with T-knob). The float pole (찌낚시) is built the same way: a long telescopic carbon pole with a
   cork grip, section ferrules and a lilian tip.

   Rod frame: +Y along the blank (butt at 0), the reel hangs toward -Z, +X to the right.
   Vertex layout: position(3) normal(3) colour(3) part(1) spec(1) = 11 floats.
   part: 0 fixed · 1 rotor · 2 bail · 3 crank · 4 spool · 5 braid on the spool. */
(function(){
  const FL = 11;
  const lin = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(c => Math.pow(c/255, 2.2));

  // three.js-style compose(T, Euler XYZ, S): returns point / normal transforms
  function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx){
    const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
    // R = Rx·Ry·Rz (row-major)
    const R = [c*e, -c*f, d,
               a*f + b*d*e, a*e - b*d*f, -b*c,
               b*f - a*d*e, b*e + a*d*f, a*c];
    const rot = v => [R[0]*v[0] + R[1]*v[1] + R[2]*v[2], R[3]*v[0] + R[4]*v[1] + R[5]*v[2], R[6]*v[0] + R[7]*v[1] + R[8]*v[2]];
    return {
      p: v => { const r = rot([v[0]*sx, v[1]*sy, v[2]*sz]); return [r[0] + x, r[1] + y, r[2] + z]; },
      n: v => { const r = rot([v[0]/sx, v[1]/sy, v[2]/sz]); const l = Math.hypot(r[0], r[1], r[2]) || 1; return [r[0]/l, r[1]/l, r[2]/l]; },
    };
  }
  const ID = M();

  function Builder(){ this.v = []; }
  // rows[i][j] = [p, n]: quads between neighbouring rows and columns
  Builder.prototype.grid = function(rows, mat, T){
    const col = lin(mat.color), spec = (1 - (mat.rough ?? 0.5))*(0.35 + 0.65*(mat.metal || 0)), part = mat.anim || 0;
    const tr = T || ID;
    const V = q => { const p = tr.p(q[0]), n = tr.n(q[1]); this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], part, spec); };
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < rows[i].length - 1; j++){
      const a = rows[i][j], b = rows[i + 1][j], c = rows[i + 1][j + 1], e = rows[i][j + 1];
      V(a); V(b); V(c); V(a); V(c); V(e);
    }
  };
  // lathe around +Y from [[r, y], ...]; normals smooth across gentle profile bends, split at sharp ones
  Builder.prototype.lathe = function(profile, seg, mat, T){
    const segN = [];
    for (let k = 0; k < profile.length - 1; k++){
      const dr = profile[k + 1][0] - profile[k][0], dy = profile[k + 1][1] - profile[k][1], l = Math.hypot(dr, dy) || 1;
      segN.push([dy/l, -dr/l]);
    }
    const rowsFor = (k) => {   // the two rings of profile segment k with their normals
      const n0 = k > 0 && segN[k - 1][0]*segN[k][0] + segN[k - 1][1]*segN[k][1] > 0.75 ? avg(segN[k - 1], segN[k]) : segN[k];
      const n1 = k < segN.length - 1 && segN[k + 1][0]*segN[k][0] + segN[k + 1][1]*segN[k][1] > 0.75 ? avg(segN[k + 1], segN[k]) : segN[k];
      return [ring(profile[k], n0), ring(profile[k + 1], n1)];
    };
    const avg = (a, b) => { const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; return [x/l, y/l]; };
    const ring = (p, n) => { const r = []; for (let j = 0; j <= seg; j++){ const ph = j/seg*Math.PI*2, s = Math.sin(ph), c = Math.cos(ph);
      r.push([[p[0]*s, p[1], p[0]*c], [n[0]*s, n[1], n[0]*c]]); } return r; };
    for (let k = 0; k < segN.length; k++){ if (profile[k][0] <= 0 && profile[k + 1][0] <= 0) continue; this.grid(rowsFor(k), mat, T); }
  };
  Builder.prototype.cylinder = function(rTop, rBot, h, seg, mat, T){
    this.lathe([[0, -h/2], [rBot, -h/2], [rTop, h/2], [0, h/2]], seg, mat, T);
  };
  Builder.prototype.torus = function(R, r, radial, tubular, mat, T, arc = Math.PI*2){
    const rows = [];
    for (let i = 0; i <= tubular; i++){ const u = i/tubular*arc, cu = Math.cos(u), su = Math.sin(u), row = [];
      for (let j = 0; j <= radial; j++){ const v = j/radial*Math.PI*2, cv = Math.cos(v), sv = Math.sin(v);
        row.push([[(R + r*cv)*cu, (R + r*cv)*su, r*sv], [cv*cu, cv*su, sv]]); }
      rows.push(row); }
    this.grid(rows, mat, T);
  };
  Builder.prototype.sphere = function(r, w, h, mat, T, th0 = 0, thL = Math.PI){
    const rows = [];
    for (let i = 0; i <= h; i++){ const th = th0 + i/h*thL, row = [];
      for (let j = 0; j <= w; j++){ const ph = j/w*Math.PI*2, n = [-Math.cos(ph)*Math.sin(th), Math.cos(th), Math.sin(ph)*Math.sin(th)];
        row.push([[n[0]*r, n[1]*r, n[2]*r], n]); }
      rows.push(row); }
    this.grid(rows, mat, T);
  };
  // box (the source uses rounded boxes; at these sizes a slightly bevelled box reads the same)
  Builder.prototype.box = function(w, h, d, mat, T){
    const x = w/2, y = h/2, z = d/2, F = (n, a, b, c, e) => this.grid([[[a, n], [e, n]], [[b, n], [c, n]]], mat, T);
    F([1, 0, 0], [x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]); F([-1, 0, 0], [-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]);
    F([0, 1, 0], [-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]); F([0, -1, 0], [-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]);
    F([0, 0, 1], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]); F([0, 0, -1], [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]);
  };
  // cylinder from a to b (radius at a, rEnd at b)
  Builder.prototype.rod = function(a, b, r, seg, mat, rEnd = r){
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1e-6, y = [d[0]/L, d[1]/L, d[2]/L];
    const t = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let x = [y[1]*t[2] - y[2]*t[1], y[2]*t[0] - y[0]*t[2], y[0]*t[1] - y[1]*t[0]]; const xl = Math.hypot(...x); x = x.map(v => v/xl);
    const z = [x[1]*y[2] - x[2]*y[1], x[2]*y[0] - x[0]*y[2], x[0]*y[1] - x[1]*y[0]];
    const T = { p: v => [a[0] + x[0]*v[0] + y[0]*(v[1] + L/2) + z[0]*v[2], a[1] + x[1]*v[0] + y[1]*(v[1] + L/2) + z[1]*v[2], a[2] + x[2]*v[0] + y[2]*(v[1] + L/2) + z[2]*v[2]],
                n: v => [x[0]*v[0] + y[0]*v[1] + z[0]*v[2], x[1]*v[0] + y[1]*v[1] + z[1]*v[2], x[2]*v[0] + y[2]*v[1] + z[2]*v[2]] };
    this.cylinder(rEnd, r, L, seg, mat, T);
  };
  // polyline tube of constant radius
  Builder.prototype.tube = function(pts, r, seg, mat){ for (let i = 0; i < pts.length - 1; i++) this.rod(pts[i], pts[i + 1], r, seg, mat); };

  /* ---------------- spinning rod + reel (Tidewater) ---------------- */
  const ROD_L = 2.13, BLANK_START = 0.535, SEAT_Y = 0.405, REEL_Z = -0.092, BODY_Y = 0.327, PIVOT_Y = 0.403;
  const GUIDES = [[0.86, 0.0125, 0.068], [1.1, 0.0085, 0.046], [1.31, 0.0058, 0.031], [1.49, 0.0045, 0.023],
                  [1.65, 0.004, 0.0195], [1.8, 0.0036, 0.0165], [1.93, 0.0034, 0.0145], [2.035, 0.0032, 0.0125]];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a)*t;
  const blankR = y => lerp(0.0074, 0.0011, Math.pow(clamp((y - BLANK_START)/(ROD_L - BLANK_START), 0, 1), 0.85));

  function spinningRod(){
    const g = new Builder(), L = ROD_L, RZ = REEL_Z;
    const BLANK = { color: 0x15191e, rough: 0.42, metal: 0.15 }, WRAP = { color: 0x0c0d10, rough: 0.35 }, TRIM = { color: 0x8a6a2a, rough: 0.3, metal: 0.4 };
    const EVA = { color: 0x2a2b2d, rough: 0.82 }, RUBBER = { color: 0x151515, rough: 0.8 }, GUN = { color: 0x2d3034, rough: 0.32, metal: 0.85 };
    const SEAT = { color: 0x1c1e21, rough: 0.45, metal: 0.2 }, KNURL = { color: 0x3a3d42, rough: 0.35, metal: 0.9 }, FRAME = { color: 0x2a2c2f, rough: 0.25, metal: 1 };
    const INSERT = { color: 0x55595e, rough: 0.12, metal: 0.3 }, STAINLESS = { color: 0xb7bcc0, rough: 0.16, metal: 1 }, CHAMP = { color: 0xa88d5a, rough: 0.24, metal: 1 };
    const BLACK = { color: 0x111214, rough: 0.4, metal: 0.3 }, BRAID = { color: 0x7f9a5a, rough: 0.7 };
    // rod: butt cap, rear grip, winding check, split grip, trim
    g.lathe([[0, 0], [0.012, 0.001], [0.0152, 0.006], [0.0156, 0.016], [0.0149, 0.022]], 24, RUBBER);
    g.lathe([[0.0147, 0.022], [0.0151, 0.07], [0.0152, 0.13], [0.0144, 0.2], [0.0131, 0.248]], 24, EVA);
    g.lathe([[0.0128, 0.248], [0.0128, 0.252], [0.0098, 0.256]], 20, CHAMP);
    g.cylinder(0.0086, 0.009, 0.074, 16, BLANK, M(0, 0.293, 0));
    g.cylinder(0.0093, 0.0093, 0.006, 16, TRIM, M(0, 0.305, 0));
    // reel seat
    g.cylinder(0.0128, 0.0128, 0.024, 24, KNURL, M(0, 0.342, 0));
    g.lathe([[0.0105, 0.354], [0.0118, 0.358], [0.0121, 0.372], [0.0112, 0.38]], 20, GUN);
    g.cylinder(0.0104, 0.0104, 0.056, 20, SEAT, M(0, 0.405, 0));
    g.lathe([[0.0112, 0.43], [0.0121, 0.438], [0.0118, 0.448], [0.0102, 0.452]], 20, GUN);
    g.lathe([[0.0112, 0.452], [0.0118, 0.462], [0.0112, 0.5], [0.0095, 0.53]], 20, EVA);
    g.lathe([[0.0095, 0.53], [0.0095, 0.533], [0.0078, 0.536]], 16, CHAMP);
    // the tapered blank (many rings so it bends smoothly)
    { const prof = []; for (let i = 0; i <= 70; i++){ const y = lerp(BLANK_START, L - 0.004, i/70); prof.push([blankR(y), y]); } g.lathe(prof, 12, BLANK); }
    g.cylinder(blankR(0.6) + 0.0004, blankR(0.56) + 0.0004, 0.05, 12, WRAP, M(0, 0.585, 0));
    g.cylinder(blankR(0.61) + 0.0006, blankR(0.61) + 0.0006, 0.003, 12, TRIM, M(0, 0.612, 0));
    g.torus(0.0035, 0.0006, 5, 14, STAINLESS, M(0, 0.572, -blankR(0.572) - 0.0005, 0, Math.PI/2, Math.PI/2), Math.PI);
    g.cylinder(blankR(0.572) + 0.0005, blankR(0.572) + 0.0005, 0.012, 10, WRAP, M(0, 0.572, 0));
    // guides: frame ring + insert, two legs to a foot, thread wraps
    for (const [y, r, hgt] of GUIDES){
      const br = blankR(y), zc = -hgt, fr = r + Math.max(0.0011, r*0.16), t = Math.max(0.0006, r*0.07);
      g.torus(fr, t*1.3, 6, 22, FRAME, M(0, y, zc, Math.PI/2, 0, 0));
      g.torus(r + t*0.6, t*0.9, 6, 22, INSERT, M(0, y, zc, Math.PI/2, 0, 0));
      const footL = Math.max(0.012, hgt*0.55), yf = y - footL*0.7;
      for (const sx of [-1, 1]) g.rod([0, yf, -br - 0.0008], [sx*fr*0.72, y - 0.0005, zc + fr*0.69], Math.max(0.0007, r*0.09), 5, FRAME, Math.max(0.0005, r*0.07));
      g.box(0.0035, footL, 0.0012, FRAME, M(0, yf, -br - 0.0006));
      g.cylinder(blankR(yf + footL*0.6) + 0.0007, blankR(yf - footL*0.6) + 0.0007, footL*1.25, 10, WRAP, M(0, yf, 0));
      g.cylinder(blankR(yf + footL*0.64) + 0.00085, blankR(yf + footL*0.64) + 0.00085, 0.0016, 10, TRIM, M(0, yf + footL*0.64, 0));
    }
    // tip-top
    g.cylinder(0.0014, 0.0016, 0.012, 8, FRAME, M(0, L - 0.006, 0));
    g.torus(0.0029, 0.0007, 6, 16, FRAME, M(0, L, -0.004, Math.PI/2, 0, 0));
    g.torus(0.0023, 0.0005, 6, 16, INSERT, M(0, L, -0.004, Math.PI/2, 0, 0));
    // the line from the spool through every guide to the tip
    { const pts = [[0, 0.425, RZ + 0.022]]; for (const [y, , hgt] of GUIDES) pts.push([0, y, -hgt + 0.0005]); pts.push([0, L, -0.004]);
      for (let i = 0; i < pts.length - 1; i++) g.rod(pts[i], pts[i + 1], 0.00028, 3, { color: 0x9fb07e, rough: 0.6 }); }
    // reel: foot, stem, gearbox body
    g.box(0.011, 0.062, 0.004, GUN, M(0, 0.405, -0.0118));
    g.box(0.0072, 0.02, 0.08, GUN, M(0, 0.377, -0.045, -0.675, 0, 0));
    g.box(0.0082, 0.03, 0.012, GUN, M(0, 0.352, RZ + 0.02, -0.35, 0, 0));
    g.lathe([[0, 0.279], [0.006, 0.28], [0.0125, 0.286], [0.0185, 0.298], [0.0225, 0.314], [0.0238, 0.33], [0.0228, 0.342], [0.0198, 0.35], [0.018, 0.352]], 32, GUN, M(0, 0, RZ, 0, 0, 0, 0.82, 1, 1));
    for (const sx of [-1, 1]){
      g.cylinder(0.0142, 0.0148, 0.0022, 28, BLACK, M(sx*0.0188, BODY_Y, RZ, 0, 0, Math.PI/2));
      g.torus(0.0145, 0.0007, 6, 32, CHAMP, M(sx*0.0197, BODY_Y, RZ, 0, Math.PI/2, 0));
    }
    g.cylinder(0.0068, 0.0085, 0.011, 18, GUN, M(-0.025, BODY_Y, RZ, 0, 0, Math.PI/2));
    g.cylinder(0.0045, 0.0045, 0.004, 12, CHAMP, M(0.021, BODY_Y, RZ, 0, 0, Math.PI/2));
    g.lathe([[0.018, 0.348], [0.0205, 0.353], [0.0208, 0.357]], 28, CHAMP, M(0, 0, RZ));
    // rotor (1): cup, arms; bail plates (2)
    const ROT = { ...BLACK, anim: 1 };
    g.lathe([[0.006, 0.356], [0.017, 0.358], [0.0235, 0.362], [0.0268, 0.37], [0.0275, 0.381], [0.0262, 0.386]], 32, ROT, M(0, 0, RZ));
    g.lathe([[0.0262, 0.386], [0.0248, 0.3865]], 32, { ...CHAMP, anim: 1 }, M(0, 0, RZ));
    for (const sx of [-1, 1]){
      g.box(0.0065, 0.044, 0.013, ROT, M(sx*0.0285, 0.382, RZ));
      g.box(0.003, 0.012, 0.008, { ...STAINLESS, anim: 2 }, M(sx*0.0322, PIVOT_Y, RZ));
    }
    // bail wire (2) round the spool and the line roller
    { const pts = []; for (let i = 0; i <= 16; i++){ const a = Math.PI*i/16; pts.push([0.0322*Math.cos(a), PIVOT_Y + 0.006*Math.sin(a), RZ - 0.0322*Math.sin(a)]); }
      g.tube(pts, 0.0011, 6, { ...STAINLESS, anim: 2 });
      g.cylinder(0.0032, 0.0032, 0.006, 12, { ...CHAMP, anim: 2 }, M(0.0302, PIVOT_Y + 0.0015, RZ - 0.0035, Math.PI/2, 0, 0)); }
    // spool (4) with braid (5), arbor, front lip, drag knob
    const SP = { ...CHAMP, anim: 4 }, T0 = M(0, 0, RZ);
    g.lathe([[0.0282, 0.375], [0.0288, 0.381], [0.0285, 0.388], [0.0252, 0.392], [0.0238, 0.393]], 36, SP, T0);
    g.lathe([[0.0236, 0.3925], [0.0238, 0.395], [0.0238, 0.41], [0.0236, 0.4125]], 36, { ...BRAID, anim: 5 }, T0);
    g.lathe([[0.0205, 0.3922], [0.0205, 0.4128]], 24, SP, T0);
    g.lathe([[0.0236, 0.4125], [0.0262, 0.4135], [0.0266, 0.4155], [0.0235, 0.418], [0.016, 0.4195], [0.012, 0.42]], 36, SP, T0);
    g.lathe([[0.012, 0.42], [0.0125, 0.422], [0.0126, 0.431], [0.0118, 0.434], [0.009, 0.4355], [0, 0.436]], 24, { ...BLACK, anim: 4 }, T0);
    // crank (3): shaft cap, arm, T-knob
    const CR = o => ({ ...o, anim: 3 });
    g.cylinder(0.0052, 0.0052, 0.008, 12, CR(GUN), M(-0.0315, BODY_Y, RZ, 0, 0, Math.PI/2));
    g.box(0.0038, 0.058, 0.0075, CR(CHAMP), M(-0.036, BODY_Y - 0.026, RZ));
    g.cylinder(0.0026, 0.0026, 0.01, 8, CR(STAINLESS), M(-0.042, BODY_Y - 0.052, RZ, 0, 0, Math.PI/2));
    g.lathe([[0.003, 0], [0.0062, 0.0015], [0.0071, 0.007], [0.0068, 0.018], [0.0048, 0.0225], [0, 0.0235]], 16, CR({ ...RUBBER, color: 0x1d1e20 }), M(-0.046, BODY_Y - 0.052, RZ, 0, 0, Math.PI/2));
    return { data: new Float32Array(g.v), L: ROD_L, blankStart: BLANK_START, seat: SEAT_Y, reelZ: REEL_Z, bodyY: BODY_Y, pivotY: PIVOT_Y };
  }

  /* ---------------- float pole (찌낚시): 4.5 m telescopic carbon pole ---------------- */
  function floatPole(){
    const g = new Builder(), L = 4.5, START = 0.42;
    const BLANK = { color: 0x1e2a1c, rough: 0.35, metal: 0.2 }, CORK = { color: 0x9a7448, rough: 0.85 }, GOLD = { color: 0xa88d5a, rough: 0.24, metal: 1 };
    const RUBBER = { color: 0x151515, rough: 0.8 }, WRAP = { color: 0x0c0d10, rough: 0.35 }, LILIAN = { color: 0xe8d23a, rough: 0.6 };
    const r = y => lerp(0.0125, 0.0009, Math.pow(clamp((y - START)/(L - START), 0, 1), 0.7));
    g.lathe([[0, 0], [0.0125, 0.001], [0.0152, 0.008], [0.0154, 0.03]], 24, RUBBER);
    g.lathe([[0.0154, 0.03], [0.0158, 0.12], [0.0156, 0.25], [0.0148, 0.36], [0.0138, 0.4]], 24, CORK);
    g.lathe([[0.0138, 0.4], [0.0138, 0.405], [0.0126, 0.42]], 20, GOLD);
    { const prof = []; for (let i = 0; i <= 90; i++){ const y = lerp(START, L - 0.12, i/90); prof.push([r(y), y]); } g.lathe(prof, 12, BLANK); }
    // telescopic section joints: a thin gold ring and a dark wrap at each ferrule
    for (const y of [1.05, 1.7, 2.35, 3.0, 3.6]){
      g.cylinder(r(y) + 0.0008, r(y) + 0.0008, 0.004, 12, GOLD, M(0, y, 0));
      g.cylinder(r(y + 0.02) + 0.0004, r(y + 0.02) + 0.0004, 0.03, 12, WRAP, M(0, y + 0.02, 0));
    }
    // lilian (braided tip cord) and its whipping
    g.cylinder(0.0008, 0.001, 0.12, 6, LILIAN, M(0, L - 0.06, 0));
    g.cylinder(0.0014, 0.0014, 0.01, 8, WRAP, M(0, L - 0.125, 0));
    return { data: new Float32Array(g.v), L, blankStart: START, seat: 0.22, reelZ: 0, bodyY: 0, pivotY: 0 };
  }

  window.RodModel = { FL, spinningRod, floatPole };
})();
