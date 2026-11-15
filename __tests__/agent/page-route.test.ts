import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST as AGENT } from '@/app/api/agent/route';
import { callAgent } from '@/lib/agent/client';
import { freshWorld } from '../services/helpers';

vi.mock('@/lib/services/quotes', async (original) => (await import('../services/market-stub')).quotesMock(await original()));
vi.mock('@/lib/services/watchlist', () => ({ getWatchlist: async () => ({ result: { snapshotId: 's', picks: [] } }), resetWatchlistMemory: () => undefined }));
vi.mock('@/lib/agent/client', async (original) => ({ ...(await original<typeof import('@/lib/agent/client')>()), callAgent: vi.fn() }));
vi.mock('@/i18n/locale', () => ({ getAppLocale: vi.fn(async () => 'en'), resolveLocale: vi.fn(async () => 'en') }));

beforeEach(() => freshWorld());

it('the route passes the page in the request body to the agent as a name from the fixed list', async () => {
    const agent = vi.mocked(callAgent);
    agent.mockResolvedValue({ text: 'ok', sources: [], refused: false, modelCalls: [] });
    const response = await AGENT(new NextRequest('http://localhost/api/agent', { method: 'POST', body: JSON.stringify({ message: 'hi', page: { path: '/portfolio/xray', xrayWindow: 'full' } }) }));
    expect(response.status).toBe(200);
    expect(agent.mock.calls[0][0].context.page).toEqual({ name: 'xray', xrayWindow: 'full' });
});
