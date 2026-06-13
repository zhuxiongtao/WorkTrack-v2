@echo off
cd /d C:\code\WorkTrack-v2\frontend
where node >nul 2>&1
if errorlevel 1 (
  echo node not found in PATH
  exit /b 1
)
call npm run dev -- --host 127.0.0.1 --port 5173
