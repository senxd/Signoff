import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import {
  approveCompletionJob,
  createCompletionJob,
  getCompletionEvents,
  getCompletionJob,
  syncPaymentAndMaybeRun,
} from "./jobs/orchestrator";
import { handleStripeWebhook } from "./payments/stripe";
import {
  completeGitHubConnection,
  createGitHubConnectionStart,
  getGitHubConnection,
  getGitHubConnectionForSender,
} from "./github/app";

export const app = new Hono();

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "signoff-completion-contracts",
  }),
);

app.post("/jobs", async (c) => {
  const body = await c.req.json();
  const job = await createCompletionJob(body);
  return c.json(job, 202);
});

app.post("/jobs/:id/approve", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const job = await approveCompletionJob(c.req.param("id"), body.approvedBy ?? "asi-one");
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json(job);
});

app.get("/jobs/:id", async (c) => {
  const job = await getCompletionJob(c.req.param("id"));
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json(job);
});

app.get("/jobs/:id/events", async (c) => {
  return c.json(await getCompletionEvents(c.req.param("id")));
});

app.post("/jobs/:id/payment/sync", async (c) => {
  const job = await syncPaymentAndMaybeRun(c.req.param("id"));
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json(job);
});

app.get("/jobs/:id/payment/sync", async (c) => {
  const job = await syncPaymentAndMaybeRun(c.req.param("id"));
  if (!job) return c.html("<h1>Job not found</h1>", 404);
  return c.redirect(`/jobs/${job.id}/proof?stripe=synced`);
});

app.post("/stripe/webhook", async (c) => {
  const rawBody = await c.req.text();
  const result = await handleStripeWebhook(rawBody, c.req.header("stripe-signature"));
  if ("jobId" in result && result.status === "authorized") {
    void syncPaymentAndMaybeRun(result.jobId);
  }
  return c.json(result);
});

app.get("/github/connect/start", (c) => {
  const sender = c.req.query("sender") ?? "asi-one";
  const conversationId = c.req.query("conversationId") ?? undefined;

  try {
    const { connection, installUrl } = createGitHubConnectionStart({
      sender,
      conversationId,
    });
    return c.json({
      connectionId: connection.connectionId,
      expiresAt: connection.expiresAt,
      installUrl,
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

app.get("/github/connect/status", (c) => {
  const sender = c.req.query("sender");
  const connectionId = c.req.query("connectionId");
  const connection = connectionId
    ? getGitHubConnection(connectionId)
    : sender
      ? getGitHubConnectionForSender(sender)
      : undefined;

  if (!connection) return c.json({ error: "GitHub connection not found" }, 404);
  return c.json(connection);
});

app.get("/github/connect/callback", async (c) => {
  try {
    const connection = await completeGitHubConnection({
      state: c.req.query("state") ?? "",
      code: c.req.query("code") ?? undefined,
      installationId: c.req.query("installation_id") ?? undefined,
      setupAction: c.req.query("setup_action") ?? undefined,
    });
    return c.html(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub connected</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #151515; }
      main { max-width: 720px; margin: 0 auto; }
      code { background: #f5f5f5; border-radius: 6px; padding: 2px 5px; }
    </style>
  </head>
  <body>
    <main>
      <h1>GitHub connected</h1>
      <p>Return to ASI:One. Signoff can now inspect the selected repository before preparing a completion contract.</p>
      <p>Connection: <code>${escapeHtml(connection.connectionId)}</code></p>
      <p>Installation: <code>${escapeHtml(connection.installationId)}</code></p>
      <p>Repositories: <code>${escapeHtml(connection.repositories.map((repo) => repo.fullName).join(", "))}</code></p>
      <p>${escapeHtml(connection.validationSummary)}</p>
    </main>
  </body>
</html>`);
  } catch (error) {
    return c.html(
      `<h1>GitHub connection failed</h1><pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>`,
      400,
    );
  }
});

app.get("/jobs/:id/proof", async (c) => {
  const job = await getCompletionJob(c.req.param("id"));
  if (!job) return c.html("<h1>Job not found</h1>", 404);

  const screenshots = job.artifacts.screenshotUrls
    .map((url) => `<img src="${url}" alt="Verification screenshot" />`)
    .join("");
  const criteria = job.criteria
    .map((criterion) => {
      const evidence = job.artifacts.verification?.criteria.find(
        (item) => item.criterionId === criterion.id,
      );
      return `<tr>
        <td><code>${escapeHtml(criterion.id)}</code></td>
        <td>${escapeHtml(criterion.description)}</td>
        <td><strong>${escapeHtml(evidence?.status ?? "pending")}</strong></td>
        <td><pre>${escapeHtml(evidence ? JSON.stringify(evidence.observed ?? evidence.error ?? {}, null, 2) : "")}</pre></td>
      </tr>`;
    })
    .join("");
  const events = await getCompletionEvents(job.id);
  const eventRows = events
    .map(
      (event) =>
        `<li><code>${escapeHtml(event.at)}</code> <strong>${escapeHtml(event.type)}</strong> ${escapeHtml(event.message)}</li>`,
    )
    .join("");

  return c.html(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signoff proof ${job.id}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #151515; }
      main { max-width: 960px; margin: 0 auto; }
      section { border-top: 1px solid #ddd; padding: 20px 0; }
      code, pre { background: #f5f5f5; border-radius: 6px; padding: 2px 5px; }
      img { display: block; max-width: 100%; border: 1px solid #ddd; border-radius: 8px; margin: 12px 0; }
      table { width: 100%; border-collapse: collapse; }
      td, th { border-top: 1px solid #ddd; padding: 8px; vertical-align: top; text-align: left; }
      td:first-child { white-space: nowrap; }
      .status { text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <p class="status">${job.status}</p>
      <h1>${job.goal}</h1>
      <section>
        <h2>Contract</h2>
        <p>Contract hash: <code>${job.contractHash ?? "not approved yet"}</code></p>
        <p>Contract version: <code>${job.contractVersion}</code></p>
        <p>Approved at: <code>${job.approvedAt ?? "pending"}</code></p>
        <p>Repo: <code>${job.repoFullName}</code></p>
        <p>Base: <code>${job.baseBranch}${job.baseCommitSha ? ` @ ${job.baseCommitSha}` : ""}</code></p>
        <p>Stack: <code>${job.stack}</code></p>
        <p>Price: <code>${job.price}</code></p>
        <p>Stripe payment state: <code>${job.payment.status}</code></p>
        <p>Amount: <code>${job.payment.currency.toUpperCase()} ${(job.payment.amountCents / 100).toFixed(2)}</code></p>
        <p>Checkout: ${
          job.payment.checkoutUrl
            ? `<a href="${job.payment.checkoutUrl}">Open Stripe Checkout</a>`
            : "not configured"
        }</p>
        <p>PaymentIntent: <code>${job.payment.paymentIntentId ?? "pending"}</code></p>
        <p><a href="/jobs/${job.id}/payment/sync">Sync Stripe payment and start work</a></p>
        ${
          job.status === "draft"
            ? `<form method="post" action="/jobs/${job.id}/approve"><button type="submit">Approve and freeze contract</button></form>`
            : ""
        }
      </section>
      <section>
        <h2>Verdict</h2>
        <p>Outcome: <code>${job.verdict.outcome ?? "pending"}</code></p>
        <p>Merge eligible: <code>${job.verdict.mergeEligible}</code></p>
        <p>Payment eligible: <code>${job.verdict.paymentEligible}</code></p>
        <p>${escapeHtml(job.verdict.reason ?? "No verdict yet.")}</p>
      </section>
      <section>
        <h2>Criteria</h2>
        <table>
          <thead><tr><th>ID</th><th>Criterion</th><th>Status</th><th>Observed</th></tr></thead>
          <tbody>${criteria}</tbody>
        </table>
      </section>
      <section>
        <h2>Artifacts</h2>
        <p>PR: ${job.artifacts.pullRequestUrl ? `<a href="${job.artifacts.pullRequestUrl}">${job.artifacts.pullRequestUrl}</a>` : "pending"}</p>
        <p>Browserbase replay: ${job.artifacts.browserbaseReplayUrl ? `<a href="${job.artifacts.browserbaseReplayUrl}">${job.artifacts.browserbaseReplayUrl}</a>` : "pending"}</p>
        <p>Browserbase live: ${job.artifacts.browserbaseLiveUrl ? `<a href="${job.artifacts.browserbaseLiveUrl}">${job.artifacts.browserbaseLiveUrl}</a>` : "pending"}</p>
        ${screenshots}
      </section>
      <section>
        <h2>Summary</h2>
        <pre>${job.artifacts.summary ?? "No executor summary yet."}</pre>
      </section>
      <section>
        <h2>Timeline</h2>
        <ol>${eventRows}</ol>
      </section>
    </main>
  </body>
</html>`);
});

app.use("/artifacts/*", serveStatic({ root: "./" }));
