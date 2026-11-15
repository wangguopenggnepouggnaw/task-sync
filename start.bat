@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动任务同步服务...
node server.js
pause
