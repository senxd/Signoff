import { Octokit } from "@octokit/rest";
import { env } from "../config/env";
import type { CompletionContract } from "../contracts";
import { resolveGithubTokenForRepo } from "./app";

export type GithubArtifactResult = {
  skipped: boolean;
  pullRequestUrl?: string;
  summary: string;
};

export async function createGithubArtifacts(job?: CompletionContract): Promise<GithubArtifactResult> {
  if (job?.artifacts.pullRequestUrl) {
    return {
      skipped: false,
      pullRequestUrl: job.artifacts.pullRequestUrl,
      summary: `Executor returned PR ${job.artifacts.pullRequestUrl}.`,
    };
  }

  if (!env.githubToken || !env.githubOwner || !env.githubRepo) {
    return {
      skipped: true,
      summary:
        "GitHub artifact creation skipped. Configure GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
    };
  }

  const octokit = new Octokit({ auth: env.githubToken });
  const { data } = await octokit.rest.repos.get({
    owner: env.githubOwner,
    repo: env.githubRepo,
  });

  return {
    skipped: false,
    summary: `GitHub is configured for ${data.full_name}. Wire executor branch output here before opening PRs.`,
  };
}

function repoParts(job: CompletionContract) {
  const [owner, repo] = job.repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repoFullName: ${job.repoFullName}`);
  return { owner, repo };
}

async function githubVerifierToken(job: CompletionContract) {
  return resolveGithubTokenForRepo({
    repoFullName: job.repoFullName,
    sender: job.requestedBy,
    role: "verifier",
  });
}

export async function createVerificationCheck(job: CompletionContract) {
  const token = await githubVerifierToken(job);
  const headSha = job.artifacts.implementationSha;
  if (!token || !headSha) {
    return {
      skipped: true,
      summary: "GitHub verification check skipped; verifier token or implementation SHA is missing.",
    };
  }

  const { owner, repo } = repoParts(job);
  const octokit = new Octokit({ auth: token });
  const outcome = job.verdict.outcome ?? "verification_error";
  const conclusion =
    outcome === "satisfied" ? "success" : outcome === "not_satisfied" ? "failure" : "neutral";
  const criteria = job.artifacts.verification?.criteria ?? [];
  const summary = [
    `Verdict: ${outcome}`,
    `Merge eligible: ${job.verdict.mergeEligible}`,
    `Payment eligible: ${job.verdict.paymentEligible}`,
    `Payment state: ${job.payment.status}`,
    job.verdict.reason ? `Reason: ${job.verdict.reason}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  const text = criteria
    .map((criterion) => {
      const observed = criterion.observed
        ? ` observed=${JSON.stringify(criterion.observed)}`
        : criterion.error
          ? ` error=${criterion.error}`
          : "";
      return `- ${criterion.criterionId}: ${criterion.status}${observed}`;
    })
    .join("\n");

  await octokit.rest.checks.create({
    owner,
    repo,
    name: "Signoff / verified completion",
    head_sha: headSha,
    status: "completed",
    conclusion,
    details_url: job.artifacts.proofPageUrl,
    external_id: job.id,
    output: {
      title: `Signoff verdict: ${outcome}`,
      summary,
      text: text.slice(0, 65_000),
    },
  });

  return {
    skipped: false,
    summary: `GitHub verification check posted for ${headSha}.`,
  };
}
