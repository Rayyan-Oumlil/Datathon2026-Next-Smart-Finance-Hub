'use client';

import { useCallback, useRef, useState } from 'react';
import { applyStage, type StageLine } from '@/lib/agent/stages';
import { streamChat } from '@/lib/agent/stream-client';

export type AgentAnswer<T> = { reply: T; steps: StageLine[] };

/**
 * One agent request at a time. `ask` resolves with the reply and the steps it took, `stages` lists the steps so far,
 * and `stop` ends the request in progress: `ask` then throws an AbortError. Stopping frees the panel; the agent
 * service still finishes the request it started, so its audit rows stay complete.
 */
export function useAgentStream() {
    const [stages, setStages] = useState<StageLine[]>([]);
    const controller = useRef<AbortController | null>(null);

    const ask = useCallback(async <T,>(body: unknown, fallbackError: string): Promise<AgentAnswer<T>> => {
        const current = new AbortController();
        controller.current = current;
        let lines: StageLine[] = [];
        setStages([]);
        try {
            const reply = await streamChat<T>(body, (event) => {
                lines = applyStage(lines, event);
                setStages(lines);
            }, fallbackError, current.signal);
            return { reply, steps: lines.map((line) => (line.state === 'running' ? { ...line, state: 'done' as const } : line)) };
        } finally {
            if (controller.current === current) controller.current = null;
            setStages([]);
        }
    }, []);

    const stop = useCallback(() => controller.current?.abort(), []);

    return { stages, ask, stop };
}
