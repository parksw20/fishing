/* 온라인 낚시 — DopaMax 포탈의 방(릴레이)으로 2~4명이 같은 낚시터에서 함께 낚시합니다.
 *
 *   · 같이 낚시: 서로의 보트·찌·낚싯줄이 보이고, 누가 무엇을 낚았는지 알림이 뜹니다
 *   · 낚시 대회: 방장이 5/10/15분 대회를 열면 그 시간 동안 낚은 물고기의 **총 무게**로 순위를 겨룹니다
 *
 * 물고기는 각자의 화면에서 따로 돕니다(입질·파이팅은 혼자 하는 시뮬레이션). 주고받는 것은 결과뿐입니다 —
 * 보트 위치, 찌 위치, 잡은 물고기. 낚시터·시각·날씨는 방장이 정하고 나머지는 따라갑니다.
 *
 * 포탈 밖(파일로 바로 열기)이나 방에 들어가지 않은 동안에는 아무 일도 하지 않습니다.
 * 게임 본문(game.js)은 window.DopaMulti 가 있을 때만 여기를 부릅니다.
 */
(function (root) {
  'use strict';

  var gp = root.GamePortal;
  var menuBtn = document.querySelector('#menu [data-m="online"]');
  if (!gp || !gp.room) { if (menuBtn) menuBtn.hidden = true; return; }

  // 포탈 시작 화면('온라인 플레이')과 같은 로비 키를 써야 같은 방에서 만납니다
  var LOBBY = { gameKey: 'main', cap: 4, capChoices: [2, 3, 4] };
  var SEND_HZ = 8, ENV_EVERY = 3, SPREAD = 16;

  var g = function () { return root.__game; };
  var $ = function (id) { return document.getElementById(id); };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var kg = function (w) { return w >= 1 ? w.toFixed(1) + 'kg' : Math.round(w * 1000) + 'g'; };
  var cm = function (len) { return (len * 100).toFixed(0) + 'cm'; };

  var M = {
    active: false,     // 판이 시작돼 함께 낚시 중
    host: false,
    me: null,
    order: [],         // 방에 들어온 순서 (보트 자리 배치에 씀)
    names: {},         // 방 안 id → 닉네임
    peers: {},         // id → 받은 보트 상태 + 그리기용 보간값
    sess: {},          // id → 이번 판에 잡은 수 · 최대어
    sendT: 0, envT: 0, uiT: 0,
    tour: null,        // 대회: { id, dur, endsAt, scores: { id: { kg, n } }, done }
    open: false        // 패널 목록 펼침
  };

  /* ---------------- 방 이벤트 ---------------- */

  gp.on('roomState', function (s) {
    M.me = s.you; M.host = !!s.isHost;
    M.order = (s.peers || []).filter(function (p) { return !p.spectator; }).map(function (p) { return p.id; });
    (s.peers || []).forEach(function (p) { M.names[p.id] = p.name || M.names[p.id] || '낚시꾼'; });
    Object.keys(M.peers).forEach(function (id) { if (M.order.indexOf(id) < 0) delete M.peers[id]; });
    if (s.started && !M.active) start();
    if (!s.started && M.active) stop('판이 끝났어요');
    renderPanel();
  });
  gp.on('roomStart', function () { start(); });
  gp.on('roomEnded', function () { stop('판이 끝났어요'); });
  gp.on('roomClosed', function () { stop(null); });
  gp.on('peerLeave', function (p) {
    if (!M.active) return;
    var n = M.names[p.id];
    delete M.peers[p.id];
    if (n) say('👋 ' + n + ' 님이 나갔어요', 2.2);
    renderPanel();
  });
  gp.on('message', function (m) { if (M.active && m && m.data) onMsg(m.from, m.data); });

  function say(t, s, cls) { var G = g(); if (G && G.say) G.say(t, s, cls); }
  function myName() { var p = gp.getPlayer && gp.getPlayer(); return (p && p.nickname) || M.names[M.me] || '나'; }
  function nameOf(id) { return id === M.me ? myName() : (M.names[id] || '낚시꾼'); }

  function start() {
    if (M.active) return;
    M.active = true; M.peers = {}; M.sess = {}; M.tour = null; M.sendT = 0; M.envT = 0;
    M.host = gp.room.isHost();
    placeBoat();
    if (M.host) sendEnv(); else gp.room.send({ k: 'hi' });
    var others = M.order.filter(function (id) { return id !== M.me; }).map(nameOf);
    say('🌐 온라인 낚시 시작' + (others.length ? ' — ' + others.join(', ') + ' 님과 함께' : ''), 3);
    renderPanel();
  }
  function stop(why) {
    if (!M.active) return;
    M.active = false; M.peers = {}; M.tour = null;
    closeResult();
    if (why) say('🌐 ' + why, 2.2);
    renderPanel();
  }

  /* ---------------- 주고받기 ---------------- */

  function snapshot() {
    var G = g().G, B = g().BOAT, bob = null, tilt = 0;
    if (G.state === 'wait' && G.rig) { bob = [r2(G.rig.pos[0]), r2(G.rig.bobY), r2(G.rig.pos[2])]; tilt = r2(G.rig.tilt || 0); }
    else if (G.state === 'wait' && G.lure) bob = [r2(G.lure.pos[0]), 0, r2(G.lure.pos[2])];
    else if (G.state === 'hooked' && G.hooked) bob = [r2(G.hooked.pos[0]), 0, r2(G.hooked.pos[2])];
    var tip = G.state !== 'boat' && G.tip ? [r2(G.tip[0]), r2(G.tip[1]), r2(G.tip[2])] : null;
    return {
      k: 'p', p: [r2(B.pos[0]), r2(B.pos[1]), r2(B.pos[2])], h: r2(B.heading), pi: r2(B.pitch), ro: r2(B.roll),
      st: G.state, b: bob, tl: tilt, tip: tip, s: g().region().spot.id
    };
  }

  function sendEnv() {
    var R = g().region(); if (!R) return;
    var sp = R.spot;
    gp.room.send({ k: 'env', s: { id: sp.id, lat: sp.lat, lon: sp.lon }, c: r2(g().G.clock), w: g().G.weather });
  }

  function onMsg(from, d) {
    if (from === M.me) return;
    switch (d.k) {
      case 'p': {
        var P = M.peers[from];
        var tgt = { pos: d.p, heading: d.h, pitch: d.pi || 0, roll: d.ro || 0, bob: d.b, tilt: d.tl || 0, tip: d.tip, st: d.st, spot: d.s };
        if (!P) M.peers[from] = { cur: clone(tgt), tgt: tgt, last: now() };
        else { P.tgt = tgt; P.last = now(); if (!P.cur.bob && tgt.bob) P.cur.bob = tgt.bob.slice(); }
        break;
      }
      case 'c': {
        var st = M.sess[from] || (M.sess[from] = { n: 0, best: null });
        st.n++; if (!st.best || d.len > st.best.len) st.best = { name: d.n, len: d.len };
        say('🎣 ' + nameOf(from) + ' 님: ' + d.n + ' ' + cm(d.len) + ' · ' + kg(d.w), 3);
        if (M.tour && !M.tour.done && d.t === M.tour.id) addScore(from, d.w);
        renderPanel();
        break;
      }
      case 'hi':
        if (M.host) { sendEnv(); if (M.tour && !M.tour.done) sendTour(); }
        break;
      case 'env':
        if (!M.host && from === gp.room.host()) applyEnv(d);
        break;
      case 'tour':
        if (from === gp.room.host()) beginTour(d.id, d.dur, d.left);
        break;
      case 'tend':
        if (from === gp.room.host()) endTour(d.id, d.scores);
        break;
    }
  }

  /** 방장을 따라갑니다: 낚시터 · 날씨 · 시각 */
  function applyEnv(d) {
    var G = g().G, R = g().region();
    var here = R && R.spot;
    var same = here && here.id === d.s.id && (d.s.id !== 'custom' || (Math.abs(here.lat - d.s.lat) < 0.01 && Math.abs(here.lon - d.s.lon) < 0.01));
    if (!same && !M.moving) {
      var sp = g().SPOTS.find(function (s) { return s.id === d.s.id; }) || g().classify(d.s.lat, d.s.lon);
      M.moving = true;
      var f = $('fade'); if (f) f.classList.add('on');
      say('⛵ 방장을 따라 ' + sp.name + '(으)로 이동해요', 2.5);
      setTimeout(function () {
        g().applyRegion(sp);
        M.moving = false;
        setTimeout(function () { if (f) f.classList.remove('on'); }, 150);
      }, 600);
    }
    if (d.w && G.weather !== d.w && g().WEATHERS[d.w]) { g().setWeather(d.w); G.wFastT = 10; }
    // 시각은 바로 맞춥니다 — setClockTo 는 앞으로만 흘러가서, 조금 앞서 있으면 하루를 통째로 돌립니다
    var diff = ((d.c - G.clock + 36) % 24) - 12;
    if (Math.abs(diff) > 0.2) { G.clock = ((d.c % 24) + 24) % 24; G.clockTo = null; }
  }

  /* ---------------- 보트 자리 ---------------- */

  /** 같은 낚시터에서 모두 (0,0) 에 뜨면 보트가 겹칩니다 — 들어온 순서대로 둘레에 벌려 둡니다 */
  function placeBoat() {
    var G = g().G, B = g().BOAT;
    if (G.state !== 'idle' && G.state !== 'boat') return;   // 낚시 중이면 채비를 망가뜨리지 않게 그대로 둡니다
    var i = Math.max(0, M.order.indexOf(M.me));
    if (i === 0) return;   // 첫 번째(대개 방장)는 제자리
    var a = i * Math.PI * 2 / 4;
    B.pos[0] = Math.cos(a) * SPREAD; B.pos[2] = Math.sin(a) * SPREAD; G.boatV = 0;
  }

  /* ---------------- 대회 ---------------- */

  function addScore(id, w) {
    var s = M.tour.scores[id] || (M.tour.scores[id] = { kg: 0, n: 0 });
    s.kg += w; s.n++;
  }
  function sendTour() {
    var t = M.tour;
    gp.room.send({ k: 'tour', id: t.id, dur: t.dur, left: Math.max(0, (t.endsAt - now()) / 1000) });
  }
  function startTourAsHost(min) {
    if (!M.host || (M.tour && !M.tour.done)) return;
    beginTour(Math.floor(Math.random() * 1e9), min * 60, min * 60);
    sendTour();
  }
  function beginTour(id, dur, left) {
    if (M.tour && M.tour.id === id) return;
    closeResult();
    M.tour = { id: id, dur: dur, endsAt: now() + left * 1000, scores: {}, done: false };
    M.open = true;   // 대회 중에는 순위를 펼쳐서 시작합니다 (접을 수 있음)
    say('🏆 낚시 대회 시작! ' + Math.round(dur / 60) + '분 동안 낚은 총 무게로 겨뤄요', 3.5);
    renderPanel();
  }
  function endTour(id, scores) {
    var t = M.tour;
    if (!t || t.id !== id) return;
    if (scores) t.scores = scores;   // 방장이 센 표가 정본입니다 — 늦게 도착한 알림으로 화면마다 순위가 갈리지 않게
    if (t.done && !scores) return;
    t.done = true;
    showResult();
    renderPanel();
  }
  function ranking() {
    var t = M.tour; if (!t) return [];
    var ids = M.order.slice();
    Object.keys(t.scores).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    return ids.map(function (id) { var s = t.scores[id] || { kg: 0, n: 0 }; return { id: id, name: nameOf(id), kg: s.kg, n: s.n }; })
      .sort(function (a, b) { return b.kg - a.kg || b.n - a.n; });
  }

  /* ---------------- 매 프레임 (game.js update) ---------------- */

  function tick(dt) {
    if (!M.active) return;
    M.sendT -= dt; M.envT -= dt; M.uiT -= dt;
    if (M.sendT <= 0) { M.sendT = 1 / SEND_HZ; gp.room.send(snapshot()); }
    if (M.host && M.envT <= 0) { M.envT = ENV_EVERY; sendEnv(); }

    // 받은 위치로 부드럽게 따라갑니다 (8Hz 로 오는 값을 그대로 그리면 뚝뚝 끊깁니다)
    var k = 1 - Math.exp(-dt * 6), t = now();
    Object.keys(M.peers).forEach(function (id) {
      var P = M.peers[id], c = P.cur, g2 = P.tgt;
      if (t - P.last > 10000) { delete M.peers[id]; return; }
      for (var i = 0; i < 3; i++) c.pos[i] += (g2.pos[i] - c.pos[i]) * k;
      var dh = Math.atan2(Math.sin(g2.heading - c.heading), Math.cos(g2.heading - c.heading));
      c.heading += dh * k; c.pitch += (g2.pitch - c.pitch) * k; c.roll += (g2.roll - c.roll) * k;
      if (g2.bob && c.bob) for (var j = 0; j < 3; j++) c.bob[j] += (g2.bob[j] - c.bob[j]) * Math.min(1, k * 1.5);
      else c.bob = g2.bob ? g2.bob.slice() : null;
      c.tilt = g2.tilt; c.tip = g2.tip; c.st = g2.st; c.spot = g2.spot;
    });

    var T = M.tour;
    if (T && !T.done && t >= T.endsAt) {
      if (M.host) { T.done = true; gp.room.send({ k: 'tend', id: T.id, scores: T.scores }); showResult(); renderPanel(); }
      else if (t >= T.endsAt + 2500) endTour(T.id, null);   // 방장 소식이 없으면 내 표로 마칩니다
    }
    if (M.uiT <= 0) { M.uiT = 0.25; renderPanel(); }
  }

  /** 다른 사람 보트 (같은 낚시터에 있는 사람만) */
  function others() {
    if (!M.active) return null;
    var here = g().region() && g().region().spot.id, out = [];
    Object.keys(M.peers).forEach(function (id) {
      var c = M.peers[id].cur;
      if (c.spot && here && c.spot !== here) return;
      out.push({ pos: c.pos, heading: c.heading, pitch: c.pitch, roll: c.roll, bob: c.bob, tilt: c.tilt, tip: c.tip });
    });
    return out;
  }

  /** 보트 위에 닉네임 */
  function hud(ctx, project, label) {
    if (!M.active) return;
    var here = g().region() && g().region().spot.id;
    Object.keys(M.peers).forEach(function (id) {
      var c = M.peers[id].cur;
      if (c.spot && here && c.spot !== here) return;
      var s = project([c.pos[0], c.pos[1] + 1.9, c.pos[2]]);
      if (!s) return;
      label((c.st === 'hooked' ? '🎣 ' : '') + nameOf(id), s[0], s[1], '#ffe38a', 14);
    });
  }

  /* ---------------- 화면 (상단 가운데 패널 · 결과창) ---------------- */

  var css = document.createElement('style');
  css.textContent = [
    '#mp{position:fixed;left:50%;transform:translateX(-50%);top:calc(52px + env(safe-area-inset-top,0px));z-index:6;padding:6px 12px;font-size:13px;max-width:min(46vw,360px);text-align:center;color:#fff}',
    'body.touch #mp{top:calc(44px + env(safe-area-inset-top,0px));font-size:12px;max-width:44vw;padding:5px 9px}',
    '#mp .row{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 8px;white-space:nowrap}',
    '#mp b.t{color:#ffd84a;font-variant-numeric:tabular-nums}',
    '#mp button{font:700 12px var(--font,system-ui);padding:4px 9px;border-radius:8px;border:0;background:rgba(255,216,74,.9);color:#1b1b12;cursor:pointer}',
    '#mp button.g{background:rgba(255,255,255,.14);color:#fff}',
    // 눌러서 펼친다는 걸 보이게: 패널 전체가 눌리고, 오른쪽에 "순위 ▾" 칩
    '#mp{cursor:pointer;transition:background .15s}',
    '#mp:hover{background:rgba(20,40,50,.72)}',
    '#mp .more{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.16);font-size:11px;font-weight:700;color:#dff}',
    '#mp:hover .more{background:rgba(255,255,255,.28)}',
    '#mp ol{margin:6px 0 0;padding:0;list-style:none;text-align:left}',
    '#mp li{display:flex;justify-content:space-between;gap:10px;padding:1px 0;font-variant-numeric:tabular-nums}',
    '#mp li.me{color:#8ff0a8}',
    '#mpres{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:rgba(0,0,0,.45)}',
    '#mpres .box{min-width:260px;max-width:88vw;padding:18px 20px;text-align:center}',
    '#mpres h3{margin:0 0 4px;font-size:20px}',
    '#mpres ol{margin:12px 0;padding:0;list-style:none;text-align:left}',
    '#mpres li{display:flex;justify-content:space-between;gap:16px;padding:4px 0;font-variant-numeric:tabular-nums}',
    '#mpres li.me{color:#8ff0a8;font-weight:800}',
    '#mpres button{font:800 14px var(--font,system-ui);padding:9px 20px;border-radius:10px;border:0;background:#ffd84a;color:#1b1b12;cursor:pointer}'
  ].join('\n');
  document.head.appendChild(css);

  var panel = document.createElement('div');
  panel.id = 'mp'; panel.className = 'glass'; panel.hidden = true;
  document.body.appendChild(panel);
  // 패널을 누른 것이 낚싯대 조작(캐스팅·챔질)으로 새지 않게
  ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(function (ev) {
    panel.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: ev === 'touchstart' });
  });
  panel.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b && b.dataset.min) { startTourAsHost(+b.dataset.min); M.pick = false; }
    else if (b && b.dataset.a === 'pick') M.pick = !M.pick;
    else M.open = !M.open;
    renderPanel();
  });

  var lastHtml = '';
  function renderPanel() {
    if (!M.active) { panel.hidden = true; lastHtml = ''; return; }
    panel.hidden = false;
    var T = M.tour, n = 1 + Object.keys(M.peers).length, html;
    if (T && !T.done) {
      var left = Math.max(0, Math.ceil((T.endsAt - now()) / 1000));
      var rk = ranking(), myI = -1;
      rk.forEach(function (r, i) { if (r.id === M.me) myI = i; });
      html = '<div class="row">🏆 대회 <b class="t">' + mmss(left) + '</b>' +
        (myI >= 0 ? '<span>' + (myI + 1) + '위 · ' + kg(rk[myI].kg) + '</span>' : '') + more('순위') + '</div>';
      if (M.open) html += list(rk.map(function (r) { return [r.name, kg(r.kg) + ' (' + r.n + ')', r.id === M.me]; }));
    } else {
      html = '<div class="row">🌐 같이 낚시 · ' + n + '명' +
        (M.host ? (M.pick ? ' <button data-min="5">5분</button><button data-min="10">10분</button><button data-min="15">15분</button><button class="g" data-a="pick">✕</button>'
                          : ' <button data-a="pick">🏆 대회 열기</button>') : '') + more('참가자') + '</div>';
      if (M.open) {
        var ids = [M.me].concat(M.order.filter(function (id) { return id !== M.me; }));
        html += list(ids.map(function (id) {
          var s = id === M.me ? mySess() : M.sess[id];
          return [nameOf(id) + (id === gp.room.host() ? ' 👑' : ''), s && s.n ? s.n + '마리' + (s.best ? ' · 최대 ' + esc(s.best.name) + ' ' + cm(s.best.len) : '') : '-', id === M.me];
        }));
      }
    }
    if (html !== lastHtml) { panel.innerHTML = html; lastHtml = html; }
  }
  function more(label) { return '<span class="more">' + label + ' ' + (M.open ? '▴' : '▾') + '</span>'; }
  function list(rows) {
    return '<ol>' + rows.map(function (r, i) { return '<li class="' + (r[2] ? 'me' : '') + '"><span>' + (i + 1) + '. ' + esc(r[0]) + '</span><span>' + r[1] + '</span></li>'; }).join('') + '</ol>';
  }
  function mySess() { return M.sess[M.me]; }

  var result = null;
  function showResult() {
    closeResult();
    var rk = ranking(); if (!rk.length) return;
    var top = rk[0], meFirst = top.id === M.me && top.kg > 0;
    result = document.createElement('div');
    result.id = 'mpres';
    result.innerHTML = '<div class="box glass"><h3>🏆 대회 종료</h3>' +
      '<div>' + (top.kg > 0 ? (meFirst ? '우승했어요! 🎉' : esc(top.name) + ' 님 우승!') : '아무도 낚지 못했어요') + '</div>' +
      '<ol>' + rk.map(function (r, i) {
        return '<li class="' + (r.id === M.me ? 'me' : '') + '">' +
          '<span>' + (['🥇', '🥈', '🥉'][i] || (i + 1) + '.') + ' ' + esc(r.name) + '</span><span>' + kg(r.kg) + ' · ' + r.n + '마리</span></li>';
      }).join('') + '</ol><button>확인</button></div>';
    ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(function (ev) {
      result.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: ev === 'touchstart' });
    });
    result.querySelector('button').addEventListener('click', closeResult);
    document.body.appendChild(result);
    if (meFirst) say('🏆 낚시 대회 우승!', 3);
  }
  function closeResult() { if (result) { result.remove(); result = null; } }

  function mmss(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function now() { return performance.now(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- 다른 보트와의 거리: 캐스팅 금지 방향 · 충돌 ---------------- */

  // 충돌은 **선체 모양 그대로** — 보트마다 뱃머리 방향으로 누운 타원(반길이 HULL.l, 반폭 HULL.w).
  // 원으로 보면 옆으로 나란히 댈 때도 보트 길이만큼 떨어져서 부딪힌 것처럼 튕겼습니다.
  var SLOW_GAP = 8;          // 선체 사이 틈이 이보다 좁아지며 다가가면 속도를 줄입니다 (m)
  var CONTACT = 0.1;         // 선체끼리 이만큼 가까워지면 닿은 것으로 봅니다 (m)
  var CAST_CLEAR = 5;        // 던지는 방향에서 보트까지 옆으로 이만큼은 떨어져야 합니다
  var CAST_RANGE = 70;       // 이보다 먼 보트는 신경 쓰지 않습니다 (최대 캐스팅 거리보다 넉넉히)

  function hull() { var H = g().HULL; return { l: H.l, w: H.w }; }

  /** 같은 낚시터에 있는 다른 보트의 중심 [x, z] · 뱃머리 방향 · 이름 */
  function boats() {
    if (!M.active) return [];
    var here = g().region() && g().region().spot.id, out = [];
    Object.keys(M.peers).forEach(function (id) {
      var c = M.peers[id].cur;
      if (c.spot && here && c.spot !== here) return;
      out.push({ x: c.pos[0], z: c.pos[2], h: c.heading || 0, id: id });
    });
    return out;
  }

  /** 뱃머리 방향 h 인 선체 타원의, 세계 방향 (ux, uz) 쪽 중심→가장자리 거리 */
  function hullRadius(h, ux, uz, H) {
    var fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    var a = (ux * rx + uz * rz) / H.w, b = (ux * fx + uz * fz) / H.l;
    return 1 / Math.sqrt(a * a + b * b);
  }
  /** 점 (px, pz) 가 (cx, cz, h) 선체 안인가 (m 만큼 부풀려서) */
  function insideHullAt(px, pz, cx, cz, h, H, m) {
    var dx = px - cx, dz = pz - cz;
    var a = (dx * Math.cos(h) + dz * Math.sin(h)) / (H.w + m);
    var b = (dx * Math.sin(h) - dz * Math.cos(h)) / (H.l + m);
    return a * a + b * b < 1;
  }
  /** 두 선체가 겹치나 — 한쪽 윤곽의 점 16개가 다른 쪽 안에 들어가는지 양쪽으로 봅니다 */
  function hullsOverlap(ax, az, ah, bx, bz, bh, H) {
    for (var k = 0; k < 16; k++) {
      var t = k * Math.PI / 8, lat = H.w * Math.cos(t), lon = H.l * Math.sin(t);
      if (insideHullAt(ax + Math.cos(ah) * lat + Math.sin(ah) * lon, az + Math.sin(ah) * lat - Math.cos(ah) * lon, bx, bz, bh, H, CONTACT)) return true;
      if (insideHullAt(bx + Math.cos(bh) * lat + Math.sin(bh) * lon, bz + Math.sin(bh) * lat - Math.cos(bh) * lon, ax, az, ah, H, CONTACT)) return true;
    }
    return false;
  }

  var blockSaidAt = 0;
  /** 이 방향으로 던지면 다른 보트 쪽인가 — 맞으면 알려 주고 true */
  function castBlocked(eye, dir) {
    var list = boats();
    for (var i = 0; i < list.length; i++) {
      var b = list[i], vx = b.x - eye[0], vz = b.z - eye[2];
      var d = Math.hypot(vx, vz);
      if (d > CAST_RANGE) continue;
      var along = vx * dir[0] + vz * dir[2];
      if (along <= 0) continue;                                // 등 뒤
      var side = Math.abs(vx * dir[2] - vz * dir[0]);          // 던지는 선에서 옆으로 떨어진 거리
      if (side < CAST_CLEAR + hull().l * 0.5) {
        if (now() - blockSaidAt > 1200) { blockSaidAt = now(); say('🚫 ' + nameOf(b.id) + ' 님 보트 쪽으로는 던질 수 없어요', 1.6, 'bad'); }
        return true;
      }
    }
    return false;
  }

  /**
   * 보트 이동 검사. pos: 지금 위치, next: 이번 프레임에 갈 위치 [x, z], dir: 움직이는 방향, h: 내 뱃머리 방향.
   * cap — 다가가는 중이면 선체 사이 틈에 따라 줄인 최고 속력 / bump — 이번 걸음에 선체가 닿음
   * 닿은 채 **멀어지는** 쪽으로는 막지 않습니다 — 안 그러면 붙은 보트끼리 빠져나오지 못합니다.
   */
  function boatContact(pos, next, dir, h) {
    var cap = Infinity, bump = false, H = hull();
    boats().forEach(function (b) {
      var vx = b.x - pos[0], vz = b.z - pos[2], dNow = Math.hypot(vx, vz);
      if (dNow < 0.01 || dNow > SLOW_GAP + 2 * (H.l + H.w)) return;
      var ux = vx / dNow, uz = vz / dNow;
      // 선체 가장자리 사이의 틈 — 서로를 향한 쪽의 반지름을 뺍니다 (뱃머리끼리면 길고, 옆구리끼리면 짧습니다)
      var gap = dNow - hullRadius(h, ux, uz, H) - hullRadius(b.h, -ux, -uz, H);
      var dNext = Math.hypot(b.x - next[0], b.z - next[1]);
      if (dNext < dNow && hullsOverlap(next[0], next[1], h, b.x, b.z, b.h, H)) bump = true;
      if (gap < SLOW_GAP) {
        var approach = ux * dir[0] + uz * dir[2];              // 1 = 정면으로 다가감
        var side = Math.abs(vx * dir[2] - vz * dir[0]);        // 이대로 가면 옆으로 얼마나 비껴가나
        if (approach > 0.3 && side < H.l + H.w + 1) {          // 스쳐 지나가는 보트 때문에 느려지지는 않게
          cap = Math.min(cap, 0.5 + Math.max(0, gap) / SLOW_GAP * 6);
        }
      }
    });
    return { cap: cap, bump: bump };
  }

  /* ---------------- game.js 가 부르는 곳 ---------------- */

  root.DopaMulti = {
    tick: tick,
    others: others,
    castBlocked: castBlocked,
    boatContact: boatContact,
    hud: hud,
    isGuest: function () { return M.active && !M.host; },
    canTravel: function () {
      if (!M.active || M.host) return true;
      say('🌐 온라인에서는 방장만 낚시터를 옮길 수 있어요', 2.2); return false;
    },
    canSkipTime: function () {
      if (!M.active || M.host) return true;
      say('🌐 온라인에서는 방장만 시간을 넘길 수 있어요', 2.2); return false;
    },
    onRegion: function () {
      if (!M.active) return;
      placeBoat();
      if (M.host) sendEnv();
    },
    onCatch: function (rec) {
      if (!M.active) return;
      var st = M.sess[M.me] || (M.sess[M.me] = { n: 0, best: null });
      st.n++; if (!st.best || rec.len > st.best.len) st.best = { name: rec.name, len: rec.len };
      var T = M.tour, inTour = T && !T.done && now() < T.endsAt;
      if (inTour) addScore(M.me, rec.weight);
      gp.room.send({ k: 'c', n: rec.name, sp: rec.sp.id, len: r2(rec.len), w: r2(rec.weight), pts: rec.pts, t: inTour ? T.id : null });
      renderPanel();
    },
    openLobby: function () { gp.room.openLobby(LOBBY).catch(function () {}); }
  };
})(window);
