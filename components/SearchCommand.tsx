"use client"

import { useEffect, useState } from "react"
import { CommandDialog, CommandEmpty, CommandInput, CommandList } from "@/components/ui/command"
import { ArrowUpRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { useDebounce } from "@/hooks/useDebounce";
import { formatNumber } from "@/i18n/format";

const OPEN_SEARCH_EVENT = 'open-search';

// Any button can open the one palette mounted in the app shell.
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

export const SearchButton = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <button type="button" onClick={openSearch} className={className}>{children}</button>
);

export default function SearchCommand({ initialStocks }: { initialStocks: StockWithWatchlistStatus[] }) {
    const t = useTranslations('SearchCommand');
    const te = useTranslations('StockExtra.searchType');
    const locale = useLocale();
    // Finnhub's instrument types ("Common Stock", "ETP") read in the active language; any other type is shown as given
    const typeLabel = (type?: string) => {
        const key = (type ?? '').toLowerCase().replace(/[^a-z]/g, '');
        return key && te.has(key as 'stock') ? te(key as 'stock') : type;
    };
    const [open, setOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [loading, setLoading] = useState(false)
    const [stocks, setStocks] = useState<StockWithWatchlistStatus[]>(initialStocks);
    // The palette starts closed, so render it only after hydration (avoids Radix id mismatches)
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const isSearchMode = !!searchTerm.trim();
    const displayStocks = isSearchMode ? stocks : stocks?.slice(0, 10);

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

    const handleSearch = async () => {
        if(!isSearchMode) return setStocks(initialStocks);

        setLoading(true)
        try {
            const results = await searchStocks(searchTerm.trim());
            setStocks(results);
        } catch {
            setStocks([])
        } finally {
            setLoading(false)
        }
    }

    const debouncedSearch = useDebounce(handleSearch, 300);

    useEffect(() => {
        debouncedSearch();
    }, [debouncedSearch, searchTerm]);

    const handleSelectStock = () => {
        setOpen(false);
        setSearchTerm("");
        setStocks(initialStocks);
    }

    if (!mounted) return null;

    return (
        <CommandDialog
            open={open}
            onOpenChange={setOpen}
            title={t('dialogTitle')}
            description={t('dialogDescription')}
            className="search-dialog"
        >
            <div className="search-field">
                <CommandInput
                    value={searchTerm}
                    onValueChange={setSearchTerm}
                    placeholder={t('placeholder')}
                    className="search-input"
                />
                {loading && <Loader2 className="search-loader" />}
            </div>
            <CommandList className="search-list">
                {loading ? (
                    <CommandEmpty className="search-list-empty">{t('searching')}</CommandEmpty>
                ) : displayStocks?.length === 0 ? (
                    <div className="search-list-indicator">
                        {isSearchMode ? t('noMatch', { query: searchTerm.trim() }) : t('noStocks')}
                    </div>
                ) : (
                    <ul>
                        <li className="search-count">
                            {isSearchMode ? t('results') : t('popular')}
                            <span className="num"> · {formatNumber(displayStocks?.length || 0, locale)}</span>
                        </li>
                        {displayStocks?.map((stock) => (
                            <li key={stock.symbol} className="search-item">
                                <Link href={`/stocks/${stock.symbol}`} onClick={handleSelectStock} className="search-item-link group">
                                    <span className="mono w-20 shrink-0 text-[13px] font-semibold text-brand-ink truncate">{stock.symbol}</span>
                                    <span className="search-item-name flex-1">{stock.name}</span>
                                    <span className="hidden sm:block text-xs text-faint truncate max-w-40">{[stock.exchange, typeLabel(stock.type)].filter(Boolean).join(' · ')}</span>
                                    <ArrowUpRight className="size-4 text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </CommandList>
        </CommandDialog>
    )
}
