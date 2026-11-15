'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useReveal } from '@/hooks/useReveal';

type AgentTextProps = { text: string; animate: boolean; onDone: () => void };

/** The text of an agent reply. A reply that has just been checked and received appears a few words at a time. */
const AgentText = ({ text, animate, onDone }: AgentTextProps) => {
    const t = useTranslations('AgentPanel');
    const shown = useReveal(text, animate, onDone);
    return (
        <p className="whitespace-pre-wrap break-words text-foreground">
            <span className="sr-only">{t('agentSaid')}</span>{shown}
        </p>
    );
};

export default AgentText;
