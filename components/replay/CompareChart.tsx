'use client';

import { useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Pause, Pin, Play, RotateCcw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CompareResult, CompareScenarioOk } from '@/lib/services/replay';
import { seriesColor } from './palette';
import { ruleColor } from './rules';
import { SPEEDS, type Player } from './usePlayer';
import { useReplayFmt } from './useReplayFmt';

const W = 1000;
const H = 320;
const PAD = 0.07;

export type Replayed = { s: CompareScenarioOk; slot: number };
type Unit = 'index' | 'value';
type BenchId = 'XIU.TO' | '60_40';
// dashed, and neither of the scenario colours
const BENCH_STROKE: Record<string, string> = { 'XIU.TO': 'var(--text)', '60_40': 'var(--faint)' };

type Props = { result: CompareResult; scenarios: Replayed[]; player: Player };

// One line per scenario on the same axes (index base 100 or CAD value), the optional benchmarks, calendar 2022 shaded,
// a date cursor with play / pause, and the rule firings of one highlighted scenario only.
export default function CompareChart({ result, scenarios, player }: Props) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const area = useRef<HTMLDivElement>(null);
    const [unit, setUnit] = useState<Unit>('index');
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const [hover, setHover] = useState<string | null>(null);
    const [pinned, setPinned] = useState<string | null>(null);
    const [benches, setBenches] = useState<BenchId[]>([]);
    const [firing, setFiring] = useState<{ id: string; k: number } | null>(null);
    const n = result.dates.length;
    const cursor = Math.min(player.cursor, Math.max(0, n - 1));

    const visible = scenarios.filter(({ s }) => !hidden.has(s.replayId));
    const highlighted = hover ?? pinned;
    const focus = scenarios.find(({ s }) => s.replayId === highlighted && !hidden.has(s.replayId)) ?? null;
    const available = result.benchmarks.filter((b) => b.available && b.index.length === n);
    const shownBenches = available.filter((b) => benches.includes(b.id as BenchId));
    const pick = (o: { index: number[]; valueCad: number[] }) => (unit === 'index' ? o.index : o.valueCad);
    const base = unit === 'index' ? 100 : result.capitalCad;

    const geo = useMemo(() => {
        const all = [...visible.map(({ s }) => pick(s.series)), ...shownBenches.map((b) => pick(b))];
        let low = base;
        let high = base;
        for (const series of all) for (const v of series) { if (v < low) low = v; if (v > high) high = v; }
        const span = high - low || 1;
        low -= span * PAD;
        high += span * PAD;
        const x = (i: number) => (n > 1 ? i / (n - 1) : 0);
        const y = (v: number) => 1 - (v - low) / (high - low);
        const pts = (s: number[]) => s.map((v, i) => `${(x(i) * W).toFixed(1)},${(y(v) * H).toFixed(1)}`);
        const raw = (high - low) / 4;
        const mag = 10 ** Math.floor(Math.log10(raw));
        const stepSize = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
        const ticks: number[] = [];
        for (let v = Math.ceil(low / stepSize) * stepSize; v <= high; v += stepSize) ticks.push(v);
        const years: Array<{ i: number; year: string }> = [];
        result.dates.forEach((d, i) => { if (i === 0 || d.slice(0, 4) !== result.dates[i - 1].slice(0, 4)) years.push({ i, year: d.slice(0, 4) }); });
        const in2022 = result.dates.map((d, i) => (d.startsWith('2022') ? i : -1)).filter((i) => i >= 0);
        return {
            x, y, ticks, years,
            band: in2022.length ? { from: x(in2022[0]), to: x(in2022[in2022.length - 1]) } : null,
            lines: Object.fromEntries(scenarios.map(({ s }) => [s.replayId, pts(pick(s.series))])) as Record<string, string[]>,
            benches: Object.fromEntries(shownBenches.map((b) => [b.id, pts(pick(b))])) as Record<string, string[]>,
        };
    }, [result, scenarios, visible.length, hidden, shownBenches.length, benches, unit, n]); // eslint-disable-line react-hooks/exhaustive-deps

    const byDate = useMemo(() => new Map(result.dates.map((d, i) => [d, i])), [result]);
    const markers = useMemo(() => (focus ? focus.s.firings.map((e, k) => ({ e, k, i: byDate.get(e.executionDay) ?? -1 })).filter((m) => m.i >= 0) : []), [focus, byDate]);
    const shownFiring = focus && firing && firing.id === focus.s.replayId ? focus.s.firings[firing.k] ?? null : null;

    const upTo = (p: string[]) => p.slice(0, cursor + 1).join(' ');
    const fmt = (v: number) => (unit === 'index' ? f.num(v, 1) : f.money(v));
    const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
        const box = area.current?.getBoundingClientRect();
        if (!box || n < 2) return;
        const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        player.setPlaying(false);
        player.setCursor(Math.round(ratio * (n - 1)));
    };
    const toggleHidden = (id: string) => setHidden((now) => {
        const next = new Set(now);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const togglePin = (id: string) => { setFiring(null); setPinned((p) => (p === id ? null : id)); };
    const ruleLabel = (kind: string, number: number) => t('rule.name', { kind: t(`kinds.${kind}`), n: number });
    const dim = (id: string) => (focus && focus.s.replayId !== id ? 0.3 : 1);

    if (n === 0) return <p className="text-[13px] text-faint">{t('multi.noneReplayed')}</p>;

    return (
        <div className="flex flex-col gap-4">
            {/* legend: each scenario's value at the cursor; click hides or shows the line, hover or pin shows its firings */}
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('multi.legend')}>
                {scenarios.map(({ s, slot }) => {
                    const off = hidden.has(s.replayId);
                    const isPinned = pinned === s.replayId;
                    const now = pick(s.series)[cursor];
                    return (
                        <li key={s.replayId}
                            className={`flex min-w-0 items-stretch rounded-[12px] border bg-card transition-opacity ${focus?.s.replayId === s.replayId ? 'border-line-strong' : 'border-line'} ${off ? 'opacity-50' : ''}`}
                            onMouseEnter={() => setHover(s.replayId)} onMouseLeave={() => setHover(null)}>
                            <button type="button" className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[12px]"
                                onClick={() => toggleHidden(s.replayId)} aria-pressed={!off} onFocus={() => setHover(s.replayId)} onBlur={() => setHover(null)}
                                aria-label={off ? t('multi.show', { label: s.label }) : t('multi.hide', { label: s.label })}>
                                <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                                    <span className="inline-block h-[3px] w-4 flex-none rounded" style={{ background: seriesColor(slot) }} />
                                    <span className="truncate">{s.label}</span>
                                    {off ? <EyeOff className="ms-auto size-3.5 flex-none" aria-hidden /> : <Eye className="ms-auto size-3.5 flex-none opacity-50" aria-hidden />}
                                </span>
                                <span className="num truncate text-[18px] font-bold leading-none tracking-[-0.03em] text-foreground">{fmt(now)}</span>
                                <span className="num truncate text-[11.5px] text-faint">{t('chart.sinceStart', { pct: f.signedPct(s.series.index[cursor] - 100) })}</span>
                            </button>
                            {s.ruleCount > 0 && (
                                <button type="button" className={`icon-btn m-1 self-start ${isPinned ? 'is-on' : ''}`} onClick={() => togglePin(s.replayId)} aria-pressed={isPinned}
                                    aria-label={t('multi.pin', { label: s.label })} title={t('multi.pin', { label: s.label })}>
                                    <Pin />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('multi.unit')}>
                    {(['index', 'value'] as const).map((u) => (
                        <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => setUnit(u)}
                            className={`btn btn-ghost h-7 px-2.5 text-[12px] ${unit === u ? 'is-on' : ''}`}>
                            {u === 'index' ? t('multi.unitIndex') : t('multi.unitValue')}
                        </button>
                    ))}
                    <span className="ms-2 flex items-center gap-1.5 text-faint"><span className="inline-block size-2.5 rounded-[3px] bg-hover ring-1 ring-line" />{t('chart.year2022')}</span>
                </div>
                {available.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('chart.benchmarks')}>
                        <span className="text-faint">{t('chart.benchmarks')}</span>
                        {available.map((b) => {
                            const on = benches.includes(b.id as BenchId);
                            return (
                                <button key={b.id} type="button" aria-pressed={on} onClick={() => setBenches((list) => (on ? list.filter((x) => x !== b.id) : [...list, b.id as BenchId]))}
                                    className={`btn btn-ghost h-7 gap-1.5 px-2.5 text-[12px] ${on ? 'is-on' : ''}`}>
                                    <span className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: BENCH_STROKE[b.id] }} />
                                    {b.id === 'XIU.TO' ? 'XIU.TO' : '60/40'}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex gap-2">
                <div className="num relative w-14 flex-none text-right text-[11px] text-faint" style={{ height: H }} aria-hidden>
                    {geo.ticks.map((v) => (
                        <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${geo.y(v) * 100}%` }}>{unit === 'index' ? f.num(v, 0) : f.money(v)}</span>
                    ))}
                </div>
                <div className="min-w-0 flex-1">
                    <div ref={area} className="relative w-full cursor-crosshair touch-none select-none" style={{ height: H }}
                        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
                        onPointerMove={(e) => { if (e.buttons === 1) scrub(e); }}>
                        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" role="img"
                            aria-label={t('multi.aria', { count: scenarios.length, from: f.date(result.dates[0]), to: f.date(result.dates[n - 1]) })}>
                            {geo.band && <rect x={geo.band.from * W} width={(geo.band.to - geo.band.from) * W} y={0} height={H} fill="var(--hover)" />}
                            {geo.ticks.map((v) => (
                                <line key={v} x1={0} x2={W} y1={geo.y(v) * H} y2={geo.y(v) * H} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            ))}
                            <line x1={0} x2={W} y1={geo.y(base) * H} y2={geo.y(base) * H} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                            {shownBenches.map((b) => (
                                <polyline key={b.id} points={upTo(geo.benches[b.id] ?? [])} fill="none" stroke={BENCH_STROKE[b.id]} strokeWidth={1.5} strokeDasharray="5 4" opacity={focus ? 0.4 : 0.8} vectorEffect="non-scaling-stroke" />
                            ))}
                            {visible.map(({ s, slot }) => (
                                <polyline key={s.replayId} points={upTo(geo.lines[s.replayId])} fill="none" stroke={seriesColor(slot)}
                                    strokeWidth={focus?.s.replayId === s.replayId ? 3 : 2} strokeLinejoin="round" opacity={dim(s.replayId)}
                                    vectorEffect="non-scaling-stroke" style={{ transition: 'opacity 150ms' }} />
                            ))}
                            <line x1={geo.x(cursor) * W} x2={geo.x(cursor) * W} y1={0} y2={H} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        </svg>
                        {geo.band && (
                            <span className="pointer-events-none absolute top-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-faint" style={{ left: `calc(${geo.band.from * 100}% + 6px)` }}>2022</span>
                        )}
                        {visible.map(({ s, slot }) => (
                            <span key={s.replayId} className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                                style={{ left: `${geo.x(cursor) * 100}%`, top: `${geo.y(pick(s.series)[cursor]) * 100}%`, background: seriesColor(slot), opacity: dim(s.replayId) }} />
                        ))}
                        {focus && markers.filter((m) => m.i <= cursor).map(({ e, k, i }) => {
                            const isOn = firing?.id === focus.s.replayId && firing.k === k;
                            const dense = markers.length > 40;
                            return (
                                <button key={k} type="button" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => { setPinned(focus.s.replayId); setFiring(isOn ? null : { id: focus.s.replayId, k }); }}
                                    aria-pressed={isOn} aria-label={`${ruleLabel(e.kind, e.n)} · ${f.date(e.executionDay)}`} title={e.sentence[f.locale]}
                                    className={`absolute -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring ${isOn ? 'z-10 size-3.5 ring-[3px] ring-foreground/70' : dense ? 'size-[7px] ring-1 ring-card hover:scale-150' : 'size-2.5 ring-2 ring-card hover:scale-150'}`}
                                    style={{ left: `${geo.x(i) * 100}%`, top: `${geo.y(pick(focus.s.series)[i]) * 100}%`, background: ruleColor(Math.max(0, e.n - 1)) }} />
                            );
                        })}
                    </div>
                    <div className="relative mt-1 h-4 text-[11px] text-faint" aria-hidden>
                        {geo.years.map((y) => (
                            <span key={y.year} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(96, Math.max(3, geo.x(y.i) * 100))}%` }}>{y.year}</span>
                        ))}
                    </div>
                </div>
            </div>

            {/* whose firings are drawn, and the one picked */}
            {shownFiring && focus ? (
                <div className="flex items-start justify-between gap-3 rounded-[12px] border border-line bg-card px-3.5 py-2.5 text-[13px]" aria-live="polite">
                    <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[12px] font-bold text-muted-foreground">
                            <span className="inline-block size-2 rotate-45 rounded-[2px]" style={{ background: ruleColor(Math.max(0, shownFiring.n - 1)) }} />
                            {focus.s.label} · {ruleLabel(shownFiring.kind, shownFiring.n)} · {f.date(shownFiring.executionDay)}
                        </p>
                        <p className="mt-1 leading-relaxed text-foreground">{shownFiring.sentence[f.locale]}</p>
                    </div>
                    <button type="button" className="icon-btn" onClick={() => setFiring(null)} aria-label={t('event.close')}><X /></button>
                </div>
            ) : (
                <p className="rounded-[12px] border border-dashed border-line px-3.5 py-2.5 text-[12.5px] text-faint">
                    {focus ? t('multi.markersFor', { label: focus.s.label, count: focus.s.firings.length }) : t('multi.markersHint')}
                </p>
            )}
            <p className="text-[11.5px] text-faint">{unit === 'index' ? t('multi.indexNote') : t('multi.valueNote')}</p>

            {/* the player */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-line bg-canvas px-3 py-2">
                <button type="button" className="btn btn-primary h-8 w-8 flex-none p-0" onClick={player.toggle}
                    aria-label={player.playing ? t('player.pause') : cursor >= n - 1 ? t('player.replay') : t('player.play')}>
                    {player.playing ? <Pause /> : cursor >= n - 1 ? <RotateCcw /> : <Play />}
                </button>
                <input type="range" min={0} max={Math.max(0, n - 1)} value={cursor}
                    onChange={(e) => { player.setPlaying(false); player.setCursor(Number(e.target.value)); }}
                    aria-label={t('player.slider')} aria-valuetext={f.date(result.dates[cursor])} className="min-w-[140px] flex-1 accent-[var(--brand)]" />
                <span className="num min-w-[96px] text-[12.5px] font-bold text-foreground">{f.date(result.dates[cursor])}</span>
                <div className="flex items-center gap-1" role="radiogroup" aria-label={t('player.speed')}>
                    {SPEEDS.map((s) => (
                        <button key={s} type="button" role="radio" aria-checked={player.speed === s} onClick={() => player.setSpeed(s)}
                            className={`h-7 rounded-full px-2.5 text-[12px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${player.speed === s ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover hover:text-foreground'}`}>
                            {t('player.speedValue', { n: s })}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
