import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { readAgentRequest } from '@/lib/agent/request';

vi.mock('@/i18n/locale', () => ({ getAppLocale: vi.fn(async () => 'en'), resolveLocale: vi.fn(async () => 'en') }));
vi.mock('@/lib/rate-limit', () => ({ isRateLimited: vi.fn(async () => false) }));

const read = (body: unknown) => readAgentRequest(new NextRequest('http://localhost/api/agent', { method: 'POST', body: JSON.stringify(body) }));

describe('readAgentRequest page field', () => {
    it('keeps a well-formed page', async () => {
        const input = await read({ message: 'What is an ETF?', page: { path: '/xray', xrayWindow: '1y' } });
        expect(input.page).toEqual({ path: '/xray', xrayWindow: '1y' });
    });

    it.each([
        ['a path over 120 characters', { path: `/stocks/${'A'.repeat(200)}` }],
        ['a path that is not a string', { path: 42 }],
        ['a page that is not an object', 'home'],
        ['an over-long xrayWindow', { path: '/xray', xrayWindow: 'x'.repeat(30) }],
    ])('drops %s instead of failing the request', async (_name, page) => {
        const input = await read({ message: 'What is an ETF?', page });
        expect(input.message).toBe('What is an ETF?');
        expect(input.page).toBeUndefined();
    });

    it('still refuses an empty message', async () => {
        await expect(read({ message: '  ', page: { path: '/' } })).rejects.toThrow();
    });
});
