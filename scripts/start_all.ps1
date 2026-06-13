# WorkTrack-v2 一键启动 (PG 已注册为服务)
$ErrorActionPreference = "Continue"
$LogFile = "C:\code\WorkTrack-v2\logs\startup.log"
New-Item -Path (Split-Path $LogFile) -ItemType Directory -Force | Out-Null
"`n==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 启动 WorkTrack-v2 ====" | Out-File -Append $LogFile

# 1. PostgreSQL (服务模式)
$pgSvc = Get-Service -Name 'PostgreSQL_16' -ErrorAction SilentlyContinue
if ($pgSvc -and $pgSvc.Status -ne 'Running') { Start-Service 'PostgreSQL_16'; "[OK] PG 启动" | Out-File -Append $LogFile }
Start-Sleep -Seconds 2

# 2. 后端 (uvicorn)
$port8000 = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (-not $port8000) {
  Start-Process -FilePath 'python' -ArgumentList '-m','uvicorn','app.main:app','--host','0.0.0.0','--port','8000' -WorkingDirectory 'C:\code\WorkTrack-v2\backend' -WindowStyle Hidden -RedirectStandardOutput 'C:\code\WorkTrack-v2\logs\backend.out.log' -RedirectStandardError 'C:\code\WorkTrack-v2\logs\backend.err.log'
  "[OK] Backend 启动中..." | Out-File -Append $LogFile
  Start-Sleep -Seconds 4
}

# 3. Vite 前端
$port5173 = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if (-not $port5173) {
  Start-Process -FilePath 'cmd' -ArgumentList '/c','npm','run','dev','--','--host','0.0.0.0','--port','5173' -WorkingDirectory 'C:\code\WorkTrack-v2\frontend' -WindowStyle Hidden -RedirectStandardOutput 'C:\code\WorkTrack-v2\logs\frontend.out.log' -RedirectStandardError 'C:\code\WorkTrack-v2\logs\frontend.err.log'
  "[OK] Frontend 启动中..." | Out-File -Append $LogFile
}

# 4. frpc (如果未运行)
$frpc = Get-Process -Name 'frpc' -ErrorAction SilentlyContinue
if (-not $frpc) {
  Start-Process -FilePath 'C:\code\frp\frp_0.61.1_windows_amd64\frpc.exe' -ArgumentList '-c','C:\code\frp\frp_0.61.1_windows_amd64\frpc.toml' -WorkingDirectory 'C:\code\frp\frp_0.61.1_windows_amd64' -WindowStyle Hidden
  "[OK] frpc 启动中..." | Out-File -Append $LogFile
}

"[DONE] 全部服务启动完成 - $(Get-Date -Format 'HH:mm:ss')" | Out-File -Append $LogFile
