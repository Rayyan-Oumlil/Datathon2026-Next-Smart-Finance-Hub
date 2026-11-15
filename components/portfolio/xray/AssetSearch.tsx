'use client';

import { useEffect, useId, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type Asset = { symbol: string; name: string };
type Entry = Asset & { assetClass: string };

type Props = { value: Asset | null; onChange: (asset: Asset | null) => void; held: Asset[] };

// A small search over the app's own asset list (GET /api/universe/search), with the held assets one tap away.
export default function AssetSearch({ value, onChange, held }: Props) {
    const t = useTranslations('Xray');
    const listId = useId();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Entry[]>([]);

    useEffect(() => {
        const q = query.trim();
        if (!q || value) {
            setResults([]);
            return;
        }
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/universe/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
                if (!res.ok) throw new Error(String(res.status));
                setResults(((await res.json()) as { entries: Entry[] }).entries.filter((entry) => ['stock', 'etf', 'crypto'].includes(entry.assetClass)));
            } catch {
                if (!controller.signal.aborted) setResults([]);
            }
        }, 200);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query, value]);

    const pick = (asset: Asset) => {
        onChange(asset);
        setQuery('');
        setResults([]);
    };

    return (
        <div className="min-w-0">
            <div className="relative">
                {value ? (
                    <div className="flex h-10 items-center justify-between gap-2 rounded-[10px] border border-line-strong bg-card px-3 text-[13.5px]">
                        <span className="min-w-0 truncate"><span className="font-bold text-foreground">{value.symbol}</span> <span className="text-muted-foreground">{value.name}</span></span>
                        <button type="button" className="icon-btn !size-7" aria-label={t('whatIf.clear')} onClick={() => onChange(null)}><X /></button>
                    </div>
                ) : (
                    <>
                        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                        <input
                            type="text"
                            role="combobox"
                            aria-expanded={results.length > 0}
                            aria-controls={listId}
                            aria-autocomplete="list"
                            aria-label={t('whatIf.asset')}
                            placeholder={t('whatIf.assetPlaceholder')}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) { event.preventDefault(); pick(results[0]); } }}
                            className="h-10 w-full rounded-[10px] border border-line-strong bg-card ps-9 pe-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                    </>
                )}
                {results.length > 0 && (
                    <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-[10px] border border-line bg-card p-1 shadow-lg">
                        {results.map((entry) => (
                            <li key={entry.symbol} role="option" aria-selected={false}>
                                <button type="button" onClick={() => pick(entry)} className="flex w-full items-center justify-between gap-3 rounded-[8px] px-2.5 py-1.5 text-start text-[13px] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">
                                    <span className="font-bold text-foreground">{entry.symbol}</span>
                                    <span className="min-w-0 truncate text-muted-foreground">{entry.name}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {!value && held.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {held.map((asset) => (
                        <button key={asset.symbol} type="button" onClick={() => pick(asset)} className="h-7 rounded-full bg-hover px-2.5 text-[12px] font-bold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                            {asset.symbol}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
