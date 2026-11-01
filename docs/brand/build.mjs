import { writeFileSync } from "node:fs";

const C = {
  canvas: "#0B1411",
  spruce: "#12211C",
  spruceHi: "#1A2E27",
  rule: "#25392F",
  resin: "#E3A23B",
  birch: "#ECE6D6",
  lichen: "#8EA197",
  ember: "#E0573C",
  moss: "#7DB08A",
};

function mark({ ink = C.birch, ring = C.resin, size = 64, title = "git grove" } = {}) {
  return `<svg viewBox="0 3 64 64" width="${size}" height="${size}" role="img" aria-label="${title}">
  <path d="M44 9 V44 A12 12 0 0 1 32 56 H27" fill="none" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/>
  <circle cx="32" cy="24" r="12" fill="none" stroke="${ring}" stroke-width="6"/>
  <circle cx="23" cy="56" r="6" fill="${ink}"/>
</svg>`;
}

function construction() {
  const lines = [];
  for (let v = 4; v < 64; v += 4) {
    lines.push(`<line x1="${v}" y1="3" x2="${v}" y2="67" />`, `<line x1="0" y1="${v + 3}" x2="64" y2="${v + 3}" />`);
  }
  return `<svg viewBox="0 3 64 64" width="220" height="220" aria-hidden="true">
  <g stroke="${C.rule}" stroke-width="0.25">${lines.join("")}</g>
  <g fill="none" stroke="${C.lichen}" stroke-width="0.3" stroke-dasharray="1 1">
    <circle cx="32" cy="24" r="15"/><circle cx="32" cy="24" r="9"/>
    <circle cx="32" cy="44" r="12"/>
    <line x1="44" y1="3" x2="44" y2="67"/><line x1="0" y1="9" x2="64" y2="9"/><line x1="0" y1="56" x2="64" y2="56"/>
  </g>
  <g opacity="0.92">
    <path d="M44 9 V44 A12 12 0 0 1 32 56 H27" fill="none" stroke="${C.birch}" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="32" cy="24" r="12" fill="none" stroke="${C.resin}" stroke-width="6"/>
    <circle cx="23" cy="56" r="6" fill="${C.birch}"/>
  </g>
  <g fill="${C.lichen}"><circle cx="32" cy="24" r="0.7"/><circle cx="32" cy="44" r="0.7"/></g>
</svg>`;
}

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function grove(w, h) {
  const r = rand(7);
  const near = [];
  const far = [];
  let x = -10;
  while (x < w) {
    const width = 9 + r() * 16;
    near.push([x, x + width]);
    x += width + 38 + r() * 70;
  }
  x = 6;
  while (x < w) {
    const width = 4 + r() * 7;
    far.push([x, x + width]);
    x += width + 14 + r() * 26;
  }
  const inBand = (bands, px) => bands.some(([a, b]) => px >= a && px <= b);
  const step = 7;
  const dots = [];
  const horizon = h * 0.66;
  const glowX = w * 0.64;
  for (let y = step / 2; y < h; y += step) {
    for (let px = step / 2; px < w; px += step) {
      const t = Math.min(1, y / horizon);
      const glow = Math.exp(-(((px - glowX) / (w * 0.42)) ** 2) - (((y - horizon) / (h * 0.32)) ** 2));
      let b = y < horizon ? 0.02 + 0.32 * t ** 3 + 0.66 * glow : 0.22 + 0.5 * glow * (1 - (y - horizon) / (h - horizon));
      if (inBand(far, px) && y > h * 0.12) b *= 0.38;
      if (inBand(near, px)) b = 0;
      const radius = (step / 2) * Math.sqrt(Math.max(0, b)) * 0.95;
      if (radius > 0.75) dots.push(`<circle cx="${px.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(2)}"/>`);
    }
  }
  const tied = near[3] ?? near[1];
  const tieY = h * 0.5;
  const tie = `<rect x="${(tied[0] - 3).toFixed(1)}" y="${tieY}" width="${(tied[1] - tied[0] + 6).toFixed(1)}" height="10" rx="2.5" fill="${C.resin}"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="${w}" height="${h}" fill="${C.canvas}"/>
  <g fill="${C.birch}" opacity="0.86">${dots.join("")}</g>
  ${tie}
  <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.7" stop-color="${C.canvas}" stop-opacity="0"/><stop offset="1" stop-color="${C.canvas}" stop-opacity="0.92"/></linearGradient>
  <rect width="${w}" height="${h}" fill="url(#shade)"/>
</svg>`;
}

function enamelPin() {
  return `<svg viewBox="0 0 200 200" width="190" height="190" aria-hidden="true">
  <defs>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F3CF7E"/><stop offset="0.5" stop-color="#C98F32"/><stop offset="1" stop-color="#F0C46A"/>
    </linearGradient>
    <radialGradient id="enamel" cx="0.38" cy="0.32" r="0.8">
      <stop offset="0" stop-color="#1E352D"/><stop offset="1" stop-color="#0F1C18"/>
    </radialGradient>
    <filter id="drop" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#3A2E1A" flood-opacity="0.35"/>
    </filter>
  </defs>
  <g filter="url(#drop)">
    <circle cx="100" cy="100" r="78" fill="url(#rim)"/>
    <circle cx="100" cy="100" r="71" fill="url(#enamel)"/>
    <circle cx="100" cy="100" r="71" fill="none" stroke="#7A5A22" stroke-width="1"/>
  </g>
  <g transform="translate(58 55) scale(1.3)">
    <path d="M44 9 V44 A12 12 0 0 1 32 56 H27" fill="none" stroke="url(#rim)" stroke-width="6" stroke-linejoin="round" transform="translate(0 -3)"/>
    <circle cx="32" cy="21" r="12" fill="none" stroke="${C.resin}" stroke-width="6"/>
    <circle cx="23" cy="53" r="6" fill="url(#rim)"/>
  </g>
  <ellipse cx="74" cy="62" rx="26" ry="9" fill="#FFFFFF" opacity="0.07" transform="rotate(-28 74 62)"/>
</svg>`;
}

const terminal = `<div class="term">
  <div class="term-bar"><span></span><span></span><span></span><b>~/acme-shop</b></div>
  <pre><span class="dim">$</span> git grove status
<span class="dim">acme-shop, trunk main, 4 worktrees, 0.3 s</span>

Needs you
 <span class="ember">✖</span> feat/coupons-model  History rewritten
                     <span class="dim">3 commits kept at</span>
                     <span class="resin">refs/grove/pins/…/T173014Z</span>
                     git grove restore …

<span class="dim">$</span> git grove restore feat/coupons-model
restored, <span class="moss">3 commits back</span></pre>
</div>`;

const chip = (glyph, cls, label) => `<span class="chip"><i class="${cls}">${glyph}</i>${label}</span>`;

const swatch = (name, hex, role, dark = true) =>
  `<div class="sw" style="background:${hex};color:${dark ? C.birch : C.spruce}"><b>${name}</b><span>${role}</span><code>${hex}</code></div>`;

const panels = [
  `<section class="p cover">
    <div class="cover-mark">${mark({ size: 132 })}</div>
    <div class="wordmark">git grove</div>
    <p class="foot">Brand guide, first draft</p>
  </section>`,
  `<section class="p build">
    ${construction()}
    <ul class="legend">
      <li><i style="background:${C.resin}"></i>Pin: the old tip, kept</li>
      <li><i style="background:${C.birch}"></i>Branch: history back to its base</li>
      <li><i class="hollow"></i>Drawn on a 4-unit grid</li>
    </ul>
  </section>`,
  `<section class="p app">${terminal}</section>`,
  `<section class="p essence">
    <h2>Watches every branch.<br>Acts only when asked.</h2>
    <p>A seatbelt for parallel git work.</p>
  </section>`,
  `<section class="p colors">
    ${swatch("Spruce", C.spruce, "Ground")}
    ${swatch("Resin", C.resin, "The pin", false)}
    ${swatch("Birch", C.birch, "Text", false)}
    ${swatch("Lichen", C.lichen, "Quiet", false)}
    ${swatch("Ember", C.ember, "Loses work", false)}
    ${swatch("Moss", C.moss, "Safe", false)}
  </section>`,
  `<section class="p type">
    <div class="spec-mono">Aa</div>
    <div class="spec-rows">
      <div><b class="mono">Martian Mono</b><span>Commands, refs, the wordmark</span></div>
      <div><b class="sans">Atkinson Hyperlegible Next</b><span>Everything people read</span></div>
      <div class="mono sample">refs/grove/pins/feat/coupons-ui</div>
    </div>
  </section>`,
  `<section class="p object">
    ${enamelPin()}
    <div class="sticker"><span class="mono">npx git-grove</span></div>
  </section>`,
  `<section class="p image">${grove(520, 320)}<p class="caption">Every tree staked, none pruned</p></section>`,
  `<section class="p system">
    <div class="chips">
      ${chip("✖", "ember", "Loses work")}
      ${chip("▲", "resin", "Needs action")}
      ${chip("◷", "lichen", "Waiting on review")}
      ${chip("○", "dim", "Idle")}
    </div>
    <div class="tree mono">
      <div class="feat">coupons</div>
      <div><span class="dim">├</span> 01 coupons-model <em class="moss">● in sync</em></div>
      <div><span class="dim">└</span> 02 coupons-ui <em class="resin">▲ parent moved</em></div>
    </div>
    <div class="icons">
      <div class="icon i72">${mark({ size: 50 })}</div>
      <div class="icon i40">${mark({ size: 28 })}</div>
      <div class="icon i20">${mark({ size: 15 })}</div>
      <div class="cmd"><span class="dim">$</span> npm i -g git-grove</div>
    </div>
  </section>`,
];

const css = `
*{box-sizing:border-box;margin:0}
body{background:#060A09;color:${C.birch};font:15px/1.4 "Atkinson Hyperlegible Next",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px}
.board{width:1600px;height:1000px;background:${C.canvas};display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);gap:14px;padding:28px;border-radius:6px}
.p{position:relative;background:${C.spruce};border-radius:10px;overflow:hidden;padding:26px;counter-increment:page}
.p::after{content:counter(page,decimal-leading-zero);position:absolute;right:18px;bottom:14px;font:500 11px "Martian Mono",monospace;color:${C.lichen};opacity:.6}
.board{counter-reset:page}
.mono{font-family:"Martian Mono",monospace}
.dim{color:${C.lichen}} .ember{color:${C.ember}} .resin{color:${C.resin}} .moss{color:${C.moss}} .lichen{color:${C.lichen}}
.cover{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:18px;padding-left:44px}
.wordmark{font:500 46px/1 "Martian Mono",monospace;letter-spacing:-.02em}
.foot{position:absolute;left:26px;bottom:14px;font-size:12px;color:${C.lichen}}
.build{display:flex;align-items:center;gap:22px}
.legend{list-style:none;padding:0;display:grid;gap:12px;font-size:14px;color:${C.birch}}
.legend li{display:flex;gap:10px;align-items:center}
.legend i{width:12px;height:12px;border-radius:50%;flex:none}
.legend i.hollow{border:1.5px dashed ${C.lichen}}
.app{padding:18px 18px 34px;display:grid;place-items:center;background:${C.spruceHi}}
.term{width:100%;height:100%;background:#0C1613;border:1px solid ${C.rule};border-radius:8px;overflow:hidden}
.term-bar{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid ${C.rule}}
.term-bar span{width:9px;height:9px;border-radius:50%;background:${C.rule}}
.term-bar b{margin-left:auto;margin-right:auto;font:500 11px "Martian Mono",monospace;color:${C.lichen};transform:translateX(-14px)}
.term pre{font:400 11.2px/1.5 "Martian Mono",monospace;padding:10px 14px;color:${C.birch};white-space:pre}
.essence{display:flex;flex-direction:column;justify-content:center;padding:34px 40px}
.essence h2{font:700 33px/1.18 "Atkinson Hyperlegible Next",sans-serif;letter-spacing:-.01em}
.essence p{margin-top:16px;color:${C.lichen};font-size:16px}
.colors{display:grid;grid-template-columns:1.1fr 1.15fr .95fr .85fr 1.05fr .8fr;gap:0;padding:0}
.sw{display:flex;flex-direction:column;justify-content:flex-end;padding:14px 12px 30px;gap:2px;font-size:12px}
.sw b{font-size:14px}
.sw span{white-space:nowrap}
.sw code{font:500 10.5px "Martian Mono",monospace;opacity:.75}
.colors .sw:first-child{background:repeating-linear-gradient(135deg,${C.spruce} 0 10px,${C.spruceHi} 10px 11px)!important}
.type{display:flex;align-items:center;gap:26px}
.spec-mono{font:500 118px/1 "Martian Mono",monospace;letter-spacing:-.04em;color:${C.birch}}
.spec-rows{display:grid;gap:14px}
.spec-rows div{display:grid;gap:2px}
.spec-rows b{font-size:16px;font-weight:600}
.spec-rows b.mono{font-weight:500;font-size:15px}
.spec-rows span{font-size:13px;color:${C.lichen}}
.spec-rows .sample{font-size:12px;color:${C.resin}}
.object{background:#E7E0CE;display:flex;align-items:center;justify-content:center;gap:28px;background-image:radial-gradient(circle at 30% 30%,#F1EBDC,#DCD3BE)}
.object.p::after{color:#5F6F66}
.sticker{background:${C.spruce};color:${C.birch};padding:12px 16px;border-radius:999px;transform:rotate(-6deg);box-shadow:0 6px 14px rgba(58,46,26,.25);font-size:14px}
.image{padding:0}
.image svg{width:100%;height:100%;display:block}
.caption{position:absolute;left:22px;bottom:14px;z-index:1;font-size:13px;color:${C.birch};opacity:.85}
.system{display:grid;grid-template-rows:auto 1fr auto;gap:16px;padding-bottom:34px}
.tree{align-self:center;display:grid;gap:7px;font-size:12.5px;padding:12px 14px;border:1px solid ${C.rule};border-radius:8px;background:#0E1A16}
.tree .feat{color:${C.birch};font-weight:700}
.tree em{font-style:normal;margin-left:10px;font-size:11.5px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 10px;border:1px solid ${C.rule};border-radius:999px;font-size:13px;background:#0E1A16}
.chip i{font-style:normal;font-size:12px}
.icons{display:flex;align-items:flex-end;gap:16px}
.icon{display:grid;place-items:center;background:${C.spruceHi};border:1px solid ${C.rule}}
.i72{width:72px;height:72px;border-radius:18px}
.i40{width:40px;height:40px;border-radius:10px}
.i20{width:22px;height:22px;border-radius:6px}
.cmd{margin-left:auto;font:500 13px "Martian Mono",monospace;padding:10px 14px;border-radius:8px;background:#0C1613;border:1px solid ${C.rule}}
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>git grove, brand guide</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;600;700&family=Martian+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${css}</style></head><body><main class="board">${panels.join("\n")}</main></body></html>`;

writeFileSync(new URL("./brand-kit.html", import.meta.url), html);
writeFileSync(new URL("./mark.svg", import.meta.url), mark({ size: 64 }).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
writeFileSync(
  new URL("./mark-light.svg", import.meta.url),
  mark({ size: 64, ink: C.spruce }).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '),
);
console.log("wrote brand-kit.html, mark.svg, mark-light.svg");
