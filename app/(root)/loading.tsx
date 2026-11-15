import { useTranslations } from "next-intl";

// Shown inside the workspace while a page renders, so navigation feels instant. It has the pages' own frame: the page
// head, a row of bento tiles and one large card. Synchronous and with no data, so it is sent at once.
export default function Loading() {
    const t = useTranslations('Common');
    const bar = "block rounded-md bg-hover motion-safe:animate-pulse";
    return (
        <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            <span className="sr-only">{t('loading')}</span>
            <header className="page-head" aria-hidden="true">
                <div className="flex flex-col gap-2">
                    <span className={`${bar} h-7 w-48 rounded-lg`} />
                    <span className={`${bar} h-4 w-72 max-w-[70vw]`} />
                </div>
            </header>
            <section className="hatch" aria-hidden="true">
                <div className="bento">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="bento-tile h-[124px]">
                            <span className={`${bar} h-3 w-20`} />
                            <span className={`${bar} h-7 w-28 rounded-lg`} />
                            <span className={`${bar} mt-auto h-3 w-16`} />
                        </div>
                    ))}
                </div>
            </section>
            <section className="hatch" aria-hidden="true">
                <div className="card flex h-[420px] flex-col gap-3 p-4">
                    <span className={`${bar} h-4 w-40`} />
                    <span className={`${bar} flex-1 rounded-lg`} />
                </div>
            </section>
        </div>
    );
}
