// Gold: the front COMEX futures contract on Yahoo (GC=F), in USD per troy ounce. It is a futures price,
// not spot, and the endpoint is unofficial; the label says both.

import * as yahoo from './yahoo';

export const GOLD = 'Yahoo chart (unofficial), COMEX gold futures';
const SYMBOL = 'GC=F';

export const quote = () => yahoo.quote(SYMBOL, GOLD);
export const dailyCloses = () => yahoo.dailyCloses(SYMBOL, '1y', GOLD);
