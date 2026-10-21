@echo off
setlocal
cd /d "%~dp0"
title Git, from the inside out
if not exist "git-from-the-inside-out.html" (
  echo Cannot find git-from-the-inside-out.html next to this file.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "git-watch.js" goto nonode
where git >nul 2>nul
if errorlevel 1 echo Note: Git was not found on the PATH. The Live repo page needs it; everything else works.
echo.
echo Starting Git, from the inside out. Keep this window open while you use the Live repo page.
echo.
node git-watch.js %*
echo.
echo The website helper has stopped.
pause
exit /b 0

:nonode
echo Node.js was not found, so the Live repo helper cannot start.
echo Opening the website as a plain file instead. Learn, Lab, Reference, Practice and Session all work.
if defined GITSITE_DRY (echo [dry run] would open the site file) else (start "" "%~dp0git-from-the-inside-out.html")
ping -n 5 127.0.0.1 >nul
exit /b 0
