# -*- coding: utf-8 -*-
"""
净值分析台 · 本地档案服务
------------------------------------------------
只用 Python 标准库：把网页托管在 http://127.0.0.1:8791 ，同时提供存档接口，
把用户上传的 Excel 原文件与指标快照 .md 写进项目内的 档案/ 目录。

启动：双击 启动档案服务.bat ，或 py -3 server/archive_server.py
参数：--port 8791  --no-browser  --silent  --dir <项目目录>  --force

开机自启（无窗口）由 tools/autostart.py 调用：
  pythonw.exe server/archive_server.py --silent
无控制台时日志写入 档案/服务日志.txt，运行状态写入 档案/服务状态.json。

接口：
  GET  /api/ping                      服务探测
  POST /api/archive                   {fileName, kind, fileB64, snapshot, meta}
  GET  /api/list                      档案列表
  GET  /api/text?name=xxx.md          读取快照文本
  GET  /api/file?name=xxx.xlsx        下载档案文件
  POST /api/delete                    {name}
  GET  /api/open?folder=archive       在资源管理器里打开档案目录
"""
import argparse
import base64
import csv
import json
import os
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE_DIR = os.path.join(ROOT, '档案')
INDEX_CSV = os.path.join(ARCHIVE_DIR, '档案索引.csv')
STATUS_JSON = os.path.join(ARCHIVE_DIR, '服务状态.json')
LOG_FILE = os.path.join(ARCHIVE_DIR, '服务日志.txt')
VERSION = '2026-10-29'
MAX_BODY = 60 * 1024 * 1024  # 60MB
MAX_LOG = 512 * 1024          # 日志超过 512KB 归档一份
DEFAULT_PORTS = [8791, 8792, 8793, 8794, 8795]
INVALID_CHARS = '<>:"/\\|?*'

CSV_HEADER = ['存档时间', '类型', '原始文件名', '存档文件', '指标快照', '分析对象', '数据区间', '年化收益', '最大回撤']


def log(msg):
    """有控制台就打印；同时始终写进 档案/服务日志.txt（开机自启无控制台时靠它排查）。"""
    try:
        if sys.stdout is not None:
            print(msg, flush=True)
    except Exception:
        pass
    try:
        ensure_dir(ARCHIVE_DIR)
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > MAX_LOG:
            try:
                os.replace(LOG_FILE, LOG_FILE + '.1')
            except Exception:
                pass
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write('%s  %s\n' % (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), msg))
    except Exception:
        pass


def ensure_dir(path):
    if not os.path.isdir(path):
        os.makedirs(path)


def safe_name(name, fallback='未命名'):
    """去掉目录成分与 Windows 非法字符，防止路径穿越。"""
    name = os.path.basename(str(name or '').replace('\\', '/'))
    name = ''.join('_' if ch in INVALID_CHARS else ch for ch in name)
    name = name.strip().strip('.')
    return name or fallback


def inside_archive(path):
    ap = os.path.abspath(path)
    base = os.path.abspath(ARCHIVE_DIR) + os.sep
    return ap.startswith(base)


def write_index_row(row):
    ensure_dir(ARCHIVE_DIR)
    new = not os.path.exists(INDEX_CSV)
    with open(INDEX_CSV, 'a', newline='', encoding='utf-8-sig' if new else 'utf-8') as f:
        w = csv.writer(f)
        if new:
            w.writerow(CSV_HEADER)
        w.writerow(row)


class Handler(SimpleHTTPRequestHandler):
    server_version = 'NAVArchive/' + VERSION

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---------- 基础 ----------
    def log_message(self, fmt, *args):
        # 静态资源不刷屏；心跳探测也不记，只在存档/删除/下载等操作时留痕
        path = self.path or ''
        if '/api/' in path and '/api/ping' not in path:
            log('  %s %s' % (self.command, path))

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def end_headers(self):
        # 关掉缓存，避免改了 assets 还要按 Ctrl+F5
        # 注意：静态资源带 ?v= 版本号，必须先去掉查询串再判断扩展名，否则缓存头不生效
        path = (self.path or '').split('?', 1)[0].lower()
        if path.endswith(('.js', '.css', '.html')):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _body_json(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return None
        if length > MAX_BODY:
            raise ValueError('文件太大（上限 60MB）')
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    def _query(self):
        parsed = urllib.parse.urlparse(self.path)
        return parsed.path, urllib.parse.parse_qs(parsed.query)

    # ---------- 路由 ----------
    def do_GET(self):
        path, qs = self._query()
        if path == '/api/ping':
            return self._json({'ok': True, 'version': VERSION, 'dir': ARCHIVE_DIR,
                               'port': self.server.server_address[1], 'pid': os.getpid()})
        if path == '/api/list':
            return self.api_list()
        if path == '/api/text':
            return self.api_text((qs.get('name') or [''])[0])
        if path == '/api/file':
            return self.api_file((qs.get('name') or [''])[0])
        if path == '/api/open':
            return self.api_open()
        if path == '/':
            self.path = '/index.html'
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        path, _ = self._query()
        try:
            if path == '/api/archive':
                return self.api_archive()
            if path == '/api/delete':
                return self.api_delete()
        except ValueError as e:
            return self._json({'ok': False, 'error': str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            log('  !! %s' % e)
            return self._json({'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}, 500)
        return self._json({'ok': False, 'error': '未知接口'}, 404)

    # ---------- 接口实现 ----------
    def api_list(self):
        ensure_dir(ARCHIVE_DIR)
        items = []
        for fn in os.listdir(ARCHIVE_DIR):
            full = os.path.join(ARCHIVE_DIR, fn)
            if not os.path.isfile(full):
                continue
            st = os.stat(full)
            items.append({
                'name': fn,
                'size': st.st_size,
                'mtime': int(st.st_mtime),
                'isSnapshot': fn.lower().endswith('.md'),
            })
        items.sort(key=lambda x: (-x['mtime'], x['name']))
        return self._json({'ok': True, 'dir': ARCHIVE_DIR, 'items': items[:400]})

    def api_text(self, name):
        full = os.path.join(ARCHIVE_DIR, safe_name(name))
        if not inside_archive(full) or not os.path.isfile(full):
            return self._json({'ok': False, 'error': '找不到该档案'}, 404)
        with open(full, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
        return self._json({'ok': True, 'name': os.path.basename(full), 'text': text})

    def api_file(self, name):
        full = os.path.join(ARCHIVE_DIR, safe_name(name))
        if not inside_archive(full) or not os.path.isfile(full):
            return self._json({'ok': False, 'error': '找不到该档案'}, 404)
        data = open(full, 'rb').read()
        fn = os.path.basename(full)
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Content-Disposition',
                         "attachment; filename*=UTF-8''" + urllib.parse.quote(fn))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def api_open(self):
        ensure_dir(ARCHIVE_DIR)
        if sys.platform.startswith('win'):
            os.startfile(ARCHIVE_DIR)  # noqa: S606
            return self._json({'ok': True, 'dir': ARCHIVE_DIR})
        return self._json({'ok': False, 'error': '仅支持 Windows 直接打开目录'}, 400)

    def api_delete(self):
        body = self._body_json() or {}
        name = body.get('name') or ''
        full = os.path.join(ARCHIVE_DIR, safe_name(name))
        if not inside_archive(full) or not os.path.isfile(full):
            return self._json({'ok': False, 'error': '找不到该档案'}, 404)
        os.remove(full)
        return self._json({'ok': True, 'removed': os.path.basename(full)})

    def api_archive(self):
        body = self._body_json()
        if not body:
            return self._json({'ok': False, 'error': '请求体为空'}, 400)
        raw_b64 = body.get('fileB64') or ''
        if not raw_b64:
            return self._json({'ok': False, 'error': '缺少文件内容'}, 400)
        data = base64.b64decode(raw_b64)
        kind = body.get('kind') or 'product'
        name = safe_name(body.get('fileName') or '未命名.xlsx')
        snapshot = body.get('snapshot') or ''
        meta = body.get('meta') or {}

        # 同名冲突时加序号（同一秒内重复上传）
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        prefix = '' if kind == 'product' else '基准_'
        base = '%s_%s%s' % (stamp, prefix, name)
        ensure_dir(ARCHIVE_DIR)
        target = os.path.join(ARCHIVE_DIR, base)
        n = 2
        while os.path.exists(target):
            stem, ext = os.path.splitext(base)
            target = os.path.join(ARCHIVE_DIR, '%s(%d)%s' % (stem, n, ext))
            n += 1
        with open(target, 'wb') as f:
            f.write(data)

        saved = [os.path.basename(target)]
        snap_name = ''
        if snapshot.strip():
            snap_name = os.path.splitext(os.path.basename(target))[0] + '.md'
            with open(os.path.join(ARCHIVE_DIR, snap_name), 'w', encoding='utf-8') as f:
                f.write(snapshot)
            saved.append(snap_name)

        try:
            write_index_row([
                datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                '基准' if kind == 'bench' else '产品',
                name,
                os.path.basename(target),
                snap_name,
                str(meta.get('product') or ''),
                str(meta.get('range') or ''),
                str(meta.get('annualized') or ''),
                str(meta.get('maxDD') or ''),
            ])
        except Exception as e:  # noqa: BLE001
            log('  !! 写索引失败: %s' % e)

        log('  ✓ 已存档 %s (%d 字节)' % (os.path.basename(target), len(data)))
        return self._json({'ok': True, 'saved': saved, 'dir': ARCHIVE_DIR})


def build_server(ports):
    last_err = None
    for port in ports:
        try:
            httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
            return httpd, port
        except OSError as e:
            last_err = e
            log('端口 %d 不可用，试下一个…（%s）' % (port, e))
    raise SystemExit('没有可用端口：%s' % last_err)


def find_running(ports):
    """探测是否已有本服务在跑，返回 (port, ping_json) 或 (None, None)。"""
    for port in ports:
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/api/ping' % port, timeout=0.7) as r:
                data = json.loads(r.read().decode('utf-8'))
            if data.get('ok'):
                return port, data
        except Exception:
            continue
    return None, None


def write_status(port):
    try:
        ensure_dir(ARCHIVE_DIR)
        with open(STATUS_JSON, 'w', encoding='utf-8') as f:
            json.dump({
                'pid': os.getpid(),
                'port': port,
                'startedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'version': VERSION,
                'python': sys.executable,
                'root': ROOT,
            }, f, ensure_ascii=False, indent=2)
    except Exception as e:  # noqa: BLE001
        log('写状态文件失败：%s' % e)


def clear_status():
    try:
        if os.path.exists(STATUS_JSON):
            os.remove(STATUS_JSON)
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser(description='净值分析台本地档案服务')
    ap.add_argument('--port', type=int, default=0, help='指定端口，默认从 8791 起自动选择')
    ap.add_argument('--no-browser', action='store_true', help='不自动打开浏览器')
    ap.add_argument('--silent', action='store_true', help='静默模式：不打开浏览器（开机自启使用）')
    ap.add_argument('--dir', default='', help='项目目录（默认脚本上一级）')
    ap.add_argument('--force', action='store_true', help='忽略"已在运行"的检测，强制再起一个实例')
    args = ap.parse_args()

    global ROOT, ARCHIVE_DIR, INDEX_CSV, STATUS_JSON, LOG_FILE
    if args.dir:
        ROOT = os.path.abspath(args.dir)
        ARCHIVE_DIR = os.path.join(ROOT, '档案')
        INDEX_CSV = os.path.join(ARCHIVE_DIR, '档案索引.csv')
        STATUS_JSON = os.path.join(ARCHIVE_DIR, '服务状态.json')
        LOG_FILE = os.path.join(ARCHIVE_DIR, '服务日志.txt')
    ensure_dir(ARCHIVE_DIR)

    silent = args.silent or args.no_browser
    ports = [args.port] if args.port else DEFAULT_PORTS

    # 单实例保护：开机自启与手动双击可能同时发生
    if not args.force:
        hit_port, hit = find_running(ports)
        if hit_port:
            url = 'http://127.0.0.1:%d/index.html' % hit_port
            log('服务已在运行（端口 %d，档案目录 %s），本次不再启动。' % (hit_port, (hit or {}).get('dir', '')))
            if not silent:
                log('  页面地址：%s' % url)
                threading.Timer(0.5, lambda: webbrowser.open(url)).start()
            return

    httpd, port = build_server(ports)
    write_status(port)
    url = 'http://127.0.0.1:%d/index.html' % port

    log('')
    log('  净值分析台 · 本地档案服务已启动（v%s，pid %d）' % (VERSION, os.getpid()))
    log('  ------------------------------------------')
    log('  页面地址：%s' % url)
    log('  档案目录：%s' % ARCHIVE_DIR)
    log('  日志文件：%s' % LOG_FILE)
    log('  只监听本机 127.0.0.1' + ('，静默后台运行' if silent else '，关闭此窗口即停止服务'))
    log('')

    if not silent:
        threading.Timer(0.9, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log('已停止（Ctrl+C）。')
    finally:
        clear_status()
        httpd.server_close()


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
