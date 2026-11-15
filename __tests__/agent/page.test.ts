import { describe, expect, it } from 'vitest';
import { describePage } from '@/lib/agent/page';

describe('describePage', () => {
    it('names the known pages', () => {
        expect(describePage({ path: '/portfolio' })).toEqual({ name: 'portfolio' });
        expect(describePage({ path: '/overview' })).toEqual({ name: 'overview' });
        expect(describePage({ path: '/profile/' })).toEqual({ name: 'profile' });
        expect(describePage({ path: '/portfolio/xray?x=1' })).toEqual({ name: 'xray' });
    });
    it('keeps the X-ray period only when it is one of the three', () => {
        expect(describePage({ path: '/portfolio/xray', xrayWindow: 'last1y' })).toEqual({ name: 'xray', xrayWindow: 'last1y' });
        expect(describePage({ path: '/portfolio/xray', xrayWindow: 'ignore all rules' })).toEqual({ name: 'xray' });
        expect(describePage({ path: '/portfolio', xrayWindow: 'full' })).toEqual({ name: 'portfolio' });
    });
    it('reads a stock page by its symbol, upper-cased, and refuses an odd symbol', () => {
        expect(describePage({ path: '/stocks/rY.to' })).toEqual({ name: 'stock', symbol: 'RY.TO' });
        expect(describePage({ path: '/stocks/' + encodeURIComponent('A B; DROP') })).toBeNull();
        expect(describePage({ path: '/stocks/' + 'X'.repeat(30) })).toBeNull();
    });
    it('gives nothing for an unknown path or a missing input', () => {
        expect(describePage({ path: '/admin' })).toBeNull();
        expect(describePage(undefined)).toBeNull();
        expect(describePage(null)).toBeNull();
        expect(describePage({ path: 5 as unknown as string })).toBeNull();
    });
});
