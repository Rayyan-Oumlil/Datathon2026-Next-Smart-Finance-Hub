/**
 * Types of the time machine's data layer. They describe the data, not where it comes from: nothing here knows
 * about files or CSV, so another provider (an extended snapshot, S3) can return the same shapes.
 * Dates are ISO calendar dates ('YYYY-MM-DD') everywhere; they compare correctly as strings.
 */

import type { TextRef } from '@/lib/domain/types';

export type IsoDate = string;

export type AssetClass = 'equity' | 'etf_equity' | 'etf_bond' | 'etf_commodity' | 'crypto';
export type ListingCurrency = 'CAD' | 'USD';

export type ReplayAsset = {
    assetId: string;
    ticker: string;
    name: string;
    assetClass: AssetClass;
    market: string;            // as given by the organizers: 'TSX', 'NASDAQ', 'NYSE Arca', 'Crypto (24/7)' ...
    currency: ListingCurrency;
    sector: string;            // universe sector, or the asset class label for funds and crypto
    /** Yahoo symbol the prices come from (data/replay/symbol-map.json), when it differs from `ticker`. */
    yahooSymbol?: string;
    /** Set on rows listed under their Yahoo symbol (e.g. 'BTC-USD'): the app symbol they stand for ('BTC'). */
    aliasOf?: string;
    firstDate?: IsoDate;       // first and last price row in the snapshot
    lastDate?: IsoDate;
    warnings?: string[];       // soft quality warnings of the snapshot manifest, as written by the builder
};

/** One row of prices.csv. `close` is split-adjusted only; `adjClose` is split- and dividend-adjusted. */
export type DailyPrice = {
    date: IsoDate;
    ticker: string;
    open: number;
    high: number;
    low: number;
    close: number;
    adjClose: number;
    volume: number;
    currency: ListingCurrency;
};

export type CorporateAction = {
    exDate: IsoDate;
    ticker: string;
    action: 'dividend' | 'split';
    value: number;
    unit: string;              // 'USD per share', 'CAD per share', 'split ratio (new:old)'
    /**
     * Always false: prices are already split- and dividend-adjusted, so the engine never re-applies an action.
     * The rows are kept for reference and display only.
     */
    appliesToPrices: false;
    /** Set on rows the replay knowingly disregards; the note id points into describe().notes. */
    flag?: { noteId: string };
};

/** Daily USD/CAD (snapshot: Yahoo USDCAD=X close): 1 USD = usdcad CAD. */
export type FxPoint = {
    date: IsoDate;
    usdcad: number;
    cadusd: number;
};

export type MacroPoint = {
    /** Date as given in the file: the observation day for daily series, the reference month (day 01) for monthly ones. */
    date: IsoDate;
    /** First day the value may be used by the replay (publication lag applied, see series.ts). */
    availableFrom: IsoDate;
    seriesId: string;
    value: number;
    unit: string;
    frequency: string;
    label: string;
    source: string;
};

/** Where a file of the dataset comes from (the snapshot provider builds it from manifest.json). */
export type SourceMetadata = {
    file: string;
    content: string;
    source: string;
    sourceUrl: string | null;  // 'n/a' in the file becomes null
    retrievedOn: IsoDate;
    coverage: string;
    frequency: string;
    processing: string;
    limitations: string;
    termsOfUse: string;
};

/** Where a table comes from: the matching sources_metadata row plus the dataset it belongs to. */
export type Provenance = SourceMetadata & { datasetId: string };

/** Every table the provider returns carries its provenance, so each figure can be shown with source and date. */
export type ReplayTable<R> = {
    id: string;                // ticker, series id, or table name ('assets', 'fx:USDCAD', 'corporate_actions')
    rows: R[];                 // sorted by date ascending (then ticker), deterministic
    provenance: Provenance;
    unit?: string;
    currency?: string;
};

export type DateRange = { from?: IsoDate; to?: IsoDate };

/**
 * A fact about the data shown to the user. `textRef` is the catalog key the UI renders (next-intl, namespace
 * Replay); `detail` is a plain English description for logs and developers, never displayed as is.
 */
export type DataNote = {
    id: string;
    textRef: TextRef;
    detail: string;
};

export type DatasetFile = { name: string; sha256: string; rows: number };

export type DatasetDescription = {
    datasetId: string;
    provider: string;          // 'snapshot' (frozen yfinance snapshot) or 'yahoo-live' (données non figées)
    extractedOn: IsoDate;
    window: { from: IsoDate; to: IsoDate };
    files: DatasetFile[];
    notes: DataNote[];         // processing decisions taken on this data (ignored rows, alignment ...)
    limitations: DataNote[];   // limits shown to the user next to every replay
    /** Snapshot id (same as datasetId for the snapshot provider); shown and logged with every replay. */
    snapshotId?: string;
    /** False for live data ("données non figées"). */
    frozen?: boolean;
    /** The limitations as plain sentences, French and English, for the "Pourquoi ces données ?" panel. */
    limitationsText?: { fr: string[]; en: string[] };
    /** Symbols left out of the snapshot, with the reason (failed download or failed hard quality check). */
    excluded?: Array<{ yahooSymbol: string; appSymbols: string[]; reason: string }>;
    /** App symbols that are not prices (bond yields), with the reason. */
    notReplayable?: Array<{ symbol: string; reason: string }>;
    /** The whole manifest.json, as read and verified. */
    manifest?: SnapshotManifest;
};

/** manifest.json written by scripts/build_replay_dataset.py (only the fields the app reads are typed strictly). */
export type SnapshotManifest = {
    snapshotId: string;
    source: string;
    sourceUrl: string;
    library: { name: string; version: string; [k: string]: string };
    extractedAt: string;
    extractionDate: IsoDate;
    window: { requestedFrom: IsoDate; requestedTo: IsoDate; from: IsoDate; to: IsoDate };
    files: Record<string, { sha256: string; rows: number; bytes?: number }>;
    fx: { yahooSymbol: string; firstDate: IsoDate; lastDate: IsoDate; rows: number; warnings: string[] };
    symbols: Array<{
        yahooSymbol: string;
        appSymbols: string[];
        origins?: string[];
        group: 'TSX' | 'US' | 'crypto';
        currency: string;
        exchange?: string | null;
        exchangeTimezone?: string | null;
        firstDate: IsoDate;
        lastDate: IsoDate;
        rows: number;
        warnings: string[];
    }>;
    excluded: Array<{ yahooSymbol: string; appSymbols: string[]; reason: string; warnings?: string[] }>;
    notReplayable: Array<{ symbol: string; reason: string }>;
    limitations: string[];
    [k: string]: unknown;
};

/** One app symbol available for replay, with its coverage in the snapshot. */
export type ReplaySymbol = {
    symbol: string;            // app symbol (data/universe.json or symbol-map extras)
    yahooSymbol: string;
    name: string;
    assetClass: AssetClass;
    currency: ListingCurrency;
    firstDate: IsoDate;
    lastDate: IsoDate;
    warnings: string[];
};
