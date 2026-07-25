# Release Guide

> 火山杯 2026 比赛期间发版流程
> 从代码冻结到 GitHub Release 的完整步骤

---

## 0. 前置检查

- [ ] 所有 PR 已合并到 master
- [ ] 五绿门禁全绿
- [ ] CHANGELOG.md 已更新 `[Unreleased]` → `[1.x.x]`
- [ ] package.json version 已 bump

```bash
# 在仓库根目录
pnpm typecheck:node && pnpm typecheck:web && pnpm lint && pnpm test
```

---

## 1. 创建 Release 分支

```bash
git checkout master
git pull upstream master
git checkout -b release/v1.x.x
```

---

## 2. 准备发版

### 2.1 更新版本号

```bash
# 编辑 package.json
{
  "version": "1.x.x"  // 改这里
}

# 同步到所有引用处
grep -rn "1.0.0" src/ docs/  # 检查硬编码版本号
```

### 2.2 更新 CHANGELOG.md

把 `## [Unreleased]` 改成 `## [1.x.x] - YYYY-MM-DD`，并写明所有改动。

### 2.3 跑全量验证

```bash
pnpm typecheck:node
pnpm typecheck:web
pnpm lint
pnpm test
pnpm build:win          # Windows 安装包
pnpm build:mac         # macOS DMG（仅 macOS 环境）
pnpm build:linux       # Linux AppImage（仅 Linux 环境）
```

---

## 3. 提交 + 打 Tag

```bash
git add .
git commit -m "chore(release): v1.x.x"
git push origin release/v1.x.x

# 合并到 master
# （通过 PR 合并，确保经过 CI 验证）

# 打 tag
git checkout master
git pull upstream master
git tag -a v1.x.x -m "Release v1.x.x - <一句话总结>"
git push upstream v1.x.x
```

---

## 4. 构建安装包

CI 会自动构建 3 平台安装包并上传到 GitHub Release Draft。

如果需要手动构建：

```bash
# Windows（PowerShell）
$env:GH_TOKEN = "<your-github-token>"
pnpm build:win

# macOS（Terminal）
export GH_TOKEN="<your-github-token>"
pnpm build:mac

# Linux
export GH_TOKEN="<your-github-token>"
pnpm build:linux
```

构建产物路径：`release/` 目录

```
release/
├── TDSF-Linux-Desktop-Setup-1.0.0.exe              # Windows 安装包
├── TDSF-Linux-Desktop-Setup-1.0.0.exe.blockmap     # 增量更新
├── TDSF-Linux-Desktop-1.0.0-mac.dmg                # macOS DMG
├── TDSF-Linux-Desktop-1.0.0.AppImage               # Linux AppImage
└── latest.yml                                       # 更新元数据
```

---

## 5. 创建 GitHub Release

### 5.1 通过 GitHub 网页

1. 访问 https://github.com/harryopo/tdsf-linux-desktop/releases/new
2. 选择 tag：`v1.x.x`
3. Target：`master`
4. Release title：`v1.x.x - <一句话总结>`
5. 描述（自动生成模板）：

```markdown
## ✨ What's New in v1.x.x

### 🎉 Major Features
- ...

### 🐛 Bug Fixes
- ...

### 📚 Documentation
- ...

### ⚠️ Breaking Changes
- ...

### 📦 Installation

| Platform | Download |
|----------|----------|
| Windows  | [TDSF-Linux-Desktop-Setup-1.x.x.exe](https://github.com/...) |
| macOS    | [TDSF-Linux-Desktop-1.x.x.dmg](https://github.com/...) |
| Linux    | [TDSF-Linux-Desktop-1.x.x.AppImage](https://github.com/...) |

**Full Changelog**: https://github.com/harryopo/tdsf-linux-desktop/compare/v1.0.0...v1.x.x
```

6. 勾选 **"Set as a pre-release"**（如果是 RC 版）或 **"Set as latest release"**（稳定版）
7. 上传所有 `release/` 目录下的二进制文件
8. 点击 **"Publish release"**

### 5.2 通过 gh CLI（推荐）

```bash
gh release create v1.x.x \
  --title "v1.x.x - <总结>" \
  --notes-file RELEASE_NOTES.md \
  release/*.exe \
  release/*.dmg \
  release/*.AppImage \
  release/latest.yml
```

---

## 6. 发布后

- [ ] 通知所有关注者（GitHub Watchers）
- [ ] 更新介绍页（[harryopo.github.io/tdsf-linux-desktop](https://harryopo.github.io/tdsf-linux-desktop/)）
- [ ] 在火山杯比赛群发战报
- [ ] 关闭对应 milestone
- [ ] 创建下一个 milestone（如 v1.x.x+1）

---

## 7. 紧急修复

如果是关键 Bug 修复（hotfix）：

1. 从当前 release tag 拉分支：
   ```bash
   git checkout -b hotfix/v1.x.x+1 v1.x.x
   ```
2. 修复 + 单独发版（不合并 master）
3. 打 tag：`v1.x.x+1`
4. 同步回 master：
   ```bash
   git checkout master
   git merge hotfix/v1.x.x+1
   git push
   ```

---

## 8. 版本号规范（SemVer）

```
v<MAJOR>.<MINOR>.<PATCH>

MAJOR: 不兼容的 API 变更
MINOR: 向后兼容的新功能
PATCH: 向后兼容的 Bug 修复
```

示例：
- `v1.0.0` — 首发版本
- `v1.1.0` — 新增功能（向后兼容）
- `v1.0.1` — Bug 修复
- `v2.0.0` — 重大重构（破坏性变更）

预发布版本：
- `v1.1.0-rc.1` — Release Candidate
- `v1.1.0-beta.1` — Beta
- `v1.1.0-alpha.1` — Alpha
