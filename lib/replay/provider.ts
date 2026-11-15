/**
 * The only door between the replay engine and its data. The engine depends on this interface, never on a file
 * format, so a future provider (an extended, frozen yfinance snapshot, or the same CSV on S3) plugs in without
 * touching the engine. The default implementation is SnapshotProvider (snapshot-provider.ts), reading a frozen
 * yfinance snapshot under data/replay/<id>/. Implementations must make no network call at replay time and return identical output
 * for identical input (reproducibility).
 */

import type {
    CorporateAction,
    DailyPrice,
    DatasetDescription,
    DateRange,
    FxPoint,
    MacroPoint,
    IsoDate,
    ReplayAsset,
    ReplaySymbol,
    ReplayTable,
    SourceMetadata,
} from './types';

export interface DataProvider {
    /** The investable universe, in file order. */
    getAssets(): Promise<ReplayTable<ReplayAsset>>;

    /** One table per requested ticker, in the order requested. Throws on an unknown ticker. Bounds are inclusive. */
    getDailyPrices(tickers: string[], range?: DateRange): Promise<ReplayTable<DailyPrice>[]>;

    /** USD/CAD (snapshot: Yahoo USDCAD=X daily close); no row on days without a quote. Bounds are inclusive. */
    getFx(range?: DateRange): Promise<ReplayTable<FxPoint>>;

    /** All actions, or those of the given tickers. Reference only: prices are already adjusted. */
    getCorporateActions(tickers?: string[]): Promise<ReplayTable<CorporateAction>>;

    /** One table per series, in the order requested (or sorted by id when omitted). Throws on an unknown id. */
    getMacro(seriesIds?: string[]): Promise<ReplayTable<MacroPoint>[]>;

    getSourcesMetadata(): Promise<SourceMetadata[]>;

    /** Dataset id, extraction date, window, file hashes, processing notes and limitations. */
    describe(): Promise<DatasetDescription>;

    // ---- optional additions (the snapshot provider implements them; older fakes need not) ----

    /** Same as getCorporateActions (the name used in docs/v2-brief.md). */
    getActions?(tickers?: string[]): Promise<ReplayTable<CorporateAction>>;

    /** The common calendar derived from the data (calendar.ts): 'union' (default) of TSX and U.S. trading days. */
    getCalendar?(mode?: 'union' | 'intersection'): Promise<IsoDate[]>;

    /** App symbols available for replay, with their first and last date. */
    listSymbols?(): Promise<ReplaySymbol[]>;
}
