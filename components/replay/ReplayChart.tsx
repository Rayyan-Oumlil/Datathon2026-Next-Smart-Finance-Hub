'use client';

import { useMemo, useRef } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReplayResult } from '@/lib/replay/engine/types';
import { ruleColor, ruleIndex, ruleName } from './rules';
import { SPEEDS, type Player } from './usePlayer';
import { useReplayFmt } from './useReplayFmt';

const W = 1000;
const H = 300;
const PAD = 0.07;

export type BenchId = 'XIU.TO' | '60_40';
const BENCH_STROKE: Record<BenchId, string> = { 'XIU.TO': 'var(--warn)', '60_40': 'var(--faint)' };
const STROKE_WITHOUT = 'var(--muted)';
const STROKE_WITH = 'var(--brand)';

type Props = {
    result: ReplayResult;
    player: Player;
    benches: BenchId[];
    onToggleBench: (id: BenchId) => void;
    selected: number | null;
    onSelect: (eventIndex: number) => void;
};

/** Index of each calendar date of the replay. */
export function dateIndex(result: ReplayResult): Map<string, number> {
    return new Map(result.dates.map((d, i) => [d, i]));
}

// The two replayed series in CAD, optional benchmarks, calendar 2022 shaded and one marker per rule firing on the
// "with" curve. The curves are drawn up to the date cursor; dragging on the chart or the slider moves it.
export default function ReplayChart({ result, player, benches, onToggleBench, selected, onSelect }: Props) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const area = useRef<HTMLDivElement>(null);
    const n = result.dates.length;
    const { cursor } = player;

    const available = result.benchmarks.filter((b) => b.available && b.valueCad.length === n);
    const shownBenches = available.filter((b) => benches.includes(b.id));

    const geo = useMemo(() => {
        const all = [result.series.without.valueCad, result.series.with.valueCad, ...shownBenches.map((b) => b.valueCad)];
        let low = Infinity;
        let high = -Infinity;
        for (const s of all) for (const v of s) { if (v < low) low = v; if (v > high) high = v; }
        const span = high - low || 1;
        low -= span * PAD;
        high += span * PAD;
        const x = (i: number) => (n > 1 ? i / (n - 1) : 0);
        const y = (v: number) => 1 - (v - low) / (high - low);
        const pts = (s: number[]) => s.map((v, i) => `${(x(i) * W).toFixed(1)},${(y(v) * H).toFixed(1)}`);
        // four round gridlines
        const raw = (high - low) / 4;
        const mag = 10 ** Math.floor(Math.log10(raw));
        const stepSize = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
        const ticks: number[] = [];
        for (let v = Math.ceil(low / stepSize) * stepSize; v <= high; v += stepSize) ticks.push(v);
        // year starts and calendar 2022
        const years: Array<{ i: number; year: string }> = [];
        result.dates.forEach((d, i) => { if (i === 0 || d.slice(0, 4) !== result.dates[i - 1].slice(0, 4)) years.push({ i, year: d.slice(0, 4) }); });
        const in2022 = result.dates.map((d, i) => (d.startsWith('2022') ? i : -1)).filter((i) => i >= 0);
        return {
            x, y, ticks, years,
            band: in2022.length ? { from: x(in2022[0]), to: x(in2022[in2022.length - 1]) } : null,
            without: pts(result.series.without.valueCad),
            with: pts(result.series.with.valueCad),
            benches: Object.fromEntries(shownBenches.map((b) => [b.id, pts(b.valueCad)])) as Record<string, string[]>,
        };
    }, [result, shownBenches, n]);

    const byDate = useMemo(() => dateIndex(result), [result]);
    const colors = useMemo(() => ruleIndex(result), [result]);
    const markers = useMemo(() => result.ruleEvents
        .map((event, eventIndex) => ({ event, eventIndex, i: byDate.get(event.executionDay) ?? -1 }))
        .filter((m) => m.event.series === 'with' && m.i >= 0), [result, byDate]);

    const upTo = (p: string[]) => p.slice(0, cursor + 1).join(' ');

    const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
        const box = area.current?.getBoundingClientRect();
        if (!box || n < 2) return;
        const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
        player.setPlaying(false);
        player.setCursor(Math.round(ratio * (n - 1)));
    };

    const withNow = result.series.with.valueCad[cursor];
    const withoutNow = result.series.without.valueCad[cursor];
    const capital = result.params.capitalCad;

    return (
        <div className="flex flex-col gap-4">
            {/* figures at the cursor date */}
            <div className="grid grid-cols-3 gap-2" aria-live="off">
                <Figure label={t('chart.without')} swatch={STROKE_WITHOUT} value={f.money(withoutNow)} sub={t('chart.sinceStart', { pct: f.signedPct(result.series.without.index[cursor] - 100) })} />
                <Figure label={t('chart.with')} swatch={STROKE_WITH} value={f.money(withNow)} sub={t('chart.sinceStart', { pct: f.signedPct(result.series.with.index[cursor] - 100) })} />
                <Figure label={result.series.with.metrics.contributedCad > 0 ? t('chart.gapExContributions') : t('chart.gap')} value={f.signedMoney(result.gap.valueCad[cursor])} sub={f.pts(result.gap.indexPts[cursor])} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-3 text-faint">
                    <Legend stroke={STROKE_WITHOUT} label={t('chart.without')} />
                    <Legend stroke={STROKE_WITH} label={t('chart.with')} thick />
                    <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[3px] bg-hover ring-1 ring-line" />{t('chart.year2022')}</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block size-2 rotate-45 bg-brand" />{t('chart.marker')}</span>
                </div>
                {available.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('chart.benchmarks')}>
                        <span className="text-faint">{t('chart.benchmarks')}</span>
                        {available.map((b) => {
                            const on = benches.includes(b.id);
                            return (
                                <button key={b.id} type="button" aria-pressed={on} onClick={() => onToggleBench(b.id)}
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
                        <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${geo.y(v) * 100}%` }}>{f.money(v)}</span>
                    ))}
                </div>
                <div className="min-w-0 flex-1">
                    <div
                        ref={area}
                        className="relative w-full cursor-crosshair touch-none select-none"
                        style={{ height: H }}
                        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
                        onPointerMove={(e) => { if (e.buttons === 1) scrub(e); }}
                    >
                        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" role="img"
                            aria-label={t('chart.aria', { from: f.date(result.window.from), to: f.date(result.window.to), without: f.money(result.series.without.metrics.finalValueCad), with: f.money(result.series.with.metrics.finalValueCad), capital: f.money(capital) })}>
                            {geo.band && (
                                <rect x={geo.band.from * W} width={(geo.band.to - geo.band.from) * W} y={0} height={H} fill="var(--hover)" />
                            )}
                            {geo.ticks.map((v) => (
                                <line key={v} x1={0} x2={W} y1={geo.y(v) * H} y2={geo.y(v) * H} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            ))}
                            <line x1={0} x2={W} y1={geo.y(capital) * H} y2={geo.y(capital) * H} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                            {shownBenches.map((b) => (
                                <polyline key={b.id} points={upTo(geo.benches[b.id])} fill="none" stroke={BENCH_STROKE[b.id]} strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
                            ))}
                            <polyline points={upTo(geo.without)} fill="none" stroke={STROKE_WITHOUT} strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                            <polyline points={upTo(geo.with)} fill="none" stroke={STROKE_WITH} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                            <line x1={geo.x(cursor) * W} x2={geo.x(cursor) * W} y1={0} y2={H} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        </svg>
                        {geo.band && (
                            <span className="pointer-events-none absolute top-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-faint" style={{ left: `calc(${geo.band.from * 100}% + 6px)` }}>2022</span>
                        )}
                        {/* dots at the cursor and the rule markers are HTML, so the stretched SVG does not squash them */}
                        <span className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card" style={{ left: `${geo.x(cursor) * 100}%`, top: `${geo.y(withoutNow) * 100}%`, background: STROKE_WITHOUT }} />
                        <span className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card" style={{ left: `${geo.x(cursor) * 100}%`, top: `${geo.y(withNow) * 100}%`, background: STROKE_WITH }} />
                        {markers.filter((m) => m.i <= cursor).map(({ event, eventIndex, i }) => {
                            const isOn = selected === eventIndex;
                            const dense = markers.length > 40;
                            return (
                                <button
                                    key={eventIndex}
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => onSelect(eventIndex)}
                                    aria-pressed={isOn}
                                    aria-label={`${ruleName(t, result, event.ruleId)} · ${f.date(event.executionDay)}`}
                                    title={event.sentence[f.locale]}
                                    className={`absolute -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring ${isOn ? 'z-10 size-3.5 ring-[3px] ring-foreground/70' : dense ? 'size-[7px] ring-1 ring-card hover:scale-150' : 'size-2.5 ring-2 ring-card hover:scale-150'}`}
                                    style={{ left: `${geo.x(i) * 100}%`, top: `${geo.y(result.series.with.valueCad[i]) * 100}%`, background: ruleColor(colors.get(event.ruleId) ?? 0) }}
                                />
                            );
                        })}
                    </div>
                    <div className="relative mt-1 h-4 text-[11px] text-faint" aria-hidden>
                        {geo.years.filter((y, k) => k > 0 || y.i === 0).map((y) => (
                            <span key={y.year} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(96, Math.max(3, geo.x(y.i) * 100))}%` }}>{y.year}</span>
                        ))}
                    </div>
                </div>
            </div>

            {/* the player */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-line bg-canvas px-3 py-2">
                <button type="button" className="btn btn-primary h-8 w-8 flex-none p-0" onClick={player.toggle}
                    aria-label={player.playing ? t('player.pause') : cursor >= n - 1 ? t('player.replay') : t('player.play')}>
                    {player.playing ? <Pause /> : cursor >= n - 1 ? <RotateCcw /> : <Play />}
                </button>
                <input
                    type="range"
                    min={0}
                    max={Math.max(0, n - 1)}
                    value={cursor}
                    onChange={(e) => { player.setPlaying(false); player.setCursor(Number(e.target.value)); }}
                    aria-label={t('player.slider')}
                    aria-valuetext={f.date(result.dates[cursor])}
                    className="min-w-[140px] flex-1 accent-[var(--brand)]"
                />
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

function Figure({ label, value, sub, swatch }: { label: string; value: string; sub: string; swatch?: string }) {
    return (
        <div className="min-w-0 rounded-[12px] border border-line bg-card px-2.5 py-2 sm:px-3 sm:py-2.5">
            <p className="flex items-center gap-1.5 truncate text-[11px] font-semibold text-muted-foreground sm:text-[12px]">
                {swatch && <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: swatch }} />}
                {label}
            </p>
            <p className="num mt-1 truncate text-[15px] font-bold leading-none tracking-[-0.03em] text-foreground sm:text-[20px]">{value}</p>
            <p className="num mt-1 truncate text-[11px] text-faint sm:text-[12px]">{sub}</p>
        </div>
    );
}

function Legend({ stroke, label, thick }: { stroke: string; label: string; thick?: boolean }) {
    return (
        <span className="flex items-center gap-1.5">
            <span className={`inline-block w-4 rounded ${thick ? 'h-[3px]' : 'h-0.5'}`} style={{ background: stroke }} />
            {label}
        </span>
    );
}
