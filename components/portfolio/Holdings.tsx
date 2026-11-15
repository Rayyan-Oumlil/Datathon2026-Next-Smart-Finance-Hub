'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { toast } from 'sonner';
import type { Level } from '@/lib/domain/types';
import type { PositionView } from '@/lib/services/portfolio';
import ChangePill from '@/components/ChangePill';
import Panel from '@/components/Panel';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, money, sourceLine, units } from './logic';

const INPUT = 'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-foreground outline-none placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/30';

function ReduceDialog({ position, onClose, onDone }: { position: PositionView; onClose: () => void; onDone: () => void }) {
    const [mode, setMode] = useState<'quantity' | 'amountCad'>('quantity');
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const amount = Number(value);
    const valid = value.trim() !== '' && Number.isFinite(amount) && amount > 0;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!valid) return;
        setBusy(true);
        setError(null);
        try {
            await api('/api/trade', { method: 'POST', body: { symbol: position.symbol, side: 'sell', [mode]: amount, origin: 'card' } });
            toast.success(`Simulated: position in ${position.symbol} reduced.`);
            onDone();
            onClose();
        } catch (failure) {
            setError((failure as Error).message);
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <form onSubmit={submit} className="grid gap-4">
                    <DialogHeader>
                        <DialogTitle>Reduce position: {position.symbol} <span className="pill is-brand ms-1 align-middle">simulated</span></DialogTitle>
                        <DialogDescription>
                            You hold {units(position.quantity)} units{position.valueCad !== null ? `, ${money(position.valueCad)} CAD at the last price` : ''}.
                            The simulation fills at the last price; no real trade is placed.
                        </DialogDescription>
                    </DialogHeader>

                    <div role="radiogroup" aria-label="Reduce by" className="flex gap-1.5">
                        {([['quantity', 'By quantity'], ['amountCad', 'By amount in CAD']] as const).map(([id, label]) => (
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
                        <label htmlFor="reduce-value" className="form-label">{mode === 'quantity' ? 'Units to remove' : 'Amount to remove (CAD)'}</label>
                        <div className="flex gap-2">
                            <input id="reduce-value" className={INPUT} inputMode="decimal" type="number" min="0" step="any" value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
                            {mode === 'quantity' && (
                                <button type="button" className="btn btn-ghost h-10" onClick={() => setValue(String(position.quantity))}>Whole position</button>
                            )}
                        </div>
                    </div>

                    {error && <p role="alert" className="text-[13px] text-down">{error}</p>}

                    <DialogFooter>
                        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>{busy ? 'Simulating…' : 'Reduce position'}</button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

type Props = { positions: PositionView[]; totalCad: number; level: Level; onChanged: () => void };

// Each simulated position with the price that values it. Novice: value and return only. Expert: every column.
export default function Holdings({ positions, totalCad, level, onChanged }: Props) {
    const [reducing, setReducing] = useState<PositionView | null>(null);
    const detail = level !== 'Novice';
    const dense = level === 'Expert';
    const cell = dense ? '!h-12' : '';

    return (
        <Panel
            title="Holdings (simulated)"
            sub={level === 'Novice' ? 'What the simulated portfolio holds and how each has moved since it was added' : 'Positions valued at the last price; return against the average cost in CAD'}
            bodyClassName="overflow-hidden"
        >
            {positions.length === 0 ? (
                <div className="empty-state">
                    <span className="empty-icon"><Wallet className="size-5" /></span>
                    <h3>Cash only for now</h3>
                    <p className="max-w-md text-[13px]">
                        The simulated portfolio holds no position yet. The Overview tab lists assets matched to your profile, each with its reasons and sources; from a card you can add one to the simulated portfolio.
                    </p>
                    <Link href="/overview" className="btn btn-primary mt-2">Open the Overview tab</Link>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Asset</th>
                                {detail && <th className="is-num">Quantity</th>}
                                {detail && <th className="is-num">Last price</th>}
                                {dense && <th className="is-num">Avg cost (CAD)</th>}
                                {dense && <th className="is-num">Today</th>}
                                <th className="is-num">Value (CAD)</th>
                                {dense && <th className="is-num">Weight</th>}
                                <th className="is-num">{level === 'Novice' ? 'Since added' : 'Return'}</th>
                                <th><span className="sr-only">Actions</span></th>
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
                                                <span className="pill">{position.sector ?? position.assetClass.toUpperCase()}</span>
                                            </span>
                                            <span className="text-[12.5px] text-muted-foreground">{position.name}</span>
                                            <span className="text-[11.5px] text-faint">
                                                {position.price ? `Price: ${sourceLine(position.price)}` : 'Price not available right now'}
                                            </span>
                                        </div>
                                    </td>
                                    {detail && <td className={`is-num ${cell}`}>{units(position.quantity)}</td>}
                                    {detail && <td className={`is-num ${cell}`}>{position.price ? `${money(position.price.value)} ${position.price.currency ?? ''}` : 'not available'}</td>}
                                    {dense && <td className={`is-num ${cell}`}>{money(position.avgCostCad)}</td>}
                                    {dense && <td className={`is-num ${cell}`}>{position.changePercent ? <ChangePill value={position.changePercent.value} /> : 'not available'}</td>}
                                    <td className={`is-num font-semibold text-foreground ${cell}`}>{position.valueCad !== null ? money(position.valueCad) : 'not available'}</td>
                                    {dense && <td className={`is-num ${cell}`}>{position.valueCad !== null && totalCad > 0 ? `${((position.valueCad / totalCad) * 100).toFixed(1)}%` : 'not available'}</td>}
                                    <td className={`is-num ${cell}`}>{position.returnPct !== null ? <ChangePill value={position.returnPct} /> : 'not available'}</td>
                                    <td className={`is-num ${cell}`}>
                                        <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={() => setReducing(position)}>Reduce position</button>
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
