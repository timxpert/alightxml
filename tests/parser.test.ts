import { describe, expect, it } from 'vitest';
import { parseXml } from '../src/core/xml/parser';
import { decodeXmlBytes } from '../src/core/xml/decode';
import { elementPath, getAttr, walkElements } from '../src/core/xml/query';
import { NS, XmlParseError } from '../src/core/xml/types';

function expectError(xml: string, code: string, line?: number, col?: number) {
  try {
    parseXml(xml);
  } catch (e) {
    expect(e).toBeInstanceOf(XmlParseError);
    const err = e as XmlParseError;
    expect(err.code).toBe(code);
    if (line !== undefined) expect(err.pos.line).toBe(line);
    if (col !== undefined) expect(err.pos.col).toBe(col);
    return err;
  }
  throw new Error(`Expected parse error ${code}`);
}

describe('parseXml: structure', () => {
  it('parses elements, attributes, text, CDATA and positions', () => {
    const doc = parseXml('<?xml version="1.0"?>\n<a x="1">\n  <b y=\'two\'>hi &amp; bye</b>\n  <c><![CDATA[<raw>]]></c>\n</a>');
    expect(doc.root.name).toBe('a');
    expect(getAttr(doc.root, 'x')).toBe('1');
    const els = [...walkElements(doc.root)];
    expect(els.map((e) => e.name)).toEqual(['a', 'b', 'c']);
    const b = els[1];
    expect(b.pos).toMatchObject({ line: 3, col: 3 });
    expect((b.children[0] as { value: string }).value).toBe('hi & bye');
    expect((els[2].children[0] as { value: string; cdata: boolean }).cdata).toBe(true);
    expect(doc.stats.elements).toBe(3);
    expect(doc.xmlDecl?.version).toBe('1.0');
  });

  it('resolves namespaces with scoping and default namespaces', () => {
    const doc = parseXml('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="a.png" href="b.png"/><g xmlns="urn:other"><x/></g></svg>');
    const [svg, image, g, x] = [...walkElements(doc.root)];
    expect(svg.ns).toBe(NS.svg);
    expect(image.ns).toBe(NS.svg);
    expect(getAttr(image, 'href', NS.xlink)).toBe('a.png');
    expect(getAttr(image, 'href', '')).toBe('b.png');
    expect(g.ns).toBe('urn:other');
    expect(x.ns).toBe('urn:other');
  });

  it('builds element paths with sibling indexes', () => {
    const doc = parseXml('<r><g/><g><i/><i/></g></r>');
    const els = [...walkElements(doc.root)];
    expect(elementPath(els[4])).toBe('/r/g[2]/i[2]');
    expect(elementPath(els[1])).toBe('/r/g[1]');
  });

  it('decodes numeric character references and normalises CRLF', () => {
    const doc = parseXml('<a t="&#x41;&#66;">\r\nx</a>');
    expect(getAttr(doc.root, 't')).toBe('AB');
    expect(doc.source.includes('\r')).toBe(false);
  });

  it('stays linear for very wide documents (element paths, sibling indexes)', () => {
    const xml = '<r>' + '<g/>'.repeat(100_000) + '</r>';
    const t = performance.now();
    const doc = parseXml(xml);
    const els = [...walkElements(doc.root)];
    for (const el of els) elementPath(el);
    expect(elementPath(els[els.length - 1])).toBe('/r/g[100000]');
    expect(performance.now() - t).toBeLessThan(3000);
  });

  it('handles deep nesting iteratively', () => {
    const depth = 900;
    const xml = '<a>'.repeat(depth) + '</a>'.repeat(depth);
    expect(parseXml(xml).stats.maxDepth).toBe(depth);
    expectError('<a>'.repeat(2000) + '</a>'.repeat(2000), 'too-deep');
  });
});

describe('parseXml: errors carry useful positions', () => {
  it('mismatched tag', () => {
    const err = expectError('<a>\n  <b></c>\n</a>', 'mismatched-tag', 2, 6);
    expect(err.message).toContain('<b>');
  });
  it('unclosed element reports where it was opened', () => {
    const err = expectError('<a>\n<b>\n</a>', 'mismatched-tag');
    expect(err.message).toContain('line 2');
    expectError('<a><b></b>', 'unclosed-element');
  });
  it('unescaped ampersand', () => expectError('<a href="x?a=1&b=2"/>', 'unescaped-ampersand', 1, 15));
  it('undefined entity', () => expectError('<a>&nbsp;</a>', 'undefined-entity'));
  it('duplicate attribute', () => expectError('<a x="1" x="2"/>', 'duplicate-attribute'));
  it('multiple roots', () => expectError('<a/><b/>', 'multiple-roots'));
  it('empty input', () => expectError('   ', 'no-root'));
  it('unquoted attribute', () => expectError('<a x=1/>', 'unquoted-attribute'));
  it('misplaced xml declaration', () => expectError('\n<?xml version="1.0"?><a/>', 'misplaced-xml-decl'));
  it('text after root', () => expectError('<a/>oops', 'content-after-root'));
});

describe('parseXml: security', () => {
  it('never resolves external entities (XXE)', () => {
    const xml = '<?xml version="1.0"?>\n<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<r>&xxe;</r>';
    const doc = parseXml(xml);
    expect((doc.root.children[0] as { value: string }).value).toBe('&xxe;');
    expect(doc.warnings.some((w) => w.code === 'external-entity-blocked')).toBe(true);
    expect(doc.doctype?.entities[0]).toMatchObject({ name: 'xxe', kind: 'external', systemId: 'file:///etc/passwd' });
  });

  it('never expands internal entities (billion laughs)', () => {
    const xml = '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
    const doc = parseXml(xml);
    expect((doc.root.children[0] as { value: string }).value).toBe('&lol2;');
    expect(doc.warnings.some((w) => w.code === 'entity-not-expanded')).toBe(true);
  });

  it('ignores external DTDs', () => {
    const doc = parseXml('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>');
    expect(doc.warnings[0].code).toBe('external-dtd-ignored');
  });
});

describe('decodeXmlBytes', () => {
  it('honours BOMs and declared encodings', () => {
    expect(decodeXmlBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e])).text).toBe('<a/>');
    const latin1 = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><a>'), 0xe9, ...new TextEncoder().encode('</a>')]);
    expect(decodeXmlBytes(latin1).text).toContain('é');
    const utf16 = new Uint8Array([0xff, 0xfe, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e, 0]);
    expect(decodeXmlBytes(utf16).text).toBe('<a/>');
  });
  it('falls back with a warning on invalid UTF-8', () => {
    const r = decodeXmlBytes(new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e]));
    expect(r.warnings.length).toBe(1);
  });
});
