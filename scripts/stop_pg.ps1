# WorkTrack-v2 PostgreSQL 停止脚本
# 用法: powershell -ExecutionPolicy Bypass -File C:\tools\pgsql\stop_pg.ps1

$ErrorActionPreference = "Stop"
$pgBin = "C:\tools\pgsql\bin"
$pgData = "C:\tools\pgsql\data"

$env:Path = "$pgBin;" + $env:Path

$already = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if (-not $already) {
    Write-Host "[OK] PostgreSQL 未在 5432 端口运行, 无需停止" -ForegroundColor Green
    exit 0
}

Write-Host "[*] 停止 PostgreSQL..." -ForegroundColor Cyan
pg_ctl -D $pgData stop -m fast

Start-Sleep -Seconds 2

$check = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if (-not $check) {
    Write-Host "[OK] PostgreSQL 已停止" -ForegroundColor Green
} else {
    Write-Host "[ERR] PostgreSQL 停止失败" -ForegroundColor Red
    exit 1
}
