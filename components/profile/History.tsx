'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DecisionLogEntry, FilterCheck, Sourced } from '@/lib/domain/types';
import Panel from '@/components/Panel';
import { cn } from '@/lib/utils';

const KINDS = [
    { kind: 'pick', label: 'Watchlist picks' },
    { kind: 'simulated_trade', label: 'Simulated trades' },
    { kind: 'profile_conflict', label: 'Profile conflicts' },
] as const;
type Kind = (typeof KINDS)[number]['kind'];

// Only the parts of each logged payload this timeline reads; anything absent is shown as not available.
type PickPayload = { rank?: number; name?: string; total?: number; topDrivers?: string[]; reason?: { text?: string; templateId?: string } | null };
type TradePayload = {
    trade?: { side?: string; quantity?: number; price?: Sourced; valueCad?: number; origin?: string; reason?: string; ruleId?: string };
    conflicts?: FilterCheck[];
    fxUsdCad?: Sourced;
};
type ConflictPayload = { conflicts?: FilterCheck[]; level?: string; risk?: string; proceeded?: boolean };

const DRIVERS: Record<string, string> = { profile_fit: 'profile match', risk_fit: 'risk match', fundamentals: 'fundamentals', diversification: 'diversification' };
const ORIGINS: Record<string, string> = { card: 'from a watchlist card', rule: 'by an investment rule', agent: 'through the agent' };
const NA = 'not available';

const num = (value: number | undefined, digits = 2) =>
    value === undefined ? NA : value.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : NA);

function describe(entry: DecisionLogEntry): { tag: string; title: string; why: string; facts: string[] } {
    if (entry.kind === 'pick') {
        const p = (entry.payload ?? {}) as PickPayload;
        return {
            tag: 'Pick',
            title: `${entry.symbol ?? NA}${p.name ? ` · ${p.name}` : ''} listed at rank ${p.rank ?? NA}`,
            why: p.reason?.text ?? 'No reason sentence was written for this pick: facts only.',
            facts: [
                `Score ${num(p.total, 1)} of 100`,
                ...(p.topDrivers?.length ? [`Main factors: ${p.topDrivers.map((d) => DRIVERS[d] ?? d).join(', ')}`] : []),
                ...(p.reason?.templateId ? [`Sentence template: ${p.reason.templateId}`] : []),
            ],
        };
    }
    if (entry.kind === 'simulated_trade') {
        const p = (entry.payload ?? {}) as TradePayload;
        const t = p.trade ?? {};
        const price = t.price;
        const fx = p.fxUsdCad;
        const action = t.side === 'buy' ? 'Simulated purchase' : t.side === 'sell' ? 'Simulated position reduction' : `Simulated trade (side ${NA})`;
        const failed = (p.conflicts ?? []).filter((c) => !c.pass);
        return {
            tag: 'Simulated trade',
            title: `${action} of ${num(t.quantity, 6)} ${entry.symbol ?? NA}, ${num(t.valueCad)} CAD`,
            why: t.ruleId
                ? `Triggered by investment rule ${t.ruleId}.`
                : `Asked ${ORIGINS[t.origin ?? ''] ?? `(origin ${NA})`}.${failed.length ? ' Made after a profile conflict was acknowledged.' : ''}`,
            facts: [
                price
                    ? `Filled at the last price ${num(price.value)} ${price.currency ?? ''} · source ${price.source} · fetched ${when(price.fetchedAt)}${price.asOf ? ` · as of ${when(price.asOf)}` : ''}`
                    : `Fill price ${NA}`,
                // The CAD value of a USD fill depends on the day's rate, so the rate is shown with its source
                ...(price?.currency === 'USD'
                    ? [fx
                        ? `Converted to CAD at ${num(fx.value, 4)} CAD per USD · source ${fx.source} · fetched ${when(fx.fetchedAt)}${fx.asOf ? ` · as of ${fx.asOf}` : ''}`
                        : `USD/CAD rate ${NA}`]
                    : []),
                ...(t.reason ? [`Logged reason: ${t.reason}`] : []),
            ],
        };
    }
    const p = (entry.payload ?? {}) as ConflictPayload;
    const failed = (p.conflicts ?? []).filter((c) => !c.pass);
    return {
        tag: 'Profile conflict',
        title: `${entry.symbol ?? NA} did not pass ${failed.length} profile ${failed.length === 1 ? 'filter' : 'filters'}`,
        why: failed.map((c) => c.detail).join('; ') || `Filter details ${NA}.`,
        facts: [
            `Profile at the time: ${p.level ?? NA}, ${p.risk ?? NA} risk`,
            p.proceeded ? 'Acknowledged, then simulated anyway' : 'Nothing was simulated',
        ],
    };
}

// Past picks, simulated trades and profile conflicts, read from the append-only decision log.
export default function History() {
    const [entries, setEntries] = useState<DecisionLogEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [shown, setShown] = useState<Kind | 'all'>('all');

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const lists = await Promise.all(KINDS.map(async ({ kind }) => {
                const res = await fetch(`/api/decisions?kind=${kind}&limit=40`, { cache: 'no-store' });
                if (!res.ok) throw new Error(String(res.status));
                return ((await res.json()) as { decisions: DecisionLogEntry[] }).decisions;
            }));
            setEntries(lists.flat().sort((a, b) => b.id.localeCompare(a.id)));
        } catch {
            setFailed(true);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const visible = (entries ?? []).filter((entry) => shown === 'all' || entry.kind === shown);

    return (
        <Panel
            title="History"
            sub="Past picks and why, simulated trades and profile conflicts. Source: the decision log (append-only)."
            action={(
                <button type="button" className="btn btn-ghost" onClick={() => { setEntries(null); void load(); }}>
                    <RefreshCw aria-hidden /> Reload
                </button>
            )}
            bodyClassName="flex flex-col"
        >
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5 border-b border-line p-3">
                {[{ kind: 'all' as const, label: 'All' }, ...KINDS].map(({ kind, label }) => (
                    <button
                        key={kind}
                        type="button"
                        aria-pressed={shown === kind}
                        onClick={() => setShown(kind)}
                        className={cn('btn btn-ghost h-8 px-3 text-[13px]', shown === kind && 'is-on')}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {failed && (
                <div className="empty-state" role="alert">
                    <h3>The decision log did not answer</h3>
                    <p>No history is shown rather than a partial one. Use Reload to try again.</p>
                </div>
            )}
            {!failed && entries === null && <p className="p-4 text-[13.5px] text-faint" aria-live="polite">Reading the decision log…</p>}
            {!failed && entries !== null && visible.length === 0 && (
                <div className="empty-state">
                    <h3>Nothing logged yet</h3>
                    <p>Picks appear after the first watchlist run; trades and conflicts after the first simulated trade.</p>
                </div>
            )}

            <ol className="flex flex-col divide-y divide-line">
                {!failed && visible.map((entry) => {
                    const { tag, title, why, facts } = describe(entry);
                    const versions = Object.entries(entry.ruleVersions ?? {});
                    return (
                        <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={cn('pill', entry.kind === 'pick' && 'is-brand')}>{tag}</span>
                                <time dateTime={entry.at} className="num text-[12.5px] text-faint">{when(entry.at)}</time>
                            </div>
                            <p className="text-[14.5px] font-semibold text-foreground">{title}</p>
                            <p className="text-[13.5px] text-foreground">{why}</p>
                            <ul className="flex flex-col gap-0.5 text-[12.5px] text-muted-foreground">
                                {facts.map((fact) => <li key={fact}>{fact}</li>)}
                            </ul>
                            <p className="mono break-words text-[11.5px] text-faint">
                                {versions.length ? `rules ${versions.map(([, version]) => version).join(' · ')}` : `rule versions ${NA} on this row`}
                                {entry.snapshotId ? ` · snapshot ${entry.snapshotId}` : ''} · log id {entry.id}
                            </p>
                        </li>
                    );
                })}
            </ol>
        </Panel>
    );
}
