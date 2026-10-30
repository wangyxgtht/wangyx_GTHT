# -*- coding: utf-8 -*-
"""
发布前刷新缓存版本号，并做一轮自检。

用法： py -3 tools/bump_version.py
作用：
  1. 把 index.html 里所有 ?v=xxx 换成当天的新版本号（同一天多次发布自动 a→b→c 递增）；
  2. 同步 sw.js 的 CACHE_VERSION，并按 index.html 的实际引用重写预缓存列表；
  3. 自检：引用的文件是否都存在、manifest 是否合法、图标是否齐全。
任一项自检失败都会以非 0 退出，发布脚本会因此中止。
"""
import datetime
import json
import os
import re
import sys

# Windows 控制台默认 GBK，统一改成 UTF-8 输出，避免中文/符号报错
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')
SW = os.path.join(ROOT, 'sw.js')
MANIFEST = os.path.join(ROOT, 'manifest.webmanifest')

VERSION_RE = r'\?v=[0-9a-zA-Z]+'
SW_BLOCK_RE = re.compile(r'(/\* PRECACHE_START \*/)(.*?)(/\* PRECACHE_END \*/)', re.S)

errors = []
warnings = []


def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def next_version(old):
    today = datetime.date.today().strftime('%Y%m%d')
    m = re.match(r'^(\d{8})([a-z])$', old or '')
    if m and m.group(1) == today:
        c = m.group(2)
        if c < 'z':
            return today + chr(ord(c) + 1)
        return today + 'z'
    return today + 'a'


def local_refs(html):
    """index.html 里所有本地资源引用（保持出现顺序去重）"""
    out = []
    for ref in re.findall(r'(?:src|href)="([^"]+)"', html):
        if ref.startswith(('http://', 'https://', '//', 'data:', 'mailto:', '#')):
            continue
        if ref not in out:
            out.append(ref)
    return out


def main():
    if not os.path.exists(INDEX) or not os.path.exists(SW):
        raise SystemExit('找不到 index.html 或 sw.js')

    html = read(INDEX)
    found = re.findall(VERSION_RE, html)
    old_version = found[0][3:] if found else ''
    version = next_version(old_version)

    html = re.sub(VERSION_RE, '?v=' + version, html)
    write(INDEX, html)
    print('版本号：%s → %s（index.html 内 %d 处）' % (old_version or '(无)', version, len(found)))

    # ---- 预缓存列表与 HTML 引用保持一致 ----
    precache = ['./', 'index.html', 'manifest.webmanifest']
    for ref in local_refs(html):
        if ref in precache:
            continue
        precache.append(ref)
    # 图标不进 HTML 也要预缓存
    for icon in ('icons/icon-192.png', 'icons/icon-512.png',
                 'icons/icon-512-maskable.png', 'icons/apple-touch-icon.png'):
        if icon not in precache:
            precache.append(icon)

    block = '/* PRECACHE_START */\nvar PRECACHE = [\n'
    block += ',\n'.join("  '%s'" % p for p in precache)
    block += '\n];\n'
    sw = read(SW)
    sw = re.sub(r"var CACHE_VERSION = '[^']*';", "var CACHE_VERSION = '%s';" % version, sw)
    if not SW_BLOCK_RE.search(sw):
        raise SystemExit('sw.js 缺少 PRECACHE_START / PRECACHE_END 标记')
    sw = SW_BLOCK_RE.sub(lambda m: block + '/* PRECACHE_END */', sw)
    write(SW, sw)
    print('sw.js：CACHE_VERSION = %s，预缓存 %d 项' % (version, len(precache)))

    # ---- 自检：文件是否存在 ----
    for ref in precache:
        path = ref.split('?')[0].split('#')[0]
        if path in ('', './'):
            continue
        if not os.path.exists(os.path.join(ROOT, path.replace('/', os.sep))):
            errors.append('引用的文件不存在：%s' % ref)

    # ---- 自检：manifest ----
    if not os.path.exists(MANIFEST):
        errors.append('缺少 manifest.webmanifest')
    else:
        try:
            mf = json.loads(read(MANIFEST))
        except ValueError as e:
            errors.append('manifest.webmanifest 不是合法 JSON：%s' % e)
            mf = {}
        for icon in mf.get('icons', []):
            src = icon.get('src', '')
            if src and not os.path.exists(os.path.join(ROOT, src.replace('/', os.sep))):
                errors.append('manifest 里的图标不存在：%s' % src)
        if not mf.get('name'):
            warnings.append('manifest 缺少 name')

    # ---- 自检：页面必备元素 ----
    for token in ('manifest.webmanifest', 'apple-touch-icon'):
        if token not in html:
            warnings.append('index.html 未引用 %s' % token)

    for w in warnings:
        print('  [警告] ' + w)
    if errors:
        print('')
        for e in errors:
            print('  [错误] ' + e)
        print('\n自检未通过，已中止发布。')
        return 1

    print('自检通过。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
