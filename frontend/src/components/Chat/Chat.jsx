import { useEffect, useRef, useState } from 'react';
import Background from '../Background/Background';
import Sidebar from '../Sidebar/Sidebar';
import QuestionCard from '../Brief/QuestionCard';
import BriefCard from '../Brief/BriefCard';
import PlanCard from '../Plan/PlanCard';
import ResearchPanel from '../Plan/ResearchPanel';
import RunningPanel from '../Plan/RunningPanel';
import SwarmMonitor from '../SwarmMonitor/SwarmMonitor';
import Upload from '../Project/Upload';
import { api, getToken } from '../../api';
import './Chat.css';

let convCounter = 1;
// A conversation runs the brief interview: goal → questions → enriched brief.
const newConversation = () => ({
  id: `c${convCounter++}`,
  title: 'New chat',
  messages: [], // { role, kind:'text'|'question'|'brief', content?, question?, brief?, answered?, confirmed?, error? }
  goal: null,
  transcript: [], // [{ id, question, answer }]
  phase: 'idle', // idle | interviewing | confirming | locked
});

export default function Chat({ user, project, onUpdateProject, onBack, onLogout }) {
  const [conversations, setConversations] = useState(() => [newConversation()]);
  const [activeId, setActiveId] = useState(conversations[0].id);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [planStage, setPlanStage] = useState(null);
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

  // While the planner runs (web research → plan), rotate the thinking label through its stages.
  useEffect(() => {
    if (active.phase !== 'planning') { setPlanStage(null); return; }
    const stages = ['Planning research', 'Researching the domain', 'Reading the research', 'Writing the plan'];
    let i = 0;
    setPlanStage(stages[0]);
    const t = setInterval(() => { i = Math.min(i + 1, stages.length - 1); setPlanStage(stages[i]); }, 7000);
    return () => clearInterval(t);
  }, [active.phase, active.id]);

  function patchActive(updater) {
    setConversations((convs) => convs.map((c) => (c.id === activeId ? updater(c) : c)));
  }
  function patchConv(id, updater) {
    setConversations((convs) => convs.map((c) => (c.id === id ? updater(c) : c)));
  }

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  function handleNewChat() {
    if (empty) return;
    const conv = newConversation();
    setConversations((c) => [conv, ...c]);
    setActiveId(conv.id);
    setInput('');
  }

  // Run one interview step against /api/brief/next, then render the result.
  async function advance(convId, goal, transcript) {
    setSending(true);
    try {
      const dataset = project?.hasData ? project.dataFacts : undefined;
      const step = await api.briefNext({ goal, transcript, dataset }, getToken());
      patchConv(convId, (c) => {
        if (step.action === 'finalize') {
          return { ...c, phase: 'confirming', messages: [...c.messages, { role: 'assistant', kind: 'brief', brief: step.brief }] };
        }
        return { ...c, phase: 'interviewing', messages: [...c.messages, { role: 'assistant', kind: 'question', question: step.question }] };
      });
    } catch (err) {
      patchConv(convId, (c) => ({
        ...c,
        messages: [...c.messages, { role: 'assistant', kind: 'text', content: `⚠ ${err.message || 'The brief agent failed.'}`, error: true }],
      }));
    } finally {
      setSending(false);
    }
  }

  // Record an answer (from a clicked chip or free text) and advance.
  function submitAnswer(conv, value, label) {
    const pendingIdx = [...conv.messages].map((m, i) => [m, i]).reverse()
      .find(([m]) => m.kind === 'question' && !m.answered)?.[1];
    const pending = pendingIdx != null ? conv.messages[pendingIdx] : null;
    const id = pending ? pending.question.id : `refine_${conv.transcript.length}`;
    const qtext = pending ? pending.question.question : '(refinement)';
    const transcript = [...conv.transcript, { id, question: qtext, answer: value }];

    patchConv(conv.id, (c) => ({
      ...c,
      transcript,
      messages: c.messages
        .map((m, i) => (i === pendingIdx ? { ...m, answered: true } : m))
        .concat([{ role: 'user', kind: 'text', content: label || value }]),
    }));
    advance(conv.id, conv.goal, transcript);
  }

  // textarea submit: first message = the goal; afterwards = free-text answer / refine.
  function send() {
    const text = input.trim();
    if (!text || sending || active.phase === 'planning') return;
    setInput('');
    requestAnimationFrame(autosize);

    if (!active.goal) {
      const goal = text;
      patchActive((c) => ({
        ...c,
        goal,
        phase: 'interviewing',
        title: c.messages.length === 0 ? text.slice(0, 40) : c.title,
        messages: [...c.messages, { role: 'user', kind: 'text', content: text }],
      }));
      advance(active.id, goal, []);
      return;
    }
    submitAnswer(active, text, text);
  }

  function answerQuestion(value, label) {
    if (sending) return;
    submitAnswer(active, value, label);
  }

  async function confirmBrief(idx) {
    const conv = active;
    const brief = conv.messages[idx]?.brief;
    // mark brief confirmed + append a live research panel; its index is the new last message
    const researchIdx = conv.messages.length;
    patchActive((c) => ({
      ...c,
      phase: 'planning',
      messages: c.messages
        .map((m, i) => (i === idx ? { ...m, confirmed: true } : m))
        .concat([{ role: 'assistant', kind: 'research', research: { stage: 'Planning research', angles: [], done: false } }]),
    }));

    const updateResearch = (fn) =>
      patchConv(conv.id, (c) => ({
        ...c,
        messages: c.messages.map((m, i) => (i === researchIdx ? { ...m, research: fn(m.research) } : m)),
      }));

    const onEvent = (evt) => {
      if (evt.type === 'stage') {
        updateResearch((r) => ({ ...r, stage: evt.label }));
      } else if (evt.type === 'queries') {
        updateResearch((r) => ({ ...r, angles: evt.queries.map((q) => ({ angle: q.angle, query: q.query, status: 'pending', sources: [] })) }));
      } else if (evt.type === 'search_start') {
        updateResearch((r) => ({ ...r, angles: r.angles.map((a) => (a.query === evt.query ? { ...a, status: 'searching' } : a)) }));
      } else if (evt.type === 'search_done') {
        updateResearch((r) => ({ ...r, angles: r.angles.map((a) => (a.query === evt.query ? { ...a, status: 'done', sources: evt.sources || [] } : a)) }));
      }
    };

    try {
      const plan = await api.plannerPlanStream(brief, getToken(), onEvent);
      updateResearch((r) => ({ ...r, done: true }));
      patchConv(conv.id, (c) => ({
        ...c,
        phase: 'plan-ready',
        messages: [...c.messages, { role: 'assistant', kind: 'plan', plan }],
      }));
    } catch (err) {
      updateResearch((r) => ({ ...r, done: true }));
      patchConv(conv.id, (c) => ({
        ...c,
        phase: 'confirming',
        messages: [...c.messages, { role: 'assistant', kind: 'text', content: `⚠ ${err.message || 'Planning failed.'}`, error: true }],
      }));
    }
  }

  async function runPlan(idx) {
    const plan = active?.messages?.[idx]?.plan;
    // Optimistically mark the plan launched + show the running placeholder.
    patchActive((c) => ({
      ...c,
      phase: 'launched',
      messages: c.messages
        .map((m, i) => (i === idx ? { ...m, launched: true } : m))
        .concat([{ role: 'assistant', kind: 'running' }]),
    }));
    // Launch the real research swarm; swap the placeholder for the live monitor.
    try {
      const res = await fetch('/api/run/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error(`launch failed (${res.status})`);
      const { runId } = await res.json();
      patchActive((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.kind === 'running' ? { role: 'assistant', kind: 'monitor', runId } : m,
        ),
      }));
    } catch (err) {
      // Leave the running placeholder in place; the swarm couldn't be launched.
      console.error('run launch error:', err);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const placeholder = !active.goal
    ? 'Describe your problem…'
    : active.phase === 'planning'
      ? 'Researching the domain…'
      : active.phase === 'confirming'
        ? 'Type a tweak to refine, or click “Yes, this is what I mean”…'
        : 'Type your answer, or tap an option above…';

  // Spinner label matches the actual phase. We only say "Writing your brief" once the agent
  // is genuinely finalizing — at the 3-question cap it's forced to finalize; before that it's
  // still deciding/asking, so "Thinking".
  const thinkingLabel =
    active.phase === 'planning'
      ? (planStage || 'Researching the domain')
      : !active.goal || active.transcript.length === 0
        ? 'Reading your problem'
        : active.transcript.length >= 3
          ? 'Writing your brief'
          : 'Thinking';

  return (
    <div className={`chat${collapsed ? ' chat--collapsed' : ''}`}>
      <Background dim />

      <Sidebar
        user={user}
        project={project}
        onBack={onBack}
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
              <h1 className="chat-empty-title">
                {project ? project.name : `Hi ${firstName}`}
                {!project && ', what problem should AutoLab solve?'}
              </h1>
              <p className="chat-empty-sub">
                Describe your goal and I’ll ask a few quick questions, then write the brief:
                the exact problem, how it should have been asked.
              </p>
              {project && project.hasData && (
                <div className="chat-data-chip">
                  <span className="chat-data-dot" />
                  Data ready: {project.datasetName || 'dataset'}
                  {project.dataFacts?.n_rows ? ` · ${project.dataFacts.n_rows} rows × ${project.dataFacts.n_columns} cols` : ''}
                </div>
              )}
              {project && !project.hasData && (
                <div className="chat-empty-upload">
                  <Upload projectId={project.id} onUploaded={(p) => onUpdateProject(p)} />
                  <p className="chat-empty-hint">Optional, but uploading your data grounds the brief in your real columns.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="chat-thread">
              {messages.map((m, i) => {
                if (m.kind === 'question') {
                  return (
                    <div key={i} className="msg msg--assistant">
                      <div className="msg-role">AutoLab</div>
                      <QuestionCard question={m.question} disabled={!!m.answered} onAnswer={answerQuestion} />
                    </div>
                  );
                }
                if (m.kind === 'brief') {
                  return (
                    <div key={i} className="msg msg--assistant">
                      <div className="msg-role">AutoLab</div>
                      <BriefCard brief={m.brief} confirmed={!!m.confirmed} onConfirm={() => confirmBrief(i)} />
                    </div>
                  );
                }
                if (m.kind === 'research') {
                  return (
                    <div key={i} className="msg msg--assistant">
                      <div className="msg-role">AutoLab</div>
                      <ResearchPanel research={m.research} />
                    </div>
                  );
                }
                if (m.kind === 'plan') {
                  return (
                    <div key={i} className="msg msg--assistant">
                      <div className="msg-role">AutoLab</div>
                      <PlanCard plan={m.plan} launched={!!m.launched} onRun={() => runPlan(i)} />
                    </div>
                  );
                }
                if (m.kind === 'running') {
                  return (
                    <div key={i} className="msg msg--assistant">
                      <div className="msg-role">AutoLab</div>
                      <RunningPanel />
                    </div>
                  );
                }
                if (m.kind === 'monitor') {
                  return (
                    <div key={i} className="msg msg--assistant">
                      <div className="msg-role">AutoLab</div>
                      <SwarmMonitor runId={m.runId} />
                    </div>
                  );
                }
                return (
                  <div key={i} className={`msg msg--${m.role}${m.error ? ' msg--error' : ''}`}>
                    <div className="msg-role">{m.role === 'user' ? 'You' : 'AutoLab'}</div>
                    <div className="msg-bubble">{m.content}</div>
                  </div>
                );
              })}
              {sending && (
                <div className="msg msg--assistant">
                  <div className="msg-role">AutoLab</div>
                  <div className="thinking">
                    <span className="thinking-orb" />
                    <span className="thinking-text">{thinkingLabel}</span>
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
              placeholder={placeholder}
              rows={1}
            />
            <button
              className="chat-send"
              onClick={send}
              disabled={!input.trim() || sending || active.phase === 'planning'}
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
