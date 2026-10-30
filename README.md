# 净值分析台

拖入 Excel，自动识别表头、生成净值走势图与全套绩效指标（年化、波动、夏普、卡玛、索提诺、最大回撤及修复天数、区间/年度收益、VaR），支持基准对比与多产品业绩对比。

**所有解析与计算都在浏览器内完成，文件不会上传到任何服务器。**

---

## 1. 三种用法

| 用法 | 怎么打开 | 档案存哪 | 适用 |
| --- | --- | --- | --- |
| 离线单文件 | 双击 `index.html` | 浏览器本地 | 不想联网、临时看一眼 |
| 本机服务 | 双击 `启动档案服务.bat` → `http://127.0.0.1:8791` | 项目内 `档案/` 文件夹 | 想留档到硬盘、要看 .md 快照 |
| 在线版 | 手机/电脑浏览器打开线上地址 | 当前浏览器（IndexedDB） | 出差、手机随时看 |

线上地址：`https://<你的项目名>.pages.dev`（部署后把这里替换成实际地址）

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

## 3. 首次部署（只需做一次）

### 3.1 推到 GitHub

1. 打开 <https://github.com/new>，新建仓库（建议 **Private**），不要勾选任何初始化文件。
2. 复制仓库地址，在本项目目录执行：

```bat
git init
git branch -M main
git remote add origin https://github.com/你的账号/你的仓库名.git
git add -A
git commit -m "init: 净值分析台在线版"
git push -u origin main
```

> 首次 push 会弹出 GitHub 登录窗口，按提示授权即可。之后本机会记住凭据，`发布上线.bat` 不再需要登录。

### 3.2 接到 Cloudflare Pages

1. 打开 <https://dash.cloudflare.com/> → 左侧 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 授权 GitHub，选中刚才的仓库，点 **Begin setup**。
3. 填写：

| 配置项 | 值 |
| --- | --- |
| Project name | 例如 `nav-excel`（决定网址 `nav-excel.pages.dev`） |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `mkdir -p dist && cp index.html manifest.webmanifest sw.js _headers dist/ && cp -r assets lib icons dist/` |
| Build output directory | `dist` |

4. 点 **Save and Deploy**，等约 1 分钟，访问 `https://<项目名>.pages.dev`。

> 国内访问 `*.pages.dev` 有时偏慢或被干扰。稳定做法是买一个自己的域名（无需备案，因为服务器在境外），在 Pages 项目 → **Custom domains** 里绑定，之后用自定义域名访问。

---

## 4. 日常更新（改了功能之后）

双击 **`发布上线.bat`**，它会依次：

1. `tools/bump_version.py` —— 把 `index.html` 的 `?v=` 与 `sw.js` 的 `CACHE_VERSION` 刷成当天版本（同一天多次发布自动 a→b→c），并检查引用的文件是否都存在，**自检不过会中止**；
2. `tools/build_dist.py` —— 重新生成 `dist/` 发布包；
3. `git add / commit / push`。

推上去之后 Cloudflare 自动构建，约 1 分钟线上就是新版。用户刷新页面即生效（页面走 network-first，不会卡在旧版本）。

手动等价命令：

```bat
py -3 tools/bump_version.py
py -3 tools/build_dist.py
git add -A && git commit -m "update" && git push
```

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
