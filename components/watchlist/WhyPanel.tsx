'use client';

import { useEffect, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { runDetail, type RunDetail } from "@/app/(root)/overview/actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FactorDetail, FilterCheck, Pick, SignalSet, Sourced } from "@/lib/domain/types";
import {
    FACTOR_KEYS, FACTOR_LABEL, FILTER_LABEL, NOT_AVAILABLE, SIGNAL_KEYS, SIGNAL_LABEL,
    formatSignal, formatTime, isStale, kindLabel, type FactorKey, type WatchlistRulesView,
} from "./format";

// The answer of GET /api/watchlist/why
type Explanation = {
    listed: boolean;
    pick?: Pick;
    rejected?: FilterCheck[];
    candidate?: { symbol: string; filters: FilterCheck[]; passed: boolean; factors?: Record<FactorKey, FactorDetail>; total?: number };
    note?: string;
    snapshotId: string;
    computedAt: string;
    ruleVersions: Record<string, string>;
    decisionIds: string[];
};

const KEPT_TEXT: Record<string, string> = {
    seed: 'On your brands list, and it passed every filter',
    incumbent: 'Already listed in the previous run',
    new: 'New in this run',
};

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-2 border-t border-line pt-4">
            <div>
                <h3 className="section-title">{title}</h3>
                {sub && <p className="section-sub">{sub}</p>}
            </div>
            {children}
        </section>
    );
}

const Missing = ({ what }: { what: string }) => <p className="text-sm text-faint">{what}: {NOT_AVAILABLE}.</p>;

/**
 * Everything the logged run holds about one symbol: the sentence and its template, the score and its four
 * factors, every filter check, every input with its source and times, the rule versions and the snapshot.
 */
export default function WhyPanel({ symbol, rules, onClose }: { symbol: string; rules: WatchlistRulesView; onClose: () => void }) {
    const [data, setData] = useState<Explanation | null>(null);
    const [detail, setDetail] = useState<RunDetail | 'loading' | 'failed'>('loading');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const res = await fetch(`/api/watchlist/why?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
                const body = await res.json();
                if (!live) return;
                if (!res.ok) return setError(typeof body.error === 'string' ? body.error : 'The explanation could not be loaded.');
                setData(body);
                // The route gives a pick without its filter checks and a non-pick without its inputs; both are in the logged run
                const extra = await runDetail(body.decisionIds?.[0] ?? '', body.pick?.symbol ?? body.candidate?.symbol ?? symbol.toUpperCase()).catch(() => 'failed' as const);
                if (live) setDetail(extra);
            } catch {
                if (live) setError('The explanation could not be loaded.');
            }
        })();
        return () => { live = false; };
    }, [symbol]);

    const pick = data?.pick;
    const extra = typeof detail === 'object' ? detail : null;
    const factors = pick?.factors ?? data?.candidate?.factors;
    const total = pick?.total ?? data?.candidate?.total;
    const filters = data?.candidate?.filters ?? extra?.filters ?? null;
    const signals: SignalSet | null = pick?.signals ?? extra?.signals ?? null;
    const template = pick?.reason ? rules.reasonTemplates.find((t) => t.id === pick.reason?.templateId) : undefined;

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="top-0 right-0 left-auto h-dvh max-w-full translate-x-0 translate-y-0 content-start gap-4 overflow-y-auto rounded-none sm:max-w-xl sm:rounded-l-2xl">
                <DialogHeader>
                    <DialogTitle>Why {pick ? `${pick.name} (${pick.symbol})` : signals ? `${signals.entry.name} (${signals.symbol})` : symbol}?</DialogTitle>
                    <DialogDescription>
                        Read from the logged watchlist run. Computed by fixed rules; no AI picks, ranks or scores. Not investment advice.
                    </DialogDescription>
                </DialogHeader>

                {error && <p role="alert" className="text-sm font-semibold text-down">{error}</p>}
                {!data && !error && <p className="text-sm text-faint" aria-live="polite">Loading the logged run…</p>}

                {data && (
                    <>
                        <div className="flex flex-wrap items-center gap-2">
                            {data.listed && pick
                                ? <span className="pill is-brand">Listed · rank {pick.rank}</span>
                                : <span className="pill">Not on the list</span>}
                            {pick && <span className="pill">{kindLabel(pick.assetClass, pick.sector)}</span>}
                            {pick?.kept && <span className="pill">{KEPT_TEXT[pick.kept] ?? pick.kept}</span>}
                        </div>
                        {data.note && <p className="text-sm text-foreground">{data.note}</p>}
                        {data.rejected && data.rejected.length > 0 && (
                            <div role="note" className="rounded-xl border border-line bg-brand-soft p-3 text-sm text-foreground">
                                <p className="font-bold text-brand-ink">Left out by {data.rejected.length === 1 ? 'one filter' : `${data.rejected.length} filters`}</p>
                                <ul className="mt-1 flex flex-col gap-1">
                                    {data.rejected.map((check) => <li key={check.filter}>{FILTER_LABEL[check.filter] ?? check.filter}: {check.detail}</li>)}
                                </ul>
                            </div>
                        )}

                        {data.listed && (
                            <Section title="Reason sentence" sub={`Filled from one of the ${rules.reasonTemplates.length} allowed fact templates (${data.ruleVersions.reasons ?? NOT_AVAILABLE})`}>
                                {pick?.reason ? (
                                    <>
                                        <p className="text-[15px] font-semibold text-foreground">“{pick.reason.text}”</p>
                                        <dl className="grid gap-1 text-[12.5px] text-muted-foreground">
                                            <div><dt className="inline font-semibold">Template: </dt><dd className="inline"><span className="mono">{pick.reason.templateId}</span>{template && <> · “{template.text}”</>}</dd></div>
                                            <div>
                                                <dt className="font-semibold">Filled from:</dt>
                                                <dd><ul className="list-disc ps-4">{pick.reason.sources.map((s) => <li key={s} className="break-words">{s}</li>)}</ul></dd>
                                            </div>
                                        </dl>
                                    </>
                                ) : <p className="text-sm text-faint">No template applied to this asset, so the card shows facts only (sector and move today).</p>}
                            </Section>
                        )}

                        <Section title="Score" sub={`Weighted sum of four factors, each 0 to 100 (${data.ruleVersions.score ?? NOT_AVAILABLE})`}>
                            {factors && total !== undefined ? (
                                <>
                                    <p className="text-sm text-foreground"><span className="num text-2xl font-bold">{total.toFixed(1)}</span> <span className="text-faint">out of 100</span></p>
                                    <ul className="flex flex-col gap-2.5">
                                        {FACTOR_KEYS.map((key) => {
                                            const factor = factors[key];
                                            const weight = rules.weights[key];
                                            return (
                                                <li key={key} className="flex flex-col gap-1">
                                                    <div className="flex items-baseline justify-between gap-3 text-sm">
                                                        <span className="font-semibold text-foreground">{FACTOR_LABEL[key]}</span>
                                                        <span className="num whitespace-nowrap text-muted-foreground">
                                                            {factor.score.toFixed(1)} × {weight}% = <span className="font-bold text-foreground">{(factor.score * weight / 100).toFixed(1)}</span>
                                                        </span>
                                                    </div>
                                                    <div className="h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, factor.score))}%` }} /></div>
                                                    <p className="text-[12.5px] leading-snug text-muted-foreground">{factor.detail}{factor.noData && ' (no data: neutral value)'}</p>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <p className="text-[12.5px] text-faint">Total = {rules.totalFormula}.</p>
                                </>
                            ) : <p className="text-sm text-faint">No score: only assets that pass every filter are scored, and reference values are never scored.</p>}
                        </Section>

                        <Section title="Filter checks" sub={`Pass or fail, with the actual values (${data.ruleVersions.filters ?? NOT_AVAILABLE})`}>
                            {filters ? (
                                <ul className="flex flex-col gap-2">
                                    {filters.map((check) => (
                                        <li key={check.filter} className="flex gap-2 text-sm">
                                            {check.pass ? <CircleCheck aria-hidden className="mt-0.5 size-4 flex-none text-up" /> : <CircleX aria-hidden className="mt-0.5 size-4 flex-none text-down" />}
                                            <div className="min-w-0">
                                                <p className="font-semibold text-foreground">{FILTER_LABEL[check.filter] ?? check.filter} · <span className={check.pass ? 'text-up' : 'text-down'}>{check.pass ? 'pass' : 'fail'}</span></p>
                                                <p className="text-[12.5px] leading-snug text-muted-foreground">{check.detail}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : detail === 'loading'
                                ? <p className="text-sm text-faint">Loading the checks…</p>
                                : <Missing what="Filter checks for this symbol in the logged run" />}
                        </Section>

                        <Section title="Input values" sub="Each value with its source, when we fetched it and the provider's own time">
                            {signals ? (
                                <>
                                    <ul className="flex flex-col gap-2.5">
                                        {SIGNAL_KEYS.map((key) => {
                                            const sourced = signals[key] as Sourced<unknown> | undefined;
                                            if (!sourced) return null;
                                            const stale = isStale(key, sourced, rules.quoteStaleSeconds);
                                            return (
                                                <li key={key} className="text-sm">
                                                    <div className="flex items-baseline justify-between gap-3">
                                                        <span className="text-muted-foreground">{SIGNAL_LABEL[key]}</span>
                                                        <span className="num text-right font-semibold text-foreground">{formatSignal(key, sourced)}</span>
                                                    </div>
                                                    <dl className="mt-0.5 grid gap-x-3 text-[11.5px] leading-snug text-faint sm:grid-cols-[auto_1fr]">
                                                        <dt>Source</dt><dd className="break-words">{sourced.source}</dd>
                                                        {sourced.endpoint && <><dt>Endpoint</dt><dd className="mono break-all">{sourced.endpoint}</dd></>}
                                                        <dt>Fetched</dt><dd>{formatTime(sourced.fetchedAt)}{stale && <span className="font-bold text-warn"> · stale</span>}</dd>
                                                        <dt>Provider time</dt><dd>{sourced.asOf ? formatTime(sourced.asOf) : 'not given by the provider'}</dd>
                                                        {sourced.note && <><dt>Note</dt><dd className="break-words">{sourced.note}</dd></>}
                                                    </dl>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    {signals.missing.length > 0 && <p className="text-[12.5px] text-warn">Not available from any source, and not replaced by a placeholder: {signals.missing.join(', ')}.</p>}
                                    <dl className="grid gap-1 text-[12.5px] text-muted-foreground">
                                        <div><dt className="inline font-semibold">ESG tag: </dt><dd className="inline">{signals.entry.esg} (demo data, set by hand)</dd></div>
                                        {signals.entry.subIndustry && <div><dt className="inline font-semibold">Niche: </dt><dd className="inline">{signals.entry.subIndustry}</dd></div>}
                                        <div><dt className="inline font-semibold">Listed in the asset universe from: </dt><dd className="inline break-words">{signals.entry.listSource}</dd></div>
                                    </dl>
                                </>
                            ) : detail === 'loading'
                                ? <p className="text-sm text-faint">Loading the inputs…</p>
                                : <Missing what="Input values for this symbol in the logged run" />}
                        </Section>

                        <Section title="Traceability">
                            <dl className="grid gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground sm:grid-cols-[auto_1fr]">
                                <dt className="font-semibold">Computed</dt><dd>{formatTime(data.computedAt)}</dd>
                                <dt className="font-semibold">Snapshot</dt><dd className="mono break-all">{data.snapshotId}</dd>
                                <dt className="font-semibold">Rule versions</dt>
                                <dd className="mono break-words">{Object.entries(data.ruleVersions).map(([k, v]) => `${k}: ${v}`).join(' · ')}</dd>
                                <dt className="font-semibold">Decision log rows</dt>
                                <dd className="mono break-all">{data.decisionIds.length > 0 ? data.decisionIds.join(' · ') : NOT_AVAILABLE}</dd>
                            </dl>
                        </Section>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
