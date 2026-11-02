/* =============================================================
   engine/story.js — 一件分の物語（task D）
   -------------------------------------------------------------
   「そのエージェントが何をしたのか分かりにくい」という報告への対応。
   板・台の札1枚（＝1つの jobId）に紐づくイベントを、時系列順に
   そのまま並べて返すだけの、純粋で小さな関数です。

   ★ 分からないことは描かない
     ここでは何も推測しない。meta.job が一致するイベントを、実際に
     ログにある分だけ、あった順番のまま返す。JOB（投稿）行が取得範囲
     より前で、この配列に無ければ、物語は単に CLAIM から始まる
     （＝「投稿した」を捏造して先頭に足したりしない）。

   ★ なぜ hud.js ではなくここに置くか
     「イベントの集合から、ある条件に合う部分列を取り出す」のは
     DOM もキャンバスも要らない計算なので、questlog.js / aggregate.js と
     同じ engine 層に置く。見た目（who/act/時刻/引用の組み立てと esc()）は
     render/hud.js の役目のまま（README の「実況と生ログの文面は hud.js」
     という約束を、物語パネルでも踏襲する）。
   ============================================================= */
(function (AQ) {
  'use strict';

  AQ.story = {
    /**
     * events   … questlog.load() 済みの正規化イベント配列（時系列順）。
     *            main.js の allEvents（＝集約前のログ全体）を渡す想定。
     * jobId    … 依頼ID（meta.job と文字列比較で一致させる）。
     * 戻り値   … その jobId に紐づくイベントだけを、元の順番のまま
     *            並べた配列（無ければ空配列。fabricate しない）。
     */
    forJob: function (events, jobId) {
      if (jobId == null) return [];
      var id = String(jobId);
      return (events || []).filter(function (e) {
        var m = e && e.meta;
        return !!m && m.job != null && String(m.job) === id;
      });
    }
  };

})(window.AQ = window.AQ || {});
