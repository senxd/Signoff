# Critique Brief: CalHacks Verified Completion Agent

## Current Thesis

Build an ASI:One-discoverable agent that turns a software task into a completion contract, delegates implementation to a hosted coding executor, and refuses to mark the task complete until independent browser verification satisfies the accepted criteria.

Core claim:

```text
Agents should not be allowed to self-certify completion.
```

The product is not "a coding agent inside ASI." It is a verified-completion broker for small Next.js tasks:

```text
intent -> completion contract -> code change -> GitHub PR -> Browserbase/Sentry proof -> ASI adjudication -> payment complete/cancel
```

## Locked Architecture

Use one polished ASI/Agentverse entrypoint:

```text
calhacks uAgent
```

The `calhacks` uAgent is the ASI-native control plane. It should own:

- ASI:One chat interaction
- scope validation
- completion-contract generation
- user confirmation
- payment commitment state
- runner dispatch
- passive progress updates
- proof interpretation
- final satisfied / not_satisfied decision
- payment complete/cancel state

Internal roles are lightweight modules/services, not necessarily separate submitted Agentverse agents:

- Criteria role
- Pricing / Payment role
- Executor Job role
- Browserbase Verifier role
- Sentry Gate role
- Adjudicator role

Only add a second submitted Agentverse agent if the main loop is stable early. A second Verifier Agent is optional, not required.

## Why uAgents

`uAgents` is Fetch's lightweight Python framework for agents that register with Agentverse, speak the Agent Chat Protocol, and become discoverable/usable through ASI:One.

Use it only for the ASI-facing agent layer. Do not move the full coding executor, Browserbase verifier, Sentry gate, or GitHub automation into Python unless that becomes simpler. The execution stack can remain TypeScript/shell behind the uAgent.

Important framing:

```text
ASI decides what the job means and whether it is complete.
The backend performs expensive side effects and returns evidence.
```

## Execution Plan

Use a DigitalOcean droplet runner for the live demo.

Canonical demo project:

```text
Local checkout: /path/to/finance
GitHub repo: https://github.com/senxd/finance-2
GitHub owner: senxd
GitHub repo name: finance-2
Stack: Next.js 16, React 19, TypeScript, Bun, Convex
```

Runner responsibilities:

- accept signed job requests from the Orchestrator
- allow only `github.com/senxd/*`
- default to `github.com/senxd/finance-2`
- one active job per repo
- clone into a fresh job directory
- create branch `agent/{job_id}`
- run Codex CLI or Claude Code CLI as a black-box editor
- run `bun install`, build, lint, or tests as available
- for `finance-2`, prefer `bun run lint:fast`, `bun run build`, and `bun run dev:frontend` for preview when Convex is not needed
- push branch
- open/update GitHub PR
- start or expose preview
- emit high-signal status events back to the Orchestrator

The runner should behave like a background job/subagent. It posts updates but does not decide completion.

## Verification Plan

Browserbase is the independent browser witness.

Verification should produce a structured proof bundle:

- accepted criteria
- route/action/viewport checked
- pass/fail per criterion
- screenshots
- replay/live session link
- console/page errors
- build result
- PR link
- optional Sentry result

`agent-browser` is the setup/operator fallback because the Codex Chrome plugin is currently broken with a `sandboxPolicy` runtime issue. Primary implementation should still prefer Browserbase SDK + Playwright-style checks for deterministic JSON output.

Sentry is a secondary gate:

- tag runs by job-specific release/environment
- fail completion on new error/fatal events during verification
- use especially for the failure-path demo

## Payment Plan

Use Fetch Agent Payment Protocol semantics plus visible demo payment state.

Default flow:

```text
quote -> commit payment -> execute -> verify -> complete payment
quote -> commit payment -> execute -> verify fails -> cancel / no capture
```

Stripe is supporting evidence, not the central dependency. If Stripe integration is fast, use PaymentIntent/manual-capture or invoice-like artifact. If it slows the build, keep the Fetch payment messages and demo state visible in ASI and on the proof page.

The important product edge is paying for verified completion, not for tokens/time.

## Fetch Track Fit

Mandatory requirements to satisfy:

- register at least one agent on Agentverse
- implement Agent Chat Protocol
- make the agent discoverable and directly usable through ASI:One
- show meaningful tool execution or orchestration
- complete the primary workflow without requiring a custom frontend
- submit public GitHub repo with instructions

Deliverables:

- ASI:One shared chat session URL
- Agentverse Agent Profile URL
- public GitHub repository URL
- 3-5 minute demo video
- short description of problem, target user, and outcome

Agentverse README must include:

```md
![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)
```

## Sponsor Fit

Primary:

- Fetch / Agentverse: base control plane, Chat Protocol, contract and adjudication.
- Ddoski's Toolbox: developer workflow tool.
- Browserbase: browser verification, screenshots, replay.
- Sentry: runtime failure gate and negative-path demo.
- Payment / Stripe: verified-completion monetization.

Optional:

- Redis: job ledger, passive event stream, artifact index, per-repo locks.

Redis should not become central unless implemented visibly. It is the audit trail, not the orchestrator.

## Demo Plan

Do not rely on a full live coding job finishing during judging.

Prepare three paths:

```text
1. Live ASI request creates a new contract and starts a job.
2. Pre-run successful contract shows PR + Browserbase proof + satisfied result.
3. Pre-run failed contract shows Browserbase/Sentry failure + blocked completion/payment.
```

Suggested sequence:

1. Ask ASI:One for a small Next.js task.
2. Show generated criteria and quote/payment commitment.
3. User confirms.
4. Runner starts and ASI shows passive progress updates.
5. Switch to pre-run successful proof bundle.
6. Show GitHub PR and Browserbase replay/screenshots.
7. Show Adjudicator result: `satisfied`.
8. Show payment completed/invoice state.
9. Show failed proof bundle where completion/payment is blocked.

The failure path is the differentiator.

## Main Risks

ASI feels like a router:

- Mitigation: ASI chat must show contract creation, criteria, progress, proof interpretation, and final refusal/pass.

Executor flakiness:

- Mitigation: known Next.js repo, rehearsed task, pre-run proof artifacts.

Subjective task quality:

- Mitigation: explicitly say the system proves objective agreed criteria, not subjective design quality.

Browser/deploy timing:

- Mitigation: pre-run artifacts and proof page; live job only needs to start convincingly.

Payment complexity:

- Mitigation: demo payment state first; Stripe only if it stays easy.

Architecture inflation:

- Mitigation: one submitted uAgent, lightweight internal roles.

## Specific Questions For Critique

Please critique:

- Does the current plan make ASI/Agentverse structurally central enough for Fetch scoring?
- Is one uAgent with internal roles stronger than multiple submitted agents for this demo?
- Is the completion-contract abstraction clear and distinctive enough?
- Is the payment story credible if it is Fetch protocol semantics plus demo state, with Stripe optional?
- What would a judge likely call "just a wrapper" in this plan?
- Which one scope item should be cut first if implementation time gets tight?
- What proof artifacts are absolutely required for the demo to be persuasive?
- Is the failure path framed strongly enough?

## Current Final Answer

Build the narrow, reliable version:

```text
ASI:One -> calhacks uAgent -> completion contract -> demo payment commitment -> DigitalOcean runner -> GitHub PR + preview -> Browserbase/Sentry proof -> ASI adjudication -> payment complete/cancel
```

Success criterion for the hackathon:

```text
A judge can run or watch an ASI:One conversation where the agent creates a contract, delegates work, receives proof, and refuses/completes payment based on verified completion.
```
