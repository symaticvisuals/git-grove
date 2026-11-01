import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ANATOMY = process.env.ANATOMY_DIR ?? join(homedir(), ".claude/skills/anatomy");
const k = await import(pathToFileURL(join(ANATOMY, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(ANATOMY, "scripts/inline-kit.mjs")).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 600;
const HEIGHT = 380;

const C = {
  PLATE: { x: -150, y: -58, w: 300, d: 110, r: 8 },
  PLATE_H: 12,
  FOOT_H: 5,
  PLINTH: { x: -134, y: -46, w: 268, d: 82, r: 6 },
  CASE: { x: -130, y: -43, w: 260, d: 75, r: 5 },
  DECK: 34,
  CARD_W: 34,
  CARD_D: 15,
  CARD_T: 0.6,
  BED: 34.8,
  TRACK: { x: -74, y: -21, w: 148, d: 18, r: 1 },
  TRACK_Y: -12,
  HOPPER_X: [-93, 93],
  POCKET_X: [-28, 28],
  POCKET_Y: 15,
  ARCHIVE: [-46, -30.5],
  READ_X: 0,
  BAR_UP: 55,
  DIAL: [101, 14],
  ANGLES: [-60, -30, 0, 30, 60],
};

const P = k.fitProjection(
  [...k.boxCorners(C.PLATE, -C.PLATE_H - C.FOOT_H, 0), [0, -13, 74], [-93, -24, 57], [93, -24, 57]],
  WIDTH,
  HEIGHT,
  { pad: 18, azimuth: 57 },
);

function cardPlan(cx, cy) {
  return { x: cx - C.CARD_W / 2, y: cy - C.CARD_D / 2, w: C.CARD_W, d: C.CARD_D, r: 0.8 };
}

function holesOf(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 4; row++) if (next() < 0.34) out.push([col, row]);
  }
  return out;
}

function cardFace(cx, cy, top, seed, strip) {
  const holes = holesOf(seed).map(([col, row]) => k.iso([cx - 13.2 + col * 2.4, cy - 5.2 + row * 2.2, top], P));
  const lines = [
    k.lineOnTop([cx - 14, cy + 4.2], [cx - 14 + 9 + (strip % 5) * 2.2, cy + 4.2], top, P),
    k.lineOnTop([cx - 14, cy + 5.8], [cx - 14 + 15 - (strip % 3) * 2.6, cy + 5.8], top, P),
  ];
  return k.dotsSvg(holes, { size: 0.42, tone: "lo" }) + k.lineSvg(lines.join(""), { tone: "lo", free: true });
}

function stackSvg(cx, cy, base, count, seed, strip, lit) {
  if (count <= 0) return "";
  const plan = cardPlan(cx, cy);
  const height = count * C.CARD_T;
  const seams = [];
  for (let i = 1; i < count; i++) seams.push(k.sideSeam(plan, base + i * C.CARD_T, P, 2));
  const body = k.solidSvg(k.slabOf(plan, base, height, P, 2), { tone: "hi", crease: "lo", lit, inner: seams.length ? k.lineSvg(seams.join(""), { tone: "faint" }) : "" });
  return body + (seed === null ? "" : cardFace(cx, cy, base + height, seed, strip));
}

function weightSvg(cx, cy, z) {
  const r = 5.6;
  return (
    k.solidSvg(k.cylinder(cx, cy, r, z, 6, P, 36, 0.4), { tone: "mid" }) +
    k.lineSvg(k.knurl(cx, cy, r, z + 1.2, z + 6, 30, P), { tone: "lo" }) +
    k.lineSvg(k.ring(cx, cy, 2, z + 6, P, 20), { tone: "faint" }) +
    k.dotsSvg([k.iso([cx, cy, z + 6], P)], { size: 0.5, tone: "mid" })
  );
}

function hopperStackSvg(cx, count, seed, strip) {
  const top = C.BED + Math.max(0, count) * C.CARD_T;
  return stackSvg(cx, C.TRACK_Y, C.BED, count, seed, strip, false) + weightSvg(cx, C.TRACK_Y, top);
}

function pocketStackSvg(cx, count, seed, strip) {
  return stackSvg(cx, C.POCKET_Y, C.BED, count, seed, strip, false);
}

function archiveSvg(barZ, copies, drop, seed, strip) {
  const [cx, cy] = C.ARCHIVE;
  const S = (plan, z, h, tone = "mid", steps = 2, bevel = 0.4) => k.solidSvg(k.slabOf(plan, z, h, P, steps, bevel), { tone });
  const post = (x, z0, z1) => (z1 - z0 > 0.2 ? k.solidSvg(k.cylinder(x, cy, 1.3, z0, z1 - z0, P, 16), { tone: "mid", crease: "none" }) : "");
  const leftX = cx - 23.5;
  const rightX = cx + 23.5;
  const postTop = 60;
  const out = [];
  out.push(S({ x: cx - 19, y: cy - 9.5, w: 38, d: 19, r: 1 }, C.DECK, 0.8, "lo", 2, 0));
  out.push(S({ x: cx - 19, y: cy - 9.5, w: 38, d: 2, r: 0.6 }, C.DECK, 10));
  out.push(k.solidSvg(k.cylinder(leftX, cy, 2.6, C.DECK, 1.6, P, 20), { tone: "mid" }));
  out.push(post(leftX, C.DECK + 1.6, barZ));
  out.push(S({ x: cx - 19, y: cy - 9.5, w: 2, d: 19, r: 0.6 }, C.DECK, 10));
  if (copies > 0) out.push(`<g style="opacity:${(1 - drop).toFixed(3)}" transform="${k.translateAlong(P, [0, 0, drop * 14])}">${stackSvg(cx, cy - 0.5, C.BED, copies, seed, strip, false)}</g>`);
  out.push(S({ x: cx - 23.5 - 2.4, y: cy - 2.2, w: 47 + 4.8, d: 4.4, r: 1.2 }, barZ, 3, "mid", 3, 0.5));
  out.push(k.dotsSvg([k.iso([leftX, cy, barZ + 3], P), k.iso([rightX, cy, barZ + 3], P)], { size: 0.5, tone: "mid" }));
  out.push(post(leftX, barZ + 3, postTop));
  out.push(S({ x: cx + 17, y: cy - 9.5, w: 2, d: 19, r: 0.6 }, C.DECK, 10));
  out.push(k.solidSvg(k.cylinder(rightX, cy, 2.6, C.DECK, 1.6, P, 20), { tone: "mid" }));
  out.push(post(rightX, C.DECK + 1.6, barZ));
  out.push(post(rightX, barZ + 3, postTop));
  out.push(k.solidSvg(k.cylinder(leftX, cy, 1.9, postTop, 1.2, P, 16), { tone: "mid" }));
  out.push(k.solidSvg(k.cylinder(rightX, cy, 1.9, postTop, 1.2, P, 16), { tone: "mid" }));
  out.push(S({ x: cx - 19, y: cy + 7.5, w: 38, d: 2, r: 0.6 }, C.DECK, 5));
  return out.join("");
}

function pointerD(angle) {
  const [cx, cy] = C.DIAL;
  const a = (angle * Math.PI) / 180;
  const top = C.DECK + 1.2 + 4.8;
  return k.lineOnTop([cx - Math.sin(a) * 1.6, cy + Math.cos(a) * 1.6], [cx + Math.sin(a) * 4.4, cy - Math.cos(a) * 4.4], top, P);
}

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const at = (point) => k.iso(point, P);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const loop = (points) => "M" + points.map((p) => at(p).map((v) => v.toFixed(2)).join(" ")).join("L") + "Z";

function plate() {
  const { PLATE, PLATE_H, FOOT_H } = C;
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  const strip = { x: -132, y: PLATE.y + PLATE.d - 15, w: 190, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  const label = { x: 76, y: PLATE.y + PLATE.d - 18, w: 52, d: 11, r: 1.5 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: "mid", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P, 4), { tone: "faint" }));
  out.push(L([[label.y + 3.4, 30], [label.y + 5.6, 22], [label.y + 7.8, 26]].map(([y, len]) => k.lineOnTop([label.x + 6, y], [label.x + 6 + len, y], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + 2.8, label.y + label.d / 2, 0.8]), at([label.x + label.w - 2.8, label.y + label.d / 2, 0.8])], { size: 0.45 }));
  return out.join("");
}

function body() {
  const { PLINTH, CASE, DECK } = C;
  const out = [];
  out.push(S(k.slabOf(PLINTH, 0, 3, P, 6, 0.5), { tone: "lo" }));
  const seam = k.sideSeam(CASE, DECK - 6, P, 6);
  out.push(S(k.slabOf(CASE, 3, DECK - 3, P, 6, 1), { tone: "mid", inner: L(seam, { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(CASE, 4), DECK, P, 6), { tone: "faint" }));
  const screws = k.corners(CASE, 8);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 1.8, DECK, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, DECK])), { size: 0.45 }));
  const xEnd = CASE.x + CASE.w;
  const vents = [];
  for (let i = 0; i < 6; i++) {
    const y0 = CASE.y + 14 + i * 8.4;
    vents.push(loop([[xEnd, y0, 10], [xEnd, y0 + 4.2, 10], [xEnd, y0 + 4.2, 21], [xEnd, y0, 21]]));
  }
  out.push(L(vents.join(""), { tone: "lo" }));
  const front = CASE.y + CASE.d;
  out.push(L(loop([[-46, front, 7], [46, front, 7], [46, front, 25], [-46, front, 25]]), { tone: "lo" }));
  out.push(L(loop([[-44.4, front, 8.6], [44.4, front, 8.6], [44.4, front, 23.4], [-44.4, front, 23.4]]), { tone: "faint" }));
  out.push(D([[-43, 9.8], [43, 9.8], [-43, 22.2], [43, 22.2]].map(([x, z]) => at([x, front, z])), { size: 0.45 }));
  for (const cx of C.POCKET_X) {
    out.push(L(loop([[cx - 9, front, 11], [cx + 9, front, 11], [cx + 9, front, 20], [cx - 9, front, 20]]), { tone: "mid" }));
    out.push(L(loop([[cx - 8, front, 12], [cx + 8, front, 12], [cx + 8, front, 19], [cx - 8, front, 19]]), { tone: "faint" }));
  }
  out.push(`<g data-part="count-kept">${k.faceTextSvg(k.sideMatrix([C.POCKET_X[0], front], 13.2, P, "left"), "00", { size: 6, tone: "hi", anchor: "middle" })}</g>`);
  out.push(`<g data-part="count-lost" class="count-lost">${k.faceTextSvg(k.sideMatrix([C.POCKET_X[1], front], 13.2, P, "left"), "00", { size: 6, tone: "hi", anchor: "middle" })}</g>`);
  out.push(k.faceTextSvg(k.sideMatrix([-118, front], 17, P, "left"), "GROVE", { size: 4.4, tone: "lo" }));
  return out.join("");
}

function dial() {
  const [cx, cy] = C.DIAL;
  const out = [];
  out.push(S(k.cylinder(cx, cy, 12, C.DECK, 1.2, P, 48, 0.4), { tone: "mid" }));
  const top = C.DECK + 1.2;
  out.push(L(k.ring(cx, cy, 10.6, top, P, 48), { tone: "faint" }));
  out.push(L(C.ANGLES.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return k.lineOnTop([cx + Math.sin(a) * 8.2, cy - Math.cos(a) * 8.2], [cx + Math.sin(a) * 10.6, cy - Math.cos(a) * 10.6], top, P);
  }).join(""), { tone: "mid" }));
  out.push(S(k.cylinder(cx, cy, 5.4, top, 4.8, P, 36, 0.4), { tone: "mid" }));
  out.push(L(k.knurl(cx, cy, 5.4, top + 0.8, top + 4.8, 30, P), { tone: "lo" }));
  return out.join("");
}

function track() {
  const { TRACK, DECK, BED } = C;
  const out = [];
  out.push(S(k.slabOf(TRACK, DECK, BED - DECK, P, 2), { tone: "lo", crease: "none" }));
  out.push(L(k.lineOnTop([TRACK.x, TRACK.y + 2], [TRACK.x + TRACK.w, TRACK.y + 2], BED, P) + k.lineOnTop([TRACK.x, TRACK.y + TRACK.d - 2], [TRACK.x + TRACK.w, TRACK.y + TRACK.d - 2], BED, P), { tone: "faint" }));
  out.push(S(k.slabOf({ x: TRACK.x, y: TRACK.y - 1.4, w: TRACK.w, d: 1.4, r: 0.4 }, BED, 1.6, P, 2, 0), { tone: "mid" }));
  out.push(D([TRACK.x + 3, -40, 40, TRACK.x + TRACK.w - 3].map((x) => at([x, TRACK.y - 0.7, BED + 1.6])), { size: 0.4 }));
  for (const sx of [-1, 1]) {
    const cx = sx * 93;
    out.push(S(k.slabOf({ x: cx - 19, y: -21, w: 38, d: 18, r: 1 }, DECK, BED - DECK, P, 2), { tone: "lo", crease: "none" }));
    out.push(S(k.slabOf({ x: cx - 19, y: -24.5, w: 38, d: 2.5, r: 0.6 }, DECK, 22, P, 2, 0.4), { tone: "mid" }));
    out.push(D([at([cx - 14, -23.25, DECK + 22]), at([cx + 14, -23.25, DECK + 22])], { size: 0.45 }));
    const endX = sx < 0 ? cx - 21.5 : cx + 19;
    out.push(S(k.slabOf({ x: endX, y: -24.5, w: 2.5, d: 23, r: 0.6 }, DECK, 22, P, 2, 0.4), { tone: "mid" }));
  }
  out.push(S(k.slabOf({ x: -9, y: -34, w: 18, d: 8, r: 1.2 }, DECK, 3, P, 3, 0.4), { tone: "mid" }));
  out.push(D([[-6.5, -32], [6.5, -32]].map(([x, y]) => at([x, y, DECK + 3])), { size: 0.45 }));
  out.push(S(k.slabOf({ x: -5.5, y: -33, w: 11, d: 6, r: 1 }, DECK + 3, 25, P, 3, 0.4), { tone: "mid" }));
  return out.join("");
}

function pocketBack(cx) {
  const y = C.POCKET_Y - 10;
  return (
    S(k.slabOf({ x: cx - 19, y, w: 38, d: 20, r: 1 }, C.DECK, 0.8, P, 2), { tone: "lo", crease: "none" }) +
    S(k.slabOf({ x: cx - 19, y, w: 38, d: 2, r: 0.6 }, C.DECK, 8, P, 2, 0.4), { tone: "mid" }) +
    S(k.slabOf({ x: cx - 19, y, w: 2, d: 20, r: 0.6 }, C.DECK, 8, P, 2, 0.4), { tone: "mid" })
  );
}

function pocketFront(cx) {
  const y = C.POCKET_Y - 10;
  const out = [];
  out.push(S(k.slabOf({ x: cx + 17, y, w: 2, d: 20, r: 0.6 }, C.DECK, 8, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: cx - 19, y: y + 18, w: 38, d: 2, r: 0.6 }, C.DECK, 5, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([cx - 15, y + 19, C.DECK + 5]), at([cx + 15, y + 19, C.DECK + 5])], { size: 0.45 }));
  return out.join("");
}

function hopperFront() {
  const out = [];
  const { TRACK, BED, DECK } = C;
  out.push(S(k.slabOf({ x: TRACK.x, y: TRACK.y + TRACK.d, w: TRACK.w, d: 1.4, r: 0.4 }, BED, 1.6, P, 2, 0), { tone: "mid" }));
  out.push(D([TRACK.x + 3, -40, 40, TRACK.x + TRACK.w - 3].map((x) => at([x, TRACK.y + TRACK.d + 0.7, BED + 1.6])), { size: 0.4 }));
  for (const gx of [-71, 71]) {
    out.push(S(k.slabOf({ x: gx - 2, y: -25, w: 4, d: 3, r: 0.6 }, DECK, 9, P, 2, 0.3), { tone: "mid" }));
    out.push(S(k.slabOf({ x: gx - 2.5, y: -25, w: 5, d: 25, r: 0.8 }, DECK + 9, 2.6, P, 2, 0.4), { tone: "mid" }));
    out.push(S(k.slabOf({ x: gx - 2, y: -3, w: 4, d: 3, r: 0.6 }, DECK, 9, P, 2, 0.3), { tone: "mid" }));
    out.push(D([at([gx, -23.5, DECK + 11.6]), at([gx, -1.5, DECK + 11.6])], { size: 0.45 }));
  }
  for (const cx of C.HOPPER_X) {
    for (const x of [cx - 19, cx + 16]) {
      out.push(S(k.slabOf({ x, y: -3.5, w: 3, d: 2.5, r: 0.6 }, C.DECK, 22, P, 2, 0.4), { tone: "mid" }));
    }
  }
  return out.join("");
}

function nearUpright() {
  return S(k.slabOf({ x: -4, y: -1, w: 8, d: 5, r: 1 }, C.DECK, 28, P, 3, 0.4), { tone: "mid" });
}

function gantryHeads() {
  const out = [];
  const brush = { x: -14, y: -18, w: 12, d: 12, r: 1 };
  out.push(S(k.slabOf(brush, 46, 16, P, 3, 0.5), { tone: "mid" }));
  const bristles = [];
  for (let i = 0; i < 7; i++) {
    const x = brush.x + 1.6 + i * 1.47;
    bristles.push(k.segment([x, C.TRACK_Y + 4, 46], [x, C.TRACK_Y + 4, C.BED], P));
  }
  out.push(L(bristles.join(""), { tone: "lo" }));
  out.push(D([at([brush.x + 2, brush.y + brush.d, 58]), at([brush.x + brush.w - 2, brush.y + brush.d, 58])], { size: 0.45 }));
  out.push(`<g data-part="strip-head">${S(k.slabOf({ x: 2, y: -18, w: 12, d: 12, r: 1 }, 50, 12, P, 3, 0.5), { tone: "mid" })}${L(k.sideRing ? k.sideRing([8, -6, 53], 1.8, "y", P) : "", { tone: "lo" })}</g>`);
  return out.join("");
}

function gantryTop() {
  const out = [];
  out.push(S(k.slabOf({ x: -16, y: -33, w: 32, d: 29, r: 2 }, 62, 6, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline({ x: -13, y: -30, w: 26, d: 23, r: 1 }, 68, P, 3), { tone: "faint" }));
  out.push(D([at([-12, -29, 68]), at([12, -29, 68]), at([-12, -8, 68]), at([12, -8, 68])], { size: 0.45 }));
  out.push(S(k.cylinder(0, -13, 4.2, 68, 2, P, 32, 0.3), { tone: "mid" }));
  out.push(`<g data-part="lamp">${S(k.cylinder(0, -13, 3.1, 70, 3.4, P, 32, 0.3), { tone: "hi" })}<path class="lamp-cap" d="${k.ring(0, -13, 3.1, 73.4, P, 32)}"/></g>`);
  return out.join("");
}

const OLD_TOP = { seed: 113, strip: 13 };
const initial = {
  archive: archiveSvg(C.BAR_UP - 10, 14, 0, OLD_TOP.seed, OLD_TOP.strip),
  left: hopperStackSvg(C.HOPPER_X[0], 14, OLD_TOP.seed, OLD_TOP.strip),
  right: hopperStackSvg(C.HOPPER_X[1], 14, OLD_TOP.seed, OLD_TOP.strip),
};

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A punched-card collator on a bench plate. The left hopper holds a branch's old commits as cards, the right hopper its new commits. Before reading, a copy of the old deck is filed in the archive tray and clamped. Each old card feeds to a read station: a brush reads its holes (the patch ID) and, if they differ, a second head reads its printed strip (author, date, subject). Matched cards drop into the kept pocket, unmatched ones into the lost pocket, which lights the lamp.",
  body: [
    plate(),
    body(),
    dial(),
    `<g data-part="archive">${initial.archive}</g>`,
    track(),
    pocketBack(C.POCKET_X[0]),
    pocketBack(C.POCKET_X[1]),
    `<g data-part="kept"></g>`,
    `<g data-part="lost"></g>`,
    `<g data-part="card" style="display:none"></g>`,
    `<g data-part="left">${initial.left}</g>`,
    `<g data-part="right">${initial.right}</g>`,
    hopperFront(),
    gantryHeads(),
    pocketFront(C.POCKET_X[0]),
    pocketFront(C.POCKET_X[1]),
    gantryTop(),
    `<path data-part="pointer" class="iso-line" data-tone="hi" data-free="start" d="${pointerD(C.ANGLES[0])}" style="stroke-width:1"/>`,
  ],
});

const live = `
const k = { slabOf, solidSvg, lineSvg, dotsSvg, sideSeam, lineOnTop, cylinder, knurl, ring, iso, translateAlong };
const P = ${JSON.stringify(P)};
const C = ${JSON.stringify(C)};
${cardPlan.toString()}
${holesOf.toString()}
${cardFace.toString()}
${stackSvg.toString()}
${weightSvg.toString()}
${hopperStackSvg.toString()}
${pocketStackSvg.toString()}
${archiveSvg.toString()}
${pointerD.toString()}

const OLD = Array.from({ length: 14 }, (_, i) => ({ seed: 100 + i, strip: i }));
const SCENARIOS = [
  { name: "Rebase", baseMoved: true, next: OLD.map((c) => ({ ...c })) },
  { name: "Rebase, 2 conflicts", baseMoved: true, next: OLD.map((c, i) => (i === 4 || i === 9 ? { ...c, seed: 500 + i } : { ...c })) },
  { name: "Amend the tip", baseMoved: false, next: OLD.map((c, i) => (i === 13 ? { ...c, seed: 713 } : { ...c })) },
  { name: "Drop one", baseMoved: true, next: OLD.filter((_, i) => i !== 6).map((c) => ({ ...c })) },
  { name: "Squash into 1", baseMoved: false, next: [{ seed: 999, strip: 99 }] },
];

function classify(old, next, baseMoved) {
  const used = new Set();
  const take = (test) => { const j = next.findIndex((c, idx) => !used.has(idx) && test(c)); if (j >= 0) used.add(j); return j; };
  const byHoles = old.map((c) => take((n) => n.seed === c.seed));
  const kinds = old.map((c, i) => {
    if (byHoles[i] >= 0) return "holes";
    return take((n) => n.strip === c.strip) >= 0 ? "strip" : "lost";
  });
  const tip = old.length - 1;
  const lost = kinds.filter((x) => x === "lost").length;
  const strip = kinds.filter((x) => x === "strip").length;
  const holes = kinds.filter((x) => x === "holes").length;
  const onlyTip = (kind) => kinds.every((x, i) => (i === tip ? x === kind : x === "holes"));
  let verdict;
  if (!baseMoved && (onlyTip("strip") || onlyTip("lost"))) verdict = "amended";
  else if (lost === 0) verdict = "rebased";
  else verdict = "rewritten, " + lost + " lost";
  return { kinds, lost, strip, holes, verdict };
}

const RESULTS = SCENARIOS.map((s) => classify(OLD, s.next, s.baseMoved));
const summaryOf = (i) => {
  const s = SCENARIOS[i], r = RESULTS[i], matched = r.holes + r.strip;
  const how = r.strip ? " (" + r.strip + " by strip)" : "";
  return s.name + " · " + matched + "/14 matched" + how + " · " + r.verdict;
};

const ARCHIVE_T = 1.8, SLOT = 0.72, HOLD = 3.2;
const runLength = ARCHIVE_T + 14 * SLOT + HOLD;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a, b, t) => a + (b - a) * t;

function stateAt(i, t) {
  const r = RESULTS[i], next = SCENARIOS[i].next;
  const st = { bar: C.BAR_UP - 10, copies: 14, drop: 0, fed: 0, landedKept: 0, landedLost: 0, rightLeft: next.length, card: null, head: 0, lamp: false, reading: -1 };
  if (t < ARCHIVE_T) {
    const u = t / ARCHIVE_T;
    st.bar = u < 0.3 ? lerp(C.BAR_UP - 10, C.BAR_UP, ease(u / 0.3)) : u < 0.7 ? C.BAR_UP : lerp(C.BAR_UP, C.BED + 14 * C.CARD_T, ease((u - 0.7) / 0.3));
    st.copies = u < 0.3 ? 0 : 14;
    st.drop = u < 0.3 ? 1 : 1 - ease((u - 0.3) / 0.35);
    return st;
  }
  st.bar = C.BED + 14 * C.CARD_T;
  const s = (t - ARCHIVE_T) / SLOT;
  const n = Math.min(14, Math.floor(s));
  const consumedBefore = (m) => r.kinds.slice(0, m).filter((x) => x !== "lost").length;
  st.fed = Math.min(14, Math.ceil(s));
  for (let c = 0; c < Math.min(n, 14); c++) { if (r.kinds[c] === "lost") st.landedLost++; else st.landedKept++; }
  st.rightLeft = next.length - consumedBefore(Math.min(n, 14));
  st.lamp = st.landedLost > 0;
  if (n < 14) {
    const u = s - n, kind = r.kinds[n];
    st.reading = n;
    const pocket = kind === "lost" ? C.POCKET_X[1] : C.POCKET_X[0];
    const landed = kind === "lost" ? st.landedLost : st.landedKept;
    let x, y = C.TRACK_Y, z = C.BED;
    if (u < 0.34) x = lerp(C.HOPPER_X[0], C.READ_X, ease(u / 0.34));
    else if (u < 0.62) x = C.READ_X;
    else { const v = ease((u - 0.62) / 0.38); x = lerp(C.READ_X, pocket, v); y = lerp(C.TRACK_Y, C.POCKET_Y, v); z = lerp(C.BED, C.BED + landed * C.CARD_T, v) + Math.sin(Math.PI * v) * 11; }
    if (kind !== "holes" && u > 0.4 && u < 0.62) st.head = Math.sin(Math.PI * (u - 0.4) / 0.22);
    st.card = { index: n, x, y, z };
  } else st.reading = 14;
  return st;
}

const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const part = (name) => svg.querySelector('[data-part="' + name + '"]');
const els = { archive: part("archive"), left: part("left"), right: part("right"), kept: part("kept"), lost: part("lost"), card: part("card"), head: part("strip-head"), lamp: part("lamp"), pointer: part("pointer"), lostCount: part("count-lost") };
els.keptText = part("count-kept").querySelector("text");
els.lostText = els.lostCount.querySelector("text");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const memo = {};
const put = (key, el, value, build) => { if (memo[key] !== value) { memo[key] = value; el.innerHTML = build(); } };

let scenario = 0, clock = 0, frame = 0, last = 0, visible = false, touring = !still.matches, idle = 0, dialAngle = C.ANGLES[0];

function draw(st) {
  const r = RESULTS[scenario], next = SCENARIOS[scenario].next;
  put("archive", els.archive, [st.bar.toFixed(2), st.copies, st.drop.toFixed(2)].join(), () => archiveSvg(st.bar, st.copies, st.drop, OLD[13].seed, OLD[13].strip));
  const leftCount = 14 - st.fed;
  put("left", els.left, String(leftCount), () => hopperStackSvg(C.HOPPER_X[0], leftCount, leftCount ? OLD[13].seed : null, 13));
  const top = next[next.length - 1];
  put("right", els.right, scenario + ":" + st.rightLeft, () => hopperStackSvg(C.HOPPER_X[1], st.rightLeft, st.rightLeft ? top.seed : null, top.strip));
  const lastOf = (kind, count) => { let seen = 0; for (let c = 0; c < 14; c++) if ((kind === "lost") === (r.kinds[c] === "lost") && ++seen === count) return OLD[c]; return OLD[0]; };
  put("kept", els.kept, scenario + ":" + st.landedKept, () => { const c = lastOf("kept", st.landedKept); return pocketStackSvg(C.POCKET_X[0], st.landedKept, c.seed, c.strip); });
  put("lost", els.lost, scenario + ":" + st.landedLost, () => { const c = lastOf("lost", st.landedLost); return pocketStackSvg(C.POCKET_X[1], st.landedLost, c.seed, c.strip); });
  if (st.card) {
    els.card.style.display = "";
    put("card", els.card, scenario + ":" + st.card.index, () => stackSvg(0, 0, 0, 1, OLD[st.card.index].seed, OLD[st.card.index].strip, true));
    els.card.setAttribute("transform", translateAlong(P, [st.card.x, st.card.y, st.card.z]));
  } else els.card.style.display = "none";
  els.head.setAttribute("transform", translateAlong(P, [0, 0, -5.5 * st.head]));
  els.lamp.classList.toggle("lamp-on", st.lamp);
  els.pointer.setAttribute("d", pointerD(dialAngle));
  const two = (n) => String(n).padStart(2, "0");
  if (els.keptText.textContent !== two(st.landedKept)) els.keptText.textContent = two(st.landedKept);
  if (els.lostText.textContent !== two(st.landedLost)) els.lostText.textContent = two(st.landedLost);
  els.lostCount.classList.toggle("count-on", st.landedLost > 0);
  let text;
  if (st.reading < 0) text = SCENARIOS[scenario].name + " · pinning a copy";
  else if (st.reading < 14) text = SCENARIOS[scenario].name + " · card " + (st.reading + 1) + "/14 · " + st.landedKept + " kept, " + st.landedLost + " lost";
  else text = summaryOf(scenario);
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(scenario));
  stage.setAttribute("aria-valuetext", summaryOf(scenario));
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const target = C.ANGLES[scenario];
  dialAngle = still.matches ? target : dialAngle + (target - dialAngle) * (1 - Math.exp(-dt / 0.18));
  if (still.matches) clock = runLength - HOLD;
  else clock += dt;
  if (clock >= runLength) {
    if (touring) { scenario = (scenario + 1) % SCENARIOS.length; clock = 0; }
    else clock = runLength - 0.001;
  }
  draw(stateAt(scenario, Math.min(clock, runLength - HOLD + 0.001)));
  const settled = !touring && clock >= runLength - HOLD && Math.abs(target - dialAngle) < 0.05;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const choose = (next) => {
  if (next === scenario) return;
  scenario = next; clock = 0; touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; run(); }, 9000);
  run();
};
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const share = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width));
  choose(Math.floor(share * SCENARIOS.length));
});
stage.addEventListener("keydown", (event) => {
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = Math.min(SCENARIOS.length - 1, scenario + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = Math.max(0, scenario - 1);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = SCENARIOS.length - 1;
  if (to === null) return;
  event.preventDefault();
  choose(to);
});
draw(stateAt(scenario, 0));
`;

const style = `<style>
.lamp-cap { fill: transparent; transition: fill 0.25s ease; }
.lamp-on .lamp-cap { fill: var(--lamp, #c62828); }
.iso .count-lost.count-on text { fill: var(--lamp, #c62828) !important; }
.iso { --lamp: #c62828; }
.iso[data-theme="dark"] { --lamp: #ff6a5c; }
</style>`;

const plateBody = k.plateHtml({
  fig: "Fig 1",
  title: "How grove reads a rewrite",
  hint: "Hover or arrow keys: pick a change",
  readout: "Rebase · pinning a copy",
  keys: [
    { mark: "lit", label: "The commit being read" },
    { mark: "raised", label: "Old commits (left hopper), new commits (right hopper)" },
    { mark: "red", label: "Lamp: a change that is no longer present" },
  ],
  caption:
    "Each commit is a card: its holes are the patch ID, its printed strip the author, date and subject. A copy of the old deck is filed and clamped first, so nothing can be lost while grove decides. Every old card is matched against the new deck by holes, then by strip. All matched means rebased; only the tip changed with the base unmoved means amended; anything unmatched means rewritten.",
  body: `${style}<div class="iso-stage" tabindex="0" role="slider" aria-label="Collator: arrow keys pick the change being classified" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0">${svg}</div>`,
});

const file = theme === "light" ? "collator-light.html" : "collator.html";
writeFileSync(join(HERE, file), k.pageHtml({ title: "How grove reads a rewrite", theme, body: plateBody, script: kitScript() + live }));
console.log("wrote", file);
