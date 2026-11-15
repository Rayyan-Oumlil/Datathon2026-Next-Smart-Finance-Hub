import file from '@/rules/v1.json';

/** The rules file as written. Every threshold, weight and formula is read from here, never repeated in code. */
export type Rules = typeof file;

export const RULES: Rules = file;

export const RULES_VERSION: string = file.version;

export const RULE_VERSIONS = {
    level: file.level.version,
    risk: file.risk.version,
    filters: file.filters.version,
    score: file.score.version,
    selection: file.selection.version,
    reasons: file.reasons.version,
};

/**
 * The Novice floor for stocks is only written in words in the rules file ("market cap >= US$10B, ...").
 * It is read from that sentence so the file stays the single place the number lives.
 */
export function noviceStockFloorUsd(rules: Rules): number {
    const text = rules.filters.asset_class_rules.novice.stocks;
    const match = /US\$(\d+(?:\.\d+)?)\s*([BM])/.exec(text);
    if (!match) throw new Error(`rules: no US$ amount found in the Novice stock rule "${text}"`);
    return Number(match[1]) * (match[2] === 'B' ? 1e9 : 1e6);
}
