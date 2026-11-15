import { NextRequest } from 'next/server';
import { getReplayProvider } from '@/lib/replay';
import { respond } from '@/lib/services/http';

export const dynamic = 'force-dynamic';

// The frozen snapshot the time machine replays on, for the « Pourquoi ces données ? » panel: provenance read from
// manifest.json (never typed by hand), quality warnings counted, excluded symbols with their reason. No network.
export const GET = (req: NextRequest) => respond(async () => {
    const d = await getReplayProvider().describe();
    const m = d.manifest;
    const symbolWarnings = (m?.symbols ?? []).reduce((sum, s) => sum + (s.warnings?.length ?? 0), 0);
    const fxWarnings = m?.fx?.warnings?.length ?? 0;
    return {
        dataset: {
            snapshotId: d.snapshotId ?? d.datasetId,
            provider: d.provider,
            frozen: d.frozen ?? true,
            source: m?.source ?? null,
            sourceUrl: m?.sourceUrl ?? null,
            library: m?.library ? { name: m.library.name, version: m.library.version } : null,
            extractedAt: m?.extractedAt ?? null,
            extractedOn: d.extractedOn,
            window: d.window,
            symbolCount: m?.symbols?.length ?? 0,
            appSymbols: [...new Set((m?.symbols ?? []).flatMap((s) => s.appSymbols ?? []))].sort(),
            qualityWarnings: symbolWarnings + fxWarnings,
            symbolsWithWarnings: (m?.symbols ?? []).filter((s) => (s.warnings?.length ?? 0) > 0).length,
            excluded: d.excluded ?? [],
            notReplayable: d.notReplayable ?? [],
            files: d.files,
            notes: d.notes.map((n) => ({ id: n.id, key: n.textRef.key })),
            limitations: d.limitations.map((n) => ({ id: n.id, key: n.textRef.key })),
        },
    };
}, req);
