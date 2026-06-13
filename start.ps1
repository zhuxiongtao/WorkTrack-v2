$ErrorActionPreference = "Continue"

Write-Host "========== WorkTrack-v2 启动脚本 ==========" -ForegroundColor Cyan
Write-Host ""

# 0. 启动 PostgreSQL（如果没起）
Write-Host "[0/4] 检查 PostgreSQL..." -ForegroundColor Yellow
$pgCheck = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if (-not $pgCheck) {
    Write-Host "  PostgreSQL 未运行，正在启动..." -ForegroundColor Yellow
    Start-Process PowerShell -ArgumentList "-NoExit", "-Command", "powershell -ExecutionPolicy Bypass -File C:\code\WorkTrack-v2\scripts\start_pg.ps1"
    Start-Sleep -Seconds 5
} else {
    Write-Host "  PostgreSQL 已在 5432 端口运行" -ForegroundColor Green
}

# 1. 启动后端
Write-Host "[1/4] 启动后端服务..." -ForegroundColor Yellow
Start-Process PowerShell -ArgumentList "-NoExit", "-Command", "cd C:\code\WorkTrack-v2\backend; .\.venv\Scripts\Activate; python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
Start-Sleep -Seconds 3

# 2. 启动前端
Write-Host "[2/4] 启动前端服务..." -ForegroundColor Yellow
Start-Process PowerShell -ArgumentList "-NoExit", "-Command", "cd C:\code\WorkTrack-v2\frontend; npm.cmd run dev"
Start-Sleep -Seconds 3

# 3. 启动Frp内网穿透
Write-Host "[3/4] 启动Frp内网穿透..." -ForegroundColor Yellow
Start-Process PowerShell -ArgumentList "-NoExit", "-Command", "cd C:\code\frp\frp_0.61.1_windows_amd64; .\frpc.exe -c frpc.toml"
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "========== 所有服务已启动 ==========" -ForegroundColor Green
Write-Host ""
Write-Host "本地访问：" -ForegroundColor White
Write-Host "  前端：http://localhost:5173" -ForegroundColor Cyan
Write-Host "  后端：http://localhost:8000" -ForegroundColor Cyan
Write-Host ""
Write-Host "远程访问（通过Frp穿透）：" -ForegroundColor White
Write-Host "  前端：http://47.242.242.115:5000" -ForegroundColor Cyan
Write-Host "  后端：http://47.242.242.115:8000" -ForegroundColor Cyan
Write-Host "  RDP： 47.242.242.115:3389" -ForegroundColor Cyan
Write-Host ""
Write-Host "Frp管理面板：http://47.242.242.115:8899" -ForegroundColor Cyan
Write-Host ""
Write-Host "PostgreSQL 监听: 127.0.0.1:5432 (worktrack/worktrack/worktrack)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Green
