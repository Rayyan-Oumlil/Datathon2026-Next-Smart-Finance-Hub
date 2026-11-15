'use client';

import { useEffect, useMemo, useState } from 'react';
import { forgetKeptScroll } from '@/hooks/useKeepScroll';
import Link from 'next/link';
import { ExternalLink, GitCompareArrows, Loader2, Plus, Scale, TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Panel from '@/components/Panel';
import { PERSONAS, isPersonaName } from '@/lib/personas/presets';
import type { CompareResult } from '@/lib/services/replay';
import CompareChart from './CompareChart';
import CompareTable from './CompareTable';
import { PERSONA_NAMES, START_CHIPS, type ModelOption, type StrategyOption } from './Controls';
import CopyId from './CopyId';
import { SERIES_COUNT, SERIES_VARS, seriesColor } from './palette';
import { usePlayer } from './usePlayer';
import { useReplayFmt } from './useReplayFmt';

/** An example strategy offered by GET /api/strategy/suggestions, when that route exists: sent whole to the replay. */
type SuggestedStrategy = { id: string; name: string; strategy: Record<string, unknown> };

type Draft = {
    key: number;
    label: string;
    /** false while the label follows the portfolio and strategy names. */
    labelEdited: boolean;
    /** 'current', a persona name, or 'model:<id>' (same encoding as the single run). */
    portfolio: string;
    /** '' = no rule, 'own:<id>' = one of the visitor's strategies, 'sugg:<id>' = an example strategy. */
    strategy: string;
    slot: number;
};

type Shared = { capital: string; startDate: string; fee: string };

const MAX = SERIES_COUNT;
const fieldClass = 'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-[13.5px] text-foreground outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-ring/30';

function parseSuggestions(json: unknown): SuggestedStrategy[] {
    const raw = (json as { suggestions?: unknown; strategies?: unknown })?.suggestions ?? (json as { strategies?: unknown })?.strategies ?? json;
    if (!Array.isArray(raw)) return [];
    const out: SuggestedStrategy[] = [];
    for (const item of raw as Array<Record<string, unknown>>) {
        const inner = (item?.strategy && typeof item.strategy === 'object' ? item.strategy : item) as Record<string, unknown>;
        const id = typeof item?.id === 'string' ? item.id : typeof inner.id === 'string' ? inner.id : null;
        const name = typeof item?.name === 'string' ? item.name : typeof inner.name === 'string' ? inner.name : null;
        if (!id || !name || !Array.isArray(inner.rules) || inner.rules.length === 0) continue;
        out.push({ id, name, strategy: { id: typeof inner.id === 'string' ? inner.id : id, name, rules: inner.rules, version: typeof inner.version === 'number' ? inner.version : 1 } });
    }
    return out.slice(0, 8);
}

type Props = {
    strategies: StrategyOption[] | null;
    models: ModelOption[];
    window: { from: string; to: string } | null;
};

// « Comparer »: up to five portfolio + strategy scenarios replayed with the same amount, start date and fee, on one
// chart and in one table. Each scenario keeps its own replay id and opens in the single-run view.
export default function CompareMode({ strategies, models, window }: Props) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const player = usePlayer();
    const [suggestions, setSuggestions] = useState<SuggestedStrategy[]>([]);
    const [shared, setShared] = useState<Shared>({ capital: '10000', startDate: '2021-01-04', fee: '0' });
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [nextKey, setNextKey] = useState(1);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<CompareResult | null>(null);

    useEffect(() => {
        let gone = false;
        fetch('/api/strategy/suggestions').then((r) => (r.ok ? r.json() : null)).then((json) => { if (!gone) setSuggestions(json ? parseSuggestions(json) : []); }).catch(() => undefined);
        return () => { gone = true; };
    }, []);

    const portfolioName = (value: string) => {
        if (value === 'current') return t('multi.currentShort');
        if (isPersonaName(value)) return t(`controls.personas.${value}`, { name: PERSONAS[value].displayName });
        if (value.startsWith('model:')) return models.find((m) => `model:${m.id}` === value)?.name ?? t('controls.current');
        return value;
    };
    const strategyName = (value: string) => {
        if (value.startsWith('own:')) return strategies?.find((s) => `own:${s.id}` === value)?.name ?? t('controls.noRules');
        if (value.startsWith('sugg:')) return suggestions.find((s) => `sugg:${s.id}` === value)?.name ?? t('controls.noRules');
        return t('controls.noRules');
    };
    const autoLabel = (d: Pick<Draft, 'portfolio' | 'strategy'>) => t('multi.autoLabel', { portfolio: portfolioName(d.portfolio), strategy: strategyName(d.strategy) }).slice(0, 40);

    // two starting scenarios once the visitor's strategies are known: the current portfolio without rules, and with
    // their first strategy (or the first suggested portfolio when they have none)
    useEffect(() => {
        if (strategies === null || drafts.length > 0) return;
        const first: Draft = { key: 0, label: '', labelEdited: false, portfolio: 'current', strategy: '', slot: 0 };
        const second: Draft = strategies[0]
            ? { key: 1, label: '', labelEdited: false, portfolio: 'current', strategy: `own:${strategies[0].id}`, slot: 1 }
            : { key: 1, label: '', labelEdited: false, portfolio: models[0] ? `model:${models[0].id}` : PERSONA_NAMES[0], strategy: '', slot: 1 };
        setDrafts([first, second]);
        setNextKey(2);
    }, [strategies]); // eslint-disable-line react-hooks/exhaustive-deps

    // labels that were not typed follow the names (also when the language or the lists change)
    const shown = drafts.map((d) => (d.labelEdited ? d : { ...d, label: autoLabel(d) }));

    const update = (key: number, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    const pickColor = (key: number, slot: number) => setDrafts((list) => {
        const me = list.find((d) => d.key === key);
        if (!me) return list;
        // a colour already taken swaps with this scenario's, so every line keeps its own colour
        return list.map((d) => (d.key === key ? { ...d, slot } : d.slot === slot ? { ...d, slot: me.slot } : d));
    });
    const add = () => {
        if (drafts.length >= MAX) return;
        const used = new Set(drafts.map((d) => d.slot));
        const slot = [...Array(MAX).keys()].find((s) => !used.has(s)) ?? 0;
        const last = drafts[drafts.length - 1];
        setDrafts([...drafts, { key: nextKey, label: '', labelEdited: false, portfolio: last?.portfolio ?? 'current', strategy: '', slot }]);
        setNextKey(nextKey + 1);
    };
    const remove = (key: number) => setDrafts((list) => list.filter((d) => d.key !== key));

    const capital = Number(shared.capital);
    const fee = Number(shared.fee);
    const valid = drafts.length > 0
        && Number.isFinite(capital) && capital >= 100 && capital <= 100_000_000
        && Number.isFinite(fee) && fee >= 0 && fee <= 100
        && /^\d{4}-\d{2}-\d{2}$/.test(shared.startDate)
        && shown.every((d) => d.label.trim().length > 0);

    const portfolioBody = (value: string): unknown => {
        if (isPersonaName(value)) return Object.entries(PERSONAS[value].weights).map(([symbol, weightPct]) => ({ symbol, weightPct }));
        if (value.startsWith('model:')) return models.find((m) => `model:${m.id}` === value)?.weights ?? 'current';
        return 'current';
    };
    const strategyBody = (value: string): unknown => {
        if (value.startsWith('own:')) return value.slice(4);
        if (value.startsWith('sugg:')) return suggestions.find((s) => `sugg:${s.id}` === value)?.strategy ?? null;
        return null;
    };

    // the colour of each returned scenario, in the order sent
    const [slots, setSlots] = useState<number[]>([]);

    const run = async () => {
        if (!valid || running) return;
        setRunning(true);
        setError(null);
        const sent = shown;
        try {
            const res = await fetch('/api/replay/compare', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    scenarios: sent.map((d) => ({ label: d.label.trim(), portfolio: portfolioBody(d.portfolio), strategy: strategyBody(d.strategy) })),
                    capitalCad: capital,
                    startDate: shared.startDate,
                    feePerOrderCad: fee,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : t('states.errorGeneric'));
            const compare = json.compare as CompareResult;
            setSlots(sent.map((d) => d.slot));
            setResult(compare);
            player.reset(compare.dates.length);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('states.errorGeneric'));
        } finally {
            setRunning(false);
        }
    };

    const failed = useMemo(() => (result?.scenarios ?? []).filter((s) => !s.ok), [result]);
    const replayed = useMemo(() => (result?.scenarios ?? []).flatMap((s, i) => (s.ok ? [{ s, slot: slots[i] ?? i }] : [])), [result, slots]);
    const trimmed = !!result?.window && replayed.some(({ s }) => s.window.from !== result.window!.from || s.window.to !== result.window!.to);

    return (
        <div className="flex flex-col gap-4" style={SERIES_VARS}>
            <Panel title={t('multi.title')} sub={t('multi.sub')} bodyClassName="p-4">
                <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void run(); }}>
                    <p className="flex items-start gap-2 rounded-[10px] bg-canvas px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
                        <Scale className="mt-0.5 size-4 flex-none text-brand" aria-hidden />
                        {t('multi.fair')}
                    </p>

                    {/* the settings every scenario shares */}
                    <fieldset className="grid gap-3 sm:grid-cols-[1fr_1fr] lg:grid-cols-[1fr_2fr_1fr]">
                        <legend className="sr-only">{t('multi.shared')}</legend>
                        <label className="flex flex-col gap-1.5">
                            <span className="form-label">{t('controls.capital')}</span>
                            <div className="relative">
                                <input type="number" inputMode="decimal" min={100} max={100000000} step={100} className={`${fieldClass} num pe-14`} value={shared.capital} onChange={(e) => setShared({ ...shared, capital: e.target.value })} />
                                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{t('controls.cad')}</span>
                            </div>
                        </label>
                        <div className="flex flex-col gap-1.5 sm:order-last sm:col-span-2 lg:order-none lg:col-span-1">
                            <span className="form-label" id="cmp-start-label">{t('controls.startDate')}</span>
                            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="cmp-start-label">
                                {START_CHIPS.map((d) => (
                                    <button key={d} type="button" aria-pressed={shared.startDate === d} onClick={() => setShared({ ...shared, startDate: d })}
                                        className={`btn btn-ghost h-10 px-3 text-[13px] ${shared.startDate === d ? 'is-on' : ''}`}>{f.date(d)}</button>
                                ))}
                                <input type="date" aria-label={t('controls.otherDate')} className={`${fieldClass} num w-auto min-w-[150px] flex-1`} value={shared.startDate}
                                    min={window?.from} max={window?.to} onChange={(e) => setShared({ ...shared, startDate: e.target.value })} />
                            </div>
                        </div>
                        <label className="flex flex-col gap-1.5">
                            <span className="form-label">{t('controls.fee')}</span>
                            <div className="relative">
                                <input type="number" inputMode="decimal" min={0} max={100} step={0.5} className={`${fieldClass} num pe-14`} value={shared.fee} onChange={(e) => setShared({ ...shared, fee: e.target.value })} />
                                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{t('controls.cad')}</span>
                            </div>
                        </label>
                    </fieldset>

                    {/* the scenarios */}
                    <ol className="flex flex-col gap-2.5">
                        {shown.map((d, i) => (
                            <li key={d.key} className="rounded-[12px] border border-line bg-card p-3" style={{ boxShadow: `inset 3px 0 0 ${seriesColor(d.slot)}` }}>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-2 text-[12.5px] font-bold text-muted-foreground">
                                        <span className="inline-block h-[3px] w-4 rounded" style={{ background: seriesColor(d.slot) }} />
                                        {t('multi.scenario', { n: i + 1 })}
                                    </span>
                                    <button type="button" className="icon-btn" onClick={() => remove(d.key)} disabled={drafts.length <= 1} aria-label={t('multi.remove', { label: d.label })}><X /></button>
                                </div>
                                <div className="grid gap-2.5 md:grid-cols-[1.2fr_1fr_1fr_auto]">
                                    <label className="flex min-w-0 flex-col gap-1">
                                        <span className="form-label">{t('multi.label')}</span>
                                        <input className={fieldClass} maxLength={40} value={d.label} onChange={(e) => update(d.key, { label: e.target.value, labelEdited: e.target.value.trim().length > 0 })} />
                                    </label>
                                    <label className="flex min-w-0 flex-col gap-1">
                                        <span className="form-label">{t('controls.portfolio')}</span>
                                        <select className={fieldClass} value={d.portfolio} onChange={(e) => update(d.key, { portfolio: e.target.value })}>
                                            <option value="current">{t('controls.current')}</option>
                                            {models.length > 0 && (
                                                <optgroup label={t('controls.models')}>
                                                    {models.map((m) => <option key={m.id} value={`model:${m.id}`}>{m.name}</option>)}
                                                </optgroup>
                                            )}
                                            <optgroup label={t('controls.examples')}>
                                                {PERSONA_NAMES.map((p) => <option key={p} value={p}>{t(`controls.personas.${p}`, { name: PERSONAS[p].displayName })}</option>)}
                                            </optgroup>
                                        </select>
                                    </label>
                                    <label className="flex min-w-0 flex-col gap-1">
                                        <span className="form-label">{t('controls.strategy')}</span>
                                        <select className={fieldClass} value={d.strategy} onChange={(e) => update(d.key, { strategy: e.target.value })} disabled={strategies === null}>
                                            <option value="">{t('controls.noRules')}</option>
                                            {(strategies ?? []).length > 0 && (
                                                <optgroup label={t('multi.ownStrategies')}>
                                                    {(strategies ?? []).map((s) => <option key={s.id} value={`own:${s.id}`}>{t('controls.strategyOption', { name: s.name, count: s.ruleCount })}</option>)}
                                                </optgroup>
                                            )}
                                            {suggestions.length > 0 && (
                                                <optgroup label={t('multi.suggestions')}>
                                                    {suggestions.map((s) => <option key={s.id} value={`sugg:${s.id}`}>{s.name}</option>)}
                                                </optgroup>
                                            )}
                                        </select>
                                    </label>
                                    <div className="flex flex-col gap-1">
                                        <span className="form-label" id={`cmp-color-${d.key}`}>{t('multi.color')}</span>
                                        <div className="flex h-10 items-center gap-1" role="radiogroup" aria-labelledby={`cmp-color-${d.key}`}>
                                            {[...Array(MAX).keys()].map((slot) => (
                                                <button key={slot} type="button" role="radio" aria-checked={d.slot === slot} aria-label={t('multi.colorN', { n: slot + 1 })} onClick={() => pickColor(d.key, slot)}
                                                    className={`size-6 rounded-full outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring ${d.slot === slot ? 'ring-2 ring-foreground/70 ring-offset-2 ring-offset-card' : 'hover:scale-110'}`}
                                                    style={{ background: seriesColor(slot) }} />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ol>
                    {strategies !== null && drafts.length === 0 && <p className="text-[12.5px] text-faint">{t('multi.empty')}</p>}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" className="btn btn-ghost h-10 px-3 text-[13px]" onClick={add} disabled={drafts.length >= MAX || strategies === null}>
                                <Plus /> {t('multi.add')}
                            </button>
                            {strategies !== null && <span className="text-[12px] text-faint">{t('multi.count', { n: drafts.length, max: MAX })}</span>}
                        </div>
                        <button type="submit" className="btn btn-primary h-10 px-5" disabled={!valid || running}>
                            {running ? <Loader2 className="animate-spin" /> : <GitCompareArrows />}
                            {running ? t('multi.running') : t('multi.run')}
                        </button>
                    </div>
                </form>
            </Panel>

            {error && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-card px-4 py-3 text-[13.5px] text-down">
                    <span>{t('states.error', { message: error })}</span>
                    <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={() => void run()}>{t('states.retry')}</button>
                </div>
            )}

            {!result && !running && !error && (
                <p className="rounded-[12px] border border-dashed border-line px-3.5 py-2.5 text-[12.5px] text-faint">{t('multi.idle')}</p>
            )}
            {!result && running && (
                <div className="flex flex-col gap-3" aria-busy="true">
                    <p className="text-[13.5px] text-faint">{t('multi.running')}</p>
                    {[320, 200].map((h) => <div key={h} className="xray-shimmer rounded-[14px]" style={{ height: h }} />)}
                </div>
            )}

            {result && (
                <div className={`flex flex-col gap-4 transition-opacity ${running ? 'pointer-events-none opacity-50' : ''}`} aria-busy={running}>
                    <div className="flex flex-wrap items-center gap-2 px-1 text-[12.5px] text-faint">
                        {result.window && <span>{t('ids.window', { from: f.date(result.window.from), to: f.date(result.window.to), days: f.num(result.window.tradingDays) })}</span>}
                        {result.window && <span>·</span>}
                        <span>{t('ids.capital', { amount: f.money(result.capitalCad), fee: f.money(result.feePerOrderCad, 2) })}</span>
                        {result.snapshotId && (
                            <span className="ms-auto flex flex-wrap gap-1.5">
                                <CopyId label={t('ids.snapshot')} value={result.snapshotId} />
                            </span>
                        )}
                    </div>
                    {result.window && result.requestedStartDate !== result.window.from && (
                        <p className="px-1 text-[12.5px] text-faint">{t('ids.startMoved', { asked: f.date(result.requestedStartDate), from: f.date(result.window.from) })}</p>
                    )}
                    {trimmed && result.window && <p className="px-1 text-[12.5px] text-faint">{t('multi.windowTrimmed', { from: f.date(result.window.from), to: f.date(result.window.to) })}</p>}

                    {failed.length > 0 && (
                        <div role="status" className="rounded-[12px] border border-line bg-card px-4 py-3 text-[13px]">
                            <p className="flex items-center gap-2 font-bold text-foreground"><TriangleAlert className="size-4 text-warn" aria-hidden />{t('multi.failedTitle')}</p>
                            <ul className="mt-1.5 flex flex-col gap-1 text-muted-foreground">
                                {failed.map((s, k) => <li key={k}>{t('multi.failed', { label: s.label, message: s.ok ? '' : s.error })}</li>)}
                            </ul>
                        </div>
                    )}

                    {replayed.length === 0 ? (
                        <div className="hatch"><div className="card empty-state">
                            <span className="empty-icon"><TriangleAlert className="size-5" /></span>
                            <h3>{t('multi.noneReplayed')}</h3>
                            <p className="max-w-lg text-[12.5px]">{t('states.nothingHint')}</p>
                        </div></div>
                    ) : (
                        <>
                            <Panel title={t('multi.chartTitle')} sub={t('multi.chartSub')} bodyClassName="p-4">
                                <CompareChart result={result} scenarios={replayed} player={player} />
                            </Panel>

                            <Panel title={t('multi.tableTitle')} sub={t('multi.tableSub')} bodyClassName="p-4">
                                <CompareTable scenarios={replayed} />
                            </Panel>

                            <div className="flex flex-wrap gap-2 px-1">
                                {replayed.map(({ s, slot }) => (
                                    <Link key={s.replayId} href={`/time-machine?replay=${encodeURIComponent(s.replayId)}`} onClick={forgetKeptScroll} className="btn btn-ghost h-8 gap-1.5 px-3 text-[12.5px]">
                                        <span className="inline-block h-[3px] w-3.5 rounded" style={{ background: seriesColor(slot) }} />
                                        {t('multi.openFullOf', { label: s.label })}
                                        <ExternalLink className="size-3.5" />
                                    </Link>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
