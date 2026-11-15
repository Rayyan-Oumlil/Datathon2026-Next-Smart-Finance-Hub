'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, History, Info, MessageSquareText, Rewind, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Panel from '@/components/Panel';
import { StrategySummary } from '@/components/strategy';
import { askAgent } from '@/lib/agent/page-detail';
import { PERSONAS, isPersonaName } from '@/lib/personas/presets';
import type { ReplayOrder, ReplayResult } from '@/lib/replay/engine/types';
import { strategyRef } from '@/lib/strategy/text';
import { renderText } from '@/lib/watchlist/text';
import Comparison, { GapChart } from './Comparison';
import CompareMode from './CompareMode';
import CopyId from './CopyId';
import Controls, { type ControlsValue, type ModelOption, type StrategyOption } from './Controls';
import DatasetPanel, { type DatasetInfo } from './DatasetPanel';
import EventDetail from './EventDetail';
import Journal from './Journal';
import ReplayChart, { type BenchId } from './ReplayChart';
import Sensitivity from './Sensitivity';
import { Caveats, Effects, SummaryText } from './Summary';
import { usePlayer } from './usePlayer';
import { useReplayFmt } from './useReplayFmt';

type Status = 'idle' | 'running' | 'done' | 'error';
type Failure = { message: string; kind: 'nothing' | 'generic' };

const DEFAULTS: ControlsValue = { portfolio: 'current', strategy: '', capital: '10000', startDate: '2021-01-04', fee: '0' };

/**
 * GET /api/model-portfolios: { options: [{ id, name, lines: [{ symbol, weightPct }] }] }, the three suggested options of
 * the visitor's profile, names already in the request language. A 409 (no profile yet) never reaches this function.
 */
function parseModels(json: unknown): ModelOption[] {
    const list = (json as { options?: unknown })?.options;
    if (!Array.isArray(list)) return [];
    const out: ModelOption[] = [];
    for (const raw of list as Array<{ id?: unknown; name?: unknown; lines?: unknown }>) {
        if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.lines)) continue;
        const weights = (raw.lines as Array<{ symbol?: unknown; weightPct?: unknown }>)
            .map((line) => ({ symbol: typeof line.symbol === 'string' ? line.symbol : '', weightPct: Number(line.weightPct) }))
            .filter((line) => line.symbol && Number.isFinite(line.weightPct) && line.weightPct > 0);
        if (weights.length) out.push({ id: raw.id, name: raw.name, weights });
    }
    return out;
}

type Mode = 'single' | 'compare';
type Props = { initialStrategyId?: string; replayId?: string; initialMode?: Mode };

// The time machine: replays a portfolio on the frozen snapshot without and with a strategy, side by side.
// Everything shown comes from the engine's result; this component only lays it out.
export default function TimeMachine({ initialStrategyId, replayId, initialMode }: Props) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const player = usePlayer();
    const [controls, setControls] = useState<ControlsValue>({ ...DEFAULTS, strategy: initialStrategyId ?? '' });
    const [strategies, setStrategies] = useState<StrategyOption[] | null>(null);
    const [models, setModels] = useState<ModelOption[]>([]);
    const [dataset, setDataset] = useState<DatasetInfo | null>(null);
    const [datasetError, setDatasetError] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const [failure, setFailure] = useState<Failure | null>(null);
    const [result, setResult] = useState<ReplayResult | null>(null);
    const [lastBody, setLastBody] = useState<Record<string, unknown> | null>(null);
    const [selected, setSelected] = useState<number | null>(null);
    const [benches, setBenches] = useState<BenchId[]>([]);
    const [mode, setMode] = useState<Mode>(replayId ? 'single' : initialMode ?? 'single');

    // a replay opened from the comparison (?replay=<id>) is shown in the single-run view
    useEffect(() => { if (replayId) setMode('single'); }, [replayId]);

    // the visitor's strategies, the snapshot description, and the suggested portfolios of the visitor's profile
    useEffect(() => {
        fetch('/api/strategy').then((r) => r.json()).then((json) => {
            const list = Array.isArray(json?.strategies) ? json.strategies as Array<{ id: string; name: string; rules?: unknown[] }> : [];
            setStrategies(list.map((s) => ({ id: s.id, name: s.name, ruleCount: s.rules?.length ?? 0 })));
        }).catch(() => setStrategies([]));
        fetch('/api/replay/dataset').then(async (r) => {
            const json = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : t('states.errorGeneric'));
            setDataset(json.dataset as DatasetInfo);
        }).catch((e: Error) => setDatasetError(e.message));
        // 409 = no profile yet: the suggested options are simply not offered
        fetch('/api/model-portfolios').then((r) => (r.ok ? r.json() : null)).then((json) => setModels(json ? parseModels(json) : [])).catch(() => setModels([]));
    }, [t]);

    // a strategy id in the address that the visitor does not hold falls back to "no rule"
    useEffect(() => {
        if (!strategies || !controls.strategy) return;
        if (!strategies.some((s) => s.id === controls.strategy)) setControls((c) => ({ ...c, strategy: '' }));
    }, [strategies, controls.strategy]);

    const classify = useCallback((message: string): Failure => {
        const nothing = ['strat.replay.nothing_to_replay', 'strat.replay.empty_portfolio'] as const;
        const known = nothing.flatMap((key) => [renderText(strategyRef(key), 'fr'), renderText(strategyRef(key), 'en')]);
        return { message, kind: known.includes(message) ? 'nothing' : 'generic' };
    }, []);

    const show = useCallback((replay: ReplayResult) => {
        setResult(replay);
        setSelected(null);
        setStatus('done');
        player.reset(replay.dates.length);
    }, [player.reset]); // eslint-disable-line react-hooks/exhaustive-deps

    const bodyFor = (c: ControlsValue): Record<string, unknown> => {
        let portfolio: unknown = 'current';
        if (isPersonaName(c.portfolio)) portfolio = Object.entries(PERSONAS[c.portfolio].weights).map(([symbol, weightPct]) => ({ symbol, weightPct }));
        else if (c.portfolio.startsWith('model:')) portfolio = models.find((m) => `model:${m.id}` === c.portfolio)?.weights ?? 'current';
        return { portfolio, capitalCad: Number(c.capital), strategy: c.strategy || null, startDate: c.startDate, feePerOrderCad: Number(c.fee) };
    };

    const run = async (body: Record<string, unknown>) => {
        setStatus('running');
        setFailure(null);
        try {
            const res = await fetch('/api/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : t('states.errorGeneric'));
            setLastBody(body);
            show(json.replay as ReplayResult);
        } catch (e) {
            setFailure(classify(e instanceof Error ? e.message : t('states.errorGeneric')));
            setStatus('error');
        }
    };

    // a replay opened by id (a sensitivity variant): GET /api/replay?id=...
    useEffect(() => {
        if (!replayId) return;
        let gone = false;
        setStatus('running');
        setFailure(null);
        fetch(`/api/replay?id=${encodeURIComponent(replayId)}`).then(async (res) => {
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : t('states.errorGeneric'));
            if (gone) return;
            const replay = json.replay as ReplayResult;
            const p = replay.params;
            setLastBody({ portfolio: p.requestedPortfolio, capitalCad: p.capitalCad, strategy: p.strategy.rules.length ? p.strategy : null, startDate: p.requestedStartDate, feePerOrderCad: p.feePerOrderCad });
            setControls((c) => ({ ...c, capital: String(p.capitalCad), startDate: p.requestedStartDate, fee: String(p.feePerOrderCad) }));
            show(replay);
        }).catch((e: Error) => { if (!gone) { setFailure(classify(e.message)); setStatus('error'); } });
        return () => { gone = true; };
    }, [replayId, show, classify, t]);

    const ordersById = useMemo(() => new Map((result?.orders ?? []).map((o) => [o.id, o] as [string, ReplayOrder])), [result]);
    const eventOfOrder = useMemo(() => {
        const map = new Map<string, number>();
        result?.ruleEvents.forEach((e, i) => e.orderIds.forEach((id) => map.set(id, i)));
        return map;
    }, [result]);

    // selecting an event (marker, journal row, previous / next) moves the cursor to its execution day
    const select = (eventIndex: number | null) => {
        setSelected(eventIndex);
        if (eventIndex === null || !result) return;
        const event = result.ruleEvents[eventIndex];
        const i = result.dates.indexOf(event?.executionDay ?? '');
        if (i >= 0) {
            player.setPlaying(false);
            if (i > player.cursor) player.setCursor(i);
        }
    };

    const strategyName = result ? (result.params.strategy.rules.length ? result.params.strategy.name || t('ids.unnamed') : t('controls.noRules')) : '';

    return (
        <div className="flex flex-col gap-4">
            <header className="page-head">
                <div>
                    <h1 className="page-title flex flex-wrap items-center gap-2">
                        <History className="size-6 text-brand" aria-hidden />
                        {t('page.title')}
                        <span className="pill is-brand">{t('page.illustrative')}</span>
                    </h1>
                    <p className="page-sub max-w-2xl">{t('page.sub')}</p>
                </div>
                {mode === 'single' && result && (
                    <button type="button" className="btn btn-ghost h-9 px-3 text-[13px]" onClick={() => askAgent(t('page.askMessage', { id: result.replayId }))}>
                        <MessageSquareText /> {t('page.ask')}
                    </button>
                )}
            </header>

            {/* permanent label */}
            <p className="flex items-center gap-2 rounded-[12px] border border-line bg-card px-3.5 py-2.5 text-[13px] font-semibold text-foreground" role="note">
                <Info className="size-4 flex-none text-brand" aria-hidden />
                {t('page.label')}
            </p>

            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t('multi.modes')}>
                {(['single', 'compare'] as const).map((m) => (
                    <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                        className={`btn btn-ghost h-9 gap-1.5 px-3.5 text-[13px] ${mode === m ? 'is-on' : ''}`}>
                        {m === 'single' ? <Rewind /> : <GitCompareArrows />}
                        {m === 'single' ? t('multi.tabSingle') : t('multi.tabCompare')}
                    </button>
                ))}
            </div>

            {mode === 'compare' && <CompareMode strategies={strategies} models={models} window={dataset?.window ?? null} />}

            {mode === 'single' && <>
            <Panel title={t('controls.title')} sub={t('controls.sub')} bodyClassName="p-4">
                <Controls
                    value={controls}
                    onChange={setControls}
                    onRun={() => void run(bodyFor(controls))}
                    running={status === 'running'}
                    strategies={strategies}
                    models={models}
                    window={dataset?.window ?? null}
                />
            </Panel>

            {status === 'error' && failure && (
                failure.kind === 'nothing' ? (
                    <div className="hatch"><div className="card empty-state">
                        <span className="empty-icon"><TriangleAlert className="size-5" /></span>
                        <h3>{t('states.nothingTitle')}</h3>
                        <p className="max-w-lg text-[13px]">{failure.message}</p>
                        <p className="max-w-lg text-[12.5px]">{t('states.nothingHint')}</p>
                    </div></div>
                ) : (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-card px-4 py-3 text-[13.5px] text-down">
                        <span>{t('states.error', { message: failure.message })}</span>
                        {lastBody && <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={() => void run(lastBody)}>{t('states.retry')}</button>}
                    </div>
                )
            )}

            {!result && status === 'idle' && (
                <div className="hatch"><div className="card px-5 py-6">
                    <h2 className="text-[16px] font-bold text-foreground">{t('idle.title')}</h2>
                    <ol className="mt-3 grid gap-3 text-[13px] leading-relaxed text-muted-foreground md:grid-cols-3">
                        {(['one', 'two', 'three'] as const).map((k, i) => (
                            <li key={k} className="rounded-[12px] bg-canvas px-3.5 py-3">
                                <span className="num mb-1 block text-[12px] font-bold text-brand-ink">{i + 1}</span>
                                {t(`idle.${k}`)}
                            </li>
                        ))}
                    </ol>
                </div></div>
            )}

            {!result && status === 'running' && (
                <div className="flex flex-col gap-3" aria-busy="true">
                    <p className="text-[13.5px] text-faint">{t('states.running')}</p>
                    {[120, 320].map((h) => <div key={h} className="xray-shimmer rounded-[14px]" style={{ height: h }} />)}
                </div>
            )}

            {result && (
                <div className={`flex flex-col gap-4 transition-opacity ${status === 'running' ? 'pointer-events-none opacity-50' : ''}`} aria-busy={status === 'running'}>
                    <div className="flex flex-wrap items-center gap-2 px-1 text-[12.5px] text-faint">
                        <span className="font-semibold text-foreground">{strategyName}</span>
                        <span>·</span>
                        <span>{t('ids.window', { from: f.date(result.window.from), to: f.date(result.window.to), days: f.num(result.window.tradingDays) })}</span>
                        <span>·</span>
                        <span>{t('ids.capital', { amount: f.money(result.params.capitalCad), fee: f.money(result.params.feePerOrderCad, 2) })}</span>
                        <span className="ms-auto flex flex-wrap gap-1.5">
                            <CopyId label={t('ids.snapshot')} value={result.snapshotId} />
                            <CopyId label={t('ids.replay')} value={result.replayId} />
                        </span>
                    </div>
                    {status === 'running' && <p className="px-1 text-[13px] text-faint">{t('states.running')}</p>}
                    {result.params.requestedStartDate !== result.window.from && (
                        <p className="px-1 text-[12.5px] text-faint">{t('ids.startMoved', { asked: f.date(result.params.requestedStartDate), from: f.date(result.window.from) })}</p>
                    )}

                    <Panel title={t('chart.title')} sub={t('chart.sub')} bodyClassName="p-4">
                        <ReplayChart
                            result={result}
                            player={player}
                            benches={benches}
                            onToggleBench={(id) => setBenches((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]))}
                            selected={selected}
                            onSelect={select}
                        />
                        <div className="mt-4">
                            {selected !== null ? (
                                <EventDetail result={result} eventIndex={selected} ordersById={ordersById} onSelect={select} />
                            ) : (
                                <p className="rounded-[12px] border border-dashed border-line px-3.5 py-2.5 text-[12.5px] text-faint">
                                    {result.ruleEvents.length > 0 ? t('event.hint', { count: result.ruleEvents.length }) : result.params.strategy.rules.length ? t('event.none') : t('event.noRules')}
                                </p>
                            )}
                        </div>
                    </Panel>

                    <Panel title={t('summary.title')} sub={t('summary.sub')} bodyClassName="p-4">
                        {result.params.strategy.rules.length > 0 && (
                            <StrategySummary
                                className="mb-4"
                                strategy={{ name: strategyName, rules: result.params.strategy.rules }}
                                firings={Object.fromEntries(result.ruleStats.map((stat) => [stat.ruleId, stat.fired]))}
                            />
                        )}
                        <SummaryText result={result} />
                    </Panel>

                    <Panel title={t('compare.title')} sub={t('compare.sub')} bodyClassName="p-4 flex flex-col gap-5">
                        <Comparison result={result} />
                        <GapChart result={result} cursor={player.cursor} />
                    </Panel>

                    <Panel title={t('journal.title')} sub={t('journal.sub')} bodyClassName="p-4">
                        <Journal result={result} eventOfOrder={eventOfOrder} selected={selected} onSelect={select} />
                    </Panel>

                    <Panel title={t('effects.title')} sub={t('effects.sub')} bodyClassName="p-4">
                        <Effects result={result} />
                    </Panel>

                    <Panel title={t('sensitivity.title')} sub={t('sensitivity.sub')} bodyClassName="p-4">
                        <Sensitivity result={result} body={{
                            portfolio: result.params.requestedPortfolio, capitalCad: result.params.capitalCad, startDate: result.params.requestedStartDate,
                            feePerOrderCad: result.params.feePerOrderCad, strategy: result.params.strategy.rules.length ? result.params.strategy : null,
                        }} />
                    </Panel>

                    <Panel title={t('caveats.title')} bodyClassName="p-4">
                        <Caveats result={result} />
                    </Panel>
                </div>
            )}

            </>}

            <DatasetPanel dataset={dataset} error={datasetError} />
        </div>
    );
}
