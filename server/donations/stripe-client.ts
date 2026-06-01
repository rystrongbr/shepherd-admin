// Stripe client for the donations module.
// v1 supports one-time donations via Stripe Checkout in redirect mode.
// Apple Pay / Google Pay / Link are enabled automatically on supported devices.

import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

// Default cents amounts shown to users. Custom amounts allowed.
export const DONATION_AMOUNTS_CENTS = [300, 500, 1000] as const;
export const MIN_CUSTOM_AMOUNT_CENTS = 100; // $1.00 floor
export const MAX_CUSTOM_AMOUNT_CENTS = 50000; // $500 ceiling for v1 (safety)

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY env var is not set");
  }
  if (!_stripe) {
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      // Pin to a recent stable API version.
      apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
      typescript: true,
    });
  }
  return _stripe;
}

export function isConfigured(): boolean {
  return !!STRIPE_SECRET_KEY;
}

export function getWebhookSecret(): string {
  return STRIPE_WEBHOOK_SECRET;
}

export interface CreateCheckoutOptions {
  amountCents: number;
  userId?: number;
  promptId?: number;
  email?: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(opts: CreateCheckoutOptions): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();

  if (opts.amountCents < MIN_CUSTOM_AMOUNT_CENTS) {
    throw new Error(`Minimum donation is $${MIN_CUSTOM_AMOUNT_CENTS / 100}`);
  }
  if (opts.amountCents > MAX_CUSTOM_AMOUNT_CENTS) {
    throw new Error(`Maximum single donation is $${MAX_CUSTOM_AMOUNT_CENTS / 100}`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    // Stripe Checkout auto-enables Apple Pay, Google Pay, Link, and cards
    // when payment_method_types is omitted. Letting Stripe pick maximizes
    // wallet support without any per-method code.
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "My Shepherd — Donation",
            description: "Your gift keeps My Shepherd free for everyone.",
          },
          unit_amount: opts.amountCents,
        },
        quantity: 1,
      },
    ],
    // Statement descriptor (what shows on the donor's card statement).
    payment_intent_data: {
      statement_descriptor_suffix: "MY SHEPHERD",
      metadata: {
        userId: opts.userId?.toString() || "",
        promptId: opts.promptId?.toString() || "",
        type: "donation",
      },
    },
    metadata: {
      userId: opts.userId?.toString() || "",
      promptId: opts.promptId?.toString() || "",
      type: "donation",
    },
    customer_email: opts.email,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    // Branded receipt is enabled in the Stripe Dashboard, not here.
    allow_promotion_codes: false,
    billing_address_collection: "auto",
  });

  return session;
}

export function verifyWebhookSignature(payload: Buffer | string, signature: string): Stripe.Event {
  const stripe = getStripe();
  const secret = getWebhookSecret();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET env var is not set");
  return stripe.webhooks.constructEvent(payload, signature, secret);
}
