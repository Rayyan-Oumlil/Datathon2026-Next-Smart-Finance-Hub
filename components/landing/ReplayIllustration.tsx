// A decorative chart for the landing hero: two made-up curves, "with rules" and "without rules", labelled as an
// illustration so nobody reads them as results. The paths use pathLength="1" so MotionStage can trace them.

const WITHOUT = 'M8 104 C 40 92, 60 70, 88 76 S 128 122, 156 112 S 196 58, 224 66 S 262 96, 284 72 S 304 44, 312 40';
const WITH = 'M8 104 C 40 96, 62 82, 88 84 S 128 100, 156 94 S 196 70, 224 70 S 262 74, 284 58 S 304 38, 312 32';

type Props = { title: string; withLabel: string; withoutLabel: string; note: string };

export default function ReplayIllustration({ title, withLabel, withoutLabel, note }: Props) {
    return (
        <figure className="hatch w-full">
            <div className="card flex flex-col gap-3 p-4">
                <figcaption className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13.5px] font-bold text-foreground">{title}</span>
                    <span className="pill">{note}</span>
                </figcaption>
                <svg viewBox="0 0 320 140" className="landing-chart" aria-hidden focusable="false">
                    {[28, 62, 96, 130].map((y) => (
                        <line key={y} x1="0" x2="320" y1={y} y2={y} className="landing-chart-grid" />
                    ))}
                    <path d={WITHOUT} pathLength={1} data-draw className="landing-chart-line is-without" />
                    <path d={WITH} pathLength={1} data-draw className="landing-chart-line is-with" />
                    <circle cx="312" cy="32" r="4" data-hero className="landing-chart-dot" />
                </svg>
                <div className="flex flex-wrap gap-4 text-[12px] font-semibold text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><span className="landing-swatch is-with" />{withLabel}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="landing-swatch is-without" />{withoutLabel}</span>
                </div>
            </div>
        </figure>
    );
}
