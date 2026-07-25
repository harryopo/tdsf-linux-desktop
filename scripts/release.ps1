#!/usr/bin/env pwsh
# TDSF-Linux Desktop — GitHub Release v1.0 发版脚本
#
# 火山杯开源加分项：发版流程标准化
#
# 使用方法：
#   1. 确认 package.json 中 version = "1.0.0"
#   2. 确认 CHANGELOG.md 顶部有 v1.0.0 条目
#   3. 在 master 分支执行：pwsh scripts/release.ps1
#
# 前置条件：
#   - gh CLI 已登录（gh auth status）
#   - 五绿门禁已通过（typecheck:node / typecheck:web / lint / test / build:win）
#   - master 分支已推送最新代码

$ErrorActionPreference = "Stop"

# ============== 1. 前置检查 ==============
Write-Host "===== 1. 前置检查 =====" -ForegroundColor Cyan

$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$version = $pkg.version
Write-Host "package.json version = $version"

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "master") {
    Write-Host "❌ 当前分支为 $branch，发版必须在 master 分支" -ForegroundColor Red
    exit 1
}

$uncommitted = git status -s
if ($uncommitted) {
    Write-Host "❌ 工作区有未提交改动" -ForegroundColor Red
    Write-Host $uncommitted
    exit 1
}

# 检查远程是否领先
$local = git rev-parse master
$remote = git rev-parse origin/master
if ($local -ne $remote) {
    Write-Host "⚠️  本地与远程不同步：local=$local, remote=$remote" -ForegroundColor Yellow
    $confirm = Read-Host "是否先 push？(y/n)"
    if ($confirm -eq "y") {
        git push origin master
    } else {
        exit 1
    }
}

# ============== 2. 提取 CHANGELOG 中的版本说明 ==============
Write-Host "`n===== 2. 提取 Release Notes =====" -ForegroundColor Cyan

$changelog = Get-Content "CHANGELOG.md" -Raw
# 匹配 ## [v1.0.0] 到下一个 ## 之间的内容
$pattern = "(?ms)## \[$version\].*?(?=^## \[|\z)"
$match = [regex]::Match($changelog, $pattern)
if (-not $match.Success) {
    Write-Host "❌ CHANGELOG.md 中未找到 [$version] 条目" -ForegroundColor Red
    exit 1
}
$notes = $match.Value.Trim()
Write-Host "提取到 Release Notes（$($notes.Length) 字符）"

# ============== 3. 选择 Release 类型 ==============
Write-Host "`n===== 3. Release 类型 =====" -ForegroundColor Cyan
Write-Host "  1) Major (破坏性变更)"
Write-Host "  2) Minor (新功能)"
Write-Host "  3) Patch (修复)"
$default = if ($version -match "^\d+\.0\.0$") { 1 } else { 3 }
$typeChoice = Read-Host "请选择 (默认 $default)"
if ([string]::IsNullOrWhiteSpace($typeChoice)) { $typeChoice = $default }
$prerelease = $false
$draft = $true  # 默认 draft，避免误发
$typeNames = @("major", "minor", "patch")
$typeName = $typeNames[$typeChoice - 1]
Write-Host "类型：$typeName, draft=$draft"

# ============== 4. 写 Release Notes 到临时文件 ==============
$tmp = New-TemporaryFile
@"
# TDSF-Linux Desktop v$version

$notes

---

## 📦 安装包

| 平台 | 链接 |
|------|------|
| Windows (.exe) | https://github.com/harryopo/tdsf-linux-desktop/releases/download/v$version/TDSF-Linux-Desktop-Setup-$version.exe |
| macOS (.dmg) | https://github.com/harryopo/tdsf-linux-desktop/releases/download/v$version/TDSF-Linux-Desktop-$version.dmg |
| Linux (.AppImage) | https://github.com/harryopo/tdsf-linux-desktop/releases/download/v$version/TDSF-Linux-Desktop-$version.AppImage |

## 🔗 相关链接

- 📖 [README](https://github.com/harryopo/tdsf-linux-desktop/blob/v$version/README.md)
- 🐛 [问题反馈](https://github.com/harryopo/tdsf-linux-desktop/issues/new/choose)
- 💬 [讨论区](https://github.com/harryopo/tdsf-linux-desktop/discussions)
- 🌐 [项目介绍页](https://harryopo.github.io/tdsf-linux-desktop/)

## 🙏 致谢

本版本使用 Claude Code + 多个 subagent 协作开发完成。
"@ | Set-Content -Path $tmp.FullName -Encoding utf8

Write-Host "`n===== Release Notes Preview =====" -ForegroundColor Cyan
Get-Content $tmp.FullName | Select-Object -First 30

# ============== 5. 创建 Release (Draft) ==============
Write-Host "`n===== 5. 创建 GitHub Release (Draft) =====" -ForegroundColor Cyan
$tag = "v$version"
$title = "TDSF-Linux Desktop v$version"

gh release create $tag `
    --title $title `
    --notes-file $tmp.FullName `
    --target master `
    --latest=$typeName `
    $(if ($draft) { "--draft" }) `
    $(if ($prerelease) { "--prerelease" })

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ gh release create 失败" -ForegroundColor Red
    exit 1
}

Remove-Item $tmp.FullName

# ============== 6. 上传安装包 ==============
Write-Host "`n===== 6. 上传安装包 =====" -ForegroundColor Cyan
$distPath = "release-fresh"
if (Test-Path $distPath) {
    $files = Get-ChildItem $distPath -File
    if ($files.Count -gt 0) {
        Write-Host "找到 $($files.Count) 个安装包："
        $files | ForEach-Object { Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1MB, 2)) MB)" }
        $upload = Read-Host "是否上传？(y/n)"
        if ($upload -eq "y") {
            $files | ForEach-Object {
                gh release upload $tag $_.FullName --clobber
            }
        }
    } else {
        Write-Host "⚠️  release-fresh/ 目录为空，先跑 pnpm build:win 生成 .exe" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  release-fresh/ 目录不存在，先跑 pnpm build:win 生成 .exe" -ForegroundColor Yellow
}

# ============== 7. 完成 ==============
Write-Host "`n✅ Release Draft 已创建：https://github.com/harryopo/tdsf-linux-desktop/releases/tag/$tag" -ForegroundColor Green
Write-Host "请在浏览器中检查内容，确认无误后点击 'Publish release'"
