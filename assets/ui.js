/* =========================================================
   ui.js —— 交互、状态管理与渲染
   ========================================================= */
(function (global) {
  'use strict';

  var NA = global.NAVApp = global.NAVApp || {};
  var P = NA.parser, M = NA.metrics, CH = NA.charts, AR = NA.archive, CMP = NA.compare, IL = NA.indexLib;
  var DAY = 86400000;

  var state = {
    fileName: '',
    sheets: [],
    sheetIdx: 0,
    result: null,
    productIdx: 0,
    override: {},
    rf: 0.02,
    from: null,
    to: null,
    benchmark: null,
    benchName: '',
    benchCode: '',
    benchTr: false,
    benchSource: 'none',   // none | index | upload | demo
    metrics: null,
    benchM: null,
    prodAlignM: null,
    alignPoints: 0,
    alignExact: 0,
    alignAsOf: 0,
    alignSkipped: 0,
    alignStart: null,
    alignEnd: null,
    ddEpisodes: [],
    benchAligned: null,
    styleExp: null,
    demo: false,
    archiveMode: 'none',
    recentCount: 0,
    recentRows: [],
    lastArchive: null
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = String(txt);
    return e;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 格式化 ---------------- */
  function pct(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v * 100).toFixed(d === undefined ? 2 : d) + '%';
  }
  function ratio(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toFixed(d === undefined ? 2 : d);
  }
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toFixed(d === undefined ? 4 : d);
  }
  function signedCls(v) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    return v > 0 ? 'pos' : (v < 0 ? 'neg' : '');
  }
  function freqLabel(f) {
    if (!isFinite(f)) return '';
    if (f >= 180) return '日频';
    if (f >= 30) return '周频';
    if (f >= 8) return '月频';
    return '低频';
  }
  function dstr(ts) { return M.dstr(ts); }
  function dateToTs(s) {
    if (!s) return null;
    var p = s.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  /* ---------------- Toast / Busy ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }
  function busy(on, text) {
    var b = $('busy');
    if (text) $('busyText').textContent = text;
    b.hidden = !on;
  }

  /* ---------------- 文件载入 ---------------- */
  function handleFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls|csv|txt)$/i.test(file.name)) {
      toast('暂不支持该格式，请用 .xlsx / .xls / .csv');
      return;
    }
    busy(true, '正在读取文件…');
    var reader = new FileReader();
    reader.onload = function (e) {
      setTimeout(function () {
        try {
          busy(true, '正在识别表头与结构…');
          var parsed = P.parseFile(e.target.result, file.name);
          applyParsed(parsed, false);
          if (state.metrics) autoArchive(file, 'product');
        } catch (err) {
          busy(false);
          toast('解析失败：' + (err && err.message ? err.message : err));
        }
      }, 40);
    };
    reader.onerror = function () {
      busy(false);
      toast('文件读取失败，请重试');
    };
    reader.readAsArrayBuffer(file);
  }

  function applyParsed(parsed, isDemo) {
    clearMemSource(true);   // 换文件后旧的「本次文件」数据源作废
    state.fileName = parsed.fileName || '未命名文件';
    state.sheets = parsed.sheets || [];
    state.demo = !!isDemo;
    state.override = {};
    state.productIdx = 0;
    state.styleExp = null;
    // 换文件后预览表回到折叠态，避免旧表格误导
    if ($('previewBody')) {
      $('previewBody').hidden = true;
      if ($('btnPreviewToggle')) {
        $('btnPreviewToggle').textContent = '展开';
        $('btnPreviewToggle').setAttribute('aria-expanded', 'false');
      }
    }
    state.from = null;
    state.to = null;
    state.benchmark = null;
    state.benchName = '';
    state.benchCode = '';
    state.benchTr = false;
    state.benchSource = 'none';
    state.benchM = null;
    state.prodAlignM = null;
    state.alignPoints = 0;
    state.alignExact = 0;
    state.alignAsOf = 0;
    state.alignSkipped = 0;
    state.alignStart = null;
    state.alignEnd = null;

    var picked = -1, firstRes = null;
    for (var i = 0; i < state.sheets.length; i++) {
      var r = P.analyze(state.sheets[i].rows, {});
      if (r.ok) { picked = i; firstRes = r; break; }
      if (!firstRes) firstRes = r;
    }
    if (picked < 0) {
      busy(false);
      if ($('previewCard')) $('previewCard').hidden = true;
      toast((firstRes && firstRes.error) || '没有在这个文件里找到净值序列');
      return;
    }
    state.sheetIdx = picked;
    state.result = firstRes;

    showView('analyze');
    $('btnChangeFile').hidden = false;
    $('btnExportCsv').disabled = false;

    resetRangeInputs();
    renderMapping();

    if (isDemo) {
      state.benchmark = NA.demo.benchmark();
      state.benchName = state.benchmark.name;
      state.benchSource = 'demo';
    }

    busy(false);
    render(true);
    if (isDemo) toast('已载入演示数据，可直接拖入你自己的 Excel 覆盖');
  }

  function resetRangeInputs() {
    var p = state.result.products[0];
    var a = dstr(p.ts[0]), b = dstr(p.ts[p.ts.length - 1]);
    var f = $('rngFrom'), t = $('rngTo');
    f.min = a; f.max = b; f.value = a;
    t.min = a; t.max = b; t.value = b;
    state.from = null;
    state.to = null;
  }

  /* ---------------- 映射控件 ---------------- */
  function fillSelect(sel, items, value) {
    sel.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var o = document.createElement('option');
      o.value = String(items[i].value);
      o.textContent = items[i].label;
      sel.appendChild(o);
    }
    sel.value = String(value);
  }

  function renderMapping() {
    var res = state.result;
    if (!res) return;

    // 工作表
    var sheetItems = state.sheets.map(function (s, i) { return { value: i, label: s.name }; });
    fillSelect($('selSheet'), sheetItems, state.sheetIdx);

    // 产品
    var prodItems = res.products.map(function (p, i) {
      return { value: i, label: p.name + '（' + p.count + ' 点）' };
    });
    if (state.productIdx >= prodItems.length) state.productIdx = 0;
    fillSelect($('selProduct'), prodItems, state.productIdx);

    // 日期列
    var dateItems = res.columns.map(function (c) { return { value: c.index, label: c.label }; });
    fillSelect($('selDateCol'), dateItems, res.dateCol >= 0 ? res.dateCol : 0);

    // 净值列
    var navItems;
    if (res.structure === 'long') {
      navItems = res.columns.map(function (c) { return { value: c.index, label: c.label }; });
      fillSelect($('selNavCol'), navItems, res.navCol >= 0 ? res.navCol : 0);
    } else {
      navItems = [{ value: -1, label: '全部数值列（多产品）' }];
      var curNav = (state.override && state.override.navCol !== undefined) ? state.override.navCol : -1;
      res.columns.forEach(function (c) {
        if (c.index === res.dateCol) return;
        navItems.push({ value: c.index, label: c.label });
      });
      fillSelect($('selNavCol'), navItems, curNav === -1 ? -1 : curNav);
    }

    // 产品列（长表）
    var isLong = res.structure === 'long';
    $('selProdColWrap').hidden = !isLong;
    if (isLong) {
      var pItems = res.columns.map(function (c) { return { value: c.index, label: c.label }; });
      fillSelect($('selProdCol'), pItems, res.productCol >= 0 ? res.productCol : 0);
    }

    var sName = { wide: '宽表', long: '长表', single: '单序列' }[res.structure] || '已识别';
    $('mappingNote').textContent = '识别为「' + sName + '」'
      + (res.headerRow >= 0 ? '，表头在第 ' + (res.headerRow + 1) + ' 行' : '，未找到表头行')
      + '。识别有误可手动改，改完立即重算。';

    renderFilebar();
  }

  function renderFilebar() {
    var res = state.result;
    if (!res) return;
    var p = res.products[state.productIdx] || res.products[0];
    $('fbName').textContent = state.fileName;
    $('fbInfo').textContent = '工作表「' + state.sheets[state.sheetIdx].name + '」· '
      + p.name + ' · ' + dstr(p.ts[0]) + ' 至 ' + dstr(p.ts[p.ts.length - 1]);

    var tags = $('fbTags');
    tags.innerHTML = '';
    var sName = { wide: '宽表', long: '长表', single: '单序列' }[res.structure] || '已识别';
    tags.appendChild(el('span', 'tag', '结构 ' + sName));
    var t2 = el('span', 'tag');
    t2.innerHTML = '产品 <b>' + res.products.length + '</b> 个';
    tags.appendChild(t2);
    var t3 = el('span', 'tag');
    t3.innerHTML = '观测 <b>' + p.count + '</b> 点';
    tags.appendChild(t3);
    if (res.dropped && (res.dropped.bad || res.dropped.dup)) {
      tags.appendChild(el('span', 'tag warn', '清洗剔除 ' + (res.dropped.bad + res.dropped.dup) + ' 条'));
    }
    if (state.demo) tags.appendChild(el('span', 'tag', '演示数据'));
    if (state.lastArchive && state.lastArchive.fileName === state.fileName) {
      tags.appendChild(el('span', 'tag ok', '已存档 ' + AR.fmtTime(state.lastArchive.at)));
    }
    if (res.products.length > 1) {
      var cbtn = document.createElement('button');
      cbtn.type = 'button';
      cbtn.className = 'btn ghost sm fb-cmp-btn';
      cbtn.textContent = '本文件 ' + res.products.length + ' 只产品对比';
      cbtn.title = '不存档，直接把当前文件里的全部产品放进对比页';
      cbtn.addEventListener('click', compareCurrentFile);
      tags.appendChild(cbtn);
    }
  }

  /* ---------------- 主渲染 ---------------- */
  function render(animate) {
    if (!state.result) return;
    var p = state.result.products[state.productIdx] || state.result.products[0];
    var series = { ts: p.ts, nav: p.nav, labels: p.labels };

    var m = M.compute(series, { rf: state.rf, from: state.from, to: state.to });
    if (!m.ok) { toast(m.error); return; }
    state.metrics = m;
    // 回撤明细始终覆盖全部净值，不随区间选择缩水
    state.ddEpisodes = M.drawdownEpisodes(p.ts, p.nav, { top: 5 });

    state.benchM = null;
    state.prodAlignM = null;
    state.benchAligned = null;
    if (state.benchmark) {
      var al = M.alignBenchmark(series, state.benchmark, { toleranceDays: 10 });
      if (al) {
        var pmAl = M.compute({ ts: al.product.ts, nav: al.product.nav }, { rf: state.rf, from: state.from, to: state.to });
        var bmAl = M.compute({ ts: al.bench.ts, nav: al.bench.nav }, { rf: state.rf, from: state.from, to: state.to });
        if (pmAl.ok && bmAl.ok) {
          state.prodAlignM = pmAl;
          state.benchM = bmAl;
          state.alignPoints = al.points;
          state.alignExact = al.exact || 0;
          state.alignAsOf = al.asOf || 0;
          state.alignSkipped = al.skippedBefore || 0;
          state.alignStart = al.ts[0];
          state.alignEnd = al.ts[al.ts.length - 1];
          state.benchAligned = { ts: al.bench.ts, nav: al.bench.nav };
        } else {
          toast('所选区间内与基准的重叠点不足 2 个');
        }
      } else {
        toast('基准与产品没有可对齐的日期（可把区间往后调，指数数据自 2015 年起）');
      }
    }

    renderFilebar();
    renderKpis(m, animate);
    renderPeriods(m);
    renderDetail(m);
    renderDrawdownTable();
    renderBenchPanel();
    renderStylePanel();
    renderCharts(m);
    renderPreview();
  }

  /* ---------------- 回撤明细 ---------------- */
  function valAt(series, t) {
    if (!series || !series.ts || !series.ts.length) return null;
    var lo = 0, hi = series.ts.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (series.ts[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? series.nav[ans] : null;
  }

  function focusRange(fromTs, toTs) {
    var p = state.result.products[state.productIdx];
    var lo = p.ts[0], hi = p.ts[p.ts.length - 1];
    fromTs = Math.max(lo, Math.min(fromTs, hi));
    toTs = Math.max(lo, Math.min(toTs, hi));
    if (fromTs >= toTs) { toast('区间太短，无法聚焦'); return; }
    state.from = fromTs;
    state.to = toTs;
    $('rngFrom').value = dstr(fromTs);
    $('rngTo').value = dstr(toTs);
    render(false);
    toast('已聚焦 ' + dstr(fromTs) + ' 至 ' + dstr(toTs));
    var nav = $('chartNav');
    if (nav && nav.scrollIntoView) nav.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderDrawdownTable() {
    var card = $('ddTopCard');
    var tbody = $('ddTbody');
    if (!card || !tbody) return;
    var eps = state.ddEpisodes || [];
    if (!eps.length) {
      card.hidden = true;
      tbody.innerHTML = '';
      return;
    }
    card.hidden = false;
    tbody.innerHTML = '';
    var hasBench = !!(state.benchAligned && state.benchAligned.ts.length);
    var lastTs = state.result.products[state.productIdx].ts.slice(-1)[0];

    eps.forEach(function (e, i) {
      var tr = el('tr');
      tr.title = '点击聚焦 ' + e.peakDate + ' 至 ' + (e.recoverDate || dstr(lastTs));
      tr.appendChild(el('td', 'dd-idx', String(i + 1)));
      tr.appendChild(el('td', 'dd-range', e.peakDate + ' → ' + e.troughDate));
      tr.appendChild(el('td', 'num neg', pct(e.depth)));
      tr.appendChild(el('td', 'num', e.dropDays + ' 天'));
      tr.appendChild(el('td', e.ongoing ? 'dd-ongoing' : '',
        e.ongoing ? '未修复' : (e.recoverDate + '（' + e.recoverDays + ' 天）')));

      var btxt = '—';
      if (hasBench) {
        var v0 = valAt(state.benchAligned, e.peakTs);
        var v1 = valAt(state.benchAligned, e.troughTs);
        if (v0 > 0 && v1 > 0) btxt = pct(v1 / v0 - 1);
      }
      tr.appendChild(el('td', 'num', btxt));

      tr.addEventListener('click', function () {
        focusRange(e.peakTs, e.recoverTs || lastTs);
      });
      tbody.appendChild(tr);
    });
  }

  /* ---------------- 数据预览与列角色 ----------------
   * 表格直接读 parseFile 保留的原始 rows，列头下拉改「用途」后
   * 组装成 analyze 的 override（日期列 / 产品列 / 净值列 / 忽略列）立即重算。
   */
  var ROLE_OPTS = [
    { value: 'date', label: '日期' },
    { value: 'product', label: '产品名' },
    { value: 'nav', label: '净值' },
    { value: 'ignore', label: '忽略' }
  ];
  var PV_COLS = 12, PV_ROWS = 20;

  function previewRoles() {
    var res = state.result, roles = {};
    if (!res) return roles;
    var long = res.structure === 'long';
    res.columns.forEach(function (c) {
      var i = c.index;
      if (i === res.dateCol) roles[i] = 'date';
      else if (long && i === res.productCol) roles[i] = 'product';
      else if (long && i === res.navCol) roles[i] = 'nav';
      else if (!long && res.navCols && res.navCols.indexOf(i) >= 0) roles[i] = 'nav';
      else roles[i] = 'ignore';
    });
    return roles;
  }

  /* 角色 → override；失败返回 false 并提示 */
  function applyRoles(roles) {
    var res = state.result;
    if (!res) return false;
    var long = res.structure === 'long';
    var dateCol = -1, prodCol = -1, navs = [], ign = [];
    res.columns.forEach(function (c) {
      var role = roles[c.index];
      if (role === 'date' && dateCol < 0) dateCol = c.index;
      else if (role === 'product' && prodCol < 0) prodCol = c.index;
      else if (role === 'nav') navs.push(c.index);
      else ign.push(c.index);
    });
    if (dateCol < 0) { toast('至少要有一列标为「日期」'); return false; }
    if (!navs.length) { toast('至少要有一列标为「净值」'); return false; }
    if (long && prodCol < 0) { toast('长表至少要有一列标为「产品名」'); return false; }

    var ov = { dateCol: dateCol, mode: long ? 'long' : 'auto', ignoreCols: ign };
    if (long) {
      ov.productCol = prodCol;
      ov.navCol = navs[0];
      if (navs.length > 1) toast('长表只按一列净值分组，已使用「' + res.columns[navs[0]].label + '」');
    } else {
      ov.navCol = navs.length === 1 ? navs[0] : -1;
      ov.navCols = navs;
    }
    return applyOverride(ov);
  }

  /* 统一入口：应用 override → 保持分析对象 → 重置区间 → 重渲染 */
  function applyOverride(ov) {
    var prevName = (state.result && state.result.products[state.productIdx])
      ? state.result.products[state.productIdx].name : null;
    var r = P.analyze(state.sheets[state.sheetIdx].rows, ov);
    if (!r.ok) {
      toast(r.error);
      renderPreview();
      return false;
    }
    state.override = ov;
    state.result = r;
    var idx = -1;
    if (prevName) {
      for (var i = 0; i < r.products.length; i++) {
        if (r.products[i].name === prevName) { idx = i; break; }
      }
    }
    if (idx < 0 && prevName) toast('原分析对象不在新映射里，已切到「' + r.products[0].name + '」');
    state.productIdx = idx < 0 ? 0 : idx;
    state.styleExp = null;
    resetRangeInputs();
    renderMapping();
    render(false);
    return true;
  }

  function renderPreview() {
    var card = $('previewCard'), body = $('previewBody'), table = $('previewTable');
    var note = $('previewNote');
    if (!card || !body || !table) return;
    if (!state.result || !state.sheets.length) { card.hidden = true; return; }
    card.hidden = false;
    if (body.hidden) return;                    // 折叠时不动 DOM，避免输入失焦

    var sheet = state.sheets[state.sheetIdx];
    var rows = (sheet && sheet.rows) || [];
    var res = state.result;
    var roles = previewRoles();
    var cols = res.columns.slice(0, PV_COLS);
    var start = res.headerRow >= 0 ? res.headerRow + 1 : 0;

    table.innerHTML = '';
    var thead = document.createElement('thead');
    var trHead = document.createElement('tr');
    var trRole = document.createElement('tr');
    cols.forEach(function (c) {
      var role = roles[c.index];
      var th = el('th', 'pv-head' + (role === 'date' ? ' pv-date-col' : (role === 'product' ? ' pv-prod-col' : '')));
      th.textContent = c.label;
      th.title = c.label + '（第 ' + (c.index + 1) + ' 列）';
      trHead.appendChild(th);

      var thRole = el('th', 'pv-role-th' + (role === 'ignore' ? ' pv-dim-col' : ''));
      var sel = document.createElement('select');
      sel.className = 'pv-role';
      sel.setAttribute('data-col', String(c.index));
      sel.setAttribute('aria-label', c.label + ' 的用途');
      ROLE_OPTS.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        if (o.value === role) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () {
        roles[c.index] = sel.value;
        if (!applyRoles(roles)) renderPreview();   // 失败时把下拉还原成实际生效的角色
      });
      thRole.appendChild(sel);
      trRole.appendChild(thRole);
    });
    thead.appendChild(trHead);
    thead.appendChild(trRole);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var end = Math.min(rows.length, start + PV_ROWS);
    for (var r = start; r < end; r++) {
      var row = rows[r] || [];
      var tr = document.createElement('tr');
      cols.forEach(function (c) {
        var v = row[c.index];
        var role = roles[c.index];
        var isDate = role === 'date' || c.index === res.dateCol;
        var txt = '';
        if (v !== null && v !== undefined && v !== '') {
          if (isDate) {
            var pd = P.parseDate(v);
            txt = pd ? pd.text : String(v);
          } else {
            txt = String(v);
          }
        }
        var td = el('td', (isDate ? 'pv-date' : '') + (role === 'ignore' ? ' pv-dim' : ''));
        td.textContent = txt;
        tr.appendChild(td);
      });
      if (roles[res.dateCol] === 'ignore') tr.className = 'pv-dim-row';
      tbody.appendChild(tr);
    }
    if (!tbody.children.length) {
      var tr0 = document.createElement('tr');
      var td0 = el('td', 'pv-empty', '没有可预览的数据行');
      td0.colSpan = Math.max(1, cols.length);
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    }
    table.appendChild(tbody);

    if (note) {
      var sName = { wide: '宽表', long: '长表', single: '单序列' }[res.structure] || '已识别';
      var ignN = 0;
      for (var k in roles) if (roles[k] === 'ignore') ignN++;
      note.textContent = '共 ' + res.columns.length + ' 列、' + (res.totalRows || rows.length) + ' 行'
        + (res.columns.length > PV_COLS ? '；此处只显示前 ' + PV_COLS + ' 列' : '')
        + '。识别为「' + sName + '」，当前得到 ' + res.products.length + ' 条净值序列'
        + (ignN ? '，忽略 ' + ignN + ' 列' : '')
        + '。改列用途会立即重算，不用重新上传。';
    }
  }

  /* ---------------- SVG 迷你走势 ---------------- */
  function spark(vals, color) {
    if (!vals || vals.length < 2) return '';
    var n = vals.length;
    var step = Math.max(1, Math.floor(n / 120));
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < n; i += step) {
      if (vals[i] < min) min = vals[i];
      if (vals[i] > max) max = vals[i];
    }
    if (!isFinite(min) || min === max) return '';
    var W = 100, H = 22, pts = [];
    for (i = 0; i < n; i += step) {
      var x = (i / (n - 1)) * W;
      var y = H - ((vals[i] - min) / (max - min)) * (H - 3) - 1.5;
      pts.push(x.toFixed(2) + ',' + y.toFixed(2));
    }
    var poly = pts.join(' ');
    var area = '0,' + H + ' ' + poly + ' ' + W + ',' + H;
    return '<svg class="kpi-spark" viewBox="0 0 100 22" preserveAspectRatio="none">'
      + '<polygon points="' + area + '" fill="' + color + '" opacity=".08"></polygon>'
      + '<polyline points="' + poly + '" fill="none" stroke="' + color + '" stroke-width="1.3" vector-effect="non-scaling-stroke" stroke-linejoin="round"></polyline>'
      + '</svg>';
  }

  /* ---------------- 数值滚动 ---------------- */
  var reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setVal(node, v, fmt, cls) {
    node.className = 'kpi-val ' + (cls || '');
    if (v === null || v === undefined || !isFinite(v)) {
      node.textContent = (typeof v === 'string') ? v : '—';
      return;
    }
    if (reduceMotion) { node.textContent = fmt(v); return; }
    var start = performance.now(), dur = 620;
    function step(t) {
      var k = Math.min(1, (t - start) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      node.textContent = fmt(v * e);
      if (k < 1) requestAnimationFrame(step);
      else node.textContent = fmt(v);
    }
    requestAnimationFrame(step);
  }

  /* ---------------- KPI ---------------- */
  function renderKpis(m, animate) {
    var grid = $('kpiGrid');
    grid.innerHTML = '';

    var items = [
      {
        label: '累计收益', val: m.totalReturn, fmt: function (v) { return pct(v); },
        cls: signedCls(m.totalReturn),
        sub: '净值 ' + num(m.navStart) + ' → ' + num(m.navEnd),
        sparkVals: m.cum, sparkColor: m.totalReturn >= 0 ? '#C0392B' : '#1E7B4F',
        tip: '期末净值 / 期初净值 - 1，未年化。'
      },
      {
        label: '年化收益', val: m.annualized, fmt: function (v) { return pct(v); },
        cls: signedCls(m.annualized),
        sub: '区间 ' + (m.days / 365).toFixed(2) + ' 年 · 年化按 365 天',
        sparkVals: m.cum, sparkColor: m.annualized >= 0 ? '#C0392B' : '#1E7B4F',
        tip: '(1 + 累计收益)^(365 / 自然日跨度) - 1。'
      },
      {
        label: '年化波动率', val: m.annVol, fmt: function (v) { return pct(v); },
        cls: '',
        sub: freqLabel(m.periodsPerYear) + ' · 样本 ' + m.nObs + ' 期',
        sparkVals: null,
        tip: '期收益标准差 × √(每年期数)，每年期数由实际净值频率自动识别。'
      },
      {
        label: '最大回撤', val: m.maxDD, fmt: function (v) { return pct(v); },
        cls: 'neg',
        sub: m.ddPeakDate + ' → ' + m.ddTroughDate,
        sparkVals: m.ddSeries, sparkColor: '#C0392B',
        tip: '(净值 - 历史最高净值) / 历史最高净值 的最小值。'
      },
      {
        label: '夏普比率', val: m.sharpe, fmt: function (v) { return ratio(v); },
        cls: '',
        sub: '无风险利率 ' + pct(state.rf),
        sparkVals: null,
        tip: '(年化收益 - 无风险利率) / 年化波动率。'
      },
      {
        label: '卡玛比率', val: m.calmar, fmt: function (v) { return ratio(v); },
        cls: '',
        sub: '年化收益 / |最大回撤|',
        sparkVals: null,
        tip: '年化收益 ÷ 最大回撤绝对值，衡量单位回撤换取的收益。'
      },
      {
        label: '索提诺比率', val: m.sortino, fmt: function (v) { return ratio(v); },
        cls: '',
        sub: '下行波动 ' + pct(m.downVol),
        sparkVals: null,
        tip: '(年化收益 - 无风险利率) / 下行波动率，只惩罚亏损波动。'
      },
      {
        label: '回撤修复', val: null, fmt: null,
        cls: '',
        sub: m.ddRecovered ? ('修复于 ' + m.ddRecoverDate) : ('尚在水下 ' + Math.round(m.longestUnderwater) + ' 天'),
        sparkVals: null,
        text: m.recoveryDays === null ? '未修复' : (Math.round(m.recoveryDays) + ' 天'),
        tip: '从回撤谷底回到前高所用自然日；未修复则显示历史最大水下时长 ' + Math.round(m.longestUnderwater) + ' 天。'
      }
    ];

    items.forEach(function (it, idx) {
      var card = el('div', 'kpi');
      card.style.animationDelay = (idx * 55) + 'ms';

      var lab = el('div', 'kpi-label');
      lab.appendChild(el('span', null, it.label));
      var q = el('i', 'q', '?');
      q.title = it.tip;
      lab.appendChild(q);
      card.appendChild(lab);

      var val = el('div', 'kpi-val');
      card.appendChild(val);
      card.appendChild(el('div', 'kpi-sub', it.sub));

      if (it.sparkVals) {
        var s = spark(it.sparkVals, it.sparkColor);
        if (s) card.insertAdjacentHTML('beforeend', s);
      }

      grid.appendChild(card);

      if (it.text !== undefined) {
        val.className = 'kpi-val ' + it.cls;
        val.textContent = it.text;
      } else if (animate && !reduceMotion) {
        setVal(val, it.val, it.fmt, it.cls);
      } else {
        setVal(val, it.val, it.fmt, it.cls);
      }
    });
  }

  /* ---------------- 区间收益 ---------------- */
  function renderPeriods(m) {
    var box = $('periodGrid');
    box.innerHTML = '';
    var defs = [
      ['近 1 月', m.periods.m1],
      ['近 3 月', m.periods.m3],
      ['近 6 月', m.periods.m6],
      ['今年来', m.periods.ytd],
      ['近 1 年', m.periods.y1]
    ];
    defs.forEach(function (d) {
      var it = el('div', 'period-item');
      it.appendChild(el('span', null, d[0]));
      var s = el('strong', (d[1] === null || d[1] === undefined) ? 'na' : signedCls(d[1]),
        (d[1] === null || d[1] === undefined) ? '区间不足' : pct(d[1]));
      it.appendChild(s);
      box.appendChild(it);
    });
  }

  /* ---------------- 明细表 ---------------- */
  function renderDetail(m) {
    var tbl = $('detailTable');
    tbl.innerHTML = '';

    function section(title) {
      var tr = el('tr', 'detail-section');
      var td = el('td');
      td.colSpan = 4;
      td.textContent = title;
      tr.appendChild(td);
      tbl.appendChild(tr);
    }
    function row(a, av, b, bv) {
      var tr = el('tr');
      tr.appendChild(el('td', null, a));
      var t1 = el('td', 'v' + (typeof av === 'object' && av ? ' ' + av.cls : ''), typeof av === 'object' && av ? av.text : av);
      tr.appendChild(t1);
      tr.appendChild(el('td', null, b || ''));
      var t2 = el('td', 'v' + (typeof bv === 'object' && bv ? ' ' + bv.cls : ''), typeof bv === 'object' && bv ? bv.text : (bv || ''));
      tr.appendChild(t2);
      tbl.appendChild(tr);
    }
    function V(text, cls) { return { text: text, cls: cls || '' }; }

    section('收益');
    row('区间起点', m.start, '区间终点', m.end);
    row('期初净值', num(m.navStart), '期末净值', num(m.navEnd));
    row('累计收益', V(pct(m.totalReturn), signedCls(m.totalReturn)), '年化收益', V(pct(m.annualized), signedCls(m.annualized)));
    row('样本点数', String(m.n), '跨度天数', Math.round(m.days) + ' 天');
    row('净值频率', freqLabel(m.periodsPerYear) + '（' + m.periodsPerYear.toFixed(1) + ' 期/年）', '年化因子', m.periodsPerYear.toFixed(1));

    section('风险');
    row('年化波动率', pct(m.annVol), '下行波动率', pct(m.downVol));
    row('最大回撤', V(pct(m.maxDD), 'neg'), '回撤修复', m.recoveryDays === null ? '未修复' : Math.round(m.recoveryDays) + ' 天');
    row('峰值日期', m.ddPeakDate, '谷底日期', m.ddTroughDate);
    row('修复日期', m.ddRecoverDate || '—', '最长水下', Math.round(m.longestUnderwater) + ' 天');
    row('单期 95% VaR', V(pct(m.var95), m.var95 < 0 ? 'neg' : ''), '正收益期占比', pct(m.positiveRatio, 1));
    row('最佳单期', V(pct(m.best.ret) + '（' + (m.best.date || '—') + '）', 'pos'),
      '最差单期', V(pct(m.worst.ret) + '（' + (m.worst.date || '—') + '）', 'neg'));

    section('比率');
    row('夏普比率', ratio(m.sharpe), '卡玛比率', ratio(m.calmar));
    row('索提诺比率', ratio(m.sortino), '无风险利率', pct(state.rf));

    section('区间收益');
    row('近 1 月', V(pct(m.periods.m1), signedCls(m.periods.m1)), '近 3 月', V(pct(m.periods.m3), signedCls(m.periods.m3)));
    row('近 6 月', V(pct(m.periods.m6), signedCls(m.periods.m6)), '今年来', V(pct(m.periods.ytd), signedCls(m.periods.ytd)));
    row('近 1 年', V(pct(m.periods.y1), signedCls(m.periods.y1)), '', '');

    section('年度收益');
    var ann = m.annual;
    for (var i = 0; i < ann.length; i += 2) {
      var a1 = ann[i], a2 = ann[i + 1];
      row(String(a1.year) + ' 年', V(pct(a1.ret), signedCls(a1.ret)),
        a2 ? (String(a2.year) + ' 年') : '',
        a2 ? V(pct(a2.ret), signedCls(a2.ret)) : '');
    }

    if (state.benchM && state.prodAlignM) {
      var pm = state.prodAlignM, bm = state.benchM;
      var excessCum = (1 + pm.totalReturn) / (1 + bm.totalReturn) - 1;
      var excessAnn = (1 + pm.annualized) / (1 + bm.annualized) - 1;
      var te = trackingError(pm.r, bm.r, pm.periodsPerYear);
      var ir = te > 0 ? (pm.annualized - bm.annualized) / te : null;

      section('基准对比（' + (state.benchName || '基准') + '）');
      row('对齐区间', dstr(state.alignStart) + ' 至 ' + dstr(state.alignEnd),
        '对齐点数', String(state.alignPoints)
        + (state.alignAsOf ? '（' + state.alignAsOf + ' 点取前值）' : ''));
      row('产品累计', V(pct(pm.totalReturn), signedCls(pm.totalReturn)),
        '基准累计', V(pct(bm.totalReturn), signedCls(bm.totalReturn)));
      row('产品年化', V(pct(pm.annualized), signedCls(pm.annualized)),
        '基准年化', V(pct(bm.annualized), signedCls(bm.annualized)));
      row('超额累计', V(pct(excessCum), signedCls(excessCum)),
        '超额年化', V(pct(excessAnn), signedCls(excessAnn)));
      row('相对最大回撤', V(pct(relativeDD(alignedProductArr(), alignedBenchArr())), 'neg'),
        '跟踪误差', V(pct(te), ''));
      row('信息比率', V(ratio(ir), signedCls(ir)),
        '产品 / 基准波动', pct(pm.annVol) + ' / ' + pct(bm.annVol));
    }
  }

  function trackingError(rp, rb, f) {
    if (!rp || !rb || rp.length < 2 || rp.length !== rb.length) return null;
    var d = [];
    for (var i = 0; i < rp.length; i++) d.push(rp[i] - rb[i]);
    var m = 0;
    for (var j = 0; j < d.length; j++) m += d[j];
    m /= d.length;
    var s = 0;
    for (var k = 0; k < d.length; k++) { var x = d[k] - m; s += x * x; }
    var sd = Math.sqrt(s / (d.length - 1));
    return sd * Math.sqrt(f);
  }

  function relativeDD(a, b) {
    if (!a || !b || !a.length) return null;
    var peak = -Infinity, worst = 0;
    for (var i = 0; i < a.length; i++) {
      var ratioV = a[i] / b[i];
      if (ratioV > peak) peak = ratioV;
      var dd = ratioV / peak - 1;
      if (dd < worst) worst = dd;
    }
    return worst;
  }

  function alignedProductArr() {
    if (!state.prodAlignM) return null;
    return state.prodAlignM.nav;
  }
  function alignedBenchArr() {
    if (!state.benchM) return null;
    return state.benchM.nav;
  }

  /* ---------------- 基准面板 ---------------- */
  function benchPair() {
    if (!IL || state.benchSource !== 'index' || !state.benchCode) return null;
    return IL.pair(state.benchCode);
  }

  function fillBenchSelect() {
    var sel = $('benchIndex');
    if (!sel || sel.getAttribute('data-filled') === '1') return;
    if (!IL || !IL.ready()) return;
    var groups = IL.groups();
    if (!groups.length) return;
    sel.innerHTML = '<option value="">选择内置指数…</option>';
    groups.forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g.group;
      g.items.forEach(function (it) {
        var o = document.createElement('option');
        o.value = it.code;
        o.textContent = it.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.setAttribute('data-filled', '1');
  }

  function indexCount() {
    if (!IL || !IL.ready()) return 0;
    var n = 0;
    IL.groups().forEach(function (g) { n += g.items.length; });
    return n;
  }

  /* 内置指数数据过期天数（本地日历日差） */
  function staleDays(s) {
    if (!s) return null;
    var p = String(s).split('-');
    if (p.length !== 3) return null;
    var d = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    if (!isFinite(d)) return null;
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((today - d) / DAY);
  }

  function renderBenchMeta() {
    var meta = $('benchMeta');
    if (!meta) return;
    if (!IL) { meta.textContent = ''; return; }
    if (!IL.ready()) {
      meta.textContent = '内置指数首次使用需载入数据（约 0.7 MB，之后走缓存）';
      return;
    }
    var upd = IL.updated();
    var txt = indexCount() + ' 条指数 · 数据截至 ' + (upd || '—');
    if (state.benchSource === 'index' && state.benchmark) {
      txt += ' · 已对齐 ' + (state.alignPoints || 0) + ' 点';
    }
    meta.textContent = txt;
    var sd = staleDays(upd);
    if (sd !== null && sd > 30) {
      meta.appendChild(el('span', 'meta-warn',
        ' · 指数数据已 ' + sd + ' 天未更新，运行 tools/fetch_indices.py 后重新发布可更新'));
    }
  }

  function renderBenchPanel() {
    var box = $('benchResult');
    var clearBtn = $('btnClearBench');
    var dropText = $('benchText');
    var sel = $('benchIndex');
    var mode = $('benchMode');
    var pair = benchPair();
    if (IL && IL.ready()) fillBenchSelect();

    if (!state.benchmark) {
      box.hidden = true;
      clearBtn.hidden = true;
      if (sel) sel.value = '';
      if (mode) mode.hidden = true;
      dropText.textContent = '上传自有基准（Excel / CSV）';
      renderBenchMeta();
      return;
    }

    if (sel) sel.value = (state.benchSource === 'index') ? state.benchCode : '';
    if (mode) {
      mode.hidden = state.benchSource !== 'index';
      var prBtn = mode.querySelector('[data-tr="0"]');
      var trBtn = mode.querySelector('[data-tr="1"]');
      var hasTr = !!(pair && pair.tr);
      if (trBtn) {
        trBtn.disabled = !hasTr;
        trBtn.title = hasTr ? '' : '这条指数暂无全收益数据';
        trBtn.classList.toggle('is-on', !!state.benchTr && hasTr);
      }
      if (prBtn) prBtn.classList.toggle('is-on', !state.benchTr || !hasTr);
    }
    dropText.textContent = (state.benchName || '基准') + ' · '
      + (state.benchmark.count || state.benchmark.nav.length) + ' 点';

    if (!state.benchM || !state.prodAlignM) {
      box.hidden = true;
      clearBtn.hidden = false;
      renderBenchMeta();
      return;
    }

    var pm = state.prodAlignM, bm = state.benchM;
    var excessCum = (1 + pm.totalReturn) / (1 + bm.totalReturn) - 1;
    var excessAnn = (1 + pm.annualized) / (1 + bm.annualized) - 1;
    var rdd = relativeDD(state.prodAlignM.nav, state.benchM.nav);
    var pts = String(state.alignPoints || 0)
      + (state.alignAsOf ? '（' + state.alignAsOf + ' 点取前值）' : '');

    box.hidden = false;
    clearBtn.hidden = false;
    box.innerHTML = ''
      + benchRow('对齐点数', pts, '')
      + (state.alignSkipped
        ? benchRow('区间裁剪', '前 ' + state.alignSkipped + ' 点早于基准数据', '')
        : '')
      + benchRow('超额累计', pct(excessCum), signedCls(excessCum))
      + benchRow('超额年化', pct(excessAnn), signedCls(excessAnn))
      + benchRow('基准年化', pct(bm.annualized), signedCls(bm.annualized))
      + benchRow('相对最大回撤', pct(rdd), 'neg');
    renderBenchMeta();
  }

  /* 选中内置指数：直接复用 state.benchmark，后续计算/图表/导出全部沿用原链路 */
  function useBuiltinIndex(code, wantTr) {
    if (!IL) { toast('指数模块未加载'); return; }
    var s = IL.series(code, wantTr);
    if (!s) { toast('这条指数没有对应口径的数据'); return; }
    state.benchmark = { name: s.name, ts: s.ts, nav: s.nav, labels: [], count: s.count };
    state.benchName = s.name;
    state.benchCode = code;
    state.benchTr = !!s.tr;
    state.benchSource = 'index';
    renderBenchPanel();
    if (state.metrics) render(false);
  }

  function clearBenchmark(silent) {
    state.benchmark = null;
    state.benchName = '';
    state.benchCode = '';
    state.benchTr = false;
    state.benchSource = 'none';
    state.benchM = null;
    state.prodAlignM = null;
    state.alignPoints = 0;
    state.alignExact = 0;
    state.alignAsOf = 0;
    state.alignSkipped = 0;
    renderBenchPanel();
    if (state.metrics) render(false);
    if (!silent) toast('已移除基准');
  }

  /* 懒加载指数数据包，第一次点开下拉时才注入脚本 */
  function ensureBenchLib() {
    if (!IL || IL.ready()) { fillBenchSelect(); renderBenchMeta(); return; }
    renderBenchMeta();
    IL.ensure().then(function () {
      fillBenchSelect();
      renderBenchMeta();
    }).catch(function (e) {
      toast(e && e.message ? e.message : '指数数据加载失败');
      renderBenchMeta();
    });
  }

  function benchRow(k, v, cls) {
    return '<div class="bench-row"><span>' + esc(k) + '</span><b class="' + (cls || '') + '">' + esc(v) + '</b></div>';
  }

  /* ---------------- 风格暴露：三因子周频回归 ----------------
   * 产品净值按自然周取最后一个点，指数同样取周频，再用共同周算周收益；
   * 缺口周（不是相邻周）不计，避免两三周的收益被当成一周。
   */
  var STYLE_FACTORS = [
    { code: '000300', name: '沪深300' },
    { code: '000852', name: '中证1000' },
    { code: '932000', name: '中证2000' }
  ];
  var STYLE_MIN_WEEKS = 30;

  function weekKey(ts) {
    // 1970-01-01 是周四，+3 天后按 7 天切片，使每周起点落在周一
    return Math.floor((Math.floor(ts / DAY) + 3) / 7);
  }

  function weeklyLast(ts, nav) {
    var out = [], curK = null, curV = null;
    for (var i = 0; i < ts.length; i++) {
      if (!(nav[i] > 0)) continue;
      var k = weekKey(ts[i]);
      if (curK === null) { curK = k; curV = nav[i]; continue; }
      if (k !== curK) {
        out.push({ k: curK, v: curV });
        curK = k;
      }
      curV = nav[i];
    }
    if (curK !== null) out.push({ k: curK, v: curV });
    return out;
  }

  function computeStyle() {
    var res = state.result;
    if (!res) return null;
    var p = res.products[state.productIdx];
    if (!p) return null;

    var wk = weeklyLast(p.ts, p.nav);
    if (wk.length < 8) return { ok: false, reason: 'few', weeks: wk.length };

    var pmap = {}, i;
    wk.forEach(function (w) { pmap[w.k] = w.v; });

    var fmaps = [], names = [];
    for (i = 0; i < STYLE_FACTORS.length; i++) {
      var s = IL.series(STYLE_FACTORS[i].code, false);
      if (!s) return { ok: false, reason: 'no-index', name: STYLE_FACTORS[i].name };
      var fm = {};
      weeklyLast(s.ts, s.nav).forEach(function (w) { fm[w.k] = w.v; });
      fmaps.push(fm);
      names.push(s.name || STYLE_FACTORS[i].name);
    }

    var ys = [], xs = [];
    for (i = 1; i < wk.length; i++) {
      var k0 = wk[i - 1].k, k1 = wk[i].k;
      if (k1 - k0 !== 1) continue;
      var ok = true;
      for (var f = 0; f < fmaps.length; f++) {
        if (!(fmaps[f][k0] > 0) || !(fmaps[f][k1] > 0)) { ok = false; break; }
      }
      if (!ok) continue;
      var fac = [];
      for (var g = 0; g < fmaps.length; g++) fac.push(fmaps[g][k1] / fmaps[g][k0] - 1);
      ys.push(pmap[k1] / pmap[k0] - 1);
      xs.push(fac);
    }
    if (ys.length < 8) return { ok: false, reason: 'few', weeks: ys.length, names: names };

    var rg = M.regress(ys, xs);
    if (!rg) return { ok: false, reason: 'singular', weeks: ys.length, names: names };

    var alphaAnn = (1 + rg.alpha) > 0 ? Math.pow(1 + rg.alpha, 52) - 1 : null;
    return {
      ok: true, n: rg.n, r2: rg.r2, betas: rg.betas,
      alphaWeek: rg.alpha, alphaAnn: alphaAnn, resid: rg.residStd, names: names
    };
  }

  function styleVerdict(d) {
    var r2 = d.r2 === null ? 0 : d.r2;
    var small = d.betas[1] + d.betas[2];
    var big = d.betas[0];
    if (r2 >= 0.6) {
      if (small >= 0.6 && small > big) return 'R² 较高，收益主要由小微盘风格解释（中证1000 + 中证2000 Beta 合计 ' + small.toFixed(2) + '）。';
      if (big >= 0.6) return 'R² 较高，收益主要跟随大盘（沪深300 Beta ' + big.toFixed(2) + '），风格偏核心资产。';
      return 'R² 较高，三因子能解释大部分波动，但没有单一主导风格（Beta 合计 ' + (big + small).toFixed(2) + '）。';
    }
    if (r2 >= 0.3) return 'R² 中等，三因子只能解释一部分收益，其余大概率来自选股或择时。';
    return 'R² 偏低，收益与大盘 / 中小盘指数的关系弱，更像绝对收益或低相关策略。';
  }

  function styleMetaItem(k, v) {
    var d = el('div', 'style-meta-item');
    d.appendChild(el('span', '', k));
    d.appendChild(el('b', '', v));
    return d;
  }

  function renderStylePanel() {
    var card = $('styleCard');
    if (!card) return;
    if (!state.result) { card.hidden = true; return; }
    var p = state.result.products[state.productIdx];
    if (!p) { card.hidden = true; return; }
    card.hidden = false;

    var grid = $('styleBetas'), meta = $('styleMeta'), note = $('styleNote'), btn = $('btnStyleRun');

    if (!IL || !IL.ready()) {
      if (grid) grid.hidden = true;
      if (meta) meta.hidden = true;
      if (btn) { btn.disabled = false; btn.textContent = '载入并计算'; }
      if (note) note.textContent = '首次使用需载入内置指数数据（约 0.7 MB，之后走缓存）。';
      return;
    }

    var key = [p.name, state.from || 0, state.to || 0, IL.updated()].join('|');
    if (!state.styleExp || state.styleExp.key !== key) {
      state.styleExp = { key: key, data: computeStyle() };
    }
    var d = state.styleExp.data;
    if (btn) { btn.disabled = false; btn.textContent = '重新计算'; }

    if (!d || !d.ok) {
      if (grid) { grid.hidden = true; grid.innerHTML = ''; }
      if (meta) meta.hidden = true;
      if (!note) return;
      if (d && d.reason === 'few') {
        note.textContent = '周频样本只有 ' + (d.weeks || 0) + ' 个（需 ≥ ' + STYLE_MIN_WEEKS + ' 周），暂不给出 Beta，避免看起来精确但没意义。';
      } else if (d && d.reason === 'singular') {
        note.textContent = '三个因子在这段区间高度共线，回归无解；可把区间拉长再试。';
      } else if (d && d.reason === 'no-index') {
        note.textContent = '内置指数里没有「' + d.name + '」，无法做三因子回归。';
      } else {
        note.textContent = '这段数据暂时算不出风格暴露。';
      }
      return;
    }

    if (d.n < STYLE_MIN_WEEKS) {
      if (grid) grid.hidden = true;
      if (meta) meta.hidden = true;
      if (note) note.textContent = '有效周频样本只有 ' + d.n + ' 个（需 ≥ ' + STYLE_MIN_WEEKS + ' 周），样本不足，暂不给 Beta 估计。';
      return;
    }

    if (grid) {
      grid.innerHTML = '';
      d.names.forEach(function (nm, i) {
        var cell = el('div', 'beta-cell');
        cell.appendChild(el('span', 'beta-name', nm));
        cell.appendChild(el('b', 'beta-val', d.betas[i].toFixed(2)));
        grid.appendChild(cell);
      });
      grid.hidden = false;
    }
    if (meta) {
      meta.innerHTML = '';
      meta.appendChild(styleMetaItem('R²', d.r2 === null ? '—' : d.r2.toFixed(2)));
      meta.appendChild(styleMetaItem('样本', d.n + ' 周'));
      meta.appendChild(styleMetaItem('年化 Alpha', d.alphaAnn === null ? '—' : pct(d.alphaAnn)));
      meta.hidden = false;
    }
    if (note) note.textContent = styleVerdict(d);
  }

  /* ---------------- 图表 ---------------- */
  function renderCharts(m) {
    var useBench = !!(state.benchM && state.prodAlignM);
    var pm = useBench ? state.prodAlignM : m;

    var dates = pm.dates;
    var cum = pm.cum;
    var dd = pm.ddSeries;
    var benchCum = null;

    if (useBench) {
      benchCum = state.benchM.cum;
      if (benchCum.length !== cum.length) benchCum = null;
    }

    CH.renderNav('chartNav', {
      name: (state.result.products[state.productIdx] || {}).name || '产品',
      dates: dates,
      cum: cum,
      benchName: state.benchName,
      benchCum: benchCum
    });

    var relDD = null;
    if (useBench && benchCum) {
      relDD = [];
      var peak = -Infinity;
      for (var i = 0; i < pm.nav.length; i++) {
        var rr = pm.nav[i] / state.benchM.nav[i];
        if (rr > peak) peak = rr;
        relDD.push(rr / peak - 1);
      }
    }
    CH.renderDD('chartDD', { dates: dates, dd: dd, relative: relDD });

    CH.renderAnnual('chartAnnual', m.annual);
    CH.renderHeat('chartHeat', m.monthly);

    $('navNote').textContent = useBench ? '已按最近交易日对齐，起点归一为 1' : '起点归一为 1';
    $('ddNote').textContent = relDD ? '产品回撤 + 相对基准回撤（虚线）' : '相对历史最高净值的跌幅';
    $('rfEcho').textContent = pct(state.rf);
  }

  /* ---------------- 导出 ---------------- */
  function download(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
  }

  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function summaryRows() {
    var m = state.metrics;
    if (!m) return [];
    var p = state.result.products[state.productIdx];
    var rows = [
      ['文件', state.fileName],
      ['工作表', state.sheets[state.sheetIdx].name],
      ['产品', p.name],
      ['区间', m.start + ' 至 ' + m.end],
      ['样本点数', m.n],
      ['净值频率', freqLabel(m.periodsPerYear)],
      ['无风险利率', pct(state.rf)],
      ['', ''],
      ['累计收益', pct(m.totalReturn)],
      ['年化收益', pct(m.annualized)],
      ['年化波动率', pct(m.annVol)],
      ['夏普比率', ratio(m.sharpe)],
      ['卡玛比率', ratio(m.calmar)],
      ['索提诺比率', ratio(m.sortino)],
      ['最大回撤', pct(m.maxDD)],
      ['回撤峰值日', m.ddPeakDate],
      ['回撤谷底日', m.ddTroughDate],
      ['回撤修复日', m.ddRecoverDate || '未修复'],
      ['回撤修复天数', m.recoveryDays === null ? '未修复' : Math.round(m.recoveryDays)],
      ['最长水下天数', Math.round(m.longestUnderwater)],
      ['下行波动率', pct(m.downVol)],
      ['正收益期占比', pct(m.positiveRatio, 1)],
      ['单期 95% VaR', pct(m.var95)],
      ['最佳单期', pct(m.best.ret) + ' @' + (m.best.date || '')],
      ['最差单期', pct(m.worst.ret) + ' @' + (m.worst.date || '')],
      ['近 1 月', pct(m.periods.m1)],
      ['近 3 月', pct(m.periods.m3)],
      ['近 6 月', pct(m.periods.m6)],
      ['今年来', pct(m.periods.ytd)],
      ['近 1 年', pct(m.periods.y1)]
    ];
    m.annual.forEach(function (a) { rows.push([a.year + ' 年收益', pct(a.ret)]); });

    if (state.benchM && state.prodAlignM) {
      var bm = state.benchM, pm2 = state.prodAlignM;
      rows.push(['', '']);
      rows.push(['基准', state.benchName || '']);
      rows.push(['对齐区间', dstr(state.alignStart) + ' 至 ' + dstr(state.alignEnd)]);
      rows.push(['对齐点数', String(state.alignPoints)
        + (state.alignAsOf ? '（其中 ' + state.alignAsOf + ' 点按最近交易日取前值）' : '')]);
      rows.push(['基准累计收益', pct(bm.totalReturn)]);
      rows.push(['基准年化', pct(bm.annualized)]);
      rows.push(['超额累计', pct((1 + pm2.totalReturn) / (1 + bm.totalReturn) - 1)]);
      rows.push(['超额年化', pct((1 + pm2.annualized) / (1 + bm.annualized) - 1)]);
      rows.push(['相对最大回撤', pct(relativeDD(pm2.nav, bm.nav))]);
    }

    if (state.ddEpisodes && state.ddEpisodes.length) {
      rows.push(['', '']);
      rows.push(['回撤明细（全区间前 5 段）', '']);
      state.ddEpisodes.forEach(function (e, i) {
        rows.push(['第 ' + (i + 1) + ' 段', e.peakDate + ' → ' + e.troughDate
          + ' · ' + pct(e.depth)
          + ' · 下跌 ' + e.dropDays + ' 天 · '
          + (e.ongoing ? '尚未修复' : '修复 ' + e.recoverDays + ' 天（' + e.recoverDate + '）')]);
      });
    }
    return rows;
  }

  function exportCsv() {
    if (!state.metrics) { toast('还没有可导出的指标'); return; }
    var rows = [['指标', '数值']].concat(summaryRows());
    var txt = '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var p = state.result.products[state.productIdx];
    download('绩效指标_' + p.name + '_' + state.metrics.end + '.csv', txt, 'text/csv;charset=utf-8');
    toast('已导出指标 CSV');
  }

  function exportSeries() {
    var m = state.metrics;
    if (!m) { toast('还没有可导出的数据'); return; }
    var rows = [['日期', '净值', '累计净值', '回撤']];
    for (var i = 0; i < m.n; i++) {
      rows.push([m.dates[i], m.nav[i], m.cum[i].toFixed(6), (m.ddSeries[i] * 100).toFixed(4) + '%']);
    }
    var txt = '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var p = state.result.products[state.productIdx];
    download('净值序列_' + p.name + '_' + m.end + '.csv', txt, 'text/csv;charset=utf-8');
    toast('已导出净值序列');
  }

  function copySummary() {
    var m = state.metrics;
    if (!m) { toast('还没有可复制的指标'); return; }
    var p = state.result.products[state.productIdx];
    var lines = [
      p.name + ' 绩效摘要',
      '区间：' + m.start + ' 至 ' + m.end + '（' + (m.days / 365).toFixed(2) + ' 年）',
      '累计收益：' + pct(m.totalReturn) + '　年化收益：' + pct(m.annualized),
      '年化波动：' + pct(m.annVol) + '　夏普：' + ratio(m.sharpe) + '　卡玛：' + ratio(m.calmar),
      '最大回撤：' + pct(m.maxDD) + '（' + m.ddPeakDate + ' → ' + m.ddTroughDate + '）',
      '回撤修复：' + (m.recoveryDays === null ? '未修复' : Math.round(m.recoveryDays) + ' 天'),
      '索提诺：' + ratio(m.sortino) + '　正收益期占比：' + pct(m.positiveRatio, 1)
    ];
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('摘要已复制到剪贴板');
      }, function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('摘要已复制到剪贴板');
    } catch (e) {
      toast('复制失败，请手动选择文本');
    }
    document.body.removeChild(ta);
  }

  function exportPng(id, label) {
    var url = CH.png(id);
    if (!url) { toast('图表尚未渲染'); return; }
    var a = document.createElement('a');
    a.href = url;
    a.download = (label || id) + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('已导出图片');
  }

  /* ---------------- 本地存档 ---------------- */
  function nowStamp() {
    var d = new Date();
    function p(x) { return x < 10 ? '0' + x : '' + x; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function mdCell(v) {
    return String(v === null || v === undefined ? '' : v).replace(/\|/g, '\\|');
  }

  function buildSnapshotMd() {
    var m = state.metrics;
    if (!m || !state.result) return '';
    var p = state.result.products[state.productIdx];
    var out = [];
    out.push('# ' + p.name + ' · 绩效快照');
    out.push('');
    out.push('> 存档时间 ' + nowStamp() + '　由「净值分析台」生成');
    out.push('');
    out.push('| 指标 | 数值 |');
    out.push('| --- | --- |');
    summaryRows().forEach(function (r) {
      if ((!r[0] && !r[1]) || r[0] === '文件' || r[0] === '工作表') return;
      out.push('| ' + mdCell(r[0]) + ' | ' + mdCell(r[1]) + ' |');
    });
    out.push('');
    out.push('口径：年化收益按 365 日历天折算；波动率按识别出的净值频率年化；无风险利率 ' + pct(state.rf) + '。');
    out.push('原始文件：' + state.fileName + (state.demo ? '（演示数据）' : ''));
    return out.join('\n') + '\n';
  }

  function buildBenchSnapshotMd(series, file) {
    return [
      '# 基准序列存档',
      '',
      '> 存档时间 ' + nowStamp(),
      '',
      '- 源文件：' + file.name,
      '- 基准名称：' + series.name,
      '- 区间：' + dstr(series.ts[0]) + ' 至 ' + dstr(series.ts[series.ts.length - 1]),
      '- 净值点：' + series.count,
      ''
    ].join('\n');
  }

  function autoArchive(file, kind, extra) {
    if (!AR || state.demo) return;
    var m = state.metrics;
    var snap, meta;
    if (kind === 'bench') {
      snap = buildBenchSnapshotMd(extra, file);
      meta = {
        product: extra.name,
        range: dstr(extra.ts[0]) + ' 至 ' + dstr(extra.ts[extra.ts.length - 1])
      };
    } else {
      snap = buildSnapshotMd();
      if (!snap) return;
      meta = {
        product: state.result.products[state.productIdx].name,
        range: m.start + ' 至 ' + m.end,
        annualized: pct(m.annualized),
        maxDD: pct(m.maxDD)
      };
    }
    AR.save({ file: file, kind: kind, snapshot: snap, meta: meta }).then(function (r) {
      state.lastArchive = { at: Date.now(), mode: r.mode, fileName: file.name, saved: r.saved || [] };
      refreshArchiveStatus();
      if (state.fileName === file.name && state.result) renderFilebar();
      if (cmp.open) loadCompareRecords();
      toast(r.mode === 'server'
        ? '已存档：' + ((r.saved && r.saved[0]) || file.name)
        : '已暂存到浏览器档案，可随时打包导出');
    }).catch(function (e) {
      toast('存档失败：' + (e && e.message ? e.message : e));
      refreshArchiveStatus();
    });
  }

  function refreshArchiveStatus() {
    var chip = $('archMode');
    if (!chip) return;
    var st = (AR && AR.status) ? AR.status() : { mode: 'none', port: 0, dir: '' };
    state.archiveMode = st.mode;
    var hint = $('archHint'), path = $('archPath'), last = $('archLast');

    if (st.mode === 'server') {
      chip.textContent = '本机档案';
      chip.className = 'chip ok';
      hint.innerHTML = '已连接本地档案服务，上传后自动写入项目内的 <b>档案/</b> 文件夹，并附一份 .md 指标快照。';
      path.hidden = false;
      path.textContent = st.dir;
    } else if (st.mode === 'browser') {
      var online = st.env === 'cloud';
      chip.textContent = online ? '浏览器档案' : '浏览器暂存';
      chip.className = 'chip ' + (online ? 'ok' : 'warn');
      hint.innerHTML = online
        ? '档案保存在<b>当前浏览器</b>里，不上传服务器。换设备、换浏览器或清理浏览器数据后会不可见，重要档案建议定期「打包导出全部」。'
        : '未检测到本地服务，先存在浏览器里。双击 <b>启动档案服务.bat</b> 可改为落盘到 档案/ 文件夹。';
      path.hidden = true;
    } else {
      chip.textContent = '不可用';
      chip.className = 'chip warn';
      hint.innerHTML = '当前浏览器不支持本地存储，档案功能不可用，建议改用 Chrome / Edge。';
      path.hidden = true;
    }

    if (state.lastArchive) {
      last.hidden = false;
      $('archLastText').textContent = '最近存档 ' + AR.fmtTime(state.lastArchive.at) + ' · '
        + state.lastArchive.fileName + (state.lastArchive.mode === 'server' ? '（本机）' : '（浏览器）');
    }

    var dChip = $('archDrawerMode');
    if (dChip) {
      dChip.textContent = st.mode === 'server'
        ? ('本机 · ' + (st.port ? ':' + st.port : ''))
        : (st.mode === 'browser'
          ? (st.env === 'cloud' ? '浏览器本地' : '浏览器暂存')
          : '不可用');
      dChip.className = 'chip ' + (st.mode === 'server' ? 'ok' : 'warn');
    }
    $('btnOpenFolder').hidden = st.mode !== 'server';
    $('btnMigrate').hidden = st.mode !== 'server';
    updateArchCount();
  }

  function updateArchCount() {
    if (!AR) return;
    AR.list().then(function (rows) {
      var badge = $('archCount');
      if (!badge) return;
      badge.textContent = rows.length;
      badge.hidden = !rows.length;
      $('archListCount').textContent = rows.length ? rows.length + ' 条档案' : '';
      renderRecent(rows);
    }).catch(function () { /* 静默 */ });
  }

  /* ---------------- 主页「最近上传」 ---------------- */
  function shortArchiveName(rec) {
    var t = String(rec.displayName || rec.name || '');
    t = t.replace(/^\d{8}-\d{6}[ _]?/, '').replace(/^基准_/, '');
    return t;
  }

  /* 当前正在看的这份：上传时记的是原文件名，档案名带了时间戳前缀 */
  function isCurrentArchive(rec) {
    var n = String(rec.name || '');
    if (!state.fileName || !n) return false;
    return n === state.fileName || n.replace(/^\d{8}-\d{6}_/, '') === state.fileName;
  }

  function renderRecent(rows) {
    var wrap = $('recentState');
    var box = $('recentList');
    if (!wrap || !box) return;

    var list = (rows || []).filter(function (r) { return r.kind !== 'snapshot'; });
    var total = list.length;
    state.recentCount = total;
    state.recentRows = list;
    if (!total) {
      wrap.hidden = true;
      box.innerHTML = '';
      return;
    }

    box.innerHTML = '';
    list.slice(0, 8).forEach(function (rec) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'recent-item';
      row.title = '载入分析：' + (rec.displayName || rec.name);
      row.appendChild(el('span', 'recent-ico', rec.kind === 'bench' ? '基' : 'X'));

      var main = el('span', 'recent-main');
      main.appendChild(el('span', 'recent-name', shortArchiveName(rec)));
      main.appendChild(el('span', 'recent-meta',
        AR.fmtTime(rec.savedAt) + ' · ' + AR.fmtSize(rec.size)
        + ' · ' + (rec.source === 'disk' ? '本机' : '浏览器')
        + (rec.kind === 'bench' ? ' · 基准' : '')));
      row.appendChild(main);
      if (isCurrentArchive(rec)) {
        row.className += ' is-current';
        row.appendChild(el('span', 'recent-cur', '当前'));
      }
      row.appendChild(el('span', 'recent-go', '载入 →'));

      row.addEventListener('click', function () { loadArchiveRecord(rec); });
      box.appendChild(row);
    });

    $('recentHint').textContent = '共 ' + total + ' 条 · 点一行直接载入分析';
    wrap.hidden = !!cmp.open;
  }

  function btn(label, cls, onClick) {
    var b = el('button', 'btn ' + cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function openArchive() {
    $('archive').hidden = false;
    showArchList();
  }

  function showArchList() {
    $('archSnapView').hidden = true;
    $('archListWrap').hidden = false;
    renderArchiveList();
  }

  function renderArchiveList() {
    var box = $('archList');
    if (!AR) {
      box.innerHTML = '';
      box.appendChild(el('p', 'arch-empty', '档案模块未加载'));
      return;
    }
    box.innerHTML = '';
    box.appendChild(el('p', 'arch-empty', '正在读取档案…'));
    AR.list().then(function (rows) {
      box.innerHTML = '';
      var st = AR.status();
      $('archSub').textContent = st.mode === 'server'
        ? '档案目录：' + st.dir + '　每条档案含原始表格与 .md 指标快照，档案索引.csv 里有一行留痕。'
        : (st.env === 'cloud'
          ? '档案保存在当前浏览器里，不上传服务器；换设备或清理浏览器数据后不可见，建议定期「打包导出全部」存一份。'
          : '暂存在浏览器里，清理浏览器数据会丢失；建议定期「打包导出」。');
      $('archListCount').textContent = rows.length ? rows.length + ' 条档案' : '';
      var hasBrowser = rows.some(function (r) { return r.source === 'browser'; });
      $('btnMigrate').hidden = !(st.mode === 'server' && hasBrowser);
      if (!rows.length) {
        var empty = el('div', 'arch-empty');
        empty.innerHTML = '还没有档案。<br>把 Excel 拖进页面，就会自动留一份<b>原文件 + 指标快照</b>。';
        box.appendChild(empty);
        return;
      }
      rows.forEach(function (rec) { box.appendChild(archItem(rec)); });
    }).catch(function (e) {
      box.innerHTML = '';
      box.appendChild(el('p', 'arch-empty', '读取失败：' + (e && e.message ? e.message : e)));
    });
  }

  function archItem(rec) {
    var it = el('div', 'arch-item');
    var top = el('div', 'arch-item-top');
    top.appendChild(el('span', 'arch-name', rec.displayName || rec.name));
    var kindLabel = rec.kind === 'bench' ? '基准' : (rec.kind === 'snapshot' ? '快照' : '产品');
    top.appendChild(el('span', 'chip', kindLabel));
    top.appendChild(el('span', 'chip ' + (rec.source === 'disk' ? 'ok' : 'warn'),
      rec.source === 'disk' ? '本机' : '浏览器'));
    if (rec.hasSnapshot && rec.kind !== 'snapshot') top.appendChild(el('span', 'chip', '含快照'));
    it.appendChild(top);

    var meta = el('div', 'arch-meta');
    meta.appendChild(el('span', null, AR.fmtTime(rec.savedAt)));
    meta.appendChild(el('span', null, AR.fmtSize(rec.size)));
    it.appendChild(meta);

    var acts = el('div', 'arch-acts');
    acts.appendChild(btn('下载', 'ghost', function () {
      AR.download(rec).catch(function (e) { toast('下载失败：' + (e && e.message ? e.message : e)); });
    }));
    if (rec.kind !== 'snapshot') {
      acts.appendChild(btn('载入分析', 'ghost', function () { loadArchiveRecord(rec); }));
    }
    if (rec.hasSnapshot) {
      acts.appendChild(btn('查看快照', 'ghost', function () { showArchSnapshot(rec); }));
    }
    acts.appendChild(btn('删除', 'ghost danger', function () {
      if (!global.confirm('确定删除这条档案？\n' + rec.name)) return;
      AR.remove(rec).then(function () {
        toast('已删除');
        renderArchiveList();
        updateArchCount();
      }).catch(function (e) { toast('删除失败：' + (e && e.message ? e.message : e)); });
    }));
    it.appendChild(acts);
    return it;
  }

  function showArchSnapshot(rec) {
    $('archListWrap').hidden = true;
    $('archSnapView').hidden = false;
    $('archSnapText').textContent = '正在读取…';
    AR.viewSnapshot(rec).then(function (text) {
      $('archSnapText').textContent = text || '（这条档案没有快照）';
    }).catch(function (e) {
      $('archSnapText').textContent = '读取失败：' + (e && e.message ? e.message : e);
    });
  }

  function loadArchiveRecord(rec) {
    busy(true, '正在读取档案…');
    AR.loadBytes(rec).then(function (bytes) {
      var buf = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
      var parsed = P.parseFile(buf, rec.name);
      busy(false);
      applyParsed(parsed, false);
      $('archive').hidden = true;
      renderRecent(state.recentRows || []);   // 重画一次，标出「当前」
      if (global.scrollTo) global.scrollTo({ top: 0, behavior: 'smooth' });
      toast('已载入档案：' + rec.name);
    }).catch(function (e) {
      busy(false);
      toast('载入失败：' + (e && e.message ? e.message : e));
    });
  }

  function exportAllZip() {
    if (!AR) return;
    AR.list().then(function (rows) {
      if (!rows.length) { toast('还没有档案可打包'); return; }
      toast('正在打包 ' + rows.length + ' 条档案…');
      return AR.exportZip(rows).then(function (r) {
        toast('已打包 ' + r.count + ' 个文件：' + r.zipName);
      });
    }).catch(function (e) {
      toast('打包失败：' + (e && e.message ? e.message : e));
    });
  }

  function migrateArchives() {
    if (!AR) return;
    AR.migrateToServer().then(function (r) {
      toast('迁移完成：成功 ' + r.moved + ' 条' + (r.failed ? '，失败 ' + r.failed + ' 条' : ''));
      renderArchiveList();
      updateArchCount();
    }).catch(function (e) {
      toast('迁移失败：' + (e && e.message ? e.message : e));
    });
  }

  /* ---------------- 业绩对比 ---------------- */
  var cmp = {
    open: false,
    records: [],
    loaded: {},       // recKey -> {ok, products, error, ...}
    selected: [],     // [{key, rec, productIdx}]
    align: 'common',
    baseline: 'first',      // first | bench | idx:CODE
    indexOpen: false,
    filter: '',
    rfDirty: false,   // 对比视图改过无风险利率，回到单产品视图时要重算
    mem: [],          // 当前文件的内存数据源（不落盘）
    pfOpen: false,
    pfWeights: {},
    pfTouched: {},
    pfItem: null,
    pfDirty: false,
    result: null
  };

  function cmpKey(rec) { return CMP.recKey(rec); }

  function showView(name) {
    var isCmp = name === 'compare';
    cmp.open = isCmp;
    $('compareState').hidden = !isCmp;
    if (isCmp) {
      $('emptyState').hidden = true;
      $('resultState').hidden = true;
      $('btnChangeFile').hidden = true;
      $('btnExportCsv').hidden = true;
    } else {
      var hasRes = !!state.result;
      $('resultState').hidden = !hasRes;
      $('emptyState').hidden = hasRes;
      $('btnChangeFile').hidden = !hasRes;
      $('btnExportCsv').hidden = false;
    }
    $('btnCompare').classList.toggle('on', isCmp);
    if ($('recentState')) $('recentState').hidden = isCmp || !state.recentCount;
    // 回到单产品视图时补算一次：对比视图里可能改过无风险利率
    if (!isCmp && cmp.rfDirty) {
      cmp.rfDirty = false;
      syncRfInputs();
      if (state.result) render(false);
      setTimeout(function () { CH.resizeAll(); }, 30);
    }
  }

  function syncRfInputs() {
    var v = (state.rf * 100).toFixed(1);
    if ($('cmpRf')) $('cmpRf').value = v;
    if ($('inpRf')) $('inpRf').value = v;
    if ($('rfVal')) $('rfVal').textContent = v + '%';
    if ($('rfEcho')) $('rfEcho').textContent = pct(state.rf);
  }

  function openCompare() {
    showView('compare');
    if (!AR) { toast('档案模块未加载，无法对比'); return; }
    syncRfInputs();
    fillCmpBase();
    if (cmp.indexOpen) renderCmpIndexList();
    if (cmp.pfOpen) renderPfPanel(true);
    // 对比页是明确的「要比一比」动作，这里后台补一次指数数据，让超额基线下拉完整
    if (IL && !IL.ready()) {
      IL.ensure().then(function () {
        fillBenchSelect();
        renderBenchMeta();
        fillCmpBase();
        if (cmp.indexOpen) renderCmpIndexList();
      }).catch(function () { /* 失败时保持只有第一只产品可选 */ });
    }
    if (!cmp.records.length) loadCompareRecords();
    else renderCmpList();
    rebuildCompare();
    setTimeout(function () { CH.resizeAll(); }, 60);
  }

  function loadCompareRecords() {
    var box = $('cmpList');
    box.innerHTML = '';
    box.appendChild(el('p', 'arch-empty', '正在读取档案…'));
    AR.list().then(function (rows) {
      var mem = cmp.mem || [];
      cmp.records = mem.concat(rows.filter(function (r) { return r.kind !== 'snapshot'; }));
      renderCmpList();
      rebuildCompare();
    }).catch(function (e) {
      box.innerHTML = '';
      box.appendChild(el('p', 'arch-empty', '读取档案失败：' + (e && e.message ? e.message : e)));
    });
  }

  function updateCmpCount() {
    var c = $('cmpCount');
    if (!c) return;
    var n = cmp.selected.length + (cmp.pfItem ? 1 : 0);
    c.textContent = n + ' / ' + CMP.MAX_ITEMS;
  }

  function renderCmpList() {
    var box = $('cmpList');
    if (!box) return;
    box.innerHTML = '';
    if (!cmp.records.length) {
      var em = el('div', 'arch-empty');
      em.innerHTML = '还没有可用档案。<br>先拖入 Excel 分析一次，会自动存档。';
      box.appendChild(em);
      updateCmpCount();
      return;
    }
    var kw = (cmp.filter || '').trim().toLowerCase();
    var rows = cmp.records.filter(function (r) {
      if (!kw) return true;
      var L = cmp.loaded[cmpKey(r)];
      var pn = (L && L.ok) ? L.products.map(function (p) { return p.name; }).join(' ') : '';
      return ((r.displayName || '') + ' ' + r.name + ' ' + pn).toLowerCase().indexOf(kw) >= 0;
    });
    if (!rows.length) {
      box.appendChild(el('p', 'arch-empty', '没有匹配的档案'));
      updateCmpCount();
      return;
    }
    rows.forEach(function (r) { box.appendChild(cmpItem(r)); });
    updateCmpCount();
    if (cmp.pfOpen) renderPfPanel(false);
  }

  function selectedOf(key) {
    for (var i = 0; i < cmp.selected.length; i++) {
      if (cmp.selected[i].key === key) return cmp.selected[i];
    }
    return null;
  }

  function selectedList(baseKey) {
    return cmp.selected.filter(function (s) { return s.baseKey === baseKey; });
  }

  function cmpItem(rec) {
    var base = cmpKey(rec);
    var mine = selectedList(base);
    var on = mine.length > 0;
    var it = el('div', 'cmp-item' + (on ? ' on' : ''));
    var top = el('div', 'cmp-item-top');

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = on;
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    cb.addEventListener('change', function () { toggleCmpItem(rec, cb.checked); });
    top.appendChild(cb);

    var nm = el('span', 'cmp-item-name', rec.displayName || rec.name);
    nm.title = rec.name;
    top.appendChild(nm);
    it.appendChild(top);

    it.addEventListener('click', function (e) {
      if (e.target === cb) return;
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
      cb.checked = !cb.checked;
      toggleCmpItem(rec, cb.checked);
    });

    var meta = el('div', 'cmp-item-meta');
    if (rec.mem) {
      meta.appendChild(el('span', null, '本次文件 · 未存档'));
    } else {
      meta.appendChild(el('span', null, AR.fmtTime(rec.savedAt)));
      meta.appendChild(el('span', null, AR.fmtSize(rec.size)));
      meta.appendChild(el('span', null, rec.source === 'disk' ? '本机' : '浏览器'));
    }
    it.appendChild(meta);

    var L = cmp.loaded[base];
    if (!L) {
      it.appendChild(el('div', 'cmp-item-meta', '正在识别产品…'));
      ensureCmpLoaded(rec).then(function () { if (cmp.open) renderCmpList(); });
    } else if (!L.ok) {
      it.appendChild(el('div', 'cmp-item-err', '解析失败：' + (L.error || '未知原因')));
    } else if (L.products.length > 1) {
      cb.indeterminate = on && mine.length < L.products.length;
      var chips = el('div', 'cmp-prods');
      L.products.forEach(function (p, idx) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'cmp-prod' + (selectedOf(base + '#' + idx) ? ' on' : '');
        chip.textContent = p.name;
        chip.title = p.name + ' · ' + p.count + ' 点（点击加入/移出对比）';
        chip.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleCmpProduct(rec, idx);
        });
        chips.appendChild(chip);
      });
      it.appendChild(el('div', 'cmp-item-meta', '点产品名加入对比，可多选'));
      it.appendChild(chips);
    } else if (L.products.length === 1) {
      it.appendChild(el('div', 'cmp-item-meta', L.products[0].name + ' · ' + L.products[0].count + ' 点'));
    }
    return it;
  }

  function ensureCmpLoaded(rec) {
    var key = cmpKey(rec);
    if (cmp.loaded[key]) return Promise.resolve(cmp.loaded[key]);
    return CMP.loadArchive(rec).then(function (res) {
      cmp.loaded[key] = res;
      return res;
    });
  }

  /* 勾选整份档案：加入它的全部产品（受限 6 个上限）；取消则全部移出 */
  function toggleCmpItem(rec, on) {
    var base = cmpKey(rec);
    var mine = selectedList(base);
    var L = cmp.loaded[base];
    var total = (L && L.ok && L.products.length) ? L.products.length : 1;

    if (!on) {
      mine.forEach(function (s) { cmp.selected.splice(cmp.selected.indexOf(s), 1); });
      renderCmpList();
      updateCmpCount();
      rebuildCompare();
      return;
    }

    if (mine.length >= total) return;
    var room = CMP.MAX_ITEMS - cmp.selected.length;
    if (room <= 0) {
      toast('最多同时对比 ' + CMP.MAX_ITEMS + ' 个对象，先取消一个再选');
      renderCmpList();
      return;
    }
    var add = [];
    for (var i = 0; i < total; i++) {
      if (!selectedOf(base + '#' + i)) add.push(i);
    }
    var wanted = add.length;
    add = add.slice(0, room);
    add.forEach(function (idx) {
      cmp.selected.push({
        key: base + '#' + idx, baseKey: base, kind: 'archive', rec: rec, productIdx: idx
      });
    });
    if (add.length < wanted) {
      toast('最多同时对比 ' + CMP.MAX_ITEMS + ' 个，已加入前 ' + add.length + ' 只');
    }
    ensureCmpLoaded(rec).then(function () {
      if (!cmp.open) return;
      renderCmpList();
      rebuildCompare();
    });
    renderCmpList();
    renderPfPanel(false);
    updateCmpCount();
    rebuildCompare();
  }

  /* 单只产品：点产品名加入/移出，同一档案可同时选多只 */
  function toggleCmpProduct(rec, idx) {
    var base = cmpKey(rec);
    var key = base + '#' + idx;
    var sel = selectedOf(key);
    if (sel) {
      cmp.selected.splice(cmp.selected.indexOf(sel), 1);
    } else {
      if (cmp.selected.length >= CMP.MAX_ITEMS) {
        toast('最多同时对比 ' + CMP.MAX_ITEMS + ' 个对象，先取消一个再选');
        renderCmpList();
        return;
      }
      cmp.selected.push({ key: key, baseKey: base, kind: 'archive', rec: rec, productIdx: idx });
      ensureCmpLoaded(rec).then(function () {
        if (!cmp.open) return;
        renderCmpList();
        rebuildCompare();
      });
    }
    renderCmpList();
    renderPfPanel(false);
    updateCmpCount();
    rebuildCompare();
  }

  /* ---------------- 当前文件（内存数据源） ---------------- */
  function clearMemSource(silent) {
    if (!cmp || !cmp.mem || !cmp.mem.length) return;
    var keys = {};
    cmp.mem.forEach(function (r) { keys[r.memKey] = 1; delete cmp.loaded[r.memKey]; });
    cmp.selected = cmp.selected.filter(function (s) {
      return !(s.baseKey && keys[s.baseKey]);
    });
    cmp.mem = [];
    cmp.records = (cmp.records || []).filter(function (r) { return !r.mem; });
    if (!silent && cmp.open) {
      renderCmpList();
      updateCmpCount();
      rebuildCompare();
    }
  }

  function compareCurrentFile() {
    var res = state.result;
    if (!res || !res.products || res.products.length < 2) {
      toast('这个文件里只识别到 1 只产品，用档案勾选即可');
      return;
    }
    clearMemSource(true);

    var memKey = 'mem|' + state.fileName;
    var rec = {
      source: 'memory', mem: true, memKey: memKey,
      name: state.fileName, displayName: state.fileName,
      savedAt: Date.now(), size: 0, kind: 'product', hasSnapshot: false
    };
    cmp.loaded[memKey] = { ok: true, products: res.products, fileName: state.fileName };
    cmp.mem = [rec];
    cmp.records = [rec].concat((cmp.records || []).filter(function (r) { return !r.mem; }));

    var room = CMP.MAX_ITEMS - cmp.selected.length;
    var take = Math.min(res.products.length, room);
    if (take <= 0) {
      toast('已选满 ' + CMP.MAX_ITEMS + ' 个，先取消一些再加入本文件产品');
    } else {
      for (var i = 0; i < take; i++) {
        cmp.selected.push({
          key: memKey + '#' + i, baseKey: memKey, kind: 'archive', rec: rec, productIdx: i
        });
      }
      if (res.products.length > take) {
        toast('共 ' + res.products.length + ' 只，已先加入前 ' + take + ' 只');
      }
    }
    openCompare();
  }

  /* ---------------- 对比页：内置指数区 ---------------- */
  function toggleCmpIndex(code, on) {
    var key = 'idx:' + code;
    var sel = selectedOf(key);
    if (on) {
      if (sel) return;
      if (cmp.selected.length >= CMP.MAX_ITEMS) {
        toast('最多同时对比 ' + CMP.MAX_ITEMS + ' 个对象，先取消一个再选');
        renderCmpIndexList();
        return;
      }
      cmp.selected.push({ key: key, kind: 'index', code: code });
    } else if (sel) {
      cmp.selected.splice(cmp.selected.indexOf(sel), 1);
    }
    renderCmpIndexList();
    updateCmpCount();
    rebuildCompare();
  }

  function renderCmpIndexList() {
    var box = $('cmpIndexList');
    if (!box || box.hidden) return;
    if (!IL) { box.innerHTML = '<p class="arch-empty">指数模块未加载</p>'; return; }
    if (!IL.ready()) {
      box.innerHTML = '<p class="arch-empty">正在载入指数数据…</p>';
      IL.ensure().then(function () {
        fillBenchSelect();
        renderBenchMeta();
        fillCmpBase();
        renderCmpIndexList();
      }).catch(function (e) {
        box.innerHTML = '<p class="arch-empty">指数数据加载失败：' + esc(e && e.message ? e.message : e) + '</p>';
      });
      return;
    }
    box.innerHTML = '';
    IL.groups().forEach(function (g) {
      box.appendChild(el('div', 'cmp-index-group', g.group));
      g.items.forEach(function (it) {
        var key = 'idx:' + it.code;
        var on = !!selectedOf(key);
        var row = el('label', 'cmp-index-item' + (on ? ' on' : ''));
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = on;
        cb.addEventListener('change', function () { toggleCmpIndex(it.code, cb.checked); });
        row.appendChild(cb);
        row.appendChild(el('span', 'cmp-index-name', it.name));
        row.appendChild(el('span', 'cmp-index-code', it.code));
        box.appendChild(row);
      });
    });
  }

  /* ---------------- 对比页：组合净值 ---------------- */
  function pfMembers() {
    var out = [], seen = {};
    cmp.selected.forEach(function (s) {
      if (s.kind === 'index') return;
      var L = cmp.loaded[s.baseKey || s.key];
      if (!L || !L.ok || !L.products.length) return;
      var p = L.products[Math.min(s.productIdx || 0, L.products.length - 1)];
      if (!p || seen[p.name]) return;     // 同一只产品只进组合一次
      seen[p.name] = 1;
      out.push({ key: s.key, name: p.name, series: p });
    });
    return out;
  }

  function pfSum() {
    var sum = 0;
    pfMembers().forEach(function (m) { sum += (+cmp.pfWeights[m.key] || 0); });
    return sum;
  }

  function updatePfSum() {
    var s = $('cmpPfSum');
    if (s) s.textContent = '合计 ' + pfSum().toFixed(1) + '%';
  }

  function renderPfCur() {
    var box = $('cmpPfCur');
    if (!box) return;
    if (!cmp.pfItem) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = '';
    box.appendChild(el('span', 'cmp-pf-badge', cmp.pfItem.name));
    if (cmp.pfDirty) box.appendChild(el('span', 'cmp-pf-warn', '权重已改，点「生成组合」更新'));
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn ghost xs';
    del.textContent = '移除';
    del.addEventListener('click', function () {
      cmp.pfItem = null;
      cmp.pfDirty = false;
      renderPfCur();
      updateCmpCount();
      rebuildCompare();
    });
    box.appendChild(del);
  }

  function renderPfPanel(force) {
    var box = $('cmpPfList');
    if (!box) return;
    var members = pfMembers();

    if (cmp.pfItem) {
      var nowKeys = members.map(function (m) { return m.key; }).join('|');
      if (nowKeys !== cmp.pfItem.memberKeys) {
        cmp.pfItem = null;
        cmp.pfDirty = false;
        renderPfCur();
        updateCmpCount();
        if (cmp.open) rebuildCompare();
        toast('组合成员有变化，请重新生成组合');
      }
    }

    var sig = members.map(function (m) { return m.key + '|' + m.name; }).join(';');
    if (!force && box.getAttribute('data-sig') === sig) {
      updatePfSum();
      return;
    }
    box.setAttribute('data-sig', sig);

    // 没手动改过的成员随人数自动等权，改过的保留
    var even = Math.round(1000 / Math.max(1, members.length)) / 10;
    members.forEach(function (m) {
      if (!cmp.pfTouched[m.key]) cmp.pfWeights[m.key] = even;
    });
    Object.keys(cmp.pfWeights).forEach(function (k) {
      if (!members.some(function (m) { return m.key === k; })) {
        delete cmp.pfWeights[k];
        delete cmp.pfTouched[k];
      }
    });

    box.innerHTML = '';
    if (!members.length) {
      box.appendChild(el('p', 'arch-empty', '先在上方勾选产品，再回来配权重'));
    }
    members.forEach(function (m) {
      var row = el('div', 'cmp-pf-row');
      row.appendChild(el('span', 'cmp-pf-name', m.name));
      var w = el('span', 'cmp-pf-w');
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.min = '0';
      inp.step = '5';
      inp.value = String(Math.round((+cmp.pfWeights[m.key] || 0) * 10) / 10);
      inp.addEventListener('input', function () {
        var v = parseFloat(inp.value);
        cmp.pfWeights[m.key] = isFinite(v) && v > 0 ? v : 0;
        cmp.pfTouched[m.key] = true;
        cmp.pfDirty = !!cmp.pfItem;
        updatePfSum();
        renderPfCur();
      });
      w.appendChild(inp);
      w.appendChild(el('span', 'cmp-pf-pct', '%'));
      row.appendChild(w);
      box.appendChild(row);
    });
    updatePfSum();
    renderPfCur();
  }

  function buildPortfolio() {
    var members = pfMembers();
    if (members.length < 2) { toast('至少选 2 只不同产品才能生成组合'); return; }
    if (cmp.selected.length >= CMP.MAX_ITEMS) {
      toast('已选满 ' + CMP.MAX_ITEMS + ' 个，组合会超出上限，先取消一个');
      return;
    }
    var sum = pfSum();
    if (!(sum > 0)) { toast('权重合计需大于 0'); return; }

    var dates = members[0].series.ts.slice();
    for (var i = 1; i < members.length; i++) {
      var set = {};
      for (var j = 0; j < members[i].series.ts.length; j++) set[members[i].series.ts[j]] = 1;
      dates = dates.filter(function (t) { return set[t] === 1; });
    }
    if (dates.length < 2) { toast('这些成员之间没有共同净值日期'); return; }

    var nav = new Array(dates.length);
    for (var k = 0; k < dates.length; k++) nav[k] = 0;
    var used = 0;
    members.forEach(function (m) {
      var s = { ts: m.series.ts, nav: m.series.nav };
      var base = valAt(s, dates[0]);
      var w = (+cmp.pfWeights[m.key] || 0) / sum;
      if (!(base > 0) || !(w > 0)) return;
      used++;
      for (var q = 0; q < dates.length; q++) nav[q] += w * (valAt(s, dates[q]) / base);
    });
    if (used < 2) { toast('至少需要 2 个有效权重'); return; }

    cmp.pfItem = {
      key: 'pf',
      name: '组合（' + used + ' 只）',
      memberKeys: members.map(function (m) { return m.key; }).join('|'),
      members: members.map(function (m) { return m.name; }),
      series: { ts: dates, nav: nav, labels: [] }
    };
    cmp.pfDirty = false;
    renderPfCur();
    updateCmpCount();
    rebuildCompare();
    toast('已生成组合：' + used + ' 只，权重已归一');
  }

  /* 超额基线下拉：第一只产品 / 已上传基准 / 任意内置指数 */
  function fillCmpBase() {
    var sel = $('cmpBase');
    if (!sel) return;
    var cur = cmp.baseline || 'first';
    sel.innerHTML = '';
    var first = document.createElement('option');
    first.value = 'first';
    first.textContent = '第一只产品';
    sel.appendChild(first);

    if (state.benchmark) {
      var ob = document.createElement('option');
      ob.value = 'bench';
      ob.textContent = '已有基准：' + shortLabel(state.benchName || '基准', 12);
      sel.appendChild(ob);
    }
    if (IL && IL.ready()) {
      IL.groups().forEach(function (g) {
        var og = document.createElement('optgroup');
        og.label = g.group;
        g.items.forEach(function (it) {
          var o = document.createElement('option');
          o.value = 'idx:' + it.code;
          o.textContent = it.name;
          og.appendChild(o);
        });
        sel.appendChild(og);
      });
    }
    var keep = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === cur) { keep = true; break; }
    }
    sel.value = keep ? cur : 'first';
    cmp.baseline = sel.value;
  }

  function shortLabel(s, n) {
    var t = String(s || '');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function makeCmpLabels(items) {
    var seen = {};
    items.forEach(function (it) {
      var base = shortLabel(it.name, 14);
      var lab = base, k = 1;
      while (seen[lab]) { k++; lab = base + '·' + k; }
      seen[lab] = 1;
      it.label = lab;
    });
  }

  function showCmpEmpty(title, text) {
    $('cmpResult').hidden = true;
    $('cmpEmpty').hidden = false;
    $('cmpEmptyTitle').textContent = title;
    $('cmpEmptyText').textContent = text;
    $('cmpSummary').textContent = cmp.selected.length ? ('已选 ' + cmp.selected.length + ' 个') : '尚未选择';
    $('cmpSub').textContent = cmp.records.length
      ? '从左侧勾选档案或内置指数开始对比'
      : '档案为空，先拖入 Excel 分析并存档';
    $('cmpWarn').hidden = true;
  }

  function rebuildCompare() {
    updateCmpCount();
    if (!cmp.selected.length) {
      cmp.result = null;
      showCmpEmpty('从左侧勾选 2 只以上产品开始对比', '对比数据来自「档案」里已存档的 Excel；每份档案可挑一只产品。');
      return;
    }
    var items = [];
    var notLoaded = [];
    var needIndex = false;
    cmp.selected.forEach(function (s) {
      if (s.kind === 'index') {
        if (!IL || !IL.ready()) { needIndex = true; return; }
        var ser = IL.series(s.code, false);
        if (!ser) return;
        items.push({
          key: s.key,
          name: ser.name,
          isIndex: true,
          series: { ts: ser.ts, nav: ser.nav, labels: [] }
        });
        return;
      }
      var L = cmp.loaded[s.baseKey || s.key];
      if (!L) { notLoaded.push(s); return; }
      if (!L.ok || !L.products.length) return;
      var p = L.products[Math.min(s.productIdx, L.products.length - 1)] || L.products[0];
      items.push({
        key: s.key,
        name: p.name,
        rec: s.rec,
        productIdx: s.productIdx,
        series: { ts: p.ts, nav: p.nav, labels: p.labels }
      });
    });

    if (needIndex) {
      showCmpEmpty('正在载入指数数据…', '首次使用内置指数需下载约 0.7MB，之后走浏览器缓存。');
      IL.ensure().then(function () {
        fillBenchSelect();
        fillCmpBase();
        if (cmp.open) rebuildCompare();
      }).catch(function (e) {
        showCmpEmpty('指数数据加载失败', (e && e.message) || '请确认 assets/indices.js 存在');
      });
      return;
    }

    if (notLoaded.length) {
      showCmpEmpty('正在解析档案…', '首次读取需要一点时间，稍候会自动出结果。');
      Promise.all(notLoaded.map(function (s) { return ensureCmpLoaded(s.rec); })).then(function () {
        if (cmp.open) rebuildCompare();
      });
      return;
    }

    if (cmp.pfItem && cmp.pfItem.series) {
      items.push({
        key: 'pf',
        name: cmp.pfItem.name,
        isPortfolio: true,
        series: cmp.pfItem.series
      });
    }

    if (items.length < 2) {
      cmp.result = null;
      if (items.length === 0) {
        showCmpEmpty('这些档案里没有可用的净值序列', '换一份档案，或先在单产品分析里确认能正常出图。');
      } else if (cmp.selected.length === 1) {
        showCmpEmpty('再选 1 个对象就能开始对比', '已经选好 1 个，再从左侧勾选一只产品或一条指数即可。');
      } else {
        showCmpEmpty('可用对象不足 2 个', '有的档案解析失败，请检查后重试。');
      }
      return;
    }

    // 超额基线：第一只产品 / 已上传基准 / 任意内置指数
    var bench = null, baseline = 'first';
    if (cmp.baseline === 'bench' && state.benchmark) {
      bench = state.benchmark;
      baseline = 'bench';
    } else if (cmp.baseline && cmp.baseline.indexOf('idx:') === 0 && IL && IL.ready()) {
      var bs = IL.series(cmp.baseline.slice(4), false);
      if (bs) {
        bench = { name: bs.name, ts: bs.ts, nav: bs.nav };
        baseline = 'bench';
      }
    }

    makeCmpLabels(items);
    var res = CMP.build(items, {
      rf: state.rf,
      align: cmp.align,
      baseline: baseline,
      bench: bench
    });
    cmp.result = res;
    if (!res.ok) {
      showCmpEmpty(res.reason === 'no-overlap' ? '没有共同净值日期' : '无法对比', res.message || '');
      if (res.warnings && res.warnings.length) {
        $('cmpWarn').hidden = false;
        $('cmpWarn').textContent = res.warnings.join('；');
      }
      return;
    }
    renderCmpResult(res);
  }

  function fmtCmpVal(v, kind) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (kind === 'pct') return (v * 100).toFixed(2) + '%';
    if (kind === 'ratio') return v.toFixed(2);
    if (kind === 'days') return Math.round(v) + ' 天';
    return String(v);
  }

  function renderCmpTable(res) {
    var t = $('cmpTable');
    t.innerHTML = '';

    var thead = document.createElement('thead');
    var gr = el('tr', 'cmp-group');
    gr.appendChild(el('th', null, ''));
    var g1 = el('th', null, '收益与风险（产品各自区间 · 指数共同区间）');
    g1.colSpan = res.cols.length;
    gr.appendChild(g1);
    var g2 = el('th', null, '区间收益');
    g2.colSpan = res.periodCols.length;
    gr.appendChild(g2);
    thead.appendChild(gr);

    var hr = el('tr');
    hr.appendChild(el('th', null, '产品 / 数据区间'));
    res.cols.forEach(function (c) { hr.appendChild(el('th', null, c.label)); });
    res.periodCols.forEach(function (c) { hr.appendChild(el('th', null, c.label)); });
    thead.appendChild(hr);
    t.appendChild(thead);

    var tb = el('tbody');
    res.items.forEach(function (it) {
      var m = it.metrics;
      var tr = el('tr', it.isIndex ? 'cmp-row-index' : '');

      var tdName = el('td');
      var box = el('div', 'cmp-name');
      var dot = el('span', 'cmp-dot');
      dot.style.background = it.color;
      box.appendChild(dot);
      var nm = el('span', 'cmp-nm-txt', it.name);
      nm.title = it.name;
      box.appendChild(nm);
      if (it.isIndex) box.appendChild(el('span', 'cmp-index-badge', '指数'));
      if (it.isPortfolio) box.appendChild(el('span', 'cmp-index-badge', '组合'));
      tdName.appendChild(box);
      tdName.appendChild(el('div', 'cmp-range', (m ? m.start : '') + ' ~ ' + (m ? m.end : '')));
      tr.appendChild(tdName);

      res.cols.forEach(function (c) {
        var v = m ? m[c.key] : null;
        var cls = [];
        if (res.best[c.key] === it.key) cls.push('best');
        if (c.fmt === 'pct' && c.key !== 'annVol' && c.key !== 'maxDD' && v !== null && isFinite(v)) {
          cls.push(v > 0 ? 'pos' : (v < 0 ? 'neg' : ''));
        }
        tr.appendChild(el('td', cls.join(' '), fmtCmpVal(v, c.fmt)));
      });

      res.periodCols.forEach(function (c) {
        var v = (m && m.periods) ? m.periods[c.key] : null;
        var cls = (v !== null && v !== undefined && isFinite(v)) ? (v > 0 ? 'pos' : (v < 0 ? 'neg' : '')) : 'muted';
        tr.appendChild(el('td', cls, fmtCmpVal(v, 'pct')));
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  function renderCmpResult(res) {
    $('cmpEmpty').hidden = true;
    $('cmpResult').hidden = false;

    $('cmpSummary').textContent = '已选 ' + res.items.length + ' 个 · '
      + (res.align === 'common'
        ? ('共同区间 ' + res.start + ' 至 ' + res.end + ' · ' + res.points + ' 期')
        : ('各自起点 · 合并 ' + res.points + ' 个日期'));
    var prodCount = res.items.length - (res.indexCount || 0);
    $('cmpSub').textContent = '无风险利率 ' + pct(state.rf)
      + (prodCount ? ' · 产品按各自完整区间' : '')
      + (res.hasIndex ? ' · 指数按共同区间' : '');

    var warn = $('cmpWarn');
    if (res.warnings && res.warnings.length) {
      warn.hidden = false;
      warn.textContent = res.warnings.join('；');
    } else {
      warn.hidden = true;
    }

    $('cmpNavNote').textContent = (res.align === 'common'
      ? '起点归一为 1（共同区间）' : '各自起点归一为 1')
      + (res.hasIndex ? ' · 指数为虚线' : '');
    $('cmpExcessNote').textContent = '相对「' + res.excess.baseName + '」· 0 轴为持平';

    renderCmpTable(res);

    CH.renderCompareNav('cmpChartNav', res.overlay);
    CH.renderComparePeriod('cmpChartPeriod', res.period);

    if (res.excess.series.length) {
      $('cmpChartExcess').hidden = false;
      CH.renderCompareExcess('cmpChartExcess', res.excess);
    } else {
      CH.clear('cmpChartExcess');
      $('cmpChartExcess').hidden = true;
    }

    if (res.corr) {
      $('cmpChartCorr').hidden = false;
      $('cmpCorrEmpty').hidden = true;
      CH.renderCorr('cmpChartCorr', res.corr);
      $('cmpCorrNote').textContent = '期收益 Pearson · 样本 ' + res.corr.n + ' 期';
    } else {
      $('cmpChartCorr').hidden = true;
      $('cmpCorrEmpty').hidden = false;
      $('cmpCorrNote').textContent = '需共同日期';
    }

    CH.renderCompareHeat('cmpChartHeat', res.heat);
    setTimeout(function () { CH.resizeAll(); }, 30);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('btnPick').addEventListener('click', function (e) { e.stopPropagation(); $('fileInput').click(); });
    $('dropzone').addEventListener('click', function () { $('fileInput').click(); });
    $('dropzone').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); }
    });
    $('dropzone').addEventListener('dragover', function (e) {
      e.preventDefault(); e.stopPropagation();
      $('dropzone').classList.add('dragging');
    });
    $('dropzone').addEventListener('dragleave', function () { $('dropzone').classList.remove('dragging'); });
    $('dropzone').addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation();
      $('dropzone').classList.remove('dragging');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleFile(f);
    });

    $('btnDemo').addEventListener('click', function (e) {
      e.stopPropagation();
      var rows = NA.demo.rows();
      applyParsed({ fileName: NA.demo.fileName, sheets: [{ name: '演示 · 周频净值', rows: rows }] }, true);
    });

    $('fileInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      handleFile(f);
      e.target.value = '';
    });
    $('btnChangeFile').addEventListener('click', function () { $('fileInput').click(); });

    // 整窗拖拽
    var dragDepth = 0;
    document.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      dragDepth++;
      $('dragOverlay').hidden = false;
    });
    document.addEventListener('dragleave', function () {
      dragDepth--;
      if (dragDepth <= 0) { dragDepth = 0; $('dragOverlay').hidden = true; }
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      $('dragOverlay').hidden = true;
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    // 口径抽屉
    $('btnGlossary').addEventListener('click', function () {
      $('glossary').hidden = false;
    });
    $('btnCloseGlossary').addEventListener('click', function () { $('glossary').hidden = true; });
    $('glossary').addEventListener('click', function (e) {
      if (e.target === $('glossary')) $('glossary').hidden = true;
    });
    // 档案抽屉
    $('btnArchive').addEventListener('click', openArchive);
    $('btnArchList').addEventListener('click', openArchive);
    $('btnCloseArchive').addEventListener('click', function () { $('archive').hidden = true; });
    $('archive').addEventListener('click', function (e) {
      if (e.target === $('archive')) $('archive').hidden = true;
    });
    $('btnBackArch').addEventListener('click', showArchList);
    $('btnRefreshArch').addEventListener('click', function () {
      renderArchiveList();
      updateArchCount();
    });
    $('btnArchZip').addEventListener('click', exportAllZip);
    $('btnOpenFolder').addEventListener('click', function () {
      AR.openFolder().then(function () { toast('已在资源管理器打开档案文件夹'); })
        .catch(function (e) { toast('打开失败：' + (e && e.message ? e.message : e)); });
    });
    $('btnMigrate').addEventListener('click', migrateArchives);
    $('btnRecentAll').addEventListener('click', openArchive);
    $('btnRecentRefresh').addEventListener('click', function () {
      updateArchCount();
      toast('已刷新最近上传');
    });

    // 业绩对比
    $('btnCompare').addEventListener('click', function () {
      if (cmp.open) showView('analyze');
      else openCompare();
    });
    $('cmpSearch').addEventListener('input', function () {
      cmp.filter = this.value;
      renderCmpList();
    });
    $('cmpClear').addEventListener('click', function () {
      cmp.selected = [];
      cmp.baseline = 'first';
      cmp.pfItem = null;
      cmp.pfDirty = false;
      cmp.pfWeights = {};
      cmp.pfTouched = {};
      renderCmpList();
      renderCmpIndexList();
      renderPfPanel(true);
      fillCmpBase();
      rebuildCompare();
    });
    $('cmpIndexToggle').addEventListener('click', function () {
      cmp.indexOpen = !cmp.indexOpen;
      $('cmpIndexList').hidden = !cmp.indexOpen;
      this.textContent = cmp.indexOpen ? '收起' : '展开';
      this.setAttribute('aria-expanded', cmp.indexOpen ? 'true' : 'false');
      renderCmpIndexList();
    });
    $('cmpPfToggle').addEventListener('click', function () {
      cmp.pfOpen = !cmp.pfOpen;
      $('cmpPfBody').hidden = !cmp.pfOpen;
      this.textContent = cmp.pfOpen ? '收起' : '展开';
      this.setAttribute('aria-expanded', cmp.pfOpen ? 'true' : 'false');
      if (cmp.pfOpen) renderPfPanel(true);
    });
    $('cmpPfBuild').addEventListener('click', buildPortfolio);
    var segBtns = document.querySelectorAll('#cmpAlign .seg-btn');
    for (var si = 0; si < segBtns.length; si++) {
      (function (b) {
        b.addEventListener('click', function () {
          cmp.align = b.getAttribute('data-align');
          for (var k = 0; k < segBtns.length; k++) {
            segBtns[k].classList.toggle('is-on', segBtns[k] === b);
          }
          rebuildCompare();
        });
      })(segBtns[si]);
    }
    $('cmpBase').addEventListener('change', function () {
      var v = this.value;
      if (v === 'bench' && !state.benchmark) {
        toast('还没有载入基准，先在单产品分析里选择内置指数或上传文件');
        v = 'first';
      } else if (v.indexOf('idx:') === 0 && !(IL && IL.ready())) {
        toast('指数数据还在加载，稍后再试');
        v = 'first';
      }
      this.value = v;
      cmp.baseline = v;
      rebuildCompare();
    });
    $('cmpRf').addEventListener('change', function () {
      var v = parseFloat(this.value);
      if (!isFinite(v) || v < 0) v = 0;
      if (v > 20) v = 20;
      state.rf = v / 100;
      cmp.rfDirty = true;
      syncRfInputs();
      rebuildCompare();
    });
    $('cmpGoAnalyze').addEventListener('click', function () { showView('analyze'); });
    $('cmpOpenArchive').addEventListener('click', openArchive);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $('glossary').hidden = true;
        if ($('archive')) $('archive').hidden = true;
      }
    });

    // 映射
    $('selSheet').addEventListener('change', function () {
      state.sheetIdx = +this.value;
      state.override = {};
      state.productIdx = 0;
      var r = P.analyze(state.sheets[state.sheetIdx].rows, {});
      if (!r.ok) { toast(r.error); return; }
      state.result = r;
      resetRangeInputs();
      renderMapping();
      render(true);
      toast('已切换到工作表「' + state.sheets[state.sheetIdx].name + '」');
    });

    $('selProduct').addEventListener('change', function () {
      state.productIdx = +this.value;
      renderFilebar();
      render(false);
    });

    // 数据预览折叠
    if ($('btnPreviewToggle')) {
      $('btnPreviewToggle').addEventListener('click', function () {
        var body = $('previewBody');
        var open = body.hidden;
        body.hidden = !open;
        this.textContent = open ? '收起' : '展开';
        this.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) renderPreview();
      });
    }

    // 风格暴露
    if ($('btnStyleRun')) {
      $('btnStyleRun').addEventListener('click', function () {
        if (!state.result) return;
        state.styleExp = null;
        if (IL && IL.ready()) { renderStylePanel(); return; }
        var btn = this;
        btn.disabled = true;
        btn.textContent = '载入中…';
        IL.ensure().then(function () {
          fillBenchSelect();
          renderBenchMeta();
          renderStylePanel();
        }).catch(function (e) {
          btn.disabled = false;
          btn.textContent = '载入并计算';
          toast(e && e.message ? e.message : '指数数据加载失败');
        });
      });
    }

    function remap() {
      var dateCol = +$('selDateCol').value;
      var navCol = +$('selNavCol').value;
      var isLong = state.result && state.result.structure === 'long';
      // 保留预览表里设置的「忽略列」，但用户在这里明确挑的净值列不再忽略
      var keep = (state.override && state.override.ignoreCols) ? state.override.ignoreCols.slice() : [];
      if (navCol >= 0) {
        var at = keep.indexOf(navCol);
        if (at >= 0) keep.splice(at, 1);
      }
      var ov = { dateCol: dateCol, navCol: navCol, mode: isLong ? 'long' : 'auto' };
      if (isLong && !$('selProdColWrap').hidden) ov.productCol = +$('selProdCol').value;
      if (keep.length) ov.ignoreCols = keep;
      applyOverride(ov);
    }
    $('selDateCol').addEventListener('change', remap);
    $('selNavCol').addEventListener('change', remap);
    $('selProdCol').addEventListener('change', remap);

    // 区间
    $('rngFrom').addEventListener('change', function () {
      var v = dateToTs(this.value);
      var to = dateToTs($('rngTo').value);
      if (v !== null && to !== null && v > to) { toast('起始日期不能晚于结束日期'); this.value = $('rngTo').value; return; }
      state.from = v;
      render(false);
    });
    $('rngTo').addEventListener('change', function () {
      var v = dateToTs(this.value);
      var from = dateToTs($('rngFrom').value);
      if (v !== null && from !== null && v < from) { toast('结束日期不能早于起始日期'); this.value = $('rngFrom').value; return; }
      state.to = v;
      render(false);
    });
    $('btnResetRange').addEventListener('click', function () {
      resetRangeInputs();
      render(false);
      toast('已恢复全部区间');
    });

    // 无风险利率
    $('inpRf').addEventListener('input', function () {
      state.rf = (+this.value) / 100;
      $('rfVal').textContent = (+this.value).toFixed(1) + '%';
      if ($('cmpRf')) $('cmpRf').value = (+this.value).toFixed(1);
      if ($('rfEcho')) $('rfEcho').textContent = pct(state.rf);
      if (state.metrics) render(false);
    });

    // 基准
    $('benchDrop').addEventListener('click', function () { $('benchInput').click(); });
    $('benchDrop').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('benchInput').click(); }
    });
    $('benchDrop').addEventListener('dragover', function (e) {
      e.preventDefault(); e.stopPropagation(); this.classList.add('dragging');
    });
    $('benchDrop').addEventListener('dragleave', function () { this.classList.remove('dragging'); });
    $('benchDrop').addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation();
      this.classList.remove('dragging');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadBenchmark(f);
    });
    $('benchInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) loadBenchmark(f);
      e.target.value = '';
    });
    $('btnClearBench').addEventListener('click', function () { clearBenchmark(); });

    // 内置指数：点开下拉才懒加载数据包
    var benchSel = $('benchIndex');
    if (benchSel) {
      ['mousedown', 'focus', 'keydown'].forEach(function (evt) {
        benchSel.addEventListener(evt, function () { ensureBenchLib(); });
      });
      benchSel.addEventListener('change', function () {
        var code = this.value;
        if (!code) { clearBenchmark(true); return; }
        var pair = IL && IL.pair(code);
        var wantTr = !!state.benchTr && !!(pair && pair.tr);
        useBuiltinIndex(code, wantTr);
      });
    }
    var benchMode = $('benchMode');
    if (benchMode) {
      Array.prototype.forEach.call(benchMode.querySelectorAll('.seg-btn'), function (btn) {
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          var wantTr = btn.getAttribute('data-tr') === '1';
          if (state.benchSource !== 'index' || !state.benchCode) return;
          var pair = IL && IL.pair(state.benchCode);
          if (wantTr && !(pair && pair.tr)) { toast('这条指数暂无全收益数据'); return; }
          useBuiltinIndex(state.benchCode, wantTr);
        });
      });
    }

    // 导出
    $('btnExportCsv').addEventListener('click', exportCsv);
    $('btnExportCsv2').addEventListener('click', exportCsv);
    $('btnCopySummary').addEventListener('click', copySummary);
    $('btnExportSeries').addEventListener('click', exportSeries);

    var pngBtns = document.querySelectorAll('[data-png]');
    for (var i = 0; i < pngBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-png');
          var label = { chartNav: '净值走势', chartDD: '回撤曲线', chartAnnual: '年度收益', chartHeat: '月度热力图' }[id] || id;
          exportPng(id, label);
        });
      })(pngBtns[i]);
    }

    // 自适应
    var rTimer = null;
    global.addEventListener('resize', function () {
      clearTimeout(rTimer);
      rTimer = setTimeout(function () { CH.resizeAll(); }, 120);
    });
    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        clearTimeout(rTimer);
        rTimer = setTimeout(function () { CH.resizeAll(); }, 120);
      });
      ['chartNav', 'chartDD', 'chartAnnual', 'chartHeat'].forEach(function (id) {
        var d = $(id);
        if (d && d.parentElement) ro.observe(d.parentElement);
      });
    }
  }

  function loadBenchmark(file) {
    if (!/\.(xlsx|xls|csv|txt)$/i.test(file.name)) { toast('基准文件格式不支持'); return; }
    busy(true, '正在读取基准序列…');
    var reader = new FileReader();
    reader.onload = function (e) {
      setTimeout(function () {
        try {
          var parsed = P.parseFile(e.target.result, file.name);
          var found = null;
          for (var i = 0; i < parsed.sheets.length && !found; i++) {
            var r = P.analyze(parsed.sheets[i].rows, {});
            if (r.ok && r.products.length) found = r.products[0];
          }
          busy(false);
          if (!found) { toast('基准文件里没有找到净值序列'); return; }
          state.benchmark = found;
          state.benchName = found.name + '（' + file.name + '）';
          state.benchCode = '';
          state.benchTr = false;
          state.benchSource = 'upload';
          renderBenchPanel();
          render(false);
          toast('已载入基准：' + found.name);
          autoArchive(file, 'bench', found);
        } catch (err) {
          busy(false);
          toast('基准解析失败：' + (err && err.message ? err.message : err));
        }
      }, 40);
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------------- 口径说明 ---------------- */
  var GLOSSARY = [
    ['累计收益', '期末净值 ÷ 期初净值 - 1，不年化。', 'r = NAV_last / NAV_first - 1'],
    ['年化收益', '把整段区间的累计收益按 365 日历天折算成年化复利。区间不足 1 个月时数值参考意义有限。', 'ann = (1 + r) ^ (365 / D) - 1，D 为自然日跨度'],
    ['年化波动率', '先按期收益求样本标准差，再乘以每年期数的平方根。每年期数由实际净值频率自动识别（日/周/月）。', 'σ_ann = std(r) × √(N / (D/365))'],
    ['最大回撤', '净值相对历史最高点的最大跌幅，同时记录峰值日、谷底日与修复日。', 'MDD = min((NAV_t - max_{τ≤t} NAV_τ) / max_{τ≤t} NAV_τ)'],
    ['回撤修复天数', '从谷底回到前高所用的自然日；若至今未回到前高，显示「未修复」。', 'days = t_recover - t_trough'],
    ['最长水下时间', '相邻两次创出净值新高之间的最长跨度（自然日），衡量长期深套风险。', 'max(t_{h+1} - t_h)'],
    ['夏普比率', '单位总波动换来的超额收益，需自设有无风险利率。', 'Sharpe = (ann - rf) / σ_ann'],
    ['卡玛比率', '单位最大回撤换来的年化收益，私募更常用的性价比指标。', 'Calmar = ann / |MDD|'],
    ['索提诺比率', '只惩罚下行波动，对上涨波动不计罚。', 'Sortino = (ann - rf) / σ_down'],
    ['单期 95% VaR', '期收益分布的 5% 分位数，表示最差 5% 情形下的单期亏损幅度。', 'VaR = quantile(r, 5%)'],
    ['区间收益', '以最新净值为锚向前推 N 个月，取 ≤ 目标日期的最后一个净值。今年来以上年末最后一个净值为基。', 'r = NAV_last / NAV_target - 1'],
    ['年度 / 月度收益', '年度以上年末最后一个净值为基数；月度以相邻月末净值为基数，缺失月份显示为空白。', 'r = NAV_end / NAV_base - 1'],
    ['超额收益', '产品与基准按「最近交易日」对齐后重算（默认回溯 10 个自然日内取前值），超额年化为复利差值口径。', 'excess_ann = (1 + ann_p) / (1 + ann_b) - 1'],
    ['相对最大回撤', '以「产品 / 基准」比值序列计算历史最高比值的最大跌幅，衡量跑输基准的最深程度。', 'ratio_t = NAV_p,t / NAV_b,t，再对其求回撤'],
    ['数据安全', '页面为纯前端实现，Excel 在浏览器内解析，不上传任何服务器，断网亦可用。', '']
  ];

  function renderGlossary() {
    var box = $('glossaryBody');
    box.innerHTML = '';
    GLOSSARY.forEach(function (g) {
      var it = el('div', 'gl-item');
      it.appendChild(el('h4', null, g[0]));
      it.appendChild(el('p', null, g[1]));
      if (g[2]) {
        var c = el('code', null, g[2]);
        it.appendChild(c);
      }
      box.appendChild(it);
    });
  }

  /* ---------------- 安装到桌面（PWA） ---------------- */
  var installEvt = null;

  function isStandalone() {
    if (global.navigator && global.navigator.standalone === true) return true;
    if (global.matchMedia) {
      try { return global.matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; }
    }
    return false;
  }

  function setupInstall() {
    var btn = $('btnInstall');
    if (!btn) return;
    if (isStandalone()) { btn.hidden = true; return; }

    global.addEventListener('beforeinstallprompt', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      installEvt = e;
      btn.hidden = false;
    });

    global.addEventListener('appinstalled', function () {
      installEvt = null;
      btn.hidden = true;
      toast('已添加到桌面，下次可直接从图标打开');
    });

    btn.addEventListener('click', function () {
      if (installEvt && installEvt.prompt) {
        installEvt.prompt();
        var done = function () { installEvt = null; btn.hidden = true; };
        if (installEvt.userChoice && installEvt.userChoice.then) installEvt.userChoice.then(done, done);
        return;
      }
      var ua = global.navigator.userAgent || '';
      if (/iphone|ipad|ipod/i.test(ua)) {
        toast('点底部「分享」→「添加到主屏幕」即可安装');
      } else {
        toast('在浏览器菜单里选「安装应用 / 添加到主屏幕」');
      }
    });

    // iOS 没有 beforeinstallprompt，主动给出入口
    var ua2 = global.navigator.userAgent || '';
    var iOS = /iphone|ipad|ipod/i.test(ua2) || (/macintosh/i.test(ua2) && global.navigator.maxTouchPoints > 1);
    if (iOS && /^https?:$/.test(global.location.protocol)) btn.hidden = false;
  }

  function isWeChat() {
    return /micromessenger/i.test(global.navigator.userAgent || '');
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    renderGlossary();
    bind();
    renderBenchPanel();
    setupInstall();
    if (isWeChat()) {
      toast('微信内打开功能受限：点右上角「…」选择「在浏览器打开」，可正常选择 Excel 文件');
    }
    NA.debug = {
      state: state, render: render, renderCharts: renderCharts,
      renderBenchPanel: renderBenchPanel, renderDetail: renderDetail, renderKpis: renderKpis,
      autoArchive: autoArchive, refreshArchiveStatus: refreshArchiveStatus,
      cmp: cmp, showView: showView, openCompare: openCompare, rebuildCompare: rebuildCompare
    };
    if (AR) {
      AR.onModeChange(function () { refreshArchiveStatus(); });
      AR.detect().then(refreshArchiveStatus, refreshArchiveStatus);
    }
    $('footStat').textContent = 'SheetJS ' + (global.XLSX && XLSX.version ? XLSX.version : '') + ' · ECharts ' + (global.echarts && echarts.version ? echarts.version : '');
    if (!global.echarts) {
      toast('图表库未加载，请确认 lib/echarts.min.js 存在');
    }
    if (!global.XLSX) {
      toast('Excel 解析库未加载，请确认 lib/xlsx.full.min.js 存在');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
