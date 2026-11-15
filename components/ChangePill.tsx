'use client';

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useLocale } from "next-intl";
import { formatPercent } from "@/i18n/format";

// Direction is carried by colour and arrow, so it never relies on colour alone.
const TWO = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

const ChangePill = ({ value }: { value?: number | null }) => {
    const locale = useLocale();
    if (value == null || !Number.isFinite(value)) return <span className="pill">—</span>;
    if (value === 0) return <span className="pill">{formatPercent(0, locale, TWO)}</span>;
    const up = value > 0;
    return (
        <span className={up ? 'pill is-up' : 'pill is-down'}>
            {up ? <ArrowUpRight /> : <ArrowDownRight />}
            {formatPercent(Math.abs(value), locale, TWO)}
        </span>
    );
};

export default ChangePill;
