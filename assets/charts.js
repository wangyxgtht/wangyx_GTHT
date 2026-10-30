/* =========================================================
   charts.js —— ECharts 主题与四张图表
   ========================================================= */
(function (global) {
  'use strict';

  var NA = global.NAVApp = global.NAVApp || {};
  var C = {
    primary: '#16324F',
    primary2: '#2E6FA7',
    primary3: '#4C8FCB',
    up: '#C0392B',
    down: '#1E7B4F',
    grid: '#EDF2F7',
    axis: '#8A98A6',
    ink: '#12212F'
  };

  var instances = {};
  var themeReady = false;

  function registerTheme() {
    if (themeReady || !global.echarts) return;
    global.echarts.registerTheme('navPro', {
      color: [C.primary2, '#C0392B', '#4C8FCB', '#D89A2A', '#1E7B4F', '#7A6FA8'],
      backgroundColor: 'transparent',
      textStyle: { fontFamily: '"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif', color: C.ink, fontSize: 12 },
      title: { textStyle: { color: C.primary, fontSize: 13, fontWeight: 600 } },
      legend: { textStyle: { color: '#4A5A6A', fontSize: 11.5 }, itemWidth: 14, itemHeight: 8, itemGap: 14 },
      grid: { left: 8, right: 14, top: 34, bottom: 8, containLabel: true },
      tooltip: {
        backgroundColor: 'rgba(255,255,255,.97)',
        borderColor: '#E3EAF1',
        borderWidth: 1,
        padding: [9, 12],
        textStyle: { color: C.ink, fontSize: 12 },
        extraCssText: 'box-shadow:0 10px 28px rgba(16,33,51,.13);border-radius:10px;'
      },
      categoryAxis: {
        axisLine: { show: true, lineStyle: { color: '#DDE7F0' } },
        axisTick: { show: false },
        axisLabel: { color: C.axis, fontSize: 11 },
        splitLine: { show: false }
      },
      valueAxis: {
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: C.axis, fontSize: 11 },
        splitLine: { lineStyle: { color: C.grid, type: 'solid' } }
      }
    });
    themeReady = true;
  }

  function getEl(el) {
    if (typeof el === 'string') return document.getElementById(el);
    return el;
  }

  /* 首次绘制给足入场动画；已有内容的原地更新只保留极短过渡，避免切换勾选时闪烁 */
  function animOf(ch, firstMs) {
    var o = (ch && ch.getOption) ? ch.getOption() : null;
    var drawn = !!(o && o.series && o.series.length);
    return drawn ? 160 : firstMs;
  }

  function chartOf(el, forceNew) {
    var dom = getEl(el);
    if (!dom) return null;
    var key = dom.id || ('c' + Math.random());
    if (forceNew && instances[key]) {
      instances[key].dispose();
      instances[key] = null;
    }
    if (!instances[key]) {
      registerTheme();
      instances[key] = global.echarts.init(dom, 'navPro', { renderer: 'canvas' });
      dom.setAttribute('data-inited', '1');
    }
    return instances[key];
  }

  function pct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v * 100).toFixed(digits === undefined ? 2 : digits) + '%';
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shortDate(s) {
    return s && s.length >= 10 ? s.slice(2) : s;
  }

  /* ---------------- 净走势 ---------------- */
  function renderNav(el, data) {
    var ch = chartOf(el, true);
    if (!ch) return;
    var series = [{
      name: data.name || '产品',
      type: 'line',
      data: data.cum,
      showSymbol: false,
      symbol: 'circle',
      symbolSize: 5,
      smooth: false,
      sampling: 'lttb',
      lineStyle: { width: 1.9, color: C.primary2 },
      itemStyle: { color: C.primary2 },
      areaStyle: {
        opacity: 1,
        color: new global.echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(46,111,167,.20)' },
          { offset: 0.62, color: 'rgba(46,111,167,.05)' },
          { offset: 1, color: 'rgba(46,111,167,0)' }
        ])
      },
      emphasis: { focus: 'series', lineStyle: { width: 2.4 } },
      z: 4
    }];

    if (data.benchCum && data.benchCum.length === data.cum.length) {
      series.push({
        name: data.benchName || '基准',
        type: 'line',
        data: data.benchCum,
        showSymbol: false,
        smooth: false,
        sampling: 'lttb',
        lineStyle: { width: 1.4, color: '#98A8B8', type: 'dashed' },
        itemStyle: { color: '#98A8B8' },
        emphasis: { focus: 'series' },
        z: 3
      });
    }

    ch.setOption({
      animationDuration: 700,
      animationEasing: 'cubicOut',
      grid: { left: 6, right: 16, top: 36, bottom: 46, containLabel: true },
      legend: {
        show: data.benchCum ? true : false,
        top: 0,
        right: 0,
        icon: 'roundRect'
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: C.primary, fontSize: 10 }, crossStyle: { color: '#B9CBDA' }, lineStyle: { color: '#B9CBDA', type: 'dashed' } },
        formatter: function (ps) {
          var out = '<div style="font-size:11px;color:#8A98A6;margin-bottom:5px">' + esc(ps[0].axisValue) + '</div>';
          for (var i = 0; i < ps.length; i++) {
            var v = ps[i].data;
            if (v === null || v === undefined) continue;
            out += '<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">'
              + '<span>' + ps[i].marker + esc(ps[i].seriesName) + '</span>'
              + '<b style="font-variant-numeric:tabular-nums">' + v.toFixed(4)
              + ' <span style="color:' + (v >= 1 ? C.up : C.down) + '">(' + ((v - 1) * 100).toFixed(2) + '%)</span></b></div>';
          }
          return out;
        }
      },
      xAxis: {
        type: 'category',
        data: data.dates,
        boundaryGap: false,
        axisLabel: { formatter: shortDate, hideOverlap: true, color: C.axis, fontSize: 10.5 },
        axisPointer: { label: { formatter: function (o) { return o.value; } } }
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: function (v) { return v.toFixed(2); }, fontSize: 10.5 },
        splitNumber: 4
      },
      dataZoom: [
        { type: 'inside', throttle: 40 },
        {
          type: 'slider', height: 16, bottom: 6, borderColor: 'transparent',
          backgroundColor: '#F4F8FB', fillerColor: 'rgba(76,143,203,.14)',
          handleStyle: { color: '#fff', borderColor: C.primary3, borderWidth: 1.5, shadowBlur: 3, shadowColor: 'rgba(22,50,79,.18)' },
          dataBackground: { lineStyle: { color: '#C9D9E6' }, areaStyle: { color: '#EAF1F7' } },
          selectedDataBackground: { lineStyle: { color: C.primary3 }, areaStyle: { color: 'rgba(76,143,203,.15)' } },
          labelFormatter: function (v, s) { return s; },
          textStyle: { color: C.axis, fontSize: 10 }
        }
      ],
      series: series
    }, true);
  }

  /* ---------------- 回撤 ---------------- */
  function renderDD(el, data) {
    var ch = chartOf(el, true);
    if (!ch) return;
    var dd = [];
    for (var i = 0; i < data.dd.length; i++) dd.push(+(data.dd[i] * 100).toFixed(3));

    var series = [{
      name: '回撤',
      type: 'line',
      data: dd,
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.5, color: '#B4453A' },
      itemStyle: { color: '#B4453A' },
      areaStyle: {
        origin: 0,
        color: new global.echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(192,57,43,.03)' },
          { offset: 1, color: 'rgba(192,57,43,.22)' }
        ])
      },
      emphasis: { focus: 'series' }
    }];

    if (data.relative && data.relative.length === data.dd.length) {
      var rel = [];
      for (var r = 0; r < data.relative.length; r++) rel.push(+(data.relative[r] * 100).toFixed(3));
      series.push({
        name: '相对基准回撤',
        type: 'line',
        data: rel,
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 1.3, color: '#98A8B8', type: 'dashed' },
        itemStyle: { color: '#98A8B8' },
        emphasis: { focus: 'series' }
      });
    }

    ch.setOption({
      animationDuration: 600,
      grid: { left: 6, right: 16, top: 20, bottom: 22, containLabel: true },
      legend: { show: !!(data.relative && data.relative.length), top: 0, right: 0, icon: 'roundRect' },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#B9CBDA', type: 'dashed' } },
        formatter: function (ps) {
          var out = '<div style="font-size:11px;color:#8A98A6;margin-bottom:4px">' + esc(ps[0].axisValue) + '</div>';
          for (var i = 0; i < ps.length; i++) {
            if (ps[i].data === null || ps[i].data === undefined) continue;
            out += '<div style="line-height:1.7"><span style="color:' + (i === 0 ? '#B4453A' : '#98A8B8') + '">●</span> '
              + esc(ps[i].seriesName) + ' <b>' + ps[i].data.toFixed(2) + '%</b></div>';
          }
          return out;
        }
      },
      xAxis: {
        type: 'category', data: data.dates, boundaryGap: false,
        axisLabel: { formatter: shortDate, hideOverlap: true, fontSize: 10.5 }
      },
      yAxis: {
        type: 'value', max: 0,
        axisLabel: { formatter: '{value}%', fontSize: 10.5 },
        splitNumber: 3
      },
      series: series
    }, true);
  }

  /* ---------------- 年度收益 ---------------- */
  function renderAnnual(el, annual) {
    var ch = chartOf(el, true);
    if (!ch) return;
    var years = annual.map(function (d) { return String(d.year); });
    var vals = annual.map(function (d) { return d.ret === null ? null : +(d.ret * 100).toFixed(2); });

    ch.setOption({
      animationDuration: 700,
      grid: { left: 6, right: 12, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(76,143,203,.06)' } },
        formatter: function (ps) {
          var v = ps[0].data;
          if (v === null || v === undefined) return ps[0].axisValue + '：无数据';
          return '<div style="font-size:11px;color:#8A98A6;margin-bottom:4px">' + ps[0].axisValue + ' 年</div>'
            + '<b style="color:' + (v >= 0 ? C.up : C.down) + '">' + v.toFixed(2) + '%</b>';
        }
      },
      xAxis: { type: 'category', data: years, axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { formatter: '{value}%', fontSize: 10.5 }, splitNumber: 4 },
      series: [{
        type: 'bar',
        data: vals.map(function (v) {
          return {
            value: v,
            itemStyle: {
              borderRadius: v !== null && v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
              color: v === null ? '#DDE6EE' : (v >= 0
                ? new global.echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#D35446' }, { offset: 1, color: '#C0392B' }])
                : new global.echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#2E9A66' }, { offset: 1, color: '#1E7B4F' }]))
            }
          };
        }),
        barMaxWidth: 34,
        label: {
          show: true, position: 'top', fontSize: 10,
          color: '#7A8899',
          formatter: function (o) { return o.data.value === null ? '' : o.data.value.toFixed(1) + '%'; }
        }
      }]
    }, true);
  }

  /* ---------------- 月度热力图 ---------------- */
  function renderHeat(el, monthly) {
    var ch = chartOf(el, true);
    if (!ch) return;

    var years = [];
    var ySeen = {};
    var maxAbs = 0.5;
    var data = [];
    var lookup = {};

    for (var i = 0; i < monthly.length; i++) {
      var m = monthly[i];
      if (!ySeen[m.year]) { ySeen[m.year] = 1; years.push(m.year); }
      if (m.ret !== null && m.ret !== undefined) {
        lookup[m.year + '-' + m.month] = m.ret;
        maxAbs = Math.max(maxAbs, Math.abs(m.ret * 100));
      }
    }
    years.sort(function (a, b) { return a - b; });
    maxAbs = Math.min(30, Math.max(2, Math.ceil(maxAbs / 2) * 2));

    var monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    for (var yi = 0; yi < years.length; yi++) {
      for (var mi = 1; mi <= 12; mi++) {
        var v = lookup[years[yi] + '-' + mi];
        data.push({
          value: [mi - 1, yi, v === undefined ? null : +(v * 100).toFixed(2)],
          itemStyle: v === undefined ? { color: '#F2F5F8' } : null
        });
      }
    }

    var cellH = Math.max(16, Math.min(30, Math.floor(190 / Math.max(1, years.length))));

    ch.setOption({
      animationDuration: 500,
      grid: { left: 4, right: 10, top: 10, bottom: 34, containLabel: true },
      tooltip: {
        formatter: function (p) {
          var y = years[p.value[1]];
          var mo = p.value[0] + 1;
          if (p.value[2] === null || p.value[2] === undefined) return y + '年' + mo + '月：无数据';
          return '<div style="font-size:11px;color:#8A98A6;margin-bottom:4px">' + y + ' 年 ' + mo + ' 月</div>'
            + '<b style="color:' + (p.value[2] >= 0 ? C.up : C.down) + '">' + p.value[2].toFixed(2) + '%</b>';
        }
      },
      xAxis: {
        type: 'category', data: monthNames, splitArea: { show: false },
        axisLabel: { fontSize: 10.5 }, axisLine: { show: false }
      },
      yAxis: {
        type: 'category', data: years.map(String), splitArea: { show: false },
        axisLabel: { fontSize: 10.5 }, axisLine: { show: false }
      },
      visualMap: {
        min: -maxAbs, max: maxAbs,
        calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
        itemWidth: 10, itemHeight: 90,
        textStyle: { color: C.axis, fontSize: 10 },
        text: [maxAbs + '%', '-' + maxAbs + '%'],
        inRange: { color: ['#1E7B4F', '#5FA37F', '#F1F5F8', '#D98C80', '#C0392B'] }
      },
      series: [{
        type: 'heatmap',
        data: data,
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
        label: {
          show: years.length <= 9, fontSize: 9.5, color: '#43535F',
          formatter: function (p) { return (p.value[2] === null || p.value[2] === undefined) ? '' : p.value[2].toFixed(1); }
        },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(16,33,51,.18)' } }
      }]
    }, true);
  }

  /* ================= 多产品对比 ================= */
  function ts2ym(ts) {
    var d = new Date(ts);
    var y = d.getUTCFullYear() % 100, m = d.getUTCMonth() + 1;
    return (y < 10 ? '0' + y : y) + '-' + (m < 10 ? '0' + m : m);
  }

  function ts2date(ts) {
    var d = new Date(ts);
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  /* 净值叠加（time 轴，多产品） */
  function renderCompareNav(el, ov) {
    var ch = chartOf(el);
    if (!ch) return;
    var series = ov.series.map(function (s) {
      return {
        name: s.name,
        type: 'line',
        data: s.data,
        showSymbol: false,
        symbol: 'circle',
        symbolSize: 5,
        sampling: 'lttb',
        lineStyle: { width: 1.9, color: s.color },
        itemStyle: { color: s.color },
        emphasis: { focus: 'series' }
      };
    });
    ch.setOption({
      animationDuration: animOf(ch, 700),
      animationEasing: 'cubicOut',
      grid: { left: 6, right: 18, top: 36, bottom: 40, containLabel: true },
      legend: { top: 0, left: 'center', icon: 'roundRect', type: 'scroll', itemGap: 16 },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          lineStyle: { color: '#B9CBDA', type: 'dashed' },
          crossStyle: { color: '#B9CBDA' },
          label: { backgroundColor: '#16324F', fontSize: 10 }
        },
        formatter: function (ps) {
          if (!ps || !ps.length) return '';
          var head = '<div style="font-size:11px;color:#8A98A6;margin-bottom:5px">' + ts2date(ps[0].value[0]) + '</div>';
          var rows = ps.slice().sort(function (a, b) {
            var va = a.value && a.value[1], vb = b.value && b.value[1];
            return (vb || 0) - (va || 0);
          });
          var out = head;
          for (var i = 0; i < rows.length; i++) {
            var v = rows[i].value && rows[i].value[1];
            if (v === null || v === undefined) continue;
            var chg = (v - 1) * 100;
            out += '<div style="line-height:1.75;display:flex;gap:8px;align-items:baseline">'
              + '<span style="color:' + (rows[i].color || C.primary2) + '">●</span>'
              + '<span style="flex:1">' + esc(rows[i].seriesName) + '</span>'
              + '<b style="font-variant-numeric:tabular-nums">' + v.toFixed(4) + '</b>'
              + '<span style="color:' + (chg >= 0 ? C.up : C.down) + ';font-variant-numeric:tabular-nums">'
              + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span></div>';
          }
          return out;
        }
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#DDE7F0' } },
        axisLabel: { formatter: function (v) { return ts2ym(v); }, hideOverlap: true, fontSize: 10.5 },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: function (v) { return (+v).toFixed(2); }, fontSize: 10.5 },
        splitNumber: 4
      },
      dataZoom: [
        { type: 'inside', throttle: 60 },
        { type: 'slider', height: 16, bottom: 6, borderColor: '#E3EAF1', fillerColor: 'rgba(46,111,167,.10)',
          handleSize: 16, showDetail: false, brushSelect: false,
          textStyle: { fontSize: 10, color: C.axis } }
      ],
      series: series
    }, true);
  }

  /* 超额曲线（相对基线，0 轴参考） */
  function renderCompareExcess(el, ex) {
    var ch = chartOf(el);
    if (!ch) return;
    var series = ex.series.map(function (s) {
      return {
        name: s.name,
        type: 'line',
        data: s.data.map(function (p) { return [p[0], +(p[1] * 100).toFixed(4)]; }),
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 1.8, color: s.color },
        itemStyle: { color: s.color },
        emphasis: { focus: 'series' },
        markLine: s === ex.series[0] ? {
          silent: true, symbol: 'none',
          lineStyle: { color: '#C9D6E2', type: 'solid', width: 1 },
          label: { show: false },
          data: [{ yAxis: 0 }]
        } : undefined
      };
    });
    ch.setOption({
      animationDuration: animOf(ch, 600),
      grid: { left: 6, right: 18, top: 30, bottom: 18, containLabel: true },
      legend: { top: 0, left: 'center', icon: 'roundRect', type: 'scroll' },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#B9CBDA', type: 'dashed' } },
        formatter: function (ps) {
          if (!ps || !ps.length) return '';
          var out = '<div style="font-size:11px;color:#8A98A6;margin-bottom:5px">' + ts2date(ps[0].value[0]) + '</div>';
          for (var i = 0; i < ps.length; i++) {
            var v = ps[i].value[1];
            if (v === null || v === undefined) continue;
            out += '<div style="line-height:1.7"><span style="color:' + (ps[i].color || C.primary2) + '">●</span> '
              + esc(ps[i].seriesName) + ' <b style="color:' + (v >= 0 ? C.up : C.down) + '">'
              + (v >= 0 ? '+' : '') + v.toFixed(2) + '%</b></div>';
          }
          return out;
        }
      },
      xAxis: {
        type: 'time',
        axisLabel: { formatter: function (v) { return ts2ym(v); }, hideOverlap: true, fontSize: 10.5 }
      },
      yAxis: { type: 'value', scale: true, axisLabel: { formatter: '{value}%', fontSize: 10.5 }, splitNumber: 3 },
      series: series
    }, true);
  }

  /* 区间收益分组柱 */
  function renderComparePeriod(el, pd) {
    var ch = chartOf(el);
    if (!ch) return;
    var series = pd.series.map(function (s) {
      return {
        name: s.name,
        type: 'bar',
        data: s.data.map(function (v) { return (v === null || v === undefined) ? null : +(v * 100).toFixed(2); }),
        itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 26,
        emphasis: { focus: 'series' }
      };
    });
    ch.setOption({
      animationDuration: animOf(ch, 600),
      grid: { left: 6, right: 12, top: 30, bottom: 8, containLabel: true },
      legend: { top: 0, left: 'center', icon: 'roundRect', type: 'scroll' },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(76,143,203,.06)' } },
        formatter: function (ps) {
          if (!ps || !ps.length) return '';
          var out = '<div style="font-size:11px;color:#8A98A6;margin-bottom:5px">' + esc(ps[0].axisValue) + '</div>';
          ps.slice().sort(function (a, b) { return (b.data || -9) - (a.data || -9); }).forEach(function (p) {
            if (p.data === null || p.data === undefined) return;
            out += '<div style="line-height:1.7"><span style="color:' + p.color + '">●</span> '
              + esc(p.seriesName) + ' <b style="color:' + (p.data >= 0 ? C.up : C.down) + '">'
              + (p.data >= 0 ? '+' : '') + p.data.toFixed(2) + '%</b></div>';
          });
          return out;
        }
      },
      xAxis: { type: 'category', data: pd.cats, axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { formatter: '{value}%', fontSize: 10.5 }, splitNumber: 4 },
      series: series
    }, true);
  }

  /* 多产品月度收益热力图：行=产品，列=月份 */
  function renderCompareHeat(el, heat) {
    var ch = chartOf(el);
    if (!ch) return;
    var months = heat.months || [];
    var rows = heat.rows || [];
    var maxAbs = 2;
    rows.forEach(function (r) {
      r.values.forEach(function (v) {
        if (v !== null && v !== undefined) maxAbs = Math.max(maxAbs, Math.abs(v * 100));
      });
    });
    // 上限 60%：极端月份会压到饱和色，避免个别异常值把整张图冲淡
    maxAbs = Math.min(60, Math.max(2, Math.ceil(maxAbs / 2) * 2));

    var data = [];
    for (var ri = 0; ri < rows.length; ri++) {
      for (var ci = 0; ci < months.length; ci++) {
        var v = rows[ri].values[ci];
        var pv = (v === null || v === undefined) ? null : +(v * 100).toFixed(2);
        data.push({
          value: [ci, ri, pv],
          itemStyle: pv === null ? { color: '#F2F5F8' } : null,
          // 深色格用白字，浅色格用墨色，避免数字看不清
          label: pv === null ? { color: '#B4C0CC' } : { color: Math.abs(pv) >= maxAbs * 0.55 ? '#FFFFFF' : '#3B4A57' }
        });
      }
    }
    ch.setOption({
      animationDuration: animOf(ch, 500),
      grid: { left: 4, right: 10, top: 12, bottom: 40, containLabel: true },
      tooltip: {
        formatter: function (p) {
          var m = months[p.value[0]], r = rows[p.value[1]];
          if (p.value[2] === null || p.value[2] === undefined) return esc(r.label) + ' · ' + m + '：无数据';
          return '<div style="font-size:11px;color:#8A98A6;margin-bottom:4px">' + esc(r.label) + ' · ' + m + '</div>'
            + '<b style="color:' + (p.value[2] >= 0 ? C.up : C.down) + '">'
            + (p.value[2] >= 0 ? '+' : '') + p.value[2].toFixed(2) + '%</b>';
        }
      },
      xAxis: {
        type: 'category', data: months, axisLine: { show: false }, splitArea: { show: false },
        axisLabel: { fontSize: 10, rotate: months.length > 10 ? 40 : 0 }
      },
      yAxis: {
        type: 'category', data: rows.map(function (r) { return r.label; }),
        inverse: true,
        axisLine: { show: false }, splitArea: { show: false },
        axisLabel: { fontSize: 10.5, width: 90, overflow: 'truncate' }
      },
      visualMap: {
        min: -maxAbs, max: maxAbs, calculable: false, orient: 'horizontal',
        left: 'center', bottom: 0, itemWidth: 10, itemHeight: 80,
        textStyle: { color: C.axis, fontSize: 10 },
        text: [maxAbs + '%', '-' + maxAbs + '%'],
        inRange: { color: ['#1E7B4F', '#5FA37F', '#F1F5F8', '#D98C80', '#C0392B'] }
      },
      series: [{
        type: 'heatmap',
        data: data,
        itemStyle: { borderColor: '#fff', borderWidth: 1.5, borderRadius: 3 },
        label: {
          show: months.length <= 18 && rows.length <= 6,
          fontSize: 9.5,
          color: '#3B4A57',
          formatter: function (p) {
            return (p.value[2] === null || p.value[2] === undefined) ? '' : p.value[2].toFixed(1);
          }
        },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(16,33,51,.18)' } }
      }]
    }, true);
  }

  /* 相关性矩阵（N×N） */
  function renderCorr(el, corr) {
    var ch = chartOf(el);
    if (!ch) return;
    var labels = corr.labels || [];
    var data = [];
    for (var i = 0; i < labels.length; i++) {
      for (var j = 0; j < labels.length; j++) {
        var v = corr.matrix[i][j];
        data.push({
          value: [j, i, v === null ? null : +v.toFixed(3)],
          itemStyle: v === null ? { color: '#F2F5F8' } : null,
          // 深蓝底用白字，浅底用墨色
          label: v === null ? { color: '#B4C0CC' } : { color: v >= 0.58 ? '#FFFFFF' : '#2B3A47' }
        });
      }
    }
    ch.setOption({
      animationDuration: animOf(ch, 500),
      grid: { left: 4, right: 12, top: 10, bottom: 42, containLabel: true },
      tooltip: {
        formatter: function (p) {
          if (p.value[2] === null || p.value[2] === undefined) return '样本不足';
          return '<div style="font-size:11px;color:#8A98A6;margin-bottom:4px">'
            + esc(labels[p.value[1]]) + ' × ' + esc(labels[p.value[0]]) + '</div>'
            + '<b>' + p.value[2].toFixed(3) + '</b>';
        }
      },
      xAxis: {
        type: 'category', data: labels, position: 'bottom',
        axisLine: { show: false }, splitArea: { show: false },
        axisLabel: { fontSize: 10, interval: 0, rotate: labels.length > 3 ? 30 : 0, width: 72, overflow: 'truncate' }
      },
      yAxis: {
        type: 'category', data: labels, inverse: true,
        axisLine: { show: false }, splitArea: { show: false },
        axisLabel: { fontSize: 10, width: 84, overflow: 'truncate' }
      },
      visualMap: {
        min: 0, max: 1, calculable: false, orient: 'horizontal',
        left: 'center', bottom: 0, itemWidth: 10, itemHeight: 80,
        textStyle: { color: C.axis, fontSize: 10 },
        text: ['1.00', '0.00'],
        inRange: { color: ['#F1F5F8', '#BBD3E6', '#6FA3C9', '#2E6FA7', '#16324F'] }
      },
      series: [{
        type: 'heatmap',
        data: data,
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
        label: {
          show: true, fontSize: 11.5, fontWeight: 600,
          color: '#2B3A47',
          formatter: function (p) {
            return (p.value[2] === null || p.value[2] === undefined) ? '—' : p.value[2].toFixed(2);
          }
        }
      }]
    }, true);
  }

  function clear(el) {
    var dom = getEl(el);
    if (!dom) return;
    var inst = global.echarts.getInstanceByDom(dom);
    if (inst) inst.clear();
  }

  function resizeAll() {
    for (var k in instances) {
      if (instances[k] && !instances[k].isDisposed()) instances[k].resize();
    }
  }

  function png(el) {
    var dom = getEl(el);
    if (!dom) return null;
    var inst = global.echarts.getInstanceByDom(dom);
    if (!inst) return null;
    return inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
  }

  NA.charts = {
    renderNav: renderNav,
    renderDD: renderDD,
    renderAnnual: renderAnnual,
    renderHeat: renderHeat,
    renderCompareNav: renderCompareNav,
    renderCompareExcess: renderCompareExcess,
    renderComparePeriod: renderComparePeriod,
    renderCompareHeat: renderCompareHeat,
    renderCorr: renderCorr,
    resizeAll: resizeAll,
    png: png,
    clear: clear,
    pct: pct
  };
})(window);
