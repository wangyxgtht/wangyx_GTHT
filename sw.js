/* ===================================================================
 * 净值分析台 · Service Worker
 * ---------------------------------------------------------------
 * 缓存策略：
 *   页面导航  → network-first（3s 超时回退缓存），保证总能拿到最新版
 *   静态资源  → stale-while-revalidate，URL 带 ?v= 天然版本隔离
 *   /api/*    → 直接放行，绝不缓存本地档案服务接口
 * CACHE_VERSION 与 index.html 的 ?v= 由 tools/bump_version.py 同步刷新，请勿手改。
 * =================================================================== */
var CACHE_VERSION = '20261030c';
var CACHE_NAME = 'nav-app-' + CACHE_VERSION;
var NAV_TIMEOUT = 3000;

/* PRECACHE_START */
var PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/icon.svg',
  'icons/apple-touch-icon.png',
  'assets/style.css?v=20261030c',
  'lib/xlsx.full.min.js',
  'lib/echarts.min.js',
  'assets/demo-data.js?v=20261030c',
  'assets/parser.js?v=20261030c',
  'assets/metrics.js?v=20261030c',
  'assets/charts.js?v=20261030c',
  'assets/archive.js?v=20261030c',
  'assets/compare.js?v=20261030c',
  'assets/ui.js?v=20261030c',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png'
];
/* PRECACHE_END */

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 逐个预缓存：单个资源 404 不应导致整个 SW 安装失败
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME && k.indexOf('nav-app-') === 0) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

function offlineFallback() {
  return caches.match('index.html').then(function (hit) {
    return hit || caches.match('./');
  });
}

function networkFirst(req) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      offlineFallback().then(function (hit) { resolve(hit || Response.error()); });
    }, NAV_TIMEOUT);

    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put('index.html', copy); }).catch(function () {});
      }
      resolve(res);
    }).catch(function () {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      offlineFallback().then(function (hit) { resolve(hit || Response.error()); });
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 跨域一律放行（含本机 127.0.0.1 档案服务）
  if (url.origin !== self.location.origin) return;
  // 本地档案服务接口不缓存
  if (url.pathname.indexOf('/api/') === 0) return;
  if (req.headers.get('range')) return;

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(req));
});
