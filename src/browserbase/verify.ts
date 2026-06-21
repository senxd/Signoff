import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../config/env";
import type { VerificationCriterion, VerificationResult } from "../contracts";

const execFileAsync = promisify(execFile);

export type BrowserbaseVerification = {
  skipped: boolean;
  sessionId?: string;
  liveUrl?: string;
  replayUrl?: string;
  screenshotUrls: string[];
  verification: VerificationResult;
};

export async function verifyPreviewWithBrowserbase(params: {
  jobId: string;
  previewUrl?: string;
  criteria: VerificationCriterion[];
  buildPassed: boolean;
  pullRequestUrl?: string;
  expectedCommitSha?: string;
}): Promise<BrowserbaseVerification> {
  const now = new Date().toISOString();
  if (!params.previewUrl || !env.browserbaseApiKey) {
    return {
      skipped: true,
      screenshotUrls: [],
      verification: {
        verifier: "browserbase",
        verifierVersion: "signoff-2026-06-21",
        outcome: "verification_error",
        summary: !params.previewUrl
          ? "Browserbase verification could not run because previewUrl is missing."
          : "Browserbase verification could not run because BROWSERBASE_API_KEY is missing.",
        startedAt: now,
        completedAt: now,
        criteria: params.criteria.map((criterion) => ({
          criterionId: criterion.id,
          status: "missing",
          error: "Browserbase verification did not run.",
        })),
      },
    };
  }

  const { stdout } = await execFileAsync(
    "node",
    [
      "scripts/browserbase-verify.mjs",
      JSON.stringify({
        jobId: params.jobId,
        previewUrl: params.previewUrl,
        criteria: params.criteria,
        buildPassed: params.buildPassed,
        pullRequestUrl: params.pullRequestUrl,
        expectedCommitSha: params.expectedCommitSha,
      }),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024,
      timeout: 240_000,
    },
  );

  return JSON.parse(stdout) as BrowserbaseVerification;
}
