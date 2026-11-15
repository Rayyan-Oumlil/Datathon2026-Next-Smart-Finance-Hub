import { useLocale, useTranslations } from "next-intl";
import { formatMoment, sourceLabel } from "@/components/agent/time";
import { RuleFlow, ViewToggle, useRuleView } from "@/components/strategy";
import type { StrategyRule } from "@/lib/strategy/types";

// What a proposed change would do, as the agent's preview describes it: the strategy block, or the before and after of
// each thing it changes, with the sources of the figures it used. Shown in the chat card and on the page where it is saved.

export type StrategyPreviewData = {
    name: string;
    replaceId: string | null;
    sentences: string[];
    rules?: StrategyRule[];
    beforeSentences: string[] | null;
    table: Array<{ label: string; without: string; with: string }>;
    firings: Array<{ ruleId: string; label: string; count: number }>;
    replay: { replayId: string; snapshotId: string; from: string; to: string; tradingDays: number } | null;
    replayNote: string | null;
    conflicts: Array<{ symbol: string; detail: string }>;
    notes: string[];
    illustrative: string;
};
export type PreviewData = {
    summary: string;
    before?: unknown;   // for a layout change: the widget ids now and after the change
    after?: unknown;
    page?: '/strategy' | '/overview' | '/portfolio' | '/profile';   // where the change is reviewed and saved; absent: in the chat
    strategy?: StrategyPreviewData;
    rows: Array<{ label: string; before: string; after: string }>;
    facts: Array<{ label: string; value: string; source?: string; fetchedAt?: string; asOf?: string }>;
};

export type Translator = ReturnType<typeof useTranslations<'AgentPanel'>>;
/** Which time a figure carries: the time the value refers to, and the time it was fetched. */
export const timesText = (t: Translator, locale: string, { asOf, fetchedAt }: { asOf?: string; fetchedAt?: string }) =>
    [
        formatMoment(asOf, locale) && t('times.asOf', { time: formatMoment(asOf, locale) }),
        formatMoment(fetchedAt, locale) && t('times.fetched', { time: formatMoment(fetchedAt, locale) }),
    ].filter(Boolean).join(' · ') || t('times.none');

// A proposed strategy: its rules as sentences, the small without / with table of the 5-year replay, how often each rule
// fired and the profile conflicts. The label of the replay is always shown with its figures.
export const StrategyBlock = ({ data }: { data: StrategyPreviewData }) => {
    const t = useTranslations('AgentPanel');
    const [view, setView] = useRuleView();
    const flow = view === 'flow' && !!data.rules?.length;
    return (
        <div className="mt-2 flex flex-col gap-2">
            <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="form-label">{t('preview.strategy.rules')}</p>
                    {!!data.rules?.length && <ViewToggle value={view} onChange={setView} />}
                </div>
                {flow ? <RuleFlow className="mt-1" rules={data.rules!} /> : (
                <ul className="mt-0.5 list-disc ps-5 text-foreground">
                    {data.sentences.map((sentence, index) => <li key={index}>{sentence}</li>)}
                </ul>)}
                {data.beforeSentences && (
                    <details className="mt-1 text-xs text-muted-foreground">
                        <summary className="cursor-pointer select-none">{t('preview.strategy.replaces')}</summary>
                        <ul className="mt-0.5 list-disc ps-5">{data.beforeSentences.map((sentence, index) => <li key={index}>{sentence}</li>)}</ul>
                    </details>
                )}
            </div>
            {data.replay && data.table.length > 0 && (
                <div>
                    <p className="form-label">{t('preview.strategy.history')}</p>
                    <p className="text-[11px] text-faint">{t('preview.strategy.window', { from: data.replay.from, to: data.replay.to, days: data.replay.tradingDays })}</p>
                    <table className="mt-1 w-full text-xs">
                        <thead>
                            <tr className="text-faint">
                                <th scope="col" className="py-0.5 text-start font-semibold">{t('preview.strategy.metric')}</th>
                                <th scope="col" className="py-0.5 text-end font-semibold">{t('preview.strategy.without')}</th>
                                <th scope="col" className="py-0.5 text-end font-semibold">{t('preview.strategy.with')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.table.map((row) => (
                                <tr key={row.label} className="border-t border-line">
                                    <th scope="row" className="py-1 text-start font-normal text-muted-foreground">{row.label}</th>
                                    <td className="num py-1 text-end text-foreground">{row.without}</td>
                                    <td className="num py-1 text-end text-foreground">{row.with}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {data.firings.length > 0 && (
                        <ul className="mt-1 text-xs text-muted-foreground" aria-label={t('preview.strategy.fired')}>
                            {data.firings.map((firing) => <li key={firing.ruleId}>{t('preview.strategy.firedCount', { label: firing.label, count: firing.count })}</li>)}
                        </ul>
                    )}
                    <p className="mono mt-1 break-all text-[11px] text-faint">{t('preview.strategy.ids', { replayId: data.replay.replayId, snapshotId: data.replay.snapshotId })}</p>
                </div>
            )}
            {data.replayNote && <p className="text-xs text-muted-foreground">{data.replayNote}</p>}
            {data.notes.map((note, index) => <p key={index} className="text-xs text-muted-foreground">{note}</p>)}
            <p role="note" className="rounded-lg bg-hover px-2 py-1 text-xs font-semibold text-foreground">{data.illustrative}</p>
        </div>
    );
};


/** The details of a preview: a strategy's sentences and replay, or the rows of before and after and their sources. */
export default function PreviewDetails({ preview }: { preview: PreviewData }) {
    const t = useTranslations('AgentPanel');
    const locale = useLocale();
    if (preview.strategy) return <StrategyBlock data={preview.strategy} />;
    return (
        <>
            <dl className="mt-2 flex flex-col gap-2">
                {preview.rows.map((row) => (
                    <div key={row.label}>
                        <dt className="form-label">{row.label}</dt>
                        <dd className="mt-0.5 grid grid-cols-2 gap-2">
                            <span className="rounded-lg bg-hover px-2 py-1 text-muted-foreground"><span className="block text-[11px] font-bold uppercase text-faint">{t('preview.before')}</span>{row.before || '–'}</span>
                            <span className="rounded-lg bg-brand-soft px-2 py-1 text-foreground"><span className="block text-[11px] font-bold uppercase text-brand-ink">{t('preview.after')}</span>{row.after || '–'}</span>
                        </dd>
                    </div>
                ))}
            </dl>
            {preview.facts.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                    {preview.facts.map((fact) => (
                        <li key={fact.label}>
                            <span className="font-semibold text-foreground">{t('preview.factLabel', { label: fact.label })}</span> <span className="num">{fact.value}</span>
                            {fact.source && <span className="text-faint"> · {sourceLabel(t, fact.source)}{fact.fetchedAt || fact.asOf ? ` · ${timesText(t, locale, fact)}` : ''}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
