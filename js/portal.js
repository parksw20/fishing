/* DopaMax 포탈 연동
 *
 * 포탈 밖(파일로 바로 열기)에서는 GamePortal 이 없으므로 **아무 일도 하지 않습니다.**
 * 게임 동작이 포탈 유무에 따라 갈리면 로컬에서 재현 안 되는 버그가 생깁니다.
 *
 * ready() 를 부르는 이유는 두 가지입니다.
 *   · 닉네임·아바타가 이때 옵니다 (그전에는 비어 있습니다)
 *   · 세션 핸드셰이크가 끝나야 플레이 시간이 인정되기 시작합니다 — 이걸 안 부르면
 *     아무리 오래 놀아도 크리에이터 포인트가 쌓이지 않습니다
 *
 * 점수는 아직 올리지 않습니다. 포탈은 **한 세션에 점수 1개**만 받고 제출하는 순간 세션이
 * 끝나는데(그 뒤로는 플레이 시간도 안 쌓입니다), 이 게임은 끝이 없어서 "언제 낼지" 가
 * 정해지지 않습니다. 랭킹을 붙이려면 제출 직후 newSession() 으로 세션을 새로 받아야 합니다.
 */
(function () {
  var gp = window.GamePortal;
  if (!gp) return;

  gp.ready().then(function (r) {
    var p = r && r.player;
    if (p && p.nickname) window.DOPA_PLAYER = { nickname: p.nickname, avatarUrl: p.avatarUrl || null };
  }).catch(function () {});
})();
