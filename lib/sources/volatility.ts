// The volatility measure of rules/v1.json (filters.volatility): sample standard deviation of daily simple
// returns, annualized with sqrt(252). Pure: same closes, same result.

import rules from '@/rules/v1.json';

export const TRADING_DAYS_PER_YEAR = 252;
export const MIN_DAILY_RETURNS = rules.filters.volatility.min_days_of_data;

/** closes: oldest first. Returns a fraction (0.24 = 24%), or null with fewer than 20 daily returns. */
export function annualizedVolatility(closes: number[]): number | null {
    if (closes.some((close) => !(close > 0) || !Number.isFinite(close))) return null;   // not a price series
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) returns.push(closes[i] / closes[i - 1] - 1);
    if (returns.length < MIN_DAILY_RETURNS || returns.some((r) => !Number.isFinite(r))) return null;
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}
