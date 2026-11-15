import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The vitest setup does not transform TSX, so the page source is checked as text.
const source = readFileSync(path.join(__dirname, '..', '..', 'app', '(root)', 'stocks', '[symbol]', 'page.tsx'), 'utf8');

describe('stock page', () => {
    it('never answers 404 from a quote lookup: a provider failure cannot hide a real ticker outside the universe', () => {
        expect(source).not.toMatch(/notFound/);
        expect(source).not.toMatch(/getLiveQuotes/);
    });

    it('keeps the reference page for gold, crypto and bond-yield entries of the universe', () => {
        expect(source).toMatch(/entry\.assetClass === 'crypto' \|\| entry\.assetClass === 'gold' \|\| entry\.assetClass === 'bond_yield'\)\) \{\s*return <ReferencePage entry=\{entry\} \/>;/);
    });
});
