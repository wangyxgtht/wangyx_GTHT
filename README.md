# 净值分析台

国泰君安期货深圳分公司 · 王昱翔

拖入 Excel，自动识别表头、生成净值走势图与全套绩效指标（年化、波动、夏普、卡玛、索提诺、最大回撤及修复天数、区间/年度收益、VaR），支持基准对比与多产品业绩对比。

**所有解析与计算都在浏览器内完成，文件不会上传到任何服务器。**

---

## 1. 三种用法

| 用法 | 怎么打开 | 档案存哪 | 适用 |
| --- | --- | --- | --- |
| 离线单文件 | 双击 `index.html` | 浏览器本地 | 不想联网、临时看一眼 |
| 本机服务 | 双击 `启动档案服务.bat` → `http://127.0.0.1:8791` | 项目内 `档案/` 文件夹 | 想留档到硬盘、要看 .md 快照 |
| 在线版 | 手机/电脑浏览器打开线上地址 | 当前浏览器（IndexedDB） | 出差、手机随时看 |

**线上地址：<https://nav-excel.pages.dev>**（手机、电脑浏览器都可直接打开）

### 手机上用

1. 用系统浏览器（Safari / Chrome / Edge）打开线上地址 —— **不要用微信内置浏览器**，微信里点右上角「…」→「在浏览器打开」。
2. 点顶栏「安装到桌面」，或浏览器菜单里的「添加到主屏幕 / 安装应用」。
3. 之后从桌面图标打开，全屏运行，断网也能打开已缓存的页面。

---

## 2. 本地 / 在线的隔离方式

源码只有一份，但**发布内容与本地私有内容物理隔离**：

```
excel解析/
├── index.html  manifest.webmanifest  sw.js  _headers      ← 站点本体
├── assets/  lib/  icons/                                  ← 站点资源
├── tools/                                                 ← 发布与维护脚本
├── server/                                                ← 本地档案服务（线上不需要）
├── 档案/                                                   ← 你的净值文件（隐私，永不外发）
├── samples/  *.bat  *.md                                  ← 本地工具与文档
└── dist/                                                  ← 每次发布生成的「在线包」
```

- `tools/build_dist.py` 只把站点本体 + `assets/` + `lib/` + `icons/` 拷进 `dist/`；
  `档案/`、`server/`、`tools/`、`samples/`、`*.bat` **一律不进发布包**。
- `.gitignore` 同时排除 `档案/` 和 `dist/`，你的 Excel 和数据不会被推到 GitHub。
- Cloudflare Pages 只认 `dist/` 作为输出目录，公网访问不到本地服务与档案。

---

## 3. 线上部署（已完成，此处记录配置以便重建）

| 项目 | 值 |
| --- | --- |
| 线上地址 | <https://nav-excel.pages.dev> |
| 平台 | Cloudflare Pages，项目名 `nav-excel`，生产分支 `main` |
| 部署方式 | **Direct Upload**（命令行直接上传 `dist/`，不走 Git 自动构建） |
| 账号 | wangyuxiang@gtht.com |
| 授权方式 | `npx wrangler login`（一次即可，凭据存在 `%APPDATA%\xdg.config\.wrangler\`） |
| 代码备份 | <https://github.com/wangyxgtht/wangyx_GTHT>（push 只做备份，不触发部署） |

之所以用 Direct Upload 而不用 Git 集成：一是控制台改版后入口难找，二是 Direct Upload 完全由本机命令完成，不依赖网页操作，改动发布一条命令就够；三是仍可精确控制上传内容（只有 `dist/`）。

### 3.1 换电脑或重建项目

```bat
npx wrangler login

:: 项目不存在时才需要
npx wrangler pages project create nav-excel --production-branch main

npx wrangler pages deploy dist --project-name nav-excel --branch main
```

> 国内访问 `*.pages.dev` 有时偏慢或被干扰。稳定做法是绑一个自己的域名（无需备案，服务器在境外），在 Pages 项目 → **Custom domains** 里添加即可。

---

## 4. 日常更新（改了功能之后）

双击 **`发布上线.bat`**，它会依次：

1. `tools/bump_version.py` —— 把 `index.html` 的 `?v=` 与 `sw.js` 的 `CACHE_VERSION` 刷成当天版本（同一天多次发布自动 a→b→c），并检查引用的文件是否都存在，**自检不过会中止**；
2. `tools/build_dist.py` —— 重新生成 `dist/` 发布包（只含站点文件）；
3. `npx wrangler pages deploy dist` —— 上传到 Cloudflare Pages，几秒完成；
4. `git add / commit / push` —— 同步到 GitHub 做备份。

手动等价命令：

```bat
py -3 tools/bump_version.py
py -3 tools/build_dist.py
npx wrangler pages deploy dist --project-name nav-excel --branch main --commit-dirty=true
git add -A && git commit -m "update" && git push
```

页面走 network-first，用户刷新即拿到新版，不会卡在旧缓存。

---

## 5. 数据与隐私

- Excel 在浏览器内用 SheetJS 解析，指标在浏览器内计算，**不上传任何服务器**（页面上可以用 F12 → Network 自行验证）。
- 在线版的档案存在浏览器 IndexedDB 里：换设备、换浏览器、清理浏览器数据后就看不到了。
  重要档案请点侧栏「打包导出全部」下载 ZIP 备份。
- 本机服务的档案落在项目内 `档案/` 文件夹（`时间戳_原文件名.xlsx` + 同名 `.md` 快照 + `档案索引.csv`），这些文件不会进仓库。

---

## 6. 常见问题

**改了代码但页面还是旧的？**
在线版：`发布上线.bat` 会自动换版本号，刷新即可；必要时 Ctrl+F5。
本地 `file://` 打开：浏览器会缓存 JS，Ctrl+F5 强制刷新。

**顶栏没有「安装到桌面」按钮？**
Chrome / Edge 需要 HTTPS 且访问过一次才会弹出安装事件；iOS 只有 Safari 支持「添加到主屏幕」。已经装过（独立窗口运行）时按钮会自动隐藏。

**手机上拖拽不好用？**
点拖拽区任意位置会直接弹出文件选择框。

**微信里打不开？**
微信内置浏览器对文件选择限制多，请用系统浏览器打开。

**本地档案服务要不要留？**
要，它是可选的增强功能。线上地址访问时不会去探测本机服务（否则会白等 6 秒），只有 `file://` / `localhost` / `127.0.0.1` / 局域网 IP 才会探测。

---

## 7. 目录说明

| 路径 | 作用 |
| --- | --- |
| `index.html` | 页面骨架 |
| `assets/parser.js` | Excel 结构识别 |
| `assets/metrics.js` | 绩效指标计算 |
| `assets/charts.js` | ECharts 图表 |
| `assets/compare.js` | 多产品业绩对比 |
| `assets/archive.js` | 档案（本机服务 / 浏览器 IndexedDB 双通路） |
| `assets/ui.js` | 交互与渲染 |
| `assets/style.css` | 样式（含移动端适配） |
| `sw.js` `manifest.webmanifest` `_headers` | 离线缓存与安装配置 |
| `icons/` | 应用图标（由 `tools/make_icons.py` 生成） |
| `server/archive_server.py` | 本地档案服务（Python 标准库） |
| `tools/` | 版本号、发布包、图标、自启脚本 |
