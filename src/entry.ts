import { parseWhatsApp, readChatFile, departedMembers } from "./lib/parser";
import { computeStats } from "./lib/stats";
import { createNet } from "./net";
import * as Premium from "./premium";
import qrcode from "qrcode-generator";
const qr = (text: string) => { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); };
(window as any).Chat = { parseWhatsApp, readChatFile, departedMembers, computeStats, createNet, qr };
(window as any).Premium = Premium;
