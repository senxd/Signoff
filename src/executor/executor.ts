import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";
import type { CompletionContract } from "../contracts";
import { env } from "../config/env";
import { resolveGithubTokenForRepo } from "../github/app";

export type ExecutorResult = {
  buildPassed: boolean;
  previewUrl?: string;
  commitSha?: string;
  branchName?: string;
  pullRequestUrl?: string;
  summary: string;
};

const execFileAsync = promisify(execFile);
const DEMO_REPO = "senxd/signoff-demo-app";

export async function runExistingCodingExecutor(
  contract: CompletionContract,
): Promise<ExecutorResult> {
  const webhook = process.env.EXECUTOR_WEBHOOK_URL;

  if (!webhook) {
    if (
      contract.repoFullName === DEMO_REPO &&
      (contract.demoFixture === "watchlist_mobile" ||
        contract.demoFixture === "watchlist_mobile_failure" ||
        contract.demoFixture === "watchlist_mobile_repair")
    ) {
      return runPreparedWatchlistExecutor(contract);
    }

    throw new Error("Executor webhook is not configured and no prepared executor matches this contract.");
  }

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(contract),
  });

  if (!response.ok) {
    throw new Error(`Executor failed with HTTP ${response.status}`);
  }

  return (await response.json()) as ExecutorResult;
}

export function shouldApplyWatchlistFakeMobilePatch(contract: CompletionContract) {
  if (contract.demoFixture === "watchlist_mobile_failure") return true;
  if (contract.demoFixture === "watchlist_mobile_repair" && contract.repairAttempts === 0) {
    return true;
  }
  if (
    contract.demoFixture === "watchlist_mobile" &&
    contract.maxRepairAttempts > 0 &&
    contract.repairAttempts === 0
  ) {
    return true;
  }
  return false;
}

async function runPreparedWatchlistExecutor(contract: CompletionContract): Promise<ExecutorResult> {
  const jobsRoot = env.signoffJobsDir ?? (existsSync("/opt/signoff") ? "/opt/signoff/jobs" : "/private/tmp/signoff-jobs");
  await mkdir(jobsRoot, { recursive: true });
  const jobDir = join(jobsRoot, `${contract.id}-attempt-${contract.repairAttempts}`);
  await rm(jobDir, { recursive: true, force: true });

  const branchName = `signoff/${slugFor(contract.goal)}-${contract.id.toLowerCase()}`;
  await cloneContractRepo(contract, jobDir);
  await run("git", [
    "-C",
    jobDir,
    "-c",
    `safe.directory=${jobDir}`,
    "checkout",
    "-B",
    branchName,
    contract.baseCommitSha ?? `origin/${contract.baseBranch}`,
  ]);

  if (shouldApplyWatchlistFakeMobilePatch(contract)) {
    await applyWatchlistFakeMobilePatch(jobDir);
  } else {
    await applyWatchlistMobilePatch(jobDir);
  }

  await run("bun", ["install"], { cwd: jobDir, timeoutMs: 180_000 });
  const previewEnv = await loadPreviewEnv(jobDir);
  const build = await runAllowingFailure("bun", ["run", "build"], {
    cwd: jobDir,
    timeoutMs: 900_000,
    env: {
      ...previewEnv,
      NODE_OPTIONS: "--max-old-space-size=3072",
    },
  });
  const buildPassed = build.exitCode === 0;

  await run("git", [
    "-C",
    jobDir,
    "-c",
    `safe.directory=${jobDir}`,
    "add",
    "src/components/watchlist/watchlist-shell.tsx",
    "src/app/globals.css",
  ]);
  await run("git", ["-C", jobDir, "-c", `safe.directory=${jobDir}`, "config", "user.name", "Signoff"]);
  await run("git", [
    "-C",
    jobDir,
    "-c",
    `safe.directory=${jobDir}`,
    "config",
    "user.email",
    "signoff@example.com",
  ]);
  await run("git", [
    "-C",
    jobDir,
    "-c",
    `safe.directory=${jobDir}`,
    "commit",
    "-m",
    `Implement Signoff contract ${contract.id}`,
  ]);
  const commitSha = (await run("git", ["-C", jobDir, "-c", `safe.directory=${jobDir}`, "rev-parse", "HEAD"])).stdout.trim();

  const gitToken = await githubWriteToken(contract);
  if (!gitToken) {
    throw new Error("No GitHub write token available for pushing the delegated branch.");
  }

  const [owner, repo] = contract.repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repoFullName: ${contract.repoFullName}`);
  }

  await run("git", [
    "-C",
    jobDir,
    "-c",
    `safe.directory=${jobDir}`,
    "push",
    `https://x-access-token:${gitToken}@github.com/${owner}/${repo}.git`,
    `${branchName}:${branchName}`,
    "--force",
  ]);

  const pullRequestUrl = await openOrUpdatePullRequest({
    token: gitToken,
    owner,
    repo,
    branchName,
    contract,
    commitSha,
  });

  const previewUrl = await startPreview(jobDir, contract.id, commitSha, branchName);

  return {
    buildPassed,
    previewUrl,
    commitSha,
    branchName,
    pullRequestUrl,
    summary: [
      `Prepared Watchlist mobile executor ran in ${jobDir}.`,
      `Branch: ${branchName}`,
      `Commit: ${commitSha}`,
      `Build: ${buildPassed ? "passed" : "failed"}`,
      buildPassed ? "" : `${build.stdout}\n${build.stderr}`.slice(-2400),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function applyWatchlistMobilePatch(repoDir: string) {
  const shellFile = join(repoDir, "src/components/watchlist/watchlist-shell.tsx");
  const cssFile = join(repoDir, "src/app/globals.css");
  let source = await readFile(shellFile, "utf8");
  if (source.includes("function WatchlistMobileCards(")) return;

  const helper = `
type WatchlistRow = {
  symbol: string;
  name: string;
  price: string;
  change: string;
  volume: string;
};

function WatchlistMobileCards({ rows }: { rows: WatchlistRow[] }) {
  return (
    <div className="watchlist-mobile-cards">
      {rows.map((row) => (
        <article key={row.symbol} className="watchlist-mobile-card">
          <div className="watchlist-mobile-card-header">
            <div>
              <h2>{row.symbol}</h2>
              <p>{row.name}</p>
            </div>
            <div className="watchlist-mobile-card-prices">
              <p>{row.price}</p>
              <p className={row.change.startsWith("-") ? "negative" : "positive"}>{row.change}</p>
            </div>
          </div>
          <p className="watchlist-mobile-volume">Volume {row.volume}</p>
        </article>
      ))}
    </div>
  );
}
`;

  source = source.replace("export function WatchlistShell()", `${helper}\nexport function WatchlistShell()`);
  source = source.replace(
    `      <div className="watchlist-table-frame">
        <table className="watchlist-table">`,
    `      <WatchlistMobileCards rows={rows} />

      <div className="watchlist-table-frame watchlist-desktop-table">
        <table className="watchlist-table">`,
  );

  if (!source.includes("function WatchlistMobileCards(") || !source.includes("watchlist-desktop-table")) {
    throw new Error("Watchlist mobile patch failed for signoff-demo-app.");
  }
  await writeFile(shellFile, source, "utf8");

  let css = await readFile(cssFile, "utf8");
  if (css.includes(".watchlist-mobile-cards")) return;

  css += `

.watchlist-mobile-cards {
  display: none;
  gap: 12px;
}

.watchlist-mobile-card {
  background: white;
  border: 1px solid #d8dee9;
  border-radius: 12px;
  padding: 16px;
}

.watchlist-mobile-card-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.watchlist-mobile-card h2 {
  font-size: 18px;
  margin: 0 0 4px;
}

.watchlist-mobile-card p {
  margin: 0;
}

.watchlist-mobile-card-prices {
  text-align: right;
}

.watchlist-mobile-volume {
  color: #536075;
  font-size: 13px;
  margin-top: 12px;
}

@media (max-width: 767px) {
  .watchlist-mobile-cards {
    display: grid;
  }

  .watchlist-desktop-table {
    display: none;
  }
}
`;
  await writeFile(cssFile, css, "utf8");
}

async function applyWatchlistFakeMobilePatch(repoDir: string) {
  const shellFile = join(repoDir, "src/components/watchlist/watchlist-shell.tsx");
  const cssFile = join(repoDir, "src/app/globals.css");
  let source = await readFile(shellFile, "utf8");
  if (source.includes("SIGNOFF_FAKE_MOBILE_OPTIMIZED")) return;

  source = source.replace(
    `<section className="watchlist-shell">`,
    `<section className="watchlist-shell SIGNOFF_FAKE_MOBILE_OPTIMIZED">
      <div className="watchlist-fake-mobile-banner">Mobile optimized</div>`,
  );

  if (!source.includes("SIGNOFF_FAKE_MOBILE_OPTIMIZED")) {
    throw new Error("Watchlist fake mobile patch failed for signoff-demo-app.");
  }
  await writeFile(shellFile, source, "utf8");

  let css = await readFile(cssFile, "utf8");
  if (css.includes(".SIGNOFF_FAKE_MOBILE_OPTIMIZED")) return;

  css += `

.watchlist-shell.SIGNOFF_FAKE_MOBILE_OPTIMIZED {
  min-width: 927px;
}

.watchlist-fake-mobile-banner {
  background: #fff7e6;
  border: 1px solid #f0d093;
  border-radius: 8px;
  color: #7a4b00;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 12px;
}
`;
  await writeFile(cssFile, css, "utf8");
}

async function cloneContractRepo(contract: CompletionContract, jobDir: string) {
  const sourceRepo = pickExistingPath([
    env.demoRepoMain,
    "/opt/signoff/repos/signoff-demo-app-main",
  ]);

  if (sourceRepo) {
    await run("git", [
      "-c",
      `safe.directory=${sourceRepo}`,
      "-c",
      `safe.directory=${join(sourceRepo, ".git")}`,
      "clone",
      "--shared",
      sourceRepo,
      jobDir,
    ]);
    await run("git", ["-C", jobDir, "-c", `safe.directory=${jobDir}`, "fetch", "origin", contract.baseBranch]);
    return;
  }

  const token = await githubWriteToken(contract);
  if (!token) {
    throw new Error(
      "No GitHub credentials available to clone the repo. Set GITHUB_APP_INSTALLATION_ID and GITHUB_APP_PRIVATE_KEY, connect GitHub via /github/connect/start, or set GITHUB_TOKEN with repo access.",
    );
  }

  const [owner, repo] = contract.repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repoFullName: ${contract.repoFullName}`);
  }

  await run("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    contract.baseBranch,
    `https://x-access-token:${token}@github.com/${owner}/${repo}.git`,
    jobDir,
  ]);
}

async function githubWriteToken(contract: CompletionContract) {
  return resolveGithubTokenForRepo({
    repoFullName: contract.repoFullName,
    sender: contract.requestedBy,
    role: "executor",
  });
}

async function openOrUpdatePullRequest(params: {
  token: string;
  owner: string;
  repo: string;
  branchName: string;
  contract: CompletionContract;
  commitSha: string;
}) {
  const octokit = new Octokit({ auth: params.token });
  const title = `Verified contract: ${params.contract.goal.slice(0, 72)}`;
  const body = [
    "## Signoff Completion Contract",
    "",
    `Contract: \`${params.contract.id}\``,
    `Contract hash: \`${params.contract.contractHash ?? "pending"}\``,
    `Commit: \`${params.commitSha}\``,
    "",
    "### Frozen Criteria",
    ...params.contract.criteria.map((criterion) => `- \`${criterion.id}\` ${criterion.description}`),
  ].join("\n");

  const existing = await octokit.rest.pulls.list({
    owner: params.owner,
    repo: params.repo,
    head: `${params.owner}:${params.branchName}`,
    state: "open",
  });

  if (existing.data[0]) {
    const pr = existing.data[0];
    await octokit.rest.pulls.update({
      owner: params.owner,
      repo: params.repo,
      pull_number: pr.number,
      title,
      body,
    });
    return pr.html_url;
  }

  const pr = await octokit.rest.pulls.create({
    owner: params.owner,
    repo: params.repo,
    title,
    head: params.branchName,
    base: params.contract.baseBranch,
    body,
    draft: true,
  });
  return pr.data.html_url;
}

async function startPreview(repoDir: string, jobId: string, commitSha: string, branchName: string) {
  const port = await findAvailablePort(3100 + Math.abs(hashCode(jobId) % 500));
  const logPath = join(repoDir, ".signoff-preview.log");
  const previewEnv = await loadPreviewEnv(repoDir);
  await startDetached(
    repoDir,
    logPath,
    ["bun", "run", "dev", "--", "-p", String(port)],
    {
      ...previewEnv,
      NODE_OPTIONS: "--max-old-space-size=1536",
      NEXT_PUBLIC_APP_GIT_SHA: commitSha,
      NEXT_PUBLIC_APP_GIT_REF: branchName,
      NEXT_PUBLIC_APP_VERSION: "signoff-preview",
      NEXT_PUBLIC_APP_BUILD_TIME: new Date().toISOString(),
      PORT: String(port),
    },
  );
  await waitForHttp(`http://127.0.0.1:${port}/watchlist`, 60_000);
  return startCloudflarePreviewTunnel(repoDir, port);
}

async function findAvailablePort(startPort: number) {
  for (let port = startPort; port < startPort + 200; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available preview port found starting at ${startPort}.`);
}

async function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function startCloudflarePreviewTunnel(repoDir: string, port: number) {
  const logPath = join(repoDir, ".signoff-cloudflared.log");
  await startDetached(repoDir, logPath, [
    "cloudflared",
    "tunnel",
    "--url",
    `http://127.0.0.1:${port}`,
    "--no-autoupdate",
  ]);
  return waitForTunnelUrl(logPath, 60_000);
}

async function startDetached(
  cwd: string,
  logPath: string,
  command: string[],
  envOverrides: Record<string, string> = {},
) {
  const envPrefix = Object.entries(envOverrides)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const script = `setsid -f env ${envPrefix} ${command.map(shellQuote).join(" ")} >> ${shellQuote(logPath)} 2>&1 < /dev/null & echo $!`;
  const result = await run("bash", ["-lc", script], {
    cwd,
    timeoutMs: 10_000,
  });
  return result.stdout.trim();
}

async function waitForTunnelUrl(logPath: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastLog = "";
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(logPath)) {
      lastLog = await readFile(logPath, "utf8").catch(() => "");
      const match = lastLog.match(/https:\/\/[-a-z0-9]+(?:-[-a-z0-9]+)*\.trycloudflare\.com/i);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Cloudflare preview tunnel did not produce a public URL. Last log: ${lastLog.slice(-1200)}`);
}

async function loadPreviewEnv(_repoDir: string) {
  return {};
}

async function waitForHttp(url: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Preview did not become ready at ${url}: ${lastError}`);
}

function pickExistingPath(paths: Array<string | undefined>) {
  return paths.find((path) => path && existsSync(path));
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 1024 * 1024 * 20,
    });
    return { stdout: redactSensitive(stdout), stderr: redactSensitive(stderr) };
  } catch (error) {
    const failed = error as Error & { stdout?: string; stderr?: string };
    failed.message = redactSensitive(failed.message);
    if (failed.stdout) failed.stdout = redactSensitive(failed.stdout);
    if (failed.stderr) failed.stderr = redactSensitive(failed.stderr);
    throw failed;
  }
}

async function runAllowingFailure(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
) {
  try {
    const result = await run(command, args, options);
    return { ...result, exitCode: 0 };
  } catch (error) {
    const failed = error as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: redactSensitive(failed.stdout ?? ""),
      stderr: redactSensitive(failed.stderr ?? failed.message),
      exitCode: typeof failed.code === "number" ? failed.code : 1,
    };
  }
}

function redactSensitive(value: string) {
  return value.replace(/x-access-token:[^@\s]+@github\.com/g, "x-access-token:[redacted]@github.com");
}

function slugFor(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "task";
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
