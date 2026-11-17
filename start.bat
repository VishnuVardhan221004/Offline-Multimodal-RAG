@echo off
title Offline Multimodal RAG ChatBot - launcher
cd /d "%~dp0"

echo ============================================
echo   Offline Multimodal RAG ChatBot
echo ============================================

REM ---- 1. Node.js (installed through nvm, may not be on PATH) ----
where node >nul 2>&1
if errorlevel 1 (
    for /d %%D in ("%LOCALAPPDATA%\nvm\v20*") do set "NODE_DIR=%%~fD"
)
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js not found. Install Node 20 or run "nvm use 20.20.2" as administrator.
    pause & exit /b 1
)

REM ---- 2. Ollama + llama3 ----
where ollama >nul 2>&1
if errorlevel 1 (
    echo [X] Ollama not found. Install it from ollama.com, then run: ollama pull llama3
    pause & exit /b 1
)
ollama list >nul 2>&1
if errorlevel 1 (
    echo [..] Starting Ollama...
    start "Ollama" /min ollama serve
    timeout /t 5 /nobreak >nul
)
ollama list | findstr /i "llama3" >nul
if errorlevel 1 (
    echo [!] The llama3 model is missing. Downloading it now ^(about 4.7 GB^)...
    ollama pull llama3
)

REM Preload llama3 into memory in the background so the first question is faster
start "" /b curl -s http://localhost:11434/api/generate -d "{\"model\":\"llama3\",\"keep_alive\":\"30m\"}" >nul 2>&1

REM ---- 3. Python packages (first run only) ----
python -c "import fastapi, uvicorn, ollama, fitz, docx, pytesseract, sentence_transformers, faiss" >nul 2>&1
if errorlevel 1 (
    echo [..] Installing Python packages...
    python -m pip install -r Requirements.txt
)

REM ---- 4. UI packages (first run only) ----
if not exist "UI\my-react-app\node_modules" (
    echo [..] Installing UI packages...
    pushd "UI\my-react-app" & call npm install & popd
)

REM ---- 5. Start backend and frontend in their own windows ----
echo [..] Starting backend on http://127.0.0.1:8000
start "RAG Backend (close to stop)" cmd /k python -m uvicorn api:app --host 127.0.0.1 --port 8000

echo [..] Starting UI on http://localhost:5173
start "RAG Frontend (close to stop)" /d "%~dp0UI\my-react-app" cmd /k npm run dev:ui

REM ---- 6. Wait for the backend (embedding model loads first), then open the browser ----
echo [..] Waiting for the backend to load models...
set /a tries=0
:wait
set /a tries+=1
curl -s http://127.0.0.1:8000/health >nul 2>&1
if not errorlevel 1 goto ready
if %tries% geq 90 (
    echo [!] Backend is taking long. Check the "RAG Backend" window for errors.
    goto open
)
timeout /t 2 /nobreak >nul
goto wait

:ready
echo [OK] Backend is ready.
:open
start "" http://localhost:5173
echo.
echo The app is open in your browser. To stop it, run stop.bat
echo or close the "RAG Backend" and "RAG Frontend" windows.
timeout /t 8 >nul
