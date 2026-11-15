'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

type Entry = { symbol: string; name: string; assetClass: string; sector?: string; market: string };

type TickerPickerProps = {
    id: string;
    label: string;
    selected: string[];
    onChange: (symbols: string[]) => void;
};

// A small search over the app's own candidate list (GET /api/universe/search). Enter adds the first match.
export default function TickerPicker({ id, label, selected, onChange }: TickerPickerProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Entry[]>([]);
    const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
    // Names seen in search results, so a picked ticker can show its company name
    const [names, setNames] = useState<Record<string, string>>({});

    useEffect(() => {
        const q = query.trim();
        if (!q) {
            setResults([]);
            setState('idle');
            return;
        }
        const controller = new AbortController();
        setState('loading');
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/universe/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
                if (!res.ok) throw new Error(String(res.status));
                const { entries } = (await res.json()) as { entries: Entry[] };
                setResults(entries);
                setState('idle');
            } catch {
                if (!controller.signal.aborted) setState('error');
            }
        }, 200);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    const open = results.filter((entry) => !selected.includes(entry.symbol));
    const add = (entry: Entry) => {
        setNames((known) => ({ ...known, [entry.symbol]: entry.name }));
        onChange([...selected, entry.symbol]);
        setQuery('');
    };

    return (
        <div className="flex flex-col gap-2.5">
            <label htmlFor={id} className="form-label">{label}</label>
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                <input
                    id={id}
                    type="search"
                    autoComplete="off"
                    value={query}
                    placeholder="Search by company or ticker"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        // With a query typed, Enter picks the first match instead of moving to the next question
                        if (e.key !== 'Enter' || !query.trim()) return;
                        e.preventDefault();
                        if (open[0]) add(open[0]);
                    }}
                    className="h-11 w-full rounded-[11px] border border-line-strong bg-card pl-9 pr-3 text-[15px] text-foreground outline-none placeholder:text-faint focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/30"
                />
            </div>

            {query.trim() && (
                <div className="rounded-[11px] border border-line bg-card p-1" aria-live="polite">
                    {state === 'error' && <p className="px-2.5 py-2 text-[13px] text-down">The search did not answer. Try again.</p>}
                    {state === 'loading' && open.length === 0 && <p className="px-2.5 py-2 text-[13px] text-faint">Searching…</p>}
                    {state === 'idle' && open.length === 0 && (
                        <p className="px-2.5 py-2 text-[13px] text-faint">No match in the app&apos;s list of stocks, ETFs and crypto.</p>
                    )}
                    {open.slice(0, 6).map((entry) => (
                        <button
                            key={entry.symbol}
                            type="button"
                            onClick={() => add(entry)}
                            className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover"
                        >
                            <span className="mono w-[74px] flex-none text-[13px] font-semibold text-foreground">{entry.symbol}</span>
                            <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground">{entry.name}</span>
                            <span className="flex-none text-[12px] text-faint">{entry.sector ?? entry.assetClass}</span>
                        </button>
                    ))}
                </div>
            )}

            {selected.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Picked">
                    {selected.map((symbol) => (
                        <li key={symbol} className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft py-1 pl-3 pr-1 text-[13px] font-semibold text-brand-ink">
                            <span className="mono">{symbol}</span>
                            {names[symbol] && <span className="max-w-[140px] truncate font-medium">{names[symbol]}</span>}
                            <button
                                type="button"
                                aria-label={`Remove ${symbol}`}
                                onClick={() => onChange(selected.filter((s) => s !== symbol))}
                                className="grid size-6 place-items-center rounded-full outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                                <X className="size-3.5" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
