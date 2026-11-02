import type { Health } from "../../src/server/wire/health-of.js";
import { HEALTH_LABEL } from "./health-label.js";
import { html, raw, type SafeHtml } from "./html.js";

const COLOUR: Record<Health, string> = {
  loses: "var(--ember)",
  action: "var(--resin)",
  review: "var(--fjord)",
  fine: "var(--moss)",
  idle: "var(--faint)",
};

const HEALTH_MARK: Record<Health, (colour: string) => string> = {
  loses: (c) => `<circle cx="7" cy="7" r="6" fill="${c}"/><path d="M7 3.6v4.1" stroke="#1A0E0A" stroke-width="1.7" stroke-linecap="round"/><circle cx="7" cy="10.1" r=".95" fill="#1A0E0A"/>`,
  action: (c) => `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M7 7V2.4A4.6 4.6 0 0 1 11.6 7z" fill="${c}"/>`,
  review: (c) => `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M7 7V2.4A4.6 4.6 0 1 1 2.4 7z" fill="${c}"/>`,
  fine: (c) => `<circle cx="7" cy="7" r="6" fill="${c}"/><path d="M4.4 7.2l1.8 1.8 3.5-3.6" fill="none" stroke="#0E1A12" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  idle: (c) => `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${c}" stroke-width="1.6" stroke-dasharray="2.2 2"/>`,
};

const glyph = (path: string, size = 13): SafeHtml => raw(`<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${path}</svg>`);
const stroke = (d: string): string =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The dashboard's SVG icons, ported from the mockup. */
export const ICONS = {
  health: (health: Health): SafeHtml =>
    html`<svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="${HEALTH_LABEL[health]}">${raw(HEALTH_MARK[health](COLOUR[health]))}</svg>`,
  repoDot: (health: Health): SafeHtml =>
    raw(`<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3.5" fill="#1E2925" stroke="var(--line-hi)"/><circle cx="8" cy="8" r="2.4" fill="${COLOUR[health]}"/></svg>`),
  ring: (size = 12): SafeHtml =>
    raw(`<svg width="${size}" height="${size}" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.8" fill="none" stroke="#E3A23B" stroke-width="2.4"/></svg>`),
  ok: raw(
    `<svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="passes"><circle cx="7" cy="7" r="6" fill="none" stroke="var(--moss)" stroke-width="1.5"/><path d="M4.4 7.2l1.8 1.8 3.5-3.6" fill="none" stroke="var(--moss)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ),
  no: raw(
    `<svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="fails"><circle cx="7" cy="7" r="6" fill="var(--ember)"/><path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="#1A0E0A" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  ),
  dot: raw(`<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="2.2" fill="var(--muted)"/></svg>`),
  shield: raw(
    `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 13.5 4v4.2c0 3.2-2.3 5.6-5.5 6.3-3.2-.7-5.5-3.1-5.5-6.3V4z" fill="none" stroke="var(--moss)" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.6 8.1l1.6 1.6 3.2-3.3" fill="none" stroke="var(--moss)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ),
  logo: raw(
    `<svg viewBox="0 3 64 64" width="20" height="20" aria-hidden="true"><path d="M44 9 V44 A12 12 0 0 1 32 56 H27" fill="none" stroke="#E8E4D9" stroke-width="6.5" stroke-linejoin="round"/><circle cx="32" cy="24" r="12" fill="none" stroke="#E3A23B" stroke-width="6.5"/><circle cx="23" cy="56" r="6.5" fill="#E8E4D9"/></svg>`,
  ),
  search: glyph(`<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`),
  needs: glyph(`<path d="M2 9.5V13h12V9.5M2 9.5 4 3h8l2 6.5M2 9.5h3.5l1 1.8h3l1-1.8H14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`, 15),
  activity: glyph(`<path d="M1.5 8h3l2-5 3 10 2-5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`, 15),
  pin: glyph(`<circle cx="8" cy="6.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 10.1V15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`, 15),
  projects: glyph(`<rect x="2" y="2" width="5" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>`, 15),
  scan: glyph(stroke("M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3.5H10")),
  caret: raw(`<svg class="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`),
  editor: glyph(stroke("M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4")),
  terminal: glyph(stroke("M3 4.5 6.5 8 3 11.5M8.5 12H13")),
  more: glyph(`<circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/>`),
  restack: glyph(stroke("M4 2.5v6a3 3 0 0 0 3 3h5M10 9l2.5 2.5L10 14")),
  plus: glyph(`<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`),
  back: glyph(stroke("M6 4 2.5 7.5 6 11M3 7.5h6.5a4 4 0 0 1 0 8")),
  broom: glyph(`<path d="M10.5 2 7 8M4 8.5h6l1.5 5.5h-9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`),
  copy: glyph(`<rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 3.5V3a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 2 3v6.5A1.5 1.5 0 0 0 3.5 11H4" fill="none" stroke="currentColor" stroke-width="1.5"/>`),
  needsChip: raw(`<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="var(--ember)"/></svg>`),
  cleanChip: raw(
    `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2 7 8M4 8.5h6l1.5 5.5h-9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  ),
} as const;
