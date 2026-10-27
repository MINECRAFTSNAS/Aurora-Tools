# Aurora Tools 打包脚本
# 用法: pwsh -File scripts/build.ps1 [-SkipIcon]

param(
  [switch]$SkipIcon
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "=== Aurora Tools 构建 ===" -ForegroundColor Cyan

# 关键：清除 ELECTRON_RUN_AS_NODE，否则 electron 会以纯 Node 模式运行
Remove-Item env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# 国内镜像（electron 二进制与 builder 附属二进制）
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

# 1) 图标
if (-not $SkipIcon) {
  if (Test-Path 'scripts/make_icon.py') {
    Write-Host "[1/5] 生成图标" -ForegroundColor Yellow
    python scripts/make_icon.py
    if ($LASTEXITCODE -ne 0) { throw "图标生成失败" }
  }
} else {
  Write-Host "[1/5] 跳过图标生成" -ForegroundColor DarkGray
}

# 2) 校验内置二进制
Write-Host "[2/5] 校验内置二进制" -ForegroundColor Yellow
foreach ($f in @('yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe')) {
  $p = "resources/bin/$f"
  if (-not (Test-Path $p)) { throw "缺少内置二进制: $p" }
  $size = (Get-Item $p).Length / 1MB
  Write-Host ("    {0,-14} {1,8:N2} MB" -f $f, $size)
}

# 3) 类型检查
Write-Host "[3/5] TypeScript 类型检查" -ForegroundColor Yellow
npx tsc --noEmit -p tsconfig.node.json
if ($LASTEXITCODE -ne 0) { throw "主进程类型检查失败" }
npx tsc --noEmit -p tsconfig.web.json
if ($LASTEXITCODE -ne 0) { throw "渲染层类型检查失败" }

# 4) 编译
Write-Host "[4/5] 编译 (electron-vite)" -ForegroundColor Yellow
npx electron-vite build
if ($LASTEXITCODE -ne 0) { throw "编译失败" }

# 5) 打包
Write-Host "[5/5] 打包 (electron-builder)" -ForegroundColor Yellow
npx electron-builder --win --x64
if ($LASTEXITCODE -ne 0) { throw "打包失败" }

Write-Host "`n=== 产物 ===" -ForegroundColor Green
Get-ChildItem release -Filter *.exe | ForEach-Object {
  Write-Host ("  {0,-46} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB))
}
