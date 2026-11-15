'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { InvestmentRule } from '@/lib/domain/types';
import { api } from '@/components/portfolio/logic';
import { TRIGGER_LABELS, describeRule, isPriceTrigger, quoteCurrency, type RuleDraft } from './describe';

type Entry = { symbol: string; name: string; assetClass: string; sector?: string; market: string };
type TriggerType = InvestmentRule['trigger']['type'];

const INPUT = 'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-foreground outline-none placeholder:text-faint focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/30';
// Gold and bond yields are reference values in this app: no rule can act on them
const TRADABLE = new Set(['stock', 'etf', 'crypto']);

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
    const [error, setError] = useState<string | null>(null);

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
        entry ? null : 'Pick an asset.',
        triggerValue.trim() === '' || !Number.isFinite(trigger) ? 'Give the trigger value.'
            : price && trigger <= 0 ? 'A price trigger needs a price above zero.'
            : !price && (trigger === 0 || Math.abs(trigger) > 100) ? 'A day change trigger needs a value between -100 and 100, other than 0.'
            : null,
        size.trim() === '' || !Number.isFinite(amount) || amount <= 0 ? 'Give the size of the simulated trade, above zero.' : null,
    ].filter((problem): problem is string => problem !== null);
    const draft: RuleDraft | null = entry && problems.length === 0
        ? { symbol: entry.symbol, trigger: { type: triggerType, value: trigger }, action: { side, [sizeMode]: amount }, once }
        : null;
    const sentence = draft ? describeRule(draft) : null;

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!draft || !sentence) return;
        setBusy(true);
        setError(null);
        try {
            await api('/api/rules', { method: 'POST', body: { rule: { ...draft, text: sentence } } });
            toast.success('Rule saved. It acts in the simulation only.');
            onSaved();
        } catch (failure) {
            setError((failure as Error).message);
            setBusy(false);
        }
    };

    return (
        <form onSubmit={save} className="grid gap-4 rounded-[12px] border border-line p-4">
            <div className="grid gap-1.5">
                <label htmlFor="rule-asset" className="form-label">Asset</label>
                {entry ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="pill is-brand">{entry.symbol}</span>
                        <span className="text-[13.5px] text-muted-foreground">{entry.name}</span>
                        <button type="button" className="btn btn-ghost h-8 px-3 text-[13px]" onClick={() => { setEntry(null); setQuery(''); }}>Change</button>
                    </div>
                ) : (
                    <>
                        <input id="rule-asset" className={INPUT} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by ticker or name, for example AAPL" autoComplete="off" />
                        {results && (
                            results.length === 0
                                ? <p className="text-[13px] text-faint">No asset in the app&apos;s list matches “{query.trim()}”.</p>
                                : (
                                    <ul className="row-list overflow-hidden rounded-[10px] border border-line" aria-label="Matching assets">
                                        {results.slice(0, 6).map((found) => (
                                            <li key={found.symbol}>
                                                <button type="button" onClick={() => setEntry(found)} className="flex w-full items-center gap-2 px-3 py-2 text-start outline-none hover:bg-hover focus-visible:bg-hover">
                                                    <span className="w-20 flex-none font-bold text-foreground">{found.symbol}</span>
                                                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground">{found.name}</span>
                                                    <span className="flex-none text-[12px] text-faint">{found.sector ?? found.assetClass}</span>
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
                    <label htmlFor="rule-trigger" className="form-label">Trigger</label>
                    <select id="rule-trigger" className={INPUT} value={triggerType} onChange={(event) => { setTriggerType(event.target.value as TriggerType); setTriggerValue(''); }}>
                        {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((type) => <option key={type} value={type}>{TRIGGER_LABELS[type]}</option>)}
                    </select>
                </div>
                <div className="grid gap-1.5">
                    <label htmlFor="rule-value" className="form-label">
                        {price ? `Price${entry ? ` (${quoteCurrency(entry.symbol)})` : ''}` : 'Change today (%)'}
                    </label>
                    <input id="rule-value" className={INPUT} type="number" step="any" inputMode="decimal" value={triggerValue} onChange={(event) => setTriggerValue(event.target.value)} placeholder={price ? '150' : '-3'} />
                </div>
            </div>

            <Chips label="Action (simulated)" value={side} onChange={setSide} options={[['buy', 'Simulate a purchase'], ['sell', 'Reduce position']] as const} />

            <div className="grid gap-3 sm:grid-cols-2">
                <Chips label="Size given as" value={sizeMode} onChange={(mode) => { setSizeMode(mode); setSize(''); }} options={[['amountCad', 'Amount in CAD'], ['quantity', 'Quantity']] as const} />
                <div className="grid gap-1.5">
                    <label htmlFor="rule-size" className="form-label">{sizeMode === 'amountCad' ? 'Amount (CAD)' : 'Units'}</label>
                    <input id="rule-size" className={INPUT} type="number" min="0" step="any" inputMode="decimal" value={size} onChange={(event) => setSize(event.target.value)} placeholder={sizeMode === 'amountCad' ? '500' : '2'} />
                </div>
            </div>

            <Chips label="How often" value={once ? 'once' : 'repeat'} onChange={(value) => setOnce(value === 'once')} options={[['once', 'Once'], ['repeat', 'Repeating']] as const} />

            <div className="rounded-[10px] bg-brand-soft px-3 py-2.5" aria-live="polite">
                <p className="kicker !text-brand-ink">Preview</p>
                <p className="mt-0.5 text-[14px] font-semibold text-foreground">{sentence ?? problems[0]}</p>
                {sentence && <p className="mt-1 text-[12px] text-muted-foreground">Checked every 60 seconds while this tab is open. A hit is filled at the last price, in the simulation only.</p>}
            </div>

            {error && <p role="alert" className="text-[13px] text-down">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!draft || busy}>{busy ? 'Checking…' : 'Save rule'}</button>
            </div>
        </form>
    );
}
