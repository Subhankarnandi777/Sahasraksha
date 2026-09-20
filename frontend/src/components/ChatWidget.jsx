import { useEffect, useRef, useState } from "react";
import { sendChatMessage } from "../services/api.js";

const GREETING = {
  role: "assistant",
  content:
    "Hi, I'm the Sahasraksha site guide. Ask me what any page shows, how the anomaly detection " +
    "works, or how to use the demo button -- I can see the live network state too."
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, sending]);

  async function handleSend(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(1); // drop the client-side-only greeting
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

  return (
    <div className="chat-widget-root">
      {open ? (
        <div className="chat-widget-panel">
          <div className="chat-widget-header">
            <div>
              <strong>Site Guide</strong>
              <span>Ask about any page or how detection works</span>
            </div>
            <button type="button" className="chat-widget-close" onClick={() => setOpen(false)} aria-label="Close chat">
              ✕
            </button>
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
        className="chat-widget-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close site guide" : "Open site guide"}
      >
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
