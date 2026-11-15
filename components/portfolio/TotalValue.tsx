import type { Level } from '@/lib/domain/types';
import type { PortfolioView } from '@/lib/services/portfolio';
import ChangePill from '@/components/ChangePill';
import { money, signed, sourceLine, when } from './logic';

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="min-w-0">
        <dt className="kicker">{label}</dt>
        <dd className="num mt-1 text-[17px] font-bold tracking-[-0.02em] text-foreground">{value}</dd>
        {sub && <dd className="text-[12px] text-faint">{sub}</dd>}
    </div>
);

// The fixed widget: the simulated balance, today's change and where the prices behind it came from.
export default function TotalValue({ view, level }: { view: PortfolioView; level: Level }) {
    const { valueCad, dayChangeCad, cashCad, portfolio, positions, fxUsdCad, unpriced } = view;
    const start = portfolio.startingCashCad;
    const sinceStart = valueCad.value - start;
    const previous = dayChangeCad === null ? null : valueCad.value - dayChangeCad;
    const dayPct = dayChangeCad === null || !previous ? null : (dayChangeCad / previous) * 100;
    const invested = valueCad.value - cashCad;
    const priceSources = positions.flatMap((position) => (position.price ? [`${position.symbol}: ${sourceLine(position.price)}`] : []));

    return (
        <section className="hatch" aria-labelledby="total-value-title">
            <div className="card p-5">
                <div className="flex flex-wrap items-center gap-2">
                    <h2 id="total-value-title" className="kicker">{level === 'Novice' ? 'Your simulated balance' : 'Total value'}</h2>
                    <span className="pill is-brand">simulated</span>
                </div>
                <p className="num mt-2 text-[40px] font-bold leading-none tracking-[-0.04em] text-foreground">
                    {money(valueCad.value)} <span className="text-[18px] font-semibold text-muted-foreground">CAD</span>
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground">
                    <span className="font-semibold">Today</span>
                    {dayChangeCad === null ? (
                        <span>{positions.length === 0 ? 'no change: the portfolio holds cash only' : 'not available: a held asset has no change for today'}</span>
                    ) : (
                        <>
                            <span className={`num font-bold ${dayChangeCad > 0 ? 'text-up' : dayChangeCad < 0 ? 'text-down' : ''}`}>{signed(dayChangeCad)} CAD</span>
                            {positions.length > 0 && <ChangePill value={dayPct} />}
                        </>
                    )}
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
                    <Stat label="Starting amount" value={`${money(start)} CAD`} sub="simulated cash, fixed" />
                    <Stat label="Since the start" value={`${signed(sinceStart)} CAD`} sub={level === 'Novice' ? undefined : `${signed((sinceStart / start) * 100)}%`} />
                    <Stat label="Cash" value={`${money(cashCad)} CAD`} sub="simulated" />
                    {level !== 'Novice' && <Stat label="In positions" value={`${money(invested)} CAD`} sub={`${positions.length} held`} />}
                </dl>

                <div className="mt-4 text-[12px] leading-relaxed text-faint">
                    <p>
                        <span className="font-semibold text-muted-foreground">How this number is made:</span>{' '}
                        cash + quantity × last price of each position. Computed {when(valueCad.fetchedAt)}
                    </p>
                    {priceSources.length > 0 && <p>Prices used: {priceSources.join(' · ')}</p>}
                    {fxUsdCad && positions.some((position) => position.price?.currency === 'USD') && (
                        <p>USD converted at {fxUsdCad.value} CAD per USD ({sourceLine(fxUsdCad)}).</p>
                    )}
                    {dayChangeCad !== null && positions.length > 0 && (
                        <p>Today&apos;s change is the move of the positions held now since their previous close, from the same quotes. A position added today counts its whole day, so it can differ from the change since the start.</p>
                    )}
                    {unpriced.length > 0 && <p className="text-down">Not included, no price available right now: {unpriced.join(', ')}.</p>}
                    {level === 'Expert' && valueCad.note && <p className="mono mt-1 text-[11px]">{valueCad.note}</p>}
                </div>
            </div>
        </section>
    );
}
