import { Fragment } from "react";

// An amount in the active language's own pattern ("$1,500.00" / "1 500,00 $"), with the currency part in
// <small> so tiles keep their small unit. Works on the server and in the browser.
const MoneyParts = ({ amount, currency, locale, options }: { amount: number; currency: string; locale: string; options?: Intl.NumberFormatOptions }) => {
    const parts = new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency, ...options }).formatToParts(amount);
    return (
        <>
            {parts.map((part, index) => (
                <Fragment key={index}>{part.type === 'currency' ? <small>{part.value}</small> : part.value}</Fragment>
            ))}
        </>
    );
};

export default MoneyParts;
