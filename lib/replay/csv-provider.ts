/**
 * Kept for compatibility only: the organizers' CSV provider was replaced by the frozen yfinance snapshot
 * (snapshot-provider.ts). Import from '@/lib/replay' instead.
 */
export { ReplayDataError, parseCsv, parseTable, parseDecimal, parseIsoDate } from './snapshot-provider';
export type { CsvRecord } from './snapshot-provider';
export { getReplayProvider } from './index';
