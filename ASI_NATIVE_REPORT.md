# Report: Making ASI The Base Layer, Not A Surface-Level Wrapper

## Executive Summary

The current product idea is strong only if ASI:One and Agentverse are part of the workflow's control plane, not just the place where a user types the first prompt. The winning abstraction should stay narrow: a software task is not complete until an independently verified completion contract passes. But for the Fetch track, that contract cannot live only in a TypeScript backend. ASI must own the user-facing intent, contract formation, proof interpretation, and final pass/fail response.

The right compromise is not a sprawling twelve-agent system. It is a small ASI-native workflow with one registered `calhacks` Contract Agent, plus optional internal worker agents if time permits. The Contract Agent should receive the ASI:One request, generate or negotiate objective criteria, call the executor/verifier tools, read the proof bundle, and explicitly refuse to call the task done unless the evidence satisfies the contract. GitHub Actions, Browserbase, Sentry, Redis, and Codex/Claude are tools behind the agent, not the product surface.

The strongest claim for the demo is:

```text
Most coding agents self-certify completion. calhacks makes the ASI agent write the acceptance contract first, then refuses to mark the work complete until independent browser execution satisfies it.
```

## Source Material Reviewed

Official / platform docs:

- [Fetch.ai Innovation Lab introduction](https://innovationlab.fetch.ai/resources/docs/intro)
- [Agentverse project gallery](https://innovationlab.fetch.ai/projects)
- [Agentverse README guidelines](https://docs.agentverse.ai/documentation/agent-discovery/readme-guidelines)
- [Agentverse discovery setup guide](https://docs.agentverse.ai/documentation/agent-discovery/setup-guide)
- [Local uAgent docs](https://docs.agentverse.ai/documentation/create-agents/local-agent-u-agent)
- [ASI:One-compatible uAgent example](https://uagents.fetch.ai/docs/examples/asi-1)
- [Fetch hackathon quickstarter](https://github.com/fetchai/innovation-lab-examples/tree/main/fetch-hackathon-quickstarter)
- [Stripe Horoscope Payment Protocol example](https://innovationlab.fetch.ai/resources/docs/examples/agent-transaction/stripe-horoscope-payment-protocol)

Past projects / analogous winners:

- [Pols 15](https://devpost.com/software/pols-15)
- [CareLoop Agentverse Care Companion](https://devpost.com/software/careloop-agentverse-care-companion)
- [Autopsy](https://devpost.com/software/autopsy-zq5d84)
- [MultiEval](https://devpost.com/software/multival)
- [LA Hacks 2026 gallery](https://la-hacks-2026.devpost.com/project-gallery)
- [TreeHacks 2026 gallery](https://treehacks-2026.devpost.com/project-gallery)

Local project files reviewed:

- [PLAN.md](/path/to/signoff/PLAN.md)
- [agentverse/calhacks_agent.py](/path/to/signoff/agentverse/calhacks_agent.py)
- [src/jobs/orchestrator.ts](/path/to/signoff/src/jobs/orchestrator.ts)
- [src/contracts.ts](/path/to/signoff/src/contracts.ts)
- [src/browserbase/verify.ts](/path/to/signoff/src/browserbase/verify.ts)
- [src/sentry/gate.ts](/path/to/signoff/src/sentry/gate.ts)

## What The Fetch Platform Actually Rewards

Fetch's docs describe the platform as build, connect, communicate, and transact between AI agents. The relevant primitives are not only "chat with a bot"; they include uAgents as microservices, Agentverse as the discovery/marketplace layer, ASI:One as the agentic LLM that queries Agentverse, and transaction protocols for payments.

The Agentverse discovery docs make a practical point: discoverability is not accidental. Ranking and routing depend on Chat Protocol support, README quality, handle/metadata, active status, interactions, successful ASI:One interactions, and other profile signals. The README is not just documentation; it is indexed as context so ASI:One can decide when to route to an agent.

For this project, that means ASI centrality has two dimensions:

1. **Technical centrality:** the ASI-routed uAgent must do real work: contract formation, criteria selection, proof interpretation, and pass/fail adjudication.
2. **Discovery centrality:** the Agentverse profile must make it obvious when ASI should invoke us: "verified software completion", "browser-verified PR", "completion contract", "Next.js agent", "software acceptance criteria".

If ASI only forwards `"goal"` to `/jobs`, judges can fairly call it a wrapper. If ASI is the agent that creates the contract and refuses completion when proof fails, then the verification system is an ASI-native service.

## Past Project Analysis

### Pols 15

Pols 15 is the most useful precedent. It won the Agentverse Search & Discovery track and explicitly put Fetch links at the top of its Devpost page: a shared ASI chat link and profile links for many Agentverse agents. It used a `policy-orchestrator` as the chat entrypoint and a set of specialist agents for GraphRAG, environment configuration, demographic cluster simulation, report synthesis, social posting, and comparison.

The lesson is not "make twelve agents." The lesson is that the project made Agentverse legible. A judge could see the ASI chat, the named agents, their roles, and the orchestration pipeline. It also exposed a concrete insight from implementation: mailbox is good for ASI user chat, but too slow for high-fanout internal traffic. Pols switched to direct HTTP A2A for worker calls and kept mailbox for the ASI-facing entrypoint.

Implication for calhacks:

- Use Agentverse mailbox/Chat Protocol for the main `calhacks-contract` agent.
- Do not route every internal step through mailbox if latency matters.
- Make roles visible in ASI messages and proof timeline, even if implemented as one process.
- Provide Agentverse profile URL(s) and ASI shared-chat URL early in the submission.

Recommended role model inspired by Pols, but reduced:

```text
calhacks-contract:
  ASI entrypoint, criteria negotiation, status updates, final adjudication

calhacks-verifier:
  optional separate agent/tool role that runs Browserbase checks

calhacks-payment:
  optional demo/payment protocol role only if the core loop is stable
```

### CareLoop

CareLoop won a Fetch/OmegaClaw prize by presenting a care-coordination workflow through Fetch agents. It had a main orchestrator plus specialist agents for appointment booking, pharmacy, prescription explanation, caregiver notification, and triage. It also used native Fetch payment protocol cards for FET service fees in ASI:One.

The important pattern is "plain-English intent -> orchestrated real-world workflow." The user does not need to know which tool or agent to use. The orchestrator routes to specialists, maintains a timeline, and presents a coordinated result.

Implication for calhacks:

- The user should not ask for "Browserbase" or "GitHub Actions." They should ask, "Make this Next.js task verified."
- The ASI agent should translate intent into contract, executor call, verifier call, and final result.
- The proof timeline should be visible and understandable: contract created, executor ran, PR opened, Browserbase verified, result adjudicated.

CareLoop also reinforces that payment is valuable when it is tied to a service handoff. For calhacks, payment should remain secondary until the pass/fail loop works.

### Autopsy

Autopsy is not a Fetch project, but it is directly relevant because it won by making an agent infrastructure concept concrete and demoable. It records AI coding-agent actions, diagnoses failures, builds a failure knowledge graph, and injects warnings into later agent attempts. Its page succeeds because the loop is clear: agent fails, Autopsy records, Autopsy investigates, graph grows, next similar task starts with a warning.

Two lessons apply strongly:

- A closed loop beats a pile of integrations.
- The failure path is the product, not a corner case.

For calhacks, the analog is:

```text
agent proposes contract -> code change happens -> verifier catches failure -> ASI refuses done -> next run or user sees exact failed criterion
```

Autopsy also shows the value of non-blocking capture and local/demo reliability. Its one-line install and deterministic postflight checks are the kind of obvious workflow judges understand quickly. We should avoid making calhacks look like "many sponsor APIs"; it must look like one closed-loop system.

### MultiEval

MultiEval is relevant because it positions itself around multi-agent orchestration failure. It treats orchestration patterns as first-class objects, not just a collection of LLM calls. It also highlights that multi-agent systems fail through coordination, incompatible assumptions, missing context, and timing. Their differentiator is an evaluation substrate and trace viewer that reveals the shape of the system.

Implication for calhacks:

- If we add multiple agents, their coordination must be visible and purposeful.
- A shared state/proof envelope matters more than many custom message types.
- A trace/proof page can be a core demo surface, because it turns invisible orchestration into an inspectable artifact.

The reduced version for calhacks:

```text
ContractEnvelope:
  goal
  criteria
  executor_result
  verifier_result
  adjudication
  artifacts
  event_timeline
```

That envelope can be passed through ASI/uAgent messages and stored in Redis/proof page. It keeps ASI central while avoiding an overbuilt multi-agent framework.

## Key Conclusion From Past Projects

Winning Fetch projects make their Agentverse/ASI usage visible and structural. They do not merely add a chat entrypoint to an existing app. Common patterns:

- ASI shared-chat link is a required artifact, not an afterthought.
- Agentverse profile links are prominent.
- The orchestrator has an explicit role and name.
- Specialist roles are visible, even if the implementation is pragmatic.
- Payment is compelling only when tied to a real service action.
- A trace/timeline makes orchestration credible.
- Direct HTTP is acceptable for internal speed; mailbox is for ASI-facing reachability.

Therefore, calhacks should not become "TypeScript backend with a Python ASI shim." It should become "ASI Contract Agent that calls a TypeScript verifier/executor backend as tools."

## Current Repo Risk: ASI Is Too Thin

The existing `agentverse/calhacks_agent.py` is a good start, but it is currently mostly a router:

```text
ChatMessage -> extract text -> POST /jobs -> return proof link
```

That shape is eligible, but weak for the Fetch scoring bucket. The actual intelligence lives in `src/jobs/orchestrator.ts`, which is invisible to Agentverse except as an HTTP side effect. Judges could say ASI is replaceable with Slack, Poke, a web form, or curl.

To fix this without overbuilding, move these decisions into the ASI/uAgent layer:

- contract wording
- criteria generation or selection
- explicit acceptance of what "done" means
- final proof interpretation
- refusal to mark complete if evidence fails

Keep these in the backend:

- GitHub Actions dispatch
- Codex/Claude executor invocation
- Browserbase Playwright run
- Sentry query
- Redis persistence
- proof page rendering

The rule:

```text
ASI decides what work means and whether it is done.
The backend performs expensive side effects and returns evidence.
```

## Recommended ASI-Native Design

### One-Agent MVP

Start with one strong Agentverse agent:

```text
calhacks-contract
```

Responsibilities:

1. Receive task intent from ASI:One.
2. Generate a completion contract with 4-6 objective checks.
3. Present the contract in chat.
4. Start execution after acceptance or demo authorization.
5. Stream progress updates.
6. Read proof bundle from backend.
7. Decide `satisfied` or `not_satisfied`.
8. Return final result, proof link, PR link, and failed criteria if any.

This already makes ASI central enough if the chat transcript shows the contract and adjudication, not just a job link.

### Optional Two-Agent Upgrade

If time allows, split the verifier role:

```text
calhacks-contract -> calhacks-verifier
```

The Contract Agent remains the ASI entrypoint. The Verifier Agent consumes a `ContractEnvelope` and returns `VerificationResult`.

This creates a visible separation of duties:

```text
executor cannot self-certify
contract agent cannot fabricate browser proof
verifier agent must return evidence
```

Do this only if it is easy. A reliable one-agent ASI flow is better than fragile multi-agent theater.

### Payment Agent Is Optional

The Stripe Horoscope example demonstrates the full payment pattern:

- include `payment_protocol_spec` with seller role
- send `RequestPayment`
- use Stripe metadata with embedded checkout details
- receive `CommitPayment`
- verify Stripe session payment status
- send `CompletePayment`
- deliver the paid result

For calhacks, payment should not be in the critical path unless the verification loop is already solid. If implemented, payment should be framed as:

```text
RequestPayment -> CommitPayment -> work submitted -> verifier passes -> CompletePayment
```

Do not call it escrow unless there is actual escrow/custody. "Payment release after verified completion" is accurate enough.

## How To Prove ASI Is The Base

### 1. ASI Creates The Contract

The contract must not be hardcoded entirely in the backend. The ASI-facing agent should generate or select criteria from the user's request and present them in chat.

Example ASI response:

```text
I will treat this task as complete only if:
1. /dashboard loads at 390px.
2. No horizontal overflow is present.
3. A loading state appears under delayed data.
4. Dashboard content appears after the delay resolves.
5. Browserbase records a replay of the flow.

Should I start this contract?
```

Even if the backend enforces the checks, the ASI transcript proves the agent owns the definition of completion.

### 2. ASI Streams The Workflow Timeline

Past projects make progress visible. The Contract Agent should send chat updates:

```text
Contract created.
Criteria selected.
Executor started.
PR opened.
Browser verifier started.
Criterion 2 failed: horizontal overflow at 390px.
Completion refused.
```

Do not hide everything behind a proof page. The proof page is evidence; the ASI transcript is the judged Fetch interaction.

### 3. ASI Interprets The Proof Bundle

The backend should return structured evidence:

```json
{
  "jobId": "job_123",
  "criteria": [
    { "id": "mobile-loads", "passed": true },
    { "id": "no-horizontal-scroll", "passed": false, "evidence": "scrollWidth 428 > clientWidth 390" }
  ],
  "artifacts": {
    "prUrl": "...",
    "browserbaseReplayUrl": "...",
    "screenshotUrls": []
  }
}
```

The Contract Agent should make the final statement:

```text
I cannot mark this complete. The browser run failed the no-horizontal-scroll criterion.
```

That refusal is the ASI-native product moment.

### 4. Agentverse Profile Must Match The Product

The README must be semantically rich and retrieval-friendly. Based on Agentverse's README guidance, include:

- one-sentence purpose
- supported inputs
- output artifacts
- examples
- limitations
- keywords
- exact invocation examples

Suggested handle/name:

```text
handle: @calhacks-contract
name: calhacks Verified Completion Agent
```

README keywords:

```text
software completion contract
browser verification
Next.js PR
GitHub pull request
Browserbase replay
acceptance criteria
verified coding agent
done/not done adjudication
```

### 5. Submission Must Show ASI Artifacts First

Devpost should lead with:

1. ASI shared-chat URL.
2. Agentverse profile URL.
3. Proof page.
4. GitHub PR.
5. Browserbase replay.

The ordering matters. If GitHub/Browserbase appear before ASI/Agentverse, the project reads as a normal devtool with ASI bolted on.

## Recommended Demo Script

### Live Segment

In ASI:One:

```text
Ask @calhacks-contract to add a mobile loading state to the demo Next.js dashboard and verify it.
```

Expected chat:

```text
calhacks-contract:
I will create a completion contract with these criteria...

calhacks-contract:
Starting execution. I will not mark this complete until Browserbase verifies the accepted criteria.
```

Kick off the workflow, but do not rely on it completing live.

### Green Pre-Run

Show a pre-run successful task:

- ASI transcript with criteria.
- GitHub PR.
- proof page.
- Browserbase screenshots/replay.
- final ASI message: `satisfied`.

### Red Pre-Run

Show a failed task:

- ASI transcript with same criteria.
- Browserbase/Sentry or Playwright evidence.
- failed criterion.
- final ASI message: `not satisfied`.

This is the differentiator. The agent refuses to call the job done.

## Implementation Changes Suggested For This Repo

### Agentverse Layer

Refactor [agentverse/calhacks_agent.py](/path/to/signoff/agentverse/calhacks_agent.py):

- Add ASI:One model call for criteria generation.
- Return contract text before starting the job.
- Add progress messages.
- After backend completion, fetch the job/proof bundle and make final pass/fail wording in the agent.
- Keep `EndSessionContent` only for the final message, not the initial "job created" message if ASI supports multi-turn continuation cleanly.

Add an Agentverse README tuned for discovery:

- problem: coding agents self-certify done
- solution: completion contracts
- usage examples
- proof artifacts
- limitations

### Backend Layer

Keep the backend as tool infrastructure:

- `POST /contracts`: store contract and criteria.
- `POST /jobs`: run execution.
- `POST /verify`: run Browserbase against criteria.
- `GET /jobs/:id/proof`: proof page.

Do not move Browserbase/PR/Sentry code into uAgents unless necessary.

### Proof Bundle

Add a single structured envelope:

```text
ContractEnvelope
  goal
  criteria
  execution_result
  verification_result
  adjudication_result
  artifacts
  timeline
```

This mirrors the lessons from Pols 15 and MultiEval: one shared state/envelope is easier than many custom message pairs.

## What Not To Do

Do not add many agents just to look multi-agent. Pols 15 used many agents because the domain required parallel demographic simulation. Our domain requires separation of duties, not fan-out. One Contract Agent plus a visible verifier role is enough.

Do not make Browserbase the main product. Browserbase is the independent witness. ASI is the contract owner.

Do not lead with payments. Payment is a business model and optional sponsor lever. The core action is verified completion.

Do not overstate objectivity. Say:

```text
We verify objective acceptance criteria and provide evidence for human review.
```

Do not say:

```text
We prove the code is good.
```

## Final Recommendation

Keep [PLAN.md](/path/to/signoff/PLAN.md) focused and reliability-first. Use this report to guide ASI integration depth.

The final build should have this shape:

```text
ASI:One routes to calhacks-contract.
calhacks-contract defines completion criteria.
Backend executes and verifies.
Browserbase supplies independent evidence.
calhacks-contract reads proof and adjudicates.
The final answer in ASI is "satisfied" or "not satisfied," with links.
```

That makes ASI the base layer because the ASI agent owns the semantic contract and final judgment. Everything else is an execution or evidence tool.

