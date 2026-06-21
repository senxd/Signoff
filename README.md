# Signoff

Verified software delivery through ASI:One.

Signoff lets a technical user delegate a bounded Next.js task without supervising
a coding agent step by step. From chat, it drafts objective completion criteria,
quotes the task, waits for approval, runs the executor, verifies the finished PR
in Browserbase, and signs off only when the frozen checks pass.

The core promise:

```text
Delegate the task. Review the proof, not the conversation.
```

## Install

```bash
bun install
```

Python dependencies for the ASI/Agentverse broker:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r agentverse/requirements.txt
```

## Configure

Copy `.env.example` to `.env` and fill in the services you want active.
The scaffold works without Redis, Browserbase, Sentry, GitHub, or the executor
webhook, but those integrations will be marked as skipped.
Stripe is required for the hackathon payment demo.

## Run the orchestrator

```bash
bun run dev
```

## Run the ASI broker

```bash
. .venv/bin/activate
python agentverse/signoff_agent.py
```

## Test locally

```bash
curl -X POST http://localhost:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"goal":"Improve the mobile dashboard layout in the demo Next.js repo","previewUrl":"https://example.com"}'
```

Open the returned `artifacts.proofPageUrl` to inspect the proof page. Approve the
contract in ASI, authorize the Stripe test payment, then review the PR, replay,
screenshots, and criterion-level verdict when the job finishes.
