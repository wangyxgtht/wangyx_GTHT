# -*- coding: utf-8 -*-
"""
用本机 Chrome / Edge 的无头模式把 assets/icon.svg 渲染成 512px 母图，再缩放成 PWA 所需 PNG。

用法： py -3 tools/make_icons.py
依赖： Pillow（py -3 -m pip install pillow）
产出：
  icons/icon-192.png           普通图标（保留圆角，透明角）
  icons/icon-512.png           普通大图标
  icons/icon-512-maskable.png  maskable（直角铺满，避免被系统裁切出白角）
  icons/apple-touch-icon.png   iOS 主屏（180，直角铺满，iOS 自己加圆角）

注意：Chrome 无头截图对小窗口有最小尺寸限制（<500px 会裁切放大），
所以统一先按 512 渲染，再用 Pillow 缩放，保证小尺寸图标不失真。
"""
import os
import struct
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, 'assets', 'icon.svg')
OUT = os.path.join(ROOT, 'icons')
MASTER = 512

BROWSERS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]

PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin:0; padding:0; width:%dpx; height:%dpx; overflow:hidden; background:transparent; }
  svg { display:block; width:%dpx; height:%dpx; }
</style></head><body>
%s
</body></html>
"""

# (文件名, 像素, 用直角版)
TARGETS = [
    ('icon-192.png', 192, False),
    ('icon-512.png', 512, False),
    ('icon-512-maskable.png', 512, True),
    ('apple-touch-icon.png', 180, True),
]


def find_browser():
    for p in BROWSERS:
        if os.path.exists(p):
            return p
    raise SystemExit('未找到 Chrome 或 Edge，请先安装其中之一')


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


def shoot(browser, svg_text, out_path, tmpdir, tag):
    page = os.path.join(tmpdir, 'page_%s.html' % tag)
    with open(page, 'w', encoding='utf-8') as f:
        f.write(PAGE % (MASTER, MASTER, MASTER, MASTER, svg_text))
    if os.path.exists(out_path):
        os.remove(out_path)
    cmd = [
        browser,
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-sandbox',
        '--log-level=3',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        '--window-size=%d,%d' % (MASTER, MASTER),
        '--screenshot=' + out_path,
        'file:///' + page.replace('\\', '/'),
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
    size = png_size(out_path) if os.path.exists(out_path) else None
    if size != (MASTER, MASTER):
        raise SystemExit('母图渲染失败（%s）：%s' % (tag, size))


def main():
    if not os.path.exists(SVG):
        raise SystemExit('缺少 assets/icon.svg')
    try:
        from PIL import Image
    except ImportError:
        raise SystemExit('需要 Pillow：py -3 -m pip install pillow')

    os.makedirs(OUT, exist_ok=True)
    with open(SVG, 'r', encoding='utf-8') as f:
        svg = f.read()
    square_svg = svg.replace('rx="112"', 'rx="0"')

    browser = find_browser()
    tmpdir = tempfile.mkdtemp(prefix='navicon_')
    try:
        round_png = os.path.join(tmpdir, 'master_round.png')
        square_png = os.path.join(tmpdir, 'master_square.png')
        shoot(browser, svg, round_png, tmpdir, 'round')
        shoot(browser, square_svg, square_png, tmpdir, 'square')

        failures = []
        for name, px, square in TARGETS:
            src = square_png if square else round_png
            target = os.path.join(OUT, name)
            img = Image.open(src).convert('RGBA')
            if px != MASTER:
                img = img.resize((px, px), Image.LANCZOS)
            img.save(target, 'PNG', optimize=True)
            size = png_size(target)
            ok = size == (px, px)
            print('%-26s %s' % (name, ('OK  %dx%d' % size) if ok else ('FAIL %s' % (size,))))
            if not ok:
                failures.append(name)
        if failures:
            raise SystemExit('以下图标未能按尺寸生成：' + ', '.join(failures))
        print('全部图标已生成 →', OUT)
    finally:
        for f in os.listdir(tmpdir):
            try:
                os.remove(os.path.join(tmpdir, f))
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass


if __name__ == '__main__':
    main()
