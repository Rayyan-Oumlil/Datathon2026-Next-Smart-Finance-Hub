'use client';

import { useEffect, useState } from "react";
import { sourceLabel } from "@/lib/source-label";
import { CircleCheck, CircleX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { runDetail, type RunDetail } from "@/app/(root)/overview/actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FactorDetail, FilterCheck, Pick, SignalSet, Sourced } from "@/lib/domain/types";
import { formatNumber, formatPercent } from "@/i18n/format";
import {
    FACTOR_KEYS, SIGNAL_KEYS, esgLabel, factorLabel, filterLabel, keptLabel, missingLabel, notAvailable, signalLabel,
    formatSignal, formatTime, isStale, kindLabel, type FactorKey, type Translate, type WatchlistRulesView,
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

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

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

const Missing = ({ what, t }: { what: string; t: Translate }) => <p className="text-sm text-faint">{t('why.missing', { what })}</p>;

/**
 * Everything the logged run holds about one symbol: the sentence and its template, the score and its four
 * factors, every filter check, every input with its source and times, the rule versions and the snapshot.
 */
export default function WhyPanel({ symbol, rules, onClose }: { symbol: string; rules: WatchlistRulesView; onClose: () => void }) {
    const t = useTranslations('Watchlist');
    const locale = useLocale();
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
                if (!res.ok) return setError(typeof body.error === 'string' ? body.error : t('why.loadFailed'));
                setData(body);
                // The route gives a pick without its filter checks and a non-pick without its inputs; both are in the logged run
                const extra = await runDetail(body.decisionIds?.[0] ?? '', body.pick?.symbol ?? body.candidate?.symbol ?? symbol.toUpperCase()).catch(() => 'failed' as const);
                if (live) setDetail(extra);
            } catch {
                if (live) setError(t('why.loadFailed'));
            }
        })();
        return () => { live = false; };
    }, [symbol, t]);

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
                    <DialogTitle>{t('why.title', { name: pick ? `${pick.name} (${pick.symbol})` : signals ? `${signals.entry.name} (${signals.symbol})` : symbol })}</DialogTitle>
                    <DialogDescription>
                        {t('why.description')}
                    </DialogDescription>
                </DialogHeader>

                {error && <p role="alert" className="text-sm font-semibold text-down">{error}</p>}
                {!data && !error && <p className="text-sm text-faint" aria-live="polite">{t('why.loadingRun')}</p>}

                {data && (
                    <>
                        <div className="flex flex-wrap items-center gap-2">
                            {data.listed && pick
                                ? <span className="pill is-brand">{t('why.listedRank', { rank: pick.rank })}</span>
                                : <span className="pill">{t('why.notListed')}</span>}
                            {pick && <span className="pill">{kindLabel(t, pick.assetClass, pick.sector)}</span>}
                            {pick?.kept && <span className="pill">{keptLabel(t, pick.kept)}</span>}
                        </div>
                        {data.note && <p className="text-sm text-foreground">{data.note}</p>}
                        {data.rejected && data.rejected.length > 0 && (
                            <div role="note" className="rounded-xl border border-line bg-brand-soft p-3 text-sm text-foreground">
                                <p className="font-bold text-brand-ink">{t('why.leftOut', { count: data.rejected.length })}</p>
                                <ul className="mt-1 flex flex-col gap-1">
                                    {data.rejected.map((check) => <li key={check.filter}>{t('labelColon', { label: filterLabel(t, check.filter) })} {check.detail}</li>)}
                                </ul>
                            </div>
                        )}

                        {data.listed && (
                            <Section title={t('why.reasonTitle')} sub={t('why.reasonSub', { count: rules.reasonTemplates.length, version: data.ruleVersions.reasons ?? notAvailable(t) })}>
                                {pick?.reason ? (
                                    <>
                                        <p className="text-[15px] font-semibold text-foreground">“{pick.reason.text}”</p>
                                        <dl className="grid gap-1 text-[12.5px] text-muted-foreground">
                                            <div><dt className="inline font-semibold">{t('why.template')}</dt><dd className="inline"><span className="mono">{pick.reason.templateId}</span>{template && <> · “{template.text}”</>}</dd></div>
                                            <div>
                                                <dt className="font-semibold">{t('why.filledFrom')}</dt>
                                                <dd><ul className="list-disc ps-4">{pick.reason.sources.map((s) => <li key={s} className="break-words">{s}</li>)}</ul></dd>
                                            </div>
                                        </dl>
                                    </>
                                ) : <p className="text-sm text-faint">{t('why.noTemplate')}</p>}
                            </Section>
                        )}

                        <Section title={t('why.scoreTitle')} sub={t('why.scoreSub', { version: data.ruleVersions.score ?? notAvailable(t) })}>
                            {factors && total !== undefined ? (
                                <>
                                    <p className="text-sm text-foreground"><span className="num text-2xl font-bold">{formatNumber(total, locale, ONE_DECIMAL)}</span> <span className="text-faint">{t('why.outOf100')}</span></p>
                                    <ul className="flex flex-col gap-2.5">
                                        {FACTOR_KEYS.map((key) => {
                                            const factor = factors[key];
                                            const weight = rules.weights[key];
                                            return (
                                                <li key={key} className="flex flex-col gap-1">
                                                    <div className="flex items-baseline justify-between gap-3 text-sm">
                                                        <span className="font-semibold text-foreground">{factorLabel(t, key)}</span>
                                                        <span className="num whitespace-nowrap text-muted-foreground">
                                                            {t('why.factorCalc', { score: formatNumber(factor.score, locale, ONE_DECIMAL), weight: formatPercent(weight, locale) })} <span className="font-bold text-foreground">{formatNumber(factor.score * weight / 100, locale, ONE_DECIMAL)}</span>
                                                        </span>
                                                    </div>
                                                    <div className="h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, factor.score))}%` }} /></div>
                                                    <p className="text-[12.5px] leading-snug text-muted-foreground">{factor.detail}{factor.noData && t('why.noDataNeutral')}</p>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <p className="text-[12.5px] text-faint">{t('why.totalFormula', { formula: rules.totalFormula })}</p>
                                </>
                            ) : <p className="text-sm text-faint">{t('why.noScore')}</p>}
                        </Section>

                        <Section title={t('why.filterTitle')} sub={t('why.filterSub', { version: data.ruleVersions.filters ?? notAvailable(t) })}>
                            {filters ? (
                                <ul className="flex flex-col gap-2">
                                    {filters.map((check) => (
                                        <li key={check.filter} className="flex gap-2 text-sm">
                                            {check.pass ? <CircleCheck aria-hidden className="mt-0.5 size-4 flex-none text-up" /> : <CircleX aria-hidden className="mt-0.5 size-4 flex-none text-down" />}
                                            <div className="min-w-0">
                                                <p className="font-semibold text-foreground">{filterLabel(t, check.filter)} · <span className={check.pass ? 'text-up' : 'text-down'}>{check.pass ? t('why.pass') : t('why.fail')}</span></p>
                                                <p className="text-[12.5px] leading-snug text-muted-foreground">{check.detail}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : detail === 'loading'
                                ? <p className="text-sm text-faint">{t('why.loadingChecks')}</p>
                                : <Missing t={t} what={t('why.missingChecks')} />}
                        </Section>

                        <Section title={t('why.inputsTitle')} sub={t('why.inputsSub')}>
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
                                                        <span className="text-muted-foreground">{signalLabel(t, key)}</span>
                                                        <span className="num text-right font-semibold text-foreground">{formatSignal(key, sourced, t, locale)}</span>
                                                    </div>
                                                    <dl className="mt-0.5 grid gap-x-3 text-[11.5px] leading-snug text-faint sm:grid-cols-[auto_1fr]">
                                                        <dt>{t('why.source')}</dt><dd className="break-words">{sourceLabel(sourced.source, locale)}</dd>
                                                        {sourced.endpoint && <><dt>{t('why.endpoint')}</dt><dd className="mono break-all">{sourced.endpoint}</dd></>}
                                                        <dt>{t('why.fetched')}</dt><dd>{formatTime(sourced.fetchedAt, t, locale)}{stale && <span className="font-bold text-warn">{t('why.stale')}</span>}</dd>
                                                        <dt>{t('why.providerTime')}</dt><dd>{sourced.asOf ? formatTime(sourced.asOf, t, locale) : t('why.noProviderTime')}</dd>
                                                        {sourced.note && <><dt>{t('why.note')}</dt><dd className="break-words">{sourced.note}</dd></>}
                                                    </dl>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    {signals.missing.length > 0 && <p className="text-[12.5px] text-warn">{t('why.missingInputs', { list: signals.missing.map((m) => missingLabel(t, m)).join(', ') })}</p>}
                                    <dl className="grid gap-1 text-[12.5px] text-muted-foreground">
                                        <div><dt className="inline font-semibold">{t('why.esgTag')}</dt><dd className="inline">{t('why.esgValue', { tag: esgLabel(t, signals.entry.esg) })}</dd></div>
                                        {signals.entry.subIndustry && <div><dt className="inline font-semibold">{t('why.niche')}</dt><dd className="inline">{signals.entry.subIndustry}</dd></div>}
                                        <div><dt className="inline font-semibold">{t('why.listedFrom')}</dt><dd className="inline break-words">{signals.entry.listSource}</dd></div>
                                    </dl>
                                </>
                            ) : detail === 'loading'
                                ? <p className="text-sm text-faint">{t('why.loadingInputs')}</p>
                                : <Missing t={t} what={t('why.missingInputsFor')} />}
                        </Section>

                        <Section title={t('why.traceTitle')}>
                            <dl className="grid gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground sm:grid-cols-[auto_1fr]">
                                <dt className="font-semibold">{t('why.computed')}</dt><dd>{formatTime(data.computedAt, t, locale)}</dd>
                                <dt className="font-semibold">{t('why.snapshot')}</dt><dd className="mono break-all">{data.snapshotId}</dd>
                                <dt className="font-semibold">{t('why.ruleVersions')}</dt>
                                <dd className="mono break-words">{Object.entries(data.ruleVersions).map(([k, v]) => `${k}: ${v}`).join(' · ')}</dd>
                                <dt className="font-semibold">{t('why.decisionRows')}</dt>
                                <dd className="mono break-all">{data.decisionIds.length > 0 ? data.decisionIds.join(' · ') : notAvailable(t)}</dd>
                            </dl>
                        </Section>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
