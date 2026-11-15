import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/** A percentage that grows from zero the first time it is drawn (0 -> value), so a bar shows how it fills. */
export function useGrown(value: number): number {
    const [grown, setGrown] = useState(false);
    useEffect(() => {
        const frame = requestAnimationFrame(() => setGrown(true));
        return () => cancelAnimationFrame(frame);
    }, []);
    return grown ? value : 0;
}

/** A filled bar: its width animates when it first appears and whenever the value changes. */
export function GrowBar({ value, className }: { value: number; className: string }) {
    const width = useGrown(Math.min(100, Math.max(0, value)));
    return <div className={`xray-grow h-full rounded-full transition-[width] duration-700 ease-out ${className}`} style={{ width: `${width}%` }} />;
}

/** One rising section of the page: `index` sets how long it waits behind the ones above it. */
export function Rise({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
    return <div className={`xray-rise ${className ?? ''}`} style={{ ['--i' as string]: index }}>{children}</div>;
}

/** The small label that tells a reader what kind of statement a figure is: a fact, a scenario or an assumption. */
export function Tag({ kind }: { kind: 'fact' | 'scenario' | 'assumption' | 'reading' }) {
    const t = useTranslations('Xray');
    return <span className="pill !h-[18px] !px-1.5 !text-[10.5px]">{t(`labels.${kind}`)}</span>;
}

/** One block of the module: a title, what it shows, and its content. The border above it separates it from the last. */
export function Section({ title, sub, tag, children }: { title: string; sub?: string; tag?: 'fact' | 'scenario' | 'assumption' | 'reading'; children: ReactNode }) {
    return (
        <section className="border-t border-line pt-5 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-bold tracking-[-0.01em] text-foreground">{title}</h3>
                {tag && <Tag kind={tag} />}
            </div>
            {sub && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{sub}</p>}
            <div className="mt-3">{children}</div>
        </section>
    );
}
