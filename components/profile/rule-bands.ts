import { RULES } from '@/lib/rules';
import type { RuleBands } from './RuleBreakdown';

/** The bands shown beside a result, read from the rules file so the page never repeats a threshold. Server side only. */
export const ruleBands = (): RuleBands => ({
    level: { max: RULES.level.max_points, bands: RULES.level.bands },
    risk: { max: RULES.risk.max_points, bands: RULES.risk.bands },
});
