"""Starts the local AI model (Ollama + llama3) automatically, with no internet needed.

When the backend starts, ensure_ollama() runs in the background:
  1. If the Ollama server is not running, it starts "ollama serve" itself.
  2. It checks that the llama3 model is installed on this computer.
  3. It loads llama3 into memory, so the first question does not wait for loading.
All of this talks only to Ollama on this computer (127.0.0.1:11434).
"""
import json
import os
import shutil
import subprocess
import time
import urllib.request

OLLAMA_URL = "http://127.0.0.1:11434"
MODEL = "llama3"
KEEP_ALIVE = "30m"  # keep the model in memory between questions

# Current state, shown to the UI through /health:
# "starting" | "loading" | "ready" | "model_missing" | "not_installed" | "error"
status = {"llm": "starting", "detail": ""}

# Only talk to this computer, never through a proxy
_local = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _get(path, timeout=3):
    with _local.open(OLLAMA_URL + path, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _post(path, body, timeout):
    req = urllib.request.Request(
        OLLAMA_URL + path, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with _local.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def is_running():
    try:
        _get("/api/tags", timeout=2)
        return True
    except Exception:
        return False


def find_ollama():
    """Path to ollama.exe: on PATH, or in its default install folder."""
    exe = shutil.which("ollama")
    if exe:
        return exe
    default = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Ollama", "ollama.exe")
    return default if os.path.exists(default) else None


def start_server():
    """Start "ollama serve" in the background (no window) and wait until it answers."""
    exe = find_ollama()
    if not exe:
        return False
    flags = 0
    if os.name == "nt":
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(
        [exe, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL, creationflags=flags,
    )
    for _ in range(30):
        if is_running():
            return True
        time.sleep(1)
    return False


def model_installed():
    names = [m.get("name", "") for m in _get("/api/tags").get("models", [])]
    return any(n == MODEL or n.startswith(MODEL + ":") for n in names)


def ensure_ollama():
    """Make sure Ollama is running and llama3 is loaded. Safe to call more than once."""
    try:
        if not is_running():
            status.update(llm="starting", detail="Starting Ollama…")
            print("[ollama] Not running - starting it…")
            if not start_server():
                if find_ollama() is None:
                    status.update(llm="not_installed", detail="Ollama is not installed on this computer.")
                else:
                    status.update(llm="error", detail="Ollama could not be started.")
                print("[ollama] " + status["detail"])
                return

        if not model_installed():
            status.update(llm="model_missing",
                          detail=f"The '{MODEL}' model is not installed. Run once with internet: ollama pull {MODEL}")
            print("[ollama] " + status["detail"])
            return

        status.update(llm="loading", detail=f"Loading {MODEL} into memory…")
        print(f"[ollama] Loading {MODEL} into memory…")
        # An empty generate request just loads the model and keeps it loaded
        _post("/api/generate", {"model": MODEL, "keep_alive": KEEP_ALIVE}, timeout=600)
        status.update(llm="ready", detail=f"{MODEL} is ready")
        print(f"[ollama] {MODEL} is ready.")
    except Exception as e:
        status.update(llm="error", detail=f"Problem with Ollama: {e}")
        print("[ollama] " + status["detail"])
