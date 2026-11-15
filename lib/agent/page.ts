// Which page the user is looking at, as the agent is told. The browser sends a path and, on the X-ray page, the period
// on screen; the server turns that into a name from a fixed list (never the browser's own text) before it reaches
// the agent's context, so a made-up path cannot put words into a prompt.

export const XRAY_WINDOWS = ['full', 'last3y', 'last1y'] as const;
export type XrayWindowId = (typeof XRAY_WINDOWS)[number];

export type PageInput = { path: string; xrayWindow?: string };
export type AgentPage = {
    name: 'portfolio' | 'xray' | 'overview' | 'profile' | 'stock' | 'strategy' | 'time_machine';
    symbol?: string;                     // a stock page
    xrayWindow?: XrayWindowId;           // the X-ray page: the period shown
};

const NAMES: Record<string, AgentPage['name']> = { '/portfolio': 'portfolio', '/portfolio/xray': 'xray', '/overview': 'overview', '/profile': 'profile', '/strategy': 'strategy', '/time-machine': 'time_machine' };
const SYMBOL = /^[A-Za-z0-9.:-]{1,20}$/;

/** The page as the agent is told, or null for a path the app does not know. */
export function describePage(input: PageInput | null | undefined): AgentPage | null {
    if (!input || typeof input.path !== 'string') return null;
    const path = input.path.split('?')[0].replace(/\/+$/, '') || '/';
    const name = NAMES[path];
    if (name === 'xray') {
        const window = XRAY_WINDOWS.find((id) => id === input.xrayWindow);
        return { name, ...(window ? { xrayWindow: window } : {}) };
    }
    if (name) return { name };
    const stock = path.match(/^\/stocks\/([^/]+)$/);
    if (stock) {
        const symbol = decodeURIComponent(stock[1]);
        if (SYMBOL.test(symbol)) return { name: 'stock', symbol: symbol.toUpperCase() };
    }
    return null;
}
