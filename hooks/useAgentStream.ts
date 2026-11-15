'use client';

import { useCallback, useState } from 'react';
import { applyStage, type StageLine } from '@/lib/agent/stages';
import { streamChat } from '@/lib/agent/stream-client';

/** One agent request at a time: `ask` resolves with the reply, and `stages` lists what the agent has done so far. */
export function useAgentStream() {
    const [stages, setStages] = useState<StageLine[]>([]);

    const ask = useCallback(async <T,>(body: unknown, fallbackError: string): Promise<T> => {
        setStages([]);
        try {
            return await streamChat<T>(body, (event) => setStages((lines) => applyStage(lines, event)), fallbackError);
        } finally {
            setStages([]);
        }
    }, []);

    return { stages, ask };
}
