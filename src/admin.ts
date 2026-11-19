// The owner's panel: payments waiting for approval, one tap to unlock a group, sales and receipts.
// Only one Google account can read or change anything here; the database rules enforce it, not this page.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { getDatabase, ref, onValue, update, serverTimestamp } from "firebase/database";

const ADMIN = "yonatan.beyo@gmail.com";
const PRICE = 14.9;
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
    <div class="kpi"><b>${(ok.length * PRICE).toFixed(2)} ₪</b><span>הכנסות</span></div>
    <div class="kpi ${wait.length ? "hot" : ""}"><b>${wait.length}</b><span>מחכים לאישור</span></div>
    <div class="kpi ${noRec.length ? "warn" : ""}"><b>${noRec.length}</b><span>בלי קבלה</span></div>`;
  $("#rec").hidden = !noRec.length;
  $("#rec").innerHTML = `🧾 יש ${noRec.length} תשלומים שעוד לא הוצאת עליהם קבלה. <a href="${MORNING}" target="_blank" rel="noopener">להוצאת קבלה במורנינג</a>, ואז מסמנים כאן "הוצאתי קבלה".`;
  const list = rows.filter(([, v]) => filter === "all" || (filter === "rec" ? v.s === "ok" && !v.r : v.s === filter)).sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === filter)));
  $("#list").innerHTML = list.length ? list.map(([code, v]) => `<div class="row ${v.s}">
      <div class="main"><b class="code" dir="ltr">${esc(code)}</b><span class="dim">${when(v.t)} · ${ago(v.t)}</span><span class="dim small">קבוצה ${esc(String(v.c).slice(0, 6))}</span></div>
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
  try { await update(ref(db), { [`unlocks/${v.c}`]: { code, t: serverTimestamp() }, [`pay/${code}/s`]: "ok", [`pay/${code}/a`]: serverTimestamp() }); toast(`נפתח לקבוצה של הקוד ${code} 🎉 לא לשכוח קבלה במורנינג`); }
  catch (e) { fail(e); b.disabled = false; b.textContent = "אשר ✓"; }
}
function fail(e: any) { toast("משהו נכשל: " + (e && e.code ? e.code : "בודקים את החוקים בפיירבייס")); }
function toast(t: string) { const d = $("#toast"); d.textContent = t; d.classList.add("show"); setTimeout(() => d.classList.remove("show"), 3500); }

function watch() {
  off = onValue(ref(db, "pay"), (s) => {
    rows = Object.entries(s.val() || {});
    const waitNow = rows.filter(([, v]) => v.s === "wait").map(([c]) => c);
    const fresh = waitNow.filter((c) => !seenWait.has(c));
    if (!first && fresh.length) { ding(); try { if ("Notification" in window && Notification.permission === "granted") new Notification("תשלום חדש מחכה לאישור", { body: `קוד ${fresh[0]}` }); } catch {} }
    seenWait = new Set(waitNow); first = false; draw();
  }, (e) => { $("#list").innerHTML = `<p class="empty">אין הרשאה לקרוא את התשלומים. צריך להדביק את החוקים החדשים בפיירבייס. (${esc(e.message)})</p>`; });
}

$("#login").onclick = async () => { try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e: any) { if (/popup/.test(e?.code || "")) signInWithRedirect(auth, new GoogleAuthProvider()); else toast("ההתחברות נכשלה: " + (e?.code || "")); } };
$("#out").onclick = () => signOut(auth);
$("#notif").onclick = () => { try { Notification.requestPermission().then((p) => toast(p === "granted" ? "התראות פועלות ✓" : "ההתראות חסומות בדפדפן")); } catch {} };
document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => (b.onclick = () => { filter = b.dataset.f!; draw(); }));
getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, (u) => {
  if (off) { off(); off = null; }
  const me = u && !u.isAnonymous ? (u.email || "").toLowerCase() : "";
  $("#gate").hidden = me === ADMIN; $("#panel").hidden = me !== ADMIN;
  $("#who").textContent = me && me !== ADMIN ? `מחובר כ־${me}. ללוח הזה נכנסים רק עם החשבון של בעל האתר.` : "";
  $("#out").hidden = !me;
  if (me === ADMIN) watch();
});
setInterval(() => { if (rows.length) draw(); }, 60000);
