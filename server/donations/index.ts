// Public API for the donations module.
// Wires up Express routes for:
//   - GET  /api/donations/eligibility?userId=...   (frontend trigger check)
//   - POST /api/donations/prompt/log               (frontend records a shown prompt)
//   - POST /api/donations/prompt/:id/outcome       (frontend records dismiss/maybe-later/opt-out)
//   - POST /api/donations/checkout                 (creates Stripe Checkout session)
//   - POST /api/donations/webhook                  (Stripe webhook -> mark donations completed)
//   - POST /api/chats/:id/reaction                 (logs 'helped' / 'not_helpful' reaction)

import type { Express, Request, Response, RequestHandler } from "express";
import express from "express";
import * as data from "./data";
import * as stripeClient from "./stripe-client";
import { checkEligibility } from "./eligibility";
import { DONATION_AMOUNTS_CENTS, MIN_CUSTOM_AMOUNT_CENTS, MAX_CUSTOM_AMOUNT_CENTS } from "./stripe-client";
import { requireUser } from "../auth";
import { db } from "../storage";
import { chats } from "@shared/schema";
import { and, eq } from "drizzle-orm";

export function registerDonationRoutes(app: Express) {
  // ─── Eligibility check ─────────────────────────────────────────────────────
  app.get("/api/donations/eligibility", requireUser, (req: Request, res: Response) => {
    const result = checkEligibility(req.user!.id);
    res.json(result);
  });

  // ─── Configuration (so the frontend knows the suggested amounts) ───────────
  app.get("/api/donations/config", (_req: Request, res: Response) => {
    res.json({
      enabled: stripeClient.isConfigured(),
      suggestedAmountsCents: DONATION_AMOUNTS_CENTS,
      minAmountCents: MIN_CUSTOM_AMOUNT_CENTS,
      maxAmountCents: MAX_CUSTOM_AMOUNT_CENTS,
      currency: "usd",
    });
  });

  // ─── Log that we showed a prompt to a user ─────────────────────────────────
  app.post("/api/donations/prompt/log", requireUser, (req: Request, res: Response) => {
    const { trigger } = req.body;
    // Must match the trigger strings the client sends to showDonationModal()
    // (app.js): unrecognized values fall back to "manual_button", which silently
    // mis-attributes the analytics. Keep this list in sync with app.js.
    const allowedTriggers = [
      "reaction_helped",
      "three_positive_actions",
      "post_signup_donate_intent",
      "header_button",
      "manual_button",
      "share",
      "long_chat",
    ];
    const t = allowedTriggers.includes(trigger) ? trigger : "manual_button";
    const prompt = data.logPrompt({ userId: req.user!.id, trigger: t, outcome: "shown" });
    res.json({ ok: true, promptId: prompt.id });
  });

  // ─── Record an outcome (dismiss / maybe_later / opt_out / donated) ─────────
  app.post("/api/donations/prompt/:id/outcome", requireUser, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { outcome } = req.body;
    const allowed = ["dismissed", "maybe_later", "opt_out", "donated"];
    if (!allowed.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of ${allowed.join(", ")}` });
    }
    if (!data.getUserPrompts(req.user!.id, 100).some(prompt => prompt.id === id)) {
      return res.status(404).json({ error: "Donation prompt not found" });
    }
    data.updatePromptOutcome(id, outcome);
    res.json({ ok: true });
  });

  // ─── Create a Stripe Checkout session ──────────────────────────────────────
  app.post("/api/donations/checkout", requireUser, async (req: Request, res: Response) => {
    if (!stripeClient.isConfigured()) {
      return res.status(503).json({ error: "Donations are not configured on this server" });
    }

    const { promptId, amountCents } = req.body;
    const amt = Number(amountCents);
    if (!amt || amt < MIN_CUSTOM_AMOUNT_CENTS || amt > MAX_CUSTOM_AMOUNT_CENTS) {
      return res.status(400).json({
        error: `amountCents must be between ${MIN_CUSTOM_AMOUNT_CENTS} and ${MAX_CUSTOM_AMOUNT_CENTS}`,
      });
    }

    // Body/header origins are never trusted. The return location is a
    // deployment-controlled allowlist entry only.
    const configuredOrigin = process.env.DONATION_CHECKOUT_ORIGIN || "https://app.myshepherdapp.church";
    const baseUrl = ["https://myshepherdapp.church", "https://app.myshepherdapp.church"].includes(configuredOrigin)
      ? configuredOrigin
      : "https://app.myshepherdapp.church";
    if (promptId && !data.getUserPrompts(req.user!.id, 100).some(prompt => prompt.id === Number(promptId))) {
      return res.status(404).json({ error: "Donation prompt not found" });
    }

    try {
      const session = await stripeClient.createCheckoutSession({
        amountCents: amt,
        userId: req.user!.id,
        promptId: promptId ? Number(promptId) : undefined,
        email: req.user!.email,
        successUrl: `${baseUrl}/?donation=success&sid={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/?donation=cancel`,
      });

      // Persist the pending donation immediately so the webhook can update it.
      data.createDonation({
        userId: req.user!.id,
        email: req.user!.email,
        stripeSessionId: session.id,
        stripePaymentIntentId: "",
        amountCents: amt,
        currency: "usd",
        frequency: "one_time",
        status: "pending",
        promptId: promptId ? Number(promptId) : null,
      });

      res.json({ ok: true, url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("[donations/checkout] failed:", err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  // ─── Stripe webhook ────────────────────────────────────────────────────────
  // NOTE: this route is registered with express.raw() in server/index.ts so the
  // body signature can be verified. registerDonationRoutes does NOT apply
  // express.json() to /api/donations/webhook — see server/index.ts.
  app.post("/api/donations/webhook", (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;
    if (!sig) return res.status(400).send("Missing Stripe-Signature header");

    let event;
    try {
      event = stripeClient.verifyWebhookSignature(req.body, sig);
    } catch (err: any) {
      console.error("[donations/webhook] signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // ACK Stripe immediately — process the event asynchronously so slow DB
    // writes can never time out the webhook delivery.
    res.json({ received: true });

    setImmediate(() => {
      try {
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as any;
          const sessionId = session.id;
          const paymentIntentId = session.payment_intent || "";
          const email = session.customer_details?.email || session.customer_email || "";

          data.markDonationCompleted(sessionId, paymentIntentId, email);

          const promptId = session.metadata?.promptId;
          if (promptId) {
            const n = Number(promptId);
            if (!Number.isNaN(n)) data.updatePromptOutcome(n, "donated");
          }

          console.log(`[donations/webhook] completed donation: ${sessionId} email=${email} amount=${session.amount_total}`);
        } else {
          console.log(`[donations/webhook] received event type: ${event.type} (no-op)`);
        }
      } catch (err: any) {
        console.error("[donations/webhook] async handler failed:", err?.message || err);
      }
    });
  });

  // ─── Chat reaction (the value-moment signal) ───────────────────────────────
  app.post("/api/chats/:id/reaction", requireUser, (req: Request, res: Response) => {
    const chatId = Number(req.params.id);
    const { reaction } = req.body;
    if (!["helped", "not_helpful"].includes(reaction)) {
      return res.status(400).json({ error: "reaction must be 'helped' or 'not_helpful'" });
    }
    const ownedChat = db.select({ id: chats.id }).from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.userId, req.user!.id))).get();
    if (!ownedChat) return res.status(404).json({ error: "Chat not found" });
    const existing = data.getReactionForChat(req.user!.id, chatId);
    if (existing) {
      // Idempotent: ignore double-clicks
      return res.json({ ok: true, reactionId: existing.id, alreadyRecorded: true });
    }
    const r = data.recordReaction({
      userId: req.user!.id,
      chatId,
      reaction,
    });
    res.json({ ok: true, reactionId: r.id });
  });
}
