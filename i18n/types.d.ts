import type { Locale } from '@/i18n/config';
import type Common from '@/messages/en/Common.json';
import type Dashboard from '@/messages/en/Dashboard.json';
import type DataFreshness from '@/messages/en/DataFreshness.json';
import type Language from '@/messages/en/Language.json';
import type MarketSwitcher from '@/messages/en/MarketSwitcher.json';
import type Markets from '@/messages/en/Markets.json';
import type Metadata from '@/messages/en/Metadata.json';
import type NewsSources from '@/messages/en/NewsSources.json';
import type Options from '@/messages/en/Options.json';
import type PulseTile from '@/messages/en/PulseTile.json';
import type SearchCommand from '@/messages/en/SearchCommand.json';
import type Sidebar from '@/messages/en/Sidebar.json';
import type StockChart from '@/messages/en/StockChart.json';
import type StockHeader from '@/messages/en/StockHeader.json';
import type StockPage from '@/messages/en/StockPage.json';
import type StockSentiment from '@/messages/en/StockSentiment.json';
import type TabBar from '@/messages/en/TabBar.json';
import type TradingViewWidget from '@/messages/en/TradingViewWidget.json';
import type WatchlistTable from '@/messages/en/WatchlistTable.json';
import type YahooQuotes from '@/messages/en/YahooQuotes.json';

// Namespaces typed from their English file: keys are checked by useTranslations/getTranslations.
type TypedMessages = {
    Common: typeof Common;
    Dashboard: typeof Dashboard;
    DataFreshness: typeof DataFreshness;
    Language: typeof Language;
    MarketSwitcher: typeof MarketSwitcher;
    Markets: typeof Markets;
    Metadata: typeof Metadata;
    NewsSources: typeof NewsSources;
    Options: typeof Options;
    PulseTile: typeof PulseTile;
    SearchCommand: typeof SearchCommand;
    Sidebar: typeof Sidebar;
    StockChart: typeof StockChart;
    StockHeader: typeof StockHeader;
    StockPage: typeof StockPage;
    StockSentiment: typeof StockSentiment;
    TabBar: typeof TabBar;
    TradingViewWidget: typeof TradingViewWidget;
    WatchlistTable: typeof WatchlistTable;
    YahooQuotes: typeof YahooQuotes;
};

// A namespace file not listed above still loads (i18n/messages.ts reads the whole folder) and is typed
// loosely: any namespace name and key compiles. Add a line above to have its keys checked.
type LooseMessages = { [namespace: string]: { [key: string]: any } };

declare module 'next-intl' {
    interface AppConfig {
        Locale: Locale;
        Messages: TypedMessages & LooseMessages;
    }
}
