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

const STREAMING_ENABLED = true;

const moodChips = [
  "explain git",
  "why did my girlfriend leave me",
  "you forgot to post the assignment",
];

const EMOTION_FALLBACK = "neutral";

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

function parseSseEvent(chunk) {
  const lines = chunk.split("\n").filter(Boolean);
  let eventName = "message";
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      let value = line.slice(5);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    }
  }
  return { event: eventName, data: dataLines.join("\n"), dataLines };
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
  const hasStreamingAssistant = messages.some(
    (message) => message.streaming
  );

  const name = "talk to ugur";

  const tagline = useMemo(
    () => "im better than you. plain and simple.",
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
        setError("cant start session. refresh.");
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
        setError("cant load thread. start a new mess.");
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
    const tempAssistantId = `assistant-${Date.now()}`;
    const tempMessage = {
      id: tempId,
      role: "user",
      content: messageText,
      created_at: new Date().toISOString()
    };
    const tempAssistantMessage = {
      id: tempAssistantId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
      streaming: true
    };

    try {
      const payload = {
        message: messageText,
        ...(threadId ? { thread_id: threadId } : {})
      };

      setInput("");
      setMessages((prev) => [...prev, tempMessage, tempAssistantMessage]);

      if (STREAMING_ENABLED) {
        const response = await fetch(
          `${API_BASE}/api/v1/chat/messages?stream=true`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(visitorId ? { "X-Visitor-Id": visitorId } : {})
            },
            body: JSON.stringify(payload)
          }
        );

        if (!response.ok || !response.body) {
          throw new Error("streaming failed");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantText = "";
        let streamError = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, "\n");

          let splitIndex = buffer.indexOf("\n\n");
          while (splitIndex !== -1) {
            const chunk = buffer.slice(0, splitIndex);
            buffer = buffer.slice(splitIndex + 2);
            if (chunk.trim()) {
              const { event: eventName, data, dataLines } = parseSseEvent(chunk);
              if (eventName === "meta") {
                const meta = parseJsonPayload(data) || {};
                const nextVisitorId =
                  meta.visitor_id || response.headers.get("x-visitor-id");
                if (nextVisitorId) {
                  localStorage.setItem(STORAGE_KEYS.visitor, nextVisitorId);
                  setVisitorId(nextVisitorId);
                }
                if (meta.thread_id) {
                  localStorage.setItem(STORAGE_KEYS.thread, meta.thread_id);
                  setThreadId(meta.thread_id);
                  if (wasNewThread) {
                    loadedThreadRef.current = meta.thread_id;
                  }
                }
                if (meta.emotion) {
                  setCurrentEmotion(meta.emotion);
                }
                if (meta.user_message) {
                  setMessages((prev) =>
                    prev.map((message) =>
                      message.id === tempId ? meta.user_message : message
                    )
                  );
                }
              }
              if (eventName === "token") {
                let token = data;
                if (dataLines.length > 1 && dataLines[0] === "") {
                  token = dataLines.slice(1).join("\n");
                }
                if (token) {
                  assistantText += token;
                  setMessages((prev) =>
                    prev.map((message) =>
                      message.id === tempAssistantId
                        ? { ...message, content: assistantText }
                        : message
                    )
                  );
                }
              }
              if (eventName === "done") {
                const donePayload = parseJsonPayload(data) || {};
                const assistantMessage = donePayload.assistant_message;
                if (assistantMessage?.emotion) {
                  setCurrentEmotion(assistantMessage.emotion);
                }
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === tempAssistantId
                      ? {
                          ...(assistantMessage || message),
                          content:
                            assistantMessage?.content || assistantText || "",
                          streaming: false
                        }
                      : message
                  )
                );
              }
              if (eventName === "error") {
                streamError = true;
                setError(data || "ugur on smoke break. try again soon.");
                setCurrentEmotion(EMOTION_FALLBACK);
                setMessages((prev) =>
                  prev.filter((message) => message.id !== tempAssistantId)
                );
              }
            }
            splitIndex = buffer.indexOf("\n\n");
          }
          if (streamError) break;
        }

        if (!streamError) {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === tempAssistantId
                ? { ...message, streaming: false }
                : message
            )
          );
        }
      } else {
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
          const withoutTemp = prev.filter(
            (message) =>
              message.id !== tempId && message.id !== tempAssistantId
          );
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
      }
    } catch (err) {
      setMessages((prev) =>
        prev.filter(
          (message) => message.id !== tempId && message.id !== tempAssistantId
        )
      );
      setCurrentEmotion(EMOTION_FALLBACK);
      setError("ugur on smoke break. try again soon.");
    } finally {
      setSending(false);
    }
  };

  const startNewThread = () => {
    localStorage.removeItem(STORAGE_KEYS.thread);
    setThreadId(null);
    setMessages([]);
    setCurrentEmotion(EMOTION_FALLBACK);
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
          <span className="chip-label">try this:</span>
          <span className="chip-list">
            {moodChips.map((chip, index) => (
              <span key={chip} className="chip-item">
                <button
                  type="button"
                  className="chip-button"
                  onClick={() => setInput(chip)}
                >
                  {chip}
                </button>
                {index < moodChips.length - 1 ? (
                  <span className="chip-sep"> · </span>
                ) : null}
              </span>
            ))}
          </span>
        </div>
      </header>

      <main className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-title">talk to ugur</p>
            <p className="panel-meta">
          {threadId ? "you back. good." : "fresh thread."}
            </p>
          </div>
          <button className="ghost" type="button" onClick={startNewThread}>
            reset thread
          </button>
        </div>

        <div className="mood-row">
          <div className="mood-card">
            <p className="mood-label">ugur mood</p>
            <p className="mood-emotion">{currentEmotion}</p>
          </div>
          <div className="brag">
            you talk to real prof
            <span className="brag-sub">come back with better code</span>
          </div>
        </div>

        <div className="chat" ref={scrollRef}>
          {loading ? (
            <div className="status">warming up...</div>
          ) : null}
          {!loading && messages.length === 0 ? (
            <div className="empty">
              <p>talk. be clear. bring a real question.</p>
              <p className="muted">dont be a smart ass.</p>
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
                  {message.streaming ? (
                    <span className="typing">streaming...</span>
                  ) : null}
                </div>
              ) : null}
              <p>{message.content}</p>
              <span className="timestamp">{formatTime(message.created_at)}</span>
            </div>
          ))}

          {sending && !hasStreamingAssistant ? (
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
            placeholder="type your message..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={sending}
            title="be direct."
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            title="send it."
          >
            send
          </button>
        </form>
      </main>

      <footer className="footer">
        <p>this is all playful fun.</p>
        <span className="dot" />
        <p>leaked ip: 192.168.1.1</p>
      </footer>
    </div>
  );
}
