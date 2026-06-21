import "dotenv/config";
import Browserbase from "@browserbasehq/sdk";
import { Octokit } from "@octokit/rest";

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

const checks: Check[] = [];

function present(name: string, options: { required?: boolean } = {}) {
  const value = process.env[name];
  const required = options.required ?? true;
  checks.push({
    name,
    ok: Boolean(value) || !required,
    detail: value ? "set" : required ? "missing" : "optional / deferred",
  });
  return value;
}

function report() {
  for (const check of checks) {
    const mark = check.ok ? "ok" : "missing";
    console.log(`${mark.padEnd(8)} ${check.name} - ${check.detail}`);
  }
}

function checkAgentBrowser() {
  present("AGENT_BROWSER_PROVIDER", { required: false });
  present("AGENT_BROWSER_SESSION", { required: false });

  try {
    const proc = Bun.spawnSync(["agent-browser", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    checks.push({
      name: "agent-browser CLI",
      ok: proc.exitCode === 0,
      detail:
        proc.exitCode === 0
          ? new TextDecoder().decode(proc.stdout).trim()
          : new TextDecoder().decode(proc.stderr).trim() || `exit ${proc.exitCode}`,
    });
  } catch {
    checks.push({
      name: "agent-browser CLI",
      ok: true,
      detail: "optional / not installed; Browserbase SDK verifier is primary",
    });
  }
}

function checkCli(
  name: string,
  args: string[] = ["--version"],
  options: { required?: boolean } = {},
) {
  const required = options.required ?? true;

  let proc: ReturnType<typeof Bun.spawnSync>;
  try {
    proc = Bun.spawnSync([name, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    checks.push({
      name: `${name} CLI`,
      ok: !required,
      detail: required ? "missing from PATH" : "optional / not installed",
    });
    return;
  }

  const stdout = new TextDecoder().decode(proc.stdout).trim();
  const stderr = new TextDecoder().decode(proc.stderr).trim();
  checks.push({
    name: `${name} CLI`,
    ok: proc.exitCode === 0,
    detail: proc.exitCode === 0 ? (stdout.split("\n")[0] || "available") : stderr || `exit ${proc.exitCode}`,
  });
}

async function checkBrowserbase() {
  const apiKey = present("BROWSERBASE_API_KEY");
  const projectId = present("BROWSERBASE_PROJECT_ID");
  if (!apiKey) return;

  try {
    const client = new Browserbase({ apiKey });
    const projects = await client.projects.list();
    checks.push({
      name: "Browserbase API",
      ok: true,
      detail: `reachable; ${projects.length} project(s): ${projects
        .map((project) => `${project.name}=${project.id}`)
        .join(", ")}`,
    });

    if (projectId) {
      const found = projects.some((project) => project.id === projectId);
      checks.push({
        name: "Browserbase project match",
        ok: found,
        detail: found ? "configured project id exists" : "configured project id not found",
      });
    }
  } catch (error) {
    checks.push({
      name: "Browserbase API",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkGithub() {
  const token = present("GITHUB_TOKEN");
  const owner = present("GITHUB_OWNER");
  const repo = present("GITHUB_REPO");
  present("GITHUB_APP_SLUG", { required: false });
  present("GITHUB_APP_ID", { required: false });
  present("GITHUB_APP_CLIENT_ID", { required: false });
  present("GITHUB_APP_CLIENT_SECRET", { required: false });
  present("GITHUB_APP_PRIVATE_KEY", { required: false });
  present("GITHUB_APP_WEBHOOK_SECRET", { required: false });
  present("GITHUB_CONNECTION_STATE_SECRET", { required: false });
  present("GITHUB_APP_INSTALLATION_ID", { required: false });
  const allowedOwner = process.env.GITHUB_ALLOWED_OWNER ?? "senxd";

  checks.push({
    name: "GITHUB_ALLOWED_OWNER",
    ok: Boolean(allowedOwner),
    detail: allowedOwner,
  });

  if (owner) {
    checks.push({
      name: "GitHub owner allowlist",
      ok: owner === allowedOwner,
      detail: owner === allowedOwner ? `owner is ${allowedOwner}` : `owner must be ${allowedOwner}`,
    });
  }

  if (!token || !owner || !repo) return;

  try {
    const octokit = new Octokit({ auth: token });
    const response = await octokit.repos.get({ owner, repo });
    checks.push({
      name: "GitHub repo access",
      ok: true,
      detail: `reachable: ${response.data.full_name}`,
    });
  } catch (error) {
    checks.push({
      name: "GitHub repo access",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkSentry() {
  const token = present("SENTRY_AUTH_TOKEN", { required: false });
  const org = present("SENTRY_ORG", { required: false });
  const project = present("SENTRY_PROJECT", { required: false });
  if (!token || !org || !project) return;

  const url = `https://sentry.io/api/0/projects/${org}/${project}/`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    checks.push({
      name: "Sentry project access",
      ok: response.ok,
      detail: response.ok ? "reachable" : `HTTP ${response.status}`,
    });
  } catch (error) {
    checks.push({
      name: "Sentry project access",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function checkFetchAndRunner() {
  present("ASI1_API_KEY", { required: false });
  present("AGENTVERSE_KEY", { required: false });
  present("AGENT_SEED_PHRASE");
  present("DIGITALOCEAN_ACCESS_TOKEN");
  present("RUNNER_BASE_URL", { required: false });
  present("RUNNER_SHARED_SECRET");
  present("FINANCE_REPO_MAIN", { required: false });
  present("SIGNOFF_JOBS_DIR", { required: false });
  present("SIGNOFF_STATE_DIR", { required: false });
  present("DIGITALOCEAN_DROPLET_IP");
  present("RUNNER_DROPLET_ID");
  present("RUNNER_DROPLET_IP");
  present("RUNNER_SSH_KEY_PATH");
  present("RUNNER_DROPLET_NAME");
  present("RUNNER_DROPLET_REGION");
  present("RUNNER_DROPLET_SIZE");
  present("RUNNER_PREVIEW_MODE");
  present("STRIPE_SECRET_KEY");
  present("STRIPE_WEBHOOK_SECRET", { required: false });
  present("STRIPE_DEFAULT_AMOUNT_CENTS");
  present("STRIPE_CURRENCY");
  present("OPENAI_API_KEY", { required: false });
  present("ANTHROPIC_API_KEY", { required: false });
  present("EXECUTOR_MODEL");
  present("FINANCE_TEST_EMAIL");
  present("FINANCE_TEST_PASSWORD");
  present("REDIS_URL", { required: false });
}

await checkBrowserbase();
checkAgentBrowser();
checkCli("doctl", ["version"], { required: false });
checkCli("cloudflared", ["--version"]);
checkCli("gh", ["--version"]);
checkCli("codex", ["--version"]);
await checkGithub();
await checkSentry();
checkFetchAndRunner();
report();
