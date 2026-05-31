// Profile CSV text into data_facts (no dependencies). Mirrors the Python data_inspector idea:
// per-column type/missing/cardinality + guesses at target and entity/group columns.

const TARGET_HINT = /^(target|label|y|class|outcome|churn(ed)?|fault|default|fraud|price|sales|score|rating|result|status)$/i;
const ID_HINT = /(^id$|_id$|uuid|guid|^key$|_key$|customer|user|account|flight|session|patient|subject|trial|device|order)/i;
const DATE_HINT = /(date|time|timestamp|datetime|day|month|year)/i;
const BOOLISH = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '0', '1', 't', 'f']);

function parseLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const isNum = (s) => s !== '' && !Number.isNaN(Number(s));

function inferType(name, values) {
  const nonempty = values.filter((v) => v !== '');
  if (!nonempty.length) return 'text';
  const lower = new Set(nonempty.map((v) => v.toLowerCase()));
  const uniq = new Set(nonempty);
  if ([...lower].every((v) => BOOLISH.has(v)) && lower.size <= 2) return 'boolean';
  if (ID_HINT.test(name) && uniq.size >= 0.9 * nonempty.length) return 'id';
  if (nonempty.every(isNum)) return 'numeric';
  if (DATE_HINT.test(name)) return 'datetime';
  return 'categorical';
}

export function profileCsv(text, filename = 'data.csv', maxRows = 20000) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { source: `uploaded file ${filename}`, n_rows: 0, n_columns: 0, columns: [], notes: ['empty file'] };
  const header = parseLine(lines[0]);
  const cols = header.map(() => []);
  let n = 0;
  for (let r = 1; r < lines.length && n < maxRows; r++) {
    const row = parseLine(lines[r]);
    for (let i = 0; i < header.length; i++) cols[i].push(row[i] ?? '');
    n++;
  }

  const columns = header.map((name, i) => {
    const vals = cols[i];
    const nonempty = vals.filter((v) => v !== '');
    const dtype = inferType(name, vals);
    const uniq = [...new Set(nonempty)];
    const col = {
      name,
      dtype,
      n_missing: vals.length - nonempty.length,
      n_unique: uniq.size ?? new Set(nonempty).size,
      examples: uniq.slice(0, 5),
    };
    if (dtype === 'numeric' && nonempty.length) {
      const nums = nonempty.map(Number).filter((x) => !Number.isNaN(x));
      col.min = Math.min(...nums);
      col.max = Math.max(...nums);
      col.mean = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
    }
    return col;
  });

  let target_candidates = columns.filter((c) => TARGET_HINT.test(c.name)).map((c) => c.name);
  if (!target_candidates.length) {
    target_candidates = columns.filter((c) => (c.dtype === 'boolean' || c.dtype === 'categorical') && c.n_unique >= 2 && c.n_unique <= 10).map((c) => c.name);
  }
  if (!target_candidates.length && columns.length) target_candidates = [columns[columns.length - 1].name];

  const group_candidates = columns.filter((c) => c.dtype === 'id' || ID_HINT.test(c.name)).map((c) => c.name);

  const notes = [];
  if (group_candidates.length) notes.push(`entity/id columns present (${group_candidates.join(', ')}); split BY one of these, not by row, and exclude raw ids from features.`);
  const hiMissing = columns.filter((c) => n && c.n_missing > 0.3 * n).map((c) => c.name);
  if (hiMissing.length) notes.push(`high-missing columns (>30%): ${hiMissing.join(', ')}`);

  return {
    source: `uploaded file "${filename}" (already in hand)`,
    n_rows: n,
    n_columns: header.length,
    columns,
    target_candidates,
    group_candidates,
    notes,
  };
}
