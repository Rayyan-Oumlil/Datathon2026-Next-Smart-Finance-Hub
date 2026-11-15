// Role -> colour group of the allocation bar. Only design tokens (app/globals.css), never a hard-coded colour.
export type Group = 'bonds' | 'funds' | 'stocks' | 'gold' | 'crypto';

export const GROUP_OF_ROLE: Record<string, Group> = {
    bonds: 'bonds',
    short_bonds: 'bonds',
    canada_equity: 'funds',
    us_equity: 'funds',
    tech_equity: 'funds',
    esg_equity: 'funds',
    stock: 'stocks',
    dividend_stock: 'stocks',
    gold: 'gold',
    crypto: 'crypto',
};

export const GROUP_CLASS: Record<Group, string> = {
    bonds: 'bg-up',
    funds: 'bg-brand',
    stocks: 'bg-brand/45',
    gold: 'bg-warn',
    crypto: 'bg-muted-foreground',
};

export const GROUP_ORDER: Group[] = ['bonds', 'funds', 'stocks', 'gold', 'crypto'];

export const groupOf = (role: string): Group => GROUP_OF_ROLE[role] ?? 'funds';
