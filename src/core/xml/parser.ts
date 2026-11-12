/**
 * A strict, non-validating XML 1.0 parser written for XML Canvas.
 *
 * Why not a library: the app needs (a) a line/column position for every node so that assets and layers can
 * be traced back to the source, (b) precise well-formedness errors, and (c) a hard guarantee that no entity is
 * ever fetched or expanded beyond the five predefined ones and character references.
 *
 * Security properties:
 *  - External entities and external DTD subsets are recorded but NEVER resolved (no XXE).
 *  - Custom internal entities are NEVER expanded (no "billion laughs"); references are kept literally and
 *    reported as warnings.
 *  - Iterative (non-recursive) parsing with a depth limit, so deeply nested input cannot overflow the stack.
 */
import {
  type DoctypeInfo,
  type EntityDecl,
  NS,
  type SourcePos,
  type XmlAttr,
  type XmlDocument,
  type XmlElement,
  XmlParseError,
  type XmlStats,
  type XmlText,
  type XmlWarning,
} from './types';

export interface ParseOptions {
  maxDepth?: number;
}

// XML 1.0 NameStartChar / NameChar (BMP subset), written with escapes so the source stays ASCII.
const NAME_RE = new RegExp('[A-Za-z_:\\u00C0-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][A-Za-z0-9_:.\\-\\u00B7\\u00C0-\\u02FF\\u0300-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u203F-\\u2040\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD]*', 'y');
const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function normalizeLineEndings(s: string): string {
  return s.indexOf('\r') === -1 ? s : s.replace(/\r\n?/g, '\n');
}

export function parseXml(input: string, options: ParseOptions = {}): XmlDocument {
  const maxDepth = options.maxDepth ?? 1024;
  const src = normalizeLineEndings(input);
  const n = src.length;

  const lineStarts: number[] = [0];
  for (let k = 0; k < n; k++) if (src.charCodeAt(k) === 10) lineStarts.push(k + 1);
  const posAt = (offset: number): SourcePos => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - lineStarts[lo] + 1, offset };
  };
  const fail = (code: string, message: string, offset: number, hint?: string): never => {
    throw new XmlParseError(code, message, posAt(Math.min(offset, n)), hint);
  };

  const warnings: XmlWarning[] = [];
  const warnedKeys = new Set<string>();
  const warnOnce = (key: string, code: string, message: string, offset?: number) => {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
    warnings.push({ code, message, pos: offset === undefined ? undefined : posAt(offset) });
  };

  const stats: XmlStats = { elements: 0, attributes: 0, textNodes: 0, maxDepth: 0, characters: n };
  let doctype: DoctypeInfo | undefined;
  let xmlDecl: XmlDocument['xmlDecl'];
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];
  const nsStack: Array<Map<string, string>> = [new Map([['xml', NS.xml], ['xmlns', NS.xmlns]])];
  const declaredEntities = new Map<string, EntityDecl>();
  const siblingCounts = new Map<XmlElement, Map<string, number>>();

  let i = 0;
  if (src.charCodeAt(0) === 0xfeff) i = 1;

  const readName = (at: number): string | null => {
    NAME_RE.lastIndex = at;
    const m = NAME_RE.exec(src);
    return m ? m[0] : null;
  };
  const isWs = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;
  const skipWs = (at: number) => {
    while (at < n && isWs(src.charCodeAt(at))) at++;
    return at;
  };

  const decodeEntities = (raw: string, baseOffset: number): string => {
    if (raw.indexOf('&') === -1) return raw;
    let out = '';
    let last = 0;
    let amp = raw.indexOf('&');
    while (amp !== -1) {
      out += raw.slice(last, amp);
      const semi = raw.indexOf(';', amp);
      const body = semi === -1 ? '' : raw.slice(amp + 1, semi);
      if (semi === -1 || semi - amp > 64 || !/^(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_:][\w.\-:]*)$/.test(body)) {
        fail('unescaped-ampersand', "Unescaped '&'. In XML a literal ampersand must be written as &amp;", baseOffset + amp,
          'Replace "&" with "&amp;" (common in URLs such as "?a=1&b=2").');
      }
      if (body[0] === '#') {
        const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code > 0x10ffff || code === 0 || (code >= 0xd800 && code <= 0xdfff)) {
          fail('bad-char-ref', `Invalid character reference &${body};`, baseOffset + amp);
        }
        out += String.fromCodePoint(code);
      } else if (body in PREDEFINED) {
        out += PREDEFINED[body];
      } else if (declaredEntities.has(body)) {
        const decl = declaredEntities.get(body)!;
        warnOnce(`ent:${body}`, decl.kind === 'external' ? 'external-entity-blocked' : 'entity-not-expanded',
          decl.kind === 'external'
            ? `Reference to external entity &${body}; was NOT resolved. XML Canvas never loads external entities (XXE protection).`
            : `Custom entity &${body}; was kept literally and not expanded. Expanding custom entities is disabled for safety.`,
          baseOffset + amp);
        out += `&${body};`;
      } else {
        fail('undefined-entity', `Undefined entity &${body};`, baseOffset + amp,
          'XML only predefines &lt; &gt; &amp; &quot; &apos;. HTML entities such as &nbsp; must be replaced with character references like &#160;.');
      }
      last = semi + 1;
      amp = raw.indexOf('&', last);
    }
    return out + raw.slice(last);
  };

  const addText = (start: number, end: number) => {
    const raw = src.slice(start, end);
    if (stack.length === 0) {
      if (/\S/.test(raw)) {
        const firstNonWs = start + raw.search(/\S/);
        fail(root ? 'content-after-root' : 'text-before-root',
          root ? 'Content found after the root element has been closed.' : 'Text found before the root element.',
          firstNonWs, 'An XML document must have exactly one root element that contains everything else.');
      }
      return;
    }
    const cdEnd = raw.indexOf(']]>');
    if (cdEnd !== -1) fail('bad-cdata-end', "']]>' is not allowed in text content.", start + cdEnd);
    const node: XmlText = { type: 'text', value: decodeEntities(raw, start), cdata: false, pos: posAt(start) };
    stack[stack.length - 1].children.push(node);
    stats.textNodes++;
  };

  const resolvePrefix = (prefix: string, scope: Map<string, string>, offset: number, forAttr: boolean): string => {
    if (prefix === '') return forAttr ? '' : (scope.get('') ?? '');
    const uri = scope.get(prefix);
    if (uri === undefined) {
      warnOnce(`pfx:${prefix}`, 'undeclared-prefix', `Namespace prefix "${prefix}:" is used but never declared.`, offset);
      return '';
    }
    return uri;
  };

  const parseDoctype = (start: number) => {
    let j = start + 9;
    j = skipWs(j);
    const name = readName(j) ?? fail('bad-doctype', 'Malformed DOCTYPE: missing name.', j);
    j = skipWs(j + name.length);
    const info: DoctypeInfo = { name, entities: [], pos: posAt(start) };
    const readQuoted = (): string => {
      const q = src[j];
      if (q !== '"' && q !== "'") fail('bad-doctype', 'Malformed DOCTYPE: expected a quoted identifier.', j);
      const e = src.indexOf(q, j + 1);
      if (e === -1) fail('bad-doctype', 'Malformed DOCTYPE: unterminated quoted identifier.', j);
      const v = src.slice(j + 1, e);
      j = skipWs(e + 1);
      return v;
    };
    if (src.startsWith('PUBLIC', j)) {
      j = skipWs(j + 6);
      info.publicId = readQuoted();
      info.systemId = readQuoted();
    } else if (src.startsWith('SYSTEM', j)) {
      j = skipWs(j + 6);
      info.systemId = readQuoted();
    }
    if (info.systemId) {
      warnOnce('ext-dtd', 'external-dtd-ignored',
        `The DOCTYPE references an external DTD ("${info.systemId}"). It was not loaded: XML Canvas never fetches external resources while parsing.`, start);
    }
    if (src[j] === '[') {
      const subsetStart = j + 1;
      let k = subsetStart;
      while (k < n && src[k] !== ']') {
        const c = src[k];
        if (c === '"' || c === "'") {
          const e = src.indexOf(c, k + 1);
          if (e === -1) fail('bad-doctype', 'Unterminated string in DOCTYPE internal subset.', k);
          k = e + 1;
        } else if (src.startsWith('<!--', k)) {
          const e = src.indexOf('-->', k + 4);
          if (e === -1) fail('unclosed-comment', 'Unclosed comment in DOCTYPE.', k);
          k = e + 3;
        } else k++;
      }
      if (k >= n) fail('bad-doctype', 'DOCTYPE internal subset is not closed with "]".', j);
      const subset = src.slice(subsetStart, k);
      const re = /<!ENTITY\s+(%\s+)?([^\s"'>]+)\s+(?:(SYSTEM|PUBLIC)\s+("[^"]*"|'[^']*')(?:\s+("[^"]*"|'[^']*'))?|("[^"]*"|'[^']*'))/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(subset))) {
        const isParam = !!m[1];
        const ename = m[2];
        let decl: EntityDecl;
        if (m[3]) {
          const sys = (m[3] === 'PUBLIC' ? m[5] : m[4]) ?? m[4];
          decl = { name: ename, kind: isParam ? 'parameter' : 'external', systemId: sys.slice(1, -1) };
          warnOnce(`decl:${ename}`, 'external-entity-blocked',
            `External entity "${ename}" points to "${decl.systemId}". It was blocked and will never be resolved (XXE protection).`,
            subsetStart + m.index);
        } else {
          decl = { name: ename, kind: isParam ? 'parameter' : 'internal', value: m[6].slice(1, -1) };
          if (isParam) warnOnce(`decl:%${ename}`, 'parameter-entity-ignored', `Parameter entity "%${ename};" is ignored.`, subsetStart + m.index);
        }
        info.entities.push(decl);
        if (!isParam && !declaredEntities.has(ename)) declaredEntities.set(ename, decl);
      }
      j = skipWs(k + 1);
    }
    if (src[j] !== '>') fail('bad-doctype', 'Malformed DOCTYPE: expected ">".', j);
    doctype = info;
    return j + 1;
  };

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      addText(i, n);
      break;
    }
    if (lt > i) addText(i, lt);
    i = lt;

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end === -1) fail('unclosed-comment', 'Comment is never closed with "-->".', i);
      if (stack.length) stack[stack.length - 1].children.push({ type: 'comment', value: src.slice(i + 4, end), pos: posAt(i) });
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      if (!stack.length) fail('cdata-outside-root', 'CDATA section outside the root element.', i);
      const end = src.indexOf(']]>', i + 9);
      if (end === -1) fail('unclosed-cdata', 'CDATA section is never closed with "]]>".', i);
      stack[stack.length - 1].children.push({ type: 'text', value: src.slice(i + 9, end), cdata: true, pos: posAt(i) });
      stats.textNodes++;
      i = end + 3;
    } else if (src.startsWith('<!DOCTYPE', i)) {
      if (root || stack.length) fail('misplaced-doctype', 'DOCTYPE must appear before the root element.', i);
      if (doctype) fail('duplicate-doctype', 'Only one DOCTYPE is allowed.', i);
      i = parseDoctype(i);
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end === -1) fail('unclosed-pi', 'Processing instruction is never closed with "?>".', i);
      const target = readName(i + 2) ?? fail('bad-pi', 'Processing instruction without a target name.', i + 2);
      const data = src.slice(i + 2 + target.length, end).trim();
      if (target.toLowerCase() === 'xml') {
        const declStart = src.charCodeAt(0) === 0xfeff ? 1 : 0;
        if (target !== 'xml' || i !== declStart) {
          fail('misplaced-xml-decl', 'The XML declaration (<?xml ... ?>) must be the very first thing in the file.', i,
            'Remove any blank lines, spaces or other content before "<?xml".');
        }
        const attr = (k: string) => new RegExp(`${k}\\s*=\\s*["']([^"']*)["']`).exec(data)?.[1];
        xmlDecl = { version: attr('version') ?? '1.0', encoding: attr('encoding'), standalone: attr('standalone') };
      } else if (stack.length) {
        stack[stack.length - 1].children.push({ type: 'pi', target, data, pos: posAt(i) });
      }
      i = end + 2;
    } else if (src.startsWith('</', i)) {
      const name = readName(i + 2) ?? fail('bad-end-tag', 'Malformed closing tag.', i);
      let j = skipWs(i + 2 + name.length);
      if (src[j] !== '>') fail('bad-end-tag', `Malformed closing tag </${name}: expected ">".`, j);
      const open = stack.pop();
      if (!open) fail('unexpected-end-tag', `Closing tag </${name}> has no matching opening tag.`, i);
      if (open!.name !== name) {
        fail('mismatched-tag', `Closing tag </${name}> does not match the open element <${open!.name}> (opened at line ${open!.pos.line}, column ${open!.pos.col}).`, i,
          `Either close <${open!.name}> first or fix the tag name.`);
      }
      nsStack.pop();
      open!.endOffset = j + 1;
      i = j + 1;
    } else {
      const name = readName(i + 1);
      if (!name) fail('bad-start-tag', "Unexpected '<'. Element names must start with a letter or underscore.", i,
        'If this is a literal "<" in text, write it as &lt;.');
      if (root && stack.length === 0) fail('multiple-roots', `A second root element <${name}> was found. XML allows only one root element.`, i);
      let j = i + 1 + name!.length;
      const rawAttrs: Array<{ name: string; value: string; offset: number }> = [];
      const seen = new Set<string>();
      let selfClosing = false;
      for (;;) {
        const before = j;
        j = skipWs(j);
        if (j >= n) fail('unclosed-start-tag', `Start tag <${name}> is never closed with ">".`, i);
        const c = src[j];
        if (c === '>') { j++; break; }
        if (c === '/' && src[j + 1] === '>') { selfClosing = true; j += 2; break; }
        if (j === before) fail('missing-whitespace', `Attributes in <${name}> must be separated by whitespace.`, j);
        const an = readName(j) ?? fail('bad-attribute', `Invalid character "${c}" in tag <${name}>.`, j);
        const aOffset = j;
        j = skipWs(j + an.length);
        if (src[j] !== '=') fail('attribute-without-value', `Attribute "${an}" in <${name}> has no value.`, aOffset, 'XML requires every attribute to have a quoted value, e.g. hidden="true".');
        j = skipWs(j + 1);
        const q = src[j];
        if (q !== '"' && q !== "'") fail('unquoted-attribute', `The value of attribute "${an}" must be in quotes.`, j);
        const end = src.indexOf(q, j + 1);
        if (end === -1) fail('unclosed-attribute', `The value of attribute "${an}" is never closed.`, j);
        const rawValue = src.slice(j + 1, end);
        const ltAt = rawValue.indexOf('<');
        if (ltAt !== -1) fail('lt-in-attribute', `"<" is not allowed inside the value of attribute "${an}".`, j + 1 + ltAt, 'Write it as &lt;.');
        if (seen.has(an)) fail('duplicate-attribute', `Attribute "${an}" appears twice in <${name}>.`, aOffset);
        seen.add(an);
        const value = decodeEntities(rawValue, j + 1).replace(/[\t\n]/g, ' ');
        rawAttrs.push({ name: an, value, offset: aOffset });
        j = end + 1;
      }

      const parentScope = nsStack[nsStack.length - 1];
      let scope = parentScope;
      for (const a of rawAttrs) {
        if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) {
          if (scope === parentScope) scope = new Map(parentScope);
          scope.set(a.name === 'xmlns' ? '' : a.name.slice(6), a.value);
        }
      }
      const split = (q: string) => {
        const c = q.indexOf(':');
        return c > 0 ? [q.slice(0, c), q.slice(c + 1)] : ['', q];
      };
      const [prefix, local] = split(name!);
      const parent = stack.length ? stack[stack.length - 1] : null;
      let index = 1;
      if (parent) {
        let counts = siblingCounts.get(parent);
        if (!counts) siblingCounts.set(parent, (counts = new Map()));
        index = (counts.get(name!) ?? 0) + 1;
        counts.set(name!, index);
      }
      const el: XmlElement = {
        type: 'element',
        name: name!,
        prefix,
        local,
        ns: resolvePrefix(prefix, scope, i, false),
        attrs: [],
        children: [],
        parent,
        index,
        sameNameCount: 1,
        depth: stack.length,
        pos: posAt(i),
        endOffset: j,
        selfClosing,
      };
      for (const a of rawAttrs) {
        const [ap, al] = a.name === 'xmlns' ? ['xmlns', ''] : split(a.name);
        const attr: XmlAttr = {
          name: a.name,
          prefix: ap,
          local: al,
          ns: ap === 'xmlns' ? NS.xmlns : resolvePrefix(ap, scope, a.offset, true),
          value: a.value,
          pos: posAt(a.offset),
        };
        el.attrs.push(attr);
      }
      stats.elements++;
      stats.attributes += el.attrs.length;
      if (el.depth + 1 > stats.maxDepth) stats.maxDepth = el.depth + 1;
      if (el.depth >= maxDepth) fail('too-deep', `Elements are nested more than ${maxDepth} levels deep.`, i);
      if (parent) parent.children.push(el);
      else root = el;
      if (!selfClosing) {
        stack.push(el);
        nsStack.push(scope);
      }
      i = j;
    }
  }

  if (stack.length) {
    const open = stack[stack.length - 1];
    fail('unclosed-element', `Element <${open.name}> (opened at line ${open.pos.line}, column ${open.pos.col}) is never closed.`, n,
      `Add </${open.name}> or make it self-closing with "/>".`);
  }
  for (const [parent, counts] of siblingCounts) {
    for (const c of parent.children) if (c.type === 'element') c.sameNameCount = counts.get(c.name) ?? 1;
  }
  if (!root) fail('no-root', 'No root element was found. The input does not contain any XML elements.', i);

  return { root: root!, xmlDecl, doctype, warnings, stats, source: src };
}
