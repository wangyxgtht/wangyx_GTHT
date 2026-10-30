/* ===================================================================
 * 净值分析台 · 本地存档
 * ---------------------------------------------------------------
 * 两条通路：
 *   1) 本地档案服务（启动档案服务.bat）→ 真写入项目内 档案/ 目录
 *   2) 浏览器 IndexedDB → 服务不在时的暂存，可随时导出 / 迁移
 * 对外接口挂在 window.NAVApp.archive
 * =================================================================== */
(function () {
  'use strict';

  var global = window;
  var NA = global.NAVApp = global.NAVApp || {};
  var PORTS = [8791, 8792, 8793, 8794, 8795];
  var DB_NAME = 'nav_archive';
  var DB_STORE = 'entries';
  var PROBE_TIMEOUT = 1200;

  var svc = { mode: 'none', port: 0, dir: '', httpBase: '', env: 'local' };
  var dbPromise = null;
  var listeners = [];

  /* ---------------- 小工具 ---------------- */
  function onModeChange(fn) { listeners.push(fn); }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](svc); } catch (e) { /* ignore */ }
    }
  }

  function fetchTimeout(url, opts, ms) {
    var options = opts || {};
    if (!global.fetch) return Promise.reject(new Error('浏览器不支持 fetch'));
    if (!global.AbortController) {
      return Promise.race([
        global.fetch(url, options),
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms || PROBE_TIMEOUT); })
      ]);
    }
    var ac = new global.AbortController();
    options.signal = ac.signal;
    var timer = setTimeout(function () { ac.abort(); }, ms || PROBE_TIMEOUT);
    return global.fetch(url, options).then(function (r) {
      clearTimeout(timer);
      return r;
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  function jsonFetch(url, opts, ms) {
    return fetchTimeout(url, opts, ms).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function ab2b64(buffer) {
    var bytes = new Uint8Array(buffer);
    var chunk = 0x8000;
    var out = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      out.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return global.btoa(out.join(''));
  }

  function fmtSize(n) {
    if (!n && n !== 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    function p(x) { return x < 10 ? '0' + x : '' + x; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function stemOf(name) { return String(name || '').replace(/\.[^.]+$/, ''); }
  function isMd(name) { return /\.md$/i.test(name || ''); }

  /* ---------------- IndexedDB ---------------- */
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('浏览器不支持本地存储')); return; }
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          var st = db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
          st.createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('本地存储打开失败')); };
    });
    return dbPromise;
  }

  function idb(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, mode);
        var store = tx.objectStore(DB_STORE);
        var req = fn(store);
        tx.oncomplete = function () { resolve(req && req.result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('操作被中断')); };
      });
    });
  }

  function idbAll() { return idb('readonly', function (s) { return s.getAll(); }); }
  function idbPut(rec) { return idb('readwrite', function (s) { return s.put(rec); }); }
  function idbDel(id) { return idb('readwrite', function (s) { return s.delete(id); }); }

  /* ---------------- 环境判断 ---------------- */
  /*
   * 只有在本机打开时才去探测 127.0.0.1 上的档案服务：
   * 部署到公网域名后，5 个端口逐个探测会白等约 6 秒并抛一堆控制台错误。
   * 公网形态直接用浏览器存储（IndexedDB）。
   */
  function isLocalHost() {
    var h = (global.location.hostname || '').toLowerCase();
    if (global.location.protocol === 'file:') return true;
    if (!h) return true;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return true;
    return /^(192\.168|10)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  }

  /* ---------------- 服务探测 ---------------- */
  function probeBase(base, port) {
    return jsonFetch(base + '/api/ping', { cache: 'no-store' }, PROBE_TIMEOUT).then(function (j) {
      if (!j.ok) throw new Error('bad');
      svc.mode = 'server';
      svc.port = j.port || port || 0;
      svc.dir = j.dir || '';
      svc.httpBase = base;
      return svc;
    });
  }

  function detect() {
    svc.env = isLocalHost() ? 'local' : 'cloud';
    // 同源优先（通过服务打开页面时零跨域问题）；公网形态没有 /api，直接不发请求
    var chain = Promise.resolve();
    if (svc.env === 'local' && /^https?:$/.test(global.location.protocol)) {
      chain = probeBase('', 0).catch(function () { return null; });
    }
    return chain.then(function (hit) {
      if (hit) { emit(); return svc; }
      // 公网形态：不再探测本机端口，直接走浏览器存储
      if (svc.env === 'cloud') {
        svc.mode = global.indexedDB ? 'browser' : 'none';
        svc.httpBase = '';
        emit();
        return svc;
      }
      var i = 0;
      function next() {
        if (i >= PORTS.length) {
          svc.mode = global.indexedDB ? 'browser' : 'none';
          svc.httpBase = '';
          emit();
          return svc;
        }
        var port = PORTS[i++];
        return probeBase('http://127.0.0.1:' + port, port).catch(next);
      }
      return next();
    }).then(function (s) {
      emit();
      return s;
    });
  }

  /* ---------------- 存档 ---------------- */
  function save(payload) {
    var file = payload && payload.file;
    if (!file) return Promise.reject(new Error('没有可存档的文件'));
    var kind = payload.kind === 'bench' ? 'bench' : 'product';
    var snapshot = payload.snapshot || '';
    var meta = payload.meta || {};

    if (svc.mode === 'server') {
      return file.arrayBuffer().then(function (buf) {
        var body = {
          fileName: file.name,
          kind: kind,
          fileB64: ab2b64(buf),
          snapshot: snapshot,
          meta: meta
        };
        return jsonFetch(svc.httpBase + '/api/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }, 30000);
      }).then(function (j) {
        return { ok: true, mode: 'server', saved: j.saved || [], dir: j.dir || svc.dir };
      });
    }

    // 浏览器暂存
    var rec = {
      name: file.name,
      kind: kind,
      size: file.size || 0,
      savedAt: Date.now(),
      snapshot: snapshot,
      meta: meta,
      blob: file
    };
    return idbPut(rec).then(function (id) {
      rec.id = id;
      return { ok: true, mode: 'browser', saved: [file.name], id: id };
    });
  }

  /* ---------------- 列表 ---------------- */
  function listDisk() {
    return jsonFetch(svc.httpBase + '/api/list', { cache: 'no-store' }, 8000).then(function (j) {
      var files = j.items || [];
      var byStem = {};
      var records = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        // 档案目录里还放着索引/日志/状态/说明，这些不是净值文件，不进列表
        if (/^(档案索引\.csv|说明\.txt)$/i.test(f.name)) continue;
        if (/^(服务日志\.txt(\.1)?|服务状态\.json)$/i.test(f.name)) continue;
        if (isMd(f.name)) { byStem[stemOf(f.name)] = f; continue; }
        if (!/\.(xlsx|xls|xlsm|csv)$/i.test(f.name)) continue;
        records.push({
          source: 'disk',
          name: f.name,
          displayName: f.name.replace(/^(\d{8}-\d{6})_/, '$1 '),
          rawName: f.name.replace(/^(\d{8}-\d{6})_/, '$1 '),
          savedAt: (f.mtime || 0) * 1000,
          size: f.size,
          kind: /基准_/.test(f.name) ? 'bench' : 'product',
          hasSnapshot: !!byStem[stemOf(f.name)],
          snapshotName: byStem[stemOf(f.name)] ? byStem[stemOf(f.name)].name : ''
        });
      }
      // 没有配对的 .md 也要露出来
      for (var k in byStem) {
        if (!Object.prototype.hasOwnProperty.call(byStem, k)) continue;
        var paired = false;
        for (var r = 0; r < records.length; r++) {
          if (stemOf(records[r].name) === k) { paired = true; break; }
        }
        if (!paired) {
          records.push({
            source: 'disk',
            name: byStem[k].name,
            displayName: byStem[k].name,
            savedAt: (byStem[k].mtime || 0) * 1000,
            size: byStem[k].size,
            kind: 'snapshot',
            hasSnapshot: true,
            snapshotName: byStem[k].name
          });
        }
      }
      records.sort(function (a, b) { return b.savedAt - a.savedAt; });
      return records;
    });
  }

  function listBrowser() {
    return idbAll().then(function (rows) {
      rows = rows || [];
      rows.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
      return rows.map(function (r) {
        return {
          source: 'browser',
          id: r.id,
          name: r.name,
          displayName: r.name,
          savedAt: r.savedAt,
          size: r.size,
          kind: r.kind || 'product',
          hasSnapshot: !!r.snapshot,
          entry: r
        };
      });
    });
  }

  function list() {
    if (svc.mode === 'server') return listDisk();
    if (svc.mode === 'browser') return listBrowser();
    return Promise.resolve([]);
  }

  /* ---------------- 单条操作 ---------------- */
  function viewSnapshot(rec) {
    if (rec.source === 'disk' && rec.snapshotName) {
      return jsonFetch(svc.httpBase + '/api/text?name=' + encodeURIComponent(rec.snapshotName), {}, 8000)
        .then(function (j) { return j.text || ''; });
    }
    if (rec.entry && rec.entry.snapshot) return Promise.resolve(rec.entry.snapshot);
    return Promise.resolve('');
  }

  function triggerDownload(blob, filename) {
    var url = global.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { global.URL.revokeObjectURL(url); }, 4000);
  }

  function download(rec) {
    if (rec.source === 'disk') {
      var a = document.createElement('a');
      a.href = svc.httpBase + '/api/file?name=' + encodeURIComponent(rec.name);
      a.download = rec.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return Promise.resolve(true);
    }
    if (rec.entry && rec.entry.blob) {
      triggerDownload(rec.entry.blob, rec.name);
      return Promise.resolve(true);
    }
    return Promise.reject(new Error('该档案没有可下载的内容'));
  }

  function remove(rec) {
    if (rec.source === 'disk') {
      var jobs = [rec.name];
      if (rec.snapshotName && rec.snapshotName !== rec.name) jobs.push(rec.snapshotName);
      return Promise.all(jobs.map(function (n) {
        return jsonFetch(svc.httpBase + '/api/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: n })
        }, 8000);
      }));
    }
    return idbDel(rec.id);
  }

  function openFolder() {
    if (svc.mode !== 'server') return Promise.reject(new Error('未连接本地档案服务'));
    return jsonFetch(svc.httpBase + '/api/open', {}, 5000);
  }

  function getFileBytes(rec) {
    if (rec.source === 'browser' && rec.entry && rec.entry.blob) {
      return rec.entry.blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    var url = svc.httpBase + '/api/file?name=' + encodeURIComponent(rec.name);
    return fetchTimeout(url, {}, 15000).then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return new Uint8Array(b); });
  }

  /* ---------------- 极简 ZIP（store 模式，无压缩） ---------------- */
  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
    return CRC_TABLE;
  }
  function crc32(bytes) {
    var t = crcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))) & 0xFFFF;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }
  function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
  function utf8(str) {
    if (global.TextEncoder) return new global.TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), arr = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
    return arr;
  }
  function makeZip(files) {
    var locals = [], centrals = [], offset = 0;
    var now = new Date();
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var nameBytes = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var localHead = new Uint8Array([].concat(
        [0x50, 0x4B, 0x03, 0x04], u16(20), u16(0x0800), u16(0), u16(dosTime(now)), u16(dosDate(now)),
        u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0)
      ));
      locals.push(localHead, nameBytes, data);

      var centralHead = new Uint8Array([].concat(
        [0x50, 0x4B, 0x01, 0x02], u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime(now)), u16(dosDate(now)),
        u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset)
      ));
      centrals.push(centralHead, nameBytes);

      offset += localHead.length + nameBytes.length + data.length;
    }
    var cdStart = offset, cdBytes = 0;
    for (var c = 0; c < centrals.length; c++) cdBytes += centrals[c].length;
    var end = new Uint8Array([].concat(
      [0x50, 0x4B, 0x05, 0x06], u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cdBytes), u32(cdStart), u16(0)
    ));
    var parts = locals.concat(centrals, [end]);
    var total = 0;
    for (var p = 0; p < parts.length; p++) total += parts[p].length;
    var out = new Uint8Array(total), pos = 0;
    for (var q = 0; q < parts.length; q++) { out.set(parts[q], pos); pos += parts[q].length; }
    return out;
  }

  function exportZip(records) {
    var list = records || [];
    if (!list.length) return Promise.reject(new Error('没有可导出的档案'));
    return Promise.all(list.map(function (rec) {
      return getFileBytes(rec).then(function (bytes) {
        return { name: rec.name, data: bytes };
      }).catch(function () { return null; });
    })).then(function (files) {
      var ok = files.filter(function (f) { return f; });
      if (!ok.length) throw new Error('没有成功读取到文件');
      var snapshots = list.filter(function (r) { return r.hasSnapshot && r.snapshotName; });
      var snapJobs = snapshots.map(function (rec) {
        return viewSnapshot(rec).then(function (text) {
          if (!text) return null;
          return { name: rec.snapshotName || (stemOf(rec.name) + '.md'), data: utf8(text) };
        }).catch(function () { return null; });
      });
      return Promise.all(snapJobs).then(function (snaps) {
        var all = ok.concat(snaps.filter(function (s) { return s; }));
        var d = new Date();
        function p(x) { return x < 10 ? '0' + x : '' + x; }
        var zipName = '净值档案_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
          p(d.getHours()) + p(d.getMinutes()) + '.zip';
        var bytes = makeZip(all);
        triggerDownload(new Blob([bytes], { type: 'application/zip' }), zipName);
        return { count: all.length, zipName: zipName };
      });
    });
  }

  /* ---------------- 浏览器暂存 → 本地服务 ---------------- */
  function migrateToServer() {
    if (svc.mode !== 'server') return Promise.reject(new Error('未连接本地档案服务'));
    return listBrowser().then(function (rows) {
      if (!rows.length) return { moved: 0, failed: 0 };
      var moved = 0, failed = 0;
      function step(idx) {
        if (idx >= rows.length) return { moved: moved, failed: failed };
        var rec = rows[idx];
        return save({
          file: rec.entry.blob,
          kind: rec.entry.kind,
          snapshot: rec.entry.snapshot,
          meta: rec.entry.meta
        }).then(function () {
          moved++;
          return idbDel(rec.id);
        }).catch(function () { failed++; }).then(function () {
          return step(idx + 1);
        });
      }
      return step(0);
    });
  }

  function status() {
    return { mode: svc.mode, port: svc.port, dir: svc.dir, env: svc.env, local: svc.env === 'local' };
  }

  NA.archive = {
    detect: detect,
    status: status,
    onModeChange: onModeChange,
    save: save,
    list: list,
    viewSnapshot: viewSnapshot,
    download: download,
    remove: remove,
    openFolder: openFolder,
    loadBytes: getFileBytes,
    exportZip: exportZip,
    migrateToServer: migrateToServer,
    fmtSize: fmtSize,
    fmtTime: fmtTime
  };
})();
