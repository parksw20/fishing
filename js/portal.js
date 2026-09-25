/* DopaMax 포탈 연동
 *
 * 포탈 밖(index.html 을 파일로 바로 열기)에서는 GamePortal 이 없으므로 **아무 일도 하지
 * 않습니다.** 게임 동작이 포탈 유무에 따라 갈리면 로컬에서 재현 안 되는 버그가 생깁니다.
 *
 * ready() 를 부르는 이유는 두 가지입니다.
 *   · 닉네임·아바타가 이때 옵니다 (그전에는 비어 있습니다)
 *   · 세션 핸드셰이크가 끝나야 플레이 시간이 인정되기 시작합니다 — 이걸 안 부르면
 *     아무리 오래 놀아도 크리에이터 포인트가 쌓이지 않습니다
 */
(function (root) {
  'use strict';

  var gp = root.GamePortal || null;

  if (gp) {
    gp.ready().then(function (r) {
      var p = r && r.player;
      if (p && p.nickname) root.DOPA_PLAYER = { nickname: p.nickname, avatarUrl: p.avatarUrl || null };
    }).catch(function () {});
  }

  /**
   * 점수 제출 줄서기.
   *
   * **포탈은 한 세션에 점수를 하나만 받고, 받는 순간 세션이 끝납니다.**
   * 그 뒤로는 하트비트도 거부돼서 플레이 시간이 안 쌓이고 다음 점수도 못 냅니다.
   * 끝이 없는 게임(낚시)이나 한 자리에서 여러 판을 두는 게임(체스·바둑)은 그래서
   * 낼 때마다 **곧바로 새 세션을 받아야** 합니다.
   *
   * 한 번에 하나씩만 보냅니다. 보드가 여럿일 때 동시에 쏘면 두 번째부터는 이미 끝난
   * 세션으로 가서 전부 버려집니다.
   *
   * 새 세션은 시작 직후 `min_play_seconds` 동안 점수를 안 받습니다(너무 빨리 낸 점수는
   * 거릅니다). 그래서 제출 사이에 여유를 둡니다 — 급할 것이 없습니다.
   */
  var GAP_MS = 15000;        // 제출 사이 최소 간격
  var pending = {};          // board -> 아직 못 보낸 값 (보드마다 제일 좋은 것만)
  var busy = false;
  var lastAt = 0;

  function flush() {
    if (busy || !gp) return;
    var boards = Object.keys(pending);
    if (!boards.length) return;

    var wait = Math.max(0, GAP_MS - (Date.now() - lastAt));
    if (wait > 0) { setTimeout(flush, wait + 50); return; }

    var board = boards[0];
    var value = pending[board];
    delete pending[board];
    busy = true;

    gp.submitScore(value, board ? { board: board } : undefined)
      .then(function (r) {
        // 거절당해도 되살리지 않습니다. 더 좋은 기록이 나오면 그때 다시 냅니다 —
        // 계속 재시도하면 같은 점수로 세션만 갈아치우게 됩니다.
        if (r && r.error) console.info('[DopaMax] 점수 거절:', r.error, board, value);
        // 세션을 새로 받아야 다음 점수도 내고 플레이 시간도 계속 쌓입니다
        return gp.newSession();
      })
      .catch(function () {})
      .then(function () {
        busy = false;
        lastAt = Date.now();
        if (Object.keys(pending).length) setTimeout(flush, GAP_MS + 50);
      });
  }

  root.DopaScore = {
    available: function () { return !!gp; },
    /** 같은 보드에 더 좋은 값이 오면 갈아탑니다 — 낮은 값을 굳이 보낼 이유가 없습니다 */
    submit: function (board, value) {
      if (!gp || !isFinite(value)) return;
      var v = Math.floor(value);
      if (v <= 0) return;
      var key = board || '';
      if (pending[key] === undefined || v > pending[key]) pending[key] = v;
      flush();
    },
  };
})(typeof window !== 'undefined' ? window : this);
