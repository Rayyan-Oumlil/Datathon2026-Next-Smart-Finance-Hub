import { getRequestConfig } from 'next-intl/server';
import { isLocale } from '@/i18n/config';
import { resolveLocale } from '@/i18n/locale';
import { loadMessages } from '@/i18n/messages';

export default getRequestConfig(async ({ requestLocale }) => {
    // getTranslations({ locale }) passes one in; otherwise read the cookie and the browser's languages
    const requested = await requestLocale;
    const locale = isLocale(requested) ? requested : await resolveLocale();
    return {
        locale,
        messages: await loadMessages(locale),
        // Dates and times read the same on the server and in the browser
        timeZone: 'America/Toronto',
    };
});
