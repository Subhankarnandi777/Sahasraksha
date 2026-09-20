import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { sendChatMessage } from "../services/api.js";

const GREETING = {
  role: "assistant",
  content:
    "Hi, I'm the Sahasraksha site guide. Ask me what any page shows, how the anomaly detection " +
    "works, or how to use the demo button -- I can see the live network state too."
};

// Shown as one-tap starting points so a judge who doesn't know what to ask
// still gets a useful first answer -- and so the first question they see
// is one we know the bot can ground in real, live data.
const SUGGESTED_QUESTIONS = [
  "What does this dashboard actually detect?",
  "Walk me through every page",
  "What's open right now?",
  "How is this validated?"
];

const HINT_TEXT = "👋 Ask me anything about this dashboard -- I can explain any page or metric.";
const HINT_SEEN_KEY = "sahasraksha_chat_hint_seen";
const HISTORY_KEY_PREFIX = "sahasraksha_chat_history_v1_";

function historyKeyFor(userId) {
  return `${HISTORY_KEY_PREFIX}${userId || "guest"}`;
}

function loadHistory(userId) {
  try {
    const raw = localStorage.getItem(historyKeyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((m) => m && typeof m.content === "string")) {
      return parsed;
    }
  } catch {
    // corrupted or blocked storage -- fall through to a fresh conversation
  }
  return null;
}

function saveHistory(userId, messages) {
  try {
    localStorage.setItem(historyKeyFor(userId), JSON.stringify(messages));
  } catch {
    // storage full or unavailable (private window, etc.) -- chat still works
    // in-memory for this page view, it just won't survive navigation
  }
}

export default function ChatWidget() {
  const { user } = useAuth();
  const userId = user?.id || user?.email || "guest";

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => loadHistory(userId) || [GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [showHint, setShowHint] = useState(false);
  const scrollRef = useRef(null);
  const loadedForUser = useRef(userId);

  // If the logged-in user changes (e.g. a different judge logs in on the
  // same machine), swap to that user's own saved history instead of
  // showing the previous person's conversation.
  useEffect(() => {
    if (loadedForUser.current !== userId) {
      loadedForUser.current = userId;
      setMessages(loadHistory(userId) || [GREETING]);
    }
  }, [userId]);

  useEffect(() => {
    saveHistory(userId, messages);
  }, [userId, messages]);

  // Draw attention once per browser, a few seconds after the page settles,
  // so the widget doesn't get missed entirely -- but only if nobody has
  // opened it yet on this device.
  useEffect(() => {
    function isSeen() {
      try {
        return localStorage.getItem(HINT_SEEN_KEY) === "1";
      } catch {
        return false;
      }
    }
    if (isSeen()) return undefined;

    // Re-check at fire time, not just at mount: if the user opens (and
    // dismisses) the widget in the meantime, markSeen() already flips the
    // flag, and this must not un-dismiss it out from under them.
    const showTimer = setTimeout(() => {
      if (!isSeen()) setShowHint(true);
    }, 3500);
    const hideTimer = setTimeout(() => setShowHint(false), 13000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, sending]);

  // Compared by content, not reference: a history reloaded from
  // localStorage after navigating to a new page is freshly parsed JSON, so
  // it's never === GREETING even when it IS just the greeting.
  const showSuggestions = useMemo(
    () =>
      messages.length === 1 &&
      messages[0].role === "assistant" &&
      messages[0].content === GREETING.content,
    [messages]
  );

  function markSeen() {
    setShowHint(false);
    try {
      localStorage.setItem(HINT_SEEN_KEY, "1");
    } catch {
      // ignore
    }
  }

  function handleOpen() {
    setOpen(true);
    markSeen();
  }

  async function sendText(text) {
    if (!text || sending) return;

    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(1); // drop the client-side-only greeting, which is always first
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const response = await sendChatMessage(text, history);
      setMessages((prev) => [...prev, { role: "assistant", content: response.reply }]);
    } catch (err) {
      setError(err.message || "Couldn't reach the guide right now.");
    } finally {
      setSending(false);
    }
  }

  function handleSend(event) {
    event.preventDefault();
    sendText(input.trim());
  }

  function handleSuggestion(question) {
    sendText(question);
  }

  function handleClear() {
    setMessages([GREETING]);
    setError(null);
  }

  return (
    <div className="chat-widget-root">
      {!open && showHint ? (
        <div className="chat-widget-hint" role="status" onClick={handleOpen}>
          {HINT_TEXT}
          <button
            type="button"
            className="chat-widget-hint-close"
            aria-label="Dismiss hint"
            onClick={(event) => {
              event.stopPropagation();
              markSeen();
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="chat-widget-panel">
          <div className="chat-widget-header">
            <div>
              <strong>Site Guide</strong>
              <span>Ask about any page or how detection works</span>
            </div>
            <div className="chat-widget-header-actions">
              <button
                type="button"
                className="chat-widget-clear"
                onClick={handleClear}
                title="Clear this conversation"
                aria-label="Clear conversation"
              >
                Clear
              </button>
              <button type="button" className="chat-widget-close" onClick={() => setOpen(false)} aria-label="Close chat">
                ✕
              </button>
            </div>
          </div>

          <div className="chat-widget-messages" ref={scrollRef}>
            {messages.map((msg, index) => (
              <div key={index} className={`chat-bubble ${msg.role}`}>
                {msg.content}
              </div>
            ))}
            {sending ? (
              <div className="chat-bubble assistant chat-bubble-typing">
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
              </div>
            ) : null}
          </div>

          {showSuggestions && !sending ? (
            <div className="chat-widget-suggestions">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chat-suggestion-chip"
                  onClick={() => handleSuggestion(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}

          {error ? <p className="chat-widget-error">{error}</p> : null}

          <form className="chat-widget-input-row" onSubmit={handleSend}>
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask a question about this dashboard..."
              disabled={sending}
              aria-label="Ask the site guide a question"
            />
            <button type="submit" disabled={sending || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        className={`chat-widget-toggle ${open ? "" : "chat-widget-toggle-attention"}`}
        onClick={() => (open ? setOpen(false) : handleOpen())}
        aria-label={open ? "Close site guide" : "Open site guide"}
      >
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
