"use client"

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Command as CommandPrimitive } from "cmdk"
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { AssetLogo } from "@/components/AssetLogo";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { useDebounce } from "@/hooks/useDebounce";
import { formatNumber } from "@/i18n/format";
import type { AssetClass } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const OPEN_SEARCH_EVENT = 'open-search';

// Any button can open the one palette mounted in the app shell.
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

export const SearchButton = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <button type="button" onClick={openSearch} className={className}>{children}</button>
);

// Kept in step with UNIVERSE_KINDS in lib/universe.ts (not imported: that module pulls the universe files into the bundle)
const KINDS = ['all', 'stock', 'etf', 'bond', 'crypto', 'gold'] as const;
type Kind = (typeof KINDS)[number];
type Market = '' | 'US' | 'Canada';
// GICS sectors present in data/universe.json
const SECTORS = [
    'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Energy', 'Financials', 'Health Care',
    'Industrials', 'Information Technology', 'Materials', 'Real Estate', 'Utilities',
] as const;

type UniverseHit = { symbol: string; name: string; assetClass: AssetClass; sector?: string; market: 'US' | 'Canada' | 'none' };
type Row = { symbol: string; name: string; assetClass?: AssetClass; type?: string; market?: string };

const BOND_NAME = /\bbond|treasury/i;

export default function SearchCommand({ initialStocks }: { initialStocks: StockWithWatchlistStatus[] }) {
    const t = useTranslations('SearchCommand');
    const te = useTranslations('StockExtra.searchType');
    const locale = useLocale();
    const router = useRouter();
    // Finnhub's instrument types ("Common Stock", "ETP") read in the active language; any other type is shown as given
    const finnhubType = (type?: string) => {
        const key = (type ?? '').toLowerCase().replace(/[^a-z]/g, '');
        return key && te.has(key as 'stock') ? te(key as 'stock') : type;
    };
    const [open, setOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [kind, setKind] = useState<Kind>('all');
    const [market, setMarket] = useState<Market>('');
    const [sector, setSector] = useState('');
    const [loading, setLoading] = useState(false)
    const [rows, setRows] = useState<Row[] | null>(null);
    const requestId = useRef(0);
    // The palette starts closed, so render it only after hydration (avoids Radix id mismatches)
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const query = searchTerm.trim();
    const filtered = kind !== 'all' || !!market || !!sector;
    const sectorApplies = kind === 'all' || kind === 'stock';

    const fromFinnhub = (stock: StockWithWatchlistStatus): Row => ({
        symbol: stock.symbol,
        name: stock.name,
        type: finnhubType(stock.type),
        market: /\.(TO|V|NE|CN)$/.test(stock.symbol) ? t('markets.Canada') : stock.exchange,
    });
    const fromUniverse = (hit: UniverseHit): Row => ({
        symbol: hit.symbol,
        name: hit.name,
        assetClass: hit.assetClass,
        type: t(`kinds.${hit.assetClass === 'etf' && BOND_NAME.test(hit.name) ? 'bondEtf' : hit.assetClass}`),
        market: hit.market === 'none' ? undefined : t(`markets.${hit.market}`),
    });
    const popular = initialStocks.slice(0, 10).map(fromFinnhub);
    const displayRows = rows ?? popular;
    // The first result is highlighted whenever the list changes, so Enter opens it right away
    const [active, setActive] = useState('');
    const firstSymbol = displayRows[0]?.symbol ?? '';
    useEffect(() => setActive(firstSymbol), [firstSymbol, rows]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault()
                setOpen(v => !v)
            }
        }
        const onOpen = () => setOpen(true)
        window.addEventListener("keydown", onKeyDown)
        window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
        return () => {
            window.removeEventListener("keydown", onKeyDown)
            window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
        }
    }, [])

    const universe = async (filters: boolean): Promise<UniverseHit[]> => {
        const params = new URLSearchParams({ q: query });
        if (filters) {
            if (kind !== 'all') params.set('type', kind);
            if (market) params.set('market', market);
            if (sector && sectorApplies) params.set('sector', sector);
        }
        const res = await fetch(`/api/universe/search?${params}`);
        if (!res.ok) return [];
        const body = await res.json() as { entries?: UniverseHit[] };
        return body.entries ?? [];
    };

    const handleSearch = async () => {
        const id = ++requestId.current;
        if (!query && !filtered) { setRows(null); setLoading(false); return; }
        setLoading(true)
        try {
            let next: Row[];
            if (filtered) {
                // Filters apply to the app's own list, where each asset's family and market are known
                next = (await universe(true)).map(fromUniverse);
            } else {
                // Free text: the app's list first, then anything else the market data provider knows
                const [own, wide] = await Promise.all([universe(false).catch(() => []), searchStocks(query).catch(() => [])]);
                const seen = new Set(own.map((hit) => hit.symbol.toUpperCase()));
                next = [...own.map(fromUniverse), ...wide.filter((s) => !seen.has(s.symbol.toUpperCase())).map(fromFinnhub)];
            }
            if (id === requestId.current) setRows(next);
        } catch {
            if (id === requestId.current) setRows([]);
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }

    const debouncedSearch = useDebounce(handleSearch, 250);

    useEffect(() => {
        debouncedSearch();
    }, [debouncedSearch, query, kind, market, sector]);

    const select = (symbol: string) => {
        setOpen(false);
        setSearchTerm("");
        router.push(`/stocks/${encodeURIComponent(symbol)}`);
    }

    // The filter row keeps its own keys: Enter and arrows on a chip or a select must not pick a result
    const keepKeys = (e: ReactKeyboardEvent) => { if (e.key !== 'Escape') e.stopPropagation(); };

    if (!mounted) return null;

    const selectClass = "h-8 min-w-0 rounded-lg border border-line bg-card px-2 text-[12.5px] text-foreground";

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="search-dialog overflow-hidden p-0" showCloseButton>
                <DialogHeader className="sr-only">
                    <DialogTitle>{t('dialogTitle')}</DialogTitle>
                    <DialogDescription>{t('dialogDescription')}</DialogDescription>
                </DialogHeader>
                <CommandPrimitive shouldFilter={false} loop value={active} onValueChange={setActive} label={t('dialogTitle')} className="flex h-full w-full flex-col overflow-hidden bg-card text-foreground">
                    <div className="search-field">
                        <CommandInput
                            value={searchTerm}
                            onValueChange={setSearchTerm}
                            placeholder={t('placeholder')}
                            className="search-input"
                        />
                        {loading && <Loader2 className="search-loader" />}
                    </div>

                    <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5" onKeyDown={keepKeys}>
                        <div role="group" aria-label={t('filters.type')} className="flex flex-wrap gap-1.5">
                            {KINDS.map((key) => (
                                <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}
                                    className={cn('btn btn-ghost h-8 px-2.5 text-[12.5px]', kind === key && 'is-on')}>
                                    {t(`filters.kinds.${key}`)}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-1.5 text-[12px] text-faint">
                                {t('filters.market')}
                                <select className={selectClass} value={market} onChange={(e) => setMarket(e.target.value as Market)}>
                                    <option value="">{t('filters.allMarkets')}</option>
                                    <option value="Canada">{t('markets.Canada')}</option>
                                    <option value="US">{t('markets.US')}</option>
                                </select>
                            </label>
                            {sectorApplies && (
                                <label className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
                                    {t('filters.sector')}
                                    <select className={cn(selectClass, 'max-w-56')} value={sector} onChange={(e) => setSector(e.target.value)}>
                                        <option value="">{t('filters.allSectors')}</option>
                                        {SECTORS.map((name) => <option key={name} value={name}>{t(`sectors.${name}`)}</option>)}
                                    </select>
                                </label>
                            )}
                            {filtered && (
                                <button type="button" className="btn btn-ghost h-8 px-2.5 text-[12.5px] ms-auto"
                                    onClick={() => { setKind('all'); setMarket(''); setSector(''); }}>
                                    {t('filters.clear')}
                                </button>
                            )}
                        </div>
                    </div>

                    <CommandList className="search-list">
                        {loading && rows === null ? (
                            <div className="search-list-indicator">{t('searching')}</div>
                        ) : displayRows.length === 0 ? (
                            <div className="search-list-indicator">
                                {query ? t('noMatch', { query }) : filtered ? t('noFilterMatch') : t('noStocks')}
                            </div>
                        ) : (
                            <>
                                <div className="search-count" aria-live="polite">
                                    {rows === null ? t('popular') : t('results')}
                                    <span className="num"> · {formatNumber(displayRows.length, locale)}</span>
                                </div>
                                {displayRows.map((row) => (
                                    <CommandItem
                                        key={row.symbol}
                                        value={row.symbol}
                                        onSelect={() => select(row.symbol)}
                                        className="search-item-link group h-12 gap-3 data-[selected=true]:bg-hover"
                                    >
                                        <AssetLogo symbol={row.symbol} name={row.name} assetClass={row.assetClass} size={28} />
                                        <span className="mono w-20 shrink-0 text-[13px] font-semibold text-brand-ink truncate">{row.symbol}</span>
                                        <span className="search-item-name flex-1 min-w-0">{row.name}</span>
                                        <span className="hidden sm:block text-xs text-faint truncate max-w-48">{[row.type, row.market].filter(Boolean).join(' · ')}</span>
                                        <ArrowUpRight className="size-4 text-faint opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100 transition-opacity" />
                                    </CommandItem>
                                ))}
                            </>
                        )}
                    </CommandList>
                </CommandPrimitive>
            </DialogContent>
        </Dialog>
    )
}
