import { nanoid } from "nanoid";
import {
  approveContract,
  completionContractInputSchema,
  createInitialContract,
  deriveDeterministicVerdict,
  type CompletionContract,
  type CompletionContractInput,
} from "../contracts";
import { verifyPreviewWithBrowserbase } from "../browserbase/verify";
import { runExistingCodingExecutor } from "../executor/executor";
import { createGithubArtifacts, createVerificationCheck } from "../github/pr";
import { checkSentryGate } from "../sentry/gate";
import { env } from "../config/env";
import { store } from "../state/store";
import {
  cancelStripePayment,
  captureStripePayment,
  createStripeCheckout,
  syncStripePayment,
} from "../payments/stripe";

async function event(jobId: string, type: string, message: string, data?: Record<string, unknown>) {
  await store.appendEvent({
    jobId,
    type,
    message,
    data,
    at: new Date().toISOString(),
  });
}

async function save(job: CompletionContract, status: CompletionContract["status"]) {
  job.status = status;
  job.updatedAt = new Date().toISOString();
  await store.saveJob(job);
}

export async function createCompletionJob(input: unknown) {
  const parsed: CompletionContractInput = completionContractInputSchema.parse(input);
  const job = createInitialContract(nanoid(10), parsed);
  job.artifacts.proofPageUrl = `${env.publicBaseUrl}/jobs/${job.id}/proof`;

  await store.saveJob(job);
  await event(job.id, "contract.draft_created", "Completion contract draft created; waiting for approval.", {
    goal: job.goal,
    price: job.price,
    criteria: job.criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
    })),
  });

  return job;
}

export async function approveCompletionJob(jobId: string, approvedBy = "asi-one") {
  const job = await store.getJob(jobId);
  if (!job) return undefined;
  if (job.status !== "draft") {
    await event(job.id, "contract.approval_reused", "Completion contract was already approved.", {
      status: job.status,
      contractHash: job.contractHash,
    });
    return job;
  }
  approveContract(job, approvedBy);
  await store.saveJob(job);
  await event(job.id, "contract.approved", "Completion contract approved and frozen.", {
    contractHash: job.contractHash,
    approvedBy,
  });

  await createStripeCheckout(job);
  startPaymentPolling(job.id);
  return job;
}

export async function getCompletionJob(id: string) {
  return store.getJob(id);
}

export async function getCompletionEvents(id: string) {
  return store.getEvents(id);
}

export async function syncPaymentAndMaybeRun(jobId: string) {
  const job = await syncStripePayment(jobId);
  if (job?.status === "authorized" && job.payment.status === "authorized") {
    void runJob(job.id);
  }
  return job;
}

const activeJobs = new Set<string>();
const paymentPollers = new Set<string>();

export function startPaymentPolling(jobId: string) {
  if (paymentPollers.has(jobId)) return;
  paymentPollers.add(jobId);
  void pollPaymentUntilAuthorized(jobId);
}

async function pollPaymentUntilAuthorized(jobId: string) {
  const deadline = Date.now() + 30 * 60 * 1000;
  try {
    while (Date.now() < deadline) {
      const job = await store.getJob(jobId);
      if (!job) return;
      if (["authorized", "building", "verifying", "completed", "failed"].includes(job.status)) {
        if (job.status === "authorized" && job.payment.status === "authorized") {
          void runJob(jobId);
        }
        return;
      }
      if (["cancelled", "failed", "captured"].includes(job.payment.status)) return;

      await syncStripePayment(jobId);
      const updated = await store.getJob(jobId);
      if (updated?.status === "authorized" && updated.payment.status === "authorized") {
        void runJob(jobId);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } finally {
    paymentPollers.delete(jobId);
  }
}

export async function runJob(jobId: string) {
  if (activeJobs.has(jobId)) return;
  const job = await store.getJob(jobId);
  if (!job) return;
  if (["building", "verifying", "completed", "failed"].includes(job.status)) return;
  if (job.status !== "authorized" || job.payment.status !== "authorized") {
    await event(jobId, "job.waiting_for_payment", "Executor is waiting for Stripe authorization.", {
      jobStatus: job.status,
      paymentStatus: job.payment.status,
    });
    return;
  }

  activeJobs.add(jobId);
  try {
    while (true) {
      await save(job, "building");
      await event(
        job.id,
        "build.started",
        `Delegating to coding executor. Attempt ${job.repairAttempts + 1}.`,
        {
          repairAttempts: job.repairAttempts,
          maxRepairAttempts: job.maxRepairAttempts,
        },
      );

      job.artifacts.screenshotUrls = [];
      job.artifacts.sentryIssueUrls = [];
      job.artifacts.verification = undefined;
      job.artifacts.verifiedCommitSha = undefined;

      const executorResult = await runExistingCodingExecutor(job);
      job.acceptance.buildPasses = executorResult.buildPassed;
      job.previewUrl = executorResult.previewUrl ?? job.previewUrl;
      job.artifacts.summary = executorResult.summary;
      job.artifacts.implementationSha = executorResult.commitSha;
      job.artifacts.branchName = executorResult.branchName;
      job.artifacts.pullRequestUrl = executorResult.pullRequestUrl;
      await store.saveJob(job);

      await event(job.id, "build.finished", executorResult.summary, {
        previewUrl: job.previewUrl,
        buildPassed: executorResult.buildPassed,
        attempt: job.repairAttempts + 1,
      });

      const github = await createGithubArtifacts(job);
      job.artifacts.pullRequestUrl = github.pullRequestUrl ?? job.artifacts.pullRequestUrl;
      await store.saveJob(job);
      await event(
        job.id,
        github.skipped ? "github.skipped" : "github.ready",
        github.summary,
      );

      await save(job, "verifying");
      await event(job.id, "browserbase.started", "Starting Browserbase criteria proof run.", {
        attempt: job.repairAttempts + 1,
      });
      const browserbase = await verifyPreviewWithBrowserbase({
        jobId: job.id,
        previewUrl: job.previewUrl,
        criteria: job.criteria,
        buildPassed: job.acceptance.buildPasses,
        pullRequestUrl: job.artifacts.pullRequestUrl,
        expectedCommitSha: job.artifacts.implementationSha,
      });

      job.artifacts.browserbaseSessionId = browserbase.sessionId;
      job.artifacts.browserbaseLiveUrl = browserbase.liveUrl;
      job.artifacts.browserbaseReplayUrl = browserbase.replayUrl;
      job.artifacts.screenshotUrls.push(...browserbase.screenshotUrls);
      job.artifacts.verification = browserbase.verification;
      job.artifacts.verifiedCommitSha = browserbase.verification.verifiedCommitSha;
      await store.saveJob(job);

      await event(
        job.id,
        browserbase.skipped ? "browserbase.skipped" : "browserbase.finished",
        browserbase.skipped
          ? "Browserbase skipped because credentials or previewUrl are missing."
          : "Browserbase visual proof generated.",
      );

      const sentry = await checkSentryGate();
      job.acceptance.noNewCriticalSentryIssues = sentry.passed;
      job.artifacts.sentryIssueUrls = sentry.issueUrls;
      await event(job.id, sentry.passed ? "sentry.passed" : "sentry.failed", sentry.summary);

      if (!job.artifacts.verification) {
        job.artifacts.verification = {
          verifier: "local",
          verifierVersion: "signoff-2026-06-21",
          outcome: "verification_error",
          summary: "Verifier did not return evidence.",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          criteria: [],
        };
      }

      const verdict = deriveDeterministicVerdict(job);
      job.verdict = verdict;
      job.artifacts.verification.outcome = verdict.outcome;
      await store.saveJob(job);

      if (
        verdict.outcome === "not_satisfied" &&
        job.repairAttempts < job.maxRepairAttempts
      ) {
        job.repairAttempts += 1;
        await store.saveJob(job);
        await event(
          job.id,
          "repair.started",
          `Attempt ${job.repairAttempts} was not_satisfied; retrying under the same frozen contract.`,
          {
            verdict,
            repairAttempts: job.repairAttempts,
            maxRepairAttempts: job.maxRepairAttempts,
            contractHash: job.contractHash,
          },
        );
        continue;
      }

      break;
    }

    const releaseSatisfied =
      job.verdict.outcome === "satisfied" && job.acceptance.noNewCriticalSentryIssues;
    if (releaseSatisfied) {
      await captureStripePayment(job);
    } else {
      await cancelStripePayment(
        job,
        job.acceptance.noNewCriticalSentryIssues
          ? (job.verdict.reason ?? "Verification did not satisfy the frozen contract.")
          : "Sentry runtime gate failed.",
      );
    }

    const paymentReleased = String(job.payment.status) === "captured";
    const completed = releaseSatisfied && paymentReleased;
    if (!completed && releaseSatisfied) {
      job.verdict = {
        ...job.verdict,
        paymentEligible: false,
        reason: `Verification passed, but payment release did not complete: ${job.payment.status}.`,
      };
    }

    const githubCheck = await createVerificationCheck(job);
    await event(
      job.id,
      githubCheck.skipped ? "github.check_skipped" : "github.check_posted",
      githubCheck.summary,
    );

    await save(job, completed ? "completed" : "failed");
    await event(
      job.id,
      completed ? "contract.release_eligible" : `contract.${job.verdict.outcome ?? "verification_error"}`,
      completed
        ? "Completion criteria passed. Stripe payment captured."
        : `Completion blocked: ${job.verdict.reason ?? "Verification did not satisfy the frozen contract."}`,
      {
        verdict: job.verdict,
        sentryPassed: job.acceptance.noNewCriticalSentryIssues,
        paymentStatus: job.payment.status,
      },
    );
  } catch (error) {
    job.error = error instanceof Error ? error.message : String(error);
    await cancelStripePayment(job, job.error);
    await save(job, "failed");
    await event(job.id, "job.failed", job.error);
  } finally {
    activeJobs.delete(jobId);
  }
}
