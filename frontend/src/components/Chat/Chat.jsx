import { useEffect, useRef, useState } from 'react';
import Background from '../Background/Background';
import Sidebar from '../Sidebar/Sidebar';
import { api, getToken } from '../../api';
import './Chat.css';

let convCounter = 1;
const newConversation = () => ({ id: `c${convCounter++}`, title: 'New chat', messages: [] });

export default function Chat({ user, onLogout }) {
  const [conversations, setConversations] = useState(() => [newConversation()]);
  const [activeId, setActiveId] = useState(conversations[0].id);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('autolab_sidebar_collapsed') === '1'
  );

  const scrollRef = useRef(null);
  const taRef = useRef(null);

  const active = conversations.find((c) => c.id === activeId) || conversations[0];
  const messages = active.messages;
  const empty = messages.length === 0;
  const firstName = (user?.name || user?.email || 'there').split(/[\s@]/)[0];

  useEffect(() => {
    localStorage.setItem('autolab_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  function patchActive(updater) {
    setConversations((convs) =>
      convs.map((c) => (c.id === activeId ? updater(c) : c))
    );
  }

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  function handleNewChat() {
    // reuse current chat if it's already empty (like ChatGPT)
    if (empty) return;
    const conv = newConversation();
    setConversations((c) => [conv, ...c]);
    setActiveId(conv.id);
    setInput('');
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    patchActive((c) => ({
      ...c,
      title: c.messages.length === 0 ? text.slice(0, 40) : c.title,
      messages: [...c.messages, { role: 'user', content: text }],
    }));
    setInput('');
    setSending(true);
    requestAnimationFrame(autosize);

    try {
      const { reply } = await api.chat(text, getToken());
      patchActive((c) => ({ ...c, messages: [...c.messages, { role: 'assistant', content: reply }] }));
    } catch (err) {
      patchActive((c) => ({
        ...c,
        messages: [...c.messages, { role: 'assistant', content: `⚠ ${err.message || 'Something went wrong.'}`, error: true }],
      }));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className={`chat${collapsed ? ' chat--collapsed' : ''}`}>
      <Background dim />

      <Sidebar
        user={user}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNewChat={handleNewChat}
        onLogout={onLogout}
      />

      <main className="chat-main">
        <div className="chat-body" ref={scrollRef}>
          {empty ? (
            <div className="chat-empty">
              <img src="/autolab-logo.svg" alt="" className="chat-empty-logo" />
              <h1 className="chat-empty-title">Hi {firstName}, what do you want to build?</h1>
              <p className="chat-empty-sub">
                Describe a system and AutoLab will help you take it from prompt to production.
              </p>
            </div>
          ) : (
            <div className="chat-thread">
              {messages.map((m, i) => (
                <div key={i} className={`msg msg--${m.role}${m.error ? ' msg--error' : ''}`}>
                  <div className="msg-role">{m.role === 'user' ? 'You' : 'AutoLab'}</div>
                  <div className="msg-bubble">{m.content}</div>
                </div>
              ))}
              {sending && (
                <div className="msg msg--assistant">
                  <div className="msg-role">AutoLab</div>
                  <div className="msg-bubble msg-typing">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="chat-input-wrap">
          <div className="chat-input glass">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autosize(); }}
              onKeyDown={onKeyDown}
              placeholder="Message AutoLab…"
              rows={1}
            />
            <button
              className="chat-send"
              onClick={send}
              disabled={!input.trim() || sending}
              aria-label="Send"
            >
              ↑
            </button>
          </div>
          <p className="chat-hint">Press Enter to send · Shift+Enter for a new line</p>
        </div>
      </main>
    </div>
  );
}
