// Parses WhatsApp chat exports (iOS + Android, Hebrew + English locales).
// Runs in the browser — the raw chat never leaves the user's device.

export type Message = {
  ts: number | null; // epoch ms
  author: string;
  text: string;
  media: boolean;
  deleted: boolean;
};

const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;

// [2.1.2026, 22:15:03] Name: text      (iOS)
// 2.1.2026, 22:15 - Name: text         (Android)
// 1/2/26, 10:15 PM - Name: text        (Android, US)
const LINE_RE =
  /^\[?(\d{1,4})[.\/-](\d{1,2})[.\/-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:[-–]\s*)?/;

const MEDIA_RE =
  /^<?(media omitted|המדיה לא נכללה|המדיה הושמטה|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|התמונה הושמטה|הסרטון הושמט|השמע הושמט|המדבקה הושמטה|ה-gif הושמט|המסמך הושמט|attached:.*|מצורף:.*)>?$/i;
const DELETED_RE =
  /^(this message was deleted|you deleted this message|ההודעה נמחקה|מחקת את ההודעה הזו|הודעה זו נמחקה)\.?$/i;

// WhatsApp writes group events as if the group itself sent them ("[date] Group name: ‎X added Y").
// On iOS those lines carry an invisible LTR mark right after the colon. We drop them.
const SYSTEM_RE = new RegExp([
  "messages and calls are end-to-end encrypted", "created (this )?group", "\\b(added|removed)\\b", "\\bleft$",
  "changed (the subject|this group|the group|their phone number)", "joined using (this|a) group", "pinned a message",
  "disappearing messages", "you're now an admin", "security code (with|changed)", "is a contact",
  "ההודעות והשיחות מוצפנות", "יצר/?ה? את הקבוצה", "יצרה את הקבוצה", "הוסיפ?/?ה?", "הסיר/?ה?", "יצא/?ה?$", "עזב/?ה?",
  "שינה/?תה? את", "שינתה את", "הצטרפ?/?ה? (באמצעות|דרך)", "נעצ?/?ה? הודעה", "הודעות זמניות", "קוד האבטחה", "מנהל/?ת? (של )?הקבוצה",
].join("|"), "i");
export const isSystemText = (t: string) => SYSTEM_RE.test(t);

type Raw = { a: number; b: number; c: number; h: number; m: number; s: number; ampm?: string; rest: string; mark: boolean };

export function parseWhatsApp(input: string): Message[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const raws: Raw[] = [];
  let current: Raw | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(BIDI, "");
    const m = LINE_RE.exec(line);
    if (m) {
      current = {
        a: +m[1], b: +m[2], c: +m[3], h: +m[4], m: +m[5], s: m[6] ? +m[6] : 0,
        ampm: m[7]?.replace(/[.\s]/g, "").toLowerCase(),
        rest: line.slice(m[0].length),
        mark: /:\s‎/.test(rawLine),
      };
      raws.push(current);
    } else if (current) {
      current.rest += "\n" + line;
    }
  }

  // Decide day/month order from the whole file. Israel default: D/M.
  let dmy = true;
  if (raws.some((r) => r.b > 12 && r.a <= 12)) dmy = false;
  if (raws.some((r) => r.a > 12 && r.a < 32)) dmy = true;

  const out: Message[] = [];
  const sys = new Set<string>(), marked = new Map<string, number>(), total = new Map<string, number>();
  for (const r of raws) {
    const idx = r.rest.indexOf(": ");
    if (idx <= 0 || idx > 80) continue; // system message ("X added Y", encryption notice…)
    const author = cleanName(r.rest.slice(0, idx));
    const text = r.rest.slice(idx + 2).trim();
    if (!author) continue;

    let day = dmy ? r.a : r.b;
    let month = dmy ? r.b : r.a;
    let year = r.c;
    if (r.a > 31) { year = r.a; month = r.b; day = r.c; } // YYYY-MM-DD
    if (year < 100) year += 2000;
    let hour = r.h;
    if (r.ampm === "pm" && hour < 12) hour += 12;
    if (r.ampm === "am" && hour === 12) hour = 0;
    const ts = new Date(year, month - 1, day, hour, r.m, r.s).getTime();

    const media = MEDIA_RE.test(text) || /<attached: /i.test(text);
    const deleted = DELETED_RE.test(text);
    // group events: marked by WhatsApp, or the classic encryption notice in any locale
    if (!media && ((r.mark && isSystemText(text)) || /end-to-end encrypted|מוצפנות מקצה לקצה/i.test(text))) { sys.add(author); continue; }
    if (r.mark && !media) marked.set(author, (marked.get(author) || 0) + 1);
    total.set(author, (total.get(author) || 0) + 1);
    out.push({ ts: isNaN(ts) ? null : ts, author, text: media || deleted ? "" : text, media, deleted });
  }
  // A "person" who only ever posts WhatsApp-marked event lines is the group itself, not a member.
  const fake = new Set([...sys].filter((a) => !total.has(a) || (marked.get(a) || 0) >= (total.get(a) || 0)));
  return fake.size ? out.filter((m) => !fake.has(m.author)) : out;
}

/** People who are no longer in the group: their last membership event was leaving or being removed.
 *  WhatsApp writes these as system lines ("X left", "X removed Y", "X יצא/ה", "X הסיר/ה את Y"). */
export function departedMembers(input: string): string[] {
  const state = new Map<string, "in" | "out">();
  const names = (s: string) => s.split(/\s*,\s*|\s+and\s+|\s+ו(?:את\s+)?(?=\S)|\s+ואת\s+/).map((x) => cleanName(x.replace(/^את\s+/, "").replace(/[.\s]+$/, ""))).filter((x) => x && x.length <= 60);
  for (const rawLine of input.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(BIDI, "");
    const m = LINE_RE.exec(line); if (!m) continue;
    let rest = line.slice(m[0].length).trim();
    const marked = /:\s\u200e/.test(rawLine);
    const idx = rest.indexOf(": ");
    if (marked && idx > 0) rest = rest.slice(idx + 2).trim();       // iOS: "Group: ‎X left"
    else if (idx > 0 && idx <= 80) continue;                         // a normal "Name: text" message
    let r: RegExpExecArray | null;
    if ((r = /^(.+?)\s+(?:left|יצא\/ה|יצאה|יצא|עזב\/ה|עזבה|עזב)(?:\s+(?:the group|מהקבוצה|את הקבוצה).*)?$/i.exec(rest))) names(r[1]).forEach((n) => state.set(n, "out"));
    else if ((r = /^(.+?)\s+(?:removed|הסיר\/ה\s+את|הסירה\s+את|הסיר\s+את|הוציא\/ה\s+את|הוציאה\s+את|הוציא\s+את)\s+(.+?)(?:\s+(?:from the group|מהקבוצה))?$/i.exec(rest))) names(r[2]).forEach((n) => state.set(n, "out"));
    else if ((r = /^(.+?)\s+(?:was removed|הוסר\/ה|הוסרה|הוסר)\b/i.exec(rest))) names(r[1]).forEach((n) => state.set(n, "out"));
    else if ((r = /^(.+?)\s+(?:added|הוסיף\/ה\s+את|הוסיפה\s+את|הוסיף\s+את)\s+(.+)$/i.exec(rest))) names(r[2]).forEach((n) => state.set(n, "in"));
    else if ((r = /^(.+?)\s+(?:joined|הצטרף\/ה|הצטרפה|הצטרף)\b/i.exec(rest))) names(r[1]).forEach((n) => state.set(n, "in"));
  }
  return [...state].filter(([n, v]) => v === "out" && !/^(you|את\/ה|אתה|את)$/i.test(n)).map(([n]) => n);
}

function cleanName(n: string): string {
  const name = n.replace(BIDI, "").replace(/^~\s*/, "").trim();
  // Unsaved contacts appear as phone numbers — mask them.
  const digits = name.replace(/[^\d]/g, "");
  if (digits.length >= 8 && /^[+\d\s()-]+$/.test(name)) return "מספר שמסתיים ב-" + digits.slice(-3);
  return name;
}

/** Pick the chat .txt out of a WhatsApp export ZIP (or accept a plain .txt). */
export async function readChatFile(file: File): Promise<string> {
  if (/\.txt$/i.test(file.name)) return file.text();
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const txts = Object.values(zip.files).filter((f) => !f.dir && /\.txt$/i.test(f.name));
  if (!txts.length) throw new Error("לא נמצא קובץ צ'אט בתוך ה-ZIP. ודאו שייצאתם את הצ'אט מוואטסאפ.");
  const preferred = txts.find((f) => /_chat\.txt$|whatsapp/i.test(f.name)) ?? txts[0];
  return preferred.async("string");
}
