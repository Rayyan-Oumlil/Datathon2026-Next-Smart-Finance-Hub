// Metrics of one replayed series. Volatility, worst fall and worst day come from lib/xray/stats.ts (the X-ray's own
// calculators), applied to the time-weighted index, so the two views use the same formulas.

import { DAYS_PER_YEAR, periodsPerYearOf } from '@/lib/xray/align';
import { annualVolPct, maxDrawdownOf, returnsOf, round, worstDayOf } from '@/lib/xray/stats';
import type { IsoDate } from '../types';
import type { SeriesRun } from './simulate';
import type { Effects, SeriesMetrics } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: IsoDate, b: IsoDate) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;

/** Return over calendar 2022 on the index: last point of 2021 to last point of 2022; null unless both exist. */
function return2022(dates: IsoDate[], index: number[]): number | null {
    let base = -1;
    let end = -1;
    dates.forEach((date, i) => {
        if (date <= '2021-12-31') base = i;
        if (date <= '2022-12-31') end = i;
    });
    if (base < 0 || end <= base || dates[dates.length - 1] < '2022-12-30' || dates[end] < '2022-12-28') return null;
    return round((index[end] / index[base] - 1) * 100, 2);
}

export function seriesMetrics(run: SeriesRun, dates: IsoDate[]): SeriesMetrics {
    const { index, valueCad } = run;
    const n = index.length;
    const returns = returnsOf(index);
    const years = daysBetween(dates[0], dates[n - 1]) / DAYS_PER_YEAR;
    const growth = index[n - 1] / 100;
    const curve = dates.map((date, i) => ({ date, value: index[i] }));
    const average = valueCad.reduce((sum, v) => sum + v, 0) / n;
    const contributedCad = run.contributedCad[n - 1];
    const initialOrderCount = run.orders.filter((o) => o.purpose === 'initial').length;
    return {
        finalValueCad: round(valueCad[n - 1], 2),
        contributedCad: round(contributedCad, 2),
        valueExContributionsCad: round(valueCad[n - 1] - contributedCad, 2),
        totalReturnPct: round((growth - 1) * 100, 2),
        annualisedReturnPct: years >= 1 ? round((growth ** (1 / years) - 1) * 100, 2) : null,
        volatilityPct: returns.length >= 2 ? round(annualVolPct(returns, periodsPerYearOf(dates)), 2) : 0,
        worstFall: maxDrawdownOf(curve),
        return2022Pct: return2022(dates, index),
        worstDay: returns.length > 0 ? worstDayOf(dates, returns) : { pct: 0, date: dates[0] },
        orderCount: run.orders.length - initialOrderCount,
        initialOrderCount,
        turnoverPct: average > 0 ? round((run.tradedCad / average) * 100, 2) : 0,
        feesCad: round(run.feesCad, 2),
    };
}

export function effectsOf(run: SeriesRun, capitalCad: number): Effects {
    return {
        marketCad: round(run.marketCad, 2),
        currencyCad: round(run.currencyCad, 2),
        feesCad: round(run.feesCad, 2),
        contributedCad: round(run.contributedCad[run.contributedCad.length - 1], 2),
        marketPct: round((run.marketCad / capitalCad) * 100, 2),
        currencyPct: round((run.currencyCad / capitalCad) * 100, 2),
    };
}
