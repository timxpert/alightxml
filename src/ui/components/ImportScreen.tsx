import { useState } from 'react';
import { Button, Icon } from './ui';

export const SAMPLES: Array<{ file: string; title: string; detail: string }> = [
  { file: 'svg-poster.zip', title: 'SVG poster', detail: 'Folder with relative, Base64, absolute, missing and remote images; shapes, text, gradients, groups, animation' },
  { file: 'android-app.zip', title: 'Android project', detail: '@drawable / @mipmap resources across density folders' },
  { file: 'site-report.docx', title: 'Word document', detail: 'Images reached through OOXML relationships' },
  { file: 'lighthouse.fb2', title: 'FB2 e-book', detail: 'Base64 <binary> images, one missing' },
  { file: 'catalog.zip', title: 'Unknown schema', detail: 'Images detected from values only, never from element names' },
  { file: 'real-export-5.0.273.xml', title: 'Alight Motion export', detail: 'A real project XML from Alight Motion 5.0.273 (image stored on the phone)' },
  { file: 'unclosed-tag.xml', title: 'Broken XML', detail: 'Shows a located parse error' },
];

export function ImportScreen({ onPickFile, onPickFolder, onPickZip, onPaste, onSample, busy }: {
  onPickFile: () => void;
  onPickFolder: () => void;
  onPickZip: () => void;
  onPaste: () => void;
  onSample: (file: string) => void;
  busy: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div className="scroll-thin h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-14">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">From XML to Visual</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Open a design file to see what is inside it</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">XML Canvas reads the XML locally in your browser, finds every image it references, shows exactly which ones resolve, and converts SVG designs into Alight Motion scene XML.</p>
        </div>
        <div
          onDragEnter={() => setHover(true)} onDragLeave={() => setHover(false)} onDrop={() => setHover(false)}
          className={`flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${hover ? 'border-accent bg-accent-soft' : 'border-line-strong bg-panel'}`}>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon name={busy ? 'spinner' : 'import'} size={22} /></div>
          <div>
            <div className="text-sm font-medium text-fg">Drop an XML file, a folder or a ZIP here</div>
            <div className="mt-1 text-xs text-muted">Images referenced by relative paths can only be shown when their folder or ZIP is imported too.</div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon="file" onClick={onPickFile} disabled={busy}>Open file</Button>
            <Button icon="folder" onClick={onPickFolder} disabled={busy}>Open folder</Button>
            <Button icon="zip" onClick={onPickZip} disabled={busy}>Open ZIP</Button>
            <Button icon="paste" onClick={onPaste} disabled={busy}>Paste XML</Button>
          </div>
        </div>
        <div>
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">Try a sample</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SAMPLES.map((s) => (
              <button key={s.file} onClick={() => onSample(s.file)} disabled={busy} data-sample={s.file}
                className="flex flex-col gap-0.5 rounded-lg border border-line bg-panel px-3.5 py-3 text-left transition-colors hover:border-line-strong hover:bg-raised disabled:opacity-50">
                <span className="text-[13px] font-medium text-fg">{s.title}</span>
                <span className="text-xs leading-snug text-muted">{s.detail}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs leading-relaxed text-subtle">Nothing is uploaded: files are processed on this device. External entities are never resolved, scripts never run, and remote images load only when you allow it.</div>
      </div>
    </div>
  );
}

export function PasteDialog({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" role="dialog" aria-modal="true" aria-label="Paste XML" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-sm font-semibold">Paste XML</div>
          <button aria-label="Close" onClick={onCancel} className="rounded p-1 text-muted hover:bg-hover hover:text-fg"><Icon name="close" /></button>
        </div>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder="<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; …"
          className="h-80 resize-none bg-raised p-4 font-mono text-xs text-fg placeholder:text-subtle focus:outline-none" />
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <span className="text-xs text-muted">Pasted XML has no folder, so only embedded or online images can be resolved.</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" disabled={!text.trim()} onClick={() => onSubmit(text)}>Analyze</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
