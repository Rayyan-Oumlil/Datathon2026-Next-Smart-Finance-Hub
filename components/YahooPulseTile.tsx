import Link from 'next/link';
import { LineChart } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import ChangePill from '@/components/ChangePill';
import MoneyParts from '@/components/shell/MoneyParts';
import { yahooAppSymbol, type YahooDailyQuote } from '@/lib/yahoo';
import { formatNumber } from '@/i18n/format';

const TWO_DECIMALS: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

// Pulse tile priced from Yahoo daily quotes. Used for Tadawul, whose TradingView quote widgets are blocked in free embeds,
// and Warsaw, whose embeds are end of day only.
export default async function YahooPulseTile({ tvSymbol, label, quote }: { tvSymbol: string; label: string; quote: YahooDailyQuote | null }) {
    const [t, locale] = await Promise.all([getTranslations('PulseTile'), getLocale()]);
    const appSymbol = yahooAppSymbol(tvSymbol);
    const body = (
        <>
            <div className="bento-head">
                <span className="bento-ico"><LineChart /></span>
                <span className="truncate">{label}</span>
                <span className="mono ms-auto text-xs text-faint">{tvSymbol.split(':').pop()}</span>
            </div>
            <p className="bento-value self-start num">
                {/* Indices are in points, not a currency */}
                {quote ? (appSymbol ? <MoneyParts amount={quote.price} currency={quote.currency} locale={locale} options={TWO_DECIMALS} /> : formatNumber(quote.price, locale, TWO_DECIMALS)) : '—'}
            </p>
            <div className="bento-foot">
                {quote ? (
                    <>
                        <ChangePill value={quote.changePercent} />
                        <span className="num truncate">{t('vsPrevClose', { change: formatNumber(quote.change, locale, { ...TWO_DECIMALS, signDisplay: 'exceptZero' }) })}</span>
                    </>
                ) : (
                    <span>{t('unavailable')}</span>
                )}
            </div>
        </>
    );
    // Indices (TASI, WIG20, ...) have no stock page
    if (!appSymbol) return <div className="bento-tile">{body}</div>;
    return <Link href={`/stocks/${appSymbol}`} className="bento-tile transition-colors hover:bg-hover/60">{body}</Link>;
}
