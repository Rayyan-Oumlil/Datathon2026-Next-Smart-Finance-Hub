import { describe, expect, it } from 'vitest';
import { annualizedVolatility } from '@/lib/sources/volatility';

describe('annualizedVolatility', () => {
    it('matches a case worked out by hand', () => {
        // 21 closes alternating +10% and -10%: returns are ten times +0.1 and ten times -0.1.
        // mean = 0; sum of squares = 20 x 0.01 = 0.2; sample variance = 0.2 / 19; daily sd = sqrt(0.2 / 19) = 0.1025978...
        // annualized = sqrt(0.2 / 19 x 252) = sqrt(2.6526316) = 1.62869...
        const closes = [100];
        for (let i = 0; i < 20; i++) closes.push(closes[i] * (i % 2 === 0 ? 1.1 : 0.9));
        expect(annualizedVolatility(closes)).toBeCloseTo(Math.sqrt((0.2 / 19) * 252), 12);
        expect(annualizedVolatility(closes)).toBeCloseTo(1.62869, 5);
    });

    it('uses the sample (n - 1) standard deviation with a non-zero mean', () => {
        // 20 returns: +2% then 0%, ten times. mean = 0.01; each deviation is 0.01; variance = 20 x 0.0001 / 19
        const closes = [50];
        for (let i = 0; i < 20; i++) closes.push(closes[i] * (i % 2 === 0 ? 1.02 : 1));
        expect(annualizedVolatility(closes)).toBeCloseTo(Math.sqrt((0.002 / 19) * 252), 12);
    });

    it('is zero for a constant price', () => {
        expect(annualizedVolatility(new Array(30).fill(12.5))).toBe(0);
    });

    it('returns null with fewer than 20 daily returns', () => {
        const closes = Array.from({ length: 20 }, (_, i) => 100 + i);   // 19 returns
        expect(annualizedVolatility(closes)).toBeNull();
        expect(annualizedVolatility([...closes, 120])).not.toBeNull();  // 20 returns
        expect(annualizedVolatility([])).toBeNull();
    });

    it('returns null rather than a number when a close is unusable', () => {
        const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
        closes[10] = 0;   // the next return would divide by zero
        expect(annualizedVolatility(closes)).toBeNull();
    });
});
