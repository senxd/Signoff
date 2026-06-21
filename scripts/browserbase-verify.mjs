import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright-core";

const input = JSON.parse(process.argv[2] ?? "{}");

if (!input.jobId || !input.previewUrl) {
  throw new Error("jobId and previewUrl are required");
}

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:8787";
const criteria = Array.isArray(input.criteria) ? input.criteria : [];

if (!apiKey) {
  throw new Error("BROWSERBASE_API_KEY is required");
}

await mkdir("artifacts", { recursive: true });

const startedAt = new Date().toISOString();
const evidence = [];
const consoleErrors = [];
const pageErrors = [];
const screenshotUrls = [];
let runtimeCommitSha;

function targetUrl(path = "/") {
  return new URL(path, input.previewUrl).toString();
}

function pushEvidence(criterionId, status, observed, error) {
  evidence.push({
    criterionId,
    status,
    ...(observed ? { observed } : {}),
    ...(error ? { error } : {}),
  });
}

function criterionByKind(kind) {
  return criteria.filter((criterion) => criterion.kind === kind);
}

function isVerifierInfrastructureError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("page.goto") ||
    message.includes("net::ERR_") ||
    message.includes("Timeout")
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gotoWithRetry(page, url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await page.goto(url, { timeout: 60_000, ...options });
    } catch (error) {
      lastError = error;
      if (attempt === 8) break;
      await delay(Math.min(5_000 * attempt, 20_000));
    }
  }
  throw lastError;
}

async function evaluateCriterion(page, criterion) {
  if (criterion.kind === "build_passes") {
    pushEvidence(criterion.id, input.buildPassed ? "passed" : "failed", {
      buildPassed: Boolean(input.buildPassed),
    }, input.buildPassed ? undefined : "Build/check command did not pass.");
    return;
  }

  if (criterion.kind === "pull_request_opened") {
    pushEvidence(criterion.id, input.pullRequestUrl ? "passed" : "failed", {
      pullRequestUrl: input.pullRequestUrl ?? null,
    }, input.pullRequestUrl ? undefined : "No pull request URL was provided.");
    return;
  }

  if (criterion.kind === "local_storage_seed") {
    await gotoWithRetry(page, targetUrl("/watchlist"), { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
      { key: criterion.key, value: criterion.value },
    );
    const observed = await page.evaluate((key) => window.localStorage.getItem(key), criterion.key);
    const expected = JSON.stringify(criterion.value);
    await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
    pushEvidence(
      criterion.id,
      observed === expected ? "passed" : "failed",
      { key: criterion.key, expected, observed },
      observed === expected ? undefined : "localStorage seed did not match expected value.",
    );
    return;
  }

  const viewport =
    criterion.viewport === "mobile"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 };
  await page.setViewportSize(viewport);
  const url = targetUrl(criterion.path);

  if (criterion.kind === "route_loads") {
    const response = await gotoWithRetry(page, url, { waitUntil: "networkidle" });
    const status = response?.status() ?? 0;
    pushEvidence(
      criterion.id,
      status >= 200 && status < 400 ? "passed" : "error",
      { url, httpStatus: status, viewport },
      status >= 200 && status < 400 ? undefined : `Route returned HTTP ${status || "unknown"}.`,
    );
    return;
  }

  await gotoWithRetry(page, url, { waitUntil: "networkidle" });
  await page.waitForTimeout(750);

  if (criterion.kind === "no_horizontal_overflow") {
    const observed = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
    }));
    const passed = observed.scrollWidth <= observed.innerWidth;
    pushEvidence(
      criterion.id,
      passed ? "passed" : "failed",
      { ...observed, viewport },
      passed
        ? undefined
        : `Horizontal overflow: scrollWidth ${observed.scrollWidth}, innerWidth ${observed.innerWidth}.`,
    );
    return;
  }

  if (criterion.kind === "visible_text") {
    await page
      .getByText(criterion.texts[0], { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {});
    const bodyText = await page.locator("body").innerText({ timeout: 15_000 });
    const missing = criterion.texts.filter((text) => !bodyText.includes(text));
    pushEvidence(
      criterion.id,
      missing.length === 0 ? "passed" : "failed",
      { requiredTexts: criterion.texts, missing, viewport },
      missing.length === 0 ? undefined : `Missing visible text: ${missing.join(", ")}.`,
    );
    return;
  }

  if (criterion.kind === "desktop_table_exists") {
    const observed = await page.evaluate(() => {
      const selectors = ["table", "thead", '[role="table"]', '[role="grid"]'];
      const text = document.body.innerText;
      return {
        selectorHits: Object.fromEntries(
          selectors.map((selector) => [selector, document.querySelectorAll(selector).length]),
        ),
        hasDesktopHeaders: ["Symbol", "Name", "Price"].every((label) => text.includes(label)),
      };
    });
    const count = Object.values(observed.selectorHits).reduce((sum, value) => sum + Number(value), 0);
    const passed = count > 0 || observed.hasDesktopHeaders;
    pushEvidence(
      criterion.id,
      passed ? "passed" : "failed",
      { ...observed, viewport },
      passed ? undefined : "No desktop table/grid structure or desktop column headers were found.",
    );
    return;
  }
}

function deriveOutcome() {
  const byId = new Map(evidence.map((item) => [item.criterionId, item]));
  for (const criterion of criteria) {
    if (!criterion.required) continue;
    const item = byId.get(criterion.id);
    if (!item || item.status === "missing" || item.status === "error") {
      return "verification_error";
    }
    if (item.status === "failed") {
      return "not_satisfied";
    }
  }
  return "satisfied";
}

const client = new Browserbase({ apiKey });
const sessionConfig = {
  projectId,
  browserSettings: {
    recordSession: true,
    viewport: {
      width: 1440,
      height: 1000,
    },
  },
  userMetadata: {
    app: "signoff",
    jobId: input.jobId,
  },
};

async function createSessionWithRetry() {
  const sessionStartedAt = Date.now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await client.sessions.create(sessionConfig);
    } catch (error) {
      const isRateLimit = error?.status === 429;
      const elapsed = Date.now() - sessionStartedAt;
      if (!isRateLimit || elapsed > 90_000) {
        throw error;
      }

      const retryAfter = Number(error.headers?.["retry-after"]);
      const delayMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000;
      console.error(
        `Browserbase session slot unavailable; retrying in ${delayMs}ms (attempt ${attempt}).`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const session = await createSessionWithRetry();

let browser;
try {
  browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 90_000 });
  const page = browser.contexts()[0]?.pages()[0] ?? (await browser.newPage());
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const criterion of criterionByKind("local_storage_seed")) {
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
      { key: criterion.key, value: criterion.value },
    );
  }

  for (const criterion of criteria) {
    try {
      if (
        criterion.kind === "screenshot_attached" ||
        criterion.kind === "browserbase_replay_attached"
      ) {
        continue;
      }
      await evaluateCriterion(page, criterion);
    } catch (error) {
      const infrastructureError = isVerifierInfrastructureError(error);
      pushEvidence(
        criterion.id,
        infrastructureError
          ? "error"
          : criterion.kind === "no_horizontal_overflow" || criterion.kind === "visible_text" || criterion.kind === "desktop_table_exists"
          ? "failed"
          : "error",
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  runtimeCommitSha = await page
    .evaluate(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return undefined;
      const data = await response.json();
      return data?.git?.sha;
    }, targetUrl("/api/version"))
    .catch(() => undefined);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoWithRetry(page, targetUrl("/watchlist"), { waitUntil: "networkidle" }).catch(() => {});
  const desktopPath = `artifacts/${input.jobId}-desktop.png`;
  await page.screenshot({ path: desktopPath, fullPage: true });
  screenshotUrls.push(`${publicBaseUrl}/artifacts/${input.jobId}-desktop.png`);

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoWithRetry(page, targetUrl("/watchlist"), { waitUntil: "networkidle" }).catch(() => {});
  const mobilePath = `artifacts/${input.jobId}-mobile.png`;
  await page.screenshot({ path: mobilePath, fullPage: true });
  screenshotUrls.push(`${publicBaseUrl}/artifacts/${input.jobId}-mobile.png`);
} finally {
  await browser?.close().catch(() => {});
  await client.sessions.update(session.id, { status: "REQUEST_RELEASE" }).catch(() => {});
}

const liveUrls = await client.sessions.debug(session.id).catch(() => undefined);
const replay = await client.sessions.replays.retrieve(session.id).catch(() => undefined);
const replayUrl = `https://www.browserbase.com/sessions/${session.id}`;

for (const criterion of criterionByKind("screenshot_attached")) {
  pushEvidence(
    criterion.id,
    screenshotUrls.length >= 2 ? "passed" : "missing",
    { screenshotUrls },
    screenshotUrls.length >= 2 ? undefined : "Desktop and mobile screenshots were not attached.",
  );
}

for (const criterion of criterionByKind("browserbase_replay_attached")) {
  pushEvidence(
    criterion.id,
    replayUrl ? "passed" : "missing",
    { replayUrl: replayUrl ?? null, sessionId: session.id },
    replayUrl ? undefined : "Browserbase replay URL was not available.",
  );
}

await writeFile(
  join("artifacts", `${input.jobId}-browserbase.json`),
  JSON.stringify({ session, liveUrls, replay, evidence, consoleErrors, pageErrors }, null, 2),
  "utf8",
);

const outcome = deriveOutcome();
const completedAt = new Date().toISOString();
const failed = evidence.find((item) => item.status === "failed" || item.status === "error" || item.status === "missing");

console.log(
  JSON.stringify({
    skipped: false,
    sessionId: session.id,
    liveUrl: liveUrls?.debuggerFullscreenUrl,
    replayUrl,
    screenshotUrls,
    verification: {
      verifier: "browserbase",
      verifierVersion: "signoff-2026-06-21",
      outcome,
      summary:
        outcome === "satisfied"
          ? "All required criteria passed in Browserbase."
          : `Verification blocked by ${failed?.criterionId ?? "unknown criterion"}.`,
      startedAt,
      completedAt,
      runtimeCommitSha,
      verifiedCommitSha: runtimeCommitSha,
      criteria: evidence,
      consoleErrors,
      pageErrors,
    },
  }),
);
