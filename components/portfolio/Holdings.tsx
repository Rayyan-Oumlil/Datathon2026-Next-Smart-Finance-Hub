'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Level } from '@/lib/domain/types';
import type { PositionView } from '@/lib/services/portfolio';
import ChangePill from '@/components/ChangePill';
import Panel from '@/components/Panel';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from './logic';
import { useFmt } from './useFmt';

const INPUT = 'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-foreground outline-none placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/30';

function ReduceDialog({ position, onClose, onDone }: { position: PositionView; onClose: () => void; onDone: () => void }) {
    const t = useTranslations('Portfolio');
    const fmt = useFmt();
    const [mode, setMode] = useState<'quantity' | 'amountCad'>('quantity');
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ failure: unknown } | null>(null);
    const heldUnits = t('reduce.units', { count: position.quantity, quantity: fmt.units(position.quantity) });
    const amount = Number(value);
    const valid = value.trim() !== '' && Number.isFinite(amount) && amount > 0;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        try {
            await api('/api/trade', { method: 'POST', body: { symbol: position.symbol, side: 'sell', [mode]: amount, origin: 'card' } });
            toast.success(t('reduce.done', { symbol: position.symbol }));
            onDone();
            onClose();
        } catch (failure) {
            setError({ failure });
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <form onSubmit={submit} className="grid gap-4">
                    <DialogHeader>
                        <DialogTitle>{t('reduce.title', { symbol: position.symbol })} <span className="pill is-brand ms-1 align-middle">{t('simulated')}</span></DialogTitle>
                        <DialogDescription>
                            {position.valueCad !== null ? t('reduce.holdNowValue', { units: heldUnits, value: fmt.money(position.valueCad) }) : t('reduce.holdNow', { units: heldUnits })}{' '}
                            {t('reduce.fillNote')}
                        </DialogDescription>
                    </DialogHeader>

                    <div role="radiogroup" aria-label={t('reduce.reduceBy')} className="flex gap-1.5">
                        {([['quantity', t('reduce.byQuantity')], ['amountCad', t('reduce.byAmount')]] as const).map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                role="radio"
                                aria-checked={mode === id}
                                onClick={() => { setMode(id); setValue(''); }}
                                className={`btn btn-ghost h-9 ${mode === id ? 'is-on' : ''}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="grid gap-1.5">
                        <label htmlFor="reduce-value" className="form-label">{mode === 'quantity' ? t('reduce.unitsToRemove') : t('reduce.amountToRemove')}</label>
                        <div className="flex gap-2">
                            <input id="reduce-value" className={INPUT} inputMode="decimal" type="number" min="0" step="any" value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
                            {mode === 'quantity' && (
                                <button type="button" className="btn btn-ghost h-10" onClick={() => setValue(String(position.quantity))}>{t('reduce.wholePosition')}</button>
                            )}
                        </div>
                    </div>

                    {error && <p role="alert" className="text-[13px] text-down">{fmt.error(error.failure)}</p>}

                    <DialogFooter>
                        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
                        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>{busy ? t('reduce.busy') : t('reduce.submit')}</button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

type Props = { positions: PositionView[]; totalCad: number; level: Level; onChanged: () => void };

// Each simulated position with the price that values it. Novice: value and return only. Expert: every column.
export default function Holdings({ positions, totalCad, level, onChanged }: Props) {
    const t = useTranslations('Portfolio');
    const fmt = useFmt();
    const na = t('notAvailable');
    const [reducing, setReducing] = useState<PositionView | null>(null);
    const detail = level !== 'Novice';
    const dense = level === 'Expert';
    const cell = dense ? '!h-12' : '';

    return (
        <Panel
            title={t('holdings.title')}
            sub={level === 'Novice' ? t('holdings.subNovice') : t('holdings.sub')}
            bodyClassName="overflow-hidden"
        >
            {positions.length === 0 ? (
                <div className="empty-state">
                    <span className="empty-icon"><Wallet className="size-5" /></span>
                    <h3>{t('holdings.emptyTitle')}</h3>
                    <p className="max-w-md text-[13px]">
                        {t('holdings.emptyBody')}
                    </p>
                    <Link href="/overview" className="btn btn-primary mt-2">{t('holdings.openOverview')}</Link>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>{t('holdings.colAsset')}</th>
                                {detail && <th className="is-num">{t('holdings.colQuantity')}</th>}
                                {detail && <th className="is-num">{t('holdings.colLastPrice')}</th>}
                                {dense && <th className="is-num">{t('holdings.colAvgCost')}</th>}
                                {dense && <th className="is-num">{t('holdings.colToday')}</th>}
                                <th className="is-num">{t('holdings.colValue')}</th>
                                {dense && <th className="is-num">{t('holdings.colWeight')}</th>}
                                <th className="is-num">{level === 'Novice' ? t('holdings.colSinceAdded') : t('holdings.colReturn')}</th>
                                <th><span className="sr-only">{t('holdings.colActions')}</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {positions.map((position) => (
                                <tr key={position.symbol}>
                                    <td className={`${cell} !whitespace-normal py-2`}>
                                        <div className="flex min-w-40 flex-col gap-0.5">
                                            <span className="flex flex-wrap items-center gap-1.5">
                                                <Link href={`/stocks/${encodeURIComponent(position.symbol)}`} className="font-bold text-foreground underline-offset-2 outline-none hover:text-brand-ink hover:underline focus-visible:underline">
                                                    {position.symbol}
                                                </Link>
                                                <span className="pill">{position.sector ?? t(`assetClass.${position.assetClass}`)}</span>
                                            </span>
                                            <span className="text-[12.5px] text-muted-foreground">{position.name}</span>
                                            <span className="text-[11.5px] text-faint">
                                                {position.price ? t('holdings.price', { line: fmt.sourceLine(position.price) }) : t('holdings.priceUnavailable')}
                                            </span>
                                        </div>
                                    </td>
                                    {detail && <td className={`is-num ${cell}`}>{fmt.units(position.quantity)}</td>}
                                    {detail && <td className={`is-num ${cell}`}>{position.price ? `${fmt.money(position.price.value)} ${position.price.currency ?? ''}` : na}</td>}
                                    {dense && <td className={`is-num ${cell}`}>{fmt.money(position.avgCostCad)}</td>}
                                    {dense && <td className={`is-num ${cell}`}>{position.changePercent ? <ChangePill value={position.changePercent.value} /> : na}</td>}
                                    <td className={`is-num font-semibold text-foreground ${cell}`}>{position.valueCad !== null ? fmt.money(position.valueCad) : na}</td>
                                    {dense && <td className={`is-num ${cell}`}>{position.valueCad !== null && totalCad > 0 ? fmt.share((position.valueCad / totalCad) * 100) : na}</td>}
                                    <td className={`is-num ${cell}`}>{position.returnPct !== null ? <ChangePill value={position.returnPct} /> : na}</td>
                                    <td className={`is-num ${cell}`}>
                                        <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={() => setReducing(position)}>{t('holdings.reduce')}</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {reducing && <ReduceDialog position={reducing} onClose={() => setReducing(null)} onDone={onChanged} />}
        </Panel>
    );
}
