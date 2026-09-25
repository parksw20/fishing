/* 크기별 최대어 랭킹
 *
 * **한 판에 제일 큰 물고기 하나를 겨루면 고래가 다 이깁니다.** 붕어(42cm)를 아무리 잘
 * 잡아도 혹등고래(15m) 옆에서는 의미가 없어서, 작은 물고기를 노릴 이유가 사라집니다.
 * 그래서 **어종의 최대 크기로 등급을 나누고 등급 안에서 겨룹니다.**
 * 붕어 낚시는 붕어 낚시끼리, 참치는 참치끼리.
 *
 * 등급은 잡은 개체가 아니라 **그 어종이 자랄 수 있는 크기**(maxLen)로 정합니다. 개체
 * 크기로 나누면 큰 어종의 새끼가 소형어 판에 내려와 이기게 됩니다.
 *
 * 점수는 밀리미터입니다 — 포탈 점수는 정수라 cm 로 내면 소수점이 잘립니다.
 */
(function (root) {
  'use strict';

  // 경계는 어종 분포를 보고 정했습니다 (소형 6 · 중형 21 · 대형 14 · 초대형 12종)
  function classOf(sp) {
    var m = sp && sp.maxLen;
    if (!(m > 0)) return null;
    if (m < 0.5) return 'small';
    if (m < 1.0) return 'medium';
    if (m < 2.0) return 'large';
    return 'giant';
  }

  var TITLE = { small: '소형어', medium: '중형어', large: '대형어', giant: '초대형어' };

  root.Ranking = {
    classOf: classOf,
    title: function (k) { return TITLE[k] || ''; },

    /**
     * 지금까지의 어종별 최고 기록(G.best)에서 등급별 최대 길이를 뽑습니다.
     * 잡을 때마다 이걸 다시 계산하면, 기록이 어디서 깨지든 등급 최고가 항상 맞습니다 —
     * 따로 등급별 최고를 들고 다니면 세이브를 불러왔을 때 어긋납니다.
     */
    bestByClass: function (best) {
      var out = {};
      for (var id in best) {
        var rec = best[id];
        if (!rec || !rec.sp) continue;
        var k = classOf(rec.sp);
        if (!k) continue;
        if (!out[k] || rec.len > out[k]) out[k] = rec.len;
      }
      return out;
    },

    /** 새 기록이 나왔으면 그 등급만 올립니다 */
    report: function (best) {
      if (!root.DopaScore || !root.DopaScore.available()) return;
      var by = this.bestByClass(best);
      for (var k in by) root.DopaScore.submit(k, Math.round(by[k] * 1000));
    },
  };
})(typeof window !== 'undefined' ? window : this);
