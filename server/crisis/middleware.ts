/**
 * Crisis safety middleware.
 *
 * Runs on the AI chat entry points BEFORE any LLM call. On a regex match it
 * bypasses the model entirely, logs an anonymous signal (category only — never
 * content), and returns the purpose-built crisis response. On no match it calls
 * next() and the normal RAG + LLM flow proceeds untouched (zero added latency
 * beyond a synchronous regex scan).
 *
 * The user is NOT locked out — they can keep chatting. The classifier simply
 * re-fires on any new crisis language.
 *
 * PRIVACY: the user's message is read only for the synchronous regex check and
 * is never stored or logged. Only { userId?, sessionId?, category } is written.
 */

import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { detectCrisisCategory, type CrisisCategory } from "./patterns";
import { buildCrisisResponse } from "./response";

/**
 * Pull the user's free-text message from the request. The consumer app calls
 * the AI endpoints via GET (iframe sandbox blocks POST) with the text in the
 * `question` query param; we also accept `message`/body for robustness.
 */
function extractMessage(req: Request): string {
  const q = req.query || {};
  const b = (req.body as Record<string, unknown>) || {};
  const candidate =
    q.question ?? q.message ?? b.question ?? b.message ?? "";
  return typeof candidate === "string" ? candidate : "";
}

function extractUserId(req: Request): number | null {
  const raw = (req.query?.userId ?? (req.body as any)?.userId) as unknown;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function extractSessionId(req: Request): string | null {
  const raw = (req.query?.sessionId ?? (req.body as any)?.sessionId) as unknown;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/** Log an anonymous signal. Non-blocking — logging failure must never break the
 * crisis response the user needs to see. NO MESSAGE CONTENT is passed in. */
function logCrisisSignal(category: CrisisCategory, userId: number | null, sessionId: string | null): void {
  try {
    storage.logCrisisSignal({
      userId,
      sessionId,
      category,
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    // Deliberately logs category only — never the message.
    console.error("crisis_signal_log_failed", { category, error: err?.message });
  }
}

export function crisisSafetyCheck(req: Request, res: Response, next: NextFunction) {
  const message = extractMessage(req);
  if (!message) return next();

  const category = detectCrisisCategory(message);
  if (!category) return next();

  logCrisisSignal(category, extractUserId(req), extractSessionId(req));

  const response = buildCrisisResponse(category);
  // Returned at the top level so the consumer app can branch on
  // `data.type === 'crisis_safety'` regardless of which AI endpoint it hit.
  return res.json(response);
}
