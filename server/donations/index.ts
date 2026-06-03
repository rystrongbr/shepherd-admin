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

export function registerDonationRoutes(app: Express) {
  // ─── Eligibility check ─────────────────────────────────────────────────────
  app.get("/api/donations/eligibility", (req: Request, res: Response) => {
    const userId = Number(req.query.userId);
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = checkEligibility(userId);
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
  app.post("/api/donations/prompt/log", (req: Request, res: Response) => {
    const { userId, trigger } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const allowedTriggers = ["reaction_helped", "manual_button", "share", "long_chat"];
    const t = allowedTriggers.includes(trigger) ? trigger : "manual_button";
    const prompt = data.logPrompt({ userId, trigger: t, outcome: "shown" });
    res.json({ ok: true, promptId: prompt.id });
  });

  // ─── Record an outcome (dismiss / maybe_later / opt_out / donated) ─────────
  app.post("/api/donations/prompt/:id/outcome", (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { outcome } = req.body;
    const allowed = ["dismissed", "maybe_later", "opt_out", "donated"];
    if (!allowed.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of ${allowed.join(", ")}` });
    }
    data.updatePromptOutcome(id, outcome);
    res.json({ ok: true });
  });

  // ─── Create a Stripe Checkout session ──────────────────────────────────────
  app.post("/api/donations/checkout", async (req: Request, res: Response) => {
    if (!stripeClient.isConfigured()) {
      return res.status(503).json({ error: "Donations are not configured on this server" });
    }

    const { userId, promptId, amountCents, email, origin } = req.body;
    const amt = Number(amountCents);
    if (!amt || amt < MIN_CUSTOM_AMOUNT_CENTS || amt > MAX_CUSTOM_AMOUNT_CENTS) {
      return res.status(400).json({
        error: `amountCents must be between ${MIN_CUSTOM_AMOUNT_CENTS} and ${MAX_CUSTOM_AMOUNT_CENTS}`,
      });
    }

    // Build success/cancel URLs from the request origin so this works on demo,
    // staging, and production without a hardcoded domain.
    const baseUrl = origin
      || (req.headers.origin as string)
      || (req.headers.referer ? new URL(req.headers.referer as string).origin : "")
      || process.env.APP_URL
      || "https://app.myshepherdapp.church";

    try {
      const session = await stripeClient.createCheckoutSession({
        amountCents: amt,
        userId: userId ? Number(userId) : undefined,
        promptId: promptId ? Number(promptId) : undefined,
        email,
        successUrl: `${baseUrl}/?donation=success&sid={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/?donation=cancel`,
      });

      // Persist the pending donation immediately so the webhook can update it.
      data.createDonation({
        userId: userId ? Number(userId) : null,
        email: email || "",
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
  app.post("/api/chats/:id/reaction", (req: Request, res: Response) => {
    const chatId = Number(req.params.id);
    const { userId, reaction } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!["helped", "not_helpful"].includes(reaction)) {
      return res.status(400).json({ error: "reaction must be 'helped' or 'not_helpful'" });
    }
    const existing = data.getReactionForChat(Number(userId), chatId);
    if (existing) {
      // Idempotent: ignore double-clicks
      return res.json({ ok: true, reactionId: existing.id, alreadyRecorded: true });
    }
    const r = data.recordReaction({
      userId: Number(userId),
      chatId,
      reaction,
    });
    res.json({ ok: true, reactionId: r.id });
  });
}
