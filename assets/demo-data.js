/* =========================================================
   demo-data.js —— 内置演示数据（确定性生成，无任何网络请求）
   以「宽表」形态提供，直接走真实解析流程，便于验证解析器
   ========================================================= */
(function (global) {
  'use strict';

  var NA = global.NAVApp = global.NAVApp || {};

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normal(rand) {
    var u = rand() || 1e-9;
    var v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function dates() {
    var out = [];
    var d = Date.UTC(2019, 0, 4); // 2019-01-04 周五
    var end = Date.UTC(2026, 8, 25);
    while (d <= end) {
      var dt = new Date(d);
      out.push(dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()));
      d += 7 * 86400000;
    }
    return out;
  }

  function gen(seed, cfg) {
    var rand = mulberry32(seed);
    var nav = 1;
    var arr = [];
    for (var i = 0; i < cfg.n; i++) {
      var r = cfg.drift + cfg.vol * normal(rand);
      // 人为制造两段回撤行情
      if (cfg.crash && i >= cfg.crash[0] && i <= cfg.crash[0] + cfg.crash[1]) r += cfg.crash[2];
      if (cfg.boom && i >= cfg.boom[0] && i <= cfg.boom[0] + cfg.boom[1]) r += cfg.boom[2];
      if (r < -0.07) r = -0.07 + (r + 0.07) * 0.25;
      nav *= (1 + r);
      arr.push(nav);
    }
    return arr;
  }

  var cache = null;

  function build() {
    if (cache) return cache;
    var ds = dates();
    var n = ds.length;
    var steady = gen(20240118, { n: n, drift: 0.0021, vol: 0.0105, crash: [128, 16, -0.0095], boom: [300, 22, 0.0045] });
    var growth = gen(88771, { n: n, drift: 0.0030, vol: 0.0195, crash: [126, 18, -0.0165], boom: [300, 26, 0.0085] });
    var bench = gen(13579, { n: n, drift: 0.0006, vol: 0.0245, crash: [124, 20, -0.0135], boom: [301, 24, 0.0095] });

    var rows = [['净值日期', '稳健配置一号', '成长精选二号']];
    for (var i = 0; i < n; i++) {
      rows.push([ds[i], +steady[i].toFixed(4), +growth[i].toFixed(4)]);
    }
    cache = { rows: rows, dates: ds, bench: bench };
    return cache;
  }

  NA.demo = {
    fileName: '演示数据（内置）',
    rows: function () { return build().rows; },
    benchmark: function () {
      var b = build();
      var ts = [], nav = [], labels = [];
      for (var i = 0; i < b.dates.length; i++) {
        var d = new Date(b.dates[i] + 'T00:00:00Z');
        ts.push(d.getTime());
        nav.push(+b.bench[i].toFixed(4));
        labels.push(b.dates[i]);
      }
      return { name: '沪深300（演示基准）', ts: ts, nav: nav, labels: labels, count: ts.length };
    }
  };
})(window);
