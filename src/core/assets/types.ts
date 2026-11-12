import type { ImageFormat } from './sniff';

export type ReferenceKind =
  | 'data-uri' // data:image/...;base64,...
  | 'base64' // raw Base64 text embedded in the XML
  | 'path' // relative/absolute path written in the XML (relative to the XML file)
  | 'project-path' // path already resolved relative to the project root (e.g. via OOXML relationships)
  | 'url' // http(s) URL
  | 'android-resource' // @drawable/name, @mipmap/name
  | 'unresolvable'; // reference the adapter already knows cannot be resolved (reason attached)

/** Where in the source XML an asset is referenced. */
export interface AssetUsage {
  line: number;
  col: number;
  elementPath: string;
  elementName: string;
  attribute?: string;
  declaredWidth?: number;
  declaredHeight?: number;
}

export interface AssetReference {
  /** References with the same key are the same asset. */
  key: string;
  kind: ReferenceKind;
  value: string;
  /** Short human label for the reference (file name, binary id, …). */
  label: string;
  adapter: string;
  /** 'schema' = the format's specification defines this as an image; 'content' = inferred from the value itself. */
  confidence: 'schema' | 'content';
  evidence: string;
  declaredMime?: string;
  usage: AssetUsage;
  /** Only for kind 'unresolvable'. */
  failure?: { status: AssetStatus; reason: string };
}

export type AssetStatus = 'resolved' | 'missing' | 'remote' | 'invalid' | 'unsupported';

export interface ResolvedAsset {
  id: string;
  key: string;
  name: string;
  kind: ReferenceKind;
  status: AssetStatus;
  /** Why the asset is not resolved (or a caveat about how it was resolved). */
  reason?: string;
  /** How it was resolved, in plain words. */
  method?: string;
  /** Where the bytes came from: a project path, a URL or "Embedded Base64". */
  location: string;
  filePath?: string;
  url?: string;
  format?: ImageFormat;
  mime?: string;
  width?: number;
  height?: number;
  byteLength?: number;
  sha256?: string;
  bytes?: ArrayBuffer;
  warnings: string[];
  usages: AssetUsage[];
  adapter: string;
  confidence: 'schema' | 'content';
  evidence: string;
  rawReference: string;
}
