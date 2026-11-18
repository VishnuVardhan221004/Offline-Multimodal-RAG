import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { IconSpark, IconClip, IconArrowUp, IconFile, IconLoader } from "./icons";
import { isImageFile, fileKind } from "./fileKind";

const API = "http://localhost:8000";

// The model often writes "•" bullets and "+" sub-bullets as plain text;
// turn them into Markdown lists so they render as real lists.
function toMarkdown(text) {
  return text
    .replace(/^[ \t]*[•●▪◦][ \t]*/gm, "- ")
    .replace(/^\t+\+[ \t]+/gm, "  - ")
    .replace(/^[ ]{2,}\+[ \t]+/gm, "  - ");
}

// Removes duplicate page/file pairs from the sources
function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter(s => {
    const key = `${s.source}#${s.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The backend starts "not found" answers with this sentence ("...uploaded document/image");
// such answers get no source chips
const NOT_FOUND = "I couldn't find this in the uploaded";
// Shows one chat session: its document, its messages and the message box.
// Everything is stored in the session object (see App.jsx / sessions.js).
export default function Chat({ session, updateSession }) {

  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  // { type: "info" | "waiting" | "success" | "error", text }
  const [status, setStatus] = useState(null);
  // Local AI model status from the backend: starting | loading | ready | model_missing | not_installed | error
  const [llm, setLlm] = useState({ state: "starting", detail: "" });

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);

  const sessionId = session.id;
  const messages = session.messages;
  const doc = session.doc;              // { id, name, chunks } or null
  const loading = session.streaming;

  // Wait for the backend while it is still starting up, then follow the AI model
  // (the backend starts Ollama and loads llama3 by itself, no internet needed)
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const check = () => {
      fetch(`${API}/health`)
        .then(res => res.json())
        .then((data) => {
          if (cancelled) return;
          setStatus(prev => (prev && prev.type === "waiting" ? null : prev));
          setLlm({ state: data.llm || "ready", detail: data.llm_detail || "" });
          // Keep checking until the model is ready (or has a problem to show)
          if (data.llm === "starting" || data.llm === "loading") setTimeout(check, 3000);
        })
        .catch(() => {
          if (cancelled) return;
          attempts += 1;
          setStatus({
            type: attempts > 30 ? "error" : "waiting",
            text: attempts > 30
              ? "The backend is not running. Start the project with \"npm run dev\" or start.bat."
              : "Starting the backend… (loading models)",
          });
          setTimeout(check, 2000);
        });
    };
    check();
    textareaRef.current?.focus();
    return () => { cancelled = true; };
  }, []);

  // Keep the newest text in view while an answer streams in
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Grow the message box with its content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // allow uploading the same file again
    if (!file) return;

    setUploading(true);
    setStatus({ type: "info", text: `Reading ${file.name}…` });

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/upload`, { method: "POST", body: formData });
      const data = await res.json();

      if (data.error) {
        setStatus({ type: "error", text: `Upload failed: ${data.error}` });
      } else {
        // The document now belongs to this session only
        updateSession(sessionId, s => ({
          doc: { id: data.doc_id, name: data.name, chunks: data.chunks },
          title: s.title === "New chat" ? data.name : s.title,
        }));
        setStatus({ type: "success", text: `${data.name} is ready (${data.chunks} chunks). Ask anything about it.` });
      }
    } catch (err) {
      setStatus({ type: "error", text: "Upload failed: the backend is not reachable." });
    }

    setUploading(false);
    textareaRef.current?.focus();
  };

  const sendMessage = async (text) => {
    const question = (text ?? input).trim();
    if (!question || loading || !doc) return; // questions need an uploaded document

    const history = messages.map(m => `${m.role}: ${m.text}`).join("\n");
    const botIndex = messages.length + 1;

    updateSession(sessionId, s => ({
      messages: [...s.messages, { role: "user", text: question }, { role: "bot", text: "", sources: [] }],
      title: s.messages.length === 0 && !s.doc
        ? question.slice(0, 40) + (question.length > 40 ? "…" : "")
        : s.title,
      streaming: true,
    }));
    setInput("");
    if (status && status.type === "success") setStatus(null);

    // Change one field of the answer being written
    const setBot = (patch) => updateSession(sessionId, s => {
      const msgs = [...s.messages];
      msgs[botIndex] = { ...msgs[botIndex], ...patch };
      return { messages: msgs };
    });

    try {
      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: question,
          history,
          doc_id: doc ? doc.id : null,     // answer from this session's document
          doc_name: doc ? doc.name : null,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let botText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep a partial line for the next read

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.token) {
              botText += parsed.token;
              setBot({ text: botText });
            }
            if (parsed.done && parsed.sources) {
              setBot({ sources: parsed.sources });
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (error) {
      setBot({ text: "Could not reach the backend. Is it running?" });
    } finally {
      updateSession(sessionId, { streaming: false });
    }
  };

  const onKeyDown = (e) => {
    // Enter sends, Shift+Enter adds a new line
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <main className="main">

      <header className="topbar">
        <div className="topbar-title">{messages.length ? session.title : "New chat"}</div>
        <div className="spacer" />
        <span
          className={`ai-status ${llm.state === "ready" ? "ready" : (llm.state === "starting" || llm.state === "loading") ? "loading" : "problem"}`}
          title={llm.detail}
        >
          <i />
          {llm.state === "ready" ? "AI ready (offline)"
            : llm.state === "starting" || llm.state === "loading" ? "Loading AI model…"
            : "AI not available"}
        </span>
        {doc ? (
          <span className="doc-chip" title={`${doc.name} · ${doc.chunks} chunks`}>
            <IconFile /> <span>{doc.name}</span>
          </span>
        ) : (
          <span className="doc-chip none">No document</span>
        )}
      </header>

      <div className="scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="welcome">
            <div className="welcome-logo"><IconSpark size={24} /></div>
            {doc ? (
              <>
                <h1>Ask about {doc.name}</h1>
                <p>
                  {isImageFile(doc.name)
                    ? "Answers come only from the text in this image."
                    : "Answers come only from this document, with the pages they are based on."}
                </p>
              </>
            ) : (
              <>
                <h1>Upload a document to begin</h1>
                <p>
                  Add a PDF, Word file or image. I answer questions only from what is inside it,
                  and everything stays on this computer.
                </p>
                <button
                  className="upload-cta"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <IconLoader /> : <IconClip />}
                  {uploading ? "Reading the file…" : "Upload a document or image"}
                </button>
                <div className="formats">PDF · DOCX · PNG · JPG</div>
              </>
            )}
          </div>
        ) : (
          <div className="column">
            {messages.map((msg, index) => {
              if (msg.role === "user") {
                return (
                  <div key={index} className="msg-user">
                    <div className="bubble">{msg.text}</div>
                  </div>
                );
              }
              const isLast = index === messages.length - 1;
              const writing = loading && isLast;
              return (
                <div key={index} className="msg-bot">
                  <div className="avatar"><IconSpark size={16} /></div>
                  <div className="bot-body">
                    {msg.text ? (
                      <div className="md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{toMarkdown(msg.text)}</ReactMarkdown>
                        {writing && <span className="cursor" />}
                      </div>
                    ) : writing ? (
                      <div>
                        <span className="typing"><i /><i /><i /></span>
                        <span className="typing-label">{doc ? `Searching the ${fileKind(doc.name)} and thinking…` : "Thinking…"}</span>
                      </div>
                    ) : null}

                    {msg.sources && msg.sources.length > 0 && !writing && !msg.text.startsWith(NOT_FOUND) && (
                      <div className="sources">
                        {uniqueSources(msg.sources).map((s, i) => (
                          <span key={i} className="source-chip" title={s.source}>
                            <IconFile size={12} /> {isImageFile(s.source) ? s.source : `Page ${s.page} · ${s.source}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <div className="composer-inner">
          {status && (
            <div className={`notice ${status.type}`}>
              {status.type === "info" || status.type === "waiting" ? <IconLoader size={15} /> : null}
              <span>{status.text}</span>
              {(status.type === "success" || status.type === "error") && (
                <button onClick={() => setStatus(null)} aria-label="Dismiss">×</button>
              )}
            </div>
          )}

          <div className="composer">
            <button
              className={`icon-btn ${uploading ? "disabled" : ""}`}
              onClick={() => fileRef.current?.click()}
              title="Upload a PDF, Word file or image"
              aria-label="Upload a document"
            >
              {uploading ? <IconLoader /> : <IconClip />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
              style={{ display: "none" }}
              onChange={handleUpload}
            />

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!doc}
              placeholder={doc ? `Ask about ${doc.name}…` : "Upload a document or image first (📎)"}
            />

            <button
              className="send-btn"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim() || !doc}
              title="Send (Enter)"
              aria-label="Send message"
            >
              {loading ? <IconLoader /> : <IconArrowUp />}
            </button>
          </div>

          <div className="hint">
            Answers come only from the uploaded {doc ? fileKind(doc.name) : "document or image"} · Runs offline · Enter to send, Shift+Enter for a new line
          </div>
        </div>
      </div>
    </main>
  );
}
