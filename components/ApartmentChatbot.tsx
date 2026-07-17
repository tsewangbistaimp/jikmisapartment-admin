"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Mail, MessageCircle, Phone, Send, X } from "lucide-react";
import { FORMSPREE_ENDPOINT, INQUIRY_EMAIL, WHATSAPP_NUMBER } from "@/lib/site";

type ChatMessage = {
  id: string;
  role: "bot" | "user";
  content: string;
};

const quickReplies = ["Pricing", "Availability", "Booking", "Room details", "Facilities", "Rules", "Location"];

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "bot",
    content:
      "Hello! Namaste, Tashi delek, Namaskar. Welcome to Jikmis Apartment in Boudha. Ask me about rooms, pricing, availability, booking, facilities, location, or house rules."
  }
];

const chatEndpoint = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/chat` : "/api/chat";
const helperNoteStorageKey = "jikmis-chat-helper-note-dismissed";
// "Conversation memory" — persists the visible transcript plus the
// server-computed bookingState/conversationId/guestName (see
// app/api/chat/route.ts) so a page refresh doesn't wipe an in-progress
// conversation or booking. Deliberately sessionStorage, not localStorage:
// cleared when the tab/browser closes, same lifetime as the existing
// helperNoteStorageKey above, and avoids a guest's name/phone/email sitting
// around indefinitely in the browser after they've left.
const chatSessionStorageKey = "jikmis-chat-session";
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?977[-\s]?)?9\d{9}|\+?\d[\d\-\s]{7,14}\d/;
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

type PersistedChatSession = {
  messages: ChatMessage[];
  bookingState: unknown;
  conversationId: string | null;
  guestName: string | null;
};

function loadPersistedSession(): PersistedChatSession | null {
  try {
    const raw = window.sessionStorage.getItem(chatSessionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedChatSession>;
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return null;
    return {
      messages: parsed.messages,
      bookingState: parsed.bookingState ?? null,
      conversationId: typeof parsed.conversationId === "string" ? parsed.conversationId : null,
      guestName: typeof parsed.guestName === "string" ? parsed.guestName : null
    };
  } catch {
    return null;
  }
}

function renderMessageContent(content: string) {
  const parts = content.split(URL_REGEX);
  return parts.map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a key={index} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}

export default function ApartmentChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isHelperNoteHidden, setIsHelperNoteHidden] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageIdRef = useRef(0);
  const hasSentBookingInfoRef = useRef(false);
  // Carries the AI booking assistant's slot-filling progress across turns.
  // The chat API is stateless, so the client is responsible for storing and
  // re-sending this on every request — see lib/bookingAssistant.ts.
  const bookingStateRef = useRef<unknown>(null);
  // Identifies this chat session's persisted AiConversation row (see
  // app/api/chat/route.ts's persistConversationTurn) so every turn appends
  // to the same transcript instead of starting a new conversation each
  // message. Same stateless, client-carried pattern as bookingStateRef.
  const conversationIdRef = useRef<string | null>(null);
  // Guest name recognition — once the AI receptionist resolves a name (from
  // the guest introducing themselves, or from the booking flow's full-name
  // step), the server returns it and the client carries it forward on every
  // later turn the same way it already carries bookingState/conversationId.
  // See app/api/chat/route.ts and lib/receptionistReplies.ts's
  // extractGuestName for how it's first recognized.
  const guestNameRef = useRef<string | null>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setIsHelperNoteHidden(sessionStorage.getItem(helperNoteStorageKey) === "true");
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  // Restore a persisted conversation (see chatSessionStorageKey above) after
  // mount only — never during the initial render — so this can't cause a
  // server/client hydration mismatch, matching the helper-note pattern above.
  useEffect(() => {
    const persisted = loadPersistedSession();
    if (!persisted) return;
    // sessionStorage isn't available during SSR, so this can't be a lazy
    // useState initializer — this effect's only job is a one-time restore
    // from that external system right after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(persisted.messages);
    bookingStateRef.current = persisted.bookingState;
    conversationIdRef.current = persisted.conversationId;
    guestNameRef.current = persisted.guestName;
  }, []);

  // Persists the transcript plus the current bookingState/conversationId/
  // guestName refs every time the visible message list changes. Refs
  // themselves don't trigger re-renders, but every place that mutates them
  // (fetchBotReply below) does so synchronously before the setMessages call
  // that appends the corresponding message, so by the time this effect runs
  // the refs already reflect that turn's latest values.
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      const session: PersistedChatSession = {
        messages,
        bookingState: bookingStateRef.current,
        conversationId: conversationIdRef.current,
        guestName: guestNameRef.current
      };
      window.sessionStorage.setItem(chatSessionStorageKey, JSON.stringify(session));
    } catch {
      // Storage can throw (quota exceeded, private browsing) — losing
      // persistence is not worth breaking the chat over.
    }
  }, [messages]);

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  function openChat() {
    setIsOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  useEffect(() => {
    const handleExternalOpen = () => {
      setIsOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("jikmis:open-chat", handleExternalOpen);
    return () => window.removeEventListener("jikmis:open-chat", handleExternalOpen);
  }, []);

  function dismissHelperNote() {
    sessionStorage.setItem(helperNoteStorageKey, "true");
    setIsHelperNoteHidden(true);
  }

  async function fetchBotReply(trimmed: string, chatHistory: { role: string; content: string }[]): Promise<string> {
    try {
      const response = await fetch(chatEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          messages: chatHistory,
          bookingState: bookingStateRef.current,
          conversationId: conversationIdRef.current,
          guestName: guestNameRef.current
        })
      });

      if (!response.ok) {
        throw new Error("Chat request failed");
      }

      const data = (await response.json()) as {
        reply?: string;
        bookingState?: unknown;
        whatsappUrl?: string | null;
        conversationId?: string | null;
        guestName?: string | null;
      };
      if ("bookingState" in data) {
        bookingStateRef.current = data.bookingState ?? null;
      }
      if (data.conversationId) {
        conversationIdRef.current = data.conversationId;
      }
      if ("guestName" in data) {
        guestNameRef.current = data.guestName ?? guestNameRef.current;
      }
      // The booking assistant includes this only once, right when a booking
      // is created — open it so the guest gets their WhatsApp confirmation
      // with one less step, same pattern as sendBookingInfoFromChat below.
      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
      }
      return data.reply || "Please contact us on WhatsApp or call 9708538395 / 9869035191 for the fastest booking help.";
    } catch {
      return "Sorry, I cannot connect right now. Please WhatsApp or call 9708538395 / 9869035191 for room inquiries.";
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    messageIdRef.current += 1;
    const userMessage: ChatMessage = {
      id: `user-${messageIdRef.current}`,
      role: "user",
      content: trimmed
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsTyping(true);

    const chatHistory = [...messages, userMessage]
      .filter((message) => message.id !== "welcome")
      .slice(-8)
      .map((message) => ({
        role: message.role === "bot" ? "assistant" : "user",
        content: message.content
      }));

    const botReplyContent = await fetchBotReply(trimmed, chatHistory);

    setMessages((current) => [
      ...current,
      {
        id: `bot-${messageIdRef.current}`,
        role: "bot",
        content: botReplyContent
      }
    ]);
    setIsTyping(false);

    if (!hasSentBookingInfoRef.current) {
      const transcript = [...messages, userMessage, { id: "pending-bot", role: "bot" as const, content: botReplyContent }]
        .map((entry) => `${entry.role === "user" ? "Guest" : "JK Assistant"}: ${entry.content}`)
        .join("\n");
      const emailMatch = transcript.match(EMAIL_REGEX);
      const phoneMatch = transcript.match(PHONE_REGEX);

      if (emailMatch && phoneMatch) {
        hasSentBookingInfoRef.current = true;
        void sendBookingInfoFromChat(transcript, emailMatch[0], phoneMatch[0].replace(/[\s-]/g, ""));
      }
    }
  }

  async function sendBookingInfoFromChat(transcript: string, email: string, phone: string) {
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
      `New chat booking inquiry from the Jikmis Apartment website.\nGuest email: ${email}\nGuest phone: ${phone}\n\nConversation:\n${transcript}`
    )}`;

    let emailSent = true;
    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          _subject: "New Jikmis Apartment chat booking inquiry",
          email,
          phone,
          transcript,
          _replyto: email
        })
      });
      emailSent = response.ok;
    } catch {
      emailSent = false;
    }

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");

    messageIdRef.current += 1;
    setMessages((current) => [
      ...current,
      {
        id: `bot-info-${messageIdRef.current}`,
        role: "bot",
        content: emailSent
          ? `Thanks! I've sent your details to our team (${INQUIRY_EMAIL}) and opened WhatsApp so we can confirm your booking quickly. If WhatsApp didn't open, tap here: ${whatsappUrl}`
          : `Thanks! I've opened WhatsApp so our team can confirm your booking. If it didn't open, tap here: ${whatsappUrl}`
      }
    ]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <div className="chatbot-shell">
      {!isOpen && !isHelperNoteHidden && (
        <div
          className="chat-helper-note"
          role="button"
          tabIndex={0}
          onClick={openChat}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            openChat();
          }}
          aria-label="Open Jikmis Apartment chat"
        >
          <span>💬 Have a question? Ask me about our apartment!</span>
          <button
            className="chat-helper-close"
            type="button"
            aria-label="Hide chat helper note"
            onClick={(event) => {
              event.stopPropagation();
              dismissHelperNote();
            }}
          >
            ×
          </button>
        </div>
      )}

      {isOpen && (
        <section className="chatbot-panel" aria-label="Jikmis Apartment chat">
          <header className="chatbot-header">
            <div>
              <strong>Jikmis Apartment</strong>
            </div>
            <button className="icon-button" type="button" onClick={() => setIsOpen(false)} aria-label="Close chat">
              <X size={18} />
            </button>
          </header>

          <div className="chatbot-history" ref={historyRef}>
            {messages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                {renderMessageContent(message.content)}
              </div>
            ))}
            {isTyping && (
              <div className="typing-indicator" aria-label="Receptionist is typing">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <div className="quick-replies" aria-label="Quick replies">
            {quickReplies.map((reply) => (
              <button key={reply} type="button" onClick={() => void sendMessage(reply)}>
                {reply}
              </button>
            ))}
          </div>

          <div className="chat-actions">
            <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer">
              <MessageCircle size={16} /> WhatsApp
            </a>
            <a href={`tel:+${WHATSAPP_NUMBER}`}>
              <Phone size={16} /> Call
            </a>
            <a href={`mailto:${INQUIRY_EMAIL}`}>
              <Mail size={16} /> Email
            </a>
          </div>

          <form className="chat-input-row" onSubmit={handleSubmit}>
            <input
              aria-label="Ask Jikmis Apartment"
              placeholder="Ask about rooms, price, location..."
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button className="icon-button send-button" type="submit" aria-label="Send message" disabled={isTyping}>
              <Send size={18} />
            </button>
          </form>
        </section>
      )}

      <button
        className="chatbot-launcher"
        type="button"
        onClick={openChat}
        aria-label="Open chat"
      >
        <Bot size={22} />
        <span>Chat</span>
      </button>
    </div>
  );
}
