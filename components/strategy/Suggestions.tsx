'use client';

import { useEffect, useRef, useState } from 'react';
import { History, Lightbulb, Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { api } from '@/components/portfolio/logic';
import { useFmt } from '@/components/portfolio/useFmt';
import type { RuleKind, StrategyRule } from '@/lib/strategy/types';
import HistoryPreview from './HistoryPreview';
import { byPriority, type StoredStrategy } from './model';
import { KIND_ICON, RuleSentence } from './RuleCard';
import { RuleFlow } from './RuleFlow';
import { ViewToggle, type RuleView } from './ViewToggle';

/** What GET /api/strategy/suggestions answers (lib/services/strategy-suggestions.ts, SuggestionsView). */
export type SuggestionWhy = { code: string; values: Record<string, string | number> };
export type StrategySuggestionView = { id: string; family: string; name: string; description: string; rules: StrategyRule[]; why: SuggestionWhy[] };
export type RuleSuggestionView = { kind: RuleKind; rule: StrategyRule; why: SuggestionWhy[] };
export type SuggestionsResponse = {
    version: string;
    risk: 'Low' | 'Medium' | 'High';
    label: string;
    source: { kind: 'portfolio' } | { kind: 'model'; optionId: string; name: string };
    strategies: StrategySuggestionView[];
    rules: RuleSuggestionView[];
};

/** The reasons of a suggestion, one short line each (Strategy.suggestions.why.<code>). */
export function WhyList({ why, className = '' }: { why: SuggestionWhy[]; className?: string }) {
    const t = useTranslations('Strategy');
    const locale = useLocale();
    return (
        <ul className={`grid gap-1 text-[12.5px] leading-snug text-muted-foreground ${className}`}>
            {why.map((reason) => (
                <li key={reason.code} className="flex gap-1.5">
                    <Lightbulb className="mt-0.5 size-3.5 flex-none text-brand-ink" aria-hidden />
                    <span>{t(`suggestions.why.${reason.code}`, { ...reason.values, name: String(reason.values[locale] ?? reason.values.en ?? '') })}</span>
                </li>
            ))}
        </ul>
    );
}

const uniqueName = (name: string, taken: string[]) => {
    if (!taken.includes(name)) return name;
    for (let n = 2; ; n++) if (!taken.includes(`${name} ${n}`)) return `${name} ${n}`;
};

/**
 * "Suggestions pour votre profil": the three suggested strategies of the visitor's risk level, each with its rules,
 * why it looks that way, a history preview on demand and "Partir de cet exemple" (a normal POST /api/strategy).
 */
export function StrategySuggestions({ data, existingNames, capitalCad, onAdopted }: { data: SuggestionsResponse; existingNames: string[]; capitalCad: number | null; onAdopted: (saved: StoredStrategy) => void }) {
    const t = useTranslations('Strategy');
    const fmt = useFmt();
    const [view, setView] = useState<RuleView>('sentences');
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const previewed = data.strategies.find((s) => s.id === previewId);
    const previewRef = useRef<HTMLDivElement>(null);
    // The preview opens under the cards: bring it into view
    useEffect(() => {
        if (previewId) previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [previewId]);

    const adopt = async (suggestion: StrategySuggestionView) => {
        setBusyId(suggestion.id);
        setError(null);
        try {
            const { strategy } = await api<{ strategy: StoredStrategy }>('/api/strategy', {
                method: 'POST',
                body: { strategy: { name: uniqueName(suggestion.name, existingNames), rules: suggestion.rules } },
            });
            onAdopted(strategy);
        } catch (failure) {
            setError(fmt.error(failure));
            setBusyId(null);
        }
    };

    const ruleLabel = (rules: StrategyRule[]) => (ruleId: string) => {
        const at = byPriority(rules).findIndex((rule) => rule.id === ruleId);
        return at < 0 ? ruleId : `${t('editor.ruleNumber', { n: at + 1 })} · ${t(`kinds.${byPriority(rules)[at].kind}.name`)}`;
    };

    return (
        <section className="grid gap-3" aria-labelledby="strategy-suggestions-title">
            <div className="section-head !px-1">
                <div className="min-w-0">
                    <h2 id="strategy-suggestions-title" className="section-title flex flex-wrap items-center gap-2">
                        <Sparkles className="size-4 text-brand-ink" aria-hidden />{t('suggestions.title')}
                        <span className="pill is-brand">{data.label}</span>
                    </h2>
                    <p className="section-sub max-w-2xl">{t('suggestions.sub', { risk: data.risk, version: data.version })}</p>
                </div>
                <ViewToggle value={view} onChange={setView} />
            </div>

            {error && <p role="alert" className="px-1 text-[13px] text-down">{error}</p>}

            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr))]">
                {data.strategies.map((suggestion) => {
                    const rules = byPriority(suggestion.rules);
                    return (
                        <li key={suggestion.id} className="hatch">
                            <article className={`card flex h-full flex-col gap-3 p-4 ${previewId === suggestion.id ? 'ring-1 ring-brand/40' : ''}`}>
                                <header className="grid gap-1">
                                    <h3 className="text-[15px] font-bold text-foreground">{suggestion.name}</h3>
                                    <p className="text-[13px] leading-snug text-muted-foreground">{suggestion.description}</p>
                                </header>
                                {view === 'sentences' ? (
                                    <ol className="grid gap-2">
                                        {rules.map((rule) => {
                                            const Icon = KIND_ICON[rule.kind];
                                            return (
                                                <li key={rule.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 [&_p]:text-[13.5px] [&_p]:leading-7">
                                                    <span className="bento-ico !size-6 mt-0.5"><Icon /></span>
                                                    <RuleSentence rule={rule} />
                                                </li>
                                            );
                                        })}
                                    </ol>
                                ) : (
                                    <RuleFlow rules={rules} />
                                )}
                                <div className="mt-auto grid gap-3 border-t border-line pt-3">
                                    <WhyList why={suggestion.why} />
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            className={`btn btn-ghost h-9 px-3 text-[13px] ${previewId === suggestion.id ? 'is-on' : ''}`}
                                            aria-pressed={previewId === suggestion.id}
                                            onClick={() => setPreviewId(previewId === suggestion.id ? null : suggestion.id)}
                                        >
                                            <History />{t('suggestions.preview')}
                                        </button>
                                        <button type="button" className="btn btn-primary h-9 px-3 text-[13px]" onClick={() => void adopt(suggestion)} disabled={busyId !== null}>
                                            {busyId === suggestion.id ? t('suggestions.adopting') : t('suggestions.adopt')}
                                        </button>
                                    </div>
                                </div>
                            </article>
                        </li>
                    );
                })}
            </ul>

            {previewed && (
                <div ref={previewRef} className="grid scroll-mt-4 gap-2">
                    <div className="flex items-center justify-between gap-2 px-1">
                        <p className="text-[13px] font-semibold text-muted-foreground">{t('suggestions.previewOf', { name: previewed.name })}</p>
                        <button type="button" className="icon-btn" onClick={() => setPreviewId(null)} aria-label={t('suggestions.previewClose')} title={t('suggestions.previewClose')}><X className="size-4" /></button>
                    </div>
                    <HistoryPreview key={previewed.id} strategy={{ name: previewed.name, rules: previewed.rules }} savedId={null} capitalCad={capitalCad} ruleLabel={ruleLabel(previewed.rules)} autoRun />
                </div>
            )}
        </section>
    );
}

export default StrategySuggestions;
