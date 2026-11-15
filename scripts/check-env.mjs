#!/usr/bin/env node
// Checks .env against what the app reads. Run: node scripts/check-env.mjs
import 'dotenv/config';

const finnhubKeyNames = ['FINNHUB_API_KEYS', 'FINNHUB_API_KEY'];
const optional = {
    ADANOS_API_KEY: 'Adanos sentiment card on stock pages (display only)',
    ADANOS_API_BASE_URL: 'Adanos base URL override (default https://api.adanos.org)',
    APP_URL: 'Public URL of the app, used in the sitemap and robots.txt',
    NEXT_PUBLIC_OPENSTOCK_DATA_MODE: '"cached" (default) or "realtime"; fixed at build time',
};

let failed = false;
const finnhub = finnhubKeyNames.find((name) => process.env[name]?.trim());
if (finnhub) console.log(`ok       ${finnhub} is set`);
else {
    failed = true;
    console.log(`MISSING  FINNHUB_API_KEY: free key from finnhub.io (quotes, company data, search)`);
}
for (const [name, what] of Object.entries(optional)) {
    console.log(`${process.env[name]?.trim() ? 'ok      ' : 'not set '} ${name}: ${what}`);
}
process.exit(failed ? 1 : 0);
