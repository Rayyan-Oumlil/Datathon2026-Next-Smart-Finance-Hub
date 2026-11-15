'use client';

import { useState } from "react";
import { sourceLabel } from "@/lib/source-label";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AssetLogo from "@/components/AssetLogo";
import type { AssetClass, FilterCheck, SimulatedTrade } from "@/lib/domain/types";
import { formatMoney, formatNumber } from "@/i18n/format";
import { filterLabel, formatTime } from "./format";

// An unknown currency code is shown as given next to the plain number
function money(amount: number, currency: string, locale: string): string {
    try { return formatMoney(amount, currency, locale); } catch { return `${formatNumber(amount, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`; }
}

type Conflict = { conflicts: FilterCheck[]; message: string };

// Asks an amount in CAD and adds the position to the simulated portfolio. No real order exists anywhere.
export default function TradeDialog({ symbol, name, assetClass, onClose }: { symbol: string; name: string; assetClass?: AssetClass; onClose: () => void }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
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
                setError(typeof body.error === 'string' ? body.error : t('trade.failed'));
            } else {
                setConflict(null);
                setDone({ trade: body.trade, cashCad: body.portfolio?.cashCad, acknowledged: acknowledgeConflict });
                toast.success(t('trade.toast', { symbol }));
            }
        } catch {
            setError(t('trade.noAnswer'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <AssetLogo symbol={symbol} name={name} assetClass={assetClass} size={40} />
                        <DialogTitle className="min-w-0">{t('trade.title', { symbol })}</DialogTitle>
                    </div>
                    <DialogDescription>{t('trade.description', { name })}</DialogDescription>
                </DialogHeader>

                {done ? (
                    <div className="flex flex-col gap-2 text-sm">
                        <p className="font-semibold text-foreground">
                            {t.rich('trade.recorded', {
                                quantity: formatNumber(done.trade.quantity, locale, { maximumFractionDigits: 8 }),
                                symbol: done.trade.symbol,
                                price: money(done.trade.price.value, done.trade.currency, locale),
                                value: money(done.trade.valueCad, 'CAD', locale),
                                num: (chunks) => <span className="num">{chunks}</span>,
                            })}
                        </p>
                        <p className="text-[12.5px] text-faint">
                            {t('trade.fill', {
                                source: sourceLabel(done.trade.price.source, locale),
                                time: formatTime(done.trade.price.fetchedAt, t, locale),
                                hasProvider: String(Boolean(done.trade.price.asOf)),
                                providerTime: done.trade.price.asOf ? formatTime(done.trade.price.asOf, t, locale) : '',
                            })}
                            {done.cashCad != null && <> {t.rich('trade.cashLeft', { cash: money(done.cashCad, 'CAD', locale), num: (chunks) => <span className="num">{chunks}</span> })}</>}
                        </p>
                        {done.acknowledged && <p className="text-[12.5px] text-warn">{t('trade.acknowledged')}</p>}
                        <p className="text-[12.5px] text-faint">{t.rich('trade.traceId', { id: done.trade.id, mono: (chunks) => <span className="mono">{chunks}</span> })}</p>
                        <DialogFooter>
                            <button type="button" className="btn btn-primary" onClick={onClose}>{t('trade.close')}</button>
                        </DialogFooter>
                    </div>
                ) : (
                    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
                        <label className="flex flex-col gap-1.5">
                            <span className="form-label">{t('trade.amountLabel')}</span>
                            <input
                                type="number" inputMode="decimal" min="1" step="any" required autoFocus
                                value={amount} onChange={(e) => { setAmount(e.target.value); setConflict(null); }}
                                className="num h-11 rounded-[11px] border border-line bg-card px-3 text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </label>

                        {conflict && (
                            <div role="alert" className="flex flex-col gap-2 rounded-xl border border-line bg-brand-soft p-3 text-sm">
                                <p className="font-bold text-brand-ink">{t('trade.conflictTitle', { count: conflict.conflicts.length })}</p>
                                <ul className="flex flex-col gap-1.5">
                                    {conflict.conflicts.map((check) => (
                                        <li key={check.filter} className="text-foreground">
                                            <span className="font-semibold">{t('labelColon', { label: filterLabel(t, check.filter) })}</span> {check.detail}
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-[12.5px] text-muted-foreground">{t('trade.conflictNote')}</p>
                            </div>
                        )}
                        {error && <p role="alert" className="text-sm font-semibold text-down">{error}</p>}

                        <DialogFooter>
                            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('trade.cancel')}</button>
                            {conflict
                                ? <button type="button" className="btn btn-primary" disabled={busy || !valid} onClick={() => void submit(true)}>{busy ? t('trade.proceeding') : t('trade.proceed')}</button>
                                : <button type="submit" className="btn btn-primary" disabled={busy || !valid}>{busy ? t('trade.checking') : t('trade.submit')}</button>}
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
