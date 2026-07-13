import type { DialAction, KeyAction } from "@elgato/streamdeck";
import { escapeXml, truncate } from "./format.js";
import { withPetCameo } from "./pet-cameo.js";

export type Card = {
  eyebrow: string;
  title: string;
  meta: string;
  accent: string;
  progress?: number;
  live?: boolean;
  dialLabel?: string;
  dialValue?: string;
  dialMeta?: string;
};

export type PairKeyCard = {
  accent: string;
  live?: boolean;
  progress?: number;
  left: { eyebrow: string; value: string; meta: string };
  right: { eyebrow: string; value: string; meta: string };
};

export async function renderCard(action: DialAction | KeyAction, card: Card): Promise<void> {
  if (action.isDial()) {
    await action.setFeedback({
      label: truncate(card.dialLabel ?? card.eyebrow, 20),
      value: truncate(card.dialValue ?? card.title, 23),
      meta: truncate(card.dialMeta ?? card.meta, 26),
      accent: {
        value: 100,
        bar_bg_c: card.accent,
        bar_fill_c: card.accent,
        border_w: 0
      },
      indicator: {
        value: clamp(card.progress ?? 0),
        bar_bg_c: "#263244",
        bar_fill_c: card.accent,
        border_w: 0
      }
    });
    return;
  }
  await action.setImage(svgDataUri(withPetCameo(cardSvg(card), action.id)));
  await action.setTitle("");
}

export function cardSvg(card: Card): string {
  const progress = clamp(card.progress ?? 0);
  const title = wrap(truncate(card.title, 28), 13);
  const titleLines = title.map((line, index) =>
    `<text x="12" y="${61 + index * 23}">${escapeXml(line)}</text>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="20" fill="#0b0f17"/>
  <rect x="0" y="0" width="144" height="7" rx="4" fill="${card.accent}"/>
  <text x="12" y="29" fill="${card.accent}" font-family="-apple-system,Arial" font-size="13" font-weight="800" letter-spacing=".7">${escapeXml(truncate(card.eyebrow.toUpperCase(), 17))}</text>
  ${card.live ? `<circle cx="128" cy="25" r="5" fill="#4ade80"/>` : ""}
  <g fill="#f5f7fb" font-family="-apple-system,Arial" font-size="19" font-weight="750">${titleLines}</g>
  <text x="12" y="117" fill="#aab5c4" font-family="-apple-system,Arial" font-size="11" font-weight="600">${escapeXml(truncate(card.meta, 20))}</text>
  <rect x="12" y="130" width="120" height="5" rx="2.5" fill="#222b38"/>
  <rect x="12" y="130" width="${1.2 * progress}" height="5" rx="2.5" fill="${card.accent}"/>
  </svg>`;
}

export function pairedKeySvg(card: PairKeyCard, panel: number, actionId?: string): string {
  const viewX = panel === 1 ? 144 : 0;
  const progress = clamp(card.progress ?? 0);
  const blocks = [card.left, card.right].map((block, index) => {
    const x = index * 144 + 12;
    const lines = wrap(truncate(block.value, 30), 13);
    const fontSize = lines.some((line) => line.length > 11) ? 17 : 19;
    const value = lines.map((line, lineIndex) =>
      `<text x="${x}" y="${61 + lineIndex * 22}">${escapeXml(line)}</text>`
    ).join("");
    return `<text x="${x}" y="29" fill="${card.accent}" font-family="-apple-system,Arial" font-size="12" font-weight="800" letter-spacing=".7">${escapeXml(truncate(block.eyebrow.toUpperCase(), 17))}</text>
    <g fill="#f5f7fb" font-family="-apple-system,Arial" font-size="${fontSize}" font-weight="760">${value}</g>
    <text x="${x}" y="117" fill="#9eacbd" font-family="-apple-system,Arial" font-size="10" font-weight="600">${escapeXml(truncate(block.meta, 20))}</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="${viewX} 0 144 144">
  <defs>
    <linearGradient id="pair-key-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#08111b"/>
      <stop offset=".5" stop-color="#101a28"/>
      <stop offset="1" stop-color="#09121c"/>
    </linearGradient>
  </defs>
  <rect width="288" height="144" rx="20" fill="url(#pair-key-bg)"/>
  <rect width="288" height="7" rx="4" fill="${card.accent}"/>
  ${card.live ? `<circle cx="130" cy="25" r="5" fill="#4ade80"/>` : ""}
  ${blocks}
  <rect x="12" y="130" width="264" height="5" rx="2.5" fill="#222b38"/>
  <rect x="12" y="130" width="${2.64 * progress}" height="5" rx="2.5" fill="${card.accent}"/>
  </svg>`;
  return actionId ? withPetCameo(svg, actionId, viewX) : svg;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function wrap(value: string, length: number): string[] {
  const words = value.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > length) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines.slice(0, 2);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
