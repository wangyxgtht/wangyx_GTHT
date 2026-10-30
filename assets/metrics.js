/* =========================================================
   metrics.js —— 绩效指标计算（纯函数，无 DOM 依赖）
   口径：年化按 365 日历天；波动率按识别出的净值频率年化
   ========================================================= */
(function (global) {
  'use strict';

  var NA = global.NAVApp = global.NAVApp || {};
  var DAY = 86400000;
  var YEAR_DAYS = 365;

  function mean(a) {
    if (!a.length) return NaN;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  function stdev(a) {
    if (a.length < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - m; s += d * d; }
    return Math.sqrt(s / (a.length - 1));
  }

  function dstr(ts) {
    var d = new Date(ts);
    return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  function utcOf(y, m, d) { return Date.UTC(y, m - 1, d); }

  function subMonths(ts, months) {
    var d = new Date(ts);
    var y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    var total = y * 12 + m - months;
    var ny = Math.floor(total / 12), nm = total % 12;
    var lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return utcOf(ny, nm + 1, Math.min(day, lastDay));
  }

  /* 取 <= target 的最后一个下标，找不到返回 -1 */
  function lastIdxAtOrBefore(ts, target) {
    var lo = 0, hi = ts.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (ts[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /* ---------------- 主计算 ---------------- */
  function compute(series, opts) {
    opts = opts || {};
    var rf = opts.rf != null ? opts.rf : 0.02;
    var from = opts.from != null ? opts.from : null;
    var to = opts.to != null ? opts.to : null;

    var ts = [], nav = [];
    for (var i = 0; i < series.ts.length; i++) {
      if (from !== null && series.ts[i] < from) continue;
      if (to !== null && series.ts[i] > to) continue;
      ts.push(series.ts[i]);
      nav.push(series.nav[i]);
    }

    var n = ts.length;
    if (n < 2) return { ok: false, error: '可用区间内的净值点不足 2 个' };

    var days = (ts[n - 1] - ts[0]) / DAY;
    var years = days / YEAR_DAYS;

    var totalReturn = nav[n - 1] / nav[0] - 1;
    var annualized = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : null;

    /* 期收益 */
    var r = [], rTs = [];
    for (var k = 1; k < n; k++) {
      r.push(nav[k] / nav[k - 1] - 1);
      rTs.push(ts[k]);
    }
    var nObs = r.length;

    var periodsPerYear = years > 0 ? nObs / years : 0;
    if (periodsPerYear < 1) periodsPerYear = 1;

    var sd = stdev(r);
    var annVol = isFinite(sd) ? sd * Math.sqrt(periodsPerYear) : null;

    var sharpe = (annualized !== null && annVol && annVol > 0) ? (annualized - rf) / annVol : null;

    /* 回撤 */
    var peak = nav[0], peakIdx = 0, maxDD = 0, ddPeakIdx = 0, ddTroughIdx = 0;
    var ddSeries = new Array(n), dd = 0;
    var longestGap = 0, lastHighTs = ts[0];
    for (var d2 = 0; d2 < n; d2++) {
      if (nav[d2] > peak) {
        if (ts[d2] - lastHighTs > longestGap) longestGap = ts[d2] - lastHighTs;
        peak = nav[d2];
        peakIdx = d2;
        lastHighTs = ts[d2];
      }
      dd = nav[d2] / peak - 1;
      ddSeries[d2] = dd;
      if (dd < maxDD) { maxDD = dd; ddPeakIdx = peakIdx; ddTroughIdx = d2; }
    }
    if (ts[n - 1] - lastHighTs > longestGap) longestGap = ts[n - 1] - lastHighTs;
    var longestUnderwater = longestGap / DAY;

    var recoverIdx = -1;
    var peakNav = nav[ddPeakIdx];
    for (var rc = ddTroughIdx + 1; rc < n; rc++) {
      if (nav[rc] >= peakNav) { recoverIdx = rc; break; }
    }
    var recoveryDays = recoverIdx > 0 ? Math.round((ts[recoverIdx] - ts[ddTroughIdx]) / DAY) : null;

    var calmar = (annualized !== null && maxDD < 0) ? annualized / Math.abs(maxDD) : null;

    /* 下行风险 */
    var neg = [];
    for (var nq = 0; nq < nObs; nq++) if (r[nq] < 0) neg.push(r[nq]);
    var downVol = null;
    if (neg.length >= 2) {
      var dsum = 0;
      for (var nv = 0; nv < neg.length; nv++) dsum += neg[nv] * neg[nv];
      downVol = Math.sqrt(dsum / neg.length) * Math.sqrt(periodsPerYear);
    }
    var sortino = (annualized !== null && downVol && downVol > 0) ? (annualized - rf) / downVol : null;

    /* 分布 */
    var posCount = 0, best = -Infinity, bestTs = null, worst = Infinity, worstTs = null;
    for (var pz = 0; pz < nObs; pz++) {
      if (r[pz] > 0) posCount++;
      if (r[pz] > best) { best = r[pz]; bestTs = rTs[pz]; }
      if (r[pz] < worst) { worst = r[pz]; worstTs = rTs[pz]; }
    }
    var positiveRatio = nObs ? posCount / nObs : null;

    var sorted = r.slice().sort(function (a, b) { return a - b; });
    var varIdx = Math.floor(0.05 * (sorted.length - 1));
    var var95 = sorted.length ? sorted[varIdx] : null;

    /* 区间收益 */
    var endTs = ts[n - 1];
    function retSince(targetTs) {
      var idx = lastIdxAtOrBefore(ts, targetTs);
      if (idx < 0) return null;
      return nav[n - 1] / nav[idx] - 1;
    }
    var endDate = new Date(endTs);
    var endYear = endDate.getUTCFullYear();

    var retM1 = retSince(subMonths(endTs, 1));
    var retM3 = retSince(subMonths(endTs, 3));
    var retM6 = retSince(subMonths(endTs, 6));
    var retY1 = retSince(subMonths(endTs, 12));
    var ytdBaseIdx = lastIdxAtOrBefore(ts, utcOf(endYear - 1, 12, 31));
    var retYTD = ytdBaseIdx >= 0 ? nav[n - 1] / nav[ytdBaseIdx] - 1 : null;

    /* 年度收益 */
    var yearMap = {}, yearOrder = [];
    for (var yi = 0; yi < n; yi++) {
      var y = new Date(ts[yi]).getUTCFullYear();
      if (!yearMap[y]) { yearMap[y] = { first: nav[yi], last: nav[yi], base: null }; yearOrder.push(y); }
      yearMap[y].last = nav[yi];
      // 该年之前的最后净值 -> 上年末基数
      var prevIdx = yi - 1;
      if (prevIdx >= 0) {
        var py = new Date(ts[prevIdx]).getUTCFullYear();
        if (py < y && yearMap[y].base === null) yearMap[y].base = nav[prevIdx];
      }
    }
    yearOrder.sort(function (a, b) { return a - b; });
    var annual = [];
    for (var ya = 0; ya < yearOrder.length; ya++) {
      var yy = yearOrder[ya], yd = yearMap[yy];
      var base = yd.base !== null ? yd.base : yd.first;
      annual.push({ year: yy, ret: base > 0 ? yd.last / base - 1 : null });
    }

    /* 月度收益矩阵 */
    var monthLast = {}, monthOrder = [];
    for (var mi = 0; mi < n; mi++) {
      var md = new Date(ts[mi]);
      var key = md.getUTCFullYear() * 100 + (md.getUTCMonth() + 1);
      if (!monthLast[key]) monthOrder.push(key);
      monthLast[key] = nav[mi];
    }
    monthOrder.sort(function (a, b) { return a - b; });
    var monthly = [];
    for (var mo = 0; mo < monthOrder.length; mo++) {
      var kk = monthOrder[mo];
      var prevKey = mo > 0 ? monthOrder[mo - 1] : null;
      var baseM = prevKey !== null ? monthLast[prevKey] : monthLast[kk];
      monthly.push({
        year: Math.floor(kk / 100),
        month: kk % 100,
        ret: baseM > 0 ? monthLast[kk] / baseM - 1 : null
      });
    }

    /* 图表序列 */
    var cum = new Array(n), ddPct = new Array(n), dates = new Array(n);
    for (var gi = 0; gi < n; gi++) {
      cum[gi] = nav[gi] / nav[0];
      ddPct[gi] = ddSeries[gi];
      dates[gi] = dstr(ts[gi]);
    }

    return {
      ok: true,
      n: n,
      nObs: nObs,
      days: days,
      years: years,
      periodsPerYear: periodsPerYear,
      startTs: ts[0],
      endTs: endTs,
      start: dstr(ts[0]),
      end: dstr(endTs),
      navStart: nav[0],
      navEnd: nav[n - 1],
      totalReturn: totalReturn,
      annualized: annualized,
      annVol: annVol,
      sharpe: sharpe,
      maxDD: maxDD,
      ddPeakDate: dstr(ts[ddPeakIdx]),
      ddTroughDate: dstr(ts[ddTroughIdx]),
      ddPeakNav: nav[ddPeakIdx],
      ddRecovered: recoverIdx > 0,
      ddRecoverDate: recoverIdx > 0 ? dstr(ts[recoverIdx]) : null,
      recoveryDays: recoveryDays,
      longestUnderwater: longestUnderwater,
      calmar: calmar,
      downVol: downVol,
      sortino: sortino,
      positiveRatio: positiveRatio,
      best: { ret: best, date: bestTs !== null ? dstr(bestTs) : null },
      worst: { ret: worst, date: worstTs !== null ? dstr(worstTs) : null },
      var95: var95,
      periods: { m1: retM1, m3: retM3, m6: retM6, ytd: retYTD, y1: retY1 },
      annual: annual,
      monthly: monthly,
      cum: cum,
      ddSeries: ddPct,
      dates: dates,
      ts: ts,
      nav: nav,
      r: r
    };
  }

  /* ---------------- 基准对齐 ---------------- */
  function alignBenchmark(product, bench) {
    if (!product || !bench) return null;
    var bmap = {};
    for (var i = 0; i < bench.ts.length; i++) bmap[bench.ts[i]] = bench.nav[i];
    var ts = [], pnav = [], bnav = [];
    for (var j = 0; j < product.ts.length; j++) {
      var t = product.ts[j];
      if (bmap[t] !== undefined && bmap[t] > 0) {
        ts.push(t); pnav.push(product.nav[j]); bnav.push(bmap[t]);
      }
    }
    if (ts.length < 2) return null;
    return {
      ts: ts,
      product: { ts: ts, nav: pnav },
      bench: { ts: ts, nav: bnav },
      points: ts.length
    };
  }

  NA.metrics = {
    compute: compute,
    alignBenchmark: alignBenchmark,
    dstr: dstr,
    subMonths: subMonths
  };
})(window);
