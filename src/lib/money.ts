/**
 * Persian money formatting helpers.
 * Never use "k" / "m" abbreviations — always spell out هزار / میلیون تومان.
 */

const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

/** ۴۵٬۰۰۰ تومان */
export function formatToman(amount: number): string {
  return `${fa(amount)} تومان`;
}

/** ۴۵٬۰۰۰ (without unit) */
export function formatNumber(amount: number): string {
  return fa(amount);
}

/**
 * Short but fully spelled out Persian label:
 * 50000    → «۵۰ هزار تومان»
 * 1000000  → «۱ میلیون تومان»
 * 1500000  → «۱٫۵ میلیون تومان»
 * 45500    → «۴۵٬۵۰۰ تومان»
 */
export function formatTomanShort(amount: number): string {
  if (amount >= 1_000_000 && amount % 100_000 === 0) {
    const millions = amount / 1_000_000;
    const text = Number.isInteger(millions)
      ? fa(millions)
      : fa(Math.floor(millions)) + "٫" + fa(Math.round((millions % 1) * 10));
    return `${text} میلیون تومان`;
  }
  if (amount >= 1000 && amount % 1000 === 0) {
    return `${fa(amount / 1000)} هزار تومان`;
  }
  return formatToman(amount);
}
