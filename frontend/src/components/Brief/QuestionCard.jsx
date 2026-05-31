import { useState } from 'react';
import './QuestionCard.css';

// Renders one brief follow-up as a GenUI card: clickable pre-filled answers
// (chips) plus a free-text fallback. Emits onAnswer(value, label).
export default function QuestionCard({ question, onAnswer, disabled }) {
  const { question: prompt, why, input_type, options = [], allow_free_text } = question;
  const [selected, setSelected] = useState([]);
  const [text, setText] = useState('');

  const isMulti = input_type === 'multi_select';
  const isText = input_type === 'text' || input_type === 'number';

  function pick(opt) {
    if (disabled) return;
    if (isMulti) {
      setSelected((s) => (s.includes(opt.value) ? s.filter((v) => v !== opt.value) : [...s, opt.value]));
    } else {
      onAnswer(opt.value, opt.label);
    }
  }
  function submitMulti() {
    if (disabled || !selected.length) return;
    const labels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
    onAnswer(selected.join(', '), labels.join(', '));
  }
  function submitText() {
    const t = text.trim();
    if (disabled || !t) return;
    onAnswer(t, t);
  }

  return (
    <div className={`qcard${disabled ? ' qcard--done' : ''}`}>
      <div className="qcard-q">{prompt}</div>
      {why && <div className="qcard-why">{why}</div>}

      {!isText && options.length > 0 && (
        <div className="qcard-opts">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`qchip${isMulti && selected.includes(o.value) ? ' qchip--on' : ''}`}
              onClick={() => pick(o)}
              disabled={disabled}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {isMulti && !disabled && (
        <button type="button" className="qsubmit" onClick={submitMulti} disabled={!selected.length}>
          Submit{selected.length ? ` (${selected.length})` : ''}
        </button>
      )}

      {isText && !disabled && (
        <div className="qtext">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitText(); } }}
            placeholder="Type your answer…"
          />
          <button type="button" className="qsubmit" onClick={submitText} disabled={!text.trim()}>Send</button>
        </div>
      )}

      {allow_free_text && !isText && !disabled && (
        <div className="qcard-hint">…or type your own answer below</div>
      )}
    </div>
  );
}
