# WorkTrack-v2 PostgreSQL 启动脚本
# 用法: powershell -ExecutionPolicy Bypass -File C:\tools\pgsql\start_pg.ps1

$ErrorActionPreference = "Stop"
$pgBin = "C:\tools\pgsql\bin"
$pgData = "C:\tools\pgsql\data"
$pgLog = "C:\tools\pgsql\logs\pg.log"

$env:Path = "$pgBin;" + $env:Path

$already = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if ($already) {
    Write-Host "[OK] PostgreSQL 已在 5432 端口运行 (PID $($already.OwningProcess))" -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $pgData)) {
    Write-Host "[ERR] 数据目录不存在: $pgData" -ForegroundColor Red
    Write-Host "      请先运行 initdb -D $pgData -U postgres -A trust -E UTF8 --locale=C" -ForegroundColor Yellow
    exit 1
}

Write-Host "[*] 启动 PostgreSQL 16..." -ForegroundColor Cyan
pg_ctl -D $pgData -l $pgLog start

Start-Sleep -Seconds 3

$check = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if ($check) {
    Write-Host "[OK] PostgreSQL 启动成功, 监听 5432 端口" -ForegroundColor Green
} else {
    Write-Host "[ERR] PostgreSQL 启动失败, 查看日志: $pgLog" -ForegroundColor Red
    Get-Content $pgLog -Tail 20
    exit 1
}
