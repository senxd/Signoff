import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";
import type { CompletionContract } from "../contracts";
import { env } from "../config/env";
import { createInstallationAccessToken } from "../github/app";

export type ExecutorResult = {
  buildPassed: boolean;
  previewUrl?: string;
  commitSha?: string;
  branchName?: string;
  pullRequestUrl?: string;
  summary: string;
};

const execFileAsync = promisify(execFile);

export async function runExistingCodingExecutor(
  contract: CompletionContract,
): Promise<ExecutorResult> {
  const webhook = process.env.EXECUTOR_WEBHOOK_URL;

  if (!webhook) {
    if (
      contract.repoFullName === "senxd/finance-2" &&
      (contract.demoFixture === "watchlist_mobile" ||
        contract.demoFixture === "watchlist_mobile_failure" ||
        contract.demoFixture === "watchlist_mobile_repair")
    ) {
      return runPreparedFinanceWatchlistExecutor(contract);
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

async function runPreparedFinanceWatchlistExecutor(contract: CompletionContract): Promise<ExecutorResult> {
  const sourceRepo = pickExistingPath([
    env.financeRepoMain,
    "/opt/signoff/repos/finance-2-main",
    "/path/to/finance",
  ]);
  if (!sourceRepo) {
    throw new Error("No finance-2 source checkout found for prepared executor.");
  }

  const jobsRoot = env.signoffJobsDir ?? (existsSync("/opt/signoff") ? "/opt/signoff/jobs" : "/private/tmp/signoff-jobs");
  await mkdir(jobsRoot, { recursive: true });
  const jobDir = join(jobsRoot, `${contract.id}-attempt-${contract.repairAttempts}`);
  await rm(jobDir, { recursive: true, force: true });

  const branchName = `signoff/${slugFor(contract.goal)}-${contract.id.toLowerCase()}`;
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
  await run("git", [
    "-C",
    jobDir,
    "-c",
    `safe.directory=${jobDir}`,
    "checkout",
    "-B",
    branchName,
    `origin/${contract.baseBranch}`,
  ]);

  if (
    contract.demoFixture === "watchlist_mobile_failure" ||
    (contract.demoFixture === "watchlist_mobile_repair" && contract.repairAttempts === 0)
  ) {
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

  await run("git", ["-C", jobDir, "-c", `safe.directory=${jobDir}`, "add", "src/components/watchlist/watchlist-shell.tsx"]);
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

  const gitToken = await githubWriteToken();
  if (!gitToken) {
    throw new Error("No GitHub write token available for pushing the delegated branch.");
  }

  await run("git", [
    "-C",
    jobDir,
    "-c",
    `safe.directory=${jobDir}`,
    "push",
    `https://x-access-token:${gitToken}@github.com/senxd/finance-2.git`,
    `${branchName}:${branchName}`,
    "--force",
  ]);

  const pullRequestUrl = await openOrUpdatePullRequest({
    token: gitToken,
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
  const file = join(repoDir, "src/components/watchlist/watchlist-shell.tsx");
  let source = await readFile(file, "utf8");
  if (source.includes("function WatchlistMobileCards(")) return;

  const helper = `
function fmtWatchlistCurrency(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtWatchlistPct(value: number | null) {
  if (value === null) return "—";
  return \`\${value >= 0 ? "+" : ""}\${value.toFixed(2)}%\`;
}

function WatchlistMobileCards({ rows }: { rows: PortfolioRow[] }) {
  return (
    <div className="grid gap-3 md:hidden">
      {rows.map((row) => (
        <article
          key={row.id}
          className="rounded-xl border border-border/70 bg-card p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">{row.symbol}</h2>
              <p className="truncate text-xs text-muted-foreground">
                {row.name ?? "Watchlist ticker"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium">{fmtWatchlistCurrency(row.price)}</p>
              <p
                className={
                  row.dayChangePct !== null && row.dayChangePct < 0
                    ? "text-xs text-red-500"
                    : "text-xs text-emerald-600"
                }
              >
                {fmtWatchlistPct(row.dayChangePct)}
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Volume</dt>
              <dd className="font-medium">
                {row.volume === null ? "—" : row.volume.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">52w high</dt>
              <dd className="font-medium">{fmtWatchlistCurrency(row.high52)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sector</dt>
              <dd className="truncate font-medium">{row.sector ?? "—"}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}
`;

  source = source.replace("function useWatchlistMarketRows", `${helper}\nfunction useWatchlistMarketRows`);
  source = source.replace(
    `const WATCHLIST_COLUMNS_REGISTRY = {
  columns: WATCHLIST_COLUMNS,
  columnById: WATCHLIST_COLUMN_BY_ID,
  alwaysVisible: WATCHLIST_ALWAYS_VISIBLE,
  defaultVisibleColumnIds: DEFAULT_WATCHLIST_VISIBLE_COLUMN_IDS,
};
`,
    `const WATCHLIST_COLUMNS_REGISTRY = {
  columns: WATCHLIST_COLUMNS,
  columnById: WATCHLIST_COLUMN_BY_ID,
  alwaysVisible: WATCHLIST_ALWAYS_VISIBLE,
  defaultVisibleColumnIds: DEFAULT_WATCHLIST_VISIBLE_COLUMN_IDS,
};

function readGuestWatchlistSymbols() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.toUpperCase())
      ),
    ];
  } catch {
    return [];
  }
}

const SIGNOFF_DEMO_WATCHLIST_SYMBOLS = ["NVDA", "AAPL", "MSFT", "SPY"];
`,
  );
  source = source.replace(
    `  const [mounted, setMounted] = useState(false);
  const [guestSymbols, setGuestSymbols] = useState<string[]>([]);
  const [guestHydrated, setGuestHydrated] = useState(false);`,
    `  const [mounted, setMounted] = useState(() => typeof window !== "undefined");
  const [guestSymbols, setGuestSymbols] = useState<string[]>(() => readGuestWatchlistSymbols());
  const [guestHydrated, setGuestHydrated] = useState(() => typeof window !== "undefined");`,
  );
  source = source.replace(
    `<div
          className={
            quotesLoading ? "opacity-80 transition-opacity" : "opacity-100"
          }
        >
          <HoldingsTable`,
    `<div
          className={
            quotesLoading ? "opacity-80 transition-opacity" : "opacity-100"
          }
        >
          <WatchlistMobileCards rows={tableRows} />
          <div className="hidden md:block">
            <HoldingsTable`,
  );
  source = source.replace(
    `            showFooter={false}
          />
        </div>
      )}`,
    `            showFooter={false}
          />
          </div>
        </div>
      )}`,
  );
  source = source.replace(
    `    if (isSignedIn || (authPending && watchlistDoc)) {
      return watchlistDoc?.symbols ?? [];
    }
    return guestSymbols;
  }, [mounted, authPending, isSignedIn, watchlistDoc, guestSymbols]);`,
    `    if (!mounted) return SIGNOFF_DEMO_WATCHLIST_SYMBOLS;
    const currentGuestSymbols =
      guestSymbols.length > 0 ? guestSymbols : readGuestWatchlistSymbols();
    if (currentGuestSymbols.length > 0) return currentGuestSymbols;
    if (isSignedIn) {
      return watchlistDoc?.symbols ?? [];
    }
    return SIGNOFF_DEMO_WATCHLIST_SYMBOLS;
  }, [mounted, isSignedIn, watchlistDoc, guestSymbols]);`,
  );
  source = source.replace(
    `    if (!mounted) return [];
    if (!mounted) return SIGNOFF_DEMO_WATCHLIST_SYMBOLS;`,
    `    if (!mounted) return SIGNOFF_DEMO_WATCHLIST_SYMBOLS;`,
  );
  source = source.replace(
    `  const listReady =
    mounted &&
    !(
      ((isSignedIn || authPending) && watchlistDoc === undefined) ||
      (!isSignedIn && !authPending && !guestHydrated)
    );`,
    `  const hasGuestSymbols = guestSymbols.length > 0;
  const listReady =
    !isSignedIn ||
    (mounted &&
      (hasGuestSymbols ||
      !(
        (isSignedIn && watchlistDoc === undefined) ||
        (!isSignedIn && !guestHydrated)
      )));`,
  );

  if (
    !source.includes("function WatchlistMobileCards(") ||
    !source.includes("function readGuestWatchlistSymbols()") ||
    !source.includes("const hasGuestSymbols = guestSymbols.length > 0;") ||
    source.includes("if (!mounted) return []") ||
    source.includes("isSignedIn || (authPending && watchlistDoc)") ||
    source.includes("((isSignedIn || authPending) && watchlistDoc === undefined)")
  ) {
    throw new Error("Watchlist mobile patch failed to insert helper or guest loading guard.");
  }
  await writeFile(file, source, "utf8");
}

async function applyWatchlistFakeMobilePatch(repoDir: string) {
  const file = join(repoDir, "src/components/watchlist/watchlist-shell.tsx");
  let source = await readFile(file, "utf8");
  if (source.includes("SIGNOFF_FAKE_MOBILE_OPTIMIZED")) return;

  source = source.replace(
    `  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-8 md:px-6">`,
    `  return (
    <div className="SIGNOFF_FAKE_MOBILE_OPTIMIZED mx-auto flex w-full min-w-[927px] max-w-[1200px] flex-col gap-5 px-4 py-8 md:px-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
        Mobile optimized
      </div>`,
  );

  if (
    !source.includes("SIGNOFF_FAKE_MOBILE_OPTIMIZED") ||
    !source.includes("min-w-[927px]") ||
    source.includes("function WatchlistMobileCards(")
  ) {
    throw new Error("Watchlist fake mobile patch failed to create the intended overflow-only failure.");
  }

  await writeFile(file, source, "utf8");
}

async function githubWriteToken() {
  const installationId = Number(env.githubAppInstallationId);
  if (Number.isInteger(installationId) && installationId > 0 && env.githubAppPrivateKey) {
    return createInstallationAccessToken({
      installationId,
      role: "executor",
    });
  }
  return env.githubToken;
}

async function openOrUpdatePullRequest(params: {
  token: string;
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
    owner: "senxd",
    repo: "finance-2",
    head: `senxd:${params.branchName}`,
    state: "open",
  });

  if (existing.data[0]) {
    const pr = existing.data[0];
    await octokit.rest.pulls.update({
      owner: "senxd",
      repo: "finance-2",
      pull_number: pr.number,
      title,
      body,
    });
    return pr.html_url;
  }

  const pr = await octokit.rest.pulls.create({
    owner: "senxd",
    repo: "finance-2",
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
    ["bun", "run", "dev:frontend", "--", "-p", String(port)],
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

async function loadPreviewEnv(repoDir: string) {
  const envFiles = [
    "/opt/signoff/secrets/finance-preview.env",
    join(repoDir, ".env.local"),
    join(repoDir, ".env"),
  ];
  const allowed = new Set([
    "NEXT_PUBLIC_CONVEX_URL",
    "NEXT_PUBLIC_CONVEX_SITE_URL",
    "CONVEX_SITE_URL",
  ]);
  const values: Record<string, string> = {};
  for (const file of envFiles) {
    if (!existsSync(file)) continue;
    const text = await readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!key || !allowed.has(key)) continue;
      values[key] = rawValue?.replace(/^['"]|['"]$/g, "") ?? "";
    }
  }
  return values;
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
