import { respond } from '@/lib/services/http';
import { evaluateRules } from '@/lib/services/rules-engine';

export const POST = () => respond(evaluateRules);
