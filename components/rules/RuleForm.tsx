'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { InvestmentRule } from '@/lib/domain/types';
import { api } from '@/components/portfolio/logic';
import { useFmt } from '@/components/portfolio/useFmt';
import { TRIGGER_TYPES, describeRule, isPriceTrigger, quoteCurrency, triggerLabel, type RuleDraft } from './describe';

type Entry = { symbol: string; name: string; assetClass: string; sector?: string; market: string };
type TriggerType = InvestmentRule['trigger']['type'];

const INPUT = 'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-foreground outline-none placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/30';
// Gold and bond yields are reference values in this app: no rule can act on them
const TRADABLE = new Set(['stock', 'etf', 'crypto']);
const ASSET_CLASSES: Record<string, true> = { stock: true, etf: true, crypto: true, gold: true, bond_yield: true };

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
    return (
        <div className="grid gap-1.5">
            <span className="form-label">{label}</span>
            <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
                {options.map(([id, text]) => (
                    <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={`btn btn-ghost h-9 px-3 text-[13px] ${value === id ? 'is-on' : ''}`}>
                        {text}
                    </button>
                ))}
            </div>
        </div>
    );
}

// A rule is built from fixed choices, read back as one sentence, then saved. The server validates it again.
export default function RuleForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
    const t = useTranslations('Rules');
    const fmt = useFmt();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Entry[] | null>(null);
    const [entry, setEntry] = useState<Entry | null>(null);
    const [triggerType, setTriggerType] = useState<TriggerType>('price_below');
    const [triggerValue, setTriggerValue] = useState('');
    const [side, setSide] = useState<'buy' | 'sell'>('buy');
    const [sizeMode, setSizeMode] = useState<'amountCad' | 'quantity'>('amountCad');
    const [size, setSize] = useState('');
    const [once, setOnce] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ failure: unknown } | null>(null);

    useEffect(() => {
        const q = query.trim();
        if (entry || q.length === 0) {
            setResults(null);
            return;
        }
        let stale = false;
        const timer = setTimeout(() => {
            api<{ entries: Entry[] }>(`/api/universe/search?q=${encodeURIComponent(q)}`)
                .then(({ entries }) => { if (!stale) setResults(entries.filter((found) => TRADABLE.has(found.assetClass))); })
                .catch(() => { if (!stale) setResults([]); });
        }, 250);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [query, entry]);

    const price = isPriceTrigger(triggerType);
    const trigger = Number(triggerValue);
    const amount = Number(size);
    const problems = [
        entry ? null : t('form.problemAsset'),
        triggerValue.trim() === '' || !Number.isFinite(trigger) ? t('form.problemTriggerValue')
            : price && trigger <= 0 ? t('form.problemPrice')
            : !price && (trigger === 0 || Math.abs(trigger) > 100) ? t('form.problemChange')
            : null,
        size.trim() === '' || !Number.isFinite(amount) || amount <= 0 ? t('form.problemSize') : null,
    ].filter((problem): problem is string => problem !== null);
    const draft: RuleDraft | null = entry && problems.length === 0
        ? { symbol: entry.symbol, trigger: { type: triggerType, value: trigger }, action: { side, [sizeMode]: amount }, once }
        : null;
    const sentence = draft ? describeRule(draft, t, fmt.locale) : null;

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!draft || !sentence) return;
        setBusy(true);
        setError(null);
        try {
            await api('/api/rules', { method: 'POST', body: { rule: { ...draft, text: sentence } } });
            toast.success(t('form.saved'));
            onSaved();
        } catch (failure) {
            setError({ failure });
            setBusy(false);
        }
    };

    return (
        <form onSubmit={save} className="grid gap-4 rounded-[12px] border border-line p-4">
            <div className="grid gap-1.5">
                <label htmlFor="rule-asset" className="form-label">{t('form.asset')}</label>
                {entry ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="pill is-brand">{entry.symbol}</span>
                        <span className="text-[13.5px] text-muted-foreground">{entry.name}</span>
                        <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={() => { setEntry(null); setQuery(''); }}>{t('form.change')}</button>
                    </div>
                ) : (
                    <>
                        <input id="rule-asset" className={INPUT} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('form.searchPlaceholder')} autoComplete="off" />
                        {results && (
                            results.length === 0
                                ? <p className="text-[13px] text-faint">{t('form.noMatch', { query: query.trim() })}</p>
                                : (
                                    <ul className="row-list overflow-hidden rounded-[10px] border border-line" aria-label={t('form.matching')}>
                                        {results.slice(0, 6).map((found) => (
                                            <li key={found.symbol}>
                                                <button type="button" onClick={() => setEntry(found)} className="flex w-full items-center gap-2 px-3 py-2 text-start outline-none hover:bg-hover focus-visible:bg-hover">
                                                    <span className="w-20 flex-none font-bold text-foreground">{found.symbol}</span>
                                                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground">{found.name}</span>
                                                    <span className="flex-none text-[12px] text-faint">{found.sector ?? (found.assetClass in ASSET_CLASSES ? t(`assetClass.${found.assetClass}`) : found.assetClass)}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )
                        )}
                    </>
                )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                    <label htmlFor="rule-trigger" className="form-label">{t('form.trigger')}</label>
                    <select id="rule-trigger" className={INPUT} value={triggerType} onChange={(event) => { setTriggerType(event.target.value as TriggerType); setTriggerValue(''); }}>
                        {TRIGGER_TYPES.map((type) => <option key={type} value={type}>{triggerLabel(type, t)}</option>)}
                    </select>
                </div>
                <div className="grid gap-1.5">
                    <label htmlFor="rule-value" className="form-label">
                        {price ? (entry ? t('form.priceWithCurrency', { currency: quoteCurrency(entry.symbol) }) : t('form.price')) : t('form.changeToday')}
                    </label>
                    <input id="rule-value" className={INPUT} type="number" step="any" inputMode="decimal" value={triggerValue} onChange={(event) => setTriggerValue(event.target.value)} placeholder={price ? '150' : '-3'} />
                </div>
            </div>

            <Chips label={t('form.action')} value={side} onChange={setSide} options={[['buy', t('form.simulatePurchase')], ['sell', t('form.reducePosition')]] as const} />

            <div className="grid gap-3 sm:grid-cols-2">
                <Chips label={t('form.sizeGivenAs')} value={sizeMode} onChange={(mode) => { setSizeMode(mode); setSize(''); }} options={[['amountCad', t('form.amountInCad')], ['quantity', t('form.quantity')]] as const} />
                <div className="grid gap-1.5">
                    <label htmlFor="rule-size" className="form-label">{sizeMode === 'amountCad' ? t('form.amountCad') : t('form.units')}</label>
                    <input id="rule-size" className={INPUT} type="number" min="0" step="any" inputMode="decimal" value={size} onChange={(event) => setSize(event.target.value)} placeholder={sizeMode === 'amountCad' ? '500' : '2'} />
                </div>
            </div>

            <Chips label={t('form.howOften')} value={once ? 'once' : 'repeat'} onChange={(value) => setOnce(value === 'once')} options={[['once', t('form.once')], ['repeat', t('form.repeating')]] as const} />

            <div className="rounded-[10px] bg-brand-soft px-3 py-2.5" aria-live="polite">
                <p className="kicker !text-brand-ink">{t('form.preview')}</p>
                <p className="mt-0.5 text-[14px] font-semibold text-foreground">{sentence ?? problems[0]}</p>
                {sentence && <p className="mt-1 text-[12px] text-muted-foreground">{t('form.previewNote')}</p>}
            </div>

            {error && <p role="alert" className="text-[13px] text-down">{fmt.error(error.failure)}</p>}

            <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('form.cancel')}</button>
                <button type="submit" className="btn btn-primary" disabled={!draft || busy}>{busy ? t('form.busy') : t('form.save')}</button>
            </div>
        </form>
    );
}
