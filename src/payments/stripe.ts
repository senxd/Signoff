import Stripe from "stripe";
import type { CompletionContract } from "../contracts";
import { env } from "../config/env";
import { store } from "../state/store";

const stripe = env.stripeSecretKey ? new Stripe(env.stripeSecretKey) : undefined;

function now() {
  return new Date().toISOString();
}

async function event(jobId: string, type: string, message: string, data?: Record<string, unknown>) {
  await store.appendEvent({
    jobId,
    type,
    message,
    data,
    at: now(),
  });
}

async function save(job: CompletionContract) {
  job.updatedAt = now();
  await store.saveJob(job);
}

function checkoutSuccessUrl(job: CompletionContract) {
  return `${env.publicBaseUrl}/jobs/${job.id}/payment/sync`;
}

function checkoutCancelUrl(job: CompletionContract) {
  return `${env.publicBaseUrl}/jobs/${job.id}/proof?stripe=cancelled`;
}

function amountFor(job: CompletionContract) {
  return job.quoteAmountCents ?? env.stripeDefaultAmountCents;
}

function getPaymentIntentId(session: Stripe.Checkout.Session) {
  const intent = session.payment_intent;
  if (!intent) return undefined;
  return typeof intent === "string" ? intent : intent.id;
}

export function hasStripe() {
  return Boolean(stripe);
}

export async function createStripeCheckout(job: CompletionContract) {
  const amountCents = amountFor(job);
  job.payment = {
    provider: "stripe",
    status: stripe ? "checkout_pending" : "unconfigured",
    mode: "test",
    amountCents,
    currency: env.stripeCurrency,
    lastSyncedAt: now(),
    failureReason: stripe ? undefined : "STRIPE_SECRET_KEY is not configured.",
  };

  if (!stripe) {
    await save(job);
    await event(job.id, "payment.unconfigured", "Stripe is not configured; work cannot start.");
    return job.payment;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    client_reference_id: job.id,
    success_url: checkoutSuccessUrl(job),
    cancel_url: checkoutCancelUrl(job),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: env.stripeCurrency,
          unit_amount: amountCents,
          product_data: {
            name: "Signoff verified completion contract",
            description: job.goal.slice(0, 240),
          },
        },
      },
    ],
    metadata: {
      jobId: job.id,
      contractGoal: job.goal.slice(0, 450),
      requestedBy: job.requestedBy,
    },
    payment_intent_data: {
      capture_method: "manual",
      metadata: {
        jobId: job.id,
        contractGoal: job.goal.slice(0, 450),
        requestedBy: job.requestedBy,
      },
    },
  });

  job.payment.checkoutSessionId = session.id;
  job.payment.checkoutUrl = session.url ?? undefined;
  await save(job);
  await event(job.id, "payment.checkout_created", "Stripe Checkout authorization created.", {
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
    amountCents,
    currency: env.stripeCurrency,
  });

  return job.payment;
}

export async function syncStripePayment(jobId: string) {
  const job = await store.getJob(jobId);
  if (!job) return undefined;
  if (!stripe || !job.payment.checkoutSessionId) return job;

  const session = await stripe.checkout.sessions.retrieve(job.payment.checkoutSessionId, {
    expand: ["payment_intent"],
  });
  const intentId = getPaymentIntentId(session);
  job.payment.paymentIntentId = intentId ?? job.payment.paymentIntentId;
  job.payment.lastSyncedAt = now();

  if (session.status === "complete" && intentId) {
    const intent =
      typeof session.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(intentId)
        : session.payment_intent;
    if (!intent) {
      job.payment.status = "failed";
      job.payment.failureReason = "Stripe Checkout completed without a PaymentIntent.";
      await save(job);
      return job;
    }

    if (intent.status === "requires_capture") {
      job.payment.status = "authorized";
      job.status = "authorized";
      await save(job);
      await event(job.id, "payment.authorized", "Stripe payment authorized; work may start.", {
        checkoutSessionId: session.id,
        paymentIntentId: intentId,
        amountCapturable: intent.amount_capturable,
      });
      return job;
    }

    if (intent.status === "succeeded") {
      job.payment.status = "captured";
      job.payment.capturedAt = job.payment.capturedAt ?? now();
      await save(job);
      return job;
    }

    if (intent.status === "canceled") {
      job.payment.status = "cancelled";
      job.payment.cancelledAt = job.payment.cancelledAt ?? now();
      await save(job);
      return job;
    }
  }

  if (session.status === "expired") {
    job.payment.status = "failed";
    job.payment.failureReason = "Stripe Checkout Session expired.";
    await save(job);
  } else {
    await save(job);
  }

  return job;
}

export async function captureStripePayment(job: CompletionContract) {
  if (!stripe || !job.payment.paymentIntentId || job.payment.status !== "authorized") {
    await event(job.id, "payment.capture_skipped", "Stripe capture skipped; payment is not authorized.");
    return job;
  }

  job.payment.status = "capture_pending";
  await save(job);
  await event(job.id, "payment.capture_started", "Capturing Stripe authorization after satisfied verdict.", {
    paymentIntentId: job.payment.paymentIntentId,
  });

  const intent = await stripe.paymentIntents.capture(job.payment.paymentIntentId);
  if (intent.status === "succeeded") {
    job.payment.status = "captured";
    job.payment.capturedAt = now();
    await save(job);
    await event(job.id, "payment.captured", "Stripe payment captured after verified completion.", {
      paymentIntentId: intent.id,
      amountReceived: intent.amount_received,
    });
  } else {
    job.payment.status = "failed";
    job.payment.failureReason = `Unexpected Stripe capture status: ${intent.status}`;
    await save(job);
    await event(job.id, "payment.capture_failed", job.payment.failureReason);
  }

  return job;
}

export async function cancelStripePayment(job: CompletionContract, reason: string) {
  if (!stripe || !job.payment.paymentIntentId || job.payment.status !== "authorized") {
    await event(job.id, "payment.cancel_skipped", "Stripe cancel skipped; payment is not authorized.", {
      reason,
    });
    return job;
  }

  const intent = await stripe.paymentIntents.cancel(job.payment.paymentIntentId);
  job.payment.status = "cancelled";
  job.payment.cancelledAt = now();
  job.payment.failureReason = reason;
  await save(job);
  await event(job.id, "payment.cancelled", "Stripe authorization cancelled because verification did not pass.", {
    paymentIntentId: intent.id,
    reason,
  });
  return job;
}

export async function handleStripeWebhook(rawBody: string, signature?: string | null) {
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured.");

  const parsedEvent =
    env.stripeWebhookSecret && signature
      ? stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret)
      : (JSON.parse(rawBody) as Stripe.Event);

  if (parsedEvent.type === "checkout.session.completed") {
    const session = parsedEvent.data.object as Stripe.Checkout.Session;
    const jobId = session.client_reference_id ?? session.metadata?.jobId;
    if (jobId) {
      const job = await syncStripePayment(jobId);
      return { received: true, jobId, status: job?.payment.status };
    }
  }

  if (
    parsedEvent.type === "payment_intent.payment_failed" ||
    parsedEvent.type === "payment_intent.canceled"
  ) {
    const intent = parsedEvent.data.object as Stripe.PaymentIntent;
    const jobId = intent.metadata?.jobId;
    if (jobId) {
      const job = await store.getJob(jobId);
      if (job) {
        job.payment.status = parsedEvent.type === "payment_intent.canceled" ? "cancelled" : "failed";
        job.payment.failureReason =
          intent.last_payment_error?.message ?? `Stripe event ${parsedEvent.type}`;
        job.payment.lastSyncedAt = now();
        await save(job);
        await event(job.id, "payment.failed", job.payment.failureReason, {
          paymentIntentId: intent.id,
        });
      }
      return { received: true, jobId, status: job?.payment.status };
    }
  }

  return { received: true, ignored: parsedEvent.type };
}
