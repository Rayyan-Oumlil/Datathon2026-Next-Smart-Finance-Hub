/**
 * Public entry of the replay data layer. The engine depends on the DataProvider interface (provider.ts);
 * the app gets the provider from getReplayProvider() (the frozen yfinance snapshot, no network).
 */

import type { DataProvider } from './provider';
import { getSnapshotProvider } from './snapshot-provider';
import type { ReplaySymbol } from './types';

export type { DataProvider } from './provider';
export * from './types';
export * from './calendar';
export * from './series';
export {
    SnapshotProvider,
    ReplayDataError,
    listSnapshots,
    resolveSnapshotId,
    resetReplayProviderCache,
    parseCsv,
    parseTable,
} from './snapshot-provider';
export type { SnapshotProviderOptions } from './snapshot-provider';
export { YahooLiveProvider, LIVE_LABEL, liveAllowed } from './live-provider';

/** The provider the app and the engine use: the frozen snapshot (REPLAY_SNAPSHOT_ID or the newest one). */
export function getReplayProvider(): DataProvider {
    return getSnapshotProvider();
}

/** App symbols available in the snapshot, with their first and last date. */
export function listReplaySymbols(): Promise<ReplaySymbol[]> {
    return getSnapshotProvider().listSymbols();
}
