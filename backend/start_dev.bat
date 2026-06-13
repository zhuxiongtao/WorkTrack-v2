@echo off
cd /d C:\code\WorkTrack-v2\backend
"C:\Users\zxt\AppData\Local\Programs\Python\Python312\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --log-level info
