// The sentences the profile rules write, in English and French. The answer that triggers a cap is described by the
// rules file itself (risk.caps[].answer_shown / answer_shown_fr), so its wording lives in one place.

import { RULES } from '@/lib/rules';
import { defineCatalog, sayer } from '@/lib/watchlist/text';

type Cap = (typeof RULES.risk.caps)[number] & { board_text_fr?: string; answer_shown_fr?: string };
const capAt = (index: number): Cap | undefined => RULES.risk.caps[index] as Cap | undefined;

export const RULES_TEXT = defineCatalog({
    // A risk chosen by hand above a cap's max_risk (risk.caps_apply_to_overrides)
    'rules.cap_refusal': {
        en: (p: { chosen: string; max: string; cap: number }) =>
            `${p.chosen} is not available: ${capAt(p.cap)?.answer_shown ?? ''}, which limits the risk profile to ${p.max}.`,
        fr: (p: { chosen: string; max: string; cap: number }, f) =>
            `Le profil de risque ${f.risk(p.chosen)} n’est pas disponible : ${capAt(p.cap)?.answer_shown_fr ?? capAt(p.cap)?.answer_shown ?? ''}, ce qui limite le profil de risque à ${f.risk(p.max)}.`,
    },
    // RiskResult.cappedBy: the cap's own wording from the rules file
    'rules.capped_by': {
        en: (p: { cap: number }) => capAt(p.cap)?.board_text ?? '',
        fr: (p: { cap: number }) => capAt(p.cap)?.board_text_fr ?? capAt(p.cap)?.board_text ?? '',
    },
});

export const sayRules = sayer(RULES_TEXT);
