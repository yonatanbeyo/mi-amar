// The premium pass: one full-screen page that shows, in the best light, what premium adds on top of the free game.
// It always says clearly that the regular game is free. Opened from the home page, the setup screen and the premium panel.
// Everything it shows comes from numbers already computed on the phone; nothing leaves the phone.

export type PassCtx = {
  on: boolean; hasChat: boolean; price: string; priceAfter: string; launch: boolean; daysLeft: number;
  secrets: number; slides: number; people: number; media: number; group: string;
  each: null | { e: string; people: number; thing: string };
  buddy: (mood: string, size: number) => string; budCss: string;
  buy: () => void; pick: () => void; peek?: (() => void) | null; wrapped: () => void; bump: (k: string) => void;
};

let OPEN: HTMLElement | null = null;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (n: number) => Math.round(n).toLocaleString("he-IL");

export function openPass(c: PassCtx, from = "") {
  if (OPEN) return;
  try { c.bump("pm_pass"); if (from) c.bump("pm_pass_" + from); } catch {}
  const host = document.createElement("div"); host.className = "pm-layer pmp"; document.body.append(host); OPEN = host;
  const sr = host.attachShadow({ mode: "open" });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const n = (x: number, alt: string) => (c.hasChat && x > 0 ? fmt(x) : alt);
  const feats: { k: string; t: string; s: string; chip: string; prev: string }[] = [
    { k: "wr", t: "🎁 סיכום השנה של הקבוצה", s: "כמו של ספוטיפיי, רק על החברים שלכם. עם מוזיקה, אנימציות ושקופיות מוכנות לסטורי.", chip: `${n(c.slides, "20+")} שקופיות`,
      prev: `<div class="ph"><div class="bars"><i></i><i></i><i></i></div><div class="fr f1"><small>מלך הסטיקרים</small><b>???</b><em>142 סטיקרים</em></div><div class="fr f2"><small>נעלם מהקבוצה</small><b class="big">87</b><em>ימים בלי מילה</em></div><div class="fr f3"><small>האבחנה של בובי</small><b class="emo">🦉</b><em>קבוצת הינשופים</em></div></div>` },
    { k: "md", t: "🎬 סבב המדיה", s: "הסרטונים, התמונות, ההקלטות והסטיקרים האמיתיים של הקבוצה, על כל הטלפונים. מי שלח את זה?", chip: c.media ? `${fmt(c.media)} פריטים מהצ'אט` : "צריך ייצוא עם מדיה",
      prev: `<div class="vid"><div class="vf"><span class="vb"></span><span class="play">▶︎</span></div><div class="wave">${Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div><div class="vq">מי שלח את ההקלטה? 🎙️</div></div>` },
    { k: "sc", t: "🔒 סבב הסודות", s: "שאלות שאין במשחק הרגיל: מי מתעלם ממי, מי מת על מי, מי מחק הכי הרבה הודעות.", chip: `${n(c.secrets, "מלא")} סודות נמצאו`,
      prev: `<div class="file"><span class="tab">תיק מס׳ 007</span><i class="rd"></i><i class="rd r2"></i><i class="rd r3"></i><span class="stamp">מסווג</span></div><div class="sq">מי מתעלם הכי הרבה מנועה? 😬</div>` },
    { k: "ds", t: "📁 תיק סודי לכל אחד", s: "כל שחקן מקבל לטלפון את התיק שלו: מי מזכיר אותו, מי מתעלם ממנו וההודעה הכי מביכה שלו.", chip: `${n(c.people, "לכל")} תיקים`,
      prev: `<div class="dos"><small>סודי ביותר</small><b>התיק של דניאל</b><p><span class="un">דניאל</span> כתב את השם שלך <span class="un">214</span> פעמים 😳</p><i class="ln"></i><i class="ln l2"></i></div>` },
    { k: "ct", t: "🎓 תעודה לכל שחקן", s: "בסוף המשחק כל אחד מקבל תואר מצחיק מבוסס על איך שהוא כותב. מוכן לסטורי.", chip: "תואר אישי",
      prev: `<div class="cert"><small>תעודה רשמית</small><b>ערפד מוסמך</b><em>🧛 כותב רק אחרי חצות</em><span class="seal">✓</span></div>` },
    { k: "dg", t: "🩺 האבחנה של הקבוצה", s: "בובי מחליט איזה סוג קבוצה אתם, עם מדדי דרמה, חפירה, לילה וצחוק. בואו נראה מי יתווכח.", chip: "רק לקבוצה שלכם",
      prev: `<div class="dg"><b>🎭 אופרת הסבון</b>${[["🔥 דרמה", 88], ["🗣️ חפירה", 64], ["🌙 לילה", 72], ["😂 צחוק", 51]].map((m, i) => `<div class="m" style="--v:${m[1]}%;--i:${i}"><span>${m[0]}</span><i><b></b></i></div>`).join("")}</div>` },
  ];
  const rows: [string, string, string][] = [
    ["המשחק המלא: מי אמר את זה, השלם את המשפט ועוד 8 סוגי שאלות", "✓", "✓"],
    ["כל אחד משחק מהטלפון שלו", "✓", "✓"],
    ["בלי הגבלה על מספר המשחקים", "✓", "✓"],
    ["סיכום השנה של הקבוצה", "3 שקופיות", "הכל"],
    ["סבב המדיה", "", "✓"],
    ["סבב הסודות", "", "✓"],
    ["תיק סודי לכל אחד", "", "✓"],
    ["תעודה לכל שחקן", "", "✓"],
    ["האבחנה והתחזיות של בובי", "", "✓"],
  ];
  const cta = c.on ? "🎁 לראות את הסיכום עכשיו" : c.hasChat ? `לפתוח לכל הקבוצה ב־${c.price} ₪` : "מעלים צ'אט ומגלים ✨";
  const cardTitle = c.hasChat ? (c.on ? "הכל פתוח לקבוצה הזאת" : `בובי מצא ${fmt(Math.max(c.secrets, 6))} סודות`) : "כל הסודות של הקבוצה";
  sr.innerHTML = `<style>${c.budCss}${CSS}</style>
  <div class="pp ${reduce ? "rm" : ""}" role="dialog" aria-modal="true" aria-label="מה יש בפרימיום">
    <div class="bg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><div class="stars"></div></div>
    <div class="scr">
      <div class="top"><button class="x" id="x" aria-label="סגירה">✕</button><span class="pill">⭐ פרימיום · תוספת לא חובה</span></div>

      <section class="hero">
        <div class="tilt" id="tilt"><div class="card">
          <div class="foil"></div>
          <div class="c-top"><span>כרטיס זהב</span><span>${esc(c.group || "הקבוצה שלכם")}</span></div>
          <div class="c-mid"><div class="c-bud">${c.buddy("party", 92)}</div><b>${esc(cardTitle)}</b><small>${c.on ? "תהנו 🎉" : "פעם אחת · לכל הקבוצה · לתמיד"}</small></div>
          <div class="c-row"><span>🎁</span><span>🎬</span><span>🔒</span><span>📁</span><span>🎓</span><span>🩺</span></div>
          <div class="c-code" aria-hidden="true">${Array.from({ length: 34 }, (_, i) => `<i style="width:${[1, 2, 3, 1, 2, 1, 4][i % 7]}px"></i>`).join("")}</div>
        </div></div>
        <h1><span class="free">המשחק חינמי.</span><span class="gold">הפרימיום הוא הקינוח.</span></h1>
        <p class="lead">כל מה שיש במשחק הרגיל נשאר <b>בחינם, לתמיד</b>. הפרימיום מוסיף לקבוצה שלכם עוד 6 חוויות שאין בשום מקום אחר.</p>
      </section>

      <section class="feats" aria-label="מה מקבלים">
        <div class="rail" id="rail">${feats.map((f, i) => `<article class="f f-${f.k}" style="--i:${i}"><div class="pv">${f.prev}</div><span class="chip">${esc(f.chip)}</span><h3>${f.t}</h3><p>${f.s}</p></article>`).join("")}</div>
        <div class="dots" id="dots">${feats.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>
      </section>

      <section class="cmp">
        <h2>מה חינם ומה בפרימיום?</h2>
        <div class="tbl" role="table">
          <div class="tr th" role="row"><span role="columnheader"></span><span role="columnheader" class="cf">חינם</span><span role="columnheader" class="cp">⭐ פרימיום</span></div>
          ${rows.map((r, i) => `<div class="tr ${r[1] ? "" : "pz"}" role="row" style="--i:${i}"><span role="cell">${r[0]}</span><span role="cell" class="cf">${r[1] ? (r[1] === "✓" ? `<em class="ok">✓</em>` : `<small>${r[1]}</small>`) : `<em class="no">—</em>`}</span><span role="cell" class="cp">${r[2] === "✓" ? `<em class="ok g">✓</em>` : `<small class="g">${r[2]}</small>`}</span></div>`).join("")}
        </div>
        <p class="note">אין מנוי ואין חיוב חוזר. אם לא משלמים, פשוט משחקים בחינם כמו תמיד.</p>
      </section>

      ${c.on ? "" : `<section class="price">
        ${c.launch ? `<span class="launch">🚀 מחיר השקה${c.daysLeft <= 20 ? `, נשארו ${fmt(c.daysLeft)} ימים` : " עד 31.12"}</span>` : ""}
        <div class="pr"><b>${c.price}<small>₪</small></b>${c.launch ? `<s>${c.priceAfter} ₪</s>` : ""}</div>
        <p class="once">תשלום אחד. כל הקבוצה. לתמיד.</p>
        ${c.each ? `<div class="each"><b>רק ${c.each.e} ₪ לכל אחד</b><span>${fmt(c.each.people)} אנשים בקבוצה. ${esc(c.each.thing)} 🍬</span></div>` : `<div class="each"><b>בקבוצה של 6, זה 2.49 ₪ לכל אחד</b><span>פחות מבמבה 🍬</span></div>`}
        <ul class="trust"><li>✓ אחד משלם, וכולם מקבלים הכל, גם בטלפונים של החברים</li><li>✓ הצ'אט לא יוצא מהטלפון. אף אחד לא רואה אותו</li><li>✓ לא נפתח תוך 48 שעות? הכסף חוזר</li></ul>
      </section>`}
      <div class="pad"></div>
    </div>
    <div class="dock">
      <button class="go" id="go"><span>${esc(cta)}</span></button>
      <div class="alts">${c.peek ? `<button class="free-b" id="peek">👀 3 שקופיות בחינם</button><i></i>` : ""}<button class="free-b" id="free">${c.on ? "סגירה" : c.hasChat ? "משחקים בחינם" : "לנסות קודם בחינם"}</button></div>
    </div>
  </div>`;

  const root = sr.querySelector(".pp") as HTMLElement;
  const close = () => { if (!OPEN) return; root.classList.add("out"); OPEN = null; setTimeout(() => host.remove(), 230); document.removeEventListener("keydown", key); };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", key);
  sr.getElementById("x")!.onclick = close;
  sr.getElementById("free")!.onclick = () => { try { c.bump("pm_pass_free"); } catch {} close(); };
  const pk = sr.getElementById("peek"); if (pk) pk.onclick = () => { close(); setTimeout(() => c.peek && c.peek(), 240); };
  sr.getElementById("go")!.onclick = () => { try { c.bump("pm_pass_go"); } catch {} close(); setTimeout(() => (c.on ? c.wrapped() : c.hasChat ? c.buy() : c.pick()), 240); };

  // the feature rail: dots follow the swipe, and only the card in view animates
  const rail = sr.getElementById("rail")!, dots = [...sr.querySelectorAll("#dots i")], cards = [...rail.children] as HTMLElement[];
  const io = new IntersectionObserver((es) => es.forEach((e) => { const i = cards.indexOf(e.target as HTMLElement); e.target.classList.toggle("live", e.isIntersecting); if (e.isIntersecting && e.intersectionRatio > .6) dots.forEach((d, j) => d.classList.toggle("on", j === i)); }), { root: rail, threshold: [0, .6] });
  cards.forEach((el) => io.observe(el));
  // the table and the price slide in once they come into view (the whole table at once, row by row)
  const rows2 = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) return; const t = e.target as HTMLElement; (t.classList.contains("tbl") ? t.querySelectorAll(".tr") : [t]).forEach((x) => x.classList.add("in")); rows2.unobserve(t); }), { root: sr.querySelector(".scr"), threshold: .15 });
  sr.querySelectorAll(".tbl,.price,.cmp h2").forEach((el) => rows2.observe(el));

  // the golden card leans toward your finger
  const tilt = sr.getElementById("tilt") as HTMLElement;
  if (!reduce) {
    const mv = (x: number, y: number) => { const r = tilt.getBoundingClientRect(); const dx = (x - r.left) / r.width - .5, dy = (y - r.top) / r.height - .5; tilt.style.setProperty("--rx", `${(-dy * 16).toFixed(2)}deg`); tilt.style.setProperty("--ry", `${(dx * 18).toFixed(2)}deg`); tilt.style.setProperty("--gx", `${((dx + .5) * 100).toFixed(1)}%`); tilt.classList.add("hand"); };
    tilt.addEventListener("pointermove", (e) => mv(e.clientX, e.clientY));
    tilt.addEventListener("pointerleave", () => { tilt.classList.remove("hand"); tilt.style.removeProperty("--rx"); tilt.style.removeProperty("--ry"); });
  }

  // a short sparkle when it opens
  try {
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)(), t = ac.currentTime + .03, g = ac.createGain(); g.gain.value = .5; g.connect(ac.destination);
    [880, 1175, 1568, 2093].forEach((f, i) => { const o = ac.createOscillator(), v = ac.createGain(); o.type = "sine"; o.frequency.value = f; v.gain.setValueAtTime(0, t + i * .06); v.gain.linearRampToValueAtTime(.06, t + i * .06 + .01); v.gain.exponentialRampToValueAtTime(.0001, t + i * .06 + .5); o.connect(v); v.connect(g); o.start(t + i * .06); o.stop(t + i * .06 + .55); });
    setTimeout(() => ac.close().catch(() => {}), 1200);
  } catch {}
  try { navigator.vibrate && navigator.vibrate(12); } catch {}
}

const CSS = `
:host{all:initial}
.pp{position:fixed;inset:0;z-index:2147482000;direction:rtl;font-family:"Varela Round",system-ui,sans-serif;color:#fff;background:#0f0a22;animation:ppIn .28s cubic-bezier(.23,1,.32,1) both;-webkit-tap-highlight-color:transparent}
.pp.out{animation:ppOut .22s ease-out forwards}
.bg{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.bg i{position:absolute;width:70vmax;height:70vmax;border-radius:50%;filter:blur(60px);opacity:.55;animation:drift 14s ease-in-out infinite alternate}
.b1{background:#7b5cff;top:-30vmax;right:-20vmax}.b2{background:#ff3d7f;top:30vh;left:-35vmax;opacity:.32!important;animation-delay:-5s!important}.b3{background:#ffb800;bottom:-40vmax;right:-25vmax;opacity:.25!important;animation-delay:-9s!important}
.stars{position:absolute;inset:0;background-image:radial-gradient(1.5px 1.5px at 20% 30%,#fff9,transparent),radial-gradient(1px 1px at 70% 10%,#fff8,transparent),radial-gradient(1.5px 1.5px at 85% 60%,#fff7,transparent),radial-gradient(1px 1px at 40% 80%,#fff8,transparent),radial-gradient(1px 1px at 10% 70%,#fff6,transparent),radial-gradient(1.5px 1.5px at 55% 45%,#fff5,transparent);animation:tw 3s ease-in-out infinite alternate}
.scr{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.scr>*{max-width:480px;margin-inline:auto}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:calc(10px + env(safe-area-inset-top)) 16px 8px}
.x{width:42px;height:42px;border-radius:50%;border:2px solid #ffffff40;background:#ffffff14;color:#fff;font-size:1.05rem;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.pill{font-size:.78rem;font-weight:700;color:#ffd23f;background:#ffd23f1a;border:1.5px solid #ffd23f66;border-radius:99px;padding:5px 12px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.hero{padding:6px 20px 6px;text-align:center}
.tilt{--rx:0deg;--ry:0deg;--gx:50%;perspective:900px;width:min(320px,86vw);margin:4px auto 18px;animation:float 5s ease-in-out infinite}
.tilt.hand{animation:none}
.card{position:relative;aspect-ratio:1.55;border-radius:22px;padding:14px 16px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;color:#1d1636;overflow:hidden;
  background:linear-gradient(135deg,#fff1a8 0%,#ffd23f 28%,#ffb300 55%,#ffe27a 78%,#ffc21f 100%);border:3.5px solid #1d1636;box-shadow:0 10px 0 #1d1636,0 30px 60px -10px #ffb30080,0 0 0 1px #fff8 inset;
  transform:rotateX(var(--rx)) rotateY(var(--ry));transition:transform .18s ease-out;transform-style:preserve-3d;animation:cardIn .8s cubic-bezier(.34,1.56,.64,1) .1s both}
.foil{position:absolute;inset:-40%;background:conic-gradient(from 0deg at var(--gx) 50%,#ff3d7f00,#ff3d7f55,#7b5cff55,#3fe0b055,#5fb4ff55,#ff3d7f00 60%);mix-blend-mode:overlay;animation:spin 6s linear infinite;pointer-events:none}
.card::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 30%,#ffffffb0 45%,transparent 58%);background-size:250% 100%;animation:sheen 3.2s ease-in-out infinite;pointer-events:none;mix-blend-mode:soft-light}
.c-top{position:relative;display:flex;justify-content:space-between;gap:10px;font-size:.72rem;font-weight:700;letter-spacing:.02em}
.c-top span:last-child{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8}
.c-mid{position:relative;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;align-items:center;column-gap:8px;text-align:right}
.c-bud{grid-row:1/3;margin:-12px 0 -12px -4px;filter:drop-shadow(0 4px 0 #1d163655)}
.c-mid b{font-family:Karantina,"Varela Round",sans-serif;font-size:2.15rem;line-height:.9}
.c-mid small{font-size:.72rem;font-weight:700;opacity:.75}
.c-row{position:relative;display:flex;gap:6px;font-size:1.05rem}
.c-row span{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:#1d163614;border:1.5px solid #1d163633}
.c-code{position:absolute;left:16px;bottom:16px;display:flex;gap:2px;height:22px;opacity:.55}
.c-code i{display:block;background:#1d1636;height:100%}
h1{margin:0;display:grid;gap:2px;font-family:Karantina,"Varela Round",sans-serif;font-weight:700;line-height:.92;font-size:clamp(2.6rem,12vw,3.4rem)}
h1 .free{color:#3fe0b0}
h1 .gold{background:linear-gradient(90deg,#ffe27a,#ffd23f,#ff9f3f,#ffd23f,#ffe27a);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:gold 4s linear infinite}
.lead{margin:10px auto 0;max-width:340px;font-size:1rem;line-height:1.5;color:#dcd5ff}
.lead b{color:#3fe0b0}
.feats{margin-top:18px}
.rail{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 20px 14px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.rail::-webkit-scrollbar{display:none}
.f{flex:none;width:min(290px,78vw);scroll-snap-align:center;border-radius:22px;padding:12px 12px 16px;box-sizing:border-box;background:linear-gradient(180deg,#ffffff16,#ffffff08);border:1.5px solid #ffffff26;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:relative;opacity:0;transform:translateY(14px);animation:up .5s cubic-bezier(.23,1,.32,1) calc(.35s + var(--i) * .07s) forwards}
.f h3{margin:10px 2px 4px;font-size:1.08rem}
.f p{margin:0 2px;font-size:.88rem;line-height:1.45;color:#cfc7f5}
.chip{position:absolute;top:20px;left:20px;z-index:2;font-size:.72rem;font-weight:700;color:#1d1636;background:#ffd23f;border:2px solid #1d1636;border-radius:99px;padding:3px 9px;box-shadow:0 3px 0 #1d1636}
.pv{height:170px;border-radius:16px;overflow:hidden;position:relative;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#3b2a8f,#1d1636)}
.dots{display:flex;justify-content:center;gap:6px}
.dots i{width:7px;height:7px;border-radius:99px;background:#ffffff40;transition:width .25s cubic-bezier(.23,1,.32,1),background-color .25s}
.dots i.on{width:22px;background:#ffd23f}
/* previews: only the card in view moves */
.f:not(.live) .pv *{animation-play-state:paused!important}
.ph{position:relative;width:96px;height:150px;border-radius:16px;border:3px solid #fff;background:#140d2c;overflow:hidden}
.bars{position:absolute;top:6px;inset-inline:6px;display:flex;gap:3px;z-index:2}.bars i{flex:1;height:3px;border-radius:2px;background:#ffffff40;overflow:hidden;position:relative}
.bars i::after{content:"";position:absolute;inset:0;background:#fff;transform-origin:right;transform:scaleX(0);animation:bar 6s linear infinite}
.bars i:nth-child(2)::after{animation-name:bar2}.bars i:nth-child(3)::after{animation-name:bar3}
.fr{position:absolute;inset:0;display:grid;place-content:center;gap:3px;text-align:center;padding:6px;opacity:0;animation:fr 6s infinite}
.fr small{font-size:.58rem;font-weight:700;opacity:.8}.fr b{font-family:Karantina,sans-serif;font-size:1.9rem;line-height:.9;color:#ffd23f}.fr b.big{font-size:3rem}.fr b.emo{font-size:2.2rem}.fr em{font-style:normal;font-size:.6rem}
.f1{background:#ff3d7f}.f2{background:#7b5cff;animation-delay:2s}.f3{background:#1d1636;animation-delay:4s}
.vid{display:grid;gap:8px;justify-items:center}
.vf{position:relative;width:150px;height:84px;border-radius:12px;border:3px solid #fff;overflow:hidden;background:linear-gradient(135deg,#ff3d7f,#7b5cff,#3fe0b0);background-size:200% 200%;animation:grad 4s ease infinite}
.vb{position:absolute;inset:0;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.play{position:absolute;inset:0;display:grid;place-items:center;font-size:1.7rem;color:#fff;text-shadow:0 2px 0 #0006;animation:pulse 1.4s ease-in-out infinite}
.wave{display:flex;gap:3px;height:22px;align-items:center}.wave i{width:4px;border-radius:2px;background:#3fe0b0;height:100%;animation:wv .9s ease-in-out calc(var(--i) * -.07s) infinite alternate}
.vq,.sq{font-size:.78rem;font-weight:700;background:#fff;color:#1d1636;border-radius:12px;padding:5px 10px;border:2px solid #1d1636}
.f-sc .pv{gap:10px;align-content:center}
.file{position:relative;width:150px;height:96px;background:#e9d3a2;border:3px solid #1d1636;border-radius:12px;transform:rotate(-3deg)}
.tab{position:absolute;top:-16px;right:10px;background:#c9a66b;border:3px solid #1d1636;border-bottom:0;border-radius:9px 9px 0 0;padding:0 8px;font-size:.6rem;font-weight:700;color:#3a2a0a}
.rd{position:absolute;right:12px;left:30%;top:18px;height:9px;border-radius:3px;background:#1d1636;transform-origin:right;animation:rd 3s cubic-bezier(.23,1,.32,1) infinite}.rd.r2{top:36px;left:45%;animation-delay:.1s}.rd.r3{top:54px;left:20%;animation-delay:.2s}
.stamp{position:absolute;inset:0;margin:auto;width:max-content;height:max-content;font-family:Karantina,sans-serif;font-weight:700;font-size:1.9rem;color:#ff3d5a;border:3.5px solid #ff3d5a;border-radius:8px;padding:0 9px 3px;transform:rotate(-14deg);animation:stamp 3s cubic-bezier(.23,1,.32,1) infinite}
.dos{width:190px;background:#fff3d1;color:#1d1636;border:3px solid #1d1636;border-radius:14px;padding:10px 12px;text-align:right;display:grid;gap:5px;box-shadow:0 5px 0 #1d1636;transform:rotate(2deg)}
.dos small{font-size:.6rem;font-weight:700;color:#ff3d5a}.dos b{font-size:.92rem}.dos p{margin:0;font-size:.75rem;line-height:1.4}
.un{background:#1d1636;color:transparent;border-radius:3px;animation:unred 3.4s ease-in-out infinite}
.ln{display:block;height:7px;border-radius:3px;background:#1d163626}.ln.l2{width:60%}
.cert{position:relative;width:170px;padding:12px 10px 14px;background:#fffdf5;color:#1d1636;border:3px solid #1d1636;border-radius:10px;outline:2px dashed #c9a66b;outline-offset:-9px;text-align:center;display:grid;gap:4px;box-shadow:0 5px 0 #1d1636;animation:wob 3s ease-in-out infinite}
.cert small{font-size:.58rem;font-weight:700;color:#7b5cff}.cert b{font-family:Karantina,sans-serif;font-size:1.9rem;line-height:.9}.cert em{font-style:normal;font-size:.66rem}
.seal{position:absolute;left:-12px;bottom:-12px;width:38px;height:38px;border-radius:50%;background:#ff3d7f;color:#fff;border:3px solid #1d1636;display:grid;place-items:center;font-weight:700;animation:spin 8s linear infinite}
.dg{width:200px;display:grid;gap:6px;text-align:right}.dg>b{font-size:1rem;color:#ffd23f;text-align:center;margin-bottom:2px}
.m{display:grid;grid-template-columns:62px 1fr;align-items:center;gap:6px;font-size:.7rem;font-weight:700}
.m i{height:9px;border-radius:99px;background:#ffffff1f;overflow:hidden}.m b{display:block;height:100%;width:var(--v);border-radius:99px;background:linear-gradient(90deg,#ff3d7f,#ffd23f);transform-origin:right;animation:fill 3.2s cubic-bezier(.23,1,.32,1) calc(var(--i) * .15s) infinite}
.cmp{padding:22px 16px 6px}
h2{margin:0 4px 12px;font-size:1.25rem;text-align:center;opacity:0;transform:translateY(8px);transition:opacity .4s ease-out,transform .4s cubic-bezier(.23,1,.32,1)}
h2.in{opacity:1;transform:none}
.tbl{border-radius:20px;overflow:hidden;border:1.5px solid #ffffff26;background:#ffffff0c}
.tr{display:grid;grid-template-columns:1fr 68px 78px;align-items:center;min-height:44px;border-top:1px solid #ffffff14;font-size:.86rem;opacity:0;transform:translateX(-10px);transition:opacity .35s ease-out calc(var(--i,0) * .04s),transform .35s cubic-bezier(.23,1,.32,1) calc(var(--i,0) * .04s)}
.tr.in{opacity:1;transform:none}
.tr>span{padding:8px 12px}.tr>span:first-child{line-height:1.35}
.tr .cf,.tr .cp{text-align:center;padding-inline:4px;align-self:stretch;display:grid;place-items:center}
.tr .cp{background:linear-gradient(180deg,#ffd23f1f,#ffd23f12);border-inline-start:1.5px solid #ffd23f55}
.th{border-top:0;font-weight:700;min-height:40px}.th .cf{color:#3fe0b0}.th .cp{color:#ffd23f}
.tr.pz>span:first-child{color:#fff}
.ok{font-style:normal;font-weight:700;color:#3fe0b0;font-size:1.05rem}.ok.g{color:#ffd23f}.no{font-style:normal;color:#ffffff40}
.tr small{font-size:.72rem;color:#cfc7f5}.tr small.g{color:#ffd23f;font-weight:700;font-size:.8rem}
.note{margin:10px 6px 0;text-align:center;font-size:.8rem;color:#bdb4e8}
.price{margin:18px 16px 0;padding:20px 16px;border-radius:24px;text-align:center;position:relative;background:linear-gradient(#1d1340,#160f33) padding-box,conic-gradient(from var(--a,0deg),#ffd23f,#ff3d7f,#7b5cff,#3fe0b0,#ffd23f) border-box;border:2.5px solid transparent;opacity:0;transform:scale(.97);transition:opacity .45s ease-out,transform .45s cubic-bezier(.23,1,.32,1)}
.price.in{opacity:1;transform:none}
.launch{display:inline-block;font-size:.8rem;font-weight:700;color:#1d1636;background:#3fe0b0;border-radius:99px;padding:3px 12px}
.pr{display:flex;justify-content:center;align-items:baseline;gap:12px;margin-top:8px}
.pr b{font-family:Karantina,sans-serif;font-size:4.6rem;line-height:.85;color:#ffd23f;text-shadow:0 5px 0 #1d1636}.pr b small{font-size:2rem;margin-inline-start:3px}
.pr s{font-size:1.1rem;color:#ffffff80;text-decoration-color:#ff3d7f;text-decoration-thickness:3px}
.once{margin:6px 0 0;font-weight:700;font-size:1rem}
.each{margin:12px auto 0;max-width:320px;display:grid;gap:2px;background:#ffffff10;border-radius:14px;padding:9px 12px}.each b{color:#3fe0b0}.each span{font-size:.82rem;color:#cfc7f5}
.trust{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:6px;text-align:right;font-size:.82rem;color:#dcd5ff}
.pad{height:150px}
.dock{position:absolute;inset-inline:0;bottom:0;z-index:6;padding:14px 16px calc(12px + env(safe-area-inset-bottom));display:grid;gap:6px;justify-items:center;background:linear-gradient(180deg,#0f0a2200,#0f0a22e6 35%,#0f0a22);}
.dock>*{width:min(448px,100%)}
.go{position:relative;overflow:hidden;font:inherit;font-weight:700;font-size:1.18rem;color:#1d1636;border:3.5px solid #1d1636;border-radius:18px;padding:16px;cursor:pointer;background:linear-gradient(180deg,#ffe783,#ffc21f);box-shadow:0 6px 0 #1d1636,0 0 40px #ffc21f66;transition:transform .12s ease-out,box-shadow .12s ease-out;animation:breathe 2.6s ease-in-out infinite}
.go::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,#ffffffcc 48%,transparent 60%);background-size:250% 100%;animation:sheen 2.6s ease-in-out infinite}
.go span{position:relative;z-index:1}
.go:active{transform:translateY(4px) scale(.99);box-shadow:0 2px 0 #1d1636}
.alts{display:flex;justify-content:center;align-items:center;gap:4px}.alts>i{width:4px;height:4px;border-radius:50%;background:#ffffff50}
.free-b{font:inherit;font-size:.92rem;font-weight:700;color:#3fe0b0;background:none;border:0;padding:8px;cursor:pointer}
@property --a{syntax:"<angle>";inherits:false;initial-value:0deg}
.price.in{animation:ring 5s linear infinite}
@keyframes ring{to{--a:360deg}}
@keyframes ppIn{from{opacity:0;transform:translateY(24px)}}@keyframes ppOut{to{opacity:0;transform:translateY(16px)}}
@keyframes drift{to{transform:translate(6vmax,8vmax) scale(1.12)}}@keyframes tw{to{opacity:.4}}
@keyframes float{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-8px) rotate(1.5deg)}}
@keyframes cardIn{from{opacity:0;transform:translateY(40px) rotateX(35deg) scale(.85)}}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes sheen{0%,20%{background-position:120% 0}70%,100%{background-position:-60% 0}}
@keyframes gold{to{background-position:-200% 0}}@keyframes up{to{opacity:1;transform:none}}
@keyframes bar{0%{transform:scaleX(0)}33%,100%{transform:scaleX(1)}}@keyframes bar2{0%,33%{transform:scaleX(0)}66%,100%{transform:scaleX(1)}}@keyframes bar3{0%,66%{transform:scaleX(0)}100%{transform:scaleX(1)}}
@keyframes fr{0%{opacity:0;transform:scale(.92)}4%,30%{opacity:1;transform:none}36%,100%{opacity:0}}
@keyframes grad{50%{background-position:100% 100%}}@keyframes pulse{50%{transform:scale(1.18)}}
@keyframes wv{from{transform:scaleY(.2)}to{transform:scaleY(1)}}
@keyframes rd{0%{transform:scaleX(0)}25%,100%{transform:scaleX(1)}}
@keyframes stamp{0%,30%{opacity:0;transform:rotate(-14deg) scale(2.2)}40%{opacity:1;transform:rotate(-14deg) scale(.92)}45%,100%{opacity:1;transform:rotate(-14deg)}}
@keyframes unred{0%,35%{background:#1d1636;color:transparent}50%,85%{background:#ffd23f;color:#1d1636}100%{background:#1d1636;color:transparent}}
@keyframes wob{50%{transform:rotate(-2deg) translateY(-3px)}}
@keyframes fill{0%{transform:scaleX(0)}40%,100%{transform:scaleX(1)}}
@keyframes breathe{50%{box-shadow:0 6px 0 #1d1636,0 0 60px #ffc21faa}}
.rm *,.rm{animation:none!important;transition:none!important}
.rm .f,.rm .tr,.rm h2,.rm .price{opacity:1;transform:none}
.rm .fr.f1{opacity:1}.rm .bars i::after,.rm .rd,.rm .m b{transform:none}.rm .stamp{opacity:1}
`;
