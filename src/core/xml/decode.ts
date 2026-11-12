/** Turns raw XML bytes into text, honouring BOMs and the encoding declared in the XML declaration. */
export interface DecodedXml {
  text: string;
  encoding: string;
  warnings: string[];
}

export function decodeXmlBytes(bytes: Uint8Array): DecodedXml {
  const warnings: string[] = [];
  const b = bytes;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8 (BOM)', warnings };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16LE (BOM)', warnings };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16BE (BOM)', warnings };
  if (b[0] === 0x3c && b[1] === 0x00 && b[2] === 0x3f && b[3] === 0x00) return { text: new TextDecoder('utf-16le').decode(b), encoding: 'UTF-16LE', warnings };
  if (b[0] === 0x00 && b[1] === 0x3c && b[2] === 0x00 && b[3] === 0x3f) return { text: new TextDecoder('utf-16be').decode(b), encoding: 'UTF-16BE', warnings };

  let head = '';
  for (let k = 0; k < Math.min(b.length, 1024); k++) head += String.fromCharCode(b[k]);
  const declared = /^\s*<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._\-]+)["']/.exec(head)?.[1];
  let label = 'utf-8';
  if (declared) {
    try {
      new TextDecoder(declared);
      label = declared;
    } catch {
      warnings.push(`The file declares encoding "${declared}", which this browser cannot decode. It was read as UTF-8 instead.`);
    }
  }
  try {
    return { text: new TextDecoder(label, { fatal: true }).decode(b), encoding: (declared && label === declared ? declared : 'UTF-8').toUpperCase(), warnings };
  } catch {
    warnings.push(`The file is not valid ${label.toUpperCase()}. It was read as Windows-1252, so some characters may look wrong.`);
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'WINDOWS-1252 (fallback)', warnings };
  }
}
