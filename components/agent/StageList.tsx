'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { StageLine } from '@/lib/agent/stages';

const labelKey = (line: StageLine): string => {
    if (line.stage === 'subagent') return `stages.subagent.${line.name}`;
    if (line.stage === 'tool') return `stages.tool.${line.name}`;
    if (line.stage === 'guardrail' && line.state === 'done' && line.passed === false) return 'stages.guardrailFailed';
    return `stages.${line.stage}`;
};

/** The steps the agent has taken for the request in progress: the orchestration, as it happens. */
const StageList = ({ stages }: { stages: StageLine[] }) => {
    const t = useTranslations('AgentPanel');
    if (stages.length === 0) return <p className="mt-3 text-[13px] text-faint">{t('working')}</p>;
    return (
        <div className="mt-3">
            <p className="kicker">{t('stages.title')}</p>
            <ol className="mt-1 flex flex-col gap-1 text-[13px]" aria-label={t('stages.title')}>
                {stages.map((line) => {
                    const key = labelKey(line);
                    const failed = line.state === 'done' && (!line.ok || line.passed === false);
                    return (
                        <li key={line.key} className="flex items-center gap-2 text-muted-foreground">
                            {line.state === 'running'
                                ? <Loader2 className="h-3.5 w-3.5 flex-none animate-spin motion-reduce:animate-none" aria-hidden />
                                : failed
                                    ? <AlertTriangle className="h-3.5 w-3.5 flex-none text-down" aria-hidden />
                                    : <Check className="h-3.5 w-3.5 flex-none text-up" aria-hidden />}
                            <span className={line.state === 'running' ? 'text-foreground' : undefined}>{t.has(key) ? t(key) : line.name ?? line.stage}</span>
                            {line.state === 'done' && line.ms !== undefined && <span className="num ms-auto text-[11px] text-faint">{t('stages.took', { ms: line.ms })}</span>}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
};

export default StageList;
