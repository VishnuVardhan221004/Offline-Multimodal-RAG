@echo off
REM Stops the backend (port 8000) and the UI (port 5173). Ollama keeps running.
for %%P in (8000 5173) do (
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
        taskkill /PID %%I /T /F >nul 2>&1 && echo Stopped process on port %%P
    )
)
echo Done.
timeout /t 3 >nul
