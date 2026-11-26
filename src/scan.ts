// Bubbi scans the group: a short show right after the chat is uploaded (about 4 seconds, skippable).
// It counts the chat, then pops real findings one by one: a couple open for free, most of them locked.
// It always ends with "start playing, free" as the big button, so nobody thinks the game itself is paid.
// Everything is computed on the phone; nothing leaves it.

export type Finding = { e: string; t: string; v: string; free?: boolean };
export type ScanCtx = {
  msgs: number; days: number; people: number; total: number; price: string; was?: string;
  lines: string[]; findings: Finding[];
  buddy: (mood: string, size: number) => string; budCss: string;
  buy: () => void; more: () => void; bump: (k: string) => void;
};

let OPEN: HTMLElement | null = null;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (n: number) => Math.round(n).toLocaleString("he-IL");

export function openScan(c: ScanCtx) {
  if (OPEN) return;
  try { c.bump("pm_scan"); } catch {}
  const host = document.createElement("div"); host.className = "pm-layer pms"; document.body.append(host); OPEN = host;
  const sr = host.attachShadow({ mode: "open" });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const locked = c.findings.filter((f) => !f.free).length;
  const bubbles = c.lines.slice(0, 14).map((t, i) => `<div class="mb ${i % 3 === 0 ? "me" : ""}" style="--i:${i}"><i></i><span>${esc(t)}</span></div>`).join("");
  sr.innerHTML = `<style>${c.budCss}${CSS}</style>
  <div class="sc ${reduce ? "rm" : ""}" role="dialog" aria-modal="true" aria-label="בובי סורק את הקבוצה">
    <div class="glow" aria-hidden="true"></div>
    <button class="skip" id="skip" type="button">דילוג ←</button>
    <div class="phase p1" id="p1">
      <div class="head">${c.buddy("think", 62)}<div><b>בובי סורק את הקבוצה…</b><small id="st">קורא הודעות</small></div></div>
      <div class="scr" aria-hidden="true"><div class="feed">${bubbles}${bubbles}</div><div class="beam"></div><div class="grid"></div></div>
      <div class="cnt"><div><b id="c1">0</b><small>הודעות</small></div><div><b id="c2">0</b><small>ימים</small></div><div><b id="c3">0</b><small>אנשים</small></div></div>
      <div class="bar"><i id="bar"></i></div>
    </div>
    <div class="phase p2" id="p2" hidden>
      <div class="found"><span class="bud2">${c.buddy("shock", 70)}</span><div><small>הסריקה הסתיימה</small><b>בובי מצא <em id="tot">0</em> דברים על הקבוצה שלכם</b></div></div>
      <ul class="fl" id="fl">${c.findings.map((f, i) => `<li class="${f.free ? "free" : "lk"}" style="--i:${i}" ${f.free ? "" : 'role="button" tabindex="0"'}><em>${f.e}</em><span class="tt">${esc(f.t)}</span><span class="vv">${f.free ? esc(f.v) : `<span class="bl">${esc(f.v)}</span>`}</span><span class="tag">${f.free ? "חינם" : "🔒"}</span></li>`).join("")}
        ${c.total > c.findings.length ? `<li class="lk more" style="--i:${c.findings.length}" role="button" tabindex="0"><em>➕</em><span class="tt">ועוד ${fmt(c.total - c.findings.length)} דברים, תיק סודי לכל אחד וסבב סודות במשחק</span><span class="tag">🔒</span></li>` : ""}</ul>
      <div class="cta" id="cta">
        <button class="play" id="play" type="button">🎮 מתחילים לשחק <span>חינם</span></button>
        ${c.was ? `<div class="bf">🖤 בלאק פריידיי · <b>${esc(c.price)} ₪</b> במקום <s>${esc(c.was)} ₪</s></div>` : ""}
        <button class="gold" id="buy" type="button"><span>🔓 לפתוח את כל ה־${fmt(c.total)} ב־${esc(c.price)} ₪</span></button>
        <button class="link" id="more" type="button">מה עוד יש בפרימיום?</button>
      </div>
    </div>
  </div>`;

  const $ = (id: string) => sr.getElementById(id) as HTMLElement;
  const timers: number[] = []; const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
  let ac: AudioContext | null = null;
  try { ac = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch {}
  const tone = (f: number, d = .08, v = .05, type: OscillatorType = "sine", f2?: number) => { if (!ac) return; try { const t = ac.currentTime + .01, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + .03); } catch {} };
  const vib = (p: number | number[]) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  const count = (el: HTMLElement, to: number, ms: number) => { const t0 = performance.now(); const step = (t: number) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e); if (k < 1 && OPEN) requestAnimationFrame(step); }; requestAnimationFrame(step); };

  let done = false;
  const finish = () => {
    if (done) return; done = true; timers.forEach(clearTimeout);
    $("p1").hidden = true; $("p2").hidden = false; $("skip").hidden = true;
    const items = [...sr.querySelectorAll<HTMLElement>("#fl li")];
    if (reduce) { items.forEach((li) => li.classList.add("in")); $("tot").textContent = fmt(c.total); $("cta").classList.add("in"); return; }
    tone(660, .12, .07, "triangle"); tone(990, .2, .05, "triangle"); vib(25);
    count($("tot"), c.total, 900);
    items.forEach((li, i) => later(() => { li.classList.add("in"); if (li.classList.contains("free")) { tone(880, .1, .06, "triangle", 1320); vib(8); } else { tone(420 + i * 30, .09, .05, "square", 300 + i * 20); vib(5); } }, 250 + i * 230));
    later(() => { $("cta").classList.add("in"); [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, .35, .05, "triangle"), i * 70)); }, 300 + items.length * 230);
  };
  const close = () => { if (!OPEN) return; timers.forEach(clearTimeout); sr.querySelector(".sc")!.classList.add("out"); OPEN = null; setTimeout(() => { host.remove(); try { ac && ac.close(); } catch {} }, 230); };

  $("skip").onclick = () => { try { c.bump("pm_scan_skip"); } catch {} finish(); };
  $("play").onclick = () => { try { c.bump("pm_scan_play"); } catch {} close(); };
  $("buy").onclick = () => { try { c.bump("pm_scan_buy"); } catch {} close(); setTimeout(c.buy, 240); };
  $("more").onclick = () => { try { c.bump("pm_scan_more"); } catch {} close(); setTimeout(c.more, 240); };
  sr.querySelectorAll<HTMLElement>("#fl li.lk").forEach((li) => { const go = () => { try { c.bump("pm_scan_item"); } catch {} li.classList.add("shake"); setTimeout(() => { close(); setTimeout(c.buy, 240); }, 260); }; li.onclick = go; li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; });

  if (reduce) { finish(); return; }
  // the scan: counters run, messages fly past the beam, a blip on every step
  count($("c1"), c.msgs, 1700); count($("c2"), c.days, 1500); count($("c3"), c.people, 1100);
  later(() => ($("bar").style.width = "100%"), 30);
  const steps = ["קורא הודעות", "מחפש מי מדבר עם מי", "בודק מי מתעלם ממי", "מוצא את ההודעות שנמחקו", "מסכם"];
  steps.forEach((t, i) => later(() => { $("st").textContent = t; tone(1200 + i * 120, .05, .03, "square"); }, i * 380));
  for (let i = 0; i < 9; i++) later(() => tone(1800 + Math.random() * 600, .03, .015), 100 + i * 190);
  later(finish, 1950);
}

const CSS = `
:host{all:initial}
.sc{position:fixed;inset:0;z-index:2147481500;direction:rtl;font-family:"Varela Round",system-ui,sans-serif;color:#fff;display:flex;justify-content:center;overflow-y:auto;
  background:radial-gradient(110% 70% at 50% 0%,#3b2a8f 0%,#1a1236 55%,#0f0a22 100%);animation:in .25s cubic-bezier(.23,1,.32,1) both;-webkit-tap-highlight-color:transparent}
.sc.out{animation:out .2s ease-out forwards}
.glow{position:fixed;left:50%;top:-20vh;width:120vw;height:60vh;margin-left:-60vw;background:radial-gradient(closest-side,#7b5cff55,transparent);pointer-events:none}
.skip{position:fixed;top:calc(12px + env(safe-area-inset-top));left:14px;z-index:3;font:inherit;font-size:.85rem;font-weight:700;color:#d8cffa;background:#ffffff14;border:1.5px solid #ffffff30;border-radius:99px;padding:7px 13px;cursor:pointer}
.phase{position:relative;width:min(440px,100%);box-sizing:border-box;padding:calc(56px + env(safe-area-inset-top)) 18px calc(22px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px}
.phase[hidden]{display:none}
.head{display:flex;align-items:center;gap:10px}.head b{display:block;font-size:1.25rem}.head small{display:block;font-size:.88rem;color:#3fe0b0;font-weight:700;min-height:1.2em}
.scr{position:relative;height:min(42vh,330px);border-radius:24px;border:3px solid #ffffff2a;background:#0c0820;overflow:hidden;box-shadow:inset 0 0 40px #7b5cff33}
.feed{position:absolute;inset-inline:12px;top:0;display:grid;gap:8px;padding-top:12px;animation:feed 2.2s linear forwards}
.mb{display:flex;gap:6px;align-items:center;max-width:82%;justify-self:start;background:#ffffff14;border-radius:14px 14px 14px 4px;padding:7px 10px;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mb.me{justify-self:end;background:#7b5cff55;border-radius:14px 14px 4px 14px}
.mb i{flex:none;width:16px;height:16px;border-radius:50%;background:#ffd23f}.mb.me i{background:#3fe0b0}
.mb span{overflow:hidden;text-overflow:ellipsis}
.beam{position:absolute;inset-inline:0;height:70px;top:-70px;background:linear-gradient(180deg,transparent,#3fe0b044 70%,#3fe0b0);box-shadow:0 2px 18px #3fe0b0;animation:beam 1s cubic-bezier(.45,0,.55,1) infinite alternate}
.grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:22px 22px;pointer-events:none}
.cnt{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.cnt div{background:#ffffff10;border:1.5px solid #ffffff22;border-radius:16px;padding:8px 4px;text-align:center}
.cnt b{display:block;font-family:Karantina,sans-serif;font-size:2.1rem;line-height:1;color:#ffd23f;font-variant-numeric:tabular-nums}.cnt small{font-size:.75rem;color:#c9bfff}
.bar{height:8px;border-radius:99px;background:#ffffff18;overflow:hidden}.bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#3fe0b0,#ffd23f);transition:width 1.9s cubic-bezier(.4,0,.2,1)}
.found{display:flex;align-items:center;gap:10px;animation:pop .45s cubic-bezier(.34,1.56,.64,1) both}
.found small{display:block;font-size:.8rem;font-weight:700;color:#3fe0b0}.found b{display:block;font-size:1.3rem;line-height:1.25}
.found em{font-style:normal;font-family:Karantina,sans-serif;font-size:2.2rem;color:#ffd23f;line-height:.8}
.fl{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.fl li{display:grid;grid-template-columns:30px 1fr auto;grid-template-rows:auto auto;column-gap:8px;align-items:center;background:#ffffff10;border:1.5px solid #ffffff24;border-radius:16px;padding:9px 11px;opacity:0;transform:translateY(12px) scale(.97);transition:opacity .25s ease-out,transform .35s cubic-bezier(.34,1.56,.64,1)}
.fl li.in{opacity:1;transform:none}
.fl li em{grid-row:1/3;font-style:normal;font-size:1.35rem;text-align:center}
.fl .tt{font-size:.8rem;font-weight:700;color:#c9bfff}.fl .vv{grid-column:2;font-size:.98rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fl .tag{grid-row:1/3;grid-column:3;font-size:.72rem;font-weight:700;border-radius:99px;padding:3px 9px}
.fl li.free{border-color:#3fe0b066;background:#3fe0b012}.fl li.free .tag{background:#3fe0b0;color:#1d1636}
.fl li.lk{cursor:pointer}.fl li.lk .tag{background:#ffd23f;color:#1d1636;font-size:.85rem;padding:3px 7px}
.fl li.more .tt{grid-row:1/3;color:#fff;font-size:.88rem}
.bl{filter:blur(6px);user-select:none;-webkit-user-select:none}
.fl li.shake{animation:shk .26s ease-in-out}
.cta{display:grid;gap:8px;margin-top:4px;opacity:0;transform:translateY(10px);transition:opacity .3s ease-out,transform .35s cubic-bezier(.23,1,.32,1);position:sticky;bottom:0;padding:10px 0 2px;background:linear-gradient(180deg,#0f0a2200,#0f0a22 30%)}
.cta.in{opacity:1;transform:none}
.cta button{font:inherit;font-weight:700;cursor:pointer;border-radius:18px;transition:transform .12s ease-out,box-shadow .12s ease-out}
.play{font-size:1.25rem;color:#1d1636;background:linear-gradient(180deg,#5ff0c4,#2fd3a0);border:3.5px solid #1d1636;padding:15px;box-shadow:0 6px 0 #1d1636}
.play span{display:inline-block;margin-inline-start:6px;font-size:.85rem;background:#1d1636;color:#3fe0b0;border-radius:99px;padding:2px 9px;vertical-align:middle}
.play:active,.gold:active{transform:translateY(4px);box-shadow:0 2px 0 #1d1636}
.gold{position:relative;overflow:hidden;font-size:1.02rem;color:#1d1636;background:linear-gradient(180deg,#ffe783,#ffc21f);border:3px solid #1d1636;padding:12px;box-shadow:0 5px 0 #1d1636}
.gold::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,#ffffffaa 48%,transparent 60%);background-size:250% 100%;animation:sheen 2.6s ease-in-out infinite}
.gold span{position:relative;z-index:1}
.bf{justify-self:center;font-size:.9rem;font-weight:700;background:#0b0b0f;color:#fff;border:1.5px solid #ffd23f;border-radius:99px;padding:5px 12px}.bf b{color:#ffd23f}.bf s{opacity:.6;text-decoration-color:#ff3d7f}
.link{background:none;border:0;color:#d8cffa;font-size:.9rem;padding:6px}
@keyframes in{from{opacity:0}}@keyframes out{to{opacity:0;transform:scale(1.02)}}
@keyframes feed{to{transform:translateY(-50%)}}
@keyframes beam{to{top:calc(100% - 0px)}}
@keyframes pop{from{opacity:0;transform:scale(.8)}}
@keyframes shk{25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
@keyframes sheen{0%,25%{background-position:120% 0}70%,100%{background-position:-60% 0}}
.rm *,.rm{animation:none!important;transition:none!important}
`;
