// The owner's panel: payments waiting for approval, one tap to unlock a group, sales and receipts.
// Only one Google account can read or change anything here; the database rules enforce it, not this page.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { getDatabase, ref, onValue, update, serverTimestamp, get, runTransaction } from "firebase/database";

const PRICE = 14.9; // launch price until the end of 2026, 19.90 after
// Black Friday (26.11 16:00 – 30.11 23:59 Israel time) was 9.90. Same window as premium.ts
const SALE_FROM = Date.UTC(2026, 10, 26, 14), SALE_END = Date.UTC(2026, 10, 30, 21, 59, 59);
const priceAt = (ts: number) => (ts >= SALE_FROM && ts < SALE_END ? 9.9 : ts >= new Date(2027, 0, 1).getTime() ? 19.9 : PRICE);
const money = (n: number) => n.toFixed(2);
const MORNING = "https://app.greeninvoice.co.il/";
const cfg = (window as any).MIAMAR_FIREBASE;
const app = initializeApp(cfg), auth = getAuth(app), db = getDatabase(app);
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const when = (t: number) => { if (!t) return ""; const d = new Date(t); return `${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "עכשיו" : m < 60 ? `לפני ${m} דק׳` : m < 1440 ? `לפני ${Math.round(m / 60)} שע׳` : `לפני ${Math.round(m / 1440)} ימים`; };

let rows: [string, any][] = [], filter = "wait", seenWait = new Set<string>(), first = true, off: null | (() => void) = null;

function ding() { try { const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 1046; g.gain.setValueAtTime(.3, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .6); o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + .6); } catch {} }

function draw() {
  const ok = rows.filter(([, v]) => v.s === "ok"), wait = rows.filter(([, v]) => v.s === "wait"), noRec = ok.filter(([, v]) => !v.r);
  document.title = wait.length ? `(${wait.length}) לוח ניהול` : "לוח ניהול";
  $("#sum").innerHTML = `
    <div class="kpi"><b>${ok.length}</b><span>מכירות</span></div>
    <div class="kpi"><b>${money(ok.reduce((a: number, [, v]: any) => a + priceAt(v.t || 0), 0))} ₪</b><span>הכנסות</span></div>
    <div class="kpi ${wait.length ? "hot" : ""}"><b>${wait.length}</b><span>מחכים לאישור</span></div>
    <div class="kpi ${noRec.length ? "warn" : ""}"><b>${noRec.length}</b><span>בלי קבלה</span></div>`;
  const now = priceAt(Date.now()), bf = ok.filter(([, v]) => priceAt(v.t || 0) === 9.9).length;
  $("#price").innerHTML = now === 9.9 ? `🖤 בלאק פריידיי עכשיו: מחפשים בביט העברה של <b>9.90 ₪</b> (עד שני 30.11 ב־23:59, אחר כך שוב 14.90 ₪)${bf ? ` · ${bf} מכירות במבצע עד עכשיו` : ""}` : `מחפשים בביט העברה של <b>${money(now)} ₪</b>${bf ? ` · בבלאק פריידיי היו ${bf} מכירות ב־9.90 ₪` : ""}`;
  $("#price").className = now === 9.9 ? "bf" : "";
  $("#rec").hidden = !noRec.length;
  $("#rec").innerHTML = `🧾 יש ${noRec.length} תשלומים שעוד לא הוצאת עליהם קבלה. <a href="${MORNING}" target="_blank" rel="noopener">להוצאת קבלה במורנינג</a>, ואז מסמנים כאן "הוצאתי קבלה".`;
  const list = rows.filter(([, v]) => filter === "all" || (filter === "rec" ? v.s === "ok" && !v.r : v.s === filter)).sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === filter)));
  $("#list").innerHTML = list.length ? list.map(([code, v]) => `<div class="row st-${v.s}">
      <div class="main"><b class="code" dir="ltr">${esc(code)}</b><span class="amt">${money(priceAt(v.t || 0))} ₪${priceAt(v.t || 0) === 9.9 ? " · 🖤 בלאק פריידיי" : ""}</span><span class="dim">${when(v.t)} · ${ago(v.t)}</span><span class="dim small">קבוצה ${esc(String(v.c).slice(0, 6))}</span></div>
      <div class="acts">${v.s === "wait" ? `<button class="ok" data-ok="${esc(code)}">אשר ✓</button><button class="no" data-no="${esc(code)}">דחייה</button>`
        : v.s === "ok" ? `<span class="tag ok">אושר ${when(v.a)}</span><label class="rc"><input type="checkbox" data-r="${esc(code)}" ${v.r ? "checked" : ""}> הוצאתי קבלה</label>`
        : `<span class="tag no">נדחה</span><button class="ghost" data-ok="${esc(code)}">לאשר בכל זאת</button>`}<button class="del" data-del="${esc(code)}" aria-label="מחיקה מהרשימה">🗑</button></div></div>`).join("")
    : `<p class="empty">${filter === "wait" ? "אין כרגע תשלומים שמחכים. 😴" : "אין פה כלום."}</p>`;
  document.querySelectorAll<HTMLButtonElement>("[data-ok]").forEach((b) => (b.onclick = () => approve(b.dataset.ok!, b)));
  document.querySelectorAll<HTMLButtonElement>("[data-no]").forEach((b) => (b.onclick = () => { if (confirmIn(b, "לדחות?")) update(ref(db), { [`pay/${b.dataset.no}/s`]: "no" }).catch(fail); }));
  document.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => (b.onclick = () => { if (confirmIn(b, "למחוק?")) update(ref(db), { [`pay/${b.dataset.del}`]: null }).then(() => toast("נמחק מהרשימה. אם הקבוצה נפתחה, היא נשארת פתוחה.")).catch(fail); }));
  document.querySelectorAll<HTMLInputElement>("[data-r]").forEach((c) => (c.onchange = () => update(ref(db), { [`pay/${c.dataset.r}/r`]: c.checked }).catch(fail)));
}
// a second tap confirms (no browser dialogs)
function confirmIn(b: HTMLButtonElement, label: string) { if (b.dataset.armed) return true; b.dataset.armed = "1"; const t = b.textContent; b.textContent = label; setTimeout(() => { delete b.dataset.armed; b.textContent = t; }, 2500); return false; }
async function approve(code: string, b: HTMLButtonElement) {
  const v = rows.find(([c]) => c === code)?.[1]; if (!v) return;
  b.disabled = true; b.textContent = "פותח…";
  try { const was = v.s; await update(ref(db), { [`unlocks/${v.c}`]: { code, t: serverTimestamp() }, [`pay/${code}/s`]: "ok", [`pay/${code}/a`]: serverTimestamp() }); if (was !== "ok") countSale(Date.now()); toast(`נפתח לקבוצה של הקוד ${code} 🎉 לא לשכוח קבלה במורנינג`); }
  catch (e) { fail(e); b.disabled = false; b.textContent = "אשר ✓"; }
}
// count an approved sale in the public stats (day and hour in Israel time), so the stats page sees it
// even when the buyer closed the site before the approval came
const IL = (t: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, h: p.hour }; };
async function countSale(t: number) {
  const { d, h } = IL(t || Date.now());
  for (const p of ["stats/total/pm_approved", `stats/days/${d}/pm_approved`, `stats/days/${d}/h${h}_pm_approved`]) await runTransaction(ref(db, p), (v) => (typeof v === "number" ? v : 0) + 1).catch(() => {});
}
// once ever: sales approved before this counter existed are counted by the day they were approved
let backfilled = false;
async function backfill() {
  if (backfilled) return; backfilled = true;
  try { if ((await get(ref(db, "stats/total/pm_approved"))).exists()) return; } catch { return; }
  for (const [, v] of rows.filter(([, v]) => v.s === "ok")) await countSale(v.a || v.t);
}
function fail(e: any) { toast("משהו נכשל: " + (e && e.code ? e.code : "בודקים את החוקים בפיירבייס")); }
function toast(t: string) { const d = $("#toast"); d.textContent = t; d.classList.add("show"); setTimeout(() => d.classList.remove("show"), 3500); }

$("#login").onclick = async () => { try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e: any) { if (/popup/.test(e?.code || "")) signInWithRedirect(auth, new GoogleAuthProvider()); else toast("ההתחברות נכשלה: " + (e?.code || "")); } };
$("#out").onclick = () => signOut(auth);
$("#notif").onclick = () => { try { Notification.requestPermission().then((p) => toast(p === "granted" ? "התראות פועלות ✓" : "ההתראות חסומות בדפדפן")); } catch {} };
document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => (b.onclick = () => { filter = b.dataset.f!; draw(); }));
getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, (u) => {
  if (off) { off(); off = null; }
  const me = u && !u.isAnonymous ? (u.email || "").toLowerCase() : "";
  $("#out").hidden = !me; $("#who").textContent = "";
  $("#gate").hidden = false; $("#panel").hidden = true;
  if (!me) return;
  // the database rules decide who is the owner: if this account may read the payments, it is the owner
  off = onValue(ref(db, "pay"), (s) => {
    $("#gate").hidden = true; $("#panel").hidden = false;
    rows = Object.entries(s.val() || {});
    const waitNow = rows.filter(([, v]) => v.s === "wait").map(([c]) => c);
    const fresh = waitNow.filter((c) => !seenWait.has(c));
    if (!first && fresh.length) { ding(); try { if ("Notification" in window && Notification.permission === "granted") new Notification("תשלום חדש מחכה לאישור", { body: `קוד ${fresh[0]}` }); } catch {} }
    seenWait = new Set(waitNow); first = false; draw(); backfill();
  }, () => { $("#gate").hidden = false; $("#panel").hidden = true; $("#who").textContent = `מחובר כ־${me}. ללוח הזה נכנסים רק עם החשבון של בעל האתר.`; });
});
setInterval(() => { if (rows.length) draw(); }, 60000);
