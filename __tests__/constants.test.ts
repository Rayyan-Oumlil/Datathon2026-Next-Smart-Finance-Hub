import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tvLocale, marketOverviewConfig } from '@/lib/constants';

describe('TradingView locale', () => {
    it('passes our locale codes through unchanged', () => {
        expect(tvLocale('en')).toBe('en');
        expect(tvLocale('fr')).toBe('fr');
        expect(marketOverviewConfig([], 'fr').locale).toBe('fr');
        expect(marketOverviewConfig([]).locale).toBe('en');
    });
});

describe('dialog close button', () => {
    it('reads its screen-reader label from the Common namespace, not a hardcoded string', () => {
        const src = readFileSync(path.join(__dirname, '..', 'components', 'ui', 'dialog.tsx'), 'utf8');
        expect(src).not.toMatch(/sr-only">Close</);
        expect(src).toMatch(/useTranslations\("Common"\)/);
        expect(src).toMatch(/t\("close"\)/);
        for (const locale of ['en', 'fr']) {
            const common = JSON.parse(readFileSync(path.join(__dirname, '..', 'messages', locale, 'Common.json'), 'utf8'));
            expect(typeof common.close).toBe('string');
        }
    });
});
