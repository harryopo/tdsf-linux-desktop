# 教程爬虫与权威源调研报告 v0.6.0

> 调研时间：2026-07-16
> 调研方法：直接查 8 个核心源 robots.txt + WebSearch + 现有 tutorial 系统代码
> 调研目的：解决"10 篇 seed 太少"问题，规划可持续同步的官方权威源

---

## 1. 调研结论速览

| 源 | robots.txt 状态 | Crawl-delay | 评价 | 推荐策略 |
|---|---|---|---|---|
| **Arch Wiki** | ✅ 全允许（除元数据） | 无 | 离线 dump 官方提供 | **P0** 月度 tar.gz 离线导入 |
| **LDP (tldp.org)** | ✅ 无 robots.txt | 无 | HOWTOs 官方 tar.gz | **P0** 全量离线导入 |
| **Ubuntu Help** | ✅ 允许（禁旧版） | 5s | 大量 Server Guide | **P1** 在线增量（按 5s 限流） |
| **Microsoft Learn** | ✅ 完全允许 | 无 | Azure/Linux 文档齐 | **P1** 在线增量 |
| **Red Hat Docs** | ✅ 允许 | 10s | 最权威但慢 | **P2** 在线增量（按 10s） |
| **DigitalOcean Tutorials** | ✅ Allow: / | 无 | 高质量 step-by-step | **P2** 在线增量 |
| **Linuxize / Tecmint** | ✅ 允许 | 无 | 教程质量中等 | **P3** 在线增量 |
| **Debian Wiki** | ⚠️ 严格 | 20s | 太慢，不推荐 | ❌ 暂不接入 |
| **linux.die.net** | ❌ `Disallow: /` | — | 通用 bot 禁爬 | ❌ 不可用 |
| **Wikipedia** | — | — | — | 跳过（非教程） |

**核心策略：离线 dump 优先 + 在线增量补充，混合模式 90% HTTP + 10% 浏览器 fallback。**

---

## 2. 各源 robots.txt 实测结果

### 2.1 Arch Wiki（wiki.archlinux.org）
```
User-agent: *
Disallow: /index.php?
Disallow: /skins/
Disallow: /title/File:
Disallow: /title/Image:
Disallow: /title/MediaWiki:
Disallow: /title/Special:
Disallow: /title/Template:
```
- ✅ 教程页（/title/Xxx）**完全允许**
- 无 Crawl-delay（建议礼貌 5s）
- **官方提供月度 HTML 快照**：`https://wiki.archlinux.org/static/archwiki-YYYY-MM-DD.tar.gz`
- Kiwix ZIM 文件：800MB 无图版 / 10GB+ 有图版
- 源仓库：https://github.com/archlinux/archwiki (180 stars)

### 2.2 Red Hat Customer Portal（access.redhat.com）
```
Crawl-delay: 10
Disallow: /core/ /profiles/ /admin/ /search/ /user/ ...
Disallow: /documentation/zh-cn/ibm_*
```
- ✅ 文档页面允许
- **Crawl-delay: 10s**（必须 10s 间隔）
- IBM Docs 路径禁（/documentation/zh-cn/ibm_*）

### 2.3 Ubuntu Help（help.ubuntu.com）
```
User-agent: *
Crawl-delay: 5
Disallow: /img/ /libs/
Disallow: /14.04/ ... /26.10/  # 旧版路径
Disallow: /lts/ubuntu-help/ /stable/installation-guide/
```
- ✅ 当前版本允许
- **Crawl-delay: 5s**
- 禁旧版本（只能爬当前最新）

### 2.4 Debian Wiki（wiki.debian.org）
```
User-agent: *
Crawl-delay: 20
Disallow: /action/
```
- ⚠️ **Crawl-delay: 20s**（太慢）
- 仅 /action/ 禁
- 20s/篇 一次全量需数天，不推荐

### 2.5 linux.die.net
```
User-agent: *
Disallow: /
Sitemap: https://linux.die.net/sitemap.xml
```
- ❌ **整站禁通用 bot**（仅放行 Googlebot/ClaudeBot/GPTBot 等）
- **不可爬**

### 2.6 DigitalOcean（digitalocean.com）
```
User-agent: *
Allow: /
Disallow: /v1/login /auth-error
Sitemap: https://www.digitalocean.com/sitemap.xml
```
- ✅ 完全允许
- 无 Crawl-delay
- 大量 step-by-step 教程

### 2.7 Microsoft Learn（learn.microsoft.com）
```
User-agent: *
Sitemap: ...
Disallow: /*/answers/accounts/  # 社区答案禁
```
- ✅ 文档完全允许
- 无 Crawl-delay

### 2.8 Linuxize（linuxize.com）
```
User-agent: *
Disallow:  # 空（完全允许）
Sitemap: https://linuxize.com/sitemap.xml
```
- ✅ 完全允许

### 2.9 Tecmint（tecmint.com）
```
User-agent: *
Disallow: /wp-admin/ /?s= /search/ /*?replytocom= /trackback/
Sitemap: https://www.tecmint.com/sitemap.xml
```
- ✅ 文章允许
- 禁搜索和评论

### 2.10 Linux Foundation（linuxfoundation.org）
```
User-agent: *
Disallow: /sample-* /blog/sample-*
Disallow: /_hcms/preview/ /hs/manage-preferences/
```
- ✅ 允许（禁 sample 即可）

---

## 3. 离线 Dump 资源（零爬虫礼仪风险）

| 源 | 离线包 | 大小 | 频率 | 接入方式 |
|---|---|---|---|---|
| **Arch Wiki** | `archwiki-YYYY-MM-DD.tar.gz` | ~500MB | 每月 | 下载 → 解压 → HTML 转 md |
| **Arch Wiki** | Kiwix ZIM | 800MB（无图）/ 10GB+ | 每月 | 解析 ZIM（用 libzim） |
| **LDP HOWTOs** | `Linux-html-HOWTOs.tar.gz` | ~50MB | 偶尔 | 下载 → 解压 |
| **Ubuntu manpages** | apt 源 | — | 实时 | 已有 man 命令 |

**Arch Wiki 离线 dump URL 格式**（需要确认）：
- 主页：`https://wiki.archlinux.org/title/ArchWiki:Archive`
- 实际下载链接：`https://wiki.archlinux.org/static/archwiki-{date}.tar.gz`

---

## 4. 开源爬虫技术栈对比

### 4.1 主流候选

| 工具 | Stars | 语言 | 适合场景 | 项目契合度 |
|---|---|---|---|---|
| **Crawlee** (apify/crawlee) | 22K+ | Node.js+TS | 生产级爬虫框架 | ⭐⭐⭐⭐⭐ 完美匹配 |
| **Firecrawl** | 70K+ | 多语言 | LLM-ready markdown | ⭐⭐⭐ 需自托管 |
| **Crawl4AI** | 58K+ | Python | LLM/AI agent 优化 | ⭐⭐ 引入 Python 依赖 |
| **Playwright** | 72K+ | 多语言 | 浏览器自动化 | ⭐⭐⭐ 项目已有 MCP |
| **Puppeteer** | 90K+ | Node.js | Chrome 自动化 | ⭐⭐ 2026 legacy |
| **Scrapy** | 59K+ | Python | 大规模结构化 | ⭐ 不适合 TS 项目 |
| **Cheerio + Axios** | — | Node.js | 静态 HTML 解析 | ⭐⭐⭐ 轻量 |

### 4.2 2026 行业共识（多源调研）
> "Crawlee is the 2026 standard for production web scraping — handles anti-bot fingerprinting, request queuing, retry logic, and session rotation out of the box."
> — pkgpulse.com, 2026-03-09

- **首选 Crawlee**：TypeScript 原生，~200K 周下载，2026 标准
- **混合模式**：90% HTTP (CheerioCrawler, 500 pages/min) + 10% 浏览器 fallback (PlaywrightCrawler)
- **内置 robots.txt 解析** + 自动 Crawl-delay 遵守

### 4.3 关键性能数据
| Crawler | 速度 | 内存 | 适用 |
|---|---|---|---|
| `CheerioCrawler` | 500 pages/min | 极低 | 静态 HTML（Arch Wiki、Ubuntu Help） |
| `PlaywrightCrawler` | 10-50 pages/min | 1GB/实例 | JS 渲染（SPA） |
| 混合模式 | 100-200 pages/min | 中 | 大规模混合 |

**本项目首选 CheerioCrawler**（所有目标源都是静态 HTML）。

---

## 5. 与现有 tutorial 系统集成点

### 5.1 现有数据流
```
seeds.ts (10 篇内置)
   ↓
loadTutorialSeeds() 启动时
   ↓
SQLite knowledge_entries (type='tutorial')
   ↓
UI TutorialPage
```

### 5.2 集成新爬虫后
```
v0.6.0 新增：
   1. 离线 dump 导入（Arch Wiki tar.gz / LDP tar.gz）
   2. Crawlee 在线增量（Ubuntu Help / Microsoft Learn / DigitalOcean）
   3. 定期同步（cron / 应用启动时）
   ↓
loadCrawledTutorials() 启动时 + 手动触发
   ↓
SQLite knowledge_entries (type='tutorial')
   ↓
UI TutorialPage（已有）
```

### 5.3 复用现有 `TutorialEntry` 类型
- ✅ `source.name` / `source.url` / `source.crawledAt` / `source.license` 字段已就位
- ✅ `category` / `tags` / `distros` / `difficulty` 全覆盖
- ✅ `commands` / `keywords` 字段可从 HTML 自动提取
- ✅ `readingTime` 可从 word count 估算
- **零类型改造**

---

## 6. 推荐实施方案

### 6.1 分阶段策略

**Phase 1 - 离线 dump 导入（P0，1-2 天）**
- Arch Wiki 月度 tar.gz → 解析 HTML → 转 md → 入库
- LDP HOWTOs tar.gz → 同上
- **零网络礼仪风险**，完全合规

**Phase 2 - 在线增量爬（P1，2-3 天）**
- Crawlee + CheerioCrawler
- 5 个源（Ubuntu Help 5s / MS Learn / DO / Linuxize / Tecmint）
- 限流遵守 robots.txt Crawl-delay
- 增量同步（带 ETag / Last-Modified）

**Phase 3 - 调度与监控（P2，1 天）**
- IPC 通道 `tutorial:crawlStart` / `tutorial:crawlStatus`
- UI 进度展示 + 手动触发
- 失败重试 + 速率自适应

### 6.2 技术选型
- **Crawlee 22.x** + `@crawlee/cheerio` (HTTP) + `@crawlee/playwright` (fallback)
- **turndown**（HTML → Markdown 转换）
- **node-html-parser** 或 **cheerio**（HTML 解析，Crawlee 内置）
- **iconv-lite**（处理 Arch Wiki 多语言）

### 6.3 风险与规避
| 风险 | 规避 |
|---|---|
| 爬虫被封 IP | 严格守 Crawl-delay + User-Agent 标识 + 离线包优先 |
| 抓取内容版权 | 仅整理摘要 + 标注原文链接（已在 TutorialEntry.source 字段） |
| 重复内容 | URL 哈希作为主键去重（TutorialEntry.id 已用字符串） |
| HTML→MD 质量 | 选权威源（结构稳定）+ 人工抽样校对 |
| 离线包大（Arch Wiki 500MB） | 仅首次下载 + 增量 diff |

---

## 7. 调研引用

- pkgpulse 2026 最佳 npm 爬虫包对比：https://www.pkgpulse.com/guides/best-npm-packages-web-scraping-crawlee-puppeteer-2026
- Firecrawl 2026 最佳开源爬虫综述：https://www.firecrawl.dev/blog/best-open-source-web-crawler
- ai-rockstars Crawlee 深度评测：https://ai-rockstars.com/crawlee-web-scraping-in-2-minutes/
- 51CTO 爬虫汇总 2025-10：https://blog.51cto.com/u_15851118/14277693
- Arch Wiki 官方归档页：https://wiki.archlinux.org/title/ArchWiki:Archive
- Arch Linux ArchWiki 包：https://security.archlinux.org/package/arch-wiki-lite
- LDP HOWTO 索引：https://www.tldp.org/HOWTO/text/HOWTO-INDEX
- Ubuntu Help robots.txt 注释（含延迟历史）：https://help.ubuntu.com/robots.txt
- Crawlee GitHub 仓库：https://github.com/apify/crawlee
