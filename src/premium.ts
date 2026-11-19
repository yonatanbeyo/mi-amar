// Premium: the group's year summary, the media round, certificates and the Bit payment flow.
// Everything about the chat is computed here, inside the phone. Nothing from the chat goes to the server:
// the server only ever sees a one-way fingerprint of the chat (to remember that it was unlocked) and the payment code.
import JSZip from "jszip";
import { getApp } from "firebase/app";
import { getDatabase, ref, set, onValue, serverTimestamp } from "firebase/database";
import type { Message } from "./lib/parser";

const PRICE = "14.90";
const BIT_URL = "https://www.bitpay.co.il/app/me/826990EF-07DF-40B2-B8AE-9A7737DEE4ED";
const BIT_NUM = "058-646-3236";
// email to the owner on every "I paid" (web3forms.com: the key is public by design and only routes mail to the owner)
const MAIL_KEY = "af3e3f5d-a5df-452b-aae5-f0bfe9c6a60e";
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }] };
const DAY = 864e5;

type Kind = "audio" | "image" | "sticker" | "video" | "gif";
type Item = { id: string; kind: Kind; author: string; ts: number; size: number };
type Opts = { buddy: string; qr: (t: string) => string; net: any; music?: { pause(): void; resume(): void }; toast?: (t: string) => void; demo?: () => boolean };

const P: any = {
  opts: null as Opts | null, file: null as File | null, zipP: null as Promise<JSZip | null> | null, entries: new Map<string, any>(),
  key: "", name: "", msgs: [] as Message[], items: [] as Item[], excluded: new Set<string>(), urls: new Map<string, string>(),
  on: false, unwatch: null as null | (() => void), listeners: [] as ((e: string) => void)[], wrapped: null as any,
  room: null as any, manifest: (() => []) as () => string[], chans: new Set<RTCDataChannel>(), pcs: new Map<string, RTCPeerConnection>(),
  phone: { started: false, failed: false, ch: null as RTCDataChannel | null, want: [] as string[], busy: false },
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const store = { get(k: string, d: any) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k: string, v: any) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const fmt = (n: number) => Math.round(n).toLocaleString("he-IL");
const EMO = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
const plainName = (n: string) => n.replace(EMO, "").replace(/[️‍]/g, "").trim() || n;
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const MSHORT = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יוני", "יולי", "אוג", "ספט", "אוק", "נוב", "דצמ"];
const WDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const db = () => { try { return getDatabase(getApp()); } catch { return null; } };
const emit = (e: string) => P.listeners.forEach((f: any) => { try { f(e); } catch {} });

// a short one-way fingerprint of the chat: the same group exported from different phones gives the same key
// (contact names differ between phones, so only times and texts go in)
function hash20(s: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); h3 = Math.imul(h3 ^ c, 2246822507); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1, h2, h3].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("").slice(0, 20);
}

// ---------------------------------------------------------------- setup
export function init(o: Opts) { P.opts = { toast, ...o }; css(); observeMedia(); }
export const on = (fn: (e: string) => void) => { P.listeners.push(fn); };
export const isOn = () => P.on;

export function setFile(f: File | null) {
  P.file = f; P.entries = new Map(); P.urls.forEach((u: string) => URL.revokeObjectURL(u)); P.urls = new Map(); P.items = [];
  P.zipP = f && /\.zip$/i.test(f.name) ? JSZip.loadAsync(f).then((z) => { Object.values(z.files).forEach((e: any) => { if (!e.dir) P.entries.set(e.name.split("/").pop(), e); }); return z; }).catch(() => null) : Promise.resolve(null);
}

/** read the chat text out of the upload, opening the ZIP only once (it can be hundreds of MB with media) */
export async function readChat(f: File): Promise<string> {
  setFile(f);
  if (/\.txt$/i.test(f.name)) return f.text();
  const z = await P.zipP;
  if (!z) throw new Error("לא הצלחתי לפתוח את קובץ ה-ZIP.");
  const txts = Object.values(z.files).filter((e: any) => !e.dir && /\.txt$/i.test(e.name) && !/__MACOSX/.test(e.name));
  if (!txts.length) throw new Error("לא נמצא קובץ צ'אט בתוך ה-ZIP. ודאו שייצאתם את הצ'אט מוואטסאפ.");
  const pick: any = txts.find((e: any) => /_chat\.txt$|whatsapp/i.test(e.name)) ?? txts[0];
  return pick.async("string");
}
export function toast(t: string) {
  const d = document.createElement("div"); d.className = "pm-toast"; d.textContent = t; d.setAttribute("role", "status"); document.body.append(d);
  setTimeout(() => d.classList.add("show"), 20); setTimeout(() => { d.classList.remove("show"); setTimeout(() => d.remove(), 400); }, 3200);
}

/** called once the chat is parsed (and again on every setup screen; cheap when nothing changed) */
export async function useChat(msgs: Message[], name: string) {
  if (P.msgs === msgs) return;
  P.msgs = msgs; P.name = !name || /^(_?chat|whatsapp.*|צ'?אט)$/i.test(name.trim()) ? "" : name; P.wrapped = null;
  const sample = msgs.filter((m) => m.ts && m.text && !m.media).slice(0, 400).map((m) => `${Math.floor(m.ts! / 60000)}|${m.text}`).join("\n");
  P.key = sample.length > 200 ? hash20(sample) : "";
  P.excluded = new Set(store.get("pm_ex_" + P.key, []));
  watchUnlock();
  await (P.zipP || Promise.resolve(null));
  P.items = msgs.filter((m) => m.file && m.ts && P.entries.has(m.file) && /^(audio|image|sticker|video|gif)$/.test(m.kind || "")).map((m) => {
    const e = P.entries.get(m.file!); return { id: m.file!, kind: m.kind as Kind, author: m.author, ts: m.ts!, size: e?._data?.uncompressedSize || 0 };
  });
  emit("media");
}
export const mediaCount = () => P.items.length;
export const mediaByKind = () => P.items.reduce((a: any, it: Item) => ((a[it.kind] = (a[it.kind] || 0) + 1), a), {});
export const key = () => P.key;

function watchUnlock() {
  if (P.unwatch) { P.unwatch(); P.unwatch = null; }
  const k = P.key; if (!k) { P.on = false; return; }
  const was = P.on;
  P.on = (store.get("pm_on", []) as string[]).includes(k) || !!(P.opts?.demo && P.opts.demo());
  if (P.on !== was) emit("state");
  const d = db(); if (!d) return;
  try {
    P.unwatch = onValue(ref(d, `unlocks/${k}`), (s) => {
      if (!s.exists() || P.key !== k) return;
      const list = store.get("pm_on", []) as string[]; if (!list.includes(k)) { list.push(k); store.set("pm_on", list.slice(-30)); }
      if (!P.on) { P.on = true; closeBuy(true); emit("unlock"); }
    }, () => {});
  } catch {}
}

// ---------------------------------------------------------------- media files
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", mp4: "video/mp4", mov: "video/quicktime", "3gp": "video/3gpp" };
const mimeOf = (id: string) => MIME[(id.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
async function rawBlob(id: string): Promise<Blob | null> {
  const e = P.entries.get(id); if (!e) return null;
  try { const buf = await e.async("arraybuffer"); return new Blob([buf], { type: mimeOf(id) }); } catch { return null; }
}
async function urlOf(id: string): Promise<string | null> {
  if (P.urls.has(id)) return P.urls.get(id);
  const b = await rawBlob(id); if (!b) return null;
  const u = URL.createObjectURL(b); P.urls.set(id, u); return u;
}
// photos are shrunk before they travel to the phones
async function sendBlob(id: string): Promise<Blob | null> {
  const b = await rawBlob(id); if (!b) return null;
  if (!/^image\/(jpeg|png)/.test(b.type) || b.size < 250e3) return b;
  try {
    const img = await createImageBitmap(b); const k = Math.min(1, 1000 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((x) => r(x || b), "image/jpeg", .8));
  } catch { return b; }
}
const canOpus = () => { try { const a = document.createElement("audio"); return !!(a.canPlayType('audio/ogg; codecs="opus"') || a.canPlayType("audio/ogg")); } catch { return false; } };

// ---------------------------------------------------------------- the media round
const MTITLE: Record<Kind, string> = { audio: "🎙️ של מי הקול?", image: "📸 מי שלח את התמונה?", sticker: "🤡 של מי הסטיקר?", video: "🎬 מי שלח את הסרטון?", gif: "🎬 מי שלח את הגיף?" };
const MHOOK: Record<Kind, string> = { audio: "הקלטה מהקבוצה", image: "תמונה מהקבוצה", sticker: "סטיקר מהקבוצה", video: "סרטון מהקבוצה", gif: "גיף מהקבוצה" };
export const mediaTitle = (k: Kind) => MTITLE[k] || "סבב המדיה";

/** media questions for a new game: the full round with premium, one taste without */
export function mediaQs(pool: string[], total: number, seen?: Set<string>) {
  const ok = P.items.filter((it: Item) => pool.includes(it.author) && !P.excluded.has(it.id) && !(seen && seen.has("m:" + it.id))
    && (it.kind !== "audio" || canOpus()) && (it.kind !== "video" || it.size < 8e6) && (it.kind !== "gif" || it.size < 6e6));
  if (!ok.length) return [];
  const want = P.on ? Math.max(2, Math.min(10, Math.round(total * .35))) : 1;
  const byKind: Record<string, Item[]> = {};
  for (const it of shuffle(ok)) (byKind[it.kind] ||= []).push(it);
  const order = shuffle(Object.keys(byKind)), out: Item[] = [], per: Record<string, number> = {};
  for (let guard = 0; out.length < want && guard < 400; guard++) {
    const k = order[guard % order.length], list = byKind[k]; if (!list || !list.length) continue;
    const j = list.findIndex((it) => (per[it.author] || 0) < Math.ceil(want / Math.max(2, pool.length)) + 1); if (j < 0) { list.length = 0; continue; }
    const [it] = list.splice(j, 1); out.push(it); per[it.author] = (per[it.author] || 0) + 1;
    if (!Object.values(byKind).some((l) => l.length)) break;
  }
  return out.map((it, i) => ({ type: "media", mf: it.id, mk: it.kind, key: "m:" + it.id, title: MTITLE[it.kind], text: "", hook: MHOOK[it.kind], answer: it.author, author: it.author, ts: it.ts,
    reveal: !P.on && i === 0 ? "🔒 עוד המון כאלה בפרימיום: הקלטות, תמונות, סטיקרים וסרטונים מהקבוצה" : "" }));
}
function shuffle<T>(a: T[]): T[] { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** what the question bubble shows for a media question; the element fills itself once the file is here */
export const mediaHtml = (q: any) => `<div class="mq" data-f="${esc(q.mf)}" data-k="${esc(q.mk)}"><span class="mq-load">טוען…</span></div>`;

function observeMedia() {
  const fill = () => document.querySelectorAll<HTMLElement>(".mq:not([data-on])").forEach((el) => { el.dataset.on = "1"; drawMedia(el); });
  new MutationObserver(fill).observe(document.body, { childList: true, subtree: true });
}
async function drawMedia(el: HTMLElement) {
  const id = el.dataset.f!, k = el.dataset.k as Kind;
  let u = P.urls.get(id) || (P.entries.size ? await urlOf(id) : null);
  if (!el.isConnected) return;
  if (!u) {
    el.innerHTML = `<span class="mq-load">${P.phone.failed ? "👀 תסתכלו על המסך הגדול" : "מגיע מהמסך הגדול… <span class='mq-dots'><i></i><i></i><i></i></span>"}</span>`;
    el.dataset.wait = "1"; return;
  }
  delete el.dataset.wait;
  if (k === "image" || k === "sticker") el.innerHTML = `<img src="${u}" alt="" class="${k}">`;
  else if (k === "video" || k === "gif") {
    el.innerHTML = `<video src="${u}" playsinline ${k === "gif" ? "muted loop" : ""} autoplay preload="auto"></video>${k === "video" ? `<button class="mq-play" hidden>▶︎ להפעיל</button>` : ""}`;
    const v = el.querySelector("video")!, b = el.querySelector<HTMLButtonElement>(".mq-play");
    v.play().catch(() => { if (b) { b.hidden = false; } else { v.muted = true; v.play().catch(() => {}); } });
    if (b) b.onclick = (e) => { e.stopPropagation(); b.hidden = true; P.opts?.music?.pause(); v.currentTime = 0; v.play().catch(() => {}); };
    if (k === "video") { v.onplay = () => P.opts?.music?.pause(); v.onended = () => { P.opts?.music?.resume(); if (b) { b.textContent = "↻ שוב"; b.hidden = false; } }; }
  } else if (k === "audio") {
    el.innerHTML = `<div class="mq-aud"><button class="mq-btn" aria-label="להשמיע">▶︎</button><div class="mq-wave">${Array.from({ length: 22 }, (_, i) => `<i style="animation-delay:-${(i * 137 % 100) / 100}s"></i>`).join("")}</div></div><audio src="${u}" preload="auto"></audio>`;
    const a = el.querySelector("audio")!, b = el.querySelector<HTMLButtonElement>(".mq-btn")!, box = el.querySelector(".mq-aud")!;
    let stopT: any = 0;
    const play = () => { clearTimeout(stopT); a.currentTime = 0; P.opts?.music?.pause(); a.play().then(() => { box.classList.add("on"); b.textContent = "⏸"; stopT = setTimeout(stop, 4800); }).catch(() => { box.classList.remove("on"); b.textContent = "▶︎"; b.classList.add("pulse"); }); };
    const stop = () => { a.pause(); box.classList.remove("on"); b.textContent = "↻"; P.opts?.music?.resume(); };
    b.onclick = (e) => { e.stopPropagation(); b.classList.remove("pulse"); if (box.classList.contains("on")) stop(); else play(); };
    a.onerror = () => { el.innerHTML = `<span class="mq-load">🔊 ההקלטה מתנגנת במסך הגדול</span>`; };
    play();
  }
}
function refillWaiting(id: string) { document.querySelectorAll<HTMLElement>(`.mq[data-wait][data-f="${CSS.escape(id)}"]`).forEach((el) => drawMedia(el)); }

// ---------------------------------------------------------------- phone-to-phone media (the server only introduces the phones)
export function hostRoom(room: any, manifest: () => string[]) {
  P.sentFiles = new Map<string, string>(); P.peerNames = new Map<string, string>();
  if (room && room.onPeers) room.onPeers((c: any) => { (c.peers || []).forEach((pe: any) => { const n = pe && !pe.isMe && pe.presence && pe.presence.p && pe.presence.p.n; if (n) P.peerNames.set(pe.peer, String(n)); }); sendFiles(); });
  P.room = room; P.manifest = manifest; P.pcs.forEach((pc: RTCPeerConnection) => pc.close()); P.pcs = new Map(); P.chans = new Set();
  if (!room || !room.onSig || typeof RTCPeerConnection === "undefined") return;
  room.onSig(async (from: string, d: any) => {
    try {
      let pc = P.pcs.get(from);
      if (d.t === "offer") {
        if (pc) pc.close();
        pc = new RTCPeerConnection(ICE); P.pcs.set(from, pc);
        pc.onicecandidate = (e) => { if (e.candidate) room.sig(from, { t: "ice", c: e.candidate.toJSON() }).catch(() => {}); };
        pc.ondatachannel = (e) => serve(e.channel);
        await pc.setRemoteDescription(d.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        await room.sig(from, { t: "answer", sdp: pc.localDescription!.toJSON() });
      } else if (d.t === "ice" && pc) await pc.addIceCandidate(d.c).catch(() => {});
    } catch {}
  });
}
export function pushManifest() { const ids = P.manifest(); P.chans.forEach((ch: RTCDataChannel) => { try { if (ch.readyState === "open") ch.send(JSON.stringify({ t: "man", ids })); } catch {} }); }
function serve(ch: RTCDataChannel) {
  ch.binaryType = "arraybuffer"; ch.bufferedAmountLowThreshold = 256e3;
  let q = Promise.resolve();
  const hello = () => { P.chans.add(ch); try { ch.send(JSON.stringify({ t: "man", ids: P.manifest() })); } catch {} };
  ch.onopen = hello; if (ch.readyState === "open") hello();
  ch.onclose = () => P.chans.delete(ch);
  ch.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    let m: any; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === "hi") hello();
    if (m.t === "get" && typeof m.f === "string") q = q.then(() => sendFile(ch, m.f)).catch(() => {});
  };
}
async function sendFile(ch: RTCDataChannel, id: string) {
  const b = await sendBlob(id);
  if (!b || ch.readyState !== "open") { if (ch.readyState === "open") ch.send(JSON.stringify({ t: "x", f: id })); return; }
  ch.send(JSON.stringify({ t: "f", f: id, mime: b.type, n: b.size }));
  const buf = await b.arrayBuffer(), CH = 16 * 1024;
  for (let o = 0; o < buf.byteLength; o += CH) {
    if (ch.readyState !== "open") return;
    if (ch.bufferedAmount > 1e6) await new Promise<void>((r) => { const done = () => { ch.removeEventListener("bufferedamountlow", done); r(); }; ch.addEventListener("bufferedamountlow", done); setTimeout(done, 3000); });
    ch.send(buf.slice(o, o + CH));
  }
  ch.send(JSON.stringify({ t: "e", f: id }));
}
/** phones: called with every game state; opens the link the first time the game has media */
export function phoneState(room: any, d: any) {
  if (room && room.onSig && P.fileRoom !== room) { P.fileRoom = room; room.onSig((from: string, m: any) => { if (m && m.t === "file" && from === room.hostId) gotFile(m); }); }
  if (!d || !d.md || P.phone.started || !room || !room.sig || typeof RTCPeerConnection === "undefined") return;
  P.room = room; P.phone.started = true; P.phone.failed = false;
  phoneLink(room).catch(() => { P.phone.failed = true; document.querySelectorAll<HTMLElement>(".mq[data-wait]").forEach((el) => drawMedia(el)); });
}
async function phoneLink(room: any) {
  let host = room.hostId; for (let i = 0; !host && i < 20; i++) { await sleep(100); host = room.hostId; }
  if (!host) throw new Error("no host");
  const pc = new RTCPeerConnection(ICE), ch = pc.createDataChannel("m", { ordered: true });
  ch.binaryType = "arraybuffer"; P.phone.ch = ch;
  pc.onicecandidate = (e) => { if (e.candidate) room.sig(host, { t: "ice", c: e.candidate.toJSON() }).catch(() => {}); };
  room.onSig(async (from: string, d: any) => { if (from !== host) return; try { if (d.t === "answer") await pc.setRemoteDescription(d.sdp); else if (d.t === "ice") await pc.addIceCandidate(d.c).catch(() => {}); } catch {} });
  let cur: { f: string; mime: string; parts: ArrayBuffer[] } | null = null;
  const next = () => { if (P.phone.busy || ch.readyState !== "open") return; const f = P.phone.want.find((x: string) => !P.urls.has(x)); if (!f) return; P.phone.busy = true; ch.send(JSON.stringify({ t: "get", f })); };
  ch.onmessage = (e) => {
    if (typeof e.data !== "string") { if (cur) cur.parts.push(e.data); return; }
    let m: any; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === "man" && Array.isArray(m.ids)) { P.phone.want = m.ids.filter((x: unknown) => typeof x === "string"); next(); }
    else if (m.t === "f") cur = { f: m.f, mime: m.mime, parts: [] };
    else if (m.t === "e" && cur && cur.f === m.f) { P.urls.set(cur.f, URL.createObjectURL(new Blob(cur.parts, { type: cur.mime }))); const f = cur.f; cur = null; P.phone.busy = false; refillWaiting(f); next(); }
    else if (m.t === "x") { P.phone.want = P.phone.want.filter((x: string) => x !== m.f); P.phone.busy = false; next(); }
  };
  await pc.setLocalDescription(await pc.createOffer());
  await room.sig(host, { t: "offer", sdp: pc.localDescription!.toJSON() });
  const ok = await new Promise<boolean>((r) => { if (ch.readyState === "open") r(true); ch.onopen = () => r(true); setTimeout(() => r(false), 15000); });
  if (!ok) { pc.close(); throw new Error("no link"); }
  ch.send(JSON.stringify({ t: "hi" })); // ask for the list again, in case the first one came too early
  setInterval(() => { if (ch.readyState === "open" && !P.phone.busy && P.phone.want.some((x: string) => !P.urls.has(x))) next(); }, 3000);
}
export function phoneReset() { try { P.phone.ch?.close(); } catch {} P.phone = { started: false, failed: false, ch: null, want: [], busy: false }; P.myFile = null; document.querySelector(".pmf-fab")?.remove(); }

// ---------------------------------------------------------------- review the media before the game
export function review(done?: () => void) {
  const tabs: [string, string][] = [["all", "הכל"], ["audio", "🎙️ הקלטות"], ["image", "📸 תמונות"], ["sticker", "🤡 סטיקרים"], ["video", "🎬 סרטונים"]];
  let tab = "all";
  const root = layer("pm-review");
  const draw = () => {
    const list = P.items.filter((it: Item) => tab === "all" || it.kind === tab || (tab === "video" && it.kind === "gif"));
    root.innerHTML = `<div class="pm-sheet">
      <div class="pm-head"><b>עוברים על המדיה</b><button class="pm-x" id="pm-close" aria-label="סגירה">✕</button></div>
      <p class="pm-dim">כל מה שבצ'אט נשאר בטלפון שלך. מקישים על פריט כדי להוריד אותו מהמשחק, ושוב כדי להחזיר.</p>
      <div class="pm-tabs">${tabs.map(([k, t]) => `<button data-t="${k}" aria-pressed="${tab === k}">${t}</button>`).join("")}</div>
      <p class="pm-dim" id="pm-cnt"></p>
      <div class="pm-grid">${list.map((it: Item) => `<button class="pm-tile ${P.excluded.has(it.id) ? "out" : ""}" data-id="${esc(it.id)}" data-k="${it.kind}"><span class="pm-th">${it.kind === "audio" ? "🎙️" : ""}</span><small>${esc(plainName(it.author))}</small><em>✕</em></button>`).join("") || `<p class="pm-dim">אין פה כלום מהסוג הזה.</p>`}</div>
      <button class="pm-btn" id="pm-ok">סיימתי</button></div>`;
    const cnt = () => { const out = P.items.filter((it: Item) => P.excluded.has(it.id)).length; root.querySelector("#pm-cnt")!.textContent = `${fmt(P.items.length - out)} פריטים במשחק${out ? `, ${fmt(out)} הורדו` : ""}`; };
    cnt();
    root.querySelectorAll<HTMLButtonElement>(".pm-tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t!; draw(); }));
    root.querySelectorAll<HTMLButtonElement>(".pm-tile").forEach((b) => (b.onclick = () => {
      const id = b.dataset.id!; if (P.excluded.has(id)) P.excluded.delete(id); else P.excluded.add(id);
      b.classList.toggle("out", P.excluded.has(id)); store.set("pm_ex_" + P.key, [...P.excluded].slice(-2000)); cnt();
      if (b.dataset.k === "audio" && !P.excluded.has(id)) urlOf(id).then((u) => { if (u) { const a = new Audio(u); a.play().catch(() => {}); setTimeout(() => a.pause(), 4000); } });
    }));
    const io = new IntersectionObserver((es) => es.forEach(async (e) => {
      if (!e.isIntersecting) return; io.unobserve(e.target); const t = e.target as HTMLElement, k = t.dataset.k; if (k === "audio") return;
      const u = await urlOf(t.dataset.id!); if (!u) return; const th = t.querySelector(".pm-th")!;
      th.innerHTML = k === "video" || k === "gif" ? `<video src="${u}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${u}" alt="" loading="lazy">`;
    }), { root: root.querySelector(".pm-grid"), rootMargin: "200px" });
    root.querySelectorAll(".pm-tile").forEach((t) => io.observe(t));
    const close = () => { root.remove(); done && done(); };
    root.querySelector<HTMLButtonElement>("#pm-close")!.onclick = close; root.querySelector<HTMLButtonElement>("#pm-ok")!.onclick = close;
  };
  draw();
}

function layer(cls: string) { const d = document.createElement("div"); d.className = "pm-layer " + cls; document.body.append(d); return d; }

// ---------------------------------------------------------------- buying (Bit + a code, approved by hand)
let buyRoot: HTMLElement | null = null;
function closeBuy(unlocked = false) {
  if (!buyRoot) return;
  if (unlocked) { buyRoot.querySelector(".pm-sheet")!.innerHTML = `<div class="pm-done">${budSvg("party", 120)}<h3>נפתח! 🎉</h3><p>הפרימיום פתוח לכל הקבוצה. תהנו!</p><button class="pm-btn" id="pm-ok">יאללה</button></div>`; const r = buyRoot; r.querySelector<HTMLButtonElement>("#pm-ok")!.onclick = () => { r.remove(); }; buyRoot = null; return; }
  buyRoot.remove(); buyRoot = null;
}
function codeFor(k: string) { const all = store.get("pm_codes", {}); if (!all[k]) { all[k] = String(100000 + Math.floor(Math.random() * 900000)); store.set("pm_codes", all); } return all[k] as string; }
function newCode(k: string) { const all = store.get("pm_codes", {}); all[k] = String(100000 + Math.floor(Math.random() * 900000)); store.set("pm_codes", all); return all[k] as string; }
export function buy(from = "") {
  if (P.on) { P.opts?.toast?.("הפרימיום כבר פתוח לקבוצה הזאת 🎉"); return; }
  if (!P.key) { P.opts?.toast?.("צריך קודם להעלות צ'אט של קבוצה"); return; }
  try { P.opts?.net?.bump("pm_open"); if (from) P.opts?.net?.bump("pm_from_" + from); } catch {}
  closeBuy(); buyRoot = layer("pm-buy");
  const sent = (store.get("pm_sent", []) as string[]).includes(P.key);
  sent ? drawWait() : drawBuy();
}
function drawBuy() {
  const root = buyRoot!; const code = codeFor(P.key);
  root.innerHTML = `<div class="pm-sheet">
    <div class="pm-head"><b>פותחים את הפרימיום 🔓</b><button class="pm-x" id="pm-close" aria-label="סגירה">✕</button></div>
    <ul class="pm-list"><li>🎁 הסיכום המלא של השנה, בלי סימן מים</li><li>🎙️ סבב המדיה: הקלטות, תמונות, סטיקרים וסרטונים</li><li>🎓 תעודה מצחיקה לכל שחקן, מוכנה לסטורי</li></ul>
    <div class="pm-price"><b>${PRICE} ₪</b><span>פעם אחת לכל הקבוצה. בלי מנוי, בלי כרטיס אשראי.</span></div>
    <h4 class="pm-h">איך משלמים? 3 צעדים, דקה אחת</h4>
    <div class="pm-step"><span class="pm-n">1</span><div><b>זה הקוד שלכם:</b><div class="pm-code"><span dir="ltr" id="pm-code">${code}</span><button id="pm-copy">העתקה</button></div></div></div>
    <div class="pm-step"><span class="pm-n">2</span><div><b>משלמים בביט, ובהערה מדביקים את הקוד</b>
      <div class="pm-mock" aria-hidden="true"><div><small>סכום</small><b dir="ltr">${PRICE} ₪</b></div><div><small>הערה</small><b dir="ltr">${code}</b></div></div>
      <a class="pm-btn bit" href="${BIT_URL}" target="_blank" rel="noopener" id="pm-bit">לתשלום בביט (הקוד יועתק לבד)</a>
      <details class="pm-more"><summary>משלמים מטלפון אחר? סורקים את הקוד</summary><div class="pm-qr">${P.opts?.qr(BIT_URL) || ""}</div><p class="pm-dim">או מעבירים בביט למספר <b dir="ltr">${BIT_NUM}</b></p></details></div></div>
    <div class="pm-step"><span class="pm-n">3</span><div><b>חוזרים לכאן ולוחצים "שילמתי"</b><span class="pm-dim">אני בודק שהתשלום הגיע ופותח לכם. בדרך כלל זה לוקח כמה דקות, ובלילה עד כמה שעות.</span></div></div>
    <label class="pm-terms"><input type="checkbox" id="pm-ok"><span>קראתי ואני מסכים/ה ל<a href="terms.html" target="_blank" rel="noopener">תקנון הרכישה</a></span></label>
    <button class="pm-btn big" id="pm-paid" disabled>שילמתי ✓</button>
    <p class="pm-err" id="pm-err" hidden></p>
    <details class="pm-faq"><summary>שאלות</summary>
      <p><b>זה בטוח?</b> כן. משלמים בביט הרגיל שלכם, והאתר לא רואה שום פרט תשלום.</p>
      <p><b>למי זה נפתח?</b> לצ'אט הזה, לכל מי שמשחק איתו, גם בטלפונים של החברים.</p>
      <p><b>שכחתי לכתוב את הקוד בהערה.</b> לא נורא, שלחו את הקוד בהודעה לאותו מספר של ביט.</p>
      <p><b>ומה אם זה לא נפתח?</b> אם זה לא נפתח תוך 48 שעות, מחזירים לכם את הכסף.</p></details></div>`;
  root.querySelector<HTMLButtonElement>("#pm-close")!.onclick = () => closeBuy();
  const copy = async () => { try { await navigator.clipboard.writeText(code); return true; } catch { return false; } };
  root.querySelector<HTMLAnchorElement>("#pm-bit")!.onclick = () => { copy().then((ok) => { if (ok) toast(`הקוד ${code} הועתק. מדביקים אותו בהערה בביט 👍`); }); try { P.opts?.net?.bump("pm_bit"); } catch {} };
  root.querySelector<HTMLButtonElement>("#pm-copy")!.onclick = async (e) => { const b = e.currentTarget as HTMLButtonElement; b.textContent = (await copy()) ? "הועתק ✓" : code; };
  const chk = root.querySelector<HTMLInputElement>("#pm-ok")!, paid = root.querySelector<HTMLButtonElement>("#pm-paid")!;
  chk.onchange = () => { paid.disabled = !chk.checked; };
  paid.onclick = async () => {
    paid.disabled = true; paid.textContent = "שולח…";
    const err = root.querySelector<HTMLElement>("#pm-err")!;
    try { await claim(); const s = store.get("pm_sent", []); s.push(P.key); store.set("pm_sent", s.slice(-30)); try { P.opts?.net?.bump("pm_paid"); } catch {} drawWait(); }
    catch { err.hidden = false; err.textContent = "לא הצלחתי לשלוח. בודקים את האינטרנט ומנסים שוב."; paid.disabled = false; paid.textContent = "שילמתי ✓"; }
  };
}
async function claim() {
  const d = db(); if (!d) throw new Error("offline");
  await P.opts.net.uid();
  let code = codeFor(P.key);
  for (let i = 0; i < 4; i++) {
    try { await set(ref(d, `pay/${code}`), { c: P.key, s: "wait", t: serverTimestamp() }); notifyOwner(code); return; }
    catch (e) { if (i === 3) throw e; } // the code is taken (or already sent): try a fresh one
    code = newCode(P.key);
  }
}
function notifyOwner(code: string) {
  if (!MAIL_KEY) return;
  const t = new Date(), hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  fetch("https://api.web3forms.com/submit", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ access_key: MAIL_KEY, subject: `💰 תשלום חדש מחכה לאישור: ${code}`, from_name: "מי אמר את זה?",
      message: `מישהו לחץ "שילמתי" בשעה ${hhmm}.\n\nהקוד: ${code}\nהסכום: ${PRICE} ₪\n\nמה עושים: פותחים את ביט, מחפשים העברה של ${PRICE} ₪ עם הקוד ${code} בהערה, ואז מאשרים בלוח הניהול:\nhttps://mi-amar.co.il/admin.html` }) }).catch(() => {});
}
function drawWait() {
  const root = buyRoot!; const code = codeFor(P.key);
  root.innerHTML = `<div class="pm-sheet"><div class="pm-head"><b>קיבלתי! 🙌</b><button class="pm-x" id="pm-close" aria-label="סגירה">✕</button></div>
    <div class="pm-done">${budSvg("think", 100)}<h3>בודק את התשלום שלכם</h3></div>
    <ol class="pm-wait"><li class="done">✓ שלחתם את הבקשה עם הקוד <b dir="ltr">${code}</b></li><li class="now"><span class="pm-dots"><i></i><i></i><i></i></span> אני בודק בביט שהתשלום הגיע</li><li>🔓 הפרימיום נפתח לבד, גם באמצע משחק</li></ol>
    <p class="pm-dim">בדרך כלל זה לוקח כמה דקות, ובלילה עד כמה שעות. אפשר לסגור את החלון ולהמשיך לשחק, לא צריך לחכות פה.</p>
    <p class="pm-dim">שכחתם לכתוב את הקוד בהערה? שלחו אותו בהודעה לאותו מספר של ביט.</p>
    <button class="pm-btn" id="pm-play">סגור, ממשיכים לשחק</button>
    <button class="pm-btn alt" id="pm-again">עוד לא שילמתי, חזרה לפרטי התשלום</button></div>`;
  root.querySelector<HTMLButtonElement>("#pm-close")!.onclick = () => closeBuy();
  root.querySelector<HTMLButtonElement>("#pm-play")!.onclick = () => closeBuy();
  root.querySelector<HTMLButtonElement>("#pm-again")!.onclick = () => drawBuy();
}

// ---------------------------------------------------------------- the year summary: numbers
const STOP = new Set("את של על זה לא אני אתה מה כן גם יש אם עם הוא היא אז או רק כל לי לך שלי אבל כמו הם אין עוד יותר מי איך למה כי שזה זאת אחד היה יהיה לו לה פה שם עכשיו טוב סתם ההודעה נערכה זו אנחנו אתם הייתי שאני שלא כבר להיות צריך יכול אותו אותי אותך היום מתי איפה הזה הזאת ככה כזה כזאת עד בלי אחרי לפני ממש באמת וגם ואני מאוד עדיין שלך שלו שלה שלנו אולי בסדר נו לך תן יאללה שם ואז היו הנה זהו אחת".split(" "));
function computeWrapped(msgs: Message[]) {
  const all = msgs.filter((m) => m.ts);
  if (all.length < 30) return null;
  const C = <T extends string>() => new Map<T, number>();
  const inc = (m: Map<string, number>, k: string, v = 1) => m.set(k, (m.get(k) || 0) + v);
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
  const first = all[0].ts!, last = all[all.length - 1].ts!;
  const year = new Date(last).getFullYear();
  const days = Math.max(1, Math.round((last - first) / DAY) + 1);
  const by = C(), dayCnt = C(), dayBy = new Map<string, Map<string, number>>(), monthCnt = C(), hours = new Array(24).fill(0), wd = new Array(7).fill(0);
  const stick = C(), voice = C(), laugh = C(), owl = C(), morning = C(), pairs = C(), words = C(), emo = C();
  const kinds: Record<string, number> = {};
  const dkey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const names = new Set<string>(); all.forEach((m) => plainName(m.author).split(/\s+/).forEach((w) => names.add(w)));
  let longest: Message | null = null;
  all.forEach((m, i) => {
    const d = new Date(m.ts!), h = d.getHours();
    inc(by, m.author); hours[h]++; wd[d.getDay()]++;
    const dk = dkey(m.ts!); inc(dayCnt, dk); let db_ = dayBy.get(dk); if (!db_) dayBy.set(dk, (db_ = new Map())); inc(db_, m.author);
    inc(monthCnt, `${d.getFullYear()}-${d.getMonth()}`);
    if (h < 5) inc(owl, m.author); else if (h < 10) inc(morning, m.author);
    if (m.media) { kinds[m.kind || "other"] = (kinds[m.kind || "other"] || 0) + 1; if (m.kind === "sticker") inc(stick, m.author); if (m.kind === "audio") inc(voice, m.author); }
    if (m.text && !m.media) {
      if (/חח{2,}|😂|🤣/.test(m.text)) inc(laugh, m.author);
      for (const w of m.text.match(/[א-ת]{2,}/g) || []) if (!STOP.has(w) && !names.has(w)) inc(words, w);
      for (const e of m.text.match(EMO) || []) inc(emo, e);
      if (!longest || m.text.length > longest.text.length) longest = m;
    }
    const p = all[i - 1];
    if (p && p.author !== m.author && m.ts! - p.ts! < 120000) inc(pairs, [p.author, m.author].sort().join("\u0001"));
  });
  const people = top(by);
  // ---- the spicy part
  // who talks about whom: a person's first name inside other people's messages
  const nick = new Map<string, string>(); people.forEach(([n]) => { const w = plainName(n).split(/\s+/)[0]; if (w && w.length >= 2 && /[\u05d0-\u05ea]/.test(w)) nick.set(n, w); });
  const ment = C(), mentAll = C();
  all.forEach((m) => { if (!m.text || m.media) return; nick.forEach((w, n) => { if (n === m.author) return; const k = (m.text.match(new RegExp(`(^|[^\u05d0-\u05ea])[והבלמש]?${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\u05d0-\u05ea])`, "g")) || []).length; if (k) { inc(ment, m.author + "\u0001" + n, k); inc(mentAll, n, k); } }); });
  const mTop = top(ment)[0], talkedAbout = top(mentAll)[0];
  const mention = mTop && mTop[1] >= 8 ? { from: mTop[0].split("\u0001")[0], to: mTop[0].split("\u0001")[1], n: mTop[1], most: talkedAbout } : null;
  // the question nobody answered: a question followed by the longest silence
  let ghost: any = null;
  all.forEach((m, i) => { const nx = all[i + 1]; if (!nx || !m.text || !/\?\s*$/.test(m.text) || m.text.length < 6) return; const g = nx.ts! - m.ts!; if (g > 4 * 3600e3 && (!ghost || g > ghost.g)) ghost = { g, who: m.author, t: m.text.slice(0, 80), ts: m.ts }; });
  // the secret night talk: two people alone, at night, a lot of messages fast
  let duo: any = null;
  { let run: Message[] = [];
    const flush = () => { const who = new Set(run.map((m) => m.author)); if (run.length >= 16 && who.size === 2) { const mins = Math.max(1, Math.round((run[run.length - 1].ts! - run[0].ts!) / 60000)); if (!duo || run.length > duo.n) duo = { a: [...who], n: run.length, mins, ts: run[0].ts }; } };
    for (const m of all) { const h = new Date(m.ts!).getHours(); const close = run.length && m.ts! - run[run.length - 1].ts! < 15 * 60e3; if ((h < 5 || h >= 23) && (close || !run.length)) run.push(m); else { flush(); run = (h < 5 || h >= 23) ? [m] : []; } } flush(); }
  const delBy = top(all.reduce((mp, m) => { if (m.deleted) inc(mp, m.author); return mp; }, C()))[0];
  const editBy = top(all.reduce((mp, m) => { if (m.edited) inc(mp, m.author); return mp; }, C()))[0];
  // busiest day
  const [bdk, bdn] = top(dayCnt)[0];
  const [by_, bm, bd] = bdk.split("-").map(Number);
  const bdTop = top(dayBy.get(bdk)!)[0];
  const monthDays = Array.from({ length: new Date(by_, bm, 0).getDate() }, (_, i) => dayCnt.get(`${by_}-${bm}-${i + 1}`) || 0);
  // months from first to last
  const months: [string, number][] = []; { const a = new Date(first), b = new Date(last); for (let y = a.getFullYear(), mo = a.getMonth(); y < b.getFullYear() || (y === b.getFullYear() && mo <= b.getMonth()); mo++) { if (mo > 11) { mo = 0; y++; } months.push([`${y}-${mo}`, monthCnt.get(`${y}-${mo}`) || 0]); if (months.length > 24) break; } }
  // the quietest month between two busier ones
  let dead: any = null;
  if (months.length >= 4) { const inner = months.slice(1, -1).map((m, i) => ({ k: m[0], n: m[1], i: i + 1 })); const lo = inner.sort((a, b) => a.n - b.n)[0]; const mx = Math.max(...months.map((m) => m[1])); if (lo && lo.n < mx * .15) { const after = months.slice(lo.i + 1).find((m) => m[1] > lo.n * 3 && m[1] > 10); dead = { m: +lo.k.split("-")[1], n: lo.n, after: after ? { m: +after[0].split("-")[1], n: after[1] } : null }; } }
  // longest silence of someone who is otherwise around
  const lastAt = new Map<string, number>(), gap = new Map<string, { d: number; from: number; to: number }>();
  all.forEach((m) => { const l = lastAt.get(m.author); if (l != null) { const d = m.ts! - l; const g = gap.get(m.author); if (!g || d > g.d) gap.set(m.author, { d, from: l, to: m.ts! }); } lastAt.set(m.author, m.ts!); });
  const gapTop = [...gap].filter(([a]) => (by.get(a) || 0) >= 15).sort((a, b) => b[1].d - a[1].d)[0];
  const missing = gapTop && gapTop[1].d >= 14 * DAY ? { who: gapTop[0], days: Math.round(gapTop[1].d / DAY), from: gapTop[1].from, to: gapTop[1].to, missed: all.filter((m) => m.ts! > gapTop[1].from && m.ts! < gapTop[1].to).length } : null;
  // fastest replies
  const rep = new Map<string, number[]>();
  all.forEach((m, i) => { const p = all[i - 1]; if (p && p.author !== m.author && m.ts! - p.ts! < 3600e3) { let a = rep.get(m.author); if (!a) rep.set(m.author, (a = [])); a.push((m.ts! - p.ts!) / 1000); } });
  const med = (a: number[]) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const fast = [...rep].filter(([, a]) => a.length >= 20).map(([n, a]) => [n, med(a)] as [string, number]).sort((a, b) => a[1] - b[1])[0];
  // the 3am moment: the busiest burst of messages between 2 and 5 at night
  let night: any = null;
  { let best: Message[] = [], cur: Message[] = [];
    for (const m of all) { const h = new Date(m.ts!).getHours(); if (h >= 2 && h < 5 && m.text && !m.media) { if (cur.length && m.ts! - cur[cur.length - 1].ts! > 10 * 60e3) cur = []; cur.push(m); if (cur.length > best.length) best = cur.slice(); } else if (h >= 5) cur = []; }
    if (best.length >= 3) night = { ts: best[0].ts, msgs: best.slice(0, 6).map((m) => ({ a: m.author, t: m.text.slice(0, 90) })) }; }
  const pair = top(pairs);
  const word = top(words)[0];
  const wordBy = word ? top(all.reduce((mp, m) => { const k = (m.text.match(new RegExp(word[0], "g")) || []).length; if (k) inc(mp, m.author, k); return mp; }, C())) [0] : null;
  const emoTop = top(emo)[0];
  const emoBy = emoTop ? top(all.reduce((mp, m) => { const k = (m.text.match(EMO) || []).filter((e) => e === emoTop[0]).length; if (k) inc(mp, m.author, k); return mp; }, C()))[0] : null;
  const owlTop = top(owl)[0];
  const peakH = hours.indexOf(Math.max(...hours));
  let quiet: [number, number] | null = null; { let bs = -1, bl = 0; for (let s = 0; s < 24; s++) { let l = 0; while (l < 12 && hours[(s + l) % 24] === 0) l++; if (l > bl) { bl = l; bs = s; } } if (bl >= 2) quiet = [bs, (bs + bl) % 24]; }
  return {
    year, days, total: all.length, people, first, last, kinds,
    perDay: all.length / days,
    day: { d: bd, m: bm, y: by_, n: bdn, share: Math.round((bdn / all.length) * 100), top: bdTop, month: monthDays },
    stick: top(stick)[0], stickN: kinds.sticker || 0, voice: top(voice)[0], laugh: top(laugh)[0],
    pair: pair[0] ? { a: pair[0][0].split("\u0001"), n: pair[0][1], second: pair[1] ? { a: pair[1][0].split("\u0001"), n: pair[1][1] } : null } : null,
    word: word ? { w: word[0], n: word[1], by: wordBy, more: top(words).slice(1, 9).map((x) => x[0]) } : null,
    emoji: emoTop && emoTop[1] >= 3 ? { e: emoTop[0], n: emoTop[1], by: emoBy, second: top(emo)[1]?.[0] } : null,
    owl: owlTop && owlTop[1] >= 5 ? { who: owlTop[0], n: owlTop[1], morning: morning.get(owlTop[0]) || 0 } : null,
    hours, peakH, quiet, wday: wd.indexOf(Math.max(...wd)),
    months, dead, missing, fast: fast ? { who: fast[0], s: Math.max(1, Math.round(fast[1])) } : null, night,
    mention, ghost: ghost && ghost.g >= 6 * 3600e3 ? ghost : null, duo, deleted: delBy && delBy[1] >= 3 ? delBy : null, edited: editBy && editBy[1] >= 5 ? editBy : null,
    longest: longest && (longest as Message).text.length > 120 ? { who: (longest as Message).author, n: (longest as Message).text.length, t: (longest as Message).text.slice(0, 520) } : null,
  };
}

// awards for the final card and for the certificates: one strong title per person where possible
function awardsOf(D: any) {
  const A: [string, string, string, string][] = []; // emoji, who, title, reason
  const add = (e: string, who: string | undefined, t: string, r: string) => { if (who) A.push([e, who, t, r]); };
  if (D.stick && D.stick[1] >= 5) add("👑", D.stick[0], "מלך הסטיקרים", `${fmt(D.stick[1])} סטיקרים השנה`);
  add("🗣️", D.people[0]?.[0], "הכי חפרן", `${fmt(D.people[0][1])} הודעות השנה`);
  if (D.pair) add("💍", D.pair.a.map(plainName).join(" ו"), "הזוג של הקבוצה", `${fmt(D.pair.n)} תשובות תוך שתי דקות`);
  if (D.owl) add("🦉", D.owl.who, "ינשוף הלילה", `${fmt(D.owl.n)} הודעות בין חצות לחמש`);
  if (D.missing) add("🕵️", D.missing.who, "נעלם מקצועי", `${fmt(D.missing.days)} ימים בלי מילה`);
  if (D.fast) add("⚡", D.fast.who, "עונה לפני שכתבו", `עונה תוך ${fmt(D.fast.s)} שניות`);
  if (D.voice && D.voice[1] >= 3) add("🎙️", D.voice[0], "פודקאסטר לא רשמי", `${fmt(D.voice[1])} הקלטות`);
  if (D.laugh && D.laugh[1] >= 3) add("😂", D.laugh[0], "מלך ה״חחחח״", `צחק ${fmt(D.laugh[1])} פעמים`);
  if (D.longest) add("📜", D.longest.who, "כותב ספרים", `הודעה של ${fmt(D.longest.n)} תווים`);
  if (D.word?.by) add("🔁", D.word.by[0], `שגריר ה״${D.word.w}״`, `אמר ״${D.word.w}״ ${fmt(D.word.by[1])} פעמים`);
  if (D.emoji?.by) add(D.emoji.e, D.emoji.by[0], "מלך האימוג'י", `${D.emoji.e} ${fmt(D.emoji.by[1])} פעמים`);
  return A;
}
function titleFor(D: any, name: string, used: Set<string>) {
  const mine = awardsOf(D).filter((a) => a[1] === name || a[1].split(" ו").includes(plainName(name)));
  const pick = mine.find((a) => !used.has(a[2])) || mine[0];
  if (pick) { used.add(pick[2]); return { e: pick[0], t: pick[2], r: pick[3] }; }
  const n = D.people.find((p: any) => p[0] === name);
  if (!n) return { e: "🎟️", t: "אורח כבוד", r: "לא כתב אף מילה בקבוצה, ובכל זאת בא לשחק" };
  const rank = D.people.findIndex((p: any) => p[0] === name);
  return rank > D.people.length / 2 ? { e: "🤫", t: "שקט אבל מסוכן", r: `רק ${fmt(n[1])} הודעות, אבל כל אחת שווה זהב` } : { e: "⭐", t: "עמוד תווך", r: `${fmt(n[1])} הודעות שמחזיקות את הקבוצה בחיים` };
}

// ---------------------------------------------------------------- the year summary: the story
let W: any = null;
export function hasWrapped() { if (!P.wrapped && P.msgs.length) P.wrapped = computeWrapped(P.msgs); return !!P.wrapped; }
export function wrappedYear() { return hasWrapped() ? P.wrapped.year : new Date().getFullYear(); }
export function openWrapped() {
  if (!hasWrapped()) { P.opts?.toast?.("צריך צ'אט ארוך יותר בשביל סיכום"); return; }
  try { P.opts?.net?.bump("wrapped_open"); } catch {}
  P.opts?.music?.pause();
  const host = layer("pmw"), sr = host.attachShadow({ mode: "open" });
  W = { D: P.wrapped, host, root: sr as any, cur: -1, t0: 0, paused: false, pausedAt: 0, timers: [] as any[], raf: 0, slides: [] as any[], ac: null as any, fav: null as any };
  W.root.innerHTML = `<style>${WCSS}</style><div class="pw-ph"><div class="pw-bg"></div><div class="pw-band"></div><div class="pw-bars"></div>
    <div class="pw-hud"><div class="pw-who"><span class="pw-dot">💬</span><span>${esc(P.name || "הקבוצה")} <span class="pw-meta">סיכום ${W.D.year}</span></span></div><div class="pw-row"><button class="pw-ib" id="pw-mute" aria-label="השתקה">🔊</button><button class="pw-ib" id="pw-x" aria-label="סגירה">✕</button></div></div>
    <div class="pw-pill"></div><div class="pw-stage"></div><canvas class="pw-fx"></canvas><div class="pw-toast"></div>
    <div class="pw-start">${budSvg("party", 150)}<div class="st l w" style="--c:var(--pw-yellow)">${W.D.year}</div><div class="st s">הסיכום של הקבוצה</div>
      <p class="pw-sub">בובי עבר על כל ההודעות של ${esc(P.name || "הקבוצה")}.<br>הוא ראה דברים. דברים שאי אפשר לשכוח.</p>
      <button class="pw-btn" id="pw-go">יאללה, תראה לנו 😬</button><p class="pw-small">עם סאונד זה פי אלף יותר טוב 🔊<br>הקשה בצד שמאל מעבירה קדימה, בצד ימין אחורה. לחיצה ארוכה עוצרת.</p></div></div>`;
  favSticker();
  build();
  const ph = W.root.querySelector(".pw-ph");
  W.root.querySelector("#pw-x").onclick = (e: Event) => { e.stopPropagation(); closeWrapped(); };
  W.root.querySelector("#pw-mute").onclick = (e: any) => { e.stopPropagation(); W.muted = !W.muted; e.currentTarget.textContent = W.muted ? "🔇" : "🔊"; if (W.master) W.master.gain.value = W.muted ? 0 : .9; };
  W.root.querySelector("#pw-go").onclick = () => { try { initAudio(); } catch {} sfx("slap"); const st = W.root.querySelector(".pw-start"); st.style.transition = ".45s"; st.style.opacity = 0; st.style.transform = "scale(1.08)"; setTimeout(() => st.remove(), 450); go(0); W.raf = requestAnimationFrame(tick); };
  let downAt = 0;
  ph.addEventListener("pointerdown", (e: PointerEvent) => { if ((e.target as HTMLElement).closest("button,a,.pw-start")) return; downAt = W.pausedAt = performance.now(); W.paused = true; });
  ph.addEventListener("pointerup", (e: PointerEvent) => { if (!W.paused) return; const held = performance.now() - downAt; W.t0 += performance.now() - W.pausedAt; W.paused = false; if (held < 260 && !(e.target as HTMLElement).closest("button,a")) { const r = ph.getBoundingClientRect(); (e.clientX - r.left) < r.width * .62 ? next() : prev(); } });
  ph.addEventListener("pointercancel", () => { if (W.paused) { W.t0 += performance.now() - W.pausedAt; W.paused = false; } });
  W.key = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") next(); if (e.key === "ArrowRight") prev(); if (e.key === "Escape") closeWrapped(); };
  addEventListener("keydown", W.key);
  const fx = W.root.querySelector(".pw-fx"), fit = () => { const r = ph.getBoundingClientRect(); fx.width = r.width * devicePixelRatio; fx.height = r.height * devicePixelRatio; }; fit(); W.fit = fit; addEventListener("resize", fit);
}
function closeWrapped() {
  if (!W) return; W.timers.forEach(clearTimeout); cancelAnimationFrame(W.raf); clearInterval(W.music); try { W.ac && W.ac.close(); } catch {}
  removeEventListener("keydown", W.key); removeEventListener("resize", W.fit); W.host.remove(); W = null; P.opts?.music?.resume();
}
async function favSticker() {
  const D = W.D; if (!D.stick || !P.entries.size) return;
  const files = P.msgs.filter((m) => m.kind === "sticker" && m.author === D.stick[0] && m.file && P.entries.has(m.file)).slice(-300);
  const seen = new Map<string, { n: number; id: string }>();
  for (const m of files) { try { const b: Uint8Array = await P.entries.get(m.file!).async("uint8array"); let h = 0; for (let i = 0; i < b.length; i += 7) h = (Math.imul(h, 31) + b[i]) | 0; const k = b.length + ":" + h; const s = seen.get(k); if (s) s.n++; else seen.set(k, { n: 1, id: m.file! }); } catch {} }
  const best = [...seen.values()].sort((a, b) => b.n - a.n)[0];
  if (best && W) { W.fav = { url: await urlOf(best.id), n: best.n }; const el = W.root.querySelector("#pw-fav"); if (el) fillFav(el); }
}
const fillFav = (el: HTMLElement) => { if (W.fav?.url) el.innerHTML = `<img src="${W.fav.url}" alt="">${W.fav.n > 1 ? `<span>נשלח ${fmt(W.fav.n)} פעמים!</span>` : ""}`; };

function build() {
  const D = W.D, p0 = D.people[0], S: any[] = [], nm = (n: string) => esc(plainName(n));
  const big = (n: string) => plainName(n).length > 11 ? "m" : "l";
  const hit = (ms: number, f = "slap", c = 0) => later(() => { sfx(f); vib(25); if (c) confetti(c); }, ms);
  S.push({ free: 1, bg: "#3b2a8f", band: "#7b5cff", bt: "58%", dur: 6500, html: `
    <div class="lbl r" style="--d:.1s">${fmt(D.days)} ימים, ${fmt(D.people.length)} אנשים, צ'אט אחד</div>
    <div class="st xl w slap" style="--d:.3s;--c:var(--pw-yellow)">${D.year}</div>
    <div class="st ${plainName(P.name || "").length > 12 ? "s" : "m"} slap" style="--d:.6s;--rot:2deg">של ${esc(P.name || "הקבוצה")}</div>
    <div class="z" style="--d:.9s">${budSvg("party", 140)}</div>
    <p class="lead r" style="--d:1.2s">עברתי על כל ההודעות שלכם.<br>כן, גם על אלה של 2 בלילה.</p>`, enter() { hit(300); hit(600); hit(950, "boom", 90); } });
  const k = D.kinds, chips = [[k.sticker, "🤡", "סטיקרים"], [k.audio, "🎙️", "הקלטות"], [k.image, "📸", "תמונות"], [(k.video || 0) + (k.gif || 0), "🎬", "סרטונים"]].filter((c) => c[0]);
  S.push({ free: 1, bg: "#ff3d7f", band: "#ff7aa8", bt: "20%", dur: 7500, html: `
    <div class="lbl r">השנה הזאת שלחתם</div>
    <div class="st xl w z num" style="--d:.2s;--c:var(--pw-yellow)" id="pc1">0</div>
    <div class="st m slap" style="--d:1.3s">הודעות</div>
    <p class="lead r" style="--d:1.7s">${D.perDay >= 1 ? `בערך ${fmt(D.perDay)} ביום. מישהו פה עובד בכלל? 🤨` : `קבוצה רגועה. אולי מדי. 😴`}</p>
    <div class="chips">${chips.map((c, i) => `<span class="chip r" style="--d:${2.1 + i * .15}s">${c[1]} ${fmt(c[0] as number)} ${c[2]}</span>`).join("")}</div>`,
    enter() { later(() => count("#pc1", D.total), 250); hit(1300); chips.forEach((_, i) => later(() => sfx("pop"), 2100 + i * 150)); } });
  const opts4 = shuffle(D.people.slice(0, 4).map((p: any) => p[0]));
  if (opts4.length >= 2) S.push({ free: 1, guess: 1, bg: "#1f7ae0", band: "#5fb4ff", bt: "62%", dur: 0, html: `
    <div class="z">${budSvg("think", 96)}</div>
    <div class="st m slap" style="--d:.2s">רגע, תנחשו</div>
    <p class="lead r" style="--d:.5s">מי הכי חפרן בקבוצה?</p>
    <div class="opts r" style="--d:.7s" id="popts">${opts4.map((o: string) => `<button class="pw-opt" data-w="${o === p0[0] ? 1 : 0}">${nm(o)}</button>`).join("")}</div>
    <div class="race" id="prace" hidden></div><p class="sub" id="pgres" style="min-height:48px"></p>`,
    enter() { hit(200); W.root.querySelectorAll(".pw-opt").forEach((b: HTMLButtonElement) => (b.onclick = (e) => { e.stopPropagation(); answer(b); })); } });
  if (!P.on) S.push({ lock: 1, bg: "#17112e", band: "#2a1f55", bt: "30%", dur: 0, html: `
    <div class="lockbig">🔒</div>
    <div class="st m slap" style="--d:.3s">מפה זה כבר רכילות כבדה</div>
    <div class="peek r" style="--d:.6s">${[["#ffa928", "👑"], ["#2a1f55", "🌙"], ["#ff3d7f", "💍"], ["#3fe0b0", "🕵️"], ["#5fb4ff", "⚡"], ["#ffd23f", "😭"]].map(([c, e]) => `<div style="background:${c}">${e}</div>`).join("")}</div>
    <p class="sub r" style="--d:.8s">עוד המון שקופיות: מלך הסטיקרים, הזוג של הקבוצה, ההודעה של 3 בלילה, מי נעלם, ועוד.</p>
    <div class="st s w r" style="--d:1s;--c:var(--pw-yellow)">${PRICE} ₪</div>
    <p class="small r" style="--d:1.05s">פעם אחת לכל הקבוצה, בביט. בלי מנוי ובלי כרטיס אשראי.<br>כולל גם את סבב המדיה ואת התעודות.</p>
    <button class="pw-btn r" style="--d:1.2s" id="punlock">לפתוח לכולם 🔓</button>`,
    enter() { later(() => sfx("lock"), 900); W.root.querySelector("#punlock").onclick = (e: Event) => { e.stopPropagation(); buy("wrapped"); }; } });
  const premium: any[] = [];
  { const d = D.day, mx = Math.max(...d.month, 1);
    premium.push({ bg: "#232a6e", band: "#3f3bd6", bt: "55%", dur: 8000, html: `
    <div class="lbl r">היום הכי משוגע של השנה</div>
    <div class="cal drop" style="--d:.2s"><div>${MONTHS[d.m - 1]}</div><div>${d.d}</div></div>
    <div class="spark r" style="--d:.7s" id="psp">${d.month.map((v: number, i: number) => `<i class="${i === d.d - 1 ? "hot" : ""}" data-h="${(v / mx) * 100}"></i>`).join("")}</div>
    <div><span class="st l w num slap" style="--d:1.3s;--c:var(--pw-yellow)" id="pc2">0</span></div>
    <div class="st s r" style="--d:1.5s">הודעות ביום אחד</div>
    <p class="lead r" style="--d:2.1s">${d.share >= 5 ? `זה ${d.share}% מכל השנה. ביום אחד.<br>` : ""}${nm(d.top[0])} אחראי/ת ל־${fmt(d.top[1])} מהן. מה קרה שם?? 👀</p>`,
    enter() { later(() => sfx("whoosh"), 200); hit(900); later(() => W.root.querySelectorAll("#psp i").forEach((b: HTMLElement) => (b.style.height = b.dataset.h + "%")), 750); later(() => count("#pc2", d.n), 1300); hit(1350, "boom"); } }); }
  if (D.stick && D.stick[1] >= 5) premium.push({ bg: "#ffa928", band: "#ffd23f", bt: "8%", dur: 8500, html: `
    <div class="rain" id="prain"></div><p class="pre dark">ועכשיו… 🥁</p>
    <div class="slap" style="--d:1.5s;--rot:-6deg;font-size:84px;line-height:1">👑</div>
    <div class="lbl r dark" style="--d:1.6s">מלך הסטיקרים</div>
    <div class="st ${big(D.stick[0])} w slap" style="--d:1.75s;--c:var(--pw-pink)">${nm(D.stick[0])}</div>
    <div class="st m r num" style="--d:2.1s"><span id="pc3">0</span> סטיקרים</div>
    <div class="stk drop" style="--d:2.5s;--rot:4deg" id="pw-fav">${budSvg("laugh", 90)}</div>
    <p class="lead r dark" style="--d:2.9s">במקום לכתוב מילה, שולחים פרצוף.</p>`,
    enter() { sfx("roll"); hit(1550, "boom", 170); later(() => { count("#pc3", D.stick[1], 900); rain(["🤡", "😭", "💀", "🫠", "🤣"]); }, 1600); const el = W.root.querySelector("#pw-fav"); if (el) fillFav(el); } });
  if (D.night) premium.push({ bg: "#0d0b2e", band: "#1d1450", bt: "70%", dur: 4000 + D.night.msgs.length * 900, html: `<div class="stars"></div>
    <div class="lbl r">ההודעה הכי מוזרה של 3 בלילה</div>
    <div class="st l z num" style="--d:.2s;--c:var(--pw-sky);--oc:#0d0b2e;--sc:#5fb4ff66">${new Date(D.night.ts).toTimeString().slice(0, 5)}</div>
    <p class="small r" style="--d:.4s">${new Date(D.night.ts).getDate()} ב${MONTHS[new Date(D.night.ts).getMonth()]}, כולם היו אמורים לישון</p>
    <div class="chat" id="pchat">${D.night.msgs.map((m: any, i: number) => `<div class="msg ${m.a !== D.night.msgs[0].a && i % 2 ? "me" : ""}"><small>${nm(m.a)}</small>${esc(m.t)}</div>`).join("")}</div>
    <p class="lead r" style="--d:${1 + D.night.msgs.length * .78}s">אף אחד פה לא ישן. ואף אחד פה לא נורמלי.</p>`,
    enter() { W.root.querySelectorAll("#pchat .msg").forEach((m: HTMLElement, i: number) => later(() => { m.classList.add("show"); sfx("pop"); vib(10); }, 900 + i * 780)); } });
  if (D.pair && D.pair.n >= 10) { const [a, b] = D.pair.a; premium.push({ bg: "#ff5fa2", band: "#ff9fc8", bt: "64%", dur: 8000, html: `
    <div class="lbl r">הזוג של הקבוצה</div>
    <div class="duo"><div class="av drop" style="--d:.2s;background:var(--pw-yellow);--rot:-6deg">${esc([...plainName(a)][0])}</div><div class="heart">💞</div><div class="av drop" style="--d:.45s;background:var(--pw-mint);--rot:6deg">${esc([...plainName(b)][0])}</div></div>
    <div class="st ${(plainName(a) + plainName(b)).length > 14 ? "s" : "m"} slap" style="--d:1.1s">${nm(a)} ו${nm(b)}</div>
    <div class="st l w num r" style="--d:1.4s;--c:var(--pw-yellow)" id="pc7">0</div>
    <p class="lead r" style="--d:1.6s">פעמים שאחד ענה לשני תוך שתי דקות.</p>
    <p class="sub r" style="--d:2.2s">זה כבר לא חברות. זה נישואים. 💍${D.pair.second ? `<br>במקום השני: ${nm(D.pair.second.a[0])} ו${nm(D.pair.second.a[1])}, עם ${fmt(D.pair.second.n)}.` : ""}</p>`,
    enter() { hit(250); hit(500); later(() => { sfx("ding"); confetti(90, ["#fff", "#ff3d7f", "#ffd23f"]); }, 900); later(() => count("#pc7", D.pair.n), 1400); } }); }
  if (D.word && D.word.n >= 10) premium.push({ bg: "#3fe0b0", band: "#9ff3d6", bt: "12%", dur: 8000, html: `
    <div class="lbl r dark">המילה של השנה</div>
    <div class="st ${D.word.w.length > 5 ? "l" : "xl"} slap" style="--d:.3s;--c:var(--pw-ink);--oc:#fff;--sc:#0e7a5c">${esc(D.word.w)}</div>
    <div class="st m r num" style="--d:.9s"><span id="pc8">0</span> פעמים</div>
    <div class="cloud">${D.word.more.map((w: string, i: number) => `<span style="font-size:${42 - i * 2}px;color:${i % 2 ? "var(--pw-ink)" : "#fff"};animation-delay:${1.5 + i * .12}s">${esc(w)}</span>`).join("")}</div>
    ${D.word.by ? `<p class="lead r dark" style="--d:2.6s">${nm(D.word.by[0])} לבד: ${fmt(D.word.by[1])} פעמים.<br>יש עוד מילים בעברית, נשבע.</p>` : ""}`,
    enter() { hit(300, "boom", 60); later(() => count("#pc8", D.word.n), 900); } });
  if (D.emoji) premium.push({ bg: "#2b59c3", band: "#3f7bff", bt: "60%", dur: 7500, html: `
    <div class="lbl r">האימוג'י של השנה</div>
    <div class="z" style="--d:.2s;font-size:150px;line-height:1">${D.emoji.e}</div>
    <div class="st m slap" style="--d:.8s">${fmt(D.emoji.n)} פעמים</div>
    ${D.emoji.by ? `<p class="lead r" style="--d:1.2s">${fmt(D.emoji.by[1])} מהם של ${nm(D.emoji.by[0])}.${D.emoji.second ? `<br>במקום השני: ${D.emoji.second}` : ""}</p>` : ""}`,
    enter() { hit(300, "boom"); hit(800); } });
  if (D.owl) premium.push({ bg: "#1d1450", band: "#2f2280", bt: "18%", dur: 8000, html: `<div class="stars"></div>
    <div class="z" style="--d:.1s;font-size:86px;line-height:1">🦉</div>
    <div class="lbl r" style="--d:.3s">ינשוף הלילה</div>
    <div class="st ${big(D.owl.who)} w slap" style="--d:.5s;--c:var(--pw-yellow);--oc:#1d1450;--sc:#ffd23f55">${nm(D.owl.who)}</div>
    <div class="st m r num" style="--d:.9s"><span id="pc9">0</span> הודעות</div>
    <p class="lead r" style="--d:1.2s">בין חצות לחמש בבוקר.</p>
    <p class="sub r" style="--d:1.8s">${D.owl.morning ? `ובבוקר שוב פה, עם עוד ${fmt(D.owl.morning)} הודעות.<br>` : ""}מתי ישנים בכלל?</p>`,
    enter() { hit(500); later(() => count("#pc9", D.owl.n), 900); } });
  premium.push({ bg: "#7b5cff", band: "#a48cff", bt: "66%", dur: 8000, html: `
    <div class="lbl r">השעה של הקבוצה</div>
    <svg class="clockc r" style="--d:.2s" viewBox="0 0 250 250" id="pclk">${clockSvg(D.hours, D.peakH)}</svg>
    <div class="st l w slap num" style="--d:1.4s;--c:var(--pw-yellow)">${String(D.peakH).padStart(2, "0")}:00</div>
    <p class="lead r" style="--d:1.7s">${D.peakH >= 6 && D.peakH < 18 ? `ב־${D.peakH > 12 ? D.peakH - 12 : D.peakH} ב${D.peakH < 12 ? "בוקר" : "צהריים"} הקבוצה בוערת.` : `ב־${D.peakH}:00 הקבוצה בוערת. בלילה. כן.`}${D.quiet ? `<br>בין ${D.quiet[0]} ל־${D.quiet[1]}: אפס הודעות.` : ""}</p>
    <p class="sub r" style="--d:2.2s">היום הכי חם בשבוע: ${WDAYS[D.wday]}.</p>`,
    enter() { later(() => { W.root.querySelector("#pclk")?.classList.add("go"); sfx("whoosh"); }, 400); hit(1400, "boom"); } });
  if (D.dead) { const mx = Math.max(...D.months.map((m: any) => m[1]), 1); premium.push({ bg: "#2a1f55", band: "#3b2a8f", bt: "14%", dur: 8500, html: `
    <div class="lbl r">החודש שבו הקבוצה כמעט מתה</div>
    <div class="months r" style="--d:.3s" id="pmon">${D.months.slice(-12).map((m: any) => { const mo = +m[0].split("-")[1]; const dd = mo === D.dead.m && m[1] === D.dead.n; return `<div class="${dd ? "dead" : ""}"><span>${dd ? "💀" : fmt(m[1])}</span><i data-h="${Math.max(3, (m[1] / mx) * 120)}"></i><span>${MSHORT[mo]}</span></div>`; }).join("")}</div>
    <div class="st l w slap" style="--d:1.6s;--c:var(--pw-pink)">${MONTHS[D.dead.m]}</div>
    <div class="st m r num" style="--d:1.9s">${fmt(D.dead.n)} הודעות</div>
    <p class="lead r" style="--d:2.3s">בחודש שלם. היו פה גלגלי קוצים.</p>
    ${D.dead.after ? `<p class="sub r" style="--d:2.8s">וב${MONTHS[D.dead.after.m]}? הקבוצה קמה לתחייה עם ${fmt(D.dead.after.n)}. 🧟</p>` : ""}`,
    enter() { later(() => W.root.querySelectorAll("#pmon i").forEach((b: HTMLElement, i: number) => setTimeout(() => (b.style.height = b.dataset.h + "px"), i * 90)), 400); later(() => sfx("sad"), 1500); hit(1650); } }); }
  if (D.missing) { const f = new Date(D.missing.from), t = new Date(D.missing.to); premium.push({ bg: "#19c39a", band: "#3fe0b0", bt: "68%", dur: 8500, html: `
    <div class="lbl r dark">מי נעלם הכי הרבה זמן</div>
    <div class="poster drop" style="--d:.3s"><div class="t">ראיתם?</div><div class="face">🫥</div><div class="n">${nm(D.missing.who)}</div>
      <p>נראה/תה לאחרונה בקבוצה ב־${f.getDate()} ב${MONTHS[f.getMonth()]}.<br>חזר/ה רק ב־${t.getDate()} ב${MONTHS[t.getMonth()]}.</p></div>
    <div><span class="st l w num slap" style="--d:1.2s;--c:var(--pw-yellow)" id="pc4">0</span></div>
    <div class="st s r" style="--d:1.4s">ימים בלי מילה</div>
    <p class="lead r dark" style="--d:1.9s">בזמן הזה התפספסו ${fmt(D.missing.missed)} הודעות. חשבנו שעבר/ה לחו״ל.</p>`,
    enter() { later(() => sfx("whoosh"), 300); hit(1000); later(() => count("#pc4", D.missing.days), 1200); hit(1250, "boom"); } }); }
  if (D.voice && D.voice[1] >= 3) premium.push({ bg: "#ffd23f", band: "#ffe68a", bt: "58%", dur: 7500, html: `
    <div class="z" style="--d:.1s;font-size:76px;line-height:1">🎙️</div>
    <div class="lbl r dark" style="--d:.25s">מלך ההקלטות</div>
    <div class="st ${big(D.voice[0])} w slap" style="--d:.45s;--c:var(--pw-purple)">${nm(D.voice[0])}</div>
    <div class="wave r" style="--d:.8s">${Array.from({ length: 26 }, (_, i) => `<i style="animation-delay:-${(i * 137 % 100) / 100}s"></i>`).join("")}</div>
    <div class="st m r num" style="--d:1s"><span id="pc5">0</span> הקלטות</div>
    <p class="lead r dark" style="--d:1.6s">${D.stick && D.stick[0] === D.voice[0] ? "שוב. כן, שוב. " : ""}פשוט תתקשרו כבר 📞</p>`,
    enter() { hit(450, "boom"); later(() => count("#pc5", D.voice[1], 900), 1000); } });
  if (D.laugh && D.laugh[1] >= 3) premium.push({ bg: "#ff7a3d", band: "#ffa928", bt: "20%", dur: 7500, html: `
    <div class="haha">${Array.from({ length: 9 }, () => `<div>חחחחחחחחחחחחחחחחחחחח</div>`).join("")}</div>
    <div class="lbl r dark">מלך ה״חחחח״</div>
    <div class="z" style="--d:.2s">${budSvg("laugh", 120)}</div>
    <div class="st ${big(D.laugh[0])} w slap" style="--d:.5s;--c:var(--pw-yellow)">${nm(D.laugh[0])}</div>
    <div class="st m r num" style="--d:.9s"><span id="pc6">0</span> פעמים</div>
    <p class="lead r dark" style="--d:1.5s">צוחק מכל דבר. גם ממה שלא היה מצחיק.</p>`,
    enter() { hit(500, "boom", 80); later(() => count("#pc6", D.laugh[1], 800), 900); } });
  if (D.fast) premium.push({ bg: "#3f3bd6", band: "#5fb4ff", bt: "62%", dur: 7500, html: `
    <div class="lbl r">מי עונה הכי מהר</div>
    <svg class="gauge r" style="--d:.2s" viewBox="0 0 230 125"><path d="M15 115A100 100 0 0 1 215 115" fill="none" stroke="#ffffff33" stroke-width="18" stroke-linecap="round"/><path d="M15 115A100 100 0 0 1 215 115" fill="none" stroke="#ffd23f" stroke-width="18" stroke-linecap="round" stroke-dasharray="314" stroke-dashoffset="314" id="parc" style="transition:stroke-dashoffset 1.4s var(--pw-out)"/><g class="needle" id="pnd"><path d="M115 115L115 28" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g><circle cx="115" cy="115" r="11" fill="#fff" stroke="#1d1636" stroke-width="4"/></svg>
    <div class="st ${big(D.fast.who)} slap" style="--d:1.4s">${nm(D.fast.who)}</div>
    <div class="st m w r" style="--d:1.7s;--c:var(--pw-yellow)">עונה תוך ${fmt(D.fast.s)} שניות</div>
    <p class="lead r" style="--d:2.2s">עונים לפני שסיימו לכתוב.<br>יש התראות רק על הקבוצה הזאת?</p>`,
    enter() { later(() => { const n = W.root.querySelector("#pnd"), a = W.root.querySelector("#parc"); if (n) n.style.transform = "rotate(78deg)"; if (a) a.style.strokeDashoffset = "20"; sfx("whoosh"); }, 400); hit(1450, "boom", 70); } });
  if (D.longest) premium.push({ bg: "#fff3d1", band: "#ffd23f", bt: "10%", dur: 10000, html: `
    <div class="lbl r dark">ההודעה הכי ארוכה של השנה</div>
    <div class="st ${big(D.longest.who)} w slap" style="--d:.2s;--c:var(--pw-pink)">${nm(D.longest.who)}</div>
    <div class="scroll card drop" style="--d:.5s"><div class="in">${esc(D.longest.t)}</div></div>
    <div class="st m w r num" style="--d:1.1s;--c:var(--pw-yellow)">${fmt(D.longest.n)} תווים</div>
    <p class="lead r dark" style="--d:1.6s">בהודעה אחת. מישהו פה כותב ספר. 📜</p>`,
    enter() { hit(200); later(() => sfx("whoosh"), 500); } });
  if (D.mention) { const m = D.mention; premium.splice(1, 0, { bg: "#c81e5a", band: "#ff3d7f", bt: "60%", dur: 8500, html: `
    <div class="lbl r">מי מדבר על מי 👀</div>
    <div class="st m w slap" style="--d:.3s;--c:var(--pw-yellow)">${nm(m.from)}</div>
    <p class="lead r" style="--d:.7s">הזכיר את השם של</p>
    <div class="st ${big(m.to)} w slap" style="--d:1.1s;--c:#fff;--oc:var(--pw-ink)">${nm(m.to)}</div>
    <div class="st l w num r" style="--d:1.5s;--c:var(--pw-yellow)" id="pcm">0</div>
    <p class="lead r" style="--d:1.8s">פעמים. יותר מכל אחד אחר בקבוצה.</p>
    <p class="sub r" style="--d:2.4s">צירוף מקרים? בובי לא חושב. 🤨${m.most && m.most[0] !== m.to ? `<br>ובאופן כללי, על ${nm(m.most[0])} מדברים הכי הרבה פה.` : ""}</p>`,
    enter() { sfx("roll"); hit(1100, "boom", 90); later(() => count("#pcm", m.n), 1500); } }); }
  if (D.duo) { const [a, b] = D.duo.a, tm = new Date(D.duo.ts).toTimeString().slice(0, 5); premium.push({ bg: "#140f33", band: "#2a1f55", bt: "66%", dur: 8500, html: `<div class="stars"></div>
    <div class="lbl r">השיחה הסודית של הלילה 🌙</div>
    <div class="duo"><div class="av drop" style="--d:.2s;background:var(--pw-pink);--rot:-6deg">${esc([...plainName(a)][0])}</div><div class="heart">🤫</div><div class="av drop" style="--d:.45s;background:var(--pw-sky);--rot:6deg">${esc([...plainName(b)][0])}</div></div>
    <div class="st ${(plainName(a) + plainName(b)).length > 14 ? "s" : "m"} w slap" style="--d:1s;--c:var(--pw-yellow);--oc:#140f33;--sc:#ffd23f55">${nm(a)} ו${nm(b)}</div>
    <p class="lead r" style="--d:1.4s">${fmt(D.duo.n)} הודעות ב־${fmt(D.duo.mins)} דקות, ב־${tm}.<br>רק שניהם. כל השאר ישנו.</p>
    <p class="sub r" style="--d:2s">על מה מדברים בשעה כזאת? 👀</p>`,
    enter() { hit(300); hit(550); later(() => sfx("ding"), 1000); } }); }
  if (D.ghost) { const g = D.ghost, h = Math.round(g.g / 3600e3); premium.push({ bg: "#4a4a5e", band: "#6b6b85", bt: "16%", dur: 8000, html: `
    <div class="lbl r">השאלה שאף אחד לא ענה עליה 🦗</div>
    <div class="chat" style="max-width:300px"><div class="msg show" style="opacity:1;transform:none"><small>${nm(g.who)}</small>${esc(g.t)}</div></div>
    <div class="st xl w slap num" style="--d:.8s;--c:var(--pw-yellow)">${fmt(h)}</div>
    <div class="st s r" style="--d:1.1s">שעות של שקט מוחלט</div>
    <p class="lead r" style="--d:1.6s">כולם ראו. כולם התעלמו. 💀</p>`,
    enter() { later(() => sfx("sad"), 700); hit(800, "boom"); } }); }
  if (D.deleted) premium.push({ bg: "#2b0f1f", band: "#5c1438", bt: "56%", dur: 7500, html: `
    <div class="z" style="--d:.1s;font-size:84px;line-height:1">🗑️</div>
    <div class="lbl r" style="--d:.3s">מלך המחיקות</div>
    <div class="st ${big(D.deleted[0])} w slap" style="--d:.5s;--c:var(--pw-pink)">${nm(D.deleted[0])}</div>
    <div class="st m r num" style="--d:.9s">${fmt(D.deleted[1])} הודעות נמחקו</div>
    <p class="lead r" style="--d:1.4s">מה היה כתוב שם?<br>אף אחד לא יודע. חוץ מכל מי שהספיק לקרוא. 👀</p>`,
    enter() { hit(500, "boom"); } });
  const aw = awardsOf(D).slice(0, 8);
  premium.push({ last: 1, bg: "#3b2a8f", band: "#7b5cff", bt: "40%", dur: 0, html: `
    <div class="st m w slap" style="--d:.1s;--c:var(--pw-yellow)">הפרסים של ${D.year}</div>
    <div class="fin z" style="--d:.4s;--rot:-1deg"><div class="awards">${aw.map((a) => `<div class="aw"><em>${a[0]}</em><b>${nm(a[1])}</b><span>${esc(a[2])}</span></div>`).join("")}</div>${P.on ? "" : `<div class="wmk">מי אמר את זה?</div>`}</div>
    <div class="row r" style="--d:.8s"><button class="pw-btn" id="psave">📲 שמירה לסטורי</button><button class="pw-btn alt" id="pagain">↻ מההתחלה</button></div>
    <p class="small r" style="--d:1s">${P.on ? "נשמר נקי, בלי סימן מים." : "בחינם נשמר עם סימן מים. בפרימיום נקי לגמרי."}</p>`,
    enter() { hit(100); later(() => { sfx("ding"); confetti(200); }, 500); W.root.querySelector("#psave").onclick = (e: Event) => { e.stopPropagation(); sfx("pop"); saveStory(); }; W.root.querySelector("#pagain").onclick = (e: Event) => { e.stopPropagation(); go(0); }; } });
  W.slides = P.on ? [...S, ...premium] : [...S, ...premium.slice(-1).map((s) => ({ ...s, html: s.html }))];
  // without premium the free story is: 3 free slides, the lock, and the final card with a watermark
  if (!P.on) W.slides = [...S, premium[premium.length - 1]];
  W.premium = premium; W.free = S;
  W.root.querySelector(".pw-bars").innerHTML = W.slides.map(() => "<i><b></b></i>").join("");
}
// a purchase in the middle of the story: rebuild and continue right after the free part
on((e) => { if (e === "unlock" && W) { const at = W.free.filter((s: any) => !s.lock).length; build(); go(at); toastW("נפתח לכל הקבוצה! 🎉"); confetti(200); } });

function answer(b: HTMLButtonElement) {
  const s = W.slides[W.cur]; if (s.answered) return; s.answered = 1; const right = b.dataset.w === "1", D = W.D;
  W.root.querySelectorAll(".pw-opt").forEach((o: HTMLButtonElement) => { o.disabled = true; if (o.dataset.w === "1") o.classList.add("win"); else if (o === b) o.classList.add("lose"); });
  if (right) { sfx("ding"); confetti(120); vib([20, 30, 20]); } else { sfx("buzz"); vib(120); }
  later(() => {
    const o = W.root.querySelector("#popts"); o.style.transition = ".3s"; o.style.opacity = 0;
    setTimeout(() => { if (!W) return; o.remove(); const r = W.root.querySelector("#prace"); r.hidden = false; const T = D.people.slice(0, 6), mx = T[0][1];
      r.innerHTML = T.map((t: any) => `<div><span>${esc(plainName(t[0]))}</span><i></i><em>${fmt(t[1])}</em></div>`).join("");
      requestAnimationFrame(() => requestAnimationFrame(() => r.querySelectorAll("i").forEach((i: HTMLElement, k: number) => (i.style.width = (T[k][1] / mx) * 58 + "%")))); sfx("whoosh"); }, 300);
    const gap = D.people[1] ? D.people[0][1] - D.people[1][1] : 0, w = plainName(D.people[0][0]);
    W.root.querySelector("#pgres").innerHTML = right ? `<b>בול!</b> אתם מכירים את החפרן שלכם.${gap ? ` ${esc(w)} ניצח/ה בהפרש של ${fmt(gap)} הודעות.` : ""}` : `<b>לא!</b> זה ${esc(w)}.${gap && gap < D.people[0][1] * .1 ? " אבל היה צמוד." : ""}`;
    s.dur = 6500; W.t0 = performance.now();
  }, 900);
}
function go(i: number) {
  if (!W || i < 0 || i >= W.slides.length) return;
  W.timers.forEach(clearTimeout); W.timers = [];
  const stage = W.root.querySelector(".pw-stage"), old = stage.querySelector(".slide");
  if (old) { old.classList.add("leave"); setTimeout(() => old.remove(), 320); }
  W.cur = i; const s = W.slides[i]; if (s.guess) { s.answered = 0; s.dur = 0; }
  W.root.querySelector(".pw-bg").style.backgroundColor = s.bg; const bd = W.root.querySelector(".pw-band"); bd.style.backgroundColor = s.band; bd.style.top = s.bt;
  const el = document.createElement("section"); el.className = "slide"; el.innerHTML = s.html; stage.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
  [...W.root.querySelector(".pw-bars").children].forEach((b: any, k) => (b.firstChild.style.width = k < i ? "100%" : "0"));
  W.root.querySelector(".pw-pill").textContent = s.free ? `חינם, ${i + 1} מתוך ${W.free.filter((x: any) => x.free).length}` : s.lock ? "🔒 פרימיום" : "⭐ פרימיום";
  W.energy = Math.min(1, i / 6); if (i > 0) sfx("whoosh");
  s.enter && s.enter(); W.t0 = performance.now(); W.paused = false;
}
const next = () => { if (W && W.cur < W.slides.length - 1) go(W.cur + 1); };
const prev = () => { if (W) go(Math.max(0, W.cur - 1)); };
function tick(t: number) { if (!W) return; const s = W.slides[W.cur]; if (s && s.dur && !W.paused) { const k = (t - W.t0) / s.dur; W.root.querySelector(".pw-bars").children[W.cur].firstChild.style.width = Math.min(100, k * 100) + "%"; if (k >= 1) next(); } W.raf = requestAnimationFrame(tick); }
const later = (fn: () => void, ms: number) => { if (W) W.timers.push(setTimeout(fn, ms)); };
function count(sel: string, to: number, ms = 1300) { const el = W?.root.querySelector(sel); if (!el) return; const t0 = performance.now(); (function f(t: number) { const k = Math.min(1, (t - t0) / ms), v = Math.round(to * (1 - Math.pow(1 - k, 3))); el.textContent = v.toLocaleString("he-IL"); if (k < 1 && Math.random() < .3) sfx("tick"); if (k < 1) requestAnimationFrame(f); })(t0); }
function rain(em: string[]) { const r = W?.root.querySelector("#prain"); if (!r) return; for (let i = 0; i < 24; i++) { const s = document.createElement("span"); s.textContent = em[i % em.length]; s.style.left = Math.random() * 92 + "%"; s.style.animationDuration = 1.8 + Math.random() * 1.8 + "s"; s.style.animationDelay = Math.random() * 1.2 + "s"; r.append(s); } }
const vib = (ms: any) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
function toastW(t: string) { const e = W?.root.querySelector(".pw-toast"); if (!e) return; e.textContent = t; e.classList.add("show"); setTimeout(() => e.classList.remove("show"), 2600); }
function clockSvg(H: number[], peak: number) {
  const m = Math.max(...H, 1), p = (a: number, R: number) => [125 + Math.cos(a) * R, 125 + Math.sin(a) * R].map((n) => n.toFixed(1)).join(" ");
  let s = `<circle cx="125" cy="125" r="118" fill="#fff3d1" stroke="#1d1636" stroke-width="4"/>`;
  H.forEach((v, h) => { const a0 = (h / 24) * 2 * Math.PI - Math.PI / 2 + .02, a1 = ((h + 1) / 24) * 2 * Math.PI - Math.PI / 2 - .02, r = 26 + (v / m) * 84;
    s += `<path d="M${p(a0, 24)}L${p(a0, r)}A${r} ${r} 0 0 1 ${p(a1, r)}L${p(a1, 24)}Z" fill="${h === peak ? "#ff3d7f" : v < m * .08 ? "#c9bff0" : "#7b5cff"}" stroke="#1d1636" stroke-width="2" style="transition-delay:${h * .035}s"/>`; });
  ["0", "6", "12", "18"].forEach((t, i) => { const a = i * Math.PI / 2 - Math.PI / 2; s += `<text x="${(125 + Math.cos(a) * 104).toFixed(1)}" y="${(130 + Math.sin(a) * 104).toFixed(1)}" font-size="14" font-weight="700" text-anchor="middle" fill="#1d1636">${t}</text>`; });
  return s + `<circle cx="125" cy="125" r="20" fill="#1d1636"/>`;
}

// ---- story sound: a tiny synth, no files
function initAudio() {
  const AC = window.AudioContext || (window as any).webkitAudioContext; const ac = new AC(); W.ac = ac;
  W.master = ac.createGain(); W.master.gain.value = W.muted ? 0 : .9; W.master.connect(ac.destination);
  W.mg = ac.createGain(); W.mg.gain.value = .3; const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4200; W.mg.connect(lp); lp.connect(W.master);
  let step = 0, nt = ac.currentTime + .05; W.duck = 1;
  const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
  W.music = setInterval(() => { if (!W) return; const spb = 60 / 104 / 4; while (nt < ac.currentTime + .12) { const s = step % 16, ch = CH[Math.floor(step / 16) % 4], e = W.energy || 0;
    W.mg.gain.setTargetAtTime(.3 * W.duck, nt, .1);
    if (s % 4 === 0) osc("sine", 150, nt, .28, .9, W.mg, 40);
    if (s === 4 || s === 12) noise(nt, .16, .35 * (.5 + e), "bandpass", 1800, W.mg);
    if (s % 2 === 1) noise(nt, .04, .18, "highpass", 7000, W.mg);
    if (s % 4 === 2) osc("triangle", hz(ch[0] - 12), nt, .22, .5, W.mg);
    if (e > .3 && s % 2 === 0) osc("square", hz(ch[(s / 2) % 3] + 12), nt, .09, .06, W.mg);
    if (s === 0) ch.forEach((n) => osc("sawtooth", hz(n), nt, 1.6, .025, W.mg));
    nt += spb; step++; } }, 25);
}
function osc(type: OscillatorType, f: number, t: number, d: number, v: number, dest?: AudioNode, f2?: number) { const ac = W.ac, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + .005 + d); o.connect(g); g.connect(dest || W.master); o.start(t); o.stop(t + d + .05); }
let NB: AudioBuffer | null = null;
function noise(t: number, d: number, v: number, ft: BiquadFilterType, ff: number, dest?: AudioNode, ff2?: number) { const ac = W.ac; if (!NB || NB.sampleRate !== ac.sampleRate) { NB = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const c = NB!.getChannelData(0); for (let i = 0; i < c.length; i++) c[i] = Math.random() * 2 - 1; } const s = ac.createBufferSource(); s.buffer = NB; const f = ac.createBiquadFilter(); f.type = ft; f.frequency.setValueAtTime(ff, t); if (ff2) f.frequency.exponentialRampToValueAtTime(ff2, t + d); f.Q.value = ft === "bandpass" ? 2 : .7; const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .01 + d); s.connect(f); f.connect(g); g.connect(dest || W.master); s.start(t); s.stop(t + d + .05); }
function sfx(k: string) {
  if (!W || !W.ac || W.muted) return; const t = W.ac.currentTime;
  if (k === "whoosh") noise(t, .35, .35, "bandpass", 400, undefined, 3500);
  else if (k === "ding") { osc("sine", 1318, t, .6, .25); osc("sine", 1976, t + .07, .7, .18); osc("triangle", 659, t, .4, .2); }
  else if (k === "pop") osc("sine", 600, t, .09, .3, undefined, 1300);
  else if (k === "slap") { noise(t, .12, .6, "lowpass", 2500); osc("sine", 180, t, .25, .7, undefined, 50); }
  else if (k === "boom") { osc("sine", 120, t, .6, 1, undefined, 30); noise(t, .5, .5, "lowpass", 900); }
  else if (k === "roll") { W.duck = .25; for (let i = 0; i < 24; i++) noise(t + 1.35 * (1 - Math.pow(1 - i / 24, 1.6)), .05, .18 + i * .012, "bandpass", 900); setTimeout(() => { if (W) W.duck = 1; }, 1500); }
  else if (k === "lock") { osc("square", 220, t, .08, .15); osc("square", 160, t + .1, .12, .15); }
  else if (k === "tick") osc("square", 2400, t, .02, .05);
  else if (k === "buzz") { osc("sawtooth", 110, t, .35, .25); osc("sawtooth", 104, t, .35, .25); }
  else if (k === "sad") [392, 370, 349, 330].forEach((f, i) => osc("triangle", f, t + i * .28, .4, .25));
}
function confetti(n = 120, cols = ["#ffd23f", "#ff3d7f", "#3fe0b0", "#5fb4ff", "#fff"]) {
  if (!W) return; const cv = W.root.querySelector(".pw-fx"), cx = cv.getContext("2d"), WW = cv.width, H = cv.height; W.parts = W.parts || []; const was = W.parts.length;
  for (let i = 0; i < n; i++) W.parts.push({ x: WW / 2 + (Math.random() - .5) * WW * .3, y: H * .42, vx: (Math.random() - .5) * WW * .03, vy: -Math.random() * H * .03 - H * .008, r: (4 + Math.random() * 6) * devicePixelRatio, c: cols[i % cols.length], a: Math.random() * 6, va: (Math.random() - .5) * .4, life: 1 });
  if (was) return;
  (function loop() { if (!W) return; cx.clearRect(0, 0, cv.width, cv.height); W.parts.forEach((p: any) => { p.vy += cv.height * .0009; p.x += p.vx; p.y += p.vy; p.vx *= .985; p.a += p.va; p.life -= .006; cx.save(); cx.globalAlpha = Math.max(0, p.life); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); cx.restore(); }); W.parts = W.parts.filter((p: any) => p.life > 0 && p.y < cv.height + 40); if (W.parts.length) requestAnimationFrame(loop); else cx.clearRect(0, 0, cv.width, cv.height); })();
}

// ---------------------------------------------------------------- images for stories (1080×1920)
function budSvg(mood: string, size: number) { return `<span class="buddy m-${mood}" style="--bs:${size}px;display:inline-block;width:${size}px;aspect-ratio:172/200">${P.opts?.buddy || ""}</span>`; }
async function budImage(mood: string) {
  const svg = (P.opts?.buddy || "").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="344" height="400" ').replace("<ellipse", `<style>[data-m]{display:none}[data-m~="${mood}"]{display:inline}</style><ellipse`);
  const im = new Image(); im.src = "data:image/svg+xml," + encodeURIComponent(svg); try { await im.decode(); } catch {} return im;
}
async function fonts() { try { await Promise.all([document.fonts.load('700 120px "Karantina"'), document.fonts.load('400 40px "Varela Round"')]); } catch {} }
function stickerText(c: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, fill: string, out = "#fff", shadow = "#1d1636", maxW = 960) {
  c.font = `700 ${size}px Karantina, "Varela Round", sans-serif`; let s = size; while (c.measureText(t).width > maxW && s > 40) { s -= 6; c.font = `700 ${s}px Karantina, "Varela Round", sans-serif`; }
  c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "rtl"; c.lineJoin = "round";
  c.lineWidth = s * .16; c.strokeStyle = shadow; c.strokeText(t, x, y + s * .1); c.fillStyle = shadow; c.fillText(t, x, y + s * .1);
  c.lineWidth = s * .16; c.strokeStyle = out; c.strokeText(t, x, y); c.fillStyle = fill; c.fillText(t, x, y);
}
function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function dots(c: CanvasRenderingContext2D, col: string) { c.save(); c.fillStyle = col; for (let y = 0; y < 1920; y += 34) for (let x = (y / 34) % 2 ? 17 : 0; x < 1080; x += 34) { c.beginPath(); c.arc(x, y, 3.2, 0, 7); c.fill(); } c.restore(); }
function textLine(c: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, col: string, weight = 400, maxW = 940) {
  c.font = `${weight} ${size}px "Varela Round", sans-serif`; c.fillStyle = col; c.textAlign = "center"; c.textBaseline = "middle"; c.direction = "rtl";
  const words = t.split(" "), lines: string[] = []; let cur = ""; for (const w of words) { const n = cur ? cur + " " + w : w; if (c.measureText(n).width > maxW && cur) { lines.push(cur); cur = w; } else cur = n; } if (cur) lines.push(cur);
  lines.forEach((l, i) => c.fillText(l, x, y + i * size * 1.35)); return lines.length * size * 1.35;
}
async function saveStory() {
  const D = W.D, aw = awardsOf(D).slice(0, 8); await fonts();
  const cv = document.createElement("canvas"); cv.width = 1080; cv.height = 1920; const c = cv.getContext("2d")!;
  c.fillStyle = "#3b2a8f"; c.fillRect(0, 0, 1080, 1920); c.save(); c.translate(540, 960); c.rotate(-.16); c.fillStyle = "#7b5cff"; c.fillRect(-900, 120, 1800, 640); c.restore(); dots(c, "#ffffff1c");
  stickerText(c, `הפרסים של ${D.year}`, 540, 230, 150, "#ffd23f");
  textLine(c, P.name || "הקבוצה", 540, 360, 46, "#fff", 700);
  const bw = 440, bh = 250, gx = 40, top = 440;
  aw.forEach((a, i) => { const col = i % 2, row = Math.floor(i / 2), x = col ? 80 : 80 + bw + gx, y = top + row * (bh + 34);
    c.fillStyle = "#1d1636"; rr(c, x, y + 12, bw, bh, 30); c.fill(); c.fillStyle = "#fff3d1"; rr(c, x, y, bw, bh, 30); c.fill(); c.lineWidth = 7; c.strokeStyle = "#1d1636"; c.stroke();
    c.font = '64px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(a[0], x + bw / 2, y + 62);
    stickerText(c, plainName(a[1]), x + bw / 2, y + 140, 74, "#1d1636", "#fff3d1", "#fff3d1", bw - 40);
    textLine(c, a[2], x + bw / 2, y + 205, 32, "#5a4a8a", 700, bw - 40); });
  const bud = await budImage("party"); c.drawImage(bud, 540 - 120, 1560, 240, 279);
  textLine(c, "מי אמר את זה?", 540, 1870, 40, "#fff", 700);
  if (!P.on) { c.save(); c.globalAlpha = .18; c.fillStyle = "#fff"; c.font = '700 120px Karantina, sans-serif'; c.textAlign = "center"; c.translate(540, 960); c.rotate(-.45); for (let y = -1200; y < 1200; y += 260) c.fillText("מי אמר את זה?", 0, y); c.restore(); textLine(c, "נוצר בחינם ב־mi-amar.co.il", 540, 1500, 38, "#ffd23f", 700); }
  await share(cv, `סיכום-${D.year}.png`, "הסיכום של הקבוצה");
}
async function share(cv: HTMLCanvasElement, name: string, title: string) {
  const blob: Blob | null = await new Promise((r) => cv.toBlob(r, "image/png")); if (!blob) return;
  const file = new File([blob], name, { type: "image/png" });
  try { if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return; } } catch (e: any) { if (e && e.name === "AbortError") return; }
  const u = URL.createObjectURL(blob), root = layer("pm-img");
  root.innerHTML = `<div class="pm-sheet"><div class="pm-head"><b>התמונה מוכנה</b><button class="pm-x" aria-label="סגירה">✕</button></div><img src="${u}" alt="${esc(title)}"><p class="pm-dim">בטלפון: לחיצה ארוכה על התמונה ואז שמירה.</p><a class="pm-btn" href="${u}" download="${esc(name)}">להוריד את התמונה</a></div>`;
  root.querySelector<HTMLButtonElement>(".pm-x")!.onclick = () => root.remove();
}

// ---------------------------------------------------------------- certificates
// funny titles: every person gets the thing they are most "the worst" at, and nobody gets the same title twice
function personFacts(msgs: Message[]) {
  const F = new Map<string, any>(), get = (n: string) => { let f = F.get(n); if (!f) F.set(n, (f = { n: 0, stick: 0, voice: 0, img: 0, night: 0, morning: 0, laugh: 0, q: 0, edit: 0, achi: 0, long: 0, stretch: 0, tag: 0, start: 0, gap: 0, reps: [] as number[], emo: new Map<string, number>(), last: 0 })); return f; };
  let prev: Message | null = null;
  for (const m of msgs) {
    if (!m.ts) continue; const f = get(m.author), h = new Date(m.ts).getHours();
    f.n++; if (h < 5) f.night++; else if (h < 10) f.morning++;
    if (f.last && m.ts - f.last > f.gap) f.gap = m.ts - f.last; f.last = m.ts;
    if (!prev || m.ts - prev.ts! > 3 * 3600e3) f.start++;
    else if (prev.author !== m.author && m.ts - prev.ts! < 3600e3) f.reps.push((m.ts - prev.ts!) / 1000);
    if (m.media) { if (m.kind === "sticker") f.stick++; else if (m.kind === "audio") f.voice++; else if (m.kind === "image") f.img++; }
    if (m.edited) f.edit++;
    const t = m.text || "";
    if (t) {
      if (/חח{2,}|😂|🤣/.test(t)) f.laugh++;
      if (/\?/.test(t)) f.q++;
      f.achi += (t.match(/אחי/g) || []).length;
      if (/([א-ת])\1{3,}/.test(t)) f.stretch++;
      if (/@כולם|@everyone|@all/i.test(t)) f.tag++;
      if (t.length > f.long) f.long = t.length;
      for (const e of t.match(EMO) || []) f.emo.set(e, (f.emo.get(e) || 0) + 1);
    }
    prev = m;
  }
  F.forEach((f) => { const r = f.reps.slice().sort((a: number, b: number) => a - b); f.fast = r.length >= 15 ? r[Math.floor(r.length / 2)] : 0; const e = [...f.emo].sort((a, b) => b[1] - a[1])[0]; f.fe = e && e[1] >= 5 ? e : null; });
  return F;
}
type Title = { e: string; t: string; r: string; tag: string };
// [metric, minimum, emoji, title, reason, danger level 1-3]
const TITLES: [string, number, string, string, (v: number, f: any) => string, number][] = [
  ["n", 50, "🗣️", "חופר בדרגת דוקטורט", (v) => `${fmt(v)} הודעות השנה. האצבעות ביקשו חופש והוא אמר לא.`, 3],
  ["stick", 8, "🤡", "מילים זה למתחילים", (v) => `${fmt(v)} סטיקרים. כתב משפט שלם פעם אחת, ב־2019.`, 2],
  ["voice", 4, "🎙️", "פודקאסטר בלי מאזינים", (v) => `${fmt(v)} הקלטות. אף אחד לא שמע אחת מהן עד הסוף.`, 3],
  ["night", 15, "🧛", "ערפד מוסמך", (v) => `${fmt(v)} הודעות בין חצות לחמש. השמש? לא מכירים.`, 3],
  ["gapd", 14, "🕵️", "נעלם במשולש ברמודה", (v) => `${fmt(v)} ימים בלי מילה. כבר הדפסנו מודעות.`, 2],
  ["fastn", 1, "⚡", "אין לו חיים, יש לו התראות", (v, f) => `עונה תוך ${fmt(f.fast)} שניות. הטלפון דבוק לו ליד.`, 3],
  ["laugh", 8, "😂", "קהל מקצועי", (v) => `צחק ${fmt(v)} פעמים. גם כשזה ממש לא היה מצחיק.`, 1],
  ["long", 250, "📜", "כותב ספרים בקבוצה", (v) => `הודעה אחת של ${fmt(v)} תווים. אף אחד לא קרא עד הסוף.`, 2],
  ["q", 15, "❓", "גוגל של העניים", (v) => `${fmt(v)} שאלות בקבוצה. יש גוגל, אחי. בחינם.`, 2],
  ["edit", 4, "✏️", "העורך הראשי", (v) => `ערך ${fmt(v)} הודעות. כולם כבר ראו מה היה כתוב שם.`, 2],
  ["start", 8, "🧟", "מעיר המתים", (v) => `החיה את הקבוצה ${fmt(v)} פעמים אחרי שכולם נעלמו.`, 1],
  ["achi", 15, "🤝", "שגריר ה״אחי״", (v) => `אמר ״אחי״ ${fmt(v)} פעמים. אחי. די.`, 1],
  ["img", 8, "📸", "פפראצי של הקבוצה", (v) => `${fmt(v)} תמונות. אף אחד לא ביקש אף אחת מהן.`, 2],
  ["morning", 25, "🐓", "תרנגול הבוקר", (v) => `${fmt(v)} הודעות לפני 10 בבוקר. מי מדבר בשעות האלה??`, 1],
  ["stretch", 6, "🫠", "מאריך אותיותתתתת", (v) => `${fmt(v)} הודעות עם אותיות כפולותתתת. המקלדת בוכה.`, 1],
  ["tag", 3, "📢", "הרמקול של הקבוצה", (v) => `תייג את כולם ${fmt(v)} פעמים. כולם שונאים את זה בשקט.`, 3],
  ["emo", 5, "🔁", "מכונת אימוג׳ים", (v, f) => `${f.fe[0]} ${fmt(f.fe[1])} פעמים. זה כבר לא אימוג׳י, זו אישיות.`, 1],
];
function certTitles(players: string[]): Map<string, Title> {
  const F = personFacts(P.msgs), out = new Map<string, Title>(), used = new Set<string>();
  const val = (f: any, k: string) => k === "gapd" ? f.gap / DAY : k === "fastn" ? (f.fast ? 1 / f.fast : 0) : k === "emo" ? (f.fe ? f.fe[1] : 0) : f[k] || 0;
  const disp = (f: any, k: string) => k === "gapd" ? Math.round(f.gap / DAY) : val(f, k);
  const minOk = (f: any, k: string, min: number) => k === "fastn" ? !!f.fast && f.fast < 40 : disp(f, k) >= min;
  const inChat = players.filter((p) => F.has(p));
  // every (person, title) pair, scored by how far ahead of everyone else the person is
  const pairs: [number, string, number][] = [];
  TITLES.forEach(([k, min], ti) => {
    const vals = inChat.map((p) => val(F.get(p), k)), mx = Math.max(...vals, 0); if (!mx) return;
    inChat.forEach((p, i) => { const f = F.get(p); if (!minOk(f, k, min)) return; const sorted = vals.slice().sort((a, b) => b - a); const lead = vals[i] / (sorted[sorted[0] === vals[i] ? 1 : 0] || vals[i] / 2 || 1); pairs.push([(vals[i] === mx ? 2 : 0) + Math.min(lead, 3), p, ti]); });
  });
  pairs.sort((a, b) => b[0] - a[0]);
  for (const [, p, ti] of pairs) { if (out.has(p) || used.has(TITLES[ti][3])) continue; const [k, , e, t, r, d] = TITLES[ti]; const f = F.get(p); out.set(p, { e: k === "emo" && f.fe ? f.fe[0] : e, t, r: r(disp(f, k), f), tag: "🔥".repeat(d) }); used.add(t); }
  for (const p of players) if (!out.has(p)) {
    const f = F.get(p);
    out.set(p, !f ? { e: "🎟️", t: "אורח כבוד", r: "לא כתב אף מילה בקבוצה, ובא לאסוף נקודות על חשבוננו.", tag: "🔥" }
      : f.n < 40 ? { e: "👀", t: "הצופה השקט", r: `רק ${fmt(f.n)} הודעות. קורא הכל, לא אומר כלום. מפחיד.`, tag: "🔥🔥" }
      : { e: "🧱", t: "רהיט של הקבוצה", r: `${fmt(f.n)} הודעות. תמיד שם, אף פעם לא במרכז. כמו ספה.`, tag: "🔥" });
  }
  return out;
}
const placeLine = (place: number, score: number, total: number) => !score ? "" : place === 1 ? `👑 ניצח את כולם הערב עם ${fmt(score)} נקודות` : place === total && total > 2 ? `מקום אחרון במשחק. לפחות התעודה יפה.` : `מקום ${place} במשחק, ${fmt(score)} נקודות`;

export function certificates(players: string[], scores: Record<string, number>, from = "end") {
  if (!P.on) { buy(from); return; }
  if (!P.msgs.length) { P.opts?.toast?.("צריך להעלות את הצ'אט בשביל תעודות"); return; }
  try { P.opts?.net?.bump("certs_open"); } catch {}
  const T = certTitles(players), rank = Object.entries(scores || {}).sort((a, b) => b[1] - a[1]).map((r) => r[0]);
  const list = players.map((p) => ({ p, ...T.get(p)!, place: rank.indexOf(p) + 1, score: scores?.[p] || 0, total: players.length }));
  let cur = 0;
  const root = layer("pm-certs");
  root.innerHTML = `<div class="pm-sheet wide"><div class="pm-head"><b>🎓 התעודות של הערב</b><button class="pm-x" aria-label="סגירה">✕</button></div>
    <div class="pm-cview"><canvas width="1080" height="1920" id="pm-cv"></canvas></div>
    <div class="pm-cnav"><button class="pm-nav" id="pm-prev" aria-label="הקודמת">→</button><span id="pm-cnt"></span><button class="pm-nav" id="pm-next" aria-label="הבאה">←</button></div>
    <button class="pm-btn" id="pm-save">📲 שמירה לסטורי</button></div>`;
  root.querySelector<HTMLButtonElement>(".pm-x")!.onclick = () => root.remove();
  const cv = root.querySelector<HTMLCanvasElement>("#pm-cv")!; let bud: HTMLImageElement | null = null;
  const show = async (i: number) => {
    cur = (i + list.length) % list.length; root.querySelector("#pm-cnt")!.textContent = `${cur + 1} מתוך ${list.length}`;
    if (!bud) { await fonts(); bud = await budImage("party"); }
    drawCert(cv, list[cur], bud); cv.animate([{ transform: "translateX(30px) rotate(2deg)", opacity: .3 }, { transform: "none", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,1.4,.4,1)" });
  };
  root.querySelector<HTMLButtonElement>("#pm-next")!.onclick = () => show(cur + 1);
  root.querySelector<HTMLButtonElement>("#pm-prev")!.onclick = () => show(cur - 1);
  root.querySelector<HTMLButtonElement>("#pm-save")!.onclick = () => share(cv, `תעודה-${plainName(list[cur].p)}.png`, "תעודה מ״מי אמר את זה?״");
  // swipe on the certificate itself
  let x0 = 0; cv.addEventListener("pointerdown", (e) => { x0 = e.clientX; }); cv.addEventListener("pointerup", (e) => { const dx = e.clientX - x0; if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1)); });
  root.querySelector<HTMLElement>(".pm-cnav")!.hidden = list.length < 2;
  show(0);
}
function drawCert(cv: HTMLCanvasElement, x: any, bud: HTMLImageElement) {
  const c = cv.getContext("2d")!, cols = ["#ff3d7f", "#7b5cff", "#19c39a", "#ffa928", "#3f7bff"], acc = cols[[...x.p].reduce((a: number, ch: string) => a + ch.charCodeAt(0), 0) % cols.length];
  c.clearRect(0, 0, 1080, 1920); c.fillStyle = acc; c.fillRect(0, 0, 1080, 1920); dots(c, "#ffffff22");
  c.fillStyle = "#1d1636"; rr(c, 70, 150, 940, 1650, 50); c.fill(); c.fillStyle = "#fff3d1"; rr(c, 70, 130, 940, 1650, 50); c.fill(); c.lineWidth = 10; c.strokeStyle = "#1d1636"; c.stroke();
  c.setLineDash([18, 14]); c.lineWidth = 5; c.strokeStyle = acc; rr(c, 110, 170, 860, 1570, 36); c.stroke(); c.setLineDash([]);
  textLine(c, `תעודה מס׳ ${String(1000 + ([...x.p].reduce((a: number, ch: string) => a * 31 + ch.charCodeAt(0), 7) >>> 0) % 9000)}`, 540, 225, 30, "#8a7bb8", 700);
  stickerText(c, "תעודה רשמית", 540, 320, 120, acc, "#fff", "#1d1636");
  textLine(c, "ועדת הצ'אט מעניקה בגאווה (ובבושה) ל", 540, 430, 38, "#5a4a8a", 700);
  stickerText(c, plainName(x.p), 540, 560, 170, "#1d1636", "#fff3d1", "#fff3d1", 860);
  c.font = '140px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(x.e, 540, 760);
  textLine(c, "את התואר", 540, 870, 40, "#5a4a8a", 700);
  stickerText(c, x.t, 540, 975, 118, acc, "#fff", "#1d1636", 880);
  // the reason in a speech bubble, the joke lives here
  c.fillStyle = "#fff"; rr(c, 150, 1060, 780, 200, 34); c.fill(); c.lineWidth = 6; c.strokeStyle = "#1d1636"; c.stroke();
  c.beginPath(); c.moveTo(760, 1258); c.lineTo(800, 1305); c.lineTo(820, 1258); c.closePath(); c.fill(); c.stroke(); c.fillStyle = "#fff"; c.fillRect(756, 1250, 70, 8);
  textLine(c, x.r, 540, 1125, 44, "#1d1636", 700, 700);
  textLine(c, `רמת סכנה: ${x.tag}`, 540, 1345, 40, "#5a4a8a", 700);
  const pl = placeLine(x.place, x.score, x.total); if (pl) textLine(c, pl, 540, 1410, 40, acc === "#ffa928" ? "#b26b00" : acc, 700, 860);
  c.drawImage(bud, 150, 1410, 230, 268);
  c.save(); c.strokeStyle = "#1d1636"; c.lineWidth = 4; c.beginPath(); c.moveTo(180, 1690); c.bezierCurveTo(220, 1668, 250, 1708, 290, 1678); c.bezierCurveTo(310, 1668, 330, 1693, 350, 1683); c.stroke(); c.restore();
  textLine(c, "בובי, יו״ר הוועדה", 265, 1715, 26, "#5a4a8a", 700, 300);
  c.save(); c.translate(770, 1580); c.rotate(-.22); c.beginPath(); c.arc(0, 0, 150, 0, 7); c.fillStyle = acc; c.fill(); c.lineWidth = 8; c.strokeStyle = "#1d1636"; c.stroke();
  c.beginPath(); c.arc(0, 0, 122, 0, 7); c.setLineDash([10, 8]); c.lineWidth = 4; c.strokeStyle = "#fff"; c.stroke(); c.setLineDash([]);
  stickerText(c, "מי אמר", 0, -30, 74, "#fff", "#1d1636", "#1d1636", 240); stickerText(c, "את זה?", 0, 45, 74, "#ffd23f", "#1d1636", "#1d1636", 240); c.restore();
  textLine(c, `${P.name || "הקבוצה"} · ${new Date().getDate()} ב${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()} · אין ערעורים`, 540, 1761, 26, "#5a4a8a", 700, 860);
}

// ---------------------------------------------------------------- selling it: home showcase + a teaser built from the group's own chat
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
export function showcaseHtml() {
  return `<section class="pmx-show" aria-label="פרימיום">
    <div class="pmx-ring"></div><div class="pmx-spark" aria-hidden="true"><i>✨</i><i>⭐</i><i>✨</i><i>💫</i><i>✨</i></div>
    <span class="pmx-badge">⭐ חדש · פרימיום</span>
    <h3 class="pmx-t">הצ'אט שלכם מסתיר סודות. <span>בובי מוצא את כולם.</span></h3>
    <div class="pmx-tiles">
      <div class="pmx-tile"><div class="pmx-phone"><div class="pmx-f f1"><small>מלך הסטיקרים</small><b>???</b><em>142 סטיקרים</em></div><div class="pmx-f f2"><small>ההודעה של 3 בלילה</small><span class="pmx-bub">אחי מישהו ער?</span><span class="pmx-bub me">מה קרה</span></div><div class="pmx-f f3"><small>מי נעלם</small><b>87</b><em>ימים בלי מילה</em></div></div><b>🎁 הסיכום של השנה</b><span>כמו של ספוטיפיי, רק על הקבוצה שלכם</span></div>
      <div class="pmx-tile"><div class="pmx-voice"><span>▶︎</span><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><b>🎙️ של מי הקול?</b><span>הקלטות, תמונות וסטיקרים אמיתיים מהקבוצה</span></div>
      <div class="pmx-tile"><div class="pmx-cert"><small>תעודה רשמית</small><b>ערפד מוסמך</b><em>🧛 רמת סכנה: 🔥🔥🔥</em></div><b>🎓 תעודה לכל שחקן</b><span>תואר מצחיק לכל אחד, מוכן לסטורי</span></div>
    </div>
    <button class="pmx-cta" id="pmx-go">מעלים צ'אט ומגלים ✨</button>
    <span class="pmx-sub">14.90 ₪ פעם אחת לכל הקבוצה. בלי מנוי, בלי כרטיס אשראי.</span>
  </section>`;
}
const blur = (t: string) => `<span class="pmx-blur">${esc(t)}</span>`;
export function teaserHtml() {
  const mc = P.items.length, k = mediaByKind();
  if (P.on) return `<section class="pmx-hero on"><div class="pmx-ring"></div><span class="pmx-badge">⭐ הפרימיום פתוח לקבוצה הזאת</span>
    <h3 class="pmx-t">הכל פתוח. תהנו 🎉</h3>
    <button class="pmx-cta" id="pm-wrap">🎁 לראות את הסיכום של ${wrappedYear()}</button>
    ${mc ? `<button class="pmx-free" id="pm-rev">🎙️ לעבור על המדיה של סבב המדיה (${fmt(mc)})</button>` : `<p class="pmx-sub">רוצים גם את סבב המדיה? מייצאים את הצ'אט כולל מדיה ומעלים שוב.</p>`}
    <button class="pmx-free" id="pm-files">📁 התיקים הסודיים של כל אחד</button>
    <p class="pmx-sub">🎓 התעודות מחכות בסוף המשחק. בזמן משחק, כל שחקן מקבל את התיק שלו לטלפון.</p></section>`;
  const D = hasWrapped() ? P.wrapped : null, rows: string[] = [];
  if (D) {
    if (D.mention) rows.push(`<li>👀 <span>מישהו בקבוצה מזכיר את השם של ${blur(plainName(D.mention.to))} יותר מכל אחד אחר. ${fmt(D.mention.n)} פעמים.</span></li>`);
    if (D.duo) rows.push(`<li>🌙 <span>שניים דיברו לבד ${fmt(D.duo.n)} הודעות באמצע הלילה: ${blur(plainName(D.duo.a[0]) + " ו" + plainName(D.duo.a[1]))}</span></li>`);
    if (D.ghost) rows.push(`<li>🦗 <span>מישהו שאל שאלה ואף אחד לא ענה ${fmt(Math.round(D.ghost.g / 3600e3))} שעות: ${blur(D.ghost.t.slice(0, 26))}</span></li>`);
    if (D.deleted) rows.push(`<li>🗑️ <span>מישהו מחק ${fmt(D.deleted[1])} הודעות. מה הוא הסתיר? ${blur(plainName(D.deleted[0]))}</span></li>`);
    if (D.pair && D.pair.n >= 10) rows.push(`<li>💍 <span>הזוג של הקבוצה: ${blur(plainName(D.pair.a[0]) + " ו" + plainName(D.pair.a[1]))}</span></li>`);
    if (D.missing) rows.push(`<li>🕵️ <span>מישהו נעלם ל־${fmt(D.missing.days)} ימים: ${blur(plainName(D.missing.who))}</span></li>`);
    if (D.night) rows.push(`<li>🌚 <span>ההודעה של ${new Date(D.night.ts).toTimeString().slice(0, 5)} בלילה: ${blur(D.night.msgs[0].t.slice(0, 30))}</span></li>`);
    if (D.stick && D.stick[1] >= 5) rows.push(`<li>👑 <span>מלך הסטיקרים: ${blur(plainName(D.stick[0]))}, עם ${fmt(D.stick[1])} סטיקרים</span></li>`);
  }
  const vids = P.items.filter((it: Item) => (it.kind === "video" || it.kind === "gif") && it.size < 4e6).sort(() => Math.random() - .5).slice(0, 2);
  const pics = P.items.filter((it: Item) => it.kind === "image" || it.kind === "sticker").slice(-40).sort(() => Math.random() - .5).slice(0, 5 - vids.length);
  const media = mc ? `<div class="pmx-media"><div class="pmx-thumbs">${[...vids.map((it: Item) => `<span class="pmx-th vid" data-v="${esc(it.id)}"><span>▶︎</span></span>`), ...pics.map((it: Item) => `<span class="pmx-th" data-f="${esc(it.id)}"></span>`)].sort(() => Math.random() - .5).join("")}<span class="pmx-th lock">🔒</span></div>
    <p>🎙️ <b>${[k.audio && `${fmt(k.audio)} הקלטות`, k.image && `${fmt(k.image)} תמונות`, k.sticker && `${fmt(k.sticker)} סטיקרים`, (k.video || k.gif) && `${fmt((k.video || 0) + (k.gif || 0))} סרטונים`].filter(Boolean).join(", ")}</b> מהקבוצה מחכים לסבב המדיה</p></div>`
    : `<p class="pmx-sub">🎙️ בשביל סבב המדיה מייצאים את הצ'אט <b>כולל מדיה</b>.</p>`;
  const titles = ["ערפד מוסמך 🧛", "חופר בדרגת דוקטורט 🗣️", "נעלם במשולש ברמודה 🕵️", "פודקאסטר בלי מאזינים 🎙️", "גוגל של העניים ❓"];
  const secrets = rows.length + (mc ? 1 : 0) + 6;
  return `<section class="pmx-hero"><div class="pmx-ring"></div><div class="pmx-spark" aria-hidden="true"><i>✨</i><i>⭐</i><i>✨</i><i>💫</i><i>✨</i></div>
    <span class="pmx-stamp" aria-hidden="true">מסווג</span>
    <span class="pmx-badge">⭐ פרימיום</span>
    <h3 class="pmx-t">בובי מצא <span class="pmx-n" data-to="${secrets}">0</span> סודות<span>בצ'אט שלכם 👀</span></h3>
    ${rows.length ? `<ul class="pmx-secrets">${rows.slice(0, 5).join("")}</ul>` : ""}
    ${media}
    <p class="pmx-certline">📁 ולכל אחד מחכה <b>תיק סודי</b>: מי מזכיר אותו, מי מתעלם ממנו וההודעה הכי מביכה שלו. <button class="pmx-link" id="pm-files" style="display:inline">להציץ בכריכה</button></p>
    <p class="pmx-certline">🎓 וכל שחקן מקבל תעודה. למשל: <b>"${pick(titles)}"</b></p>
    <button class="pmx-cta" id="pm-buy">לגלות הכל ב־${PRICE} ₪ ✨</button>
    <span class="pmx-sub">פעם אחת לכל הקבוצה. בלי מנוי, בלי כרטיס אשראי. משלמים בביט.</span>
    <button class="pmx-free" id="pm-wrap">או לראות קודם 3 שקופיות בחינם ←</button>
    ${mc ? `<button class="pmx-link" id="pm-rev">לעבור על המדיה ולהוריד מה שלא מתאים</button>` : ""}
  </section>`;
}
/** after the teaser is on screen: blurred thumbnails of the group's own photos and stickers */
export function bindTeaser() {
  const fb = document.getElementById("pm-files"); if (fb && !fb.dataset.on) { fb.dataset.on = "1"; fb.onclick = () => files("setup"); }
  document.querySelectorAll<HTMLElement>(".pmx-th[data-f]:not([data-on])").forEach(async (el) => { el.dataset.on = "1"; const u = await urlOf(el.dataset.f!); if (u) el.style.backgroundImage = `url("${u}")`; });
  // short clips from the group play blurred and silent: you can tell it's them, you can't tell what happens
  document.querySelectorAll<HTMLElement>(".pmx-th[data-v]:not([data-on])").forEach(async (el) => { el.dataset.on = "1"; const u = await urlOf(el.dataset.v!); if (!u) return; const v = document.createElement("video"); v.src = u; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.setAttribute("playsinline", ""); el.prepend(v); v.play().catch(() => {}); });
  document.querySelectorAll<HTMLElement>(".pmx-n:not([data-on])").forEach((el) => { el.dataset.on = "1"; const to = +el.dataset.to! || 0, t0 = performance.now(); (function f(t: number) { const k = Math.min(1, (t - t0) / 1400); el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(f); })(t0); });
}

// ---------------------------------------------------------------- the personal file: a classified dossier for every player
function dossierFor(name: string) {
  const all = P.msgs.filter((m: Message) => m.ts);
  if (!all.some((m: Message) => m.author === name)) return null;
  const C = () => new Map<string, number>(), inc = (mp: Map<string, number>, k: string, v = 1) => mp.set(k, (mp.get(k) || 0) + v);
  const top = (mp: Map<string, number>, asc = false) => [...mp].sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1]);
  const by = C(); all.forEach((m: Message) => inc(by, m.author));
  const people = top(by), rank = people.findIndex((p) => p[0] === name) + 1;
  const first = (n: string) => { const w = plainName(n).split(/\s+/)[0]; return w && w.length >= 2 ? w : ""; };
  const rx = (w: string) => new RegExp(`(^|[^\u05d0-\u05ea])[והבלמש]?${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\u05d0-\u05ea])`, "g");
  const me = first(name), meRx = me ? rx(me) : null;
  const mentionedBy = C(), mentions = C(), others = people.map((p) => p[0]).filter((n) => n !== name);
  const otherRx = new Map(others.map((n) => [n, first(n)] as [string, string]).filter(([, w]) => w).map(([n, w]) => [n, rx(w)] as [string, RegExp]));
  const repTo = new Map<string, number[]>(), pair = C(), replyCount = C(); let ghosts = 0, qs = 0;
  let night: any = null; const words = C(), emo = C(), hours = new Array(24).fill(0); let deleted = 0, edited = 0, mine = 0;
  const wordsAll = C();
  all.forEach((m: Message, i: number) => {
    const t = m.text || "", nx = all[i + 1], pv = all[i - 1];
    for (const w of t.match(/[\u05d0-\u05ea]{3,}/g) || []) inc(wordsAll, w);
    if (m.author !== name) { if (meRx && t && (t.match(meRx) || []).length) inc(mentionedBy, m.author, (t.match(meRx) || []).length);
      if (pv && pv.author === name && m.ts! - pv.ts! < 10 * 60e3) { inc(replyCount, m.author); let a = repTo.get(m.author); if (!a) repTo.set(m.author, (a = [])); a.push((m.ts! - pv.ts!) / 1000); }
      if (pv && pv.author === name && m.ts! - pv.ts! < 120e3) inc(pair, m.author);
      return; }
    mine++; const h = new Date(m.ts!).getHours(); hours[h]++;
    if (m.deleted) deleted++; if (m.edited) edited++;
    if (pv && pv.author !== name && m.ts! - pv.ts! < 120e3) inc(pair, pv.author);
    if (!t) return;
    otherRx.forEach((r, n) => { const k = (t.match(r) || []).length; if (k) inc(mentions, n, k); });
    if (/\?\s*$/.test(t)) { qs++; if (!nx || nx.ts! - m.ts! > 3600e3) ghosts++; }
    if (h >= 1 && h < 5 && t.length >= 8 && (!night || Math.abs(h - 3) < Math.abs(new Date(night.ts).getHours() - 3))) night = { t: t.slice(0, 110), ts: m.ts };
    for (const w of t.match(/[\u05d0-\u05ea]{3,}/g) || []) if (!STOP.has(w)) inc(words, w);
    for (const e of t.match(EMO) || []) inc(emo, e);
  });
  const med = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const fastest = [...repTo].filter(([, a]) => a.length >= 5).map(([n, a]) => [n, med(a)] as [string, number]).sort((a, b) => a[1] - b[1])[0] || null;
  // who answers you a lot less than they answer everyone else
  const total = all.length, ignorer = others.filter((n) => (by.get(n) || 0) >= Math.max(20, total * .04)).map((n) => [n, replyCount.get(n) || 0, (replyCount.get(n) || 0) / ((by.get(n) || 1) / total)] as [string, number, number]).sort((a, b) => a[2] - b[2])[0] || null;
  const word = top(words).filter(([w]) => !first(w)).map(([w, n]) => [w, n, n / (wordsAll.get(w) || n)] as [string, number, number]).filter((x) => x[1] >= 4).sort((a, b) => b[2] * Math.log(b[1] + 1) - a[2] * Math.log(a[1] + 1))[0] || null;
  const peak = hours.indexOf(Math.max(...hours));
  const verdict = certTitles([name]).get(name)!;
  const no = String(1000 + (([...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0) % 9000));
  return { name, no, msgs: mine, rank, of: people.length, mentionedBy: top(mentionedBy)[0] || null, mentions: top(mentions)[0] || null, fastest, ignorer: ignorer && ignorer[0] !== fastest?.[0] ? [ignorer[0], ignorer[1]] : null,
    bestie: top(pair)[0] || null, ghosts, qs, night, deleted, edited, peak, word: word ? [word[0], word[1]] : null, emoji: top(emo)[0] || null, verdict, group: P.name || "" };
}
const fileSecrets = (f: any) => ["mentionedBy", "fastest", "ignorer", "bestie", "mentions", "night"].filter((k) => f[k]).length + 2;

/** host: pick a player and open their file (also from the end screen) */
export function files(from = "setup") {
  if (!P.msgs.length) { P.opts?.toast?.("צריך להעלות את הצ'אט בשביל התיקים"); return; }
  try { P.opts?.net?.bump("files_open"); } catch {}
  const names = [...P.msgs.reduce((mp: Map<string, number>, m: Message) => mp.set(m.author, (mp.get(m.author) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 16).map((x) => x[0]);
  const root = layer("pm-pick");
  root.innerHTML = `<div class="pm-sheet"><div class="pm-head"><b>📁 של מי התיק?</b><button class="pm-x" aria-label="סגירה">✕</button></div>
    <p class="pm-dim">${P.on ? "בוחרים שם, ובובי פותח את התיק הסודי. כדאי שבעל התיק יחזיק את הטלפון 😈" : "לכל אחד בקבוצה מחכה תיק סודי. בחינם רואים רק את הכריכה."}</p>
    <div class="pmf-names">${names.map((n) => `<button data-n="${esc(n)}">🗂️ ${esc(plainName(n))}</button>`).join("")}</div></div>`;
  root.querySelector<HTMLButtonElement>(".pm-x")!.onclick = () => root.remove();
  root.querySelectorAll<HTMLButtonElement>("[data-n]").forEach((b) => (b.onclick = () => { const f = dossierFor(b.dataset.n!); root.remove(); if (f) openFile(P.on ? f : { locked: 1, name: f.name, no: f.no, n: fileSecrets(f), group: f.group }); }));
}
// host side of the phones: everyone in the game gets their own file privately
function sendFiles() {
  const room = P.room; if (!room || !room.sig || !P.msgs.length || !P.peerNames) return;
  P.peerNames.forEach((n: string, uid: string) => {
    const state = (P.on ? "on" : "lock") + ":" + n; if (P.sentFiles.get(uid) === state) return;
    const f = dossierFor(n); if (!f) return; P.sentFiles.set(uid, state);
    room.sig(uid, { t: "file", f: P.on ? f : { locked: 1, name: f.name, no: f.no, n: fileSecrets(f), group: f.group } }).catch(() => P.sentFiles.delete(uid));
  });
}
on((e) => { if (e === "unlock") sendFiles(); });
function gotFile(m: any) {
  const f = m.f; if (!f || typeof f.name !== "string") return;
  const was = P.myFile; P.myFile = f;
  let fab = document.querySelector<HTMLButtonElement>(".pmf-fab");
  if (!fab) { fab = document.createElement("button"); fab.className = "pmf-fab"; document.body.append(fab); fab.onclick = () => openFile(P.myFile); }
  fab.innerHTML = f.locked ? `📁 התיק הסודי שלך <span>🔒</span>` : `📁 התיק הסודי שלך <span>חדש!</span>`;
  if (!was || (was.locked && !f.locked)) { fab.classList.remove("pop"); void fab.offsetWidth; fab.classList.add("pop"); try { navigator.vibrate && navigator.vibrate([30, 40, 30]); } catch {} }
}

let F: any = null;
function openFile(f: any) {
  if (!f) return;
  try { P.opts?.net?.bump(f.locked ? "file_locked" : "file_open"); } catch {}
  P.opts?.music?.pause();
  const host = layer("pmf"), sr = host.attachShadow({ mode: "open" });
  F = { host, sr, ac: null as any, muted: false };
  const name = esc(plainName(f.name)), sec: [string, string, string, string][] = []; // icon, title, body, quip
  if (!f.locked) {
    if (f.mentionedBy) sec.push(["👁️", "מי מזכיר אותך הכי הרבה", `<b>${esc(plainName(f.mentionedBy[0]))}</b> כתב את השם שלך <b>${fmt(f.mentionedBy[1])}</b> פעמים.`, "מישהו פה חושב עליך הרבה 😳"]);
    if (f.fastest) sec.push(["🏃", "מי רץ לענות לך", `<b>${esc(plainName(f.fastest[0]))}</b> עונה לך תוך <b>${fmt(Math.max(1, Math.round(f.fastest[1])))}</b> שניות.`, "זה כבר מתחיל להיות חשוד."]);
    if (f.ignorer) sec.push(["🧊", "מי מתעלם ממך", `<b>${esc(plainName(f.ignorer[0]))}</b> ענה לך רק <b>${fmt(f.ignorer[1])}</b> פעמים כל השנה. לאחרים הוא עונה הרבה יותר.`, "אולי תשאל אותו למה 🙃"]);
    if (f.bestie) sec.push(["🤝", "הבסטי שלך בצ'אט", `את/ה ו<b>${esc(plainName(f.bestie[0]))}</b> עניתם אחד לשני תוך שתי דקות <b>${fmt(f.bestie[1])}</b> פעמים.`, "תקנו כבר צמידי חברות."]);
    if (f.mentions) sec.push(["🔭", "על מי את/ה מדבר/ת הכי הרבה", `<b>${esc(plainName(f.mentions[0]))}</b>. כתבת את השם שלו <b>${fmt(f.mentions[1])}</b> פעמים.`, "אנחנו רואים אותך 👀"]);
    if (f.night) sec.push(["🌙", "ההודעה הכי מביכה שלך", `<span class="q">״${esc(f.night.t)}״</span><span class="tm">נשלח ב־${new Date(f.night.ts).toTimeString().slice(0, 5)} בלילה</span>`, "מה עבר לך בראש?"]);
    sec.push(["📊", "המספרים שלך", `<span class="nums"><i><b>${fmt(f.msgs)}</b>הודעות</i><i><b>#${f.rank}</b>בחפרנות מתוך ${f.of}</i><i><b>${String(f.peak).padStart(2, "0")}:00</b>השעה שלך</i>${f.ghosts ? `<i><b>${fmt(f.ghosts)}</b>שאלות שאף אחד לא ענה</i>` : ""}${f.word ? `<i><b>${esc(f.word[0])}</b>המילה שלך</i>` : ""}${f.emoji ? `<i><b>${f.emoji[0]}</b>האימוג'י שלך</i>` : ""}${f.deleted ? `<i><b>${fmt(f.deleted)}</b>הודעות שמחקת</i>` : ""}</span>`, f.deleted ? "ולא, לא שכחנו את מה שמחקת." : "הנתונים לא משקרים."]);
    sec.push(["⚖️", "פסק הדין של בובי", `<span class="vd">${f.verdict.e} ${esc(f.verdict.t)}</span><span class="vr">${esc(f.verdict.r)}</span>`, "אין ערעורים."]);
  }
  sr.innerHTML = `<style>${FCSS}</style><div class="ph"><div class="top"><button class="ib" id="mu" aria-label="השתקה">🔊</button><button class="ib" id="x" aria-label="סגירה">✕</button></div>
    <div class="scroll" id="sc"><div class="folder">
      <div class="tab">תיק מס׳ ${esc(f.no)}</div>
      <div class="stamp s1">סודי ביותר</div>
      <div class="cover"><small>${esc(f.group || "הקבוצה")} · ארכיון בובי</small><h1>התיק הסודי של</h1><h2>${name}</h2>
        <div class="bud">${budSvg(f.locked ? "think" : "shock", 96)}</div>
        <p class="lead">${f.locked ? `בובי אסף <b>${fmt(f.n)}</b> סודות עליך מתוך הצ'אט.` : `בובי עבר על כל ההודעות שלך. כל. ההודעות.`}</p></div>
      ${f.locked ? `<div class="locked">${Array.from({ length: Math.min(6, f.n) }, (_, i) => `<div class="card red"><span class="ic">🔒</span><div><div class="bar w${i % 3}"></div><div class="bar w${(i + 1) % 3}"></div></div></div>`).join("")}
        <div class="lk"><b>🔒 התיק נעול</b><p>מי מזכיר אותך הכי הרבה, מי מתעלם ממך, ההודעה הכי מביכה שלך ופסק הדין של בובי. הכל פה, מתחת לפסים השחורים.</p><p class="sm">התיק נפתח כשמישהו בקבוצה פותח את הפרימיום (14.90 ₪ פעם אחת לכל הקבוצה).${P.key ? "" : " תגידו למי שפתח את המשחק 😉"}</p>${P.key ? `<button class="cta" id="buy">לפתוח את כל התיקים ✨</button>` : ""}</div></div>`
      : `${sec.map((x, i) => `<div class="card" data-i="${i}"><div class="hd"><span class="ic">${x[0]}</span><b>${x[1]}</b></div><div class="bd">${x[2]}<em>${x[3]}</em></div><div class="redact"><span>מסווג</span><small>הקישו כדי לחשוף</small></div></div>`).join("")}
        <div class="end" hidden><div class="stamp s2">נחשף!</div><button class="cta" id="save">📲 שמירה לסטורי</button><button class="ghost" id="again">לראות תיק של מישהו אחר</button></div>`}
    </div></div></div>`;
  const $ = (q: string) => sr.querySelector(q) as HTMLElement;
  $("#x").onclick = closeFile;
  $("#mu").onclick = (e: any) => { F.muted = !F.muted; e.currentTarget.textContent = F.muted ? "🔇" : "🔊"; };
  const buyB = sr.querySelector<HTMLButtonElement>("#buy"); if (buyB) buyB.onclick = () => { closeFile(); buy("file"); };
  const tone = (k: string) => { try { if (F.muted) return; if (!F.ac) F.ac = new (window.AudioContext || (window as any).webkitAudioContext)(); const ac = F.ac, t = ac.currentTime;
    const o = (type: OscillatorType, f: number, d: number, v: number, f2?: number, at = 0) => { const g = ac.createGain(), x = ac.createOscillator(); x.type = type; x.frequency.setValueAtTime(f, t + at); if (f2) x.frequency.exponentialRampToValueAtTime(f2, t + at + d); g.gain.setValueAtTime(v, t + at); g.gain.exponentialRampToValueAtTime(.0001, t + at + d); x.connect(g); g.connect(ac.destination); x.start(t + at); x.stop(t + at + d + .05); };
    if (k === "rip") { for (let i = 0; i < 6; i++) o("square", 1400 - i * 150, .03, .05, undefined, i * .025); o("sine", 180, .25, .4, 60, .12); }
    if (k === "stamp") { o("sine", 120, .35, .9, 40); o("square", 70, .12, .15); }
    if (k === "type") o("square", 2200 + Math.random() * 400, .02, .04); } catch {} };
  setTimeout(() => { tone("stamp"); try { navigator.vibrate && navigator.vibrate(40); } catch {} }, 450);
  if (f.locked) return;
  let next = 0;
  const reveal = (i: number) => {
    const c = sr.querySelector<HTMLElement>(`.card[data-i="${i}"]`); if (!c || c.classList.contains("open")) return;
    c.classList.add("open"); tone("rip"); try { navigator.vibrate && navigator.vibrate(25); } catch {}
    for (let k = 0; k < 8; k++) setTimeout(() => tone("type"), 250 + k * 45);
    next = Math.max(next, i + 1);
    setTimeout(() => { const n2 = sr.querySelector<HTMLElement>(`.card[data-i="${next}"]`); if (n2) n2.scrollIntoView({ behavior: "smooth", block: "center" }); else { const end = $(".end"); end.hidden = false; end.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => tone("stamp"), 250); } }, 900);
  };
  sr.querySelectorAll<HTMLElement>(".card").forEach((c) => (c.onclick = () => reveal(+c.dataset.i!)));
  $("#save").onclick = () => saveFile(f);
  $("#again").onclick = () => { closeFile(); files(); };
}
function closeFile() { if (!F) return; try { F.ac && F.ac.close(); } catch {} F.host.remove(); F = null; P.opts?.music?.resume(); }
async function saveFile(f: any) {
  await fonts(); const cv = document.createElement("canvas"); cv.width = 1080; cv.height = 1920; const c = cv.getContext("2d")!;
  c.fillStyle = "#1d1636"; c.fillRect(0, 0, 1080, 1920); dots(c, "#ffffff14");
  c.fillStyle = "#c9a66b"; rr(c, 120, 130, 330, 110, 30); c.fill();
  c.fillStyle = "#0e0a1f"; rr(c, 80, 222, 920, 1580, 40); c.fill(); c.fillStyle = "#e9d3a2"; rr(c, 80, 200, 920, 1580, 40); c.fill(); c.lineWidth = 8; c.strokeStyle = "#1d1636"; c.stroke();
  textLine(c, `תיק מס׳ ${f.no}`, 285, 172, 38, "#3a2a0a", 700, 300);
  stickerText(c, "התיק הסודי של", 540, 330, 96, "#1d1636", "#e9d3a2", "#e9d3a2", 860);
  stickerText(c, plainName(f.name), 540, 470, 150, "#c81e3c", "#fff", "#1d1636", 860);
  const lines: [string, string][] = [];
  if (f.mentionedBy) lines.push(["👁️", `${plainName(f.mentionedBy[0])} הזכיר אותי ${fmt(f.mentionedBy[1])} פעמים`]);
  if (f.fastest) lines.push(["🏃", `${plainName(f.fastest[0])} עונה לי תוך ${fmt(Math.max(1, Math.round(f.fastest[1])))} שניות`]);
  if (f.ignorer) lines.push(["🧊", `${plainName(f.ignorer[0])} מתעלם ממני`]);
  if (f.bestie) lines.push(["🤝", `הבסטי שלי בצ'אט: ${plainName(f.bestie[0])}`]);
  lines.slice(0, 4).forEach(([e, t], i) => { const y = 640 + i * 190; c.fillStyle = "#fff8e6"; rr(c, 150, y, 780, 150, 26); c.fill(); c.lineWidth = 5; c.strokeStyle = "#1d1636"; c.stroke();
    c.font = '70px "Apple Color Emoji","Segoe UI Emoji",sans-serif'; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(e, 860, y + 75); textLine(c, t, 500, y + 75 - 22, 44, "#1d1636", 700, 600); });
  const vy = 640 + Math.min(4, lines.length) * 190 + 30;
  textLine(c, "פסק הדין של בובי:", 540, vy, 40, "#5a4a2a", 700);
  stickerText(c, `${f.verdict.t}`, 540, vy + 95, 100, "#7b5cff", "#fff", "#1d1636", 860);
  c.save(); c.translate(770, 1610); c.rotate(-.2); c.strokeStyle = "#c81e3c"; c.lineWidth = 10; rr(c, -190, -70, 380, 140, 18); c.stroke(); c.fillStyle = "#c81e3c"; c.font = '700 110px Karantina, sans-serif'; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("סודי ביותר", 0, 8); c.restore();
  const bud = await budImage("shock"); c.drawImage(bud, 160, 1490, 220, 256);
  textLine(c, "מה כתוב בתיק שלך? mi-amar.co.il", 540, 1860, 34, "#ffd23f", 700, 900);
  await share(cv, `התיק-של-${plainName(f.name)}.png`, "התיק הסודי שלי");
}
const FCSS = BUD_CSS_FILE();
function BUD_CSS_FILE() { return `.buddy{display:inline-block;width:var(--bs,96px);aspect-ratio:172/200;flex:none}.buddy svg{width:100%;height:100%;display:block;overflow:visible}.buddy [data-m]{display:none}
.buddy.m-think [data-m~="think"],.buddy.m-shock [data-m~="shock"]{display:inline}.buddy .bd{animation:bob 2.4s ease-in-out infinite alternate;transform-origin:50% 90%;transform-box:view-box}@keyframes bob{to{transform:translateY(-5px)}}
*{box-sizing:border-box;margin:0;padding:0}
.ph{position:fixed;inset:0;background:radial-gradient(120% 70% at 50% 0%,#3b2a8f,#0e0a1f 70%);font-family:"Varela Round",system-ui,sans-serif;color:#1d1636;direction:rtl}
.ph::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,#ffffff06 0 2px,transparent 2px 4px);pointer-events:none;animation:scan 8s linear infinite}
@keyframes scan{to{background-position:0 200px}}
.top{position:absolute;top:12px;inset-inline:12px;display:flex;justify-content:space-between;z-index:5}
.ib{width:40px;height:40px;border-radius:50%;border:0;background:#ffffff22;color:#fff;font-size:17px;cursor:pointer}
.scroll{position:absolute;inset:0;overflow-y:auto;padding:64px 14px 40px;-webkit-overflow-scrolling:touch}
.folder{position:relative;max-width:440px;margin:0 auto;background:#e9d3a2;border:4px solid #1d1636;border-radius:10px 24px 24px 24px;box-shadow:0 12px 0 #0008;padding:26px 16px 22px;animation:fin .7s cubic-bezier(.2,1.4,.4,1);background-image:radial-gradient(#00000010 1px,transparent 1px);background-size:6px 6px}
@keyframes fin{from{transform:translateY(60px) rotate(-4deg);opacity:0}}
.tab{position:absolute;top:-36px;right:24px;background:#c9a66b;border:4px solid #1d1636;border-bottom:0;border-radius:14px 14px 0 0;padding:6px 16px;font-weight:700;font-size:.85rem;color:#3a2a0a}
.stamp{position:absolute;font-family:Karantina,sans-serif;color:#c81e3c;border:4px solid #c81e3c;border-radius:10px;padding:0 12px;font-size:2.3rem;line-height:1.1;opacity:.85;mix-blend-mode:multiply;pointer-events:none}
.s1{top:14px;left:10px;transform:rotate(-16deg);animation:st .5s cubic-bezier(.2,1.6,.4,1) .4s backwards}
.s2{position:relative;display:inline-block;transform:rotate(-8deg);animation:st .5s cubic-bezier(.2,1.6,.4,1) .2s backwards;font-size:3rem;margin-bottom:10px}
@keyframes st{from{transform:rotate(-16deg) scale(3.2);opacity:0}}
.cover{text-align:center;display:grid;gap:4px;justify-items:center;margin-bottom:14px}
.cover small{font-size:.78rem;color:#6b5428;font-weight:700}
.cover h1{font-family:Karantina,sans-serif;font-size:2.2rem;line-height:1}
.cover h2{font-family:Karantina,sans-serif;font-size:3.6rem;line-height:.9;color:#c81e3c;text-shadow:3px 3px 0 #fff,6px 6px 0 #1d1636;margin-bottom:6px}
.lead{font-size:1rem;font-weight:700}
.card{position:relative;background:#fff8e6;border:3px solid #1d1636;border-radius:16px;padding:12px 14px;margin-top:12px;box-shadow:0 5px 0 #1d1636;overflow:hidden;cursor:pointer;min-height:92px}
.hd{display:flex;gap:8px;align-items:center;font-size:1rem}.ic{font-size:1.4rem}
.bd{margin-top:8px;font-size:1.05rem;line-height:1.5}.bd b{color:#c81e3c}
.bd em{display:block;font-style:normal;font-size:.86rem;color:#6b5428;margin-top:4px}
.q{display:block;background:#fff;border:2px solid #1d1636;border-radius:14px 14px 14px 4px;padding:8px 12px;font-weight:700}.tm{display:block;font-size:.8rem;color:#6b5428;margin-top:4px}
.nums{display:grid;grid-template-columns:1fr 1fr;gap:8px}.nums i{font-style:normal;background:#e9d3a2;border-radius:12px;padding:8px;text-align:center;font-size:.78rem;display:grid}.nums b{font-family:Karantina,sans-serif;font-size:1.9rem;line-height:1;color:#1d1636}
.vd{display:block;font-family:Karantina,sans-serif;font-size:2.6rem;line-height:1;color:#7b5cff;text-align:center}.vr{display:block;text-align:center;font-weight:700}
.redact{position:absolute;inset:0;background:#111;display:grid;place-content:center;justify-items:center;gap:2px;color:#fff;transform-origin:left center;transition:transform .55s cubic-bezier(.7,0,.2,1)}
.redact span{font-family:Karantina,sans-serif;font-size:2rem;letter-spacing:6px;color:#ff3d7f}.redact small{font-size:.8rem;opacity:.7;animation:blink 1.2s infinite}
.redact::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,#ffffff22,transparent);transform:translateX(-100%);animation:sh 2.2s infinite}
@keyframes sh{to{transform:translateX(100%)}}@keyframes blink{50%{opacity:.25}}
.card.open .redact{transform:scaleX(0)}
.card.open .bd{animation:typein .6s steps(12) .25s backwards}
@keyframes typein{from{clip-path:inset(0 0 0 100%)}}
.card.red{cursor:default;display:flex;gap:10px;align-items:center}.card.red>div{flex:1;display:grid;gap:8px}
.bar{height:16px;background:#111;border-radius:4px}.bar.w0{width:90%}.bar.w1{width:65%}.bar.w2{width:78%}
.lk{margin-top:14px;text-align:center;display:grid;gap:8px}.lk b{font-size:1.2rem}.lk p{font-size:.95rem;line-height:1.5}.lk .sm{font-size:.82rem;color:#6b5428}
.end{text-align:center;margin-top:18px;display:grid;gap:10px;justify-items:center}
.cta{width:100%;font-family:inherit;font-weight:700;font-size:1.15rem;border:3.5px solid #1d1636;background:linear-gradient(180deg,#ffe26b,#ffc21f);color:#1d1636;border-radius:16px;padding:14px;box-shadow:0 5px 0 #1d1636;cursor:pointer}
.ghost{font-family:inherit;font-weight:700;background:none;border:0;color:#6b5428;text-decoration:underline;cursor:pointer}
.cta:focus-visible,.ib:focus-visible,.card:focus-visible{outline:3px solid #7b5cff;outline-offset:3px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition-duration:.01s!important}}`; }

// ---------------------------------------------------------------- styles
// the story lives in its own shadow root, so the game's own styles (.msg, .cal, .poster…) never leak into it
const BUD_CSS = `.buddy{display:inline-block;width:var(--bs,96px);aspect-ratio:172/200;flex:none;vertical-align:middle}.buddy svg{width:100%;height:100%;display:block;overflow:visible}.buddy [data-m]{display:none}
.buddy.m-idle [data-m~="idle"],.buddy.m-think [data-m~="think"],.buddy.m-shock [data-m~="shock"],.buddy.m-laugh [data-m~="laugh"],.buddy.m-sweat [data-m~="sweat"],.buddy.m-party [data-m~="party"]{display:inline}
.buddy .bd{animation:pwBob 2.6s ease-in-out infinite alternate;transform-origin:50% 90%;transform-box:view-box}.buddy.m-laugh .bd,.buddy.m-party .bd{animation:pwGig .34s ease-in-out infinite alternate}
.buddy .ey{transform-box:fill-box;transform-origin:center;animation:pwBlink 4.4s infinite}
@keyframes pwBob{to{transform:translateY(-6px)}}@keyframes pwGig{from{transform:rotate(-4deg)}to{transform:rotate(4deg) translateY(-3px)}}@keyframes pwBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes pmWv{from{height:15%}to{height:100%}}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:host{all:initial}
.pw-ph{font-family:"Varela Round",system-ui,sans-serif;direction:rtl}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01s!important;transition-duration:.01s!important}}
`;
const WCSS = BUD_CSS + `/* the year summary */
.pmw{padding:0;background:#0c0820;backdrop-filter:none}
.pw-ph{--pw-ink:#1d1636;--pw-cream:#fff3d1;--pw-pink:#ff3d7f;--pw-yellow:#ffd23f;--pw-mint:#3fe0b0;--pw-sky:#5fb4ff;--pw-purple:#7b5cff;--pw-spring:cubic-bezier(.2,1.5,.35,1);--pw-out:cubic-bezier(.23,1,.32,1);
 position:relative;width:100vw;height:100dvh;overflow:hidden;background:#17112e;isolation:isolate;color:#fff;user-select:none;-webkit-user-select:none}
@media (min-width:700px){.pw-ph{border-radius:30px;height:min(94dvh,177.78vw);width:min(100vw,52.9dvh);box-shadow:0 30px 80px #000a}}
.pw-bg{position:absolute;inset:0;z-index:-2;transition:background-color .6s}
.pw-bg::before{content:"";position:absolute;inset:-20%;background-image:radial-gradient(circle,#ffffff26 1.6px,transparent 2px);background-size:17px 17px;transform:rotate(-12deg);-webkit-mask-image:linear-gradient(160deg,#000 0%,transparent 55%,#000 100%);mask-image:linear-gradient(160deg,#000 0%,transparent 55%,#000 100%)}
.pw-band{position:absolute;z-index:-1;inset-inline:-30%;height:38%;transform:rotate(-9deg);transition:background-color .6s,top .8s var(--pw-out)}
.pw-bars{position:absolute;top:10px;inset-inline:10px;display:flex;gap:3px;z-index:20}
.pw-bars i{flex:1;height:4px;border-radius:3px;background:#ffffff45;overflow:hidden}.pw-bars b{display:block;height:100%;width:0;background:#fff}
.pw-hud{position:absolute;top:22px;inset-inline:12px;display:flex;justify-content:space-between;align-items:center;z-index:20;font-size:13px;font-weight:700;text-shadow:0 1px 3px #0009}
.pw-who{display:flex;align-items:center;gap:8px;min-width:0}.pw-who>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pw-dot{flex:none;width:28px;height:28px;border-radius:50%;background:#7b5cff;border:2.5px solid #fff;display:grid;place-items:center;font-size:14px}
.pw-meta{font-weight:400;opacity:.75}.pw-row{display:flex;gap:8px}
.pw-ib{background:#0003;border:0;color:#fff;width:36px;height:36px;border-radius:50%;font-size:16px;display:grid;place-items:center;cursor:pointer}
.pw-pill{position:absolute;top:62px;left:50%;translate:-50% 0;z-index:21;font-size:12px;font-weight:700;padding:4px 11px;border-radius:99px;background:#0004;white-space:nowrap}
.pw-ph .slide{position:absolute;inset:0;padding:96px 24px 36px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px}
.pw-ph .slide>*{position:relative}
.pw-ph .slide.leave{animation:pwOut .32s var(--pw-out) forwards}
@keyframes pwOut{to{opacity:0;transform:scale(1.06);filter:blur(6px)}}
.pw-ph .r,.pw-ph .z,.pw-ph .slap,.pw-ph .drop{opacity:0}
.pw-ph .on .r{animation:pwRise .7s var(--pw-out) forwards;animation-delay:var(--d,0s)}
.pw-ph .on .z{animation:pwZoom .8s var(--pw-spring) forwards;animation-delay:var(--d,0s)}
.pw-ph .on .slap{animation:pwSlap .55s var(--pw-spring) forwards;animation-delay:var(--d,0s)}
.pw-ph .on .drop{animation:pwDrop .9s var(--pw-spring) forwards;animation-delay:var(--d,0s)}
@keyframes pwRise{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes pwZoom{from{opacity:0;transform:scale(.2) rotate(-14deg)}to{opacity:1;transform:rotate(var(--rot,0deg))}}
@keyframes pwSlap{0%{opacity:0;transform:scale(2.6) rotate(-16deg)}55%{opacity:1}100%{opacity:1;transform:scale(1) rotate(var(--rot,-3deg))}}
@keyframes pwDrop{from{opacity:0;transform:translateY(-70vh) rotate(25deg)}to{opacity:1;transform:rotate(var(--rot,-4deg))}}
.pw-ph .st{font-family:Karantina,"Varela Round",sans-serif;font-weight:700;line-height:.86;color:var(--c,#fff);--o:var(--oc,var(--pw-ink));--s:var(--sc,#00000059);
 text-shadow:0 4px var(--o),0 -4px var(--o),4px 0 var(--o),-4px 0 var(--o),3px 3px var(--o),-3px 3px var(--o),3px -3px var(--o),-3px -3px var(--o),0 6px var(--o),5px 6px var(--o),-5px 6px var(--o),0 12px var(--s),5px 12px var(--s),-5px 12px var(--s);max-width:100%;overflow-wrap:anywhere}
.pw-ph .st.w{--oc:#fff;--sc:var(--pw-ink)}
.pw-ph .st.xl{font-size:150px}.pw-ph .st.l{font-size:100px}.pw-ph .st.m{font-size:66px}.pw-ph .st.s{font-size:48px}
.pw-ph .num{font-variant-numeric:tabular-nums;direction:ltr;display:inline-block}
.pw-ph .lead{font-size:19px;font-weight:700;line-height:1.3;max-width:310px}
.pw-ph .sub,.pw-sub{font-size:16px;line-height:1.5;opacity:.9;max-width:300px}
.pw-ph .lbl{font-size:15px;font-weight:700;opacity:.85}
.pw-ph .dark{color:var(--pw-ink)}
.pw-ph .small,.pw-small{font-size:13px;opacity:.75;line-height:1.5}
.pw-ph .chip{display:inline-flex;align-items:center;gap:6px;background:var(--pw-cream);color:var(--pw-ink);border:3px solid var(--pw-ink);padding:5px 12px;border-radius:12px;font-size:14px;font-weight:700;box-shadow:0 4px 0 var(--pw-ink)}
.pw-ph .chips{display:flex;flex-wrap:wrap;gap:9px;justify-content:center;max-width:330px}
.pw-ph .card{background:var(--pw-cream);color:var(--pw-ink);border:4px solid var(--pw-ink);border-radius:20px;box-shadow:0 8px 0 var(--pw-ink)}
.pw-btn{font-family:inherit;font-weight:700;font-size:18px;border:3.5px solid var(--pw-ink);background:var(--pw-yellow);color:var(--pw-ink);border-radius:18px;padding:14px 22px;box-shadow:0 6px 0 var(--pw-ink);cursor:pointer;z-index:12}
.pw-btn:active{transform:translateY(4px);box-shadow:0 2px 0 var(--pw-ink)}.pw-btn.alt{background:#fff}
.pw-btn:focus-visible,.pw-ph .pw-opt:focus-visible{outline:3px solid #fff;outline-offset:3px}
canvas.pw-fx{position:absolute;inset:0;z-index:15;pointer-events:none;width:100%;height:100%}
.pw-toast{position:absolute;bottom:84px;left:50%;translate:-50% 0;background:#fff;color:var(--pw-ink);padding:10px 16px;border-radius:14px;font-size:14px;font-weight:700;z-index:40;opacity:0;transition:.3s;width:max-content;max-width:88%;text-align:center;border:3px solid var(--pw-ink)}.pw-toast.show{opacity:1;translate:-50% -8px}
.pw-start{position:absolute;inset:0;z-index:30;background:#3b2a8f;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:30px;overflow:hidden}
.pw-start::before{content:"";position:absolute;inset:-20%;background-image:radial-gradient(circle,#ffffff22 1.6px,transparent 2px);background-size:17px 17px;transform:rotate(-12deg)}
.pw-start>*{position:relative}
.pw-ph .opts{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:330px}
.pw-ph .pw-opt{position:relative;z-index:12;font-family:inherit;font-size:16px;font-weight:700;background:#fff;color:var(--pw-ink);border:3.5px solid var(--pw-ink);border-radius:16px;padding:14px 8px;box-shadow:0 5px 0 var(--pw-ink);cursor:pointer;transition:transform .2s var(--pw-spring),background .2s;overflow:hidden;text-overflow:ellipsis}
.pw-ph .pw-opt.win{background:var(--pw-mint);transform:scale(1.06) rotate(-2deg)}.pw-ph .pw-opt.lose{background:#ff8a8a;opacity:.7}
.pw-ph .race{width:100%;max-width:330px;display:flex;flex-direction:column;gap:7px}
.pw-ph .race div{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700}
.pw-ph .race span{width:96px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pw-ph .race i{height:24px;border-radius:7px;background:#fff;border:3px solid var(--pw-ink);width:0;transition:width 1.1s var(--pw-out);box-shadow:0 3px 0 var(--pw-ink)}
.pw-ph .race div:first-child i{background:var(--pw-yellow)}.pw-ph .race em{font-style:normal;font-size:13px;opacity:.9;direction:ltr}
.pw-ph .cal{width:150px;border-radius:20px;overflow:hidden;border:4px solid var(--pw-ink);box-shadow:0 8px 0 var(--pw-ink);background:#fff;color:var(--pw-ink)}
.pw-ph .cal div:first-child{background:var(--pw-pink);color:#fff;font-weight:700;padding:6px;font-size:18px}
.pw-ph .cal div:last-child{font-family:Karantina,sans-serif;font-size:96px;line-height:1;padding:4px 0 6px}
.pw-ph .spark{display:flex;align-items:flex-end;gap:3px;height:96px;width:100%;max-width:310px;direction:ltr}
.pw-ph .spark i{flex:1;background:#ffffff55;border-radius:3px 3px 0 0;height:0;transition:height .9s var(--pw-out)}.pw-ph .spark i.hot{background:var(--pw-yellow)}
.pw-ph .peek{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;width:100%;max-width:330px}
.pw-ph .peek div{aspect-ratio:9/12;border-radius:12px;border:3px solid var(--pw-ink);display:grid;place-items:center;font-size:28px;filter:blur(2.5px) saturate(1.3)}
.pw-ph .lockbig{font-size:60px;opacity:0}
.pw-ph .on .lockbig{animation:pwZoom .8s var(--pw-spring) forwards,pwShake .45s .9s 2}
@keyframes pwShake{25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}
.pw-ph .stk{width:160px;min-height:150px;border:3.5px dashed var(--pw-ink);border-radius:26px;display:grid;place-items:center;font-size:13px;color:var(--pw-ink);padding:10px;background:#ffffff8c;font-weight:700;gap:4px}
.pw-ph .stk img{width:130px;height:130px;object-fit:contain;filter:drop-shadow(0 5px 0 #1d163644)}
.pw-ph .rain{position:absolute!important;inset:0;pointer-events:none;z-index:-1}
.pw-ph .rain span{position:absolute;top:-60px;font-size:34px;animation:pwFall linear forwards}
@keyframes pwFall{to{transform:translateY(120dvh) rotate(360deg)}}
.pw-ph .pre{position:absolute!important;top:46%;font-family:Karantina,sans-serif;font-size:58px;opacity:0}
.pw-ph .on .pre{animation:pwPre 1.5s ease forwards}
@keyframes pwPre{0%{opacity:0;transform:scale(.7)}20%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(1.5)}}
.pw-ph .stars{position:absolute!important;inset:0;z-index:-1;background-image:radial-gradient(1.5px 1.5px at 20% 30%,#fff,transparent),radial-gradient(1px 1px at 70% 20%,#fff,transparent),radial-gradient(1.5px 1.5px at 40% 70%,#fffa,transparent),radial-gradient(1px 1px at 85% 60%,#fff,transparent),radial-gradient(1px 1px at 10% 85%,#fff,transparent),radial-gradient(2px 2px at 55% 12%,#fff8,transparent)}
.pw-ph .chat{width:100%;max-width:330px;display:flex;flex-direction:column;gap:6px;text-align:right}
.pw-ph .msg{align-self:flex-start;max-width:85%;background:#fff;color:var(--pw-ink);border-radius:16px 16px 16px 4px;padding:7px 12px;font-size:15px;line-height:1.35;opacity:0;transform:translateY(10px) scale(.9);transition:.35s var(--pw-spring)}
.pw-ph .msg.me{align-self:flex-end;background:#dcf8c6;border-radius:16px 16px 4px 16px}
.pw-ph .msg small{display:block;font-size:11px;font-weight:700;color:var(--pw-pink)}.pw-ph .msg.show{opacity:1;transform:none}
.pw-ph .duo{display:flex;align-items:center;gap:6px}
.pw-ph .av{width:104px;height:104px;border-radius:50%;border:4px solid var(--pw-ink);display:grid;place-items:center;font-family:Karantina,sans-serif;font-size:56px;color:var(--pw-ink);box-shadow:0 6px 0 var(--pw-ink)}
.pw-ph .heart{font-size:54px;opacity:0}.pw-ph .on .heart{animation:pwZoom .8s var(--pw-spring) .9s forwards,pwBeat .8s ease-in-out 1.7s infinite}
@keyframes pwBeat{50%{transform:scale(1.25)}}
.pw-ph .cloud{display:flex;flex-wrap:wrap;gap:6px 12px;justify-content:center;align-items:baseline;max-width:330px}
.pw-ph .cloud span{font-family:Karantina,sans-serif;opacity:0;line-height:.9}.pw-ph .on .cloud span{animation:pwZoom .6s var(--pw-spring) forwards}
.pw-ph .clockc{width:250px;height:250px}
.pw-ph .clockc path{transform-origin:125px 125px;transform:scale(0);transition:transform .8s var(--pw-spring)}.pw-ph .clockc.go path{transform:scale(1)}
.pw-ph .months{display:flex;align-items:flex-end;gap:6px;height:170px;width:100%;max-width:330px}
.pw-ph .months div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:4px;font-size:11px;font-weight:700}
.pw-ph .months i{width:100%;height:0;background:#fff;border:3px solid var(--pw-ink);border-bottom:0;border-radius:8px 8px 0 0;transition:height 1s var(--pw-out)}.pw-ph .months .dead i{background:var(--pw-pink)}
.pw-ph .poster{background:var(--pw-cream);color:var(--pw-ink);border:4px solid var(--pw-ink);border-radius:6px;box-shadow:0 10px 0 var(--pw-ink);width:240px;padding:12px 14px 14px;--rot:-4deg}
.pw-ph .poster .t{font-family:Karantina,sans-serif;font-size:70px;line-height:.9;color:#e0213b}
.pw-ph .poster .face{width:96px;height:96px;margin:6px auto;border:4px solid var(--pw-ink);border-radius:50%;background:#d8d0f5;display:grid;place-items:center;font-size:50px}
.pw-ph .poster .n{font-family:Karantina,sans-serif;font-size:44px;line-height:1}.pw-ph .poster p{font-size:13px;line-height:1.35}
.pw-ph .wave{display:flex;align-items:center;gap:4px;height:80px}
.pw-ph .wave i{width:7px;border-radius:4px;background:var(--pw-ink);animation:pmWv 1s ease-in-out infinite alternate}
.pw-ph .haha{position:absolute!important;inset:0;z-index:-1;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:4px;opacity:.14}
.pw-ph .haha div{font-family:Karantina,sans-serif;font-size:72px;white-space:nowrap;line-height:1;color:var(--pw-ink);animation:pwMq 7s linear infinite}
.pw-ph .haha div:nth-child(even){animation-direction:reverse}
@keyframes pwMq{from{transform:translateX(-30%)}to{transform:translateX(30%)}}
.pw-ph .gauge{width:230px;height:125px}
.pw-ph .needle{transform-origin:115px 115px;transform:rotate(-90deg);transition:transform 1.4s var(--pw-spring)}
.pw-ph .scroll{width:100%;max-width:310px;height:230px;overflow:hidden;--rot:2deg}
.pw-ph .scroll .in{padding:12px 14px;font-size:13px;line-height:1.5;text-align:right;white-space:pre-line}
.pw-ph .on .scroll .in{animation:pwScroll 9s linear 1s forwards}
@keyframes pwScroll{to{transform:translateY(-40%)}}
.pw-ph .fin{width:100%;max-width:340px;background:var(--pw-purple);border:4px solid var(--pw-ink);border-radius:24px;box-shadow:0 10px 0 var(--pw-ink);padding:12px;overflow:hidden}
.pw-ph .fin>*{position:relative}
.pw-ph .awards{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.pw-ph .aw{background:var(--pw-cream);color:var(--pw-ink);border:3px solid var(--pw-ink);border-radius:13px;padding:6px 5px;text-align:center}
.pw-ph .aw em{display:block;font-style:normal;font-size:20px;line-height:1.1}
.pw-ph .aw b{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pw-ph .aw span{font-size:11px;opacity:.8}
.pw-ph .wmk{position:absolute!important;inset:0;display:grid;place-items:center;font-family:Karantina,sans-serif;font-size:56px;color:#ffffff40;transform:rotate(-25deg);pointer-events:none;text-shadow:0 2px #0003}
.pw-ph .row{display:flex;gap:10px;z-index:12}
@media (max-height:700px){.pw-ph .st.xl{font-size:118px}.pw-ph .st.l{font-size:82px}.pw-ph .st.m{font-size:56px}.pw-ph .slide{gap:9px;padding-top:88px}}
`;
function css() {
  if (document.getElementById("pm-css")) return;
  const s = document.createElement("style"); s.id = "pm-css";
  s.textContent = `
/* selling: home showcase and the setup teaser */
.pmx-show,.pmx-hero{position:relative;isolation:isolate;overflow:hidden;border-radius:26px;padding:20px 16px 18px;display:grid;gap:12px;text-align:center;color:#fff;background:radial-gradient(120% 80% at 50% 0%,#5a3fd6 0%,#2a1f55 60%,#17112e 100%);box-shadow:0 10px 0 #0006;direction:rtl}
.pmx-ring{position:absolute;inset:-2px;z-index:-1;border-radius:inherit;padding:3px;background:conic-gradient(from var(--pmxa,0deg),#ffd23f,#ff3d7f,#7b5cff,#3fe0b0,#ffd23f);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:pmxSpin 4s linear infinite}
@property --pmxa{syntax:"<angle>";inherits:false;initial-value:0deg}
@keyframes pmxSpin{to{--pmxa:360deg}}
.pmx-spark i{position:absolute;font-style:normal;font-size:18px;opacity:0;animation:pmxTw 3.2s ease-in-out infinite;z-index:-1}
.pmx-spark i:nth-child(1){top:12%;right:8%}.pmx-spark i:nth-child(2){top:30%;left:6%;animation-delay:.7s}.pmx-spark i:nth-child(3){bottom:22%;right:5%;animation-delay:1.4s}.pmx-spark i:nth-child(4){top:8%;left:30%;animation-delay:2.1s}.pmx-spark i:nth-child(5){bottom:10%;left:12%;animation-delay:2.6s}
@keyframes pmxTw{0%,100%{opacity:0;transform:scale(.4) rotate(0)}40%{opacity:1;transform:scale(1.15) rotate(20deg)}}
.pmx-badge{justify-self:center;background:#ffd23f;color:#1d1636;font-weight:700;font-size:.85rem;padding:5px 12px;border-radius:99px;border:2.5px solid #1d1636;box-shadow:0 3px 0 #1d1636;animation:pmxBob 2s ease-in-out infinite alternate}
@keyframes pmxBob{to{transform:translateY(-3px) rotate(-2deg)}}
.pmx-t{font-family:Karantina,sans-serif;font-size:2.3rem;line-height:.95;margin:0;text-shadow:0 3px 0 #0005}
.pmx-t span{display:block;color:#ffd23f}
.pmx-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.pmx-tile{background:#ffffff14;border:2px solid #ffffff2a;border-radius:18px;padding:8px 6px 10px;display:grid;gap:4px;align-content:start;font-size:.8rem}
.pmx-tile>b{font-size:.85rem}.pmx-tile>span{color:#d8cffa;font-size:.72rem;line-height:1.35}
.pmx-phone{position:relative;height:118px;margin:0 auto 4px;width:70px;border-radius:12px;border:3px solid #1d1636;background:#ff3d7f;overflow:hidden;box-shadow:0 4px 0 #1d1636}
.pmx-f{position:absolute;inset:0;display:grid;place-content:center;gap:3px;padding:6px;opacity:0;animation:pmxCycle 7.5s infinite}
.pmx-f small{font-size:9px;font-weight:700}.pmx-f b{font-family:Karantina,sans-serif;font-size:34px;line-height:.9;color:#ffd23f;text-shadow:0 2px 0 #1d1636}.pmx-f em{font-style:normal;font-size:8px}
.pmx-f.f1{background:#ffa928}.pmx-f.f2{background:#0d0b2e;animation-delay:2.5s}.pmx-f.f3{background:#19c39a;animation-delay:5s}
.pmx-bub{background:#fff;color:#1d1636;font-size:8px;border-radius:7px;padding:2px 5px;justify-self:start}.pmx-bub.me{background:#dcf8c6;justify-self:end}
@keyframes pmxCycle{0%{opacity:0;transform:scale(1.15)}4%,30%{opacity:1;transform:none}34%,100%{opacity:0}}
.pmx-voice{height:118px;display:flex;align-items:center;justify-content:center;gap:3px;margin-bottom:4px}
.pmx-voice span{width:30px;height:30px;border-radius:50%;background:#3fe0b0;color:#1d1636;display:grid;place-items:center;font-size:13px;border:2.5px solid #fff;margin-left:4px;animation:pmxPulse 1.4s infinite}
.pmx-voice i{width:4px;border-radius:3px;background:#3fe0b0;animation:pmWv .8s ease-in-out infinite alternate}
.pmx-voice i:nth-child(2n){animation-delay:-.3s}.pmx-voice i:nth-child(3n){animation-delay:-.55s}
@keyframes pmWv{from{height:15%}to{height:70%}}
@keyframes pmxPulse{50%{transform:scale(1.15)}}
.pmx-cert{height:118px;margin:0 auto 4px;width:78px;background:#fff3d1;color:#1d1636;border:3px solid #1d1636;border-radius:10px;display:grid;place-content:center;gap:4px;padding:6px;box-shadow:0 4px 0 #1d1636;transform:rotate(-5deg);animation:pmxWob 3s ease-in-out infinite alternate}
.pmx-cert small{font-size:8px;color:#ff3d7f;font-weight:700}.pmx-cert b{font-family:Karantina,sans-serif;font-size:21px;line-height:.9;color:#7b5cff}.pmx-cert em{font-style:normal;font-size:7px}
@keyframes pmxWob{to{transform:rotate(4deg) translateY(-3px)}}
.pmx-cta{position:relative;overflow:hidden;font-family:inherit;font-weight:700;font-size:1.2rem;border:3.5px solid #1d1636;background:linear-gradient(180deg,#ffe26b,#ffc21f);color:#1d1636;border-radius:18px;padding:15px 18px;box-shadow:0 6px 0 #1d1636;cursor:pointer;animation:pmxPulse 2.4s ease-in-out infinite}
.pmx-cta::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,#ffffffb0,transparent);transform:skewX(-20deg);animation:pmxShine 2.8s ease-in-out infinite}
@keyframes pmxShine{0%,55%{left:-60%}100%{left:130%}}
.pmx-cta:active{transform:translateY(4px);box-shadow:0 2px 0 #1d1636}
.pmx-cta:focus-visible,.pmx-free:focus-visible,.pmx-link:focus-visible{outline:3px solid #fff;outline-offset:3px}
.pmx-sub{font-size:.82rem;color:#d8cffa}
.pmx-free{font-family:inherit;font-weight:700;font-size:1rem;background:#ffffff1c;color:#fff;border:2px solid #ffffff55;border-radius:14px;padding:11px 14px;cursor:pointer}
.pmx-link{font-family:inherit;background:none;border:0;color:#d8cffa;text-decoration:underline;font-size:.88rem;cursor:pointer}
.pmx-secrets{list-style:none;margin:0;padding:0;display:grid;gap:7px;text-align:right}
.pmx-secrets li{display:flex;gap:8px;align-items:flex-start;background:#ffffff14;border:2px solid #ffffff22;border-radius:14px;padding:9px 11px;font-size:.92rem;line-height:1.4;font-weight:700;animation:pmxIn .5s cubic-bezier(.2,1.4,.4,1) backwards}
.pmx-secrets li:nth-child(2){animation-delay:.12s}.pmx-secrets li:nth-child(3){animation-delay:.24s}.pmx-secrets li:nth-child(4){animation-delay:.36s}
@keyframes pmxIn{from{opacity:0;transform:translateX(-20px)}}
.pmx-blur{display:inline-block;filter:blur(6px);background:#ffd23f33;border-radius:6px;padding:0 4px;color:#ffd23f;user-select:none;-webkit-user-select:none;animation:pmxJig 2.5s ease-in-out infinite}
@keyframes pmxJig{50%{filter:blur(4px)}}
.pmx-media{display:grid;gap:8px}
.pmx-media p{margin:0;font-size:.9rem;line-height:1.4}
.pmx-thumbs{display:flex;justify-content:center;gap:6px}
.pmx-th{width:48px;height:48px;border-radius:12px;border:2.5px solid #fff;background:#7b5cff center/cover;filter:blur(3px) saturate(1.2);transform:rotate(var(--r,0deg))}
.pmx-th:nth-child(odd){--r:-6deg}.pmx-th:nth-child(even){--r:5deg}
.pmx-th.vid{position:relative;overflow:hidden;width:62px;filter:none}.pmx-th.vid video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(4px) saturate(1.3);transform:scale(1.15)}.pmx-th.vid span{position:absolute;inset:0;display:grid;place-items:center;font-size:16px;text-shadow:0 1px 4px #000}
.pmx-stamp{position:absolute;top:16px;left:-6px;transform:rotate(-14deg);border:3px solid #ff3d7f;color:#ff3d7f;font-family:Karantina,sans-serif;font-size:1.7rem;padding:0 10px;border-radius:8px;opacity:.85;animation:pmxStamp .6s cubic-bezier(.2,1.6,.4,1) .4s backwards,pmxGlitch 3.5s steps(1) 1.2s infinite}
@keyframes pmxStamp{from{transform:rotate(-14deg) scale(3);opacity:0}}
@keyframes pmxGlitch{0%,92%,100%{translate:0 0;filter:none}93%{translate:3px -1px;filter:hue-rotate(90deg)}95%{translate:-3px 1px}97%{translate:1px 0;filter:hue-rotate(-60deg)}}
.pmx-n{display:inline!important;color:#ffd23f;font-variant-numeric:tabular-nums}
.pmx-hero .pmx-secrets li{background:linear-gradient(90deg,#ff3d7f22,#ffffff10)}
.pmx-th.lock{filter:none;display:grid;place-items:center;background:#1d1636;font-size:20px}
.pmx-certline{margin:0;font-size:.92rem}
.pmx-certline b{color:#ffd23f}
.pmx-hero.on{background:radial-gradient(120% 80% at 50% 0%,#19c39a 0%,#1d5a63 60%,#17112e 100%)}
@media (max-width:360px){.pmx-tiles{grid-template-columns:1fr 1fr}.pmx-tile:last-child{grid-column:span 2}}
@media (prefers-reduced-motion:reduce){.pmx-show *,.pmx-hero *,.pmx-ring{animation:none!important}.pmx-f.f1{opacity:1}}
.pmf-fab{position:fixed;bottom:calc(14px + env(safe-area-inset-bottom));left:50%;translate:-50% 0;white-space:nowrap;z-index:8000;font-family:"Varela Round",sans-serif;font-weight:700;font-size:15px;border:3px solid #1d1636;background:#e9d3a2;color:#1d1636;border-radius:999px;padding:11px 16px;box-shadow:0 5px 0 #1d1636;cursor:pointer;direction:rtl;animation:pmxPulse 2.2s ease-in-out infinite}
.pmf-fab span{background:#c81e3c;color:#fff;border-radius:99px;padding:1px 7px;font-size:12px;margin-inline-start:4px}
.pmf-fab.pop{animation:pmfPop .7s cubic-bezier(.2,1.6,.4,1),pmxPulse 2.2s ease-in-out .7s infinite}
@keyframes pmfPop{from{transform:scale(0) rotate(-20deg)}}
.pmf-names{display:flex;flex-wrap:wrap;gap:8px}.pmf-names button{font-family:inherit;font-weight:700;border:3px solid #1d1636;background:#e9d3a2;color:#1d1636;border-radius:14px;padding:10px 12px;cursor:pointer;box-shadow:0 4px 0 #1d1636}
.pmf{padding:0;background:none;backdrop-filter:none;-webkit-backdrop-filter:none}
.pm-toast{position:fixed;bottom:24px;left:50%;translate:-50% 20px;z-index:9500;background:#fff3d1;color:#1d1636;border:3px solid #1d1636;box-shadow:0 5px 0 #1d1636;border-radius:16px;padding:10px 16px;font-family:"Varela Round",sans-serif;font-weight:700;opacity:0;transition:.3s;direction:rtl;max-width:90vw;text-align:center}
.pm-toast.show{opacity:1;translate:-50% 0}
.pm-layer.pmw{padding:0;background:#0c0820;backdrop-filter:none;-webkit-backdrop-filter:none}
.pm-layer{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;background:#0c0820cc;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-family:"Varela Round",system-ui,sans-serif;color:#1d1636;direction:rtl;padding:14px;animation:pmIn .25s ease}
@keyframes pmIn{from{opacity:0}}
.pm-sheet{background:#fff3d1;border:4px solid #1d1636;border-radius:26px;box-shadow:0 10px 0 #1d1636;width:min(440px,100%);max-height:calc(100dvh - 40px);overflow:auto;padding:18px;display:grid;gap:12px;animation:pmUp .45s cubic-bezier(.2,1.4,.4,1)}
.pm-sheet.wide{width:min(560px,100%)}
@keyframes pmUp{from{transform:translateY(40px) scale(.94);opacity:0}}
.pm-head{display:flex;justify-content:space-between;align-items:center;font-size:1.25rem}
.pm-x{border:0;background:#1d163618;width:38px;height:38px;border-radius:50%;font-size:18px;cursor:pointer;color:#1d1636}
.pm-dim{font-size:.92rem;color:#5a4a8a;line-height:1.5}
.pm-list{list-style:none;display:grid;gap:6px;font-weight:700;font-size:.98rem}
.pm-price{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;background:#1d1636;color:#fff;border-radius:16px;padding:10px 14px}
.pm-price b{font-family:Karantina,sans-serif;font-size:2.6rem;color:#ffd23f;line-height:1}
.pm-price span{font-size:.88rem;opacity:.85}
.pm-step{display:flex;gap:10px;align-items:flex-start}
.pm-step>div{display:grid;gap:8px;flex:1}
.pm-n{flex:none;width:32px;height:32px;border-radius:50%;background:#7b5cff;color:#fff;display:grid;place-items:center;font-weight:700;border:3px solid #1d1636}
.pm-btn{display:block;text-align:center;text-decoration:none;font-family:inherit;font-weight:700;font-size:1.05rem;border:3.5px solid #1d1636;background:#ffd23f;color:#1d1636;border-radius:16px;padding:12px 18px;box-shadow:0 5px 0 #1d1636;cursor:pointer}
.pm-btn:active{transform:translateY(3px);box-shadow:0 2px 0 #1d1636}
.pm-btn:disabled{opacity:.45;cursor:not-allowed}
.pm-btn.big{font-size:1.25rem;padding:15px}
.pm-btn.alt{background:#fff}
.pm-btn.bit{background:#3fe0b0}
.pm-btn:focus-visible,.pm-x:focus-visible{outline:3px solid #7b5cff;outline-offset:3px}
.pm-more summary{cursor:pointer;font-size:.9rem;color:#5a4a8a}
.pm-qr{width:170px;margin:8px auto;background:#fff;padding:10px;border-radius:14px;border:3px solid #1d1636}
.pm-qr svg{width:100%;height:auto;display:block}
.pm-code{display:flex;align-items:center;gap:10px;background:#fff;border:3px dashed #1d1636;border-radius:14px;padding:8px 12px}
.pm-code span{font-family:Karantina,sans-serif;font-size:2.6rem;letter-spacing:4px;flex:1;text-align:center;line-height:1}
.pm-code button{border:3px solid #1d1636;background:#ffd23f;border-radius:10px;padding:6px 10px;font-family:inherit;font-weight:700;cursor:pointer;color:#1d1636}
.pm-h{font-size:1.05rem;margin-top:4px}
.pm-mock{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pm-mock div{background:#fff;border:2.5px solid #1d1636;border-radius:12px;padding:6px 10px;display:grid}.pm-mock small{font-size:.75rem;color:#5a4a8a}.pm-mock b{font-size:1.15rem}
.pm-step>div>.pm-dim{display:block}
.pm-faq summary{cursor:pointer;font-weight:700;color:#5a4a8a}.pm-faq p{font-size:.9rem;line-height:1.5;margin-top:8px}
.pm-wait{list-style:none;display:grid;gap:8px;font-weight:700}.pm-wait li{background:#fff;border:2.5px solid #1d1636;border-radius:12px;padding:8px 12px;display:flex;gap:8px;align-items:center;opacity:.55}.pm-wait li.done{opacity:1;background:#d8f8ec}.pm-wait li.now{opacity:1;background:#fff8d6}
.pm-terms{display:flex;gap:8px;align-items:center;font-size:.95rem;font-weight:700}
.pm-terms input{width:22px;height:22px;accent-color:#7b5cff}
.pm-terms a{color:#7b5cff}
.pm-err{color:#c81e3c;font-weight:700}
.pm-done{display:grid;justify-items:center;text-align:center;gap:8px}
.pm-done h3{font-family:Karantina,sans-serif;font-size:2.4rem;line-height:1}
.pm-dots,.mq-dots{display:inline-flex;gap:5px}.pm-dots i,.mq-dots i{width:9px;height:9px;border-radius:50%;background:#7b5cff;animation:pmDot 1.2s infinite}.pm-dots i:nth-child(2),.mq-dots i:nth-child(2){animation-delay:.15s}.pm-dots i:nth-child(3),.mq-dots i:nth-child(3){animation-delay:.3s}
@keyframes pmDot{50%{transform:translateY(-7px);opacity:.5}}
.pm-tabs{display:flex;gap:6px;overflow-x:auto}.pm-tabs button{flex:none;border:3px solid #1d1636;background:#fff;border-radius:99px;padding:6px 12px;font-family:inherit;font-weight:700;cursor:pointer;color:#1d1636}.pm-tabs button[aria-pressed=true]{background:#7b5cff;color:#fff}
.pm-grid{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:108px;gap:8px;max-height:52dvh;overflow:auto;padding:2px}
.pm-tile{position:relative;height:100%;width:100%;margin:0;min-height:0;box-shadow:none;border:3px solid #1d1636;border-radius:14px;background:#e9e2ff;overflow:hidden;cursor:pointer;padding:0;font-family:inherit}
.pm-th{position:absolute;inset:0;display:grid;place-items:center;font-size:34px}.pm-th img,.pm-th video{width:100%;height:100%;object-fit:cover}
.pm-tile[data-k=sticker] .pm-th img{object-fit:contain;padding:6px}
.pm-tile small{position:absolute;bottom:0;inset-inline:0;background:#1d1636cc;color:#fff;font-size:11px;padding:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pm-tile em{position:absolute;inset:0;display:none;place-items:center;font-style:normal;font-size:44px;color:#fff;background:#c81e3caa;font-weight:700}
.pm-tile.out em{display:grid}
.pm-img img{width:100%;border-radius:14px;border:3px solid #1d1636}
.pm-cview{display:grid;place-items:center}.pm-cview canvas{width:min(78vw,330px,calc((100dvh - 230px) * .5625));height:auto;border-radius:16px;border:3px solid #1d1636;touch-action:pan-y}
.pm-cnav{display:flex;justify-content:center;align-items:center;gap:16px;font-weight:700}.pm-cnav[hidden]{display:none}.pm-nav{width:52px;height:52px;border-radius:50%;border:3.5px solid #1d1636;background:#fff;font-size:22px;font-weight:700;cursor:pointer;box-shadow:0 4px 0 #1d1636;color:#1d1636}
.pm-cert{flex:none;width:min(78vw,300px);scroll-snap-align:center;display:grid;gap:8px}
.pm-cert canvas{width:100%;height:auto;border-radius:16px;border:3px solid #1d1636;background:#fff3d1}
/* media in the question bubble */
.mq{display:grid;place-items:center;min-height:120px;margin:4px 0 8px}
.mq img{max-width:100%;max-height:min(34dvh,320px);border-radius:16px;display:block;border:3px solid #1d1636;background:#fff}
.mq img.sticker{border:0;background:none;max-height:min(30dvh,240px);filter:drop-shadow(0 6px 0 #1d163633)}
.mq video{max-width:100%;max-height:min(34dvh,320px);border-radius:16px;border:3px solid #1d1636;background:#000}
.mq-load{font-size:1rem;color:#6b5f8f;display:flex;align-items:center;gap:8px}
.mq-play{margin-top:8px;border:3px solid #1d1636;background:#ffd23f;border-radius:14px;padding:8px 16px;font-family:inherit;font-weight:700;cursor:pointer;color:#1d1636}
.mq-aud{display:flex;align-items:center;gap:14px;background:#1d1636;border-radius:999px;padding:10px 18px 10px 10px}
.mq-btn{width:64px;height:64px;border-radius:50%;border:4px solid #fff;background:#3fe0b0;font-size:26px;color:#1d1636;cursor:pointer;flex:none}
.mq-btn.pulse{animation:pmPulse 1s infinite}
@keyframes pmPulse{50%{transform:scale(1.12)}}
.mq-wave{display:flex;align-items:center;gap:4px;height:54px}
.mq-wave i{width:6px;height:20%;border-radius:4px;background:#3fe0b0;opacity:.5}
.mq-aud.on .mq-wave i{opacity:1;animation:pmWv .9s ease-in-out infinite alternate}
@keyframes pmWv{from{height:15%}to{height:100%}}
@media (prefers-reduced-motion:reduce){.pm-layer *,.pm-layer{animation-duration:.01s!important;transition-duration:.01s!important}}
`;
  document.head.append(s);
}
