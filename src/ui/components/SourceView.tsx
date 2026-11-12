import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FoldRange, ParseFailure } from '../../core/pipeline/analyze';
import type { XmlWarning } from '../../core/xml/types';
import { Icon, IconButton } from './ui';

type State = 'text' | 'comment' | 'cdata' | 'tag' | 'pi' | 'decl' | 'dq' | 'sq';
type Span = [string, string];

const ROW = 20;
const MAX_LINE_RENDER = 2000;

function tokenize(line: string, state: State): { spans: Span[]; state: State } {
  const spans: Span[] = [];
  let i = 0;
  const push = (cls: string, s: string) => { if (s) spans.push([cls, s]); };
  const until = (needle: string, cls: string, next: State) => {
    const k = line.indexOf(needle, i);
    if (k === -1) { push(cls, line.slice(i)); i = line.length; return false; }
    push(cls, line.slice(i, k + needle.length)); i = k + needle.length; state = next; return true;
  };
  while (i < line.length) {
    if (state === 'comment') { until('-->', 'tok-comment', 'text'); continue; }
    if (state === 'cdata') { until(']]>', 'tok-comment', 'text'); continue; }
    if (state === 'pi') { until('?>', 'tok-decl', 'text'); continue; }
    if (state === 'decl') { until('>', 'tok-decl', 'text'); continue; }
    if (state === 'dq' || state === 'sq') { until(state === 'dq' ? '"' : "'", 'tok-val', 'tag'); continue; }
    if (state === 'tag') {
      const rest = line.slice(i);
      const ws = /^\s+/.exec(rest);
      if (ws) { push('', ws[0]); i += ws[0].length; continue; }
      if (rest.startsWith('/>')) { push('tok-punct', '/>'); i += 2; state = 'text'; continue; }
      if (rest[0] === '>') { push('tok-punct', '>'); i++; state = 'text'; continue; }
      const attr = /^[^\s=/>]+/.exec(rest);
      if (attr) { push('tok-attr', attr[0]); i += attr[0].length; continue; }
      if (rest[0] === '=') { push('tok-punct', '='); i++; continue; }
      if (rest[0] === '"' || rest[0] === "'") { push('tok-val', rest[0]); i++; state = rest[0] === '"' ? 'dq' : 'sq'; continue; }
      push('', rest[0]); i++; continue;
    }
    const lt = line.indexOf('<', i);
    const textPart = lt === -1 ? line.slice(i) : line.slice(i, lt);
    if (textPart) {
      for (const m of textPart.split(/(&[#\w.:-]+;)/)) push(m.startsWith('&') && m.endsWith(';') ? 'tok-entity' : '', m);
    }
    if (lt === -1) break;
    i = lt;
    const rest = line.slice(i);
    if (rest.startsWith('<!--')) { push('tok-comment', '<!--'); i += 4; state = 'comment'; }
    else if (rest.startsWith('<![CDATA[')) { push('tok-comment', '<![CDATA['); i += 9; state = 'cdata'; }
    else if (rest.startsWith('<?')) { push('tok-decl', '<?'); i += 2; state = 'pi'; }
    else if (rest.startsWith('<!')) { push('tok-decl', '<!'); i += 2; state = 'decl'; }
    else {
      const m = /^<\/?[^\s/>]*/.exec(rest)!;
      push('tok-punct', m[0].startsWith('</') ? '</' : '<');
      push('tok-tag', m[0].replace(/^<\/?/, ''));
      i += m[0].length;
      state = 'tag';
    }
  }
  return { spans, state };
}

interface Props {
  text: string;
  folds: FoldRange[];
  error?: ParseFailure;
  warnings: XmlWarning[];
  gotoLine?: { line: number; nonce: number };
}

export function SourceView({ text, folds, error, warnings, gotoLine }: Props) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const states = useMemo(() => {
    const out: State[] = new Array(lines.length);
    let s: State = 'text';
    for (let k = 0; k < lines.length; k++) {
      out[k] = s;
      s = lines[k].length > MAX_LINE_RENDER ? s : tokenize(lines[k], s).state;
    }
    return out;
  }, [lines]);
  const foldAt = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of folds) if (!m.has(f.start) || m.get(f.start)! < f.end) m.set(f.start, f.end);
    return m;
  }, [folds]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  useEffect(() => setCollapsed(new Set()), [text]);
  const visible = useMemo(() => {
    const out: number[] = [];
    for (let ln = 1; ln <= lines.length; ln++) {
      out.push(ln);
      if (collapsed.has(ln)) ln = foldAt.get(ln) ?? ln;
    }
    return out;
  }, [lines.length, collapsed, foldAt]);
  const warnByLine = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const w of warnings) if (w.pos) m.set(w.pos.line, [...(m.get(w.pos.line) ?? []), w.message]);
    return m;
  }, [warnings]);

  const [query, setQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const matches = useMemo(() => {
    const q = query.toLowerCase();
    if (q.length < 2) return [] as number[];
    const out: number[] = [];
    for (let k = 0; k < lines.length && out.length < 10_000; k++) if (lines[k].toLowerCase().includes(q)) out.push(k + 1);
    return out;
  }, [query, lines]);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reveal = (line: number) => {
    setCollapsed((c) => {
      const next = new Set(c);
      for (const start of c) if (start < line && (foldAt.get(start) ?? 0) >= line) next.delete(start);
      return next;
    });
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el) return;
      const idx = visibleRef.current.indexOf(line);
      if (idx >= 0) el.scrollTop = Math.max(0, idx * ROW - el.clientHeight / 3);
      setFlash(line);
    });
  };
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => { if (gotoLine) reveal(gotoLine.line); }, [gotoLine?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (error) reveal(error.line); }, [error?.line, text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (matches.length) reveal(matches[Math.min(matchIdx, matches.length - 1)]); }, [matchIdx, matches]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 10);
  const last = Math.min(visible.length, Math.ceil((scrollTop + height) / ROW) + 10);
  const gutterW = String(lines.length).length * 8 + 40;
  const q = query.toLowerCase();

  const renderLine = (ln: number): ReactNode => {
    const raw = lines[ln - 1];
    if (raw.length > MAX_LINE_RENDER) return <span className="text-subtle">{raw.slice(0, 400)}… <em>({(raw.length / 1000).toFixed(0)}k characters, truncated for display)</em></span>;
    const { spans } = tokenize(raw, states[ln - 1]);
    if (q.length < 2 || !raw.toLowerCase().includes(q)) return spans.map(([c, s], k) => <span key={k} className={c}>{s}</span>);
    // highlight search hits on top of tokens
    const out: ReactNode[] = [];
    let pos = 0;
    const hits: Array<[number, number]> = [];
    let h = raw.toLowerCase().indexOf(q);
    while (h !== -1) { hits.push([h, h + q.length]); h = raw.toLowerCase().indexOf(q, h + q.length); }
    spans.forEach(([c, s], k) => {
      const start = pos;
      const end = pos + s.length;
      let cur = start;
      for (const [a, b] of hits) {
        if (b <= cur || a >= end) continue;
        if (a > cur) out.push(<span key={`${k}-${cur}`} className={c}>{raw.slice(cur, a)}</span>);
        out.push(<mark key={`${k}-m${a}`} className={`${c} rounded-sm bg-warn/30 text-inherit`}>{raw.slice(Math.max(a, cur), Math.min(b, end))}</mark>);
        cur = Math.min(b, end);
      }
      if (cur < end) out.push(<span key={`${k}-${cur}e`} className={c}>{raw.slice(cur, end)}</span>);
      pos = end;
    });
    return out;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <label className="relative">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-subtle" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setMatchIdx(0); }} placeholder="Search source" aria-label="Search source"
            onKeyDown={(e) => { if (e.key === 'Enter' && matches.length) setMatchIdx((i) => (e.shiftKey ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length)); }}
            className="h-8 w-64 rounded-md border border-line bg-raised pl-7 pr-2 text-xs text-fg placeholder:text-subtle focus:border-accent focus:outline-none" />
        </label>
        <span className="min-w-20 text-xs text-subtle">{query.length >= 2 ? (matches.length ? `${Math.min(matchIdx, matches.length - 1) + 1} of ${matches.length}${matches.length >= 10_000 ? '+' : ''}` : 'No matches') : ''}</span>
        <IconButton icon="chevronDown" label="Previous match" className="rotate-180" disabled={!matches.length} onClick={() => setMatchIdx((i) => (i - 1 + matches.length) % matches.length)} />
        <IconButton icon="chevronDown" label="Next match" disabled={!matches.length} onClick={() => setMatchIdx((i) => (i + 1) % matches.length)} />
        <div className="ml-auto flex items-center gap-1 text-xs text-subtle">
          <button className="rounded px-2 py-1 hover:bg-hover hover:text-fg" onClick={() => setCollapsed(new Set(folds.filter((f) => f.start > 1).map((f) => f.start)))}>Collapse all</button>
          <button className="rounded px-2 py-1 hover:bg-hover hover:text-fg" onClick={() => setCollapsed(new Set())}>Expand all</button>
          <span className="pl-2">{lines.length.toLocaleString()} lines</span>
        </div>
      </div>
      {error && (
        <div className="flex items-start gap-2 border-b border-err/30 bg-err/10 px-4 py-2 text-xs text-fg" role="alert">
          <Icon name="x" size={15} className="mt-px text-err" />
          <div>
            <button className="font-semibold hover:underline" onClick={() => reveal(error.line)}>Line {error.line}, column {error.col}:</button> {error.message}
            {error.hint && <div className="mt-0.5 text-muted">{error.hint}</div>}
          </div>
        </div>
      )}
      <div ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="scroll-thin relative min-h-0 flex-1 overflow-auto bg-panel font-mono text-[12px]" data-testid="source-view">
        <div style={{ height: visible.length * ROW, position: 'relative', minWidth: '100%' }}>
          {visible.slice(first, last).map((ln, k) => {
            const top = (first + k) * ROW;
            const isErr = error?.line === ln;
            const warn = warnByLine.get(ln);
            const fold = foldAt.get(ln);
            const isCollapsed = collapsed.has(ln);
            return (
              <div key={ln} data-line={ln} className={`absolute left-0 flex w-max min-w-full whitespace-pre ${isErr ? 'bg-err/15' : flash === ln ? 'bg-accent-soft' : ''}`} style={{ top, height: ROW, lineHeight: `${ROW}px` }}>
                <div className="sticky left-0 z-10 flex shrink-0 select-none items-center justify-end gap-1 border-r border-line bg-panel pr-1 text-subtle" style={{ width: gutterW }}>
                  {isErr ? <span className="h-1.5 w-1.5 rounded-full bg-err" title={error!.message} /> : warn ? <span className="h-1.5 w-1.5 rounded-full bg-warn" title={warn.join('\n')} /> : null}
                  <span className={isErr ? 'text-err' : ''}>{ln}</span>
                  {fold ? (
                    <button aria-label={isCollapsed ? `Expand lines ${ln}–${fold}` : `Collapse lines ${ln}–${fold}`} className="flex h-4 w-4 items-center justify-center rounded hover:bg-hover hover:text-fg"
                      onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(ln)) n.delete(ln); else n.add(ln); return n; })}>
                      <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={12} />
                    </button>
                  ) : <span className="w-4" />}
                </div>
                <div className="pl-3 pr-6 text-fg">
                  {renderLine(ln)}
                  {isCollapsed && <span className="ml-2 rounded bg-hover px-1.5 text-[11px] text-subtle">… {fold! - ln} lines</span>}
                  {isErr && error && <span className="ml-3 text-[11px] text-err">◀ {error.code}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
