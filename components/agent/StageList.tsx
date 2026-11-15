'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Loader2, PenLine, Square } from 'lucide-react';
import type { StageLine } from '@/lib/agent/stages';

type Translator = ReturnType<typeof useTranslations<'AgentPanel'>>;

const labelKey = (line: StageLine): string => {
    if (line.stage === 'subagent') return `stages.subagent.${line.name}`;
    if (line.stage === 'tool') return `stages.tool.${line.name}`;
    if (line.stage === 'guardrail' && line.state === 'done' && line.passed === false) return 'stages.guardrailFailed';
    return `stages.${line.stage}`;
};

/** The words for one step; a name the panel has no text for is shown as it is. */
export const stageText = (t: Translator, line: StageLine): string => {
    const key = labelKey(line);
    return t.has(key as never) ? t(key as never) : line.name ?? line.stage;
};

export const stageFailed = (line: StageLine): boolean => line.state === 'done' && (!line.ok || line.passed === false);

/** A reply check that sent the wording back for a rewrite: a normal step, not an error (the rewrite is checked again). */
export const reworded = (line: StageLine): boolean => line.stage === 'guardrail' && line.state === 'done' && line.passed === false;

/** A tool call is shown under the specialist that precedes it, until the check or a rewrite begins. */
export const nest = (stages: StageLine[]): Array<{ line: StageLine; child: boolean }> => {
    let inside = false;
    return stages.map((line) => {
        if (line.stage === 'subagent') inside = true;
        else if (line.stage !== 'tool') inside = false;
        return { line, child: line.stage === 'tool' && inside };
    });
};

/** The steps the agent has taken for the request in progress: the orchestration, as it happens. */
const StageList = ({ stages, onStop }: { stages: StageLine[]; onStop: () => void }) => {
    const t = useTranslations('AgentPanel');
    return (
        <div className="mt-3">
            {stages.length === 0 ? <p className="text-[13px] text-faint">{t('working')}</p> : (
                <>
                    <p className="kicker">{t('stages.title')}</p>
                    <ol className="mt-1 flex flex-col gap-1 text-[13px]" aria-label={t('stages.title')}>
                        {nest(stages).map(({ line, child }) => (
                            <li key={line.key} className={`flex items-center gap-2 text-muted-foreground ${child ? 'ms-5 text-[12px]' : ''}`}>
                                {line.state === 'running'
                                    ? <Loader2 className="h-3.5 w-3.5 flex-none animate-spin motion-reduce:animate-none" aria-hidden />
                                    : reworded(line)
                                        ? <PenLine className="h-3.5 w-3.5 flex-none text-faint" aria-hidden />
                                    : stageFailed(line)
                                        ? <AlertTriangle className="h-3.5 w-3.5 flex-none text-down" aria-hidden />
                                        : <Check className="h-3.5 w-3.5 flex-none text-up" aria-hidden />}
                                <span className={line.state === 'running' || line.stage === 'subagent' ? 'font-medium text-foreground' : undefined}>{stageText(t, line)}</span>
                                {line.state === 'done' && line.ms !== undefined && <span className="num ms-auto text-[11px] text-faint">{t('stages.took', { ms: line.ms })}</span>}
                            </li>
                        ))}
                    </ol>
                </>
            )}
            <button type="button" className="btn btn-ghost mt-2 h-8 px-2.5 text-xs" onClick={onStop}>
                <Square className="h-3 w-3" aria-hidden /> {t('stop')}
            </button>
        </div>
    );
};

export default StageList;
