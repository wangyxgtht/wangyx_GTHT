/* ===================================================================
 * 净值分析台 · 内置指数运行时库
 * ---------------------------------------------------------------
 * 数据由 tools/fetch_indices.py 生成到 assets/indices.js，约 660KB，
 * 故意不写进 index.html、也不进 service worker 预缓存：
 * 用户第一次选择「内置指数」时才懒加载，手机首屏不背这个体积。
 * 对外：window.NAVApp.indexLib
 * =================================================================== */
(function (global) {
  'use strict';

  var NA = global.NAVApp = global.NAVApp || {};
  var loading = null;
  var groupsCache = null;

  function scriptVersion() {
    var list = document.getElementsByTagName('script');
    for (var i = 0; i < list.length; i++) {
      var src = list[i].src || '';
      if (src.indexOf('assets/bench.js') >= 0) {
        var m = src.match(/[?&]v=([0-9a-zA-Z]+)/);
        return m ? m[1] : '';
      }
    }
    return '';
  }

  /* 懒加载数据包；同一个 Promise 复用，失败后允许重试 */
  function ensure() {
    if (global.NAVApp.indexData) return Promise.resolve(global.NAVApp.indexData);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      var v = scriptVersion();
      el.src = 'assets/indices.js' + (v ? '?v=' + v : '');
      el.async = true;
      el.onload = function () {
        if (!global.NAVApp.indexData || !global.NAVApp.indexData.indices) {
          loading = null;
          reject(new Error('指数数据文件格式不对'));
          return;
        }
        resolve(global.NAVApp.indexData);
      };
      el.onerror = function () {
        loading = null;
        reject(new Error('指数数据加载失败，请确认 assets/indices.js 存在'));
      };
      document.head.appendChild(el);
    });
    return loading;
  }

  function ready() { return !!(global.NAVApp.indexData && global.NAVApp.indexData.indices); }

  function raw() { return ready() ? global.NAVApp.indexData.indices : []; }

  function updated() { return (global.NAVApp.indexData || {}).updated || ''; }

  function find(code) {
    var list = raw();
    code = String(code || '').toUpperCase();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].code).toUpperCase() === code) return list[i];
    }
    return null;
  }

  /* 同一条指数的价格 / 全收益两个版本 */
  function pair(code) {
    var src = find(code);
    if (!src) return null;
    var baseCode = src.tr ? src.base : src.code;
    var price = null, tr = null, list = raw();
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.tr) {
        if (r.base === baseCode) tr = r;
      } else if (r.code === baseCode) {
        price = r;
      }
    }
    return { base: baseCode, price: price, tr: tr };
  }

  /* 分组列表（保持数据文件里的顺序），供下拉框渲染 */
  function groups() {
    if (groupsCache) return groupsCache;
    var list = raw(), out = [], index = {};
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.tr) continue;                    // 全收益不单独占一行
      var g = r.group || '其他';
      if (!index[g]) {
        index[g] = { group: g, items: [] };
        out.push(index[g]);
      }
      var p = pair(r.code);
      index[g].items.push({
        code: r.code,
        name: r.name,
        count: r.ts.length,
        hasTr: !!(p && p.tr),
        updated: updated()
      });
    }
    groupsCache = out;
    return out;
  }

  function count(code, wantTr) {
    var p = pair(code);
    if (!p) return 0;
    var rec = wantTr ? p.tr : p.price;
    return rec ? rec.ts.length : 0;
  }

  /* 取出可直接喂给 metrics 的序列：[{ts: Date.UTC 毫秒, nav}] */
  function series(code, wantTr) {
    var p = pair(code);
    if (!p) return null;
    var rec = wantTr && p.tr ? p.tr : p.price;
    if (!rec) return null;
    if (!rec._ms) {
      var n = rec.ts.length, ms = new Array(n);
      for (var i = 0; i < n; i++) {
        var d = rec.ts[i];
        ms[i] = Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100);
      }
      rec._ms = ms;
    }
    return {
      code: rec.code,
      name: rec.name,
      tr: !!rec.tr,
      ts: rec._ms,
      nav: rec.nav,
      count: rec._ms.length,
      start: p.price ? p.price.ts[0] : rec.ts[0]
    };
  }

  /* 给下拉框用：带上口径后缀的显示名 */
  function label(code, wantTr) {
    var s = series(code, wantTr);
    if (!s) return '';
    return s.name;
  }

  NA.indexLib = {
    ensure: ensure,
    ready: ready,
    updated: updated,
    groups: groups,
    find: find,
    pair: pair,
    series: series,
    label: label,
    count: count
  };
})(window);
