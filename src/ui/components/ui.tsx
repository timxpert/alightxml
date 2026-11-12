import type { ButtonHTMLAttributes, ReactNode } from 'react';

const ICONS: Record<string, string> = {
  import: 'M12 3v12m0 0-4-4m4 4 4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2',
  export: 'M12 15V3m0 0L8 7m4-4 4 4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  zip: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M11 6h1M11 9h1M11 12h1M10.5 15h2v3h-2z',
  paste: 'M9 4h6M9 4a1 1 0 0 0-1 1v1h8V5a1 1 0 0 0-1-1M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  close: 'M6 6l12 12M18 6 6 18',
  image: 'M4 5h16v14H4zM4 16l4-4 3 3 4-5 5 6M9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
  layers: 'm12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5',
  tree: 'M4 5h6M4 5v14m0-7h8m-8 7h8M14 5h6M16 12h4M16 19h4',
  code: 'm8 8-4 4 4 4m8-8 4 4-4 4M13 5l-2 14',
  canvas: 'M4 4h16v16H4zM4 9h16M9 9v11',
  search: 'm20 20-4.2-4.2M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V5a1 1 0 0 1 1-1h4m6 0h4a1 1 0 0 1 1 1v4m0 6v4a1 1 0 0 1-1 1h-4m-6 0H5a1 1 0 0 1-1-1v-4',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  check: 'm5 12 5 5 9-10',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  x: 'M15 9l-6 6m0-6 6 6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M4 20h16',
  rect: 'M4 6h16v12H4z',
  circle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  path: 'M4 18c4-10 8 4 12-6 1-2 2-4 4-5',
  text: 'M5 6V4h14v2M12 4v16m-3 0h6',
  group: 'M4 4h7v7H4zM13 13h7v7h-7zM13 4h7v7h-7zM4 13h7v7H4z',
  motion: 'M5 3v18l15-9z',
  copy: 'M9 9h10v12H9zM5 15H4V3h12v1',
  external: 'M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  spinner: 'M12 3a9 9 0 1 0 9 9',
};

export function Icon({ name, size = 16, className = '', strokeWidth = 1.75 }: { name: keyof typeof ICONS | string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${name === 'spinner' ? 'xc-spin ' : ''}${className}`} aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.info} />
    </svg>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border border-transparent shadow-sm',
  secondary: 'bg-raised text-fg hover:bg-hover border border-line',
  ghost: 'text-muted hover:text-fg hover:bg-hover border border-transparent',
  danger: 'bg-raised text-err hover:bg-hover border border-line',
};

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: string; children?: ReactNode }) {
  const sz = size === 'sm' ? 'h-7 px-2 text-xs gap-1.5' : 'h-8 px-3 text-[13px] gap-2';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 ${sz} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, active, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg hover:bg-hover'} ${className}`}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neutral' | 'accent';
const TONES: Record<Tone, string> = {
  ok: 'text-ok bg-ok/10 border-ok/25',
  warn: 'text-warn bg-warn/10 border-warn/25',
  err: 'text-err bg-err/10 border-err/25',
  info: 'text-info bg-info/10 border-info/25',
  neutral: 'text-muted bg-hover border-line',
  accent: 'text-accent bg-accent-soft border-accent/25',
};

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium leading-4 whitespace-nowrap ${TONES[tone]} ${className}`}>{children}</span>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-4 pb-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{children}</h3>
      {right}
    </div>
  );
}

export function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 px-3 py-1 text-xs">
      <div className="text-subtle">{label}</div>
      <div className={`min-w-0 break-words text-fg ${mono ? 'font-mono text-[11px]' : ''}`}>{children}</div>
    </div>
  );
}

export function Empty({ icon = 'info', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-hover text-subtle"><Icon name={icon} size={18} /></div>
      <div className="text-sm font-medium text-fg">{title}</div>
      {children && <div className="max-w-sm text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export const STATUS_TONE: Record<string, Tone> = { resolved: 'ok', missing: 'err', invalid: 'err', unsupported: 'warn', remote: 'info' };
export const STATUS_LABEL: Record<string, string> = { resolved: 'Resolved', missing: 'Missing', invalid: 'Not an image', unsupported: 'Unsupported', remote: 'Remote' };
