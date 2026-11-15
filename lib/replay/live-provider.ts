/**
 * YahooLiveProvider: an optional provider that would read Yahoo directly to extend a symbol absent from the
 * snapshot. Its data is NOT frozen ("données non figées"): two runs may differ, so it is off in the demo. It exists
 * as a declared option only; every data call throws unless REPLAY_ALLOW_LIVE=1, and even then nothing is
 * implemented yet (the replay must stay reproducible on the frozen snapshot).
 */

import type { DataProvider } from './provider';
import type { CorporateAction, DailyPrice, DatasetDescription, FxPoint, MacroPoint, ReplayAsset, ReplayTable, SourceMetadata } from './types';
import { ReplayDataError } from './snapshot-provider';

export const LIVE_LABEL = { fr: 'données non figées', en: 'data not frozen' } as const;

export function liveAllowed(): boolean {
    return process.env.REPLAY_ALLOW_LIVE === '1';
}

export class YahooLiveProvider implements DataProvider {
    private refuse(): never {
        if (!liveAllowed()) throw new ReplayDataError('YahooLiveProvider is not enabled in the demo (set REPLAY_ALLOW_LIVE=1); the replay uses the frozen snapshot');
        throw new ReplayDataError('YahooLiveProvider is declared but not implemented: live data is not frozen and is not used by the replay');
    }

    async getAssets(): Promise<ReplayTable<ReplayAsset>> { return this.refuse(); }
    async getDailyPrices(_tickers: string[]): Promise<ReplayTable<DailyPrice>[]> { return this.refuse(); }
    async getFx(): Promise<ReplayTable<FxPoint>> { return this.refuse(); }
    async getCorporateActions(): Promise<ReplayTable<CorporateAction>> { return this.refuse(); }
    async getMacro(): Promise<ReplayTable<MacroPoint>[]> { return this.refuse(); }
    async getSourcesMetadata(): Promise<SourceMetadata[]> { return this.refuse(); }

    async describe(): Promise<DatasetDescription> {
        return {
            datasetId: 'yahoo-live',
            provider: 'yahoo-live',
            frozen: false,
            extractedOn: new Date().toISOString().slice(0, 10),
            window: { from: '', to: '' },
            files: [],
            notes: [],
            limitations: [{ id: 'not_frozen', textRef: { key: 'Replay.limitations.not_frozen' }, detail: 'Live Yahoo data, not frozen: results may change from one run to the next.' }],
            limitationsText: { fr: [`Données Yahoo en direct, ${LIVE_LABEL.fr} : les résultats peuvent changer d'une exécution à l'autre.`], en: ['Live Yahoo data, not frozen: results may change from one run to the next.'] },
        };
    }
}
