# -*- coding: utf-8 -*-
"""
抓取内置对比指数的日线收盘价，生成 assets/indices.js。

用法：
    py -3 tools/fetch_indices.py                # 抓全部内置指数
    py -3 tools/fetch_indices.py --dry-run      # 只抓取并校验，不写文件
    py -3 tools/fetch_indices.py --only 000300,932000
    py -3 tools/fetch_indices.py --start 20180101

数据源：
    - 中证指数官网 perf 接口（宽基、全收益 H 系列、偏股基金指数、中证全债）
    - 东财 push2his 日线（深证/国证系列，如国证2000、创业板指）
    两者都无需密钥；浏览器直连会被 CORS 拦，所以只在构建期抓、打包成静态 JS。

自检（任一主指数不过就以退出码 1 中止，且不覆盖旧文件）：
    点数、首末日期、日期单调去重、净值 > 0、单日涨跌幅度

自定义指数（可选）：
    把 CSV 放进 samples/indices/，文件名用「代码.csv」或「代码_名称.csv」，
    两列（日期, 收盘），首行可以是表头。会覆盖同代码的自动抓取结果。
    例：samples/indices/8841431_万得微盘股.csv
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'indices.js')
CSV_DIR = os.path.join(ROOT, 'samples', 'indices')

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/122.0 Safari/537.36')

# source: csi = 中证指数官网；em = 东财（深证/国证系列）
INDICES = [
    # ---- 价格指数 ----
    {'code': '000300', 'name': '沪深300', 'group': '大盘', 'source': 'csi'},
    {'code': '000016', 'name': '上证50', 'group': '大盘', 'source': 'csi'},
    {'code': '000905', 'name': '中证500', 'group': '中盘', 'source': 'csi'},
    {'code': '000852', 'name': '中证1000', 'group': '小盘', 'source': 'csi'},
    {'code': '932000', 'name': '中证2000', 'group': '小微盘', 'source': 'csi'},
    {'code': '399303', 'name': '国证2000', 'group': '小微盘', 'source': 'em', 'secid': '0.399303'},
    {'code': '399006', 'name': '创业板指', 'group': '成长红利', 'source': 'em', 'secid': '0.399006'},
    {'code': '000922', 'name': '中证红利', 'group': '成长红利', 'source': 'csi'},
    {'code': '930950', 'name': '中证偏股基金', 'group': '参照', 'source': 'csi'},
    {'code': 'H11001', 'name': '中证全债', 'group': '参照', 'source': 'csi'},
    # ---- 全收益版本 ----
    {'code': 'H00300', 'name': '沪深300全收益', 'group': '大盘', 'source': 'csi', 'tr': True, 'base': '000300'},
    {'code': 'H00905', 'name': '中证500全收益', 'group': '中盘', 'source': 'csi', 'tr': True, 'base': '000905'},
    {'code': 'H00852', 'name': '中证1000全收益', 'group': '小盘', 'source': 'csi', 'tr': True, 'base': '000852'},
    {'code': 'H00922', 'name': '中证红利全收益', 'group': '成长红利', 'source': 'csi', 'tr': True, 'base': '000922'},
    # 中证2000 全收益暂无公开数据，抓不到会自动跳过
    {'code': 'H932000', 'name': '中证2000全收益', 'group': '小微盘', 'source': 'csi',
     'tr': True, 'base': '932000', 'required': False},
]

MIN_POINTS = 2000          # 主指数至少 8 年的交易日
MAX_LAST_GAP_DAYS = 20     # 末个数据点距今天最多 20 个自然日（长假放宽）
MAX_DAILY_MOVE = 0.30      # 单日涨跌超过 30% 视为脏数据


class FetchError(Exception):
    pass


def http_get(url, referer, timeout=30, retries=3):
    last = None
    for i in range(retries):
        req = urllib.request.Request(url, headers={
            'User-Agent': UA,
            'Referer': referer,
            'Accept': 'application/json,text/plain,*/*',
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001 - 网络异常统一重试
            last = e
            if i + 1 < retries:
                time.sleep(1.2 * (i + 1))
    raise FetchError(str(last))


def norm_date(text):
    digits = re.sub(r'\D', '', str(text or ''))
    if len(digits) != 8:
        return None
    y, m, d = int(digits[:4]), int(digits[4:6]), int(digits[6:])
    if not (1990 <= y <= 2100 and 1 <= m <= 12 and 1 <= d <= 31):
        return None
    return y * 10000 + m * 100 + d


def fetch_csi(code, start):
    end = datetime.date.today().strftime('%Y%m%d')
    url = ('https://www.csindex.com.cn/csindex-home/perf/index-perf'
           '?indexCode=%s&startDate=%s&endDate=%s' % (code, start, end))
    raw = http_get(url, 'https://www.csindex.com.cn/')
    try:
        payload = json.loads(raw)
    except ValueError as e:
        raise FetchError('返回内容不是 JSON：%s' % e)
    rows = payload.get('data') or []
    if not isinstance(rows, list):
        raise FetchError('返回结构异常（data 不是列表）')
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        d = norm_date(row.get('tradeDate'))
        close = row.get('close')
        if d is None or close is None:
            continue
        if d % 10000 == 101:      # 元旦那行是基日结转值，不是交易日
            continue
        out.append((d, float(close)))
    return out


def fetch_em(secid, start):
    url = ('https://push2his.eastmoney.com/api/qt/stock/kline/get'
           '?secid=%s&klt=101&fqt=0&beg=%s&end=20500101'
           '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53' % (secid, start))
    raw = http_get(url, 'https://quote.eastmoney.com/')
    try:
        payload = json.loads(raw)
    except ValueError as e:
        raise FetchError('返回内容不是 JSON：%s' % e)
    if payload.get('rc') not in (0, '0'):
        raise FetchError('接口返回 rc=%s（代码可能不存在）' % payload.get('rc'))
    data = payload.get('data') or {}
    klines = data.get('klines') or []
    out = []
    for line in klines:
        parts = str(line).split(',')
        if len(parts) < 2:
            continue
        d = norm_date(parts[0])
        try:
            close = float(parts[1])
        except ValueError:
            continue
        if d is None:
            continue
        out.append((d, close))
    return out


def read_csv(path):
    """两列 CSV：日期、收盘。首行可为表头；支持 UTF-8 / GBK。"""
    text = None
    for enc in ('utf-8-sig', 'gbk', 'utf-8'):
        try:
            with open(path, 'r', encoding=enc) as f:
                text = f.read()
            break
        except (UnicodeDecodeError, LookupError):
            continue
    if text is None:
        raise FetchError('无法识别 CSV 编码')
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        cols = re.split(r'[,\t;]', line)
        if len(cols) < 2:
            continue
        d = norm_date(cols[0])
        if d is None:
            continue
        num = re.sub(r'[^0-9.\-]', '', cols[1])
        try:
            close = float(num)
        except ValueError:
            continue
        out.append((d, close))
    return out


def clean(points):
    points.sort(key=lambda x: x[0])
    out = []
    for d, v in points:
        if v is None or v <= 0:
            continue
        if out and out[-1][0] == d:
            out[-1] = (d, v)
            continue
        out.append((d, v))
    return out


def validate(item, points):
    """返回 (ok, 说明)。主指数不通过则中止，可选指数只告警跳过。"""
    if not points:
        return False, '没有数据'
    if len(points) < 200:
        return False, '点数过少（%d）' % len(points)
    if item.get('required', True) and len(points) < MIN_POINTS:
        return False, '点数不足 %d（实际 %d）' % (MIN_POINTS, len(points))
    first, last = points[0][0], points[-1][0]
    today = int(datetime.date.today().strftime('%Y%m%d'))
    gap = (datetime.date(today // 10000, today // 100 % 100, today % 100)
           - datetime.date(last // 10000, last // 100 % 100, last % 100)).days
    if item.get('required', True) and gap > MAX_LAST_GAP_DAYS:
        return False, '数据过旧（末点 %d，距今 %d 天）' % (last, gap)
    for i in range(1, len(points)):
        prev, cur = points[i - 1][1], points[i][1]
        if prev > 0 and abs(cur / prev - 1) > MAX_DAILY_MOVE:
            return False, '异常跳变 %d 附近（%.2f → %.2f）' % (points[i][0], prev, cur)
    return True, '首 %d 末 %d 共 %d 点' % (first, last, len(points))


def collect(start, only):
    result, warns, errors = [], [], []
    for item in INDICES:
        if only and item['code'] not in only:
            continue
        label = '%s %s' % (item['code'], item['name'])
        try:
            if item['source'] == 'em':
                points = fetch_em(item['secid'], start)
            else:
                points = fetch_csi(item['code'], start)
            points = clean(points)
            ok, why = validate(item, points)
            if not ok:
                if item.get('required', True):
                    errors.append('%s：%s' % (label, why))
                else:
                    warns.append('%s：%s，已跳过' % (label, why))
                continue
            record = {
                'code': item['code'],
                'name': item['name'],
                'group': item['group'],
                'tr': bool(item.get('tr')),
                'ts': [p[0] for p in points],
                'nav': [round(p[1], 2) for p in points],
            }
            if item.get('base'):
                record['base'] = item['base']
            result.append(record)
            print('  [OK] %-26s %s' % (label, why))
        except Exception as e:  # noqa: BLE001
            if item.get('required', True):
                errors.append('%s：%s' % (label, e))
            else:
                warns.append('%s：%s，已跳过' % (label, e))
    return result, warns, errors


def collect_csv(records):
    """samples/indices/*.csv 覆盖同代码的自动抓取结果。"""
    if not os.path.isdir(CSV_DIR):
        return
    names = sorted(os.listdir(CSV_DIR))
    for name in names:
        if not name.lower().endswith('.csv'):
            continue
        path = os.path.join(CSV_DIR, name)
        stem = os.path.splitext(name)[0]
        m = re.match(r'^([0-9A-Za-z]+)[_\-]?(.*)$', stem)
        if not m:
            continue
        code, cn = m.group(1).upper(), (m.group(2) or '').strip()
        try:
            points = clean(read_csv(path))
        except Exception as e:  # noqa: BLE001
            print('  [警告] 自定义指数 %s 读取失败：%s' % (name, e))
            continue
        if len(points) < 2:
            print('  [警告] 自定义指数 %s 有效点不足，跳过' % name)
            continue
        rec = {
            'code': code,
            'name': cn or code,
            'group': '自定义',
            'tr': False,
            'ts': [p[0] for p in points],
            'nav': [round(p[1], 2) for p in points],
        }
        records = [r for r in records if r['code'] != code]
        records.append(rec)
        print('  [CSV] %-26s 首 %d 末 %d 共 %d 点' % (name, points[0][0], points[-1][0], len(points)))
    return records


def main():
    ap = argparse.ArgumentParser(description='抓取内置指数日线，生成 assets/indices.js')
    ap.add_argument('--start', default='20150101', help='起始日期 YYYYMMDD，默认 20150101')
    ap.add_argument('--only', default='', help='只抓这些代码，逗号分隔')
    ap.add_argument('--dry-run', action='store_true', help='只抓取校验，不写文件')
    args = ap.parse_args()

    only = {x.strip().upper() for x in args.only.split(',') if x.strip()}
    print('抓取区间：%s 至今' % args.start)
    records, warns, errors = collect(args.start, only)
    records = collect_csv(records) or records

    # 按配置顺序输出（宽基在前、全收益紧随其后），自定义 CSV 排在最后
    rank = {item['code']: i for i, item in enumerate(INDICES)}
    records.sort(key=lambda r: rank.get(r['code'], 1000))

    for w in warns:
        print('  [警告] ' + w)
    if errors:
        print('')
        for e in errors:
            print('  [错误] ' + e)
        print('\n自检未通过，未写入文件（旧数据保留）。')
        return 1
    if not records:
        print('没有任何可用数据，未写入文件。')
        return 1

    body = ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in records)
    text = (
        '/* 自动生成，请勿手改：py -3 tools/fetch_indices.py */\n'
        'window.NAVApp = window.NAVApp || {};\n'
        'window.NAVApp.indexData = {\n'
        '  "updated": "%s",\n'
        '  "source": "csindex+eastmoney",\n'
        '  "indices": [\n%s\n  ]\n'
        '};\n' % (datetime.date.today().strftime('%Y-%m-%d'), body)
    )

    total_points = sum(len(r['ts']) for r in records)
    size = len(text.encode('utf-8'))
    print('\n合计 %d 条指数，%d 个数据点，%.0f KB（gzip 后约 %.0f KB）'
          % (len(records), total_points, size / 1024.0, size / 1024.0 / 4.2))

    if args.dry_run:
        print('--dry-run：未写入 %s' % os.path.relpath(OUT, ROOT))
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    os.replace(tmp, OUT)
    print('已写入 %s' % os.path.relpath(OUT, ROOT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
