'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useReveal } from '@/hooks/useReveal';

type AgentTextProps = { text: string; animate: boolean; onDone: () => void };

type Block = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };

const BULLET = /^\s*[-•*]\s+(.*)$/;

/** Plain text in, blocks out: paragraphs split on blank lines, consecutive "- " lines become one list. */
export function toBlocks(text: string): Block[] {
    const blocks: Block[] = [];
    let paragraph: string[] = [];
    const flush = () => {
        if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join(' ') });
        paragraph = [];
    };
    for (const line of text.split(/\r?\n/)) {
        const bullet = BULLET.exec(line);
        if (bullet) {
            flush();
            const last = blocks[blocks.length - 1];
            if (last?.kind === 'ul') last.items.push(bullet[1]);
            else blocks.push({ kind: 'ul', items: [bullet[1]] });
        } else if (!line.trim()) {
            flush();
        } else {
            paragraph.push(line.trim());
        }
    }
    flush();
    return blocks;
}

/** The text of an agent reply. A reply that has just been checked and received appears a few words at a time. */
const AgentText = ({ text, animate, onDone }: AgentTextProps) => {
    const t = useTranslations('AgentPanel');
    const shown = useReveal(text, animate, onDone);
    const blocks = toBlocks(shown);
    return (
        <div className="space-y-2 break-words leading-relaxed text-foreground">
            <span className="sr-only">{t('agentSaid')}</span>
            {blocks.map((block, index) => block.kind === 'p'
                ? <p key={index}>{block.text}</p>
                : (
                    <ul key={index} className="space-y-1 pl-1">
                        {block.items.map((item, i) => (
                            <li key={i} className="flex gap-2">
                                <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-brand-ink" />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                ))}
        </div>
    );
};

export default AgentText;
