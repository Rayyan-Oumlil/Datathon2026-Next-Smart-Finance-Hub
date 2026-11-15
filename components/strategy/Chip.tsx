'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatNumber, formatPercent } from '@/i18n/format';
import { api } from '@/components/portfolio/logic';
import { LIMITS, type AllocationTarget } from '@/lib/strategy/types';

export const FIELD = 'h-9 w-full rounded-[9px] border border-line bg-card px-2.5 text-[14px] text-foreground outline-none placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/30';

/**
 * One value inside a rule sentence. Read-only: emphasised text. Editable: a button that opens a small popover with
 * the editor; `editor` receives a `close` callback to call once the value is applied.
 */
export function Chip({ label, children, editor, invalid }: { label: string; children: ReactNode; editor?: (close: () => void) => ReactNode; invalid?: boolean }) {
    const t = useTranslations('Strategy');
    const [open, setOpen] = useState(false);
    if (!editor) return <span className="rounded-[6px] bg-hover px-1 py-px font-semibold text-foreground">{children}</span>;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {/* A span, not a button: a button cannot wrap across lines inside a sentence */}
                <span
                    role="button"
                    tabIndex={0}
                    aria-label={t('chip.edit', { label })}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true); } }}
                    className={`cursor-pointer rounded-[6px] px-1 py-px font-semibold underline decoration-dotted decoration-1 underline-offset-4 outline-none transition-colors [box-decoration-break:clone] focus-visible:ring-2 focus-visible:ring-ring/40 ${invalid ? 'bg-down-soft text-down' : 'bg-brand-soft text-brand-ink hover:bg-brand-soft/70'}`}
                >
                    {children}
                </span>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] rounded-[12px] border-line bg-card p-3 text-foreground">
                <p className="form-label mb-2">{label}</p>
                {editor(() => setOpen(false))}
            </PopoverContent>
        </Popover>
    );
}

/** A number inside a LIMITS range; applied on Enter or with the button. */
export function NumberEditor({ value, min, max, step = 'any', integer, onApply }: { value: number; min: number; max: number; step?: string; integer?: boolean; onApply: (value: number) => void }) {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    const [text, setText] = useState(String(value));
    const n = Number(text);
    const ok = text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
    return (
        <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (ok) onApply(n); }}>
            <input autoFocus className={FIELD} type="number" inputMode="decimal" min={min} max={max} step={integer ? 1 : step} value={text} onChange={(event) => setText(event.target.value)} aria-invalid={!ok} />
            <p className={`text-[12px] ${ok ? 'text-faint' : 'text-down'}`}>{ok ? '' : `${t('chip.outOfRange')} `}{t('chip.range', { min: formatNumber(min, locale), max: formatNumber(max, locale) })}</p>
            <button type="submit" className="btn btn-primary h-8 text-[13px]" disabled={!ok}>{t('chip.apply')}</button>
        </form>
    );
}

/** Any finite number (price thresholds have no fixed range); `check` returns false to refuse a value. */
export function FreeNumberEditor({ value, check, onApply }: { value: number; check: (value: number) => boolean; onApply: (value: number) => void }) {
    const t = useTranslations('Strategy');
    const [text, setText] = useState(String(value));
    const n = Number(text);
    const ok = text.trim() !== '' && Number.isFinite(n) && check(n);
    return (
        <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (ok) onApply(n); }}>
            <input autoFocus className={FIELD} type="number" inputMode="decimal" step="any" value={text} onChange={(event) => setText(event.target.value)} aria-invalid={!ok} />
            {!ok && <p className="text-[12px] text-down">{t('chip.outOfRange')}</p>}
            <button type="submit" className="btn btn-primary h-8 text-[13px]" disabled={!ok}>{t('chip.apply')}</button>
        </form>
    );
}

/** A choice among a few fixed options, applied on click. */
export function ChoiceEditor<T extends string>({ value, options, onApply }: { value: T; options: ReadonlyArray<readonly [T, string]>; onApply: (value: T) => void }) {
    return (
        <div role="radiogroup" className="grid gap-1.5">
            {options.map(([id, text]) => (
                <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onApply(id)} className={`btn btn-ghost h-9 justify-start px-3 text-[13px] ${value === id ? 'is-on' : ''}`}>{text}</button>
            ))}
        </div>
    );
}

type Entry = { symbol: string; name: string; assetClass: string };
// Gold and bond yields are reference values: no rule acts on them
const TRADABLE = new Set(['stock', 'etf', 'crypto']);

/** A symbol from the universe (GET /api/universe/search), with the portfolio's holdings offered first. */
export function SymbolEditor({ value, holdings, onApply }: { value?: string; holdings: string[]; onApply: (symbol: string) => void }) {
    const t = useTranslations('Strategy');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Entry[] | null>(null);

    useEffect(() => {
        const q = query.trim();
        if (!q) {
            setResults(null);
            return;
        }
        let stale = false;
        const timer = setTimeout(() => {
            api<{ entries: Entry[] }>(`/api/universe/search?q=${encodeURIComponent(q)}`)
                .then(({ entries }) => { if (!stale) setResults(entries.filter((entry) => TRADABLE.has(entry.assetClass))); })
                .catch(() => { if (!stale) setResults([]); });
        }, 200);
        return () => { stale = true; clearTimeout(timer); };
    }, [query]);

    return (
        <div className="grid gap-2">
            <input autoFocus className={FIELD} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('chip.search')} aria-label={t('chip.search')} autoComplete="off" />
            {results === null ? (
                holdings.length > 0 && (
                    <div className="grid gap-1">
                        <span className="text-[11.5px] text-faint">{t('chip.holdings')}</span>
                        <div className="flex flex-wrap gap-1">
                            {holdings.slice(0, 12).map((symbol) => (
                                <button key={symbol} type="button" className={`btn btn-ghost h-7 px-2 text-[12px] ${symbol === value ? 'is-on' : ''}`} onClick={() => onApply(symbol)}>{symbol}</button>
                            ))}
                        </div>
                    </div>
                )
            ) : results.length === 0 ? (
                <p className="text-[12.5px] text-faint">{t('chip.searchNone', { query: query.trim() })}</p>
            ) : (
                <ul className="row-list max-h-56 overflow-y-auto rounded-[9px] border border-line">
                    {results.slice(0, 8).map((entry) => (
                        <li key={entry.symbol}>
                            <button type="button" onClick={() => onApply(entry.symbol)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start outline-none hover:bg-hover focus-visible:bg-hover">
                                <span className="w-20 flex-none text-[13px] font-bold">{entry.symbol}</span>
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{entry.name}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** The target weights as a small table; symbols are added through the universe search. */
export function TargetsEditor({ value, current, holdings, onApply }: { value: AllocationTarget[]; current: AllocationTarget[]; holdings: string[]; onApply: (targets: AllocationTarget[]) => void }) {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    const [rows, setRows] = useState<Array<AllocationTarget & { text: string }>>(() => value.map((target) => ({ ...target, text: String(target.weightPct) })));
    const [adding, setAdding] = useState(false);
    const weights = rows.map((row) => Number(row.text));
    const rowOk = weights.map((w) => Number.isFinite(w) && w >= LIMITS.weightPct.min && w <= LIMITS.weightPct.max);
    const total = weights.reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0);
    const over = total > 100 + 1e-9;
    const ok = rows.length > 0 && rows.length <= LIMITS.targetsMax && rowOk.every(Boolean) && !over;
    const used = new Set(rows.flatMap((row) => ('symbol' in row ? [row.symbol] : row.symbols)));

    return (
        <div className="grid gap-2">
            <p className="text-[12px] text-faint">{t('chip.targetsHint')}</p>
            <div className="max-h-60 overflow-y-auto rounded-[9px] border border-line">
                <table className="w-full text-[13px]">
                    <thead>
                        <tr className="text-[11px] uppercase tracking-[0.06em] text-faint">
                            <th className="px-2 py-1.5 text-start font-bold">{t('chip.symbolCol')}</th>
                            <th className="px-2 py-1.5 text-end font-bold">{t('chip.weightCol')}</th>
                            <th className="w-8" />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => {
                            const name = 'symbol' in row ? row.symbol : row.group;
                            return (
                                <tr key={name} className="border-t border-line">
                                    <td className="px-2 py-1 font-semibold">{name}</td>
                                    <td className="px-2 py-1">
                                        <input
                                            className={`${FIELD} h-8 w-20 text-end num ${rowOk[i] ? '' : '!border-down'}`}
                                            type="number" inputMode="decimal" step="0.1" min={LIMITS.weightPct.min} max={LIMITS.weightPct.max}
                                            value={row.text} aria-label={`${t('chip.weightCol')} ${name}`}
                                            onChange={(event) => setRows(rows.map((r, j) => (j === i ? { ...r, text: event.target.value } : r)))}
                                        />
                                    </td>
                                    <td className="px-1">
                                        <button type="button" className="icon-btn size-7" aria-label={t('chip.targetsRemove', { symbol: name })} onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className={`text-[12.5px] num ${over ? 'text-down' : 'text-muted-foreground'}`}>
                {t('chip.targetsTotal', { total: formatPercent(total, locale, { maximumFractionDigits: 1 }) })}{over ? ` · ${t('chip.targetsOver')}` : ''}
            </p>
            {adding ? (
                <SymbolEditor holdings={holdings.filter((symbol) => !used.has(symbol))} onApply={(symbol) => { if (!used.has(symbol)) setRows([...rows, { symbol, weightPct: 5, text: '5' }]); setAdding(false); }} />
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn btn-ghost h-8 px-2.5 text-[12.5px]" onClick={() => setAdding(true)} disabled={rows.length >= LIMITS.targetsMax}><Plus />{t('chip.targetsAdd')}</button>
                    {current.length > 0 && <button type="button" className="btn btn-ghost h-8 px-2.5 text-[12.5px]" onClick={() => setRows(current.map((target) => ({ ...target, text: String(target.weightPct) })))}><RotateCcw />{t('chip.targetsReset')}</button>}
                </div>
            )}
            <button type="button" className="btn btn-primary h-8 text-[13px]" disabled={!ok} onClick={() => onApply(rows.map(({ text, ...target }) => ({ ...target, weightPct: Number(text) })))}>{t('chip.apply')}</button>
        </div>
    );
}
