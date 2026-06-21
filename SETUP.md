# Setup Checklist

This file tracks the credentials and external setup needed for the verified completion agent.

Do not commit `.env`. Copy `.env.example` to `.env` and fill values locally.

## Browserbase

Required for the verifier plugin:

```text
BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID
AGENT_BROWSER_PROVIDER=browserbase
AGENT_BROWSER_SESSION=signoff-verifier
```

The API key alone is enough for the setup checker to list available Browserbase projects:

```bash
bun run setup:check
```

Copy the matching project ID into `BROWSERBASE_PROJECT_ID`.

The verifier uses Browserbase for:

- preview URL browsing
- Playwright/Stagehand-style assertions
- `agent-browser` fallback automation
- screenshots
- replay/live session URLs
- proof bundle artifacts

Chrome plugin status:

```text
The Codex Chrome plugin is currently broken in this session with:
codex/sandbox-state-meta: missing field sandboxPolicy
```

Use `agent-browser` for browser setup/testing instead:

```bash
agent-browser open https://example.com
agent-browser snapshot -i
agent-browser screenshot --full
agent-browser record start ./demo.webm
agent-browser record stop
```

For Browserbase-backed runs, set:

```bash
AGENT_BROWSER_PROVIDER=browserbase
```

The production verifier should still prefer structured SDK/Playwright execution when possible, because it needs deterministic JSON results for the ASI-side verdict policy.

## Fetch / ASI / Agentverse

Required for the ASI-facing Signoff uAgent:

```text
ASI1_API_KEY
AGENTVERSE_KEY
AGENT_NAME=signoff
AGENT_SEED_PHRASE
AGENT_PORT=8001
ORCHESTRATOR_URL
```

Current status:

```text
ASI chat is logged in.
Agentverse/uAgent is running through mailbox and registered active.
Signoff has been invoked from ASI:One by name/address.
```

Manual browser setup still required before submission:

1. Capture the Agentverse profile URL.
2. Explicitly approve ASI chat sharing, then click ASI's `Share` control and capture the public ASI:One shared-chat URL.
3. Explicitly approve making the submission repository public, or create a sanitized public submission fork.
4. Record the short demo video using the green, red, repair, verification-error, and SHA-mismatch evidence in `DEMO_EVIDENCE.md`.

Fetch deliverables:

```text
Public ASI:One shared chat session URL
Agentverse Agent Profile URL
Public GitHub repository URL
3-5 minute demo video
Brief problem / target user / outcome description
```

Current publication status:

```text
Agentverse profile: captured in DEMO_EVIDENCE.md
Implementation branch: pushed to origin/codex/stripe-payment-browserbase-verifier
Repo visibility: public via https://github.com/senxd/Signoff
ASI shared chat: validated but not publicly shared; requires explicit approval
Demo video: not recorded yet
```

Current browser-control status: local `agent-browser --cdp 9222` works for ASI and Stripe setup. The Chrome extension path is not required for the demo.

## DigitalOcean Runner

Required for live execution:

```text
DIGITALOCEAN_ACCESS_TOKEN
DIGITALOCEAN_DROPLET_IP
RUNNER_DROPLET_ID
RUNNER_DROPLET_IP
RUNNER_SSH_KEY_PATH
RUNNER_BASE_URL
RUNNER_SHARED_SECRET
RUNNER_DROPLET_NAME=signoff-runner
RUNNER_DROPLET_REGION=sfo3
RUNNER_DROPLET_SIZE=s-2vcpu-2gb
RUNNER_PREVIEW_MODE=cloudflared
```

Runner scope:

```text
Allowed owner: senxd
Allowed repo pattern: github.com/senxd/*
Canonical demo repo: github.com/senxd/finance-2
Local checkout: /path/to/finance
One active job per repo
Fresh workdir per job
Branch prefix: signoff/{asi_generated_slug}
```

The droplet should have:

- git
- gh CLI
- bun
- Codex CLI with subscription auth, normally operated through a tmux session
- cloudflared for HTTPS preview tunnels
- access to the selected `senxd` demo repo
- known demo target: `senxd/finance-2`
- runner service that accepts signed job requests
- unprivileged execution user
- no payment, uAgent seed, verifier signing, or merge credentials in the executor sandbox

Recommended droplet:

```text
Ubuntu 24.04
s-2vcpu-2gb
sfo3
Budget: about $18/month while allocated
Destroy after demo if no longer needed
```

Provisioned runner:

```text
Name: signoff-runner
Region: sfo3
Size: s-2vcpu-2gb
Public IP: stored in .env as RUNNER_DROPLET_IP
Firewall: SSH restricted to current local public IP
Executor image: signoff-executor-base:latest
Control env: /opt/signoff/secrets/control.env, root:signoff 0640
Clean finance clone: /opt/signoff/repos/finance-2-main at origin/main
Cloudflare quick tunnel: smoke tested successfully
Executor path: prepared deterministic `finance-2` Watchlist patch/failure fixtures. Codex/Claude CLI can replace this later, but it is not on the critical demo path.
```

Preview exposure:

```text
Default: cloudflared quick tunnel per preview run
Fallback: direct http://DROPLET_IP:PORT only if tunnel is unreliable
```

Clean source of truth:

```text
All demo branches start from origin/main of senxd/finance-2.
Ignore the dirty local /path/to/finance checkout for runner tests.
```

Finance test credentials:

```text
FINANCE_TEST_EMAIL=signoff-demo@example.com
FINANCE_TEST_PASSWORD=<demo-only password>
```

Use the finance app's Convex seed path to create a deterministic demo user in the preview/dev environment. Do not use a personal finance account for Browserbase verification.

## GitHub

Fastest hackathon setup:

```text
GITHUB_TOKEN
GITHUB_OWNER=senxd
GITHUB_ALLOWED_OWNER=senxd
GITHUB_REPO=finance-2
```

Preferred post-hackathon setup: GitHub App installed only on selected `senxd` repositories.

Authorization model:

```text
ASI should initiate or explain the GitHub authorization flow.
The control plane receives/holds GitHub authority.
The executor sandbox does not receive broad push/merge credentials.
```

The control plane must be able to:

- clone the repo
- create `signoff/{asi_generated_slug}` branch
- push commits
- open a draft PR
- comment with the proof bundle
- create a SHA-bound `verified-completion / satisfied` status/check

Branch policy:

```text
Default branch source: origin/main
Generated branch format: signoff/{asi_generated_slug}
Executor may only modify its delegated worktree/branch.
Executor must not be able to push arbitrary refs or merge.
```

If a fine-grained PAT is used, scope it to `senxd/finance-2` and prefer control-plane-only storage.

## Payment

Required for the hackathon payment demo:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_... # optional if using /payment/sync during demo
STRIPE_DEFAULT_AMOUNT_CENTS=2000
STRIPE_CURRENCY=usd
```

Target flow:

```text
Stripe Checkout Session -> manual-capture PaymentIntent authorized -> execute -> verify -> capture if satisfied
```

Failure path:

```text
Stripe Checkout Session -> manual-capture PaymentIntent authorized -> execute -> verify fails/errors -> cancel authorization
```

Use Stripe test mode for the hackathon demo. Do not claim escrow or live settlement; the accurate claim is that Signoff captures a Stripe authorization only after deterministic completion evidence passes.

## Sentry

Required for runtime-error gate:

```text
SENTRY_AUTH_TOKEN
SENTRY_ORG
SENTRY_PROJECT
```

Each verification run should tag:

```text
SENTRY_RELEASE=signoff-job-{job_id}
SENTRY_ENVIRONMENT=preview-job-{job_id}
proof_run_id={job_id}
```

Sentry blocks completion if new error/fatal events appear during the Browserbase proof run.

## Redis

Optional but useful for event streaming and sponsor fit:

```text
REDIS_URL
```

Use it for:

- passive ASI updates
- job timeline
- artifact index
- payment state mirror
- per-repo locks

Fetch/ASI remains the orchestrator. Redis is the audit trail.

## Validation

Run:

```bash
bun run setup:check
```

The script checks configured services without printing secret values.
