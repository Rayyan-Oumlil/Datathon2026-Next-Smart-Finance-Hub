// The X-ray's headline figures as sourced values, for the agent. The agent lists a source only for a number it
// states that sits in a sourced value (value, source, time), and the X-ray's own fields are plain numbers, so each
// figure is repeated here with where it comes from. Every key carries its window ('volatility_last1y'), because the
// agent labels a source by its key. Pure.

import type { Sourced } from '@/lib/domain/types';
import { XRAY_VERSION, WINDOW_IDS, type EngineOutput, type WindowId } from './types';

type Stamp = { computedAt: string; sources: Array<Sourced<string>> };

/** One figure: `unit` is '%' or 'ratio'. The note says what it is; the source names the version and the series. */
function figure(value: number, unit: string, stamp: Stamp, asOf: string | undefined, note: string): Sourced {
    const inputs = [...new Set(stamp.sources.map((s) => s.source))].join(', ') || 'no price history';
    return {
        value, unit, source: `derived (${XRAY_VERSION}) from daily closes: ${inputs}`,
        fetchedAt: stamp.computedAt, ...(asOf ? { asOf } : {}), note,
    };
}

/** The figures of the concentration and of the one window the agent asked for (all of them when `only` is left out). */
export function agentFigures(out: EngineOutput, stamp: Stamp, only?: WindowId): Record<string, unknown> {
    const c = out.concentration;
    const lastDay = (() => {
        const w = out.windows.full;
        return w.available ? w.to : undefined;
    })();
    const figures: Record<string, unknown> = {
        topShare: figure(c.topHolding?.sharePct ?? 0, '%', stamp, lastDay, 'share of the whole portfolio, cash included'),
        top3Share: figure(c.top3SharePct, '%', stamp, lastDay, 'share of the whole portfolio held by the three largest positions'),
        effectiveHoldings: figure(c.effectiveHoldings ?? 0, 'ratio', stamp, lastDay, '1 / sum of squared shares of the invested part'),
        cashShare: figure(out.cashSharePct, '%', stamp, lastDay, 'cash as a share of the whole portfolio'),
    };
    for (const id of WINDOW_IDS as readonly WindowId[]) {
        if (only && id !== only) continue;
        const w = out.windows[id];
        if (!w.available) continue;
        figures[`volatility_${id}`] = figure(w.volatilityPct, '%', stamp, w.to, `annualised volatility of the ${id} replay, ${w.from} to ${w.to}`);
        figures[`maxDrawdown_${id}`] = figure(w.maxDrawdown.pct, '%', stamp, w.to, `maximum drawdown of the ${id} replay, ${w.maxDrawdown.peakDate} to ${w.maxDrawdown.troughDate}`);
        figures[`worstDay_${id}`] = figure(w.worstDay.pct, '%', stamp, w.to, `worst day of the ${id} replay, ${w.worstDay.date}`);
        figures[`holdings_${id}`] = w.risk.map((r) => ({
            symbol: r.symbol,
            [`weight_${id}`]: figure(r.weightPct, '%', stamp, w.to, `weight in the ${id} replay, renormalised over the holdings it covers`),
            ...(r.riskSharePct === null ? {} : { [`riskShare_${id}`]: figure(r.riskSharePct, '%', stamp, w.to, `share of the ${id} replay's variance`) }),
        }));
    }
    return figures;
}
