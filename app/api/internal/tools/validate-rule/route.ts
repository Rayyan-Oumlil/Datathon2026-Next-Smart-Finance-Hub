import { z } from 'zod';
import { internalTool } from '@/lib/agent/internal';
import { validateRule } from '@/lib/services/rules-engine';

// Checks a rule and returns it in structured form. Nothing is saved.
export const POST = internalTool(z.object({ rule: z.unknown() }), ({ rule }, _actionId, scope) => validateRule(rule, 'en', scope));
