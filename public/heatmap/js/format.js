// Labels and number formats shared by the heatmap and the parallel coordinates

export const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Number with more decimals for the small values
export const fmt = (v, dec) => v.toLocaleString("en-US", { maximumFractionDigits: dec === undefined ? (v < 1 ? 2 : v < 100 ? 1 : 0) : dec });

// Percentage already computed (0–100), with decimals for the very small values
export const fmtPct = p => p === 0 ? "0%" : p < 0.01 ? "< 0.01%" : `${fmt(p, p < 1 ? 2 : 0)}%`;

// Share a / t as a percentage, without misleading rounding: 99.9% → "> 99%" (not 100%), 0.4% → "< 1%" (not 0%)
export const pctOf = (a, t) => {
    const p = t > 0 ? a / t * 100 : 0;
    return p === 0 ? "0%" : p >= 100 ? "100%" : p < 1 ? "< 1%" : p > 99 ? "> 99%" : `${Math.round(p)}%`;
};

export const fmtUsd = v => d3.format("$.3~s")(v).replace("G", "B");

export const plural = (n, word, pluralWord = word + "s") => `${fmt(n)} ${n > 1 ? pluralWord : word}`;

export const truncate = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;

// Plain text of an HTML content (for the screen readers)
export const plainText = html => html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<\/div>/g, ". ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ");

// Size in pixels of a size in rem (follows the text size setting)
export const remToPx = rem => rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
