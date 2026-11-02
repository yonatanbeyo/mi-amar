import type { Message } from "./parser";

export type PersonStats = {
  name: string;
  messages: number;
  words: number;
  share: number; // % of messages
  avgWords: number;
  media: number;
  deleted: number;
  nightShare: number; // % of their messages sent 00:00–05:00
  starts: number; // conversations started (after 3h of silence)
  laughsCaused: number; // times someone laughed right after them
  avgReplyMin: number | null; // median reply time to someone else, minutes
  topEmojis: string[];
  catchphrases: string[]; // phrases this person repeats
};

export type ChatStats = {
  totalMessages: number;
  totalWords: number;
  from: number | null;
  to: number | null;
  days: number;
  people: PersonStats[];
  longest: { author: string; words: number; ts: number | null; preview: string } | null;
  busiestDay: { ts: number; count: number } | null;
  busiestHour: number | null;
  hours: number[]; // 24 buckets
  topEmojis: { emoji: string; count: number }[];
  laughs: number;
};

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
const LAUGH_RE = /(חחח|xa?xa|haha|lol|lmao|😂|🤣|💀)/i;
const GAP = 3 * 60 * 60 * 1000;

export function computeStats(msgs: Message[]): ChatStats {
  const by = new Map<string, {
    messages: number; words: number; media: number; deleted: number; night: number;
    starts: number; laughsCaused: number; replies: number[]; emojis: Map<string, number>; grams: Map<string, number>;
  }>();
  const hours = new Array(24).fill(0);
  const dayCounts = new Map<number, number>();
  const allEmojis = new Map<string, number>();
  let totalWords = 0, laughs = 0;
  let longest: ChatStats["longest"] = null;

  msgs.forEach((m, i) => {
    let p = by.get(m.author);
    if (!p) {
      p = { messages: 0, words: 0, media: 0, deleted: 0, night: 0, starts: 0, laughsCaused: 0, replies: [], emojis: new Map(), grams: new Map() };
      by.set(m.author, p);
    }
    const words = m.text ? m.text.split(/\s+/).filter(Boolean).length : 0;
    p.messages++; p.words += words; totalWords += words;
    if (m.media) p.media++;
    if (m.deleted) p.deleted++;
    if (!longest || words > longest.words) {
      longest = { author: m.author, words, ts: m.ts, preview: m.text.slice(0, 600) };
    }
    countGrams(m.text, p.grams);
    for (const e of m.text.match(EMOJI_RE) ?? []) {
      p.emojis.set(e, (p.emojis.get(e) ?? 0) + 1);
      allEmojis.set(e, (allEmojis.get(e) ?? 0) + 1);
    }
    const prev = msgs[i - 1];
    if (m.ts != null) {
      const d = new Date(m.ts);
      const h = d.getHours();
      hours[h]++;
      if (h < 5) p.night++;
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      if (!prev || prev.ts == null || m.ts - prev.ts > GAP) p.starts++;
      else if (prev.author !== m.author) p.replies.push((m.ts - prev.ts) / 60000);
    }
    if (LAUGH_RE.test(m.text)) {
      laughs++;
      if (prev && prev.author !== m.author) {
        const pp = by.get(prev.author);
        if (pp) pp.laughsCaused++;
      }
    }
  });

  const total = msgs.length || 1;
  const people: PersonStats[] = [...by.entries()]
    .map(([name, p]) => ({
      name,
      messages: p.messages,
      words: p.words,
      share: Math.round((p.messages / total) * 1000) / 10,
      avgWords: Math.round((p.words / Math.max(1, p.messages - p.media)) * 10) / 10,
      media: p.media,
      deleted: p.deleted,
      nightShare: Math.round((p.night / p.messages) * 1000) / 10,
      starts: p.starts,
      laughsCaused: p.laughsCaused,
      avgReplyMin: p.replies.length >= 5 ? Math.round(median(p.replies) * 10) / 10 : null,
      topEmojis: [...p.emojis.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e),
      catchphrases: [...p.grams.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g, c]) => `${g} (${c})`),
    }))
    .sort((a, b) => b.messages - a.messages);

  const tsList = msgs.map((m) => m.ts).filter((t): t is number => t != null);
  const from = tsList.length ? extreme(tsList, "min") : null;
  const to = tsList.length ? extreme(tsList, "max") : null;
  const busiest = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const maxHour = Math.max(...hours);

  return {
    totalMessages: msgs.length,
    totalWords,
    from, to,
    days: from && to ? Math.max(1, Math.round((to - from) / 86400000)) : 0,
    people,
    longest,
    busiestDay: busiest ? { ts: busiest[0], count: busiest[1] } : null,
    busiestHour: maxHour > 0 ? hours.indexOf(maxHour) : null,
    hours,
    topEmojis: [...allEmojis.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([emoji, count]) => ({ emoji, count })),
    laughs,
  };
}

const STOP = new Set("של את על זה זו אני אתה את הוא היא אנחנו הם לא כן גם רק מה מי עם אם כי או אבל יש אין לי לך לו לה לכם להם שלי שלך עוד כבר כל אז פה שם היה הייתה יהיה בה בו זה הזה כמו אחרי לפני the a to and of is i you it in that".split(" "));
function countGrams(text: string, into: Map<string, number>) {
  if (!text || /^https?:/.test(text)) return;
  const w = text.toLowerCase().replace(/https?:\S+/g, " ").match(/[\p{L}\p{N}']+/gu);
  if (!w || w.length < 2) return;
  const seen = new Set<string>();
  for (let n = 2; n <= 3; n++)
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      if (g.every((x) => STOP.has(x) || /^(ח{2,}|x{2,}|ha+)$/.test(x))) continue;
      const k = g.join(" ");
      if (k.length < 5 || seen.has(k)) continue;
      seen.add(k);
      into.set(k, (into.get(k) ?? 0) + 1);
    }
  // keep memory bounded on huge chats
  if (into.size > 20000) for (const [k, c] of into) if (c < 2) into.delete(k);
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

// Math.min(...hugeArray) overflows the stack on big chats — loop instead.
function extreme(a: number[], kind: "min" | "max") {
  let v = a[0];
  for (const x of a) v = kind === "min" ? Math.min(v, x) : Math.max(v, x);
  return v;
}

/**
 * Build the text the AI reads. Three parts:
 * 1. how each person writes: a spread of their messages across the whole chat,
 * 2. each person's longest messages,
 * 3. windows of consecutive messages (jokes keep their context), denser toward recent months.
 * Capped at `maxChars`; if the chat fits, it is sent whole.
 */
export function buildSample(msgs: Message[], maxChars = 150000): string {
  const fmt = (m: Message) => {
    const d = m.ts ? new Date(m.ts) : null;
    const date = d ? `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}` : "";
    const body = m.media ? "<מדיה>" : m.deleted ? "<נמחקה>" : m.text.slice(0, 500);
    return `[${date}] ${m.author}: ${body}`;
  };

  const text = msgs.filter((m) => m.text || m.media);
  const whole = text.map(fmt).join("\n");
  if (whole.length <= maxChars) return whole;

  const parts: string[] = [];
  let used = 0;
  const push = (line: string, budget: number) => {
    if (used + line.length + 1 > budget) return false;
    parts.push(line); used += line.length + 1; return true;
  };
  const authors = [...new Set(text.map((m) => m.author))];
  const counts = new Map(authors.map((a) => [a, text.filter((m) => m.author === a).length]));
  authors.sort((a, b) => counts.get(b)! - counts.get(a)!);
  const main = authors.slice(0, 8);

  // 1. Voice: up to 40 messages per person, spread evenly across their history (25% of budget)
  const voiceBudget = maxChars * 0.25;
  parts.push("### איך כל אחד כותב (הודעות מפוזרות לאורך כל הצ'אט)");
  const perPerson = Math.floor(voiceBudget / main.length);
  for (const a of main) {
    const mine = text.filter((m) => m.author === a && m.text.length > 12);
    const start = used;
    const step = Math.max(1, Math.floor(mine.length / 40));
    for (let i = 0; i < mine.length; i += step) {
      if (used - start > perPerson || !push(fmt(mine[i]), voiceBudget)) break;
    }
  }

  // 2. Longest messages per person (10%)
  const longBudget = used + maxChars * 0.1;
  parts.push("### ההודעות הכי ארוכות של כל אחד");
  for (const a of main) {
    const top = text.filter((m) => m.author === a && m.text).sort((x, y) => y.text.length - x.text.length).slice(0, 2);
    for (const m of top) push(fmt(m), longBudget);
  }

  // 3. Conversation windows of 40 consecutive messages
  const WINDOW = 40;
  const avgLen = whole.length / text.length;
  const windows = Math.max(8, Math.floor((maxChars - used) / (WINDOW * avgLen + 20)));
  const starts = new Set<number>();
  for (let i = 0; i < windows; i++) {
    const t = Math.pow(i / Math.max(1, windows - 1), 0.75);
    starts.add(Math.min(text.length - WINDOW, Math.floor(t * (text.length - WINDOW))));
  }
  for (const st of [...starts].sort((x, y) => x - y)) {
    const block = text.slice(st, st + WINDOW).map(fmt).join("\n");
    if (used + block.length > maxChars) break;
    parts.push("### קטע רצוף מהשיחה", block);
    used += block.length + 25;
  }
  return parts.join("\n");
}
