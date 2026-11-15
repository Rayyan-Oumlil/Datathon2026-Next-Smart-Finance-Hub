'use client';

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FilterCheck, SimulatedTrade } from "@/lib/domain/types";
import { FILTER_LABEL, formatTime } from "./format";

type Conflict = { conflicts: FilterCheck[]; message: string };

// Asks an amount in CAD and adds the position to the simulated portfolio. No real order exists anywhere.
export default function TradeDialog({ symbol, name, onClose }: { symbol: string; name: string; onClose: () => void }) {
    const [amount, setAmount] = useState('500');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [conflict, setConflict] = useState<Conflict | null>(null);
    const [done, setDone] = useState<{ trade: SimulatedTrade; cashCad?: number; acknowledged: boolean } | null>(null);

    const amountCad = Number(amount);
    const valid = Number.isFinite(amountCad) && amountCad > 0;

    async function submit(acknowledgeConflict: boolean) {
        if (!valid || busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/trade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, side: 'buy', amountCad, origin: 'card', ...(acknowledgeConflict ? { acknowledgeConflict: true } : {}) }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.status === 409 && Array.isArray(body.conflicts)) {
                setConflict({ conflicts: body.conflicts, message: body.message ?? '' });
            } else if (!res.ok) {
                setError(typeof body.error === 'string' ? body.error : 'The simulated purchase could not be recorded.');
            } else {
                setConflict(null);
                setDone({ trade: body.trade, cashCad: body.portfolio?.cashCad, acknowledged: acknowledgeConflict });
                toast.success(`Simulated: ${symbol} added to the simulated portfolio`);
            }
        } catch {
            setError('The server did not answer. Nothing was simulated.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add {symbol} to the simulated portfolio</DialogTitle>
                    <DialogDescription>{name} · Simulation only: no real order is placed and no money moves. This is not investment advice.</DialogDescription>
                </DialogHeader>

                {done ? (
                    <div className="flex flex-col gap-2 text-sm">
                        <p className="font-semibold text-foreground">
                            Simulated purchase recorded: <span className="num">{done.trade.quantity}</span> units of {done.trade.symbol} at{' '}
                            <span className="num">{done.trade.price.value.toFixed(2)} {done.trade.currency}</span>, for{' '}
                            <span className="num">{done.trade.valueCad.toFixed(2)} CAD</span>.
                        </p>
                        <p className="text-[12.5px] text-faint">
                            Fill at the last price. Source: {done.trade.price.source}, fetched {formatTime(done.trade.price.fetchedAt)}
                            {done.trade.price.asOf && <>, provider time {formatTime(done.trade.price.asOf)}</>}.
                            {done.cashCad != null && <> Simulated cash left: <span className="num">{done.cashCad.toFixed(2)} CAD</span>.</>}
                        </p>
                        {done.acknowledged && <p className="text-[12.5px] text-warn">The profile conflict and this simulated trade are both in the decision log.</p>}
                        <p className="text-[12.5px] text-faint">Trade id <span className="mono">{done.trade.id}</span>. The watchlist is computed once a day; use Recompute to take this position into account.</p>
                        <DialogFooter>
                            <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
                        </DialogFooter>
                    </div>
                ) : (
                    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
                        <label className="flex flex-col gap-1.5">
                            <span className="form-label">Amount in CAD (simulated cash)</span>
                            <input
                                type="number" inputMode="decimal" min="1" step="any" required autoFocus
                                value={amount} onChange={(e) => { setAmount(e.target.value); setConflict(null); }}
                                className="num h-11 rounded-[11px] border border-line bg-card px-3 text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </label>

                        {conflict && (
                            <div role="alert" className="flex flex-col gap-2 rounded-xl border border-line bg-brand-soft p-3 text-sm">
                                <p className="font-bold text-brand-ink">This asset does not pass {conflict.conflicts.length === 1 ? 'one of your profile filters' : `${conflict.conflicts.length} of your profile filters`}</p>
                                <ul className="flex flex-col gap-1.5">
                                    {conflict.conflicts.map((check) => (
                                        <li key={check.filter} className="text-foreground">
                                            <span className="font-semibold">{FILTER_LABEL[check.filter] ?? check.filter}:</span> {check.detail}
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-[12.5px] text-muted-foreground">Nothing was simulated. You can still proceed in the simulation; the conflict and the trade are both written to the decision log.</p>
                            </div>
                        )}
                        {error && <p role="alert" className="text-sm font-semibold text-down">{error}</p>}

                        <DialogFooter>
                            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                            {conflict
                                ? <button type="button" className="btn btn-primary" disabled={busy || !valid} onClick={() => void submit(true)}>{busy ? 'Simulating…' : 'Proceed in simulation'}</button>
                                : <button type="submit" className="btn btn-primary" disabled={busy || !valid}>{busy ? 'Checking…' : 'Add to simulated portfolio'}</button>}
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
