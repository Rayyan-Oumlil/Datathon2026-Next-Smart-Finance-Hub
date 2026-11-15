import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Xray from '@/components/portfolio/xray/Xray';

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('Xray');
    return { title: t('title') };
}

// The full portfolio X-ray, opened from the Portfolio tab. Data is read from the app's own API in the browser.
export default function XrayPage() {
    return <Xray />;
}
