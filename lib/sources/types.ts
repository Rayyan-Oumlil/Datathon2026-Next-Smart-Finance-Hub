import type { Sourced } from '@/lib/domain/types';

/** One daily close; date is the provider's trading day, YYYY-MM-DD. Lists are oldest first. */
export type DailyClose = { date: string; close: number };

/** What every quote function returns, whatever the provider. */
export type Quote = { price: Sourced; changePercent?: Sourced };

export const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
