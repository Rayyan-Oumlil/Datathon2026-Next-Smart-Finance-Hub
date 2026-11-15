'use client';

import { useState } from 'react';
import { ChevronDown, Database } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useReplayFmt } from './useReplayFmt';

export type DatasetInfo = {
    snapshotId: string;
    provider: string;
    frozen: boolean;
    source: string | null;
    sourceUrl: string | null;
    library: { name: string; version: string } | null;
    extractedAt: string | null;
    extractedOn: string;
    window: { from: string; to: string };
    symbolCount: number;
    appSymbols: string[];
    qualityWarnings: number;
    symbolsWithWarnings: number;
    excluded: Array<{ yahooSymbol: string; appSymbols: string[]; reason: string }>;
    notReplayable: Array<{ symbol: string; reason: string }>;
    files: Array<{ name: string; sha256: string; rows: number }>;
    notes: Array<{ id: string; key: string }>;
    limitations: Array<{ id: string; key: string }>;
};

const REASONS = ['coverage', 'sameSource', 'totalReturn', 'reproducible', 'noLookAhead', 'offline'] as const;

// « Pourquoi ces données ? »: what the replay reads (from manifest.json through GET /api/replay/dataset), why this
// source, its limits, and how the time machine differs from the X-ray.
export default function DatasetPanel({ dataset, error }: { dataset: DatasetInfo | null; error: string | null }) {
    const t = useTranslations('Replay');
    const f = useReplayFmt();
    const [open, setOpen] = useState(false);
    const text = (key: string) => {
        const k = key.replace(/^Replay\./, '');
        return t.has(k) ? t(k) : null;
    };

    return (
        <section className="hatch">
            <div className="card">
                <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                    <span className="flex items-center gap-2.5">
                        <span className="bento-ico"><Database /></span>
                        <span>
                            <span className="block text-[14px] font-bold text-foreground">{t('dataset.title')}</span>
                            <span className="block text-[12px] text-faint">{dataset ? t('dataset.teaser', { id: dataset.snapshotId, count: dataset.symbolCount }) : t('dataset.teaserLoading')}</span>
                        </span>
                    </span>
                    <ChevronDown className={`size-4 flex-none text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                    <div className="grid gap-5 border-t border-line px-4 py-4 lg:grid-cols-2">
                        <div className="flex flex-col gap-4">
                            {error && <p role="alert" className="text-[13px] text-down">{error}</p>}
                            {dataset && (
                                <div>
                                    <p className="text-[12.5px] font-bold text-foreground">{t('dataset.factsTitle')}</p>
                                    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
                                        <dt className="text-faint">{t('dataset.snapshot')}</dt><dd className="mono break-all text-foreground">{dataset.snapshotId}</dd>
                                        <dt className="text-faint">{t('dataset.source')}</dt><dd className="text-foreground">{dataset.source ?? '—'}</dd>
                                        <dt className="text-faint">{t('dataset.library')}</dt><dd className="text-foreground">{dataset.library ? `${dataset.library.name} ${dataset.library.version}` : '—'}</dd>
                                        <dt className="text-faint">{t('dataset.extracted')}</dt><dd className="text-foreground">{dataset.extractedAt ? f.dateTime(dataset.extractedAt) : f.date(dataset.extractedOn)}</dd>
                                        <dt className="text-faint">{t('dataset.window')}</dt><dd className="text-foreground">{t('dataset.windowValue', { from: f.date(dataset.window.from), to: f.date(dataset.window.to) })}</dd>
                                        <dt className="text-faint">{t('dataset.symbols')}</dt><dd className="num text-foreground">{f.num(dataset.symbolCount)}</dd>
                                        <dt className="text-faint">{t('dataset.warnings')}</dt><dd className="num text-foreground">{t('dataset.warningsValue', { count: dataset.qualityWarnings, symbols: dataset.symbolsWithWarnings })}</dd>
                                        <dt className="text-faint">{t('dataset.excluded')}</dt>
                                        <dd className="text-foreground">
                                            {dataset.excluded.length === 0 ? t('dataset.excludedNone') : (
                                                <ul>{dataset.excluded.map((e) => <li key={e.yahooSymbol}><span className="mono">{e.yahooSymbol}</span> : {e.reason}</li>)}</ul>
                                            )}
                                        </dd>
                                        {dataset.notReplayable.length > 0 && (<>
                                            <dt className="text-faint">{t('dataset.notReplayable')}</dt>
                                            <dd className="text-foreground">{t('dataset.notReplayableValue', { symbols: dataset.notReplayable.map((n) => n.symbol).join(', ') })}</dd>
                                        </>)}
                                    </dl>
                                </div>
                            )}
                            <div>
                                <p className="text-[12.5px] font-bold text-foreground">{t('dataset.whyTitle')}</p>
                                <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-4 text-[12.5px] leading-relaxed text-muted-foreground">
                                    {REASONS.map((r) => <li key={r}>{t(`dataset.why.${r}`)}</li>)}
                                </ul>
                            </div>
                            <div className="rounded-[10px] bg-brand-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground">
                                <p className="font-bold text-brand-ink">{t('dataset.xrayTitle')}</p>
                                <p className="mt-0.5">{t('dataset.xray')}</p>
                            </div>
                        </div>
                        <div className="flex flex-col gap-4">
                            <div>
                                <p className="text-[12.5px] font-bold text-foreground">{t('dataset.limitsTitle')}</p>
                                <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-4 text-[12.5px] leading-relaxed text-muted-foreground">
                                    {(dataset?.limitations ?? []).map((l) => { const s = text(l.key); return s ? <li key={l.id}>{s}</li> : null; })}                                </ul>
                            </div>
                            {dataset && dataset.notes.length > 0 && (
                                <div>
                                    <p className="text-[12.5px] font-bold text-foreground">{t('dataset.notesTitle')}</p>
                                    <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-4 text-[12.5px] leading-relaxed text-muted-foreground">
                                        {dataset.notes.map((n) => { const s = text(n.key); return s ? <li key={n.id}>{s}</li> : null; })}
                                    </ul>
                                </div>
                            )}
                            {dataset && (
                                <div>
                                    <p className="text-[12.5px] font-bold text-foreground">{t('dataset.filesTitle')}</p>
                                    <ul className="mt-1.5 flex flex-col gap-1 text-[11.5px] text-faint">
                                        {dataset.files.map((file) => (
                                            <li key={file.name} className="min-w-0"><span className="mono text-muted-foreground">{file.name}</span> · {t('dataset.rows', { count: file.rows })} · <span className="mono break-all">sha256 {file.sha256.slice(0, 16)}…</span></li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
