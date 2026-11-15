'use client';

import { Loader2, Rewind } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PERSONAS, type PersonaName } from '@/lib/personas/presets';
import { useReplayFmt } from './useReplayFmt';

export const START_CHIPS = ['2021-01-04', '2022-01-03', '2023-01-03'] as const;
export const PERSONA_NAMES: PersonaName[] = ['amira', 'mateo', 'robert'];

export type StrategyOption = { id: string; name: string; ruleCount: number };
export type ModelOption = { id: string; name: string; weights: Array<{ symbol: string; weightPct: number }> };

export type ControlsValue = {
    /** 'current', a persona name, or 'model:<id>'. */
    portfolio: string;
    /** '' = no rule. */
    strategy: string;
    capital: string;
    startDate: string;
    fee: string;
};

type Props = {
    value: ControlsValue;
    onChange: (next: ControlsValue) => void;
    onRun: () => void;
    running: boolean;
    strategies: StrategyOption[] | null;
    models: ModelOption[];
    window: { from: string; to: string } | null;
};

const fieldClass = 'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-[13.5px] text-foreground outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-ring/30';

// The replay's inputs: portfolio, strategy, fictitious amount, start date and fee per order.
export default function Controls({ value, onChange, onRun, running, strategies, models, window }: Props) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const set = (patch: Partial<ControlsValue>) => onChange({ ...value, ...patch });
    const capital = Number(value.capital);
    const fee = Number(value.fee);
    const valid = Number.isFinite(capital) && capital >= 100 && capital <= 100_000_000
        && Number.isFinite(fee) && fee >= 0 && fee <= 100
        && /^\d{4}-\d{2}-\d{2}$/.test(value.startDate);

    return (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (valid && !running) onRun(); }}>
            <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                    <span className="form-label">{t('controls.portfolio')}</span>
                    <select className={fieldClass} value={value.portfolio} onChange={(e) => set({ portfolio: e.target.value })}>
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
                <label className="flex flex-col gap-1.5">
                    <span className="form-label">{t('controls.strategy')}</span>
                    <select className={fieldClass} value={value.strategy} onChange={(e) => set({ strategy: e.target.value })} disabled={strategies === null}>
                        <option value="">{t('controls.noRules')}</option>
                        {(strategies ?? []).map((s) => <option key={s.id} value={s.id}>{t('controls.strategyOption', { name: s.name, count: s.ruleCount })}</option>)}
                    </select>
                    {strategies !== null && strategies.length === 0 && <span className="text-[11.5px] text-faint">{t('controls.noStrategies')}</span>}
                </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr] lg:grid-cols-[1fr_2fr_1fr]">
                <label className="flex flex-col gap-1.5">
                    <span className="form-label">{t('controls.capital')}</span>
                    <div className="relative">
                        <input type="number" inputMode="decimal" min={100} max={100000000} step={100} className={`${fieldClass} num pe-14`} value={value.capital} onChange={(e) => set({ capital: e.target.value })} />
                        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{t('controls.cad')}</span>
                    </div>
                    <span className="text-[11.5px] text-faint">{Number.isFinite(capital) && capital > 0 ? t('controls.fictitious', { amount: f.money(capital) }) : ' '}</span>
                </label>
                <div className="flex flex-col gap-1.5 sm:order-last sm:col-span-2 lg:order-none lg:col-span-1">
                    <span className="form-label" id="start-label">{t('controls.startDate')}</span>
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="start-label">
                        {START_CHIPS.map((d) => (
                            <button key={d} type="button" aria-pressed={value.startDate === d} onClick={() => set({ startDate: d })}
                                className={`btn btn-ghost h-10 px-3 text-[13px] ${value.startDate === d ? 'is-on' : ''}`}>{f.date(d)}</button>
                        ))}
                        <input type="date" aria-label={t('controls.otherDate')} className={`${fieldClass} num w-auto min-w-[150px] flex-1`} value={value.startDate}
                            min={window?.from} max={window?.to} onChange={(e) => set({ startDate: e.target.value })} />
                    </div>
                    {window && <span className="text-[11.5px] text-faint">{t('controls.window', { from: f.date(window.from), to: f.date(window.to) })}</span>}
                </div>
                <label className="flex flex-col gap-1.5">
                    <span className="form-label">{t('controls.fee')}</span>
                    <div className="relative">
                        <input type="number" inputMode="decimal" min={0} max={100} step={0.5} className={`${fieldClass} num pe-14`} value={value.fee} onChange={(e) => set({ fee: e.target.value })} />
                        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">{t('controls.cad')}</span>
                    </div>
                    <span className="text-[11.5px] text-faint">{t('controls.feeHint')}</span>
                </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-faint">{t('controls.footnote')}</p>
                <button type="submit" className="btn btn-primary h-10 px-5" disabled={!valid || running}>
                    {running ? <Loader2 className="animate-spin" /> : <Rewind />}
                    {running ? t('controls.running') : t('controls.run')}
                </button>
            </div>
        </form>
    );
}
