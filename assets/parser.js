/* =========================================================
   parser.js —— Excel / CSV 结构自动识别与净值序列解析
   支持：宽表（日期 + 多列净值）、长表（产品 / 日期 / 净值）、单序列
   输出统一结构：products: [{ name, ts: [], nav: [], count }]
   ========================================================= */
(function (global) {
  'use strict';

  var NA = global.NAVApp = global.NAVApp || {};

  /* ---------------- 列名别名（与既有周报口径保持一致） ---------------- */
  var ALIAS = {
    date: ['净值日期', '日期', '估值日期', '数据日期', '单位净值日期', '交易日期', '日期(date)', 'date'],
    nav: ['单位净值', '净值', '累计净值', '累计单位净值', '单位净值(元)', '最新单位净值', '产品单位净值', 'nav', '净值(nav)'],
    product: ['产品名称', '基金名称', '私募名称', '产品', '基金', '名称', 'product', 'name']
  };

  /* ---------------- 文本归一化 ---------------- */
  function toHalfWidth(s) {
    return String(s).replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, ' ');
  }

  function normKey(s) {
    return toHalfWidth(s).toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[（）]/g, function (m) { return m === '（' ? '(' : ')'; })
      .replace(/[·・_\-]/g, '');
  }

  function aliasScore(text, list) {
    var t = normKey(text);
    if (!t) return 0;
    var best = 0;
    for (var i = 0; i < list.length; i++) {
      var a = normKey(list[i]);
      if (!a) continue;
      if (t === a) return 3;
      if (t.indexOf(a) >= 0) best = Math.max(best, 2);
      else if (a.length > 3 && t.indexOf(a.slice(0, 3)) >= 0) best = Math.max(best, 1);
    }
    return best;
  }

  /* ---------------- 日期解析 ---------------- */
  var EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

  function ymd(y, m, d) {
    if (!(y > 1800 && y < 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    var t = Date.UTC(y, m - 1, d);
    var dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return { ts: t, text: pad4(y) + '-' + pad2(m) + '-' + pad2(d) };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pad4(n) { return String(n); }

  function parseDate(v) {
    if (v === null || v === undefined || v === '') return null;

    if (v instanceof Date && !isNaN(v.getTime())) {
      // 时区安全：若落在 UTC 零点，按 UTC 取日期，避免跨时区偏移一天
      var utcMidnight = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0;
      if (utcMidnight) return ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
      return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    }

    if (typeof v === 'number' && isFinite(v)) {
      // 20240131 形态
      if (v >= 19000101 && v <= 22001231) {
        return ymd(Math.floor(v / 10000), Math.floor(v / 100) % 100, Math.round(v % 100));
      }
      // Excel 序列值
      if (v > 20000 && v < 80000) {
        var dt = new Date(EXCEL_EPOCH_UTC + Math.round(v) * 86400000);
        return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      }
      return null;
    }

    var s = toHalfWidth(String(v)).trim();
    if (!s) return null;

    // 纯 8 位数字
    var m8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m8) return ymd(+m8[1], +m8[2], +m8[3]);

    // 2024-01-31 / 2024/1/31 / 2024.1.31 / 2024年1月31日
    var m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (m) {
      var r = ymd(+m[1], +m[2], +m[3]);
      if (r) return r;
    }

    // 末尾带序号的日期，如 2024-01-31 00:00:00
    var m2 = s.match(/^(\d{4})(\d{2})(\d{2})\s/);
    if (m2) return ymd(+m2[1], +m2[2], +m2[3]);

    return null;
  }

  /* ---------------- 数值解析 ---------------- */
  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v === null || v === undefined || v instanceof Date) return null;
    var s = toHalfWidth(String(v)).trim().replace(/[,¥￥\s]/g, '');
    if (!s) return null;
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /* ---------------- 列统计 ---------------- */
  function columnStats(rows) {
    var width = 0, i, j;
    for (i = 0; i < rows.length && i < 400; i++) width = Math.max(width, (rows[i] || []).length);

    var dateHits = new Array(width).fill(0);
    var numHits = new Array(width).fill(0);
    var textHits = new Array(width).fill(0);

    var limit = Math.min(rows.length, 400);
    for (i = 0; i < limit; i++) {
      var r = rows[i] || [];
      for (j = 0; j < width; j++) {
        var v = r[j];
        if (v === null || v === undefined || v === '') continue;
        if (parseDate(v)) dateHits[j]++;
        var n = parseNum(v);
        if (n !== null) numHits[j]++;
        else if (typeof v === 'string' && v.trim()) textHits[j]++;
      }
    }
    var bestDateCol = -1, bestDate = 0;
    for (j = 0; j < width; j++) {
      if (dateHits[j] > bestDate) { bestDate = dateHits[j]; bestDateCol = j; }
    }
    return { width: width, dateHits: dateHits, numHits: numHits, textHits: textHits, bestDateCol: bestDateCol, bestDateCount: bestDate };
  }

  /* ---------------- 表头行探测 ---------------- */
  function findHeaderRow(rows) {
    var scan = Math.min(rows.length, 20);
    var best = null;
    for (var i = 0; i < scan; i++) {
      var r = rows[i] || [];
      var dCol = -1, dScore = 0, nCol = -1, nScore = 0, pCol = -1, pScore = 0;
      for (var j = 0; j < r.length; j++) {
        var v = r[j];
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'number' || v instanceof Date) continue;
        var t = String(v).trim();
        if (!t || t.length > 20) continue;

        var ds = aliasScore(t, ALIAS.date);
        var ns = aliasScore(t, ALIAS.nav);
        var ps = aliasScore(t, ALIAS.product);

        // 一个单元格只归入一个语义：日期优先级最高
        if (ds > 0 && ds >= ns) {
          if (ds > dScore) { dScore = ds; dCol = j; }
          continue;
        }
        if (ns > 0 && ns >= ps) {
          if (ns > nScore) { nScore = ns; nCol = j; }
          continue;
        }
        if (ps > 0) {
          if (ps > pScore) { pScore = ps; pCol = j; }
        }
      }

      var total = dScore + nScore + (pScore ? pScore : 0);
      if (dScore > 0 && nScore > 0 && total > 0) {
        if (!best || total > best.score) {
          best = { row: i, score: total, dateCol: dCol, navCol: nCol, productCol: pCol, hasProduct: pScore > 0 };
        }
      }
    }
    return best || { row: -1, score: 0, dateCol: -1, navCol: -1, productCol: -1, hasProduct: false };
  }

  /* ---------------- 序列清洗 ---------------- */
  function buildSeries(pairs, name) {
    var dropped = { bad: 0, dup: 0 };
    var map = {};
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (p.ts === null || p.nav === null) { dropped.bad++; continue; }
      if (!(p.nav > 0)) { dropped.bad++; continue; }
      if (map[p.ts]) dropped.dup++;
      map[p.ts] = { ts: p.ts, nav: p.nav, text: p.text };
    }
    var arr = [];
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) arr.push(map[k]);
    arr.sort(function (a, b) { return a.ts - b.ts; });

    var ts = new Array(arr.length), nav = new Array(arr.length), labels = new Array(arr.length);
    for (var q = 0; q < arr.length; q++) { ts[q] = arr[q].ts; nav[q] = arr[q].nav; labels[q] = arr[q].text; }

    return { name: name, ts: ts, nav: nav, labels: labels, count: arr.length, dropped: dropped };
  }

  /* ---------------- 主分析函数 ---------------- */
  function analyze(rows, override) {
    override = override || {};
    if (!rows || !rows.length) return { ok: false, error: '工作表为空' };

    var stats = columnStats(rows);
    var header = findHeaderRow(rows);
    var headerRow = header.row;
    var start = headerRow >= 0 ? headerRow + 1 : 0;
    var width = stats.width;

    // 无别名表头时：把「首个日期数据行的上一行」当作表头，用于取产品名
    if (headerRow < 0 && stats.bestDateCol >= 0) {
      var firstDataRow = -1;
      var scanLimit = Math.min(rows.length, 50);
      for (var fr = 0; fr < scanLimit; fr++) {
        if (parseDate((rows[fr] || [])[stats.bestDateCol])) { firstDataRow = fr; break; }
      }
      if (firstDataRow > 0) { headerRow = firstDataRow - 1; start = firstDataRow; }
    }

    // 列标签
    var columns = [];
    for (var j = 0; j < width; j++) {
      var raw = headerRow >= 0 ? (rows[headerRow] || [])[j] : null;
      var label = (raw !== null && raw !== undefined && String(raw).trim()) ? String(raw).trim() : ('列 ' + (j + 1));
      if (label.length > 24) label = label.slice(0, 24) + '…';
      columns.push({ index: j, label: label });
    }

    // 日期列
    var dateCol = (override.dateCol !== undefined && override.dateCol !== null && override.dateCol >= 0)
      ? override.dateCol : header.dateCol;
    if (dateCol < 0 || dateCol >= width) dateCol = stats.bestDateCol;
    if (dateCol < 0) {
      return { ok: false, error: '没有识别到日期列，请在右侧「数据映射」里手动指定', columns: columns };
    }

    // 有效数据行（日期可解析）
    var validIdx = [];
    var i;
    for (i = start; i < rows.length; i++) {
      var r = rows[i] || [];
      if (parseDate(r[dateCol])) validIdx.push(i);
    }
    if (validIdx.length < 2) {
      // 尝试不跳过表头
      if (start > 0) {
        validIdx = [];
        for (i = 0; i < rows.length; i++) {
          var r2 = rows[i] || [];
          if (parseDate(r2[dateCol])) validIdx.push(i);
        }
        if (validIdx.length >= 2) { start = 0; headerRow = -1; }
      }
    }
    if (validIdx.length < 2) {
      return {
        ok: false,
        error: '「' + ((columns[dateCol] || {}).label || ('列 ' + (dateCol + 1))) + '」列中能识别的日期少于 2 个，请在右侧换一个日期列',
        columns: columns, dateCol: dateCol
      };
    }

    var dataRows = validIdx.length;
    // 有效行上的数值列密度
    var numCount = new Array(width).fill(0);
    for (var v = 0; v < validIdx.length; v++) {
      var row = rows[validIdx[v]] || [];
      for (var c = 0; c < width; c++) {
        if (c === dateCol) continue;
        if (parseNum(row[c]) !== null) numCount[c]++;
      }
    }

    // 长表判定
    var isLong = false;
    var prodCol = -1, navCol = -1;
    if (override.mode === 'long' || (override.mode !== 'single' && header.hasProduct && header.productCol >= 0 && header.navCol >= 0)) {
      prodCol = (override.productCol !== undefined && override.productCol !== null && override.productCol >= 0)
        ? override.productCol : header.productCol;
      navCol = (override.navCol !== undefined && override.navCol !== null && override.navCol >= 0)
        ? override.navCol : header.navCol;
      if (prodCol >= 0 && navCol >= 0 && prodCol !== dateCol && navCol !== dateCol && prodCol !== navCol) {
        // 产品列必须是文本为主
        var textShare = 0, tot = 0;
        for (var t2 = 0; t2 < validIdx.length; t2++) {
          var pv = (rows[validIdx[t2]] || [])[prodCol];
          if (pv === null || pv === undefined || pv === '') continue;
          tot++;
          if (parseNum(pv) === null) textShare++;
        }
        if (tot > 0 && textShare / tot > 0.6) isLong = true;
      }
    }

    var products = [];
    var droppedTotal = { bad: 0, dup: 0 };
    var warnings = [];
    var chosenNavCols = [];

    if (isLong) {
      var groups = {};
      var order = [];
      var lastProd = '';
      for (var q = 0; q < validIdx.length; q++) {
        var rr = rows[validIdx[q]] || [];
        var pd = parseDate(rr[dateCol]);
        if (!pd) continue;
        var name = rr[prodCol];
        name = (name === null || name === undefined) ? '' : String(name).trim();
        if (!name) name = lastProd || '未命名产品';
        lastProd = name;
        if (!groups[name]) { groups[name] = []; order.push(name); }
        groups[name].push({ ts: pd.ts, text: pd.text, nav: parseNum(rr[navCol]) });
      }
      for (var g = 0; g < order.length; g++) {
        var s = buildSeries(groups[order[g]], order[g]);
        droppedTotal.bad += s.dropped.bad;
        droppedTotal.dup += s.dropped.dup;
        if (s.count >= 2) products.push(s);
      }
      if (products.length > 1) {
        warnings.push('识别为长表：共 ' + products.length + ' 个产品');
      }
    } else {
      // 宽表 / 单序列
      var navCols = [];
      if (override.navCol !== undefined && override.navCol !== null && override.navCol >= 0) {
        navCols = [override.navCol];
      } else {
        var threshold = Math.max(2, dataRows * 0.5);
        for (var k = 0; k < width; k++) {
          if (k === dateCol) continue;
          if (numCount[k] >= threshold) navCols.push(k);
        }
        if (!navCols.length) {
          var bestK = -1, bestN = 0;
          for (var k2 = 0; k2 < width; k2++) {
            if (k2 === dateCol) continue;
            if (numCount[k2] > bestN) { bestN = numCount[k2]; bestK = k2; }
          }
          if (bestK >= 0) navCols.push(bestK);
        }
      }

      chosenNavCols = navCols;

      for (var m = 0; m < navCols.length; m++) {
        var nc = navCols[m];
        var pairs = [];
        for (var w = 0; w < validIdx.length; w++) {
          var rw = rows[validIdx[w]] || [];
          var pd2 = parseDate(rw[dateCol]);
          if (!pd2) continue;
          pairs.push({ ts: pd2.ts, text: pd2.text, nav: parseNum(rw[nc]) });
        }
        var nm = columns[nc] ? columns[nc].label : ('列 ' + (nc + 1));
        var s2 = buildSeries(pairs, nm);
        droppedTotal.bad += s2.dropped.bad;
        droppedTotal.dup += s2.dropped.dup;
        if (s2.count >= 2) products.push(s2);
      }
    }

    if (!products.length) {
      return {
        ok: false,
        error: '没有解析出有效的净值序列，请检查日期列与净值列的选择',
        columns: columns, dateCol: dateCol
      };
    }

    var structure = isLong ? 'long' : (products.length > 1 ? 'wide' : 'single');
    if (droppedTotal.bad) warnings.push('剔除 ' + droppedTotal.bad + ' 条空值或非法净值');
    if (droppedTotal.dup) warnings.push('合并 ' + droppedTotal.dup + ' 条重复日期');

    var sample = [];
    for (var sp = 0; sp < Math.min(3, validIdx.length); sp++) {
      var srow = (rows[validIdx[sp]] || []).slice(0, 8);
      sample.push(srow);
    }

    return {
      ok: true,
      structure: structure,
      headerRow: headerRow,
      dataStart: start,
      dateCol: dateCol,
      navCol: isLong ? navCol : (chosenNavCols.length ? chosenNavCols[0] : -1),
      productCol: isLong ? prodCol : -1,
      columns: columns,
      products: products,
      totalRows: rows.length,
      dataRows: dataRows,
      dropped: droppedTotal,
      warnings: warnings,
      sample: sample,
      sheetWidth: width
    };
  }

  /* ---------------- 读取文件 ---------------- */
  function decodeText(buf) {
    var bytes = new Uint8Array(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch (e) {
      try {
        return new TextDecoder('gbk').decode(bytes);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(bytes);
      }
    }
  }

  function sheetRows(ws) {
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: null });
  }

  function parseFile(arrayBuffer, fileName) {
    var ext = (fileName.split('.').pop() || '').toLowerCase();
    var wb;
    if (ext === 'csv' || ext === 'txt') {
      var txt = decodeText(arrayBuffer);
      wb = XLSX.read(txt, { type: 'string', cellDates: true, raw: false });
    } else {
      // cellDates 关闭：日期以 Excel 序列值形式读入，避免不同时区下日期偏移一天
      wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false });
    }
    var sheets = [];
    for (var i = 0; i < wb.SheetNames.length; i++) {
      var name = wb.SheetNames[i];
      var rows = sheetRows(wb.Sheets[name]);
      if (!rows.length) continue;
      sheets.push({ name: name, rows: rows });
    }
    if (!sheets.length) throw new Error('没有读到任何非空工作表');
    return { fileName: fileName, sheets: sheets };
  }

  NA.parser = {
    parseFile: parseFile,
    analyze: analyze,
    parseDate: parseDate,
    parseNum: parseNum
  };
})(window);
