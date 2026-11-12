import { useMemo, useState } from 'react';
import { formatBytes } from '../../core/assets/resolver';
import type { AssetVM } from '../useAssets';
import { Badge, Button, Empty, Icon, STATUS_LABEL, STATUS_TONE } from './ui';

type Filter = 'all' | 'resolved' | 'problems' | 'remote';

export function AssetsView({ assets, selectedId, onSelect, onLoadRemote }: { assets: AssetVM[]; selectedId?: string; onSelect: (id: string) => void; onLoadRemote: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const counts = useMemo(() => ({
    all: assets.length,
    resolved: assets.filter((a) => a.status === 'resolved').length,
    problems: assets.filter((a) => a.status === 'missing' || a.status === 'invalid' || a.status === 'unsupported').length,
    remote: assets.filter((a) => a.status === 'remote').length,
  }), [assets]);
  const shown = assets.filter((a) => {
    if (filter === 'resolved' && a.status !== 'resolved') return false;
    if (filter === 'problems' && !(a.status === 'missing' || a.status === 'invalid' || a.status === 'unsupported')) return false;
    if (filter === 'remote' && a.status !== 'remote') return false;
    const q = query.trim().toLowerCase();
    return !q || a.name.toLowerCase().includes(q) || a.location.toLowerCase().includes(q) || a.rawReference.toLowerCase().includes(q);
  });
  const remotePending = assets.some((a) => a.status === 'remote' && a.remoteState === 'idle');
  const remoteLoading = assets.some((a) => a.remoteState === 'loading');

  if (!assets.length) {
    return (
      <Empty icon="image" title="No images detected">
        No element in this file references an image according to its format, and no attribute or text value is an embedded image or a path to an image file.
      </Empty>
    );
  }

  const tabs: Array<[Filter, string]> = [['all', 'All'], ['resolved', 'Resolved'], ['problems', 'Problems'], ['remote', 'Remote']];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="flex rounded-md border border-line bg-raised p-0.5" role="tablist" aria-label="Filter assets">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${filter === k ? 'bg-panel text-fg shadow-sm ring-1 ring-line-strong dark:bg-hover' : 'text-muted hover:text-fg'}`}>
              {label} <span className="ml-0.5 text-subtle">{counts[k]}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-subtle" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or path" aria-label="Filter assets by name or path"
            className="h-8 w-56 rounded-md border border-line bg-raised pl-7 pr-2 text-xs text-fg placeholder:text-subtle focus:border-accent focus:outline-none" />
        </label>
        {(remotePending || remoteLoading) && (
          <Button size="sm" icon={remoteLoading ? 'spinner' : 'globe'} onClick={onLoadRemote} disabled={remoteLoading} title="Contacts the servers that host these images">
            {remoteLoading ? 'Loading remote images…' : `Load ${counts.remote} remote image${counts.remote === 1 ? '' : 's'}`}
          </Button>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-4">
        {shown.length === 0 ? (
          <Empty icon="search" title="Nothing matches">Try another filter or search term.</Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {shown.map((a) => (
              <button key={a.id} onClick={() => onSelect(a.id)} data-asset={a.name}
                className={`group flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${selectedId === a.id ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong'} bg-panel`}>
                <div className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden ${a.display === 'ok' ? 'checker' : 'bg-raised'}`}>
                  {a.display === 'ok' && (a.thumbUrl || a.objectUrl) ? (
                    <img src={a.thumbUrl ?? a.objectUrl} alt={a.name} className="max-h-full max-w-full object-contain" draggable={false} referrerPolicy="no-referrer" />
                  ) : a.display === 'pending' ? (
                    <Icon name="spinner" className="text-subtle" />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 px-4 text-center">
                      <Icon name={a.status === 'remote' ? 'globe' : a.status === 'unsupported' ? 'alert' : 'x'} size={22} className={a.status === 'remote' ? 'text-info' : a.status === 'unsupported' ? 'text-warn' : 'text-err'} />
                      <span className="text-[11px] font-medium text-muted">{a.status === 'remote' ? (a.remoteState === 'loading' ? 'Loading…' : 'Not loaded') : 'Not displayed'}</span>
                    </div>
                  )}
                  <div className="absolute left-2 top-2 z-10"><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge></div>
                  {a.warnings.length > 0 && a.status === 'resolved' && <div className="absolute right-2 top-2 z-10" title={a.warnings.join('\n')}><Badge tone="warn"><Icon name="alert" size={11} /> {a.warnings.length}</Badge></div>}
                </div>
                <div className="flex min-w-0 flex-col gap-0.5 border-t border-line px-3 py-2">
                  <div className="truncate text-[13px] font-medium text-fg" title={a.name}>{a.name}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-subtle">
                    {a.width && a.height ? <span>{a.width} × {a.height}</span> : null}
                    {a.format && <span className="uppercase">{a.format}</span>}
                    {a.byteLength ? <span>{formatBytes(a.byteLength)}</span> : null}
                    {a.usages.length > 1 && <span>· used {a.usages.length}×</span>}
                  </div>
                  {a.status !== 'resolved' && a.reason && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{a.reason}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
