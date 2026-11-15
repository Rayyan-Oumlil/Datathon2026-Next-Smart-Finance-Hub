'use client';

import { cn } from '@/lib/utils';

/**
 * A quiet backdrop for a hero: a fading grid and two soft red glows drifting slowly (CSS only, .motion-aurora in
 * globals.css). Decorative, behind the content, never catches the pointer; still for reduced motion.
 */
export default function AuroraBackdrop({ className }: { className?: string }) {
    return (
        <div aria-hidden className={cn('motion-aurora', className)}>
            <span className="motion-aurora-grid" />
            <span className="motion-aurora-glow is-a" />
            <span className="motion-aurora-glow is-b" />
        </div>
    );
}
