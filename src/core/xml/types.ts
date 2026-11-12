/** Position of a node in the (line-ending normalised) XML source. Lines and columns are 1-based. */
export interface SourcePos {
  line: number;
  col: number;
  offset: number;
}

export interface XmlAttr {
  name: string;
  prefix: string;
  local: string;
  /** Resolved namespace URI ('' when the attribute is unprefixed). */
  ns: string;
  value: string;
  pos: SourcePos;
}

export interface XmlElement {
  type: 'element';
  name: string;
  prefix: string;
  local: string;
  ns: string;
  attrs: XmlAttr[];
  children: XmlNode[];
  parent: XmlElement | null;
  /** 1-based index among siblings with the same qualified name (for element paths). */
  index: number;
  /** Number of siblings (including this element) sharing its qualified name. */
  sameNameCount: number;
  depth: number;
  pos: SourcePos;
  /** Offset just after the closing tag. */
  endOffset: number;
  selfClosing: boolean;
}

export interface XmlText {
  type: 'text';
  value: string;
  cdata: boolean;
  pos: SourcePos;
}

export interface XmlComment {
  type: 'comment';
  value: string;
  pos: SourcePos;
}

export interface XmlPI {
  type: 'pi';
  target: string;
  data: string;
  pos: SourcePos;
}

export type XmlNode = XmlElement | XmlText | XmlComment | XmlPI;

export interface EntityDecl {
  name: string;
  kind: 'internal' | 'external' | 'parameter';
  value?: string;
  systemId?: string;
}

export interface DoctypeInfo {
  name: string;
  publicId?: string;
  systemId?: string;
  entities: EntityDecl[];
  pos: SourcePos;
}

export interface XmlWarning {
  code: string;
  message: string;
  pos?: SourcePos;
}

export interface XmlStats {
  elements: number;
  attributes: number;
  textNodes: number;
  maxDepth: number;
  characters: number;
}

export interface XmlDocument {
  root: XmlElement;
  xmlDecl?: { version: string; encoding?: string; standalone?: string };
  doctype?: DoctypeInfo;
  warnings: XmlWarning[];
  stats: XmlStats;
  /** The line-ending normalised source the positions refer to. */
  source: string;
}

export class XmlParseError extends Error {
  readonly code: string;
  readonly pos: SourcePos;
  readonly hint?: string;
  constructor(code: string, message: string, pos: SourcePos, hint?: string) {
    super(message);
    this.name = 'XmlParseError';
    this.code = code;
    this.pos = pos;
    this.hint = hint;
  }
}

export const NS = {
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
  svg: 'http://www.w3.org/2000/svg',
  xlink: 'http://www.w3.org/1999/xlink',
  fb2: 'http://www.gribuser.ru/xml/fictionbook/2.0',
  android: 'http://schemas.android.com/apk/res/android',
  androidAuto: 'http://schemas.android.com/apk/res-auto',
  drawingml: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  officeRel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  pkgRel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  vml: 'urn:schemas-microsoft-com:vml',
} as const;
