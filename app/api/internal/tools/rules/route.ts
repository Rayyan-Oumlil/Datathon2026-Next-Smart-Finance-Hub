import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { listRules } from '@/lib/services/rules-engine';

export const POST = internalTool(z.object({}), async (_input, _actionId, scope) => ({ rules: await listRules(scope) }));
