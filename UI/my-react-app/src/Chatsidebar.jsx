import { IconSpark, IconPlus, IconTrash } from "./icons";
import { isImageFile } from "./fileKind";

function formatTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export default function ChatSidebar({ sessions, currentId, onSelect, onNewChat, onDelete }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo"><IconSpark size={18} /></div>
        <div>
          <div className="brand-name">Offline RAG ChatBot</div>
          <div className="brand-sub">Private · runs on this computer</div>
        </div>
      </div>

      <button className="new-chat" onClick={onNewChat}>
        <IconPlus /> New chat
      </button>

      <div className="history-label">History</div>
      <nav className="history">
        {sessions.length === 0 && (
          <div className="history-empty">Your chats will appear here.</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`history-item ${s.id === currentId ? "active" : ""}`}
            onClick={() => onSelect(s.id)}
            onKeyDown={(e) => { if (e.key === "Enter") onSelect(s.id); }}
            title={s.title}
          >
            <div className="history-title">{s.title}</div>
            <div className="history-meta">
              {s.streaming
                ? <span className="live">Answering…</span>
                : <>{s.doc
                    ? (s.doc.name === s.title ? (isImageFile(s.doc.name) ? "Image" : "Document") : s.doc.name)
                    : "No document"} · {formatTime(s.updatedAt)}</>}
            </div>
            <button
              className="history-delete"
              title="Delete chat"
              aria-label={`Delete chat ${s.title}`}
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete "${s.title}"?`)) onDelete(s.id);
              }}
            >
              <IconTrash />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
