import { animationFrame, petSpriteDataUri } from "./pet-sprite.js";
import { petRoamer, type PetCameo } from "./pet-roamer.js";
import { escapeXml } from "./format.js";

const CAMEO_WIDTH = 84;
const CAMEO_HEIGHT = 91;
const CAMEO_SIDE_REVEAL_PX = 58;
const CAMEO_TOP_HEIGHT = 68;
const SCREEN_TEXT_BUBBLE_WIDTH = 104;
const SCREEN_TEXT_BUBBLE_HEIGHT = 40;
const SCREEN_TRAVEL_DURATION_MS = 1_200;

export function withPetCameo(
  svg: string,
  actionId: string,
  viewportX = 0,
  viewportWidth = 144,
  viewportHeight = 144,
  nowMs = Date.now()
): string {
  const cameo = petRoamer.cameoFor(actionId, nowMs);
  if (!cameo) return svg;
  return svg.replace(
    /<\/svg>\s*$/,
    `${petCameoOverlay(cameo, viewportX, viewportWidth, viewportHeight)}</svg>`
  );
}

export function petCameoOverlay(
  cameo: PetCameo,
  viewportX = 0,
  viewportWidth = 144,
  viewportHeight = 144
): string {
  if (cameo.destination === "screen") {
    if (cameo.screenMode === "peek") {
      return petScreenPeek(cameo, viewportX, viewportHeight);
    }
    return petScreenStay(cameo, viewportX, viewportWidth, viewportHeight);
  }

  const reveal = cameoReveal(cameo.elapsedMs, cameo.durationMs);
  const bob = Math.sin(cameo.elapsedMs / 170) * 1.4 * reveal;
  const vertical = cameo.edge === "top" || cameo.edge === "bottom";
  const { x, y } = vertical
    ? {
        x: topPetX(cameo.x, viewportX, viewportWidth) + bob,
        y: cameo.edge === "top"
          ? lerp(-CAMEO_TOP_HEIGHT, 0, reveal)
          : lerp(viewportHeight, viewportHeight - CAMEO_TOP_HEIGHT, reveal)
      }
    : sidePosition(cameo, viewportX, viewportWidth, reveal, bob);
  const sprite = petSpriteDataUri("waving", animationFrame("waving", cameo.elapsedMs));
  const pet = vertical
    ? `<svg class="pet-cameo-vertical pet-cameo-${cameo.edge}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${CAMEO_WIDTH}" height="${CAMEO_TOP_HEIGHT}" viewBox="0 0 ${CAMEO_WIDTH} ${CAMEO_TOP_HEIGHT}" overflow="hidden">
      <image href="${sprite}" x="0" y="0" width="${CAMEO_WIDTH}" height="${CAMEO_HEIGHT}" opacity=".98" preserveAspectRatio="xMidYMid meet"/>
    </svg>`
    : `<image href="${sprite}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${CAMEO_WIDTH}" height="${CAMEO_HEIGHT}" opacity=".98" preserveAspectRatio="xMidYMid meet"/>`;

  return `<g class="pet-cameo" pointer-events="none">
  ${pet}
  </g>`;
}

export function cameoReveal(elapsedMs: number, durationMs: number): number {
  const progress = Math.max(0, Math.min(1, elapsedMs / durationMs));
  if (progress < 0.22) return smoothstep(progress / 0.22);
  if (progress > 0.78) return smoothstep((1 - progress) / 0.22);
  return 1;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function sidePosition(
  cameo: PetCameo,
  viewportX: number,
  viewportWidth: number,
  reveal: number,
  bob: number
): { x: number; y: number } {
  const hiddenX = cameo.edge === "left" ? viewportX - CAMEO_WIDTH : viewportX + viewportWidth;
  const visibleX = cameo.edge === "left"
    ? viewportX - CAMEO_WIDTH + CAMEO_SIDE_REVEAL_PX
    : viewportX + viewportWidth - CAMEO_SIDE_REVEAL_PX;
  return { x: lerp(hiddenX, visibleX, reveal), y: cameo.y + bob };
}

function topPetX(position: number, viewportX: number, viewportWidth: number): number {
  const progress = Math.max(0, Math.min(1, (position - 16) / 42));
  return viewportX + 4 + progress * Math.max(0, viewportWidth - CAMEO_WIDTH - 8);
}

function petScreenPeek(cameo: PetCameo, viewportX: number, viewportHeight: number): string {
  const reveal = cameoReveal(cameo.elapsedMs, cameo.durationMs);
  const bob = Math.sin(cameo.elapsedMs / 170) * 1.2 * reveal;
  const hiddenX = viewportX - CAMEO_WIDTH;
  const visibleX = hiddenX + 62;
  const x = lerp(hiddenX, visibleX, reveal);
  const y = Math.max(3, viewportHeight - CAMEO_HEIGHT + bob);
  const sprite = petSpriteDataUri("waving", animationFrame("waving", cameo.elapsedMs));
  return `<g class="pet-cameo pet-screen-peek" pointer-events="none">
    <image href="${sprite}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${CAMEO_WIDTH}" height="${CAMEO_HEIGHT}" opacity=".98" preserveAspectRatio="xMidYMid meet"/>
  </g>`;
}

function petScreenStay(
  cameo: PetCameo,
  viewportX: number,
  viewportWidth: number,
  viewportHeight: number
): string {
  const petOnLeft = cameo.x < 37;
  const travelMs = Math.min(SCREEN_TRAVEL_DURATION_MS, cameo.durationMs / 4);
  const targetX = petOnLeft ? viewportX + 4 : viewportX + viewportWidth - CAMEO_WIDTH - 4;
  const hiddenX = viewportX - CAMEO_WIDTH - 4;
  const arriving = cameo.elapsedMs < travelMs;
  const leaving = cameo.durationMs - cameo.elapsedMs < travelMs;
  const petX = arriving
    ? lerp(hiddenX, targetX, smoothstep(Math.max(0, cameo.elapsedMs / travelMs)))
    : leaving
      ? lerp(
          targetX,
          hiddenX,
          smoothstep(Math.max(0, Math.min(1, (cameo.elapsedMs - cameo.durationMs + travelMs) / travelMs)))
        )
      : targetX;
  const petY = Math.max(3, viewportHeight - CAMEO_HEIGHT + Math.sin(cameo.elapsedMs / 380) * 1.2);
  const bubbleWidth = Math.min(SCREEN_TEXT_BUBBLE_WIDTH, viewportWidth - CAMEO_WIDTH - 18);
  const lines = messageLines(cameo.message, 9, true);
  const bubbleHeight = SCREEN_TEXT_BUBBLE_HEIGHT;
  const bubbleX = petOnLeft
    ? viewportX + viewportWidth / 2 - bubbleWidth - 4
    : viewportX + viewportWidth / 2 + 4;
  const bubbleY = Math.max(8, Math.min(viewportHeight - bubbleHeight - 8, 28));
  const tail = petOnLeft
    ? `M${bubbleX + 3} ${bubbleY + 16}L${petX + CAMEO_WIDTH - 5} ${bubbleY + 23}L${bubbleX + 7} ${bubbleY + 27}Z`
    : `M${bubbleX + bubbleWidth - 3} ${bubbleY + 16}L${petX + 5} ${bubbleY + 23}L${bubbleX + bubbleWidth - 7} ${bubbleY + 27}Z`;
  const text = lines.map((line, index) =>
    `<text x="${bubbleX + bubbleWidth / 2}" y="${bubbleY + (lines.length > 1 ? 15 + index * 13 : 20.5)}" text-anchor="middle" fill="#f3f7fb" font-family="-apple-system,Arial" font-size="9" font-weight="800" letter-spacing=".25">${escapeXml(line)}</text>`
  ).join("");
  const state = arriving ? "running-right" : leaving ? "running-left" : "waiting";
  const stateElapsedMs = arriving
    ? cameo.elapsedMs
    : leaving
      ? cameo.elapsedMs - cameo.durationMs + travelMs
      : cameo.elapsedMs - travelMs;
  const sprite = petSpriteDataUri(state, animationFrame(state, stateElapsedMs));
  const bubbleOpacity = screenBubbleOpacity(cameo.elapsedMs, cameo.durationMs, travelMs);
  const bubble = bubbleOpacity > 0
    ? `<g class="pet-cameo-bubble" opacity="${bubbleOpacity.toFixed(2)}">
      <path d="${tail}" fill="#081019" stroke="#60a5fa" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="${bubbleX}" y="${bubbleY}" width="${bubbleWidth}" height="${bubbleHeight}" rx="10" fill="#081019" fill-opacity=".94" stroke="#60a5fa" stroke-width="1.75"/>
      ${text}
    </g>`
    : "";

  return `<g class="pet-cameo pet-screen-stay" pointer-events="none">
    ${bubble}
    <image href="${sprite}" x="${petX.toFixed(2)}" y="${petY.toFixed(2)}" width="${CAMEO_WIDTH}" height="${CAMEO_HEIGHT}" opacity=".98" preserveAspectRatio="xMidYMid meet"/>
  </g>`;
}

function screenBubbleOpacity(elapsedMs: number, durationMs: number, travelMs: number): number {
  const fadeMs = 250;
  const visibleStart = travelMs + 200;
  const visibleEnd = durationMs - travelMs - 200;
  if (elapsedMs < visibleStart || elapsedMs > visibleEnd) return 0;
  if (elapsedMs < visibleStart + fadeMs) return smoothstep((elapsedMs - visibleStart) / fadeMs);
  if (elapsedMs > visibleEnd - fadeMs) return smoothstep((visibleEnd - elapsedMs) / fadeMs);
  return 1;
}

function messageLines(message: string, maxLength: number, forceTwoLines = false): string[] {
  if (message.length <= maxLength && !forceTwoLines) return [message];
  const words = message.split(" ");
  if (words.length < 2) return [message];
  let splitAt = 1;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(" ");
    const right = words.slice(index).join(" ");
    const difference = Math.abs(left.length - right.length);
    if (difference < bestDifference) {
      bestDifference = difference;
      splitAt = index;
    }
  }
  return [words.slice(0, splitAt).join(" "), words.slice(splitAt).join(" ")];
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
