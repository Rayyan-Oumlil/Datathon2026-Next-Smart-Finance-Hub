import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/** The small label that tells a reader what kind of statement a figure is: a fact, a scenario or an assumption. */
export function Tag({ kind }: { kind: 'fact' | 'scenario' | 'assumption' }) {
    const t = useTranslations('Xray');
    return <span className="pill !h-[18px] !px-1.5 !text-[10.5px]">{t(`labels.${kind}`)}</span>;
}

/** One block of the module: a title, what it shows, and its content. The border above it separates it from the last. */
export function Section({ title, sub, tag, children }: { title: string; sub?: string; tag?: 'fact' | 'scenario' | 'assumption'; children: ReactNode }) {
    return (
        <section className="border-t border-line pt-5">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-bold tracking-[-0.01em] text-foreground">{title}</h3>
                {tag && <Tag kind={tag} />}
            </div>
            {sub && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{sub}</p>}
            <div className="mt-3">{children}</div>
        </section>
    );
}
