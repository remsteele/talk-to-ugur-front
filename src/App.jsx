import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:8000";
const STORAGE_KEYS = {
  visitor: "ttu_visitor_id",
  thread: "ttu_thread_id"
};

const api = axios.create({
  baseURL: API_BASE
});

const moodChips = [
  "laidback",
  "curious",
  "friendly",
  "sun-drenched",
  "low pressure"
];

const EMOTION_FALLBACK = "neutral";
const EMOTION_ORDER = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "confused",
  "thinking",
  "excited",
  "tired",
  "sleepy",
  "love",
  "focused",
  "curious",
  "proud",
  "anxious"
];
const EMOTION_TO_INDEX = EMOTION_ORDER.reduce((acc, emotion, index) => {
  acc[emotion] = index;
  return acc;
}, {});

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parseJsonPayload(payload) {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (err) {
      return null;
    }
  }
  return payload;
}

export default function App() {
  const [visitorId, setVisitorId] = useState(
    localStorage.getItem(STORAGE_KEYS.visitor)
  );
  const [threadId, setThreadId] = useState(
    localStorage.getItem(STORAGE_KEYS.thread)
  );
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [currentEmotion, setCurrentEmotion] = useState(EMOTION_FALLBACK);
  const loadedThreadRef = useRef(null);
  const scrollRef = useRef(null);

  const name = "talk to ugur";

  const tagline = useMemo(
    () => "Hang out, ask a question, or just vibe for a bit.",
    []
  );

  useEffect(() => {
    const init = async () => {
      try {
        if (!visitorId) {
          const response = await api.post("/api/v1/visitors");
          const id =
            response.headers?.["x-visitor-id"] || response.data?.visitor_id;
          if (id) {
            localStorage.setItem(STORAGE_KEYS.visitor, id);
            setVisitorId(id);
          }
        }
      } catch (err) {
        setError("Could not start a session. Please refresh.");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [visitorId]);

  useEffect(() => {
    const loadThread = async () => {
      if (!threadId || loadedThreadRef.current === threadId) return;
      loadedThreadRef.current = threadId;
      try {
        const response = await api.get(
          `/api/v1/chat/threads/${threadId}/messages`,
          {
            params: { limit: 100 }
          }
        );
        const payload = parseJsonPayload(response.data);
        const data = payload && typeof payload === "object" ? payload : {};
        const nextMessages = Array.isArray(payload)
          ? payload
          : Array.isArray(data.messages)
            ? data.messages
            : [];
        setMessages(nextMessages);
        const lastEmotion = [...nextMessages]
          .reverse()
          .find((message) => message.role === "assistant" && message.emotion)
          ?.emotion;
        setCurrentEmotion(lastEmotion || EMOTION_FALLBACK);
        if (data.thread_id && data.thread_id !== threadId) {
          localStorage.setItem(STORAGE_KEYS.thread, data.thread_id);
          setThreadId(data.thread_id);
        }
      } catch (err) {
        setError("Could not load the thread. Start a new chat below.");
      }
    };

    loadThread();
  }, [threadId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!input.trim() || sending) return;

    setError("");
    setSending(true);
    setCurrentEmotion("thinking");
    const wasNewThread = !threadId;
    const messageText = input.trim();
    const tempId = `temp-${Date.now()}`;
    const tempMessage = {
      id: tempId,
      role: "user",
      content: messageText,
      created_at: new Date().toISOString()
    };

    try {
      const payload = {
        message: messageText,
        ...(threadId ? { thread_id: threadId } : {})
      };

      setInput("");
      setMessages((prev) => [...prev, tempMessage]);
      const response = await api.post("/api/v1/chat/messages", payload, {
        headers: visitorId ? { "X-Visitor-Id": visitorId } : {}
      });
      const data = response.data || {};

      const nextVisitorId =
        response.headers?.["x-visitor-id"] || data.visitor_id;
      if (nextVisitorId) {
        localStorage.setItem(STORAGE_KEYS.visitor, nextVisitorId);
        setVisitorId(nextVisitorId);
      }
      if (data.thread_id) {
        localStorage.setItem(STORAGE_KEYS.thread, data.thread_id);
        setThreadId(data.thread_id);
        if (wasNewThread) {
          loadedThreadRef.current = data.thread_id;
        }
      }

      setMessages((prev) => {
        const withoutTemp = prev.filter((message) => message.id !== tempId);
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          const latestEmotion = [...data.messages]
            .reverse()
            .find(
              (message) => message.role === "assistant" && message.emotion
            )?.emotion;
          if (latestEmotion) setCurrentEmotion(latestEmotion);
          return data.messages;
        }
        if (data.message) {
          if (data.message.role === "assistant" && data.message.emotion) {
            setCurrentEmotion(data.message.emotion);
          }
          return [...withoutTemp, data.message];
        }
        const next = [];
        if (data.user_message) {
          next.push(data.user_message);
        } else {
          next.push(tempMessage);
        }
        if (data.assistant_message) {
          next.push(data.assistant_message);
          if (data.assistant_message.emotion) {
            setCurrentEmotion(data.assistant_message.emotion);
          }
        }
        return [...withoutTemp, ...next];
      });
    } catch (err) {
      setMessages((prev) => prev.filter((message) => message.id !== tempId));
      setCurrentEmotion(EMOTION_FALLBACK);
      setError("Ugur is taking a break. Try again in a moment.");
    } finally {
      setSending(false);
    }
  };

  const startNewThread = () => {
    localStorage.removeItem(STORAGE_KEYS.thread);
    setThreadId(null);
    setMessages([]);
    loadedThreadRef.current = null;
  };

  return (
    <div className="page">
      <div className="backdrop" />
      <div className="noise" />
      <header className="hero">
        <motion.h1
          className="title"
          initial={{ rotate: -4, y: 0 }}
          animate={{ rotate: [-4, -2.5, -4], y: [0, -8, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          {name}
        </motion.h1>
        <p className="subtitle">{tagline}</p>
        <div className="chips">
          {moodChips.map((chip) => (
            <span key={chip} className="chip">
              {chip}
            </span>
          ))}
        </div>
      </header>

      <main className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-title">Chat with Ugur</p>
            <p className="panel-meta">
              {threadId ? "Back at it." : "Fresh thread."}
            </p>
          </div>
          <button className="ghost" type="button" onClick={startNewThread}>
            new thread
          </button>
        </div>

        <div className="mood-row">
          <div className="mood-card">
            <p className="mood-label">ugur mood</p>
            <p className="mood-emotion">{currentEmotion}</p>
          </div>
        </div>

        <div className="chat" ref={scrollRef}>
          {loading ? (
            <div className="status">Spooling up a chill vibe...</div>
          ) : null}
          {!loading && messages.length === 0 ? (
            <div className="empty">
              <p>Say hi. Ask for advice. Drop a hot take.</p>
              <p className="muted">Ugur replies with mood.</p>
            </div>
          ) : null}

          {messages.map((message, index) => (
            <div
              key={
                message.id ||
                `${message.role || "msg"}-${message.created_at || index}`
              }
              className={`bubble ${message.role === "assistant" ? "assistant" : "user"}`}
            >
              {message.role === "assistant" ? (
                <div className="assistant-header">
                  <span className="assistant-name">ugur</span>
                </div>
              ) : null}
              <p>{message.content}</p>
              <span className="timestamp">{formatTime(message.created_at)}</span>
            </div>
          ))}

          {sending ? (
            <div className="bubble assistant pending">
              <div className="assistant-header">
                <span className="assistant-name">ugur</span>
                <span className="typing">thinking...</span>
              </div>
              <p className="muted">...</p>
            </div>
          ) : null}
        </div>

        {error ? <div className="error">{error}</div> : null}

        <form className="composer" onSubmit={sendMessage}>
          <input
            type="text"
            placeholder="Type your message..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !input.trim()}>
            send
          </button>
        </form>
      </main>

      <footer className="footer">
        <p>built for late-night questions + slow coffee.</p>
        <span className="dot" />
        <p>API: {API_BASE}</p>
      </footer>
    </div>
  );
}
