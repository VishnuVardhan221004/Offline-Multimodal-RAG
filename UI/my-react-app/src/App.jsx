import { useReducer, useEffect } from "react";
import Chat from "./Chat";
import ChatSidebar from "./Chatsidebar";
import { initialState, sessionsReducer, historyList, isEmpty } from "./sessions";

// Chat sessions are saved in the browser, so the history survives closing the site.
// Each session keeps its own messages and its own uploaded document.
const STORAGE_KEY = "rag-chat-sessions";

function loadSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.map(s => ({ ...s, streaming: false })) : [];
  } catch {
    return [];
  }
}

function App() {
  const [state, dispatch] = useReducer(sessionsReducer, null, () => initialState(loadSessions()));

  // Save every non-empty session whenever something changes
  useEffect(() => {
    try {
      const toSave = state.sessions
        .filter(s => !isEmpty(s))
        .map(({ streaming, ...rest }) => rest);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // storage full or blocked: history just won't persist
    }
  }, [state.sessions]);

  const current = state.sessions.find(s => s.id === state.currentId) || state.sessions[0];
  const updateSession = (id, changes) => dispatch({ type: "update", id, changes });

  return (
    <div className="app">
      <ChatSidebar
        sessions={historyList(state)}
        currentId={current.id}
        onSelect={(id) => dispatch({ type: "select", id })}
        onNewChat={() => dispatch({ type: "new" })}
        onDelete={(id) => dispatch({ type: "delete", id })}
      />
      <Chat
        key={current.id}
        session={current}
        updateSession={updateSession}
      />
    </div>
  );
}

export default App;
