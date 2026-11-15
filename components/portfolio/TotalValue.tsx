import { useTranslations } from 'next-intl';
import type { Level } from '@/lib/domain/types';
import type { PortfolioView } from '@/lib/services/portfolio';
import ChangePill from '@/components/ChangePill';
import { formatDateTime } from '@/i18n/format';
import { AssetLogo } from '@/components/AssetLogo';
import { useFmt } from './useFmt';

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="min-w-0">
        <dt className="kicker">{label}</dt>
        <dd className="num mt-1 text-[17px] font-bold tracking-[-0.02em] text-foreground">{value}</dd>
        {sub && <dd className="text-[12px] text-faint">{sub}</dd>}
    </div>
);

// The fixed widget: the simulated balance, the session's change and where the prices behind it came from.
export default function TotalValue({ view, level }: { view: PortfolioView; level: Level }) {
    const t = useTranslations('Portfolio');
    const fmt = useFmt();
    const { valueCad, dayChangeCad, cashCad, portfolio, positions, fxUsdCad, unpriced, market } = view;
    const start = portfolio.startingCashCad;
    const sinceStart = valueCad.value - start;
    const previous = dayChangeCad === null ? null : valueCad.value - dayChangeCad;
    const dayPct = dayChangeCad === null || !previous ? null : (dayChangeCad / previous) * 100;
    const invested = valueCad.value - cashCad;
    // Outside a session the change belongs to the last one, so it is named by its date, never as "today"
    const lastSession = formatDateTime(`${market.lastSession}T12:00:00Z`, fmt.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const priced = positions.filter((position) => position.price);
    // The sentence around the list comes from the translation; the list itself is drawn with each asset's logo
    const LIST = '\u0001';
    const [pricesBefore, pricesAfter = ''] = t('total.pricesUsed', { list: LIST }).split(LIST);

    return (
        <section className="hatch" aria-labelledby="total-value-title">
            <div className="card p-5">
                <div className="flex flex-wrap items-center gap-2">
                    <h2 id="total-value-title" className="kicker">{level === 'Novice' ? t('total.titleNovice') : t('total.title')}</h2>
                    <span className="pill is-brand">{t('simulated')}</span>
                </div>
                <p className="num mt-2 text-[40px] font-bold leading-none tracking-[-0.04em] text-foreground">
                    {fmt.money(valueCad.value)} <span className="text-[18px] font-semibold text-muted-foreground">CAD</span>
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground">
                    <span className="font-semibold">{market.open ? t('total.today') : t('total.lastSession', { day: lastSession })}</span>
                    {!market.open && <span className="pill">{t('total.marketsClosed')}</span>}
                    {dayChangeCad === null ? (
                        <span>{positions.length === 0 ? t('total.noChangeCashOnly') : t('total.changeUnavailable')}</span>
                    ) : (
                        <>
                            <span className={`num font-bold ${dayChangeCad > 0 ? 'text-up' : dayChangeCad < 0 ? 'text-down' : ''}`}>{fmt.signedCad(dayChangeCad)}</span>
                            {positions.length > 0 && <><ChangePill value={dayPct} /><span className="text-[12px] text-faint">{t('total.pctOfTotal')}</span></>}
                        </>
                    )}
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
                    <Stat label={t('total.startingAmount')} value={fmt.cad(start)} sub={t('total.startingSub')} />
                    <Stat label={t('total.sinceStart')} value={fmt.signedCad(sinceStart)} sub={level === 'Novice' ? undefined : t('total.pctOfStart', { pct: fmt.signedPct((sinceStart / start) * 100) })} />
                    <Stat label={t('total.cash')} value={fmt.cad(cashCad)} sub={t('total.cashSub')} />
                    {level !== 'Novice' && <Stat label={t('total.inPositions')} value={fmt.cad(invested)} sub={t('total.heldCount', { count: positions.length })} />}
                </dl>

                <div className="mt-4 text-[12px] leading-relaxed text-faint">
                    <p>
                        <span className="font-semibold text-muted-foreground">{t('total.howLabel')}</span>{' '}
                        {t('total.howBody', { when: fmt.when(valueCad.fetchedAt) })}
                    </p>
                    {priced.length > 0 && (
                        <p>
                            {pricesBefore}
                            {priced.map((position, index) => (
                                <span key={position.symbol} className="whitespace-normal">
                                    {index > 0 && ' · '}
                                    <span className="inline-flex items-center gap-1 align-middle">
                                        <AssetLogo symbol={position.symbol} name={position.name} assetClass={position.assetClass} size={14} />
                                        <span className="font-semibold text-muted-foreground">{position.symbol}</span>
                                    </span>
                                    {': '}{position.price ? fmt.sourceLine(position.price) : ''}
                                </span>
                            ))}
                            {pricesAfter}
                        </p>
                    )}
                    {fxUsdCad && positions.some((position) => position.price?.currency === 'USD') && (
                        <p>{t('total.fxNote', { rate: fmt.units(fxUsdCad.value), source: fmt.sourceLine(fxUsdCad) })}</p>
                    )}
                    {dayChangeCad !== null && positions.length > 0 && (
                        <p>{t('total.dayNote')}</p>
                    )}
                    {unpriced.length > 0 && <p className="text-down">{t('total.unpriced', { list: unpriced.join(', ') })}</p>}
                    {level === 'Expert' && valueCad.note && <p className="mono mt-1 text-[11px]">{valueCad.note}</p>}
                </div>
            </div>
        </section>
    );
}
