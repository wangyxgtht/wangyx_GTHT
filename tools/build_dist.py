# -*- coding: utf-8 -*-
"""
生成「在线发布包」dist/ —— 本地与在线的隔离就靠这里。

只把站点运行所必需的文件拷进 dist/：
    index.html、manifest.webmanifest、sw.js、_headers、assets/、lib/、icons/
本地私有内容一律不进去：
    档案/（你的净值文件）、server/（本地档案服务）、tools/、samples/、*.bat、*.md

用法： py -3 tools/build_dist.py
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')

FILES = ['index.html', '404.html', 'manifest.webmanifest', 'sw.js', '_headers']
DIRS = ['assets', 'lib', 'icons']

# 明确禁止进入发布包的本地目录（防御性检查）
FORBIDDEN = ['档案', 'server', 'tools', 'samples', '.git']


def main():
    if os.path.abspath(DIST) == os.path.abspath(ROOT):
        raise SystemExit('拒绝清理项目根目录')

    missing = [f for f in FILES if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit('缺少必需文件：' + '、'.join(missing))
    missing_dirs = [d for d in DIRS if not os.path.isdir(os.path.join(ROOT, d))]
    if missing_dirs:
        raise SystemExit('缺少必需目录：' + '、'.join(missing_dirs))

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    total = 0
    size = 0
    for f in FILES:
        shutil.copy2(os.path.join(ROOT, f), os.path.join(DIST, f))
        p = os.path.join(DIST, f)
        total += 1
        size += os.path.getsize(p)

    for d in DIRS:
        src = os.path.join(ROOT, d)
        dst = os.path.join(DIST, d)
        shutil.copytree(src, dst)
        for base, _dirs, files in os.walk(dst):
            for name in files:
                total += 1
                size += os.path.getsize(os.path.join(base, name))

    for bad in FORBIDDEN:
        if os.path.exists(os.path.join(DIST, bad)):
            raise SystemExit('发布包里混入了本地私有目录：' + bad)

    print('发布包已生成：dist/')
    print('  文件数 %d，合计 %.2f MB' % (total, size / 1024.0 / 1024.0))
    print('  已排除：' + '、'.join(FORBIDDEN))
    return 0


if __name__ == '__main__':
    sys.exit(main())
