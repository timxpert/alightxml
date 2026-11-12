import type { XmlElement, XmlNode } from './types';

/** Depth-first, document-order iteration over all elements (iterative, safe for deep trees). */
export function* walkElements(root: XmlElement): Generator<XmlElement> {
  const stack: XmlElement[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    yield el;
    for (let k = el.children.length - 1; k >= 0; k--) {
      const c = el.children[k];
      if (c.type === 'element') stack.push(c);
    }
  }
}

export function childElements(el: XmlElement): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.type === 'element');
}

/** Attribute lookup by local name and namespace. `ns === undefined` matches any namespace. */
export function getAttr(el: XmlElement, local: string, ns?: string): string | undefined {
  for (const a of el.attrs) if (a.local === local && (ns === undefined || a.ns === ns)) return a.value;
  return undefined;
}

export function getAttrNode(el: XmlElement, local: string, ns?: string) {
  return el.attrs.find((a) => a.local === local && (ns === undefined || a.ns === ns));
}

/** XPath-like location such as /svg/g[2]/image[1]. */
export function elementPath(el: XmlElement): string {
  const parts: string[] = [];
  let cur: XmlElement | null = el;
  while (cur) {
    parts.push(cur.sameNameCount > 1 ? `${cur.name}[${cur.index}]` : cur.name);
    cur = cur.parent;
  }
  return '/' + parts.reverse().join('/');
}

/** Concatenated text of all descendant text nodes. */
export function textContent(node: XmlNode): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  let out = '';
  const stack: XmlNode[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.type === 'text') out += cur.value;
    else if (cur.type === 'element') for (let k = cur.children.length - 1; k >= 0; k--) stack.push(cur.children[k]);
  }
  return out;
}

/** Text if the element contains only text/CDATA (no child elements), otherwise undefined. */
export function leafText(el: XmlElement): string | undefined {
  if (el.children.length === 0) return undefined;
  let out = '';
  for (const c of el.children) {
    if (c.type === 'element') return undefined;
    if (c.type === 'text') out += c.value;
  }
  return out;
}
