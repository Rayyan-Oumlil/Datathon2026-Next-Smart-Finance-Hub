/**
 * SnapshotProvider: the replay's data from a frozen yfinance snapshot, data/replay/<snapshot-id>/ (built once by
 * scripts/build_replay_dataset.py). This is the only module that knows about the files and their format.
 *
 * - Which snapshot: REPLAY_SNAPSHOT_ID, otherwise the newest folder (by extraction date, then id) that holds a
 *   manifest.json.
 * - Integrity: every data file must hash (SHA-256) to the value in manifest.json and have the row count it gives;
 *   otherwise the provider refuses the data (a new extraction changes past adj_close values, so only the frozen
 *   bytes give reproducible results).
 * - No network, ever. Loaded once per folder and memoised; rows are frozen.
 * - App symbols ('BTC', 'GOLD', 'BRK.B') and their Yahoo symbols ('BTC-USD', 'GLD', 'BRK-B') are both accepted;
 *   a returned table carries the ticker that was asked for.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { getEntry } from '@/lib/universe';

import { buildCommonCalendar } from './calendar';
import type { DataProvider } from './provider';
import type {
    AssetClass,
    CorporateAction,
    DailyPrice,
    DataNote,
    DatasetDescription,
    DatasetFile,
    DateRange,
    FxPoint,
    IsoDate,
    ListingCurrency,
    MacroPoint,
    Provenance,
    ReplayAsset,
    ReplaySymbol,
    ReplayTable,
    SnapshotManifest,
    SourceMetadata,
} from './types';

// ------------------------------------------------------------------ errors

export class ReplayDataError extends Error {
    constructor(
        message: string,
        readonly file?: string,
        readonly line?: number,
    ) {
        super(file ? `${file}${line !== undefined ? `:${line}` : ''}: ${message}` : message);
        this.name = 'ReplayDataError';
    }
}

// ------------------------------------------------------------------ CSV parser (RFC 4180)

export type CsvRecord = { line: number; fields: string[] };

/**
 * Parses CSV text: comma separator, double-quoted fields with "" as an escaped quote, commas and line breaks
 * allowed inside quotes, LF or CRLF line ends, optional final line end, optional UTF-8 BOM. Every record keeps
 * the line it starts on so validation errors can point to it. Malformed quoting throws; nothing is skipped.
 */
export function parseCsv(text: string, file = 'input'): CsvRecord[] {
    const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    // Fast path: the snapshot files never quote (symbols and numbers only)
    if (!s.includes('"') && !s.includes('\r')) {
        const lines = s.split('\n');
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        return lines.map((l, k) => ({ line: k + 1, fields: l.split(',') }));
    }
    const records: CsvRecord[] = [];
    const n = s.length;
    let i = 0;
    let line = 1;

    while (i < n) {
        const recordLine = line;
        const fields: string[] = [];
        for (;;) {
            let field = '';
            if (s[i] === '"') {
                i++;
                for (;;) {
                    if (i >= n) throw new ReplayDataError('unterminated quoted field', file, recordLine);
                    const c = s[i];
                    if (c === '"') {
                        if (s[i + 1] === '"') {
                            field += '"';
                            i += 2;
                            continue;
                        }
                        i++;
                        break;
                    }
                    if (c === '\n') line++;
                    field += c;
                    i++;
                }
                if (i < n && s[i] !== ',' && s[i] !== '\n' && !(s[i] === '\r' && s[i + 1] === '\n')) {
                    throw new ReplayDataError('unexpected character after closing quote', file, line);
                }
            } else {
                const start = i;
                while (i < n && s[i] !== ',' && s[i] !== '\n' && !(s[i] === '\r' && s[i + 1] === '\n')) {
                    if (s[i] === '"') throw new ReplayDataError('quote inside an unquoted field', file, line);
                    if (s[i] === '\r') throw new ReplayDataError('bare carriage return', file, line);
                    i++;
                }
                field = s.slice(start, i);
            }
            fields.push(field);
            if (i >= n) break;
            if (s[i] === ',') {
                i++;
                continue;
            }
            i += s[i] === '\r' ? 2 : 1;
            line++;
            break;
        }
        records.push({ line: recordLine, fields });
    }
    return records;
}

type Row = { line: number; get: (column: string) => string };

/** Checks the header is exactly the expected one and every record has as many fields. */
export function parseTable(text: string, file: string, columns: readonly string[]): Row[] {
    const records = parseCsv(text, file);
    if (records.length === 0) throw new ReplayDataError('empty file', file);
    const header = records[0].fields;
    if (header.length !== columns.length || header.some((h, k) => h !== columns[k])) {
        throw new ReplayDataError(`unexpected header "${header.join(',')}", expected "${columns.join(',')}"`, file, 1);
    }
    const index = new Map(columns.map((c, k) => [c, k]));
    return records.slice(1).map((r) => {
        if (r.fields.length !== columns.length) {
            throw new ReplayDataError(`expected ${columns.length} fields, found ${r.fields.length}`, file, r.line);
        }
        return { line: r.line, get: (c: string) => r.fields[index.get(c)!] };
    });
}

// ------------------------------------------------------------------ field validators

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER_RE = /^\d+$/;

function fail(message: string, file: string, row: Row): never {
    throw new ReplayDataError(message, file, row.line);
}

export function parseIsoDate(raw: string, file: string, row: Row, column: string): IsoDate {
    const m = DATE_RE.exec(raw);
    if (m) {
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        if (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) return raw;
    }
    return fail(`${column}: "${raw}" is not an ISO date`, file, row);
}

/** Number() on a string that matched a strict decimal pattern: the nearest double, no partial parse. */
export function parseDecimal(raw: string, file: string, row: Row, column: string, opts: { positive?: boolean } = {}): number {
    if (!DECIMAL_RE.test(raw)) fail(`${column}: "${raw}" is not a number`, file, row);
    const v = Number(raw);
    if (!Number.isFinite(v)) fail(`${column}: "${raw}" is not finite`, file, row);
    if (opts.positive && !(v > 0)) fail(`${column}: ${raw} must be > 0`, file, row);
    return v;
}

/** Yahoo sometimes leaves open/high/low empty; the builder writes them empty, the provider returns NaN (never a guess). */
function parseOptionalDecimal(raw: string, file: string, row: Row, column: string): number {
    return raw === '' ? Number.NaN : parseDecimal(raw, file, row, column);
}

function parseVolume(raw: string, file: string, row: Row): number {
    if (raw === '') return 0;
    if (!INTEGER_RE.test(raw)) fail(`volume: "${raw}" is not a non-negative integer`, file, row);
    return Number(raw);
}

// ------------------------------------------------------------------ files and manifest

export const FILES = { prices: 'prices.csv', actions: 'actions.csv', fx: 'fx.csv' } as const;
export const MANIFEST_FILE = 'manifest.json';
export const SYMBOL_MAP_FILE = 'symbol-map.json';

const COLUMNS = {
    prices: ['date', 'symbol', 'open', 'high', 'low', 'close', 'adj_close', 'volume', 'currency'],
    actions: ['date', 'symbol', 'type', 'value'],
    fx: ['date', 'usdcad'],
} as const;

const CURRENCIES: readonly ListingCurrency[] = ['CAD', 'USD'];
const SPLIT_UNIT = 'split ratio (new:old)';

function readManifest(dir: string): SnapshotManifest {
    let raw: string;
    try {
        raw = readFileSync(path.join(dir, MANIFEST_FILE), 'utf8');
    } catch {
        throw new ReplayDataError('missing manifest: the replay refuses data it cannot verify', MANIFEST_FILE);
    }
    let m: SnapshotManifest;
    try {
        m = JSON.parse(raw) as SnapshotManifest;
    } catch {
        throw new ReplayDataError('invalid JSON', MANIFEST_FILE);
    }
    const ok =
        typeof m?.snapshotId === 'string' &&
        typeof m.extractionDate === 'string' &&
        typeof m.window?.from === 'string' &&
        typeof m.window?.to === 'string' &&
        Array.isArray(m.symbols) &&
        m.files &&
        Object.values(FILES).every(
            (f) => typeof m.files[f]?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(m.files[f].sha256) && Number.isInteger(m.files[f].rows),
        );
    if (!ok) throw new ReplayDataError('manifest must give snapshotId, extractionDate, window, symbols and a sha256 + rows per file', MANIFEST_FILE);
    if (path.basename(dir) !== m.snapshotId) {
        throw new ReplayDataError(`folder ${path.basename(dir)} holds snapshot ${m.snapshotId}`, MANIFEST_FILE);
    }
    return m;
}

/** Reads a data file and refuses it unless its bytes hash to the manifest's value. */
function readVerified(dir: string, file: string, manifest: SnapshotManifest): string {
    let bytes: Buffer;
    try {
        bytes = readFileSync(path.join(dir, file));
    } catch {
        throw new ReplayDataError('file not found', file);
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    const expected = manifest.files[file].sha256;
    if (sha !== expected) {
        throw new ReplayDataError(`SHA-256 ${sha} does not match the manifest (${expected}); refusing modified data`, file);
    }
    return bytes.toString('utf8');
}

type SymbolMap = {
    map?: Record<string, string>;
    replayClass?: Record<string, string>;
    extras?: Array<{ symbol: string; name?: string }>;
};

function readSymbolMap(root: string): SymbolMap {
    const p = path.join(root, SYMBOL_MAP_FILE);
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, 'utf8')) as SymbolMap;
}

// ------------------------------------------------------------------ notes and limitations

const note = (group: 'notes' | 'limitations', id: string, detail: string): DataNote => ({
    id,
    textRef: { key: `Replay.${group}.${id}` },
    detail,
});

const NOTES: DataNote[] = [
    note('notes', 'total_return_adj_close', 'Returns use adj_close (Yahoo method: split- and dividend-adjusted, back-adjusted from the extraction date), so dividends are reinvested in the return.'),
    note('notes', 'splits_not_reapplied', 'close is split-adjusted and adj_close is split- and dividend-adjusted; actions.csv rows are reference only and never re-applied.'),
    note('notes', 'common_calendar', 'The replay calendar is every day on which TSX or U.S. assets trade in the snapshot; an asset whose market is closed that day keeps its last close.'),
    note('notes', 'crypto_previous_utc_day', 'Crypto rows are UTC calendar days ending at 24:00 UTC, after the North American close; on a calendar date the replay uses the crypto close of the previous UTC day.'),
    note('notes', 'fx_last_known_rate', 'USD amounts are converted to CAD with the Yahoo USD/CAD close (USDCAD=X) of the day, or the last one known before it.'),
    note('notes', 'quality_checks_recorded', 'Quality checks (missing days, moves over 25%, zero-volume days, incomplete history, unknown currency) are recorded in manifest.json; symbols failing a hard check are excluded with their reason, nothing is corrected.'),
];

const LIMITATIONS: Array<DataNote & { fr: string }> = [
    {
        ...note('limitations', 'unofficial_source', 'Unofficial source: Yahoo Finance data read with the yfinance library, not certified by the exchanges.'),
        fr: 'Source non officielle : données Yahoo Finance lues avec la bibliothèque yfinance, non certifiées par les bourses.',
    },
    {
        ...note('limitations', 'demo_use_only', 'Demonstration use only, not commercial: yfinance reads Yahoo data meant for personal and research use.'),
        fr: 'Usage de démonstration seulement, non commercial : yfinance lit des données Yahoo destinées à un usage personnel et de recherche.',
    },
    {
        ...note('limitations', 'survivorship_bias', "Survivorship bias: the universe is today's list of large companies, replayed into the past; it looks better than a list picked in 2020 would have."),
        fr: "Biais du survivant : l'univers est la liste actuelle de grandes entreprises, rejouée dans le passé ; il paraît meilleur qu'une liste choisie en 2020.",
    },
    {
        ...note('limitations', 'no_fees_no_taxes', 'No fees and no taxes by default.'),
        fr: 'Pas de frais ni d’impôts par défaut.',
    },
    {
        ...note('limitations', 'fx_effect_included', 'Currency effect included: U.S. assets and crypto are converted to CAD at the day’s USD/CAD rate.'),
        fr: 'Effet de change inclus : les actifs américains et la crypto sont convertis en CAD au taux USD/CAD du jour.',
    },
    {
        ...note('limitations', 'start_near_market_top', 'The window starts in December 2020, close to the 2021 market top that preceded the 2022 decline.'),
        fr: 'La fenêtre commence en décembre 2020, près du sommet de 2021 qui a précédé la baisse de 2022.',
    },
    {
        ...note('limitations', 'frozen_snapshot', 'Frozen snapshot: a new extraction would change past adjusted values, so results are only comparable on the same snapshot id.'),
        fr: 'Instantané figé : une nouvelle extraction changerait les valeurs ajustées passées ; les résultats ne se comparent que sur le même identifiant d’instantané.',
    },
];

// ------------------------------------------------------------------ loading

type Loaded = {
    dir: string;
    manifest: SnapshotManifest;
    assets: ReplayAsset[];
    assetByTicker: Map<string, ReplayAsset>;
    yahooOf: Map<string, string>;          // app symbol or Yahoo symbol -> Yahoo symbol
    pricesByYahoo: Map<string, DailyPrice[]>;
    actions: CorporateAction[];            // ticker = Yahoo symbol
    fx: FxPoint[];
    sources: SourceMetadata[];
    provenance: { assets: Provenance; prices: Provenance; actions: Provenance; fx: Provenance };
    symbols: ReplaySymbol[];
    excludedReason: Map<string, string>;
};

function deepFreeze<T>(rows: T[]): T[] {
    for (const r of rows) Object.freeze(r);
    return Object.freeze(rows) as T[];
}

function checkCount(file: string, rows: number, manifest: SnapshotManifest) {
    if (rows !== manifest.files[file].rows) {
        throw new ReplayDataError(`${rows} rows, manifest says ${manifest.files[file].rows}`, file);
    }
}

function classify(app: string, yahoo: string, group: string, smap: SymbolMap): AssetClass {
    if (group === 'crypto') return 'crypto';
    const forced = smap.replayClass?.[app] ?? smap.replayClass?.[yahoo];
    if (forced === 'equity' || forced === 'etf_equity' || forced === 'etf_bond' || forced === 'etf_commodity' || forced === 'crypto') return forced;
    const entry = getEntry(app);
    if (entry?.assetClass === 'etf') return 'etf_equity';
    if (entry?.assetClass === 'crypto') return 'crypto';
    return 'equity';
}

const CLASS_LABEL: Record<AssetClass, string> = {
    equity: 'Equity',
    etf_equity: 'Equity ETF',
    etf_bond: 'Bond ETF',
    etf_commodity: 'Commodity ETF',
    crypto: 'Crypto',
};

function load(dir: string, root: string): Loaded {
    const manifest = readManifest(dir);
    const smap = readSymbolMap(root);
    const text = {
        prices: readVerified(dir, FILES.prices, manifest),
        actions: readVerified(dir, FILES.actions, manifest),
        fx: readVerified(dir, FILES.fx, manifest),
    };

    // provenance, built from the manifest (one entry per file)
    const base = {
        source: manifest.source,
        sourceUrl: manifest.sourceUrl ?? null,
        retrievedOn: manifest.extractionDate,
        coverage: `${manifest.window.from} to ${manifest.window.to}`,
        frequency: 'daily',
        limitations: manifest.limitations.join(' '),
        termsOfUse: 'Yahoo Finance data read with yfinance: personal and research use; shown here for demonstration only.',
    };
    const columns = (manifest.columns ?? {}) as Record<string, string>;
    const provenanceOf = (file: string, content: string): Provenance =>
        Object.freeze({
            ...base,
            file,
            content,
            processing: `${columns[file] ?? ''} Frozen snapshot ${manifest.snapshotId}, yfinance ${manifest.library?.version}, ${String(manifest.call ?? '')}`.trim(),
            datasetId: manifest.snapshotId,
        });
    const provenance = {
        assets: provenanceOf(MANIFEST_FILE, 'symbols of the snapshot (manifest.json) and data/replay/symbol-map.json'),
        prices: provenanceOf(FILES.prices, 'daily prices: open, high, low, close, adjusted close, volume'),
        actions: provenanceOf(FILES.actions, 'dividends and splits (reference only)'),
        fx: provenanceOf(FILES.fx, 'USD/CAD daily close (USDCAD=X)'),
    };
    const sources: SourceMetadata[] = [provenance.assets, provenance.prices, provenance.actions, provenance.fx].map(
        ({ datasetId: _id, ...rest }) => Object.freeze({ ...rest }),
    );

    // symbols and assets
    const bySymbolMeta = new Map(manifest.symbols.map((s) => [s.yahooSymbol, s]));
    const yahooOf = new Map<string, string>();
    const assets: ReplayAsset[] = [];
    const symbols: ReplaySymbol[] = [];
    const extraName = new Map((smap.extras ?? []).map((e) => [e.symbol, e.name]));
    for (const s of manifest.symbols) {
        if (!CURRENCIES.includes(s.currency as ListingCurrency)) {
            throw new ReplayDataError(`${s.yahooSymbol}: currency ${s.currency} is not CAD or USD`, MANIFEST_FILE);
        }
        const currency = s.currency as ListingCurrency;
        const market = s.group === 'TSX' ? 'TSX' : s.group === 'crypto' ? 'Crypto (24/7)' : (s.exchange ?? 'US');
        for (const app of s.appSymbols) {
            const assetClass = classify(app, s.yahooSymbol, s.group, smap);
            const entry = getEntry(app);
            const name = entry?.name ?? extraName.get(app) ?? app;
            const asset: ReplayAsset = {
                assetId: app,
                ticker: app,
                name,
                assetClass,
                market,
                currency,
                sector: entry?.sector ?? CLASS_LABEL[assetClass],
                ...(app !== s.yahooSymbol ? { yahooSymbol: s.yahooSymbol } : {}),
                firstDate: s.firstDate,
                lastDate: s.lastDate,
                warnings: [...s.warnings],
            };
            assets.push(asset);
            yahooOf.set(app, s.yahooSymbol);
            symbols.push(Object.freeze({
                symbol: app, yahooSymbol: s.yahooSymbol, name, assetClass, currency,
                firstDate: s.firstDate, lastDate: s.lastDate, warnings: [...s.warnings],
            }));
        }
        // the Yahoo symbol itself is accepted too ('BTC-USD' for 'BTC')
        if (!s.appSymbols.includes(s.yahooSymbol)) {
            const first = assets.find((a) => a.ticker === s.appSymbols[0])!;
            assets.push({ ...first, assetId: s.yahooSymbol, ticker: s.yahooSymbol, aliasOf: first.ticker, yahooSymbol: undefined });
            yahooOf.set(s.yahooSymbol, s.yahooSymbol);
        }
    }
    for (const a of assets) if (a.yahooSymbol === undefined) delete a.yahooSymbol;
    const assetByTicker = new Map(assets.map((a) => [a.ticker, a]));

    // prices.csv
    const fP = FILES.prices;
    const pricesByYahoo = new Map<string, DailyPrice[]>(manifest.symbols.map((s) => [s.yahooSymbol, []]));
    const seen = new Set<string>();
    let priceRows = 0;
    let minDate = '9999-12-31';
    let maxDate = '0000-01-01';
    for (const r of parseTable(text.prices, fP, COLUMNS.prices)) {
        const ticker = r.get('symbol');
        const meta = bySymbolMeta.get(ticker);
        if (!meta) fail(`symbol "${ticker}" is not listed in ${MANIFEST_FILE}`, fP, r);
        const p: DailyPrice = {
            date: parseIsoDate(r.get('date'), fP, r, 'date'),
            ticker,
            open: parseOptionalDecimal(r.get('open'), fP, r, 'open'),
            high: parseOptionalDecimal(r.get('high'), fP, r, 'high'),
            low: parseOptionalDecimal(r.get('low'), fP, r, 'low'),
            close: parseDecimal(r.get('close'), fP, r, 'close', { positive: true }),
            adjClose: parseDecimal(r.get('adj_close'), fP, r, 'adj_close', { positive: true }),
            volume: parseVolume(r.get('volume'), fP, r),
            currency: r.get('currency') as ListingCurrency,
        };
        if (p.currency !== meta.currency) fail(`currency ${p.currency} differs from the manifest (${meta.currency})`, fP, r);
        const key = `${ticker}|${p.date}`;
        if (seen.has(key)) fail(`duplicate row for ${ticker} on ${p.date}`, fP, r);
        seen.add(key);
        pricesByYahoo.get(ticker)!.push(p);
        priceRows++;
        if (p.date < minDate) minDate = p.date;
        if (p.date > maxDate) maxDate = p.date;
    }
    checkCount(fP, priceRows, manifest);
    for (const [ticker, rows] of pricesByYahoo) {
        if (rows.length === 0) throw new ReplayDataError(`no price for ${ticker}`, fP);
        rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const m = bySymbolMeta.get(ticker)!;
        if (rows.length !== m.rows || rows[0].date !== m.firstDate || rows[rows.length - 1].date !== m.lastDate) {
            throw new ReplayDataError(`${ticker}: rows or dates differ from the manifest`, fP);
        }
        deepFreeze(rows);
    }
    if (priceRows > 0 && (minDate !== manifest.window.from || maxDate !== manifest.window.to)) {
        throw new ReplayDataError(`price window ${minDate}..${maxDate} differs from the manifest (${manifest.window.from}..${manifest.window.to})`, fP);
    }

    // actions.csv (capital-gain distributions are counted in adj_close by Yahoo and kept out of this table)
    const fA = FILES.actions;
    const actions: CorporateAction[] = [];
    let actionRows = 0;
    for (const r of parseTable(text.actions, fA, COLUMNS.actions)) {
        actionRows++;
        const ticker = r.get('symbol');
        const meta = bySymbolMeta.get(ticker);
        if (!meta) fail(`symbol "${ticker}" is not listed in ${MANIFEST_FILE}`, fA, r);
        const type = r.get('type');
        if (type === 'capital_gain') continue;
        if (type !== 'dividend' && type !== 'split') fail(`type "${type}" not in dividend|split|capital_gain`, fA, r);
        actions.push({
            exDate: parseIsoDate(r.get('date'), fA, r, 'date'),
            ticker,
            action: type,
            value: parseDecimal(r.get('value'), fA, r, 'value', { positive: true }),
            unit: type === 'dividend' ? `${meta.currency} per share` : SPLIT_UNIT,
            appliesToPrices: false,
        });
    }
    checkCount(fA, actionRows, manifest);
    const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
    actions.sort((a, b) => cmp(a.exDate, b.exDate) || cmp(a.ticker, b.ticker) || cmp(a.action, b.action) || a.value - b.value);

    // fx.csv
    const fF = FILES.fx;
    const fxDates = new Set<string>();
    const fx = parseTable(text.fx, fF, COLUMNS.fx).map((r): FxPoint => {
        const usdcad = parseDecimal(r.get('usdcad'), fF, r, 'usdcad', { positive: true });
        const p: FxPoint = { date: parseIsoDate(r.get('date'), fF, r, 'date'), usdcad, cadusd: Math.round((1 / usdcad) * 1e6) / 1e6 };
        if (fxDates.has(p.date)) fail(`duplicate date ${p.date}`, fF, r);
        fxDates.add(p.date);
        return p;
    });
    checkCount(fF, fx.length, manifest);
    fx.sort((a, b) => (a.date < b.date ? -1 : 1));

    const excludedReason = new Map<string, string>();
    for (const e of manifest.excluded ?? []) {
        excludedReason.set(e.yahooSymbol, e.reason);
        for (const a of e.appSymbols) excludedReason.set(a, e.reason);
    }
    for (const e of manifest.notReplayable ?? []) excludedReason.set(e.symbol, e.reason);

    return {
        dir,
        manifest,
        assets: deepFreeze(assets),
        assetByTicker,
        yahooOf,
        pricesByYahoo,
        actions: deepFreeze(actions),
        fx: deepFreeze(fx),
        sources: deepFreeze(sources),
        provenance,
        symbols: deepFreeze(symbols.sort((a, b) => cmp(a.symbol, b.symbol))),
        excludedReason,
    };
}

// ------------------------------------------------------------------ snapshot selection

export function defaultReplayRoot(): string {
    return path.resolve(process.env.REPLAY_DATA_ROOT ?? path.join(process.cwd(), 'data', 'replay'));
}

/** Snapshot ids found under `root` (folders holding a manifest.json), newest first (extraction date, then id). */
export function listSnapshots(root = defaultReplayRoot()): Array<{ id: string; extractionDate: string }> {
    if (!existsSync(root)) return [];
    const out: Array<{ id: string; extractionDate: string }> = [];
    for (const name of readdirSync(root)) {
        if (name.startsWith('.')) continue;
        const dir = path.join(root, name);
        if (!statSync(dir).isDirectory() || !existsSync(path.join(dir, MANIFEST_FILE))) continue;
        let extractionDate = '';
        try {
            extractionDate = String(JSON.parse(readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')).extractionDate ?? '');
        } catch {
            /* an unreadable manifest is reported when that snapshot is loaded */
        }
        out.push({ id: name, extractionDate });
    }
    return out.sort((a, b) => (a.extractionDate !== b.extractionDate ? (a.extractionDate < b.extractionDate ? 1 : -1) : a.id < b.id ? 1 : -1));
}

/** The snapshot to use: explicit id, then REPLAY_SNAPSHOT_ID, then the newest folder. */
export function resolveSnapshotId(root = defaultReplayRoot(), id?: string): string {
    const wanted = id ?? process.env.REPLAY_SNAPSHOT_ID;
    if (wanted) {
        if (!/^[\w.-]+$/.test(wanted)) throw new ReplayDataError(`invalid snapshot id "${wanted}"`);
        if (!existsSync(path.join(root, wanted, MANIFEST_FILE))) throw new ReplayDataError(`snapshot "${wanted}" not found under ${root}`);
        return wanted;
    }
    const all = listSnapshots(root);
    if (all.length === 0) throw new ReplayDataError(`no replay snapshot under ${root}`);
    return all[0].id;
}

// ------------------------------------------------------------------ provider

function checkRange(range: DateRange | undefined): DateRange {
    const r = range ?? {};
    for (const k of ['from', 'to'] as const) {
        const v = r[k];
        if (v !== undefined && (!DATE_RE.test(v) || Number.isNaN(Date.parse(v)))) throw new ReplayDataError(`range.${k} "${v}" is not an ISO date`);
    }
    if (r.from && r.to && r.from > r.to) throw new ReplayDataError(`range.from ${r.from} is after range.to ${r.to}`);
    return r;
}

const inRange = (date: IsoDate, r: DateRange) => (r.from === undefined || date >= r.from) && (r.to === undefined || date <= r.to);

const cache = new Map<string, Loaded>();

export type SnapshotProviderOptions = {
    /** Folder holding the snapshot folders and symbol-map.json. Default: REPLAY_DATA_ROOT, then ./data/replay. */
    root?: string;
    /** Snapshot id. Default: REPLAY_SNAPSHOT_ID, then the newest folder. */
    snapshotId?: string;
    /** Share the per-process cache (default). False reads the files again, for tests. */
    memo?: boolean;
};

export class SnapshotProvider implements DataProvider {
    readonly root: string;
    readonly snapshotId: string;
    private readonly memo: boolean;
    private data?: Loaded;

    constructor(opts: SnapshotProviderOptions = {}) {
        this.root = path.resolve(opts.root ?? defaultReplayRoot());
        this.snapshotId = resolveSnapshotId(this.root, opts.snapshotId);
        this.memo = opts.memo ?? true;
    }

    /** Loads and verifies every file now; throws ReplayDataError on any mismatch. */
    load(): void {
        this.get();
    }

    private get(): Loaded {
        if (this.data) return this.data;
        const dir = path.join(this.root, this.snapshotId);
        if (this.memo) {
            let d = cache.get(dir);
            if (!d) {
                d = load(dir, this.root);
                cache.set(dir, d);
            }
            this.data = d;
        } else {
            this.data = load(dir, this.root);
        }
        return this.data;
    }

    private yahoo(ticker: string): string {
        const d = this.get();
        const y = d.yahooOf.get(ticker);
        if (!y) {
            const why = d.excludedReason.get(ticker);
            throw new ReplayDataError(why ? `"${ticker}" is not in snapshot ${this.snapshotId}: ${why}` : `unknown ticker "${ticker}" in snapshot ${this.snapshotId}`);
        }
        return y;
    }

    async getAssets(): Promise<ReplayTable<ReplayAsset>> {
        const d = this.get();
        return { id: 'assets', rows: [...d.assets], provenance: d.provenance.assets };
    }

    async getDailyPrices(tickers: string[], range?: DateRange): Promise<ReplayTable<DailyPrice>[]> {
        const d = this.get();
        const r = checkRange(range);
        return tickers.map((ticker) => {
            const y = this.yahoo(ticker);
            const rows = d.pricesByYahoo.get(y)!.filter((p) => inRange(p.date, r));
            return {
                id: ticker,
                rows: y === ticker ? rows : rows.map((p) => Object.freeze({ ...p, ticker })),
                provenance: d.provenance.prices,
                currency: d.assetByTicker.get(ticker)!.currency,
            };
        });
    }

    async getFx(range?: DateRange): Promise<ReplayTable<FxPoint>> {
        const d = this.get();
        const r = checkRange(range);
        return { id: 'fx:USDCAD', rows: d.fx.filter((p) => inRange(p.date, r)), provenance: d.provenance.fx, unit: 'CAD per USD' };
    }

    async getCorporateActions(tickers?: string[]): Promise<ReplayTable<CorporateAction>> {
        const d = this.get();
        if (!tickers) return { id: 'corporate_actions', rows: [...d.actions], provenance: d.provenance.actions };
        const rows: CorporateAction[] = [];
        for (const t of tickers) {
            const y = this.yahoo(t);
            for (const a of d.actions) if (a.ticker === y) rows.push(y === t ? a : { ...a, ticker: t });
        }
        const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
        rows.sort((a, b) => cmp(a.exDate, b.exDate) || cmp(a.ticker, b.ticker) || cmp(a.action, b.action));
        return { id: 'corporate_actions', rows, provenance: d.provenance.actions };
    }

    getActions(tickers?: string[]): Promise<ReplayTable<CorporateAction>> {
        return this.getCorporateActions(tickers);
    }

    /** The snapshot holds no macro series: an empty list, and an unknown id throws. */
    async getMacro(seriesIds?: string[]): Promise<ReplayTable<MacroPoint>[]> {
        this.get();
        for (const id of seriesIds ?? []) throw new ReplayDataError(`unknown macro series "${id}": the yfinance snapshot holds no macro data`);
        return [];
    }

    async getSourcesMetadata(): Promise<SourceMetadata[]> {
        return [...this.get().sources];
    }

    async getCalendar(mode: 'union' | 'intersection' = 'union'): Promise<IsoDate[]> {
        const d = this.get();
        const primary = d.assets.filter((a) => !a.aliasOf);
        const seen = new Set<string>();
        const assets: ReplayAsset[] = [];
        const prices: Array<{ id: string; rows: DailyPrice[] }> = [];
        for (const a of primary) {
            const y = d.yahooOf.get(a.ticker)!;
            if (seen.has(y)) continue;
            seen.add(y);
            assets.push({ ...a, ticker: y });
            prices.push({ id: y, rows: d.pricesByYahoo.get(y)! });
        }
        return buildCommonCalendar({ assets, prices }, mode);
    }

    async listSymbols(): Promise<ReplaySymbol[]> {
        return [...this.get().symbols];
    }

    async describe(): Promise<DatasetDescription> {
        const d = this.get();
        const m = d.manifest;
        const files: DatasetFile[] = Object.values(FILES).map((name) => ({ name, sha256: m.files[name].sha256, rows: m.files[name].rows }));
        return {
            datasetId: m.snapshotId,
            snapshotId: m.snapshotId,
            provider: 'snapshot',
            frozen: true,
            extractedOn: m.extractionDate,
            window: { from: m.window.from, to: m.window.to },
            files,
            notes: NOTES.map((n) => ({ ...n, textRef: { ...n.textRef } })),
            limitations: LIMITATIONS.map(({ fr: _fr, ...n }) => ({ ...n, textRef: { ...n.textRef } })),
            limitationsText: { fr: LIMITATIONS.map((n) => n.fr), en: LIMITATIONS.map((n) => n.detail) },
            excluded: (m.excluded ?? []).map((e) => ({ yahooSymbol: e.yahooSymbol, appSymbols: [...e.appSymbols], reason: e.reason })),
            notReplayable: (m.notReplayable ?? []).map((e) => ({ ...e })),
            manifest: structuredClone(m),
        };
    }
}

// ------------------------------------------------------------------ app entry points

let shared: SnapshotProvider | undefined;

/** The provider the app uses: the frozen snapshot, one instance per process. */
export function getSnapshotProvider(): SnapshotProvider {
    shared ??= new SnapshotProvider();
    return shared;
}

/** Test hook: forget the shared instance and the file cache. */
export function resetReplayProviderCache(): void {
    shared = undefined;
    cache.clear();
}
