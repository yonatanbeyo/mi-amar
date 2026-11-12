// Realtime layer. The game code talks to a small "room" interface:
//   presence(patch)  – my own state (a phone's name + answer); host keeps none
//   emit("st", data) – host only: the whole game state
//   on("st", fn)     – phones: hear the state
//   onPeers(fn)      – host: everyone in the game with their presence
// Two backends: Firebase Realtime Database (production) and a BroadcastChannel one (same-browser test mode).
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, get, onValue, onDisconnect, remove, runTransaction, serverTimestamp } from "firebase/database";

type Peer = { peer: string; presence: Record<string, unknown>; isMe: boolean; sameTab: boolean; kind: "viewer"; guest: false; by: null; updatedAt: number };
type Change = { peers: Peer[]; joined: Peer[]; left: Peer[]; updated: Peer[] };
export type GameRoom = {
  code: string;
  presence(patch: Record<string, unknown>): Promise<void>;
  emit(topic: string, data: unknown): Promise<void>;
  on(topic: string, fn: (m: { data: unknown; peer: string; sameTab: boolean }) => void): () => void;
  onPeers(fn: (c: Change) => void): () => void;
  peers(): Peer[];
  close(destroy?: boolean): Promise<void>;
};
export type Stats = { total: Record<string, number>; days: Record<string, Record<string, number>> };
export type Net = { mode: "firebase" | "local"; host(code: string): Promise<GameRoom | null>; join(code: string): Promise<GameRoom | null>;
  /** count an event (games, started, players, finished, single): total + today. Never throws. */
  bump(key: string): void;
  readStats(): Promise<Stats | null>;
  /** live presence: what this device is doing right now (site/lobby/host/single/phone) and how many people are at it */
  live(state: string, n?: number): void;
  /** stats page: everyone online right now, updated in real time */
  watchLive(fn: (rows: { s: string; n: number; t: number }[]) => void): () => void };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const mkPeer = (peer: string, presence: Record<string, unknown>, mine: boolean): Peer => ({ peer, presence, isMe: mine, sameTab: mine, kind: "viewer", guest: false, by: null, updatedAt: Date.now() });
const parse = (s: unknown) => { try { return typeof s === "string" ? JSON.parse(s) : null; } catch { return null; } };

export function createNet(cfg: Record<string, string> | undefined): Net {
  return cfg && cfg.apiKey && cfg.databaseURL ? firebaseNet(cfg) : localNet();
}

function firebaseNet(cfg: Record<string, string>): Net {
  const app = initializeApp(cfg);
  const auth = getAuth(app), db = getDatabase(app);
  let uidP: Promise<string> | null = null;
  const uid = () => (uidP ||= signInAnonymously(auth).then((c) => c.user.uid));
  let liveState = "", liveN = 1, liveKey = "", liveArmed = false, liveTimer: ReturnType<typeof setInterval> | null = null;
  const pushLive = () => { uid().then((me) => { const r = ref(db, `live/${me}`); if (!liveArmed) { liveArmed = true; onDisconnect(r).remove().catch(() => {}); } return set(r, { s: liveState, n: Math.max(1, Math.min(30, liveN | 0)), t: serverTimestamp() }); }).catch(() => {});
    if (!liveTimer) liveTimer = setInterval(() => { if (liveState && document.visibilityState === "visible") pushLive(); }, 60000); };

  function wrap(code: string, me: string, isHost: boolean): GameRoom {
    const base = `games/${code}`;
    let peers: Peer[] = [mkPeer(me, {}, true)];
    let myPres: Record<string, unknown> = {};
    const offs: (() => void)[] = [];
    return {
      code,
      async presence(patch) {
        for (const k in patch) { if (patch[k] === null) delete myPres[k]; else myPres[k] = patch[k]; }
        if (isHost) return;
        const r = ref(db, `${base}/p/${me}`);
        if (myPres.p) { await set(r, JSON.stringify(myPres.p)); onDisconnect(r).remove(); } else await remove(r);
      },
      async emit(_t, data) { if (isHost) await set(ref(db, `${base}/st`), JSON.stringify(data)); },
      on(_t, fn) {
        const off = onValue(ref(db, `${base}/st`), (s) => { const d = parse(s.val()); if (d) fn({ data: d, peer: "host", sameTab: false }); });
        offs.push(off); return off;
      },
      onPeers(fn) {
        const off = onValue(ref(db, `${base}/p`), (s) => {
          const v = (s.val() || {}) as Record<string, string>;
          const before = new Set(peers.map((p) => p.peer));
          const next = [mkPeer(me, myPres, true), ...Object.entries(v).filter(([k]) => k !== me).map(([k, raw]) => mkPeer(k, { p: parse(raw) }, false))];
          const now = new Set(next.map((p) => p.peer));
          const joined = next.filter((p) => !before.has(p.peer)), left = peers.filter((p) => !now.has(p.peer));
          peers = next; fn({ peers, joined, left, updated: next });
        });
        offs.push(off); return off;
      },
      peers: () => peers,
      async close(destroy) {
        offs.splice(0).forEach((f) => f());
        try { if (isHost && destroy) await remove(ref(db, base)); else if (!isHost) await remove(ref(db, `${base}/p/${me}`)); } catch {}
      },
    };
  }
  return {
    mode: "firebase",
    bump(key) {
      if (!/^[a-z_]{1,24}$/.test(key)) return;
      const hh = String(new Date().getHours()).padStart(2, "0"), paths = [`stats/total/${key}`, `stats/days/${today()}/${key}`];
      if (!key.startsWith("r_")) paths.push(`stats/days/${today()}/h${hh}_${key}`);
      uid().then(() => Promise.all(paths.map((p) => runTransaction(ref(db, p), (v) => (typeof v === "number" ? v : 0) + 1)))).catch(() => {});
    },
    live(state, n = 1) {
      liveState = state; liveN = n;
      const k = state + ":" + n;
      if (k === liveKey) return;
      liveKey = k; pushLive();
    },
    watchLive(fn) {
      return onValue(ref(db, "live"), (snap) => { const v = snap.val() || {}; fn(Object.values(v).filter((x: any) => x && typeof x.t === "number") as { s: string; n: number; t: number }[]); }, () => fn([]));
    },
    async readStats() { try { const s = await get(ref(db, "stats")); return (s.val() || { total: {}, days: {} }) as Stats; } catch { return null; } },
    async host(code) {
      const me = await uid();
      // claim the code: succeeds only if nobody owns it yet (or we already do, after a reload)
      const res = await runTransaction(ref(db, `games/${code}/host`), (cur) => (cur == null || cur === me ? me : undefined));
      if (!res.committed) return null;
      await set(ref(db, `games/${code}/t`), serverTimestamp());
      return wrap(code, me, true);
    },
    async join(code) {
      const me = await uid();
      const h = await get(ref(db, `games/${code}/host`));
      if (!h.exists()) return null;
      return wrap(code, me, false);
    },
  };
}

// Same-browser test mode: tabs talk over a BroadcastChannel. Lets you try the whole flow before Firebase is set up.
function localNet(): Net {
  const me = Math.random().toString(36).slice(2, 10);
  const hosting = new Set<string>();
  function wrap(code: string, isHost: boolean): GameRoom {
    const bc = new BroadcastChannel("miamar-" + code);
    const peers = new Map<string, Peer>([[me, mkPeer(me, {}, true)]]);
    const onP: ((c: Change) => void)[] = [], onT: ((m: { data: unknown; peer: string; sameTab: boolean }) => void)[] = [];
    let last: unknown = null;
    const fire = (joined: Peer[] = [], left: Peer[] = []) => { const arr = [...peers.values()]; onP.forEach((f) => f({ peers: arr, joined, left, updated: arr })); };
    bc.onmessage = (e) => {
      const m = e.data;
      if (m.t === "pres") { const isNew = !peers.has(m.peer); peers.set(m.peer, mkPeer(m.peer, m.presence, false)); if (isNew) { bc.postMessage({ t: "pres", peer: me, presence: peers.get(me)!.presence }); if (isHost && last) bc.postMessage({ t: "st", data: last, peer: me }); } fire(isNew ? [peers.get(m.peer)!] : []); }
      if (m.t === "bye") { const p = peers.get(m.peer); if (p) { peers.delete(m.peer); fire([], [p]); } }
      if (m.t === "st") onT.forEach((f) => f({ data: m.data, peer: m.peer, sameTab: false }));
      if (m.t === "ping" && isHost) bc.postMessage({ t: "pong" });
    };
    addEventListener("pagehide", () => bc.postMessage({ t: "bye", peer: me }));
    setTimeout(() => { bc.postMessage({ t: "pres", peer: me, presence: peers.get(me)!.presence }); fire([...peers.values()]); }, 30);
    return {
      code,
      async presence(patch) { const p = { ...peers.get(me)!.presence }; for (const k in patch) { if (patch[k] === null) delete p[k]; else p[k] = patch[k]; } peers.set(me, mkPeer(me, p, true)); bc.postMessage({ t: "pres", peer: me, presence: p }); fire(); },
      async emit(_t, data) { last = data; bc.postMessage({ t: "st", data, peer: me }); },
      on(_t, fn) { onT.push(fn); return () => {}; },
      onPeers(fn) { onP.push(fn); return () => {}; },
      peers: () => [...peers.values()],
      async close() { bc.postMessage({ t: "bye", peer: me }); bc.close(); },
    };
  }
  return {
    mode: "local",
    bump() {},
    live() {},
    watchLive(fn) { fn([]); return () => {}; },
    async readStats() { return null; },
    async host(code) { hosting.add(code); return wrap(code, true); },
    async join(code) {
      // is anyone hosting this code in this browser?
      const bc = new BroadcastChannel("miamar-" + code);
      const ok = await new Promise<boolean>((r) => { const t = setTimeout(() => r(false), 700); bc.onmessage = (e) => { if (e.data.t === "pong" || e.data.t === "st") { clearTimeout(t); r(true); } }; bc.postMessage({ t: "ping" }); });
      bc.close();
      return ok ? wrap(code, false) : null;
    },
  };
}
