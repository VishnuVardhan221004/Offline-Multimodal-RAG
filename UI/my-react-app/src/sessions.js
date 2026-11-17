// Rules for chat sessions (used by App.jsx).
// A session = { id, title, createdAt, updatedAt, messages, doc, streaming }
// doc = { id, name, chunks } once a file is uploaded in that session, else null.

export function newSession() {
  const now = Date.now();
  return {
    id: `s_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
    doc: null,
    streaming: false,
  };
}

// A session with no messages and no document is not worth keeping
export const isEmpty = (s) => s.messages.length === 0 && !s.doc;

// Opening the site always starts with a fresh, empty session (no document);
// saved sessions are only listed in the history until one is clicked.
export function initialState(savedSessions) {
  const fresh = newSession();
  return { sessions: [fresh, ...savedSessions.filter(s => !isEmpty(s))], currentId: fresh.id };
}

export function sessionsReducer(state, action) {
  switch (action.type) {
    case "new": {
      // Always open a fresh chat; drop any other untouched empty chat
      const fresh = newSession();
      return { sessions: [fresh, ...state.sessions.filter(s => !isEmpty(s))], currentId: fresh.id };
    }

    case "select": {
      if (!state.sessions.some(s => s.id === action.id)) return state;
      // Leaving an empty chat throws it away
      return {
        sessions: state.sessions.filter(s => s.id === action.id || !isEmpty(s)),
        currentId: action.id,
      };
    }

    case "delete": {
      const remaining = state.sessions.filter(s => s.id !== action.id);
      if (action.id !== state.currentId) {
        return { ...state, sessions: remaining };
      }
      // Deleted the open chat: open a fresh one in its place
      const fresh = newSession();
      return { sessions: [fresh, ...remaining.filter(s => !isEmpty(s))], currentId: fresh.id };
    }

    case "update": {
      // Change one session by id, so a streaming answer keeps going into the
      // right session even if the user switches to another one meanwhile
      return {
        ...state,
        sessions: state.sessions.map(s => {
          if (s.id !== action.id) return s;
          const patch = typeof action.changes === "function" ? action.changes(s) : action.changes;
          return { ...s, ...patch, updatedAt: Date.now() };
        }),
      };
    }

    default:
      return state;
  }
}

// Sessions shown in the sidebar: only ones with content, newest first
export const historyList = (state) =>
  state.sessions.filter(s => !isEmpty(s)).sort((a, b) => b.updatedAt - a.updatedAt);
