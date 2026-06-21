# Signoff

Verified completion contracts for Next.js work through ASI:One.

The Fetch/Agentverse agent creates a completion contract from chat, the Bun
orchestrator delegates to the existing coding executor, Browserbase generates
visual proof, and a deterministic policy captures a Stripe test-mode payment
only after the frozen criteria pass.

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

Open the returned `artifacts.proofPageUrl` to inspect the completion-contract
proof page and use the returned `payment.checkoutUrl` to authorize the Stripe
test payment.
