/* ===================================================================
 * 净值分析台 · 多产品业绩对比引擎
 * ---------------------------------------------------------------
 * 纯计算，无 DOM 依赖。负责：
 *   1) 档案解析缓存（同一档案反复勾选不重复解析）
 *   2) 交集对齐与两种归一（共同区间 / 各自起点）
 *   3) 指标横排、各列最优标记
 *   4) 超额曲线（相对第一只 / 相对基准）
 *   5) Pearson 相关性矩阵、多产品月度收益矩阵
 * 对外：window.NAVApp.compare
 * =================================================================== */
(function (global) {
  'use strict';

  var NA = global.NAVApp = global.NAVApp || {};
  var P = NA.parser, M = NA.metrics;

  var COLORS = ['#2E6FA7', '#C0392B', '#D89A2A', '#1E7B4F', '#7A6FA8', '#4C8FCB'];
  var MAX_ITEMS = 6;
  var MIN_COMMON = 30;

  /* 指标列定义：dir=1 越大越好，dir=-1 越小越好 */
  var COLS = [
    { key: 'totalReturn', label: '累计收益', fmt: 'pct', dir: 1 },
    { key: 'annualized', label: '年化收益', fmt: 'pct', dir: 1, sort: true },
    { key: 'annVol', label: '年化波动', fmt: 'pct', dir: -1 },
    { key: 'sharpe', label: '夏普', fmt: 'ratio', dir: 1 },
    { key: 'calmar', label: '卡玛', fmt: 'ratio', dir: 1 },
    { key: 'sortino', label: '索提诺', fmt: 'ratio', dir: 1 },
    { key: 'maxDD', label: '最大回撤', fmt: 'pct', dir: 1 },
    { key: 'recoveryDays', label: '修复天数', fmt: 'days', dir: -1 },
    { key: 'longestUnderwater', label: '最长水下', fmt: 'days', dir: -1 }
  ];

  var PERIOD_COLS = [
    { key: 'm1', label: '近 1 月' },
    { key: 'm3', label: '近 3 月' },
    { key: 'm6', label: '近 6 月' },
    { key: 'ytd', label: '今年来' },
    { key: 'y1', label: '近 1 年' }
  ];

  /* ---------------- 档案解析缓存 ---------------- */
  var cache = {};   // key -> {products:[{name,count,ts,nav,labels}], error, fileName, sheets}

  function recKey(rec) {
    return (rec.source || 'disk') + '|' + (rec.name || '') + '|' + (rec.savedAt || 0);
  }

  function loadArchive(rec) {
    var key = recKey(rec);
    if (cache[key]) return Promise.resolve(cache[key]);
    return NA.archive.loadBytes(rec).then(function (bytes) {
      var buf = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
      var parsed = P.parseFile(buf, rec.name);
      var products = [], sName = '';
      for (var i = 0; i < parsed.sheets.length; i++) {
        var r = P.analyze(parsed.sheets[i].rows, {});
        if (r.ok && r.products.length) {
          if (!products.length) sName = parsed.sheets[i].name;
          products = products.concat(r.products);
        }
      }
      var out = { ok: products.length > 0, products: products, fileName: parsed.fileName || rec.name, sheet: sName };
      if (!out.ok) out.error = '这个档案里没找到净值序列';
      cache[key] = out;
      return out;
    }).catch(function (e) {
      var out = { ok: false, products: [], error: (e && e.message) ? e.message : String(e) };
      cache[key] = out;
      return out;
    });
  }

  function clearCache() { cache = {}; }

  /* ---------------- 对齐与归一 ---------------- */
  function navMap(series) {
    var m = {};
    for (var i = 0; i < series.ts.length; i++) m[series.ts[i]] = series.nav[i];
    return m;
  }

  function intersect(items) {
    if (!items.length) return [];
    var maps = items.map(function (it) { return navMap(it.series); });
    var base = items[0].series.ts;
    var out = [];
    for (var i = 0; i < base.length; i++) {
      var t = base[i], ok = true;
      for (var j = 1; j < maps.length; j++) {
        if (maps[j][t] === undefined) { ok = false; break; }
      }
      if (ok) out.push(t);
    }
    return out;
  }

  /* 让每条序列在给定日期集合上归一，返回 [{ts, cum, nav}] */
  function normalizeOn(items, dates) {
    return items.map(function (it) {
      var map = navMap(it.series);
      var first = map[dates[0]];
      var cum = new Array(dates.length), nav = new Array(dates.length);
      for (var i = 0; i < dates.length; i++) {
        nav[i] = map[dates[i]];
        cum[i] = first > 0 ? nav[i] / first : null;
      }
      return { ts: dates, nav: nav, cum: cum };
    });
  }

  function normalizeOwn(items) {
    return items.map(function (it) {
      var s = it.series, first = s.nav[0];
      var cum = new Array(s.nav.length);
      for (var i = 0; i < s.nav.length; i++) cum[i] = first > 0 ? s.nav[i] / first : null;
      return { ts: s.ts, nav: s.nav, cum: cum };
    });
  }

  /* ---------------- 相关性 ---------------- */
  function returnsOn(dates, navs) {
    var r = [];
    for (var i = 1; i < dates.length; i++) {
      r.push(navs[i - 1] > 0 ? navs[i] / navs[i - 1] - 1 : 0);
    }
    return r;
  }

  function pearson(a, b) {
    var n = Math.min(a.length, b.length);
    if (n < 3) return null;
    var sa = 0, sb = 0, i;
    for (i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
    var ma = sa / n, mb = sb / n;
    var cov = 0, va = 0, vb = 0;
    for (i = 0; i < n; i++) {
      var da = a[i] - ma, db = b[i] - mb;
      cov += da * db; va += da * da; vb += db * db;
    }
    if (va <= 0 || vb <= 0) return null;
    return cov / Math.sqrt(va * vb);
  }

  function corrMatrix(items, aligned) {
    var labels = items.map(function (it) { return it.label; });
    var rets = aligned.map(function (a) { return returnsOn(a.ts, a.nav); });
    var n = items.length;
    var matrix = [];
    for (var i = 0; i < n; i++) {
      var row = [];
      for (var j = 0; j < n; j++) {
        row.push(i === j ? 1 : (j < i ? matrix[j][i] : pearson(rets[i], rets[j])));
      }
      matrix.push(row);
    }
    return { labels: labels, matrix: matrix, n: rets.length ? rets[0].length : 0 };
  }

  /* ---------------- 月度矩阵 ---------------- */
  function monthKey(y, m) {
    return y + '-' + (m < 10 ? '0' + m : '' + m);
  }

  function heatMatrix(items, monthsBack) {
    var keys = {}, order = [];
    items.forEach(function (it) {
      var m = it.metrics;
      if (!m || !m.monthly) return;
      m.monthly.forEach(function (x) {
        var k = monthKey(x.year, x.month);
        if (!keys[k]) { keys[k] = {}; order.push(k); }
        keys[k][it.key] = x.ret;
      });
    });
    order.sort();
    var months = order.slice(-(monthsBack || 18));
    var rows = items.map(function (it) {
      return {
        key: it.key,
        label: it.label,
        values: months.map(function (k) {
          var v = keys[k] && keys[k][it.key];
          return (v === undefined) ? null : v;
        })
      };
    });
    return { months: months, rows: rows };
  }

  /* ---------------- 最优列标记 ---------------- */
  function bestOf(items) {
    var best = {};
    COLS.forEach(function (c) {
      var win = null, winVal = null;
      items.forEach(function (it) {
        var v = it.metrics ? it.metrics[c.key] : null;
        if (v === null || v === undefined || !isFinite(v)) return;
        if (winVal === null || (c.dir > 0 ? v > winVal : v < winVal)) { winVal = v; win = it.key; }
      });
      if (win !== null) best[c.key] = win;
    });
    return best;
  }

  /* ---------------- 主构建 ---------------- */
  /**
   * items: [{key, label, name, color, rec, productIdx, series:{ts,nav,labels}}]
   * opts:  {rf, align:'common'|'own', baseline:'first'|'bench', bench:{ts,nav,name}}
   */
  function build(items, opts) {
    var o = opts || {};
    items = (items || []).slice(0, MAX_ITEMS);
    if (items.length < 2) {
      return { ok: false, reason: 'need-more', message: '至少勾选 2 只产品才能对比' };
    }

    var warnings = [];
    var withMetrics = items.map(function (it, idx) {
      var m = M.compute({ ts: it.series.ts, nav: it.series.nav }, { rf: o.rf });
      if (!m.ok) {
        warnings.push(it.label + '：' + (m.error || '无法计算指标'));
      }
      return {
        key: it.key, label: it.label, name: it.name, color: it.color || COLORS[idx % COLORS.length],
        rec: it.rec, productIdx: it.productIdx, series: it.series, metrics: m.ok ? m : null
      };
    }).filter(function (it) {
      if (!it.metrics) return false;
      return true;
    });

    if (withMetrics.length < 2) {
      return { ok: false, reason: 'need-more', message: '可用的产品不足 2 只（有的档案解析失败）', warnings: warnings };
    }

    // 对齐
    var align = (o.align === 'own') ? 'own' : 'common';
    var dates, aligned;
    if (align === 'own') {
      aligned = normalizeOwn(withMetrics);
      var allTs = {};
      aligned.forEach(function (a) { a.ts.forEach(function (t) { allTs[t] = 1; }); });
      dates = Object.keys(allTs).map(Number).sort(function (a, b) { return a - b; });
    } else {
      dates = intersect(withMetrics);
      if (dates.length < 2) {
        return {
          ok: false, reason: 'no-overlap', message: '所选产品没有共同的净值日期，无法对比（可切换为「各自起点」看走势）',
          warnings: warnings
        };
      }
      aligned = normalizeOn(withMetrics, dates);
      if (dates.length < MIN_COMMON) {
        warnings.push('共同区间只有 ' + dates.length + ' 个净值点，走势对比仅供参考');
      }
    }

    withMetrics.forEach(function (it, i) { it.aligned = aligned[i]; });

    // 排序：年化收益降序（指标缺失置底）
    withMetrics.sort(function (a, b) {
      var va = a.metrics ? a.metrics.annualized : -Infinity;
      var vb = b.metrics ? b.metrics.annualized : -Infinity;
      return vb - va;
    });

    // 叠加图序列（time 轴）
    var overlay = {
      names: withMetrics.map(function (it) { return it.label; }),
      colors: withMetrics.map(function (it) { return it.color; }),
      series: withMetrics.map(function (it) {
        var pts = [];
        for (var i = 0; i < it.aligned.ts.length; i++) pts.push([it.aligned.ts[i], it.aligned.cum[i]]);
        return { name: it.label, color: it.color, data: pts };
      })
    };

    // 超额：基线
    var baseName = '', baseCum = null;
    if (o.baseline === 'bench' && o.bench && o.bench.ts && o.bench.ts.length) {
      var bmap = navMap(o.bench);
      var bdates = align === 'own' ? o.bench.ts.slice() : dates.slice();
      // 只在产品交集日期上取基准
      var usable = bdates.filter(function (t) { return bmap[t] !== undefined; });
      if (usable.length >= 5) {
        var first = bmap[usable[0]];
        baseCum = { ts: usable, cum: usable.map(function (t) { return first > 0 ? bmap[t] / first : null; }) };
        baseName = o.bench.name || '基准';
      } else {
        warnings.push('基准与产品的共同日期不足，已退回「相对第一只产品」');
      }
    }
    if (!baseCum) {
      baseName = withMetrics[0].label;
      baseCum = { ts: withMetrics[0].aligned.ts, cum: withMetrics[0].aligned.cum };
    }

    var bMap = navMap({ ts: baseCum.ts, nav: baseCum.cum });
    var excess = { baseName: baseName, series: [] };
    withMetrics.forEach(function (it) {
      if (it.label === baseName) return;
      var pts = [];
      for (var i = 0; i < it.aligned.ts.length; i++) {
        var t = it.aligned.ts[i];
        if (bMap[t] === undefined || !bMap[t]) continue;
        pts.push([t, it.aligned.cum[i] / bMap[t] - 1]);
      }
      if (pts.length > 1) excess.series.push({ name: it.label, color: it.color, data: pts });
    });

    // 区间收益
    var period = {
      cats: PERIOD_COLS.map(function (c) { return c.label; }),
      series: withMetrics.map(function (it) {
        return {
          name: it.label, color: it.color,
          data: PERIOD_COLS.map(function (c) {
            var v = it.metrics.periods ? it.metrics.periods[c.key] : null;
            return (v === null || v === undefined || !isFinite(v)) ? null : v;
          })
        };
      })
    };

    var best = bestOf(withMetrics);
    var corr = align === 'own' ? null : corrMatrix(withMetrics, aligned);
    var heat = heatMatrix(withMetrics, 18);

    return {
      ok: true,
      align: align,
      items: withMetrics,
      cols: COLS,
      periodCols: PERIOD_COLS,
      best: best,
      overlay: overlay,
      excess: excess,
      period: period,
      corr: corr,
      heat: heat,
      start: M.dstr(dates[0]),
      end: M.dstr(dates[dates.length - 1]),
      startTs: dates[0],
      endTs: dates[dates.length - 1],
      points: dates.length,
      warnings: warnings
    };
  }

  NA.compare = {
    MAX_ITEMS: MAX_ITEMS,
    COLORS: COLORS,
    COLS: COLS,
    PERIOD_COLS: PERIOD_COLS,
    loadArchive: loadArchive,
    clearCache: clearCache,
    recKey: recKey,
    build: build
  };
})(window);
