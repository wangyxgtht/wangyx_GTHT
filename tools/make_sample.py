# -*- coding: utf-8 -*-
"""生成三份演示用 Excel，覆盖宽表 / 长表 / 带标题行三种结构。
用法: py -3 tools/make_sample.py
"""
import os
import random
from datetime import date, timedelta

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "samples")
FONT = Font(name="Arial", size=10)
HEAD = Font(name="Arial", size=10, bold=True)
FILL = PatternFill("solid", fgColor="DCE6F1")


def nav_path(seed, n, drift, vol, crash=None):
    rnd = random.Random(seed)
    nav = 1.0
    out = []
    for i in range(n):
        r = rnd.gauss(drift, vol)
        if crash and crash[0] <= i <= crash[0] + crash[1]:
            r += crash[2]
        nav *= 1 + r
        out.append(round(nav, 4))
    return out


def weekly_dates(n):
    d = date(2021, 1, 8)
    return [d + timedelta(days=7 * i) for i in range(n)]


def style_sheet(ws, widths):
    for idx, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = w


def wide():
    n = 240
    ds = weekly_dates(n)
    cols = [
        ("稳健配置一号", nav_path(11, n, 0.0022, 0.010, (70, 12, -0.009))),
        ("成长精选二号", nav_path(23, n, 0.0031, 0.018, (66, 14, -0.016))),
        ("中性对冲三号", nav_path(37, n, 0.0014, 0.006, (90, 8, -0.004))),
    ]
    wb = Workbook()
    ws = wb.active
    ws.title = "周度净值"
    ws.append(["净值日期"] + [c[0] for c in cols])
    for i in range(n):
        ws.append([ds[i]] + [c[1][i] for c in cols])
    for cell in ws[1]:
        cell.font = HEAD
        cell.fill = FILL
        cell.alignment = Alignment(horizontal="center")
    for row in ws.iter_rows(min_row=2):
        row[0].number_format = "yyyy-mm-dd"
        for cell in row[1:]:
            cell.number_format = "0.0000"
    style_sheet(ws, [14, 16, 16, 16])
    ws.freeze_panes = "B2"
    path = os.path.join(OUT, "sample_宽表.xlsx")
    wb.save(path)
    return path


def long():
    n = 180
    ds = weekly_dates(n)
    series = [
        ("稳健配置一号", nav_path(101, n, 0.0020, 0.011, (50, 10, -0.008))),
        ("成长精选二号", nav_path(202, n, 0.0028, 0.017, (55, 12, -0.014))),
    ]
    wb = Workbook()
    ws = wb.active
    ws.title = "净值明细"
    ws.append(["产品名称", "净值日期", "单位净值"])
    for name, navs in series:
        for i in range(n):
            ws.append([name, ds[i], navs[i]])
    for cell in ws[1]:
        cell.font = HEAD
        cell.fill = FILL
    for row in ws.iter_rows(min_row=2):
        row[1].number_format = "yyyy-mm-dd"
        row[2].number_format = "0.0000"
    style_sheet(ws, [18, 14, 12])
    path = os.path.join(OUT, "sample_长表.xlsx")
    wb.save(path)
    return path


def with_title():
    n = 156
    ds = weekly_dates(n)
    a = nav_path(303, n, 0.0024, 0.013, (40, 10, -0.010))
    b = nav_path(404, n, 0.0016, 0.009, (60, 9, -0.006))
    wb = Workbook()
    ws = wb.active
    ws.title = "2026年第43周"
    ws.merge_cells("A1:D1")
    ws["A1"] = "某私募产品净值跟踪周报（2021/1/8 - 2026/9/25）"
    ws["A1"].font = Font(name="Arial", size=13, bold=True)
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.merge_cells("A2:D2")
    ws["A2"] = "数据来源：托管方估值表  单位：元"
    ws["A2"].font = Font(name="Arial", size=9, italic=True, color="808080")
    ws.append([])
    ws.append(["日期", "产品A 单位净值", "产品B 单位净值", "备注"])
    for i in range(n):
        note = "分红" if i == 100 else ""
        ws.append([ds[i], a[i], b[i], note])
    for cell in ws[4]:
        cell.font = HEAD
        cell.fill = FILL
    for row in ws.iter_rows(min_row=5):
        row[0].number_format = "yyyy-mm-dd"
        row[1].number_format = "0.0000"
        row[2].number_format = "0.0000"
    style_sheet(ws, [14, 18, 18, 10])
    path = os.path.join(OUT, "sample_带标题行.xlsx")
    wb.save(path)
    return path


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in (wide, long, with_title):
        print(f())


if __name__ == "__main__":
    main()
