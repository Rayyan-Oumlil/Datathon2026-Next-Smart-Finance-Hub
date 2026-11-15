'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Coins, Gem, Landmark, Layers, type LucideIcon } from 'lucide-react';
import type { AssetClass } from '@/lib/domain/types';
import { BUILT_IN_MARKS, CLASSES_WITHOUT_REMOTE_LOGO, monogram } from '@/lib/logo/symbol';
import { cn } from '@/lib/utils';

export type AssetLogoProps = {
    symbol: string;
    name?: string;
    assetClass?: AssetClass;
    size?: number;              // px, square; default 34
    className?: string;
    /** true (default) when the name or ticker is printed next to the logo: the image is then hidden from screen readers */
    decorative?: boolean;
};

const CLASS_ICONS: Partial<Record<AssetClass, LucideIcon>> = { etf: Layers, crypto: Coins, gold: Gem, bond_yield: Landmark };

/**
 * Company or fund logo in a fixed round well, served by /api/logo (never a remote URL). While the image loads, and
 * when there is none, the well shows a monogram or the asset class icon, so nothing moves when the image arrives.
 */
export function AssetLogo({ symbol, name, assetClass, size = 34, className, decorative = true }: AssetLogoProps) {
    const upper = symbol.trim().toUpperCase();
    const mark = BUILT_IN_MARKS[upper];
    const tryRemote = !mark && !(assetClass && CLASSES_WITHOUT_REMOTE_LOGO.has(assetClass));
    const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
    const imgRef = useRef<HTMLImageElement>(null);

    // A new symbol starts over; an image already in the browser cache may have finished before hydration
    useEffect(() => {
        const img = imgRef.current;
        if (img?.complete) setState(img.naturalWidth > 0 ? 'loaded' : 'failed');
        else setState('loading');
    }, [upper]);

    const label = name ? `${name} (${upper})` : upper;
    // The well carries the name when it is not decorative, so the image itself stays silent (alt="")
    const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': label };
    const box: CSSProperties = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)), position: 'relative' };
    const showImage = tryRemote && state === 'loaded';
    const Icon = assetClass ? CLASS_ICONS[assetClass] : undefined;

    let fallback: ReactNode;
    if (mark) {
        fallback = (
            <svg viewBox="0 0 32 32" className="size-full" aria-hidden>
                <circle cx="16" cy="16" r="16" style={{ fill: mark.tone === 'warn' ? 'var(--warn)' : 'var(--muted)' }} />
                <text x="16" y="21.5" textAnchor="middle" fontSize="16" fontWeight="700" style={{ fill: 'var(--on-brand)' }}>{mark.letter}</text>
            </svg>
        );
    } else if (Icon) {
        fallback = <Icon aria-hidden style={{ width: '55%', height: '55%' }} strokeWidth={1.75} />;
    } else {
        fallback = <span aria-hidden className="leading-none">{monogram(upper, size < 24 ? 1 : 2)}</span>;
    }

    return (
        <span
            className={cn('logo-well', !showImage && !mark && 'is-empty', mark && 'bg-transparent', className)}
            style={box}
            title={decorative ? undefined : label}
            {...a11y}
        >
            {!showImage && fallback}
            {tryRemote && state !== 'failed' && (
                // eslint-disable-next-line @next/next/no-img-element -- same-origin route, already sized and cached; next/image adds nothing here
                <img
                    ref={imgRef}
                    key={upper}
                    src={`/api/logo/${encodeURIComponent(upper)}`}
                    alt=""
                    width={size}
                    height={size}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onLoad={() => setState('loaded')}
                    onError={() => setState('failed')}
                    className="absolute inset-0 size-full object-contain"
                    style={{ padding: Math.round(size * 0.14), opacity: showImage ? 1 : 0, transition: 'opacity 160ms var(--ui-ease)' }}
                />
            )}
        </span>
    );
}

export default AssetLogo;
