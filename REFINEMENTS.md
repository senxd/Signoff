# Final Refinements

This document tracks the post-critique adjustments to the CalHacks verified-completion plan.

## 1. Self-Certification And Immutable Contracts

The project should not claim that it eliminates self-certification merely because several internal components are involved. The stronger claim is that the agent cannot move the goalposts after execution starts.

The Criteria module may draft objective acceptance checks, but once the user approves the criteria, the contract becomes immutable.

Required contract fields:

- `contract_id`
- `contract_version`
- `contract_hash`
- approved criteria
- required evidence policy
- user approval timestamp
- target repo
- target branch or job id

After approval:

- the executor cannot change criteria
- the verifier receives the frozen contract, preview URL, and commit SHA
- Browserbase measures the accepted predicates
- screenshots and replays are human-review artifacts
- Playwright/Browserbase observed values are machine evidence
- missing required evidence cannot pass

The verdict should be deterministic policy code, not an open-ended LLM judgment.

Verdict states:

- `satisfied`: every required machine-checkable criterion passed
- `not_satisfied`: one or more required criteria failed
- `verification_error`: required evidence was unavailable, stale, missing, or invalid

The ASI agent can explain the verdict, but it cannot override the deterministic release rule.

> The agent cannot change the test after seeing its work, and it cannot release itself without external execution evidence.

## 2. ASI Owns Decisions, Sandbox Produces Effects

For the hackathon, place as much semantic decision-making in ASI/Agentverse as possible. In a production coding agent, pieces of this could live inside the sandbox. For the Fetch track, ASI must be structurally central.

ASI owns:

- intent interpretation
- scope decision
- criteria generation
- awareness of available measurement tools
- contract presentation
- user approval
- contract freeze/hash
- price or settlement eligibility
- tool selection policy
- status narration
- evidence-schema validation
- verdict explanation
- payment complete/cancel decision

The sandbox owns:

- repo clone
- branch creation
- Codex/Claude execution
- file edits
- build/lint/test commands
- preview server
- GitHub push/PR
- raw Browserbase/Sentry calls if easier
- artifact upload

Boundary:

> ASI owns the contract and release authority. The sandbox performs side effects and returns evidence.

This largely solves the "just a wrapper" objection, but only if the ASI transcript itself shows the workflow. A proof page or PR link can support the demo; it cannot be the only place where the primary workflow is visible.

The ASI conversation should show:

- user intent
- generated criteria
- user approval
- frozen `contract_hash`
- execution state
- criterion-level evidence summary
- deterministic verdict
- release/payment eligibility

Judge-facing distinction:

> Weak: ASI forwarded a prompt to a coding backend.
>
> Strong: ASI managed a verified delivery contract from intent to release.

Presentation requirement:

> The ASI transcript is the primary demo artifact. The proof page, PR comment, screenshots, and replay links are supporting evidence.

The judge should be able to understand the entire contract lifecycle inside ASI without opening another tab:

1. What task was requested?
2. What criteria did the agent propose?
3. What exactly did the user approve?
4. What is the immutable contract hash?
5. What commit was verified?
6. Which criteria passed or failed?
7. Why did the verdict become `satisfied`, `not_satisfied`, or `verification_error`?
8. Why is payment/merge release allowed or blocked?

## 3. Browserbase Is A Measurement Tool

Browserbase is not the judge. It is a ruler.

The Criteria module should know which measurement tools exist before drafting criteria. This prevents vague criteria and helps turn user intent into checks that can actually be measured.

Example:

> Intent: improve the mobile dashboard.
>
> Criterion: at 390px viewport, `/dashboard` must satisfy `scrollWidth <= clientWidth`.
>
> Measurement tool: Browserbase browser session.
>
> Evidence: observed `scrollWidth`, observed `clientWidth`, screenshot, replay link.

Browserbase belongs in both contract formation and verification:

- during contract formation, ASI drafts criteria that Browserbase can measure
- during verification, Browserbase collects evidence against the frozen contract

## 4. Verifier Role In ASI

The ASI verifier role does not need to literally drive the browser. The sandbox or Browserbase service can perform browser actions.

The ASI verifier role exists to own verification semantics:

- confirm the evidence corresponds to the approved `contract_hash`
- confirm the evidence was collected from the expected commit SHA and preview URL
- check every required criterion is represented
- classify stale/missing/unavailable evidence as `verification_error`
- explain the deterministic verdict to the user

Judge-facing justification:

> The verifier belongs in ASI because ASI is where contract accountability, user visibility, and release authority live.

The user approved the contract in ASI, so ASI must show how the returned evidence maps to that same contract.

## 5. GitHub PR And Merge Contract

The final software deliverable should be a GitHub pull request bound to the frozen contract.

Required PR metadata:

- `contract_id`
- `contract_version`
- `contract_hash`
- commit SHA verified
- criteria checklist
- build/check result
- Browserbase replay/screenshot links
- deterministic verdict
- merge eligibility

The executor worker may create the branch, push commits, and open the PR, but it cannot merge its own work.

Merge policy:

- if verdict is `satisfied`, ASI marks the PR as merge-eligible
- if verdict is `not_satisfied`, ASI refuses merge eligibility and names failed criteria
- if verdict is `verification_error`, ASI refuses merge eligibility until verification is rerun

For the hackathon, the safest flow is:

> Agent opens PR and posts proof comment. ASI says the PR is merge-eligible. The user performs the final merge, or explicitly asks ASI to merge after the satisfied verdict.

If automatic merge is implemented, it must require the deterministic `satisfied` verdict and the exact verified commit SHA. The merge operation should fail closed if the branch changes after verification.

Required guard:

> Verified commit SHA must equal PR head SHA at merge time.

If they differ, the contract must return to verification.

## 6. uAgents And Multi-Agent Naming

uAgents supports real multi-agent systems. A uAgent is not merely a function; it can have its own identity, address, endpoint, protocols, and messages.

Use "agent" only when the component has a real uAgent-style boundary:

- its own uAgent identity/address
- its own reachable endpoint or mailbox
- explicit message exchange
- a reason for independent trust, routing, or discoverability

Otherwise, use module/service/worker/policy:

- criteria module
- payment service
- executor worker
- browser verifier service
- verdict policy
- GitHub service

This avoids claiming multi-agent collaboration when the implementation is really one orchestrator plus internal functions.

Recommended hackathon setup:

> One submitted ASI-facing uAgent owns the workflow. Internal components are modules/services unless they are implemented as real uAgents.

Optional upgrade:

> Add a separate Verifier uAgent only if the core flow is stable. It should have no repository-write credentials and should receive only the frozen contract hash, commit SHA, and preview URL.

Criteria and payment do not need to be separate submitted agents unless there is time to make their identity, messages, and role visible in ASI.

## 7. Stripe Payment Demo

Payment should stay in the story because verified completion naturally supports outcome-based settlement.

Preferred payment path:

> Stripe Checkout with a manual-capture PaymentIntent.

Flow:

- Signoff creates a Checkout Session for the frozen contract
- the buyer authorizes the Stripe test payment before execution starts
- execution and verification happen
- if verdict is `satisfied`, Signoff captures the PaymentIntent
- if verdict is `not_satisfied` or `verification_error`, Signoff cancels the authorization

For the hackathon scope, the PaymentIntent and Checkout Session are bound to `contract_id` or `contract_hash`.

Use precise labels:

- Stripe test-mode authorization
- manual capture after verified completion
- release eligibility
- completion invoice eligibility

Avoid overclaiming:

- do not call it escrow unless funds are actually held
- do not call it refund unless an actual refund happens
- do not call it live money movement because the demo uses Stripe test mode

Judge-facing framing:

> Payment is not based on tokens or time. The user authorizes the frozen contract up front, and Signoff captures that authorization only after deterministic verification passes.

## 8. Failure Path And Repair Loop

The primary failure demo should be a non-crash contract failure.

Preferred red path:

> The app builds, the preview loads, the PR exists, and no fatal exception occurs, but one approved criterion fails.

Example:

- criterion: no horizontal overflow at 390px
- expected: `scrollWidth <= clientWidth`
- observed: `scrollWidth = 427`, `clientWidth = 390`
- verdict: `not_satisfied`

ASI should report the failed criterion before any repair:

> Attempt 1 is `not_satisfied`. Criterion 3 failed: mobile no-overflow at 390px. I cannot release payment or mark the PR merge-eligible.

Then ASI may automatically forward the failed evidence back to the executor if the contract permits repair.

Repair-loop rules:

- same `contract_hash`
- new implementation commit SHA
- new Browserbase verification run
- max 1-2 automatic repair attempts for the demo
- no payment or merge release until a later attempt returns `satisfied`

Sentry remains a secondary failure proof, not the main red path.

## 9. Scope And Build Order

Because coding work can be delegated to agents, the main speed limit is not raw implementation. The bottleneck is demo reliability:

- testing the end-to-end flow
- rehearsing success and failure paths
- making ASI transcript output clear
- preparing fallback artifacts
- avoiding flaky live integrations during judging

The risky vertical slice still comes first:

1. ASI creates criteria and freezes contract.
2. Prepared branch or agent-created patch produces preview.
3. Browserbase verifies frozen criteria.
4. Deterministic policy returns `satisfied`, `not_satisfied`, or `verification_error`.
5. ASI displays the complete contract-to-verdict lifecycle.
6. Failed verification can trigger bounded repair.
7. GitHub PR is bound to verified commit SHA.
8. Stripe authorization captures/cancels based on verdict.
9. Sentry/Redis/proof page are added only if they improve the demo.

Cut order if reliability is threatened:

1. Redis
2. custom proof page
3. live Sentry querying
4. auto-merge
5. passive streaming beyond simple status/check-status

Do not cut the ASI transcript, frozen contract, Browserbase evidence, deterministic verdict, or PR binding.

## 10. Proof Bundle: Machine Evidence And Human Readability

The proof bundle needs two layers.

Machine layer:

- structured JSON
- deterministic fields
- criterion IDs
- expected predicates
- observed values
- commit SHA
- contract hash
- verifier version
- verdict state

Human layer:

- concise ASI summary
- readable checklist
- screenshots
- Browserbase replay link
- PR link
- simple explanation of each pass/fail
- clear merge/payment eligibility line

The external presentation should be human-readable first, but every human claim should map to machine evidence.

Minimum proof fields:

- `contract_id`
- `contract_version`
- `contract_hash`
- user approval timestamp
- repo
- PR URL
- verified commit SHA
- PR head SHA at verification time
- build/check result
- preview URL
- verifier implementation version
- Browserbase replay/session link
- screenshot link
- criterion-level results
- observed values
- verdict
- refusal reason or verification error reason when applicable

Success and failure runs must use the same evidence format.

Recommended ASI presentation:

> Contract `abc123` was verified against commit `def456`.
>
> 5 of 6 criteria passed. Criterion 3 failed: the dashboard has horizontal overflow at 390px. Expected `scrollWidth <= clientWidth`; observed `427 > 390`.
>
> Verdict: `not_satisfied`. Merge and payment completion are blocked. I am sending the failed evidence back for one repair attempt under the same contract.

## 11. Browserbase Capability Map

Browserbase should be framed as the remote measurement runtime for the frozen contract.

> Browserbase is not the judge. It is the ruler, recorder, and remote browser lab.

Core capabilities we can use:

- create cloud browser sessions
- connect with Playwright, Stagehand, Puppeteer, or Selenium
- run deterministic DOM, viewport, console, and navigation checks
- configure viewport for mobile/desktop criteria
- capture screenshots
- record/replay sessions
- generate live debug/view URLs
- retrieve session logs
- persist auth/session state with Contexts
- attach job metadata to sessions
- use proxies/regions if needed
- upload files into a session
- retrieve files downloaded by the browser
- load browser extensions if needed
- use Browserbase Functions for hosted Playwright execution if useful

For the CalHacks demo, prioritize:

1. viewport-specific assertions
2. screenshots
3. replay/session link
4. console and page error capture
5. session metadata tied to `contract_id`, `contract_hash`, and commit SHA

Do not overbuild:

- Contexts are useful only if `finance-2` needs logged-in state.
- Proxies/stealth/CAPTCHA solving are not central to this project.
- Browserbase Functions are optional; the droplet can call Browserbase directly.
- Extensions are unnecessary unless a future workflow needs them.
- Downloads/uploads matter only for file-heavy tasks.

## 12. Browserbase Measurements For Completion Contracts

The Criteria module should know which Browserbase measurements are available when drafting criteria.

Good contract predicates:

- route loads with HTTP/app-ready success
- no page crash or Playwright `pageerror`
- no critical console errors
- text or element exists
- button/link is visible and enabled
- form interaction completes
- navigation reaches expected URL
- loading state appears before data resolves
- final state appears after data resolves
- viewport has no horizontal overflow
- element is inside viewport bounds
- modal opens/closes
- tab/filter/sort interaction changes visible state
- responsive layout passes at specific widths
- screenshot captured for human review

Example evidence schema:

- criterion id
- measurement tool: `browserbase_playwright`
- viewport
- route
- actions performed
- expected predicate
- observed values
- status
- screenshot URL/path
- Browserbase session/replay URL
- console/page errors

Example:

> Criterion: no horizontal overflow at 390px.
>
> Expected: `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
>
> Observed: `scrollWidth = 427`, `clientWidth = 390`.
>
> Verdict contribution: failed.

Browserbase artifacts should be divided clearly:

- machine evidence: observed values, event/error lists, predicate results
- human evidence: screenshots, live view, replay/video

Only machine evidence should determine the verdict. Human evidence makes the verdict inspectable.

## 13. Canonical Contract Hash

A contract hash only matters if the hashed payload is precisely defined.

Use canonical JSON for the frozen contract payload:

- deterministic key ordering
- no undefined fields
- stable arrays in declared order
- explicit version fields for contract schema and criteria DSL

Minimum hashed fields:

- `contract_id`
- `contract_version`
- `contract_schema_version`
- `base_commit_sha`
- `repo`
- executable criteria DSL
- required evidence policy
- verifier implementation digest
- approver ASI/user address
- approval message ID
- maximum repair attempts
- allowed tools/measurements
- release rule

Do not rely only on a backend-created timestamp as approval proof. Approval should be tied to the ASI sender and ASI message ID.

Store the same `contract_hash` in:

- ASI transcript
- PR body
- verifier request
- payment reference
- proof bundle
- GitHub check run/status metadata

Separate contract identity from implementation attempts:

- `contract_hash`: unchanged across repair attempts
- `attempt_id`: unique per implementation attempt
- `parent_attempt_id`: set for repair attempts
- `implementation_sha`: commit being verified
- `verification_run_id`: unique per Browserbase verification run

## 14. Commit-To-Preview Chain Of Custody

The verifier must prove the preview URL corresponds to the claimed implementation commit.

Required chain:

> `contract_hash` -> `implementation_sha` -> immutable `deployment_id` -> runtime-reported SHA -> Browserbase `session_id` -> `evidence_digest` -> deterministic verdict

The deployed app must expose build metadata, preferably at:

> `/__verification`

Minimum runtime metadata:

- `contract_hash`
- `implementation_sha`
- `deployment_id`
- build timestamp
- app/version identifier

Browserbase must verify:

> `runtime_commit_sha == expected_implementation_sha`

A preview URL and commit SHA appearing in the same JSON object is not sufficient. If the runtime SHA is missing or mismatched, verdict must be `verification_error`.

## 15. Executable Criteria DSL

Freeze executable verification semantics, not only English criteria.

English criteria are useful for user readability, but the hashed contract must include the machine interpretation. Otherwise "visible CTA" could mean DOM-attached, Playwright-visible, inside viewport, unobscured, or clickable.

Each criterion should include:

- stable criterion id
- human description
- route
- viewport
- actions
- measurement expression
- operator
- expected literal or expected expression
- timeout
- required evidence artifacts

Example:

```json
{
  "id": "mobile-overflow",
  "description": "Dashboard has no horizontal overflow at 390px",
  "route": "/dashboard",
  "viewport": {"width": 390, "height": 844},
  "measurement": "document.documentElement.scrollWidth",
  "operator": "<=",
  "expectedFrom": "document.documentElement.clientWidth",
  "requiredArtifacts": ["observed_values", "screenshot", "browserbase_replay"]
}
```

Generate verifier code deterministically from this DSL. The verifier must not reinterpret a criterion after seeing the implementation.

## 16. Evidence Provenance

Schema validation is not enough. Evidence must come from a verifier path that the executor cannot forge.

Preferred flow:

1. Executor returns only `implementation_sha`, `deployment_id`, and `preview_url`.
2. ASI/control plane invokes Browserbase verifier separately.
3. Browserbase verifier collects evidence against the frozen contract.
4. Verdict policy computes `satisfied`, `not_satisfied`, or `verification_error`.

Alternative flow if the executor launches verification:

> Verifier signs the evidence digest with a key unavailable to the executor.

Precise claim:

> The executor cannot certify its own output.

Do not claim Browserbase is a fully independent judge. Browserbase is a separate browser execution environment running the frozen verification policy.

## 17. GitHub Enforcement

The PR merge guard should be a GitHub commit status or check run tied to the exact verified SHA.

Recommended check:

> `verified-completion / satisfied`

Rules:

- check is created only after deterministic verdict
- check is tied to `implementation_sha`
- check includes `contract_hash`, `verification_run_id`, and Browserbase session link
- if PR head SHA changes, previous check no longer applies
- if branch protection is configured, require this check before merge

If branch protection is not configured, use precise wording:

> The agent refuses to merge or authorize merge.

Avoid:

> The PR cannot be merged.

unless GitHub branch protection actually enforces it.

## 18. Credential Separation

Code modified by the executor can run package scripts during install/build. Treat executor output as untrusted.

The execution environment must not contain:

- uAgent seed
- GitHub merge token
- verifier signing key
- payment credentials
- Agentverse credentials

Use an unprivileged runner for code execution. The control plane should hold privileged credentials and perform protected operations:

- pushing resulting commits if possible
- creating GitHub checks
- authorizing merge
- creating/capturing/cancelling Stripe payment state
- signing verifier evidence

At minimum, separate:

- executor token: read/write branch only, no merge/payment/verifier keys
- control-plane token: GitHub check/merge/payment authority
- verifier key: unavailable to executor

## 19. Payment Accuracy

Use Stripe Checkout manual capture for the demo, but do not overclaim settlement behavior.

Honest implementation options:

1. Create a Stripe Checkout authorization before execution starts.
2. Capture only after the contract-to-verdict flow returns `satisfied`.
3. Cancel the authorization when verification fails or errors.

Preferred hackathon phrasing:

> Stripe test-mode authorization for the frozen contract.

Avoid:

> Escrow-backed commitment.

unless the rail actually holds funds as escrow.

Cut live settlement before compromising the contract-to-verdict flow. Payment is valuable, but deterministic verification is the core.

## 20. Demo Continuity

Do not visibly switch from a live contract to an unrelated proof page.

Keep the demo inside ASI:

> Create and start contract A live.
>
> Ask ASI to retrieve completed contract B by contract ID.
>
> Ask ASI to retrieve failed contract C by contract ID.

ASI should explain stored proof bundles using the same response format as live jobs. That keeps the shared ASI conversation as the primary demo artifact.

For every repair attempt:

- rerun all criteria
- include `attempt_id`
- include `parent_attempt_id`
- include `verified_at`
- include `verification_run_id`
- include `all_criteria_rerun: true`

Do not rerun only the failed criterion. A repair can break previously passing behavior.

## 21. Runner Provisioning Decisions

Use `origin/main` of `senxd/finance-2` as the clean base for all demo/test branches. Ignore the dirty local checkout for runner tests.

Generated branch format:

> `signoff/{asi_generated_slug}`

DigitalOcean runner default:

- name: `signoff-runner`
- region: `sfo3`
- size: `s-2vcpu-2gb`
- OS: Ubuntu 24.04
- budget: about $18/month while allocated

Preview exposure:

> Default to Cloudflare tunnel. Use direct droplet port only as fallback.

Finance test credentials:

> Seed a deterministic demo user in the preview/dev Convex environment. Do not use a personal finance account.

Executor model:

> Use Codex CLI programmatically or through a tmux console session with subscription auth for the demo.

Security boundary:

> The executor edits code in its delegated worktree/branch. It must not receive uAgent seed, payment credentials, verifier signing key, GitHub merge token, or broad push authority.

Control plane owns:

- GitHub authorization flow initiated from ASI
- pushing delegated branch if needed
- opening/updating PR
- posting SHA-bound verification status/check
- merge eligibility
- Stripe payment state and ASI-visible payment/protocol-style messages
- verifier invocation

## 22. Current Low-Effort Decisions

The next implementation pass should not reopen core architecture choices. Use the lowest-effort option that preserves the thesis.

Decisions:

- Primary demo is `/watchlist`, not `/paper`.
- `/paper` remains secondary because auth/test data increases risk.
- GitHub critical path is preconnected `senxd/finance-2` using the existing selected-repo credential.
- GitHub App is the target design, but live install/callback is not on the critical demo path.
- Create/preinstall GitHub App credentials only if executor/PR flow is already stable.
- ASI shared-chat validation can be done with `agent-browser`; use computer use only for login/passkey problems.
- Stripe manual capture is load-bearing. ASI may mirror Payment Protocol-style states, but Stripe is the real demo rail.
- No user-facing budget-to-quality tiers. Lower budgets reduce scope, not completion quality.

## 23. Watchlist Demo Contract

Prompt:

> Make the Watchlist page work well on mobile by showing a compact card layout below 640px while preserving the desktop table on larger screens.

Frozen criteria:

- `/watchlist` loads at desktop and mobile.
- Browserbase seeds localStorage with `["NVDA","AAPL","MSFT","SPY"]`.
- At 390px width, no horizontal overflow: `document.documentElement.scrollWidth <= window.innerWidth`.
- At mobile width, visible ticker cards include `NVDA`, `AAPL`, and `MSFT`.
- At desktop width, table layout still exists.
- Screenshot and Browserbase replay are attached.
- Build passes and PR is opened.

Manufactured failure:

> The executor adds a "Mobile optimized" header or spacing change, but leaves the mobile table overflowing.

Expected red-path message:

> Build passed. `/watchlist` loaded. Tickers rendered. Criterion 3 failed: `scrollWidth = 927`, `clientWidth = 390`. Verdict: `not_satisfied`.

## 24. Prepared Demo Matrix

Prepare at least these runs:

| Run | Auth | Outcome | Purpose |
| --- | --- | --- | --- |
| Watchlist success | guest/localStorage | `satisfied` | main green path |
| Watchlist fake fix | guest/localStorage | `not_satisfied` | proves non-crash failure blocks release |
| Watchlist repair | guest/localStorage | repair then `satisfied` | proves bounded retry |
| Watchlist verification error | guest/localStorage | `verification_error` | proves infra/evidence error does not blame executor |
| Desktop regression | guest/localStorage | `not_satisfied` | mobile fix broke desktop table |
| PR SHA mismatch | n/a | merge blocked | verified commit changed before merge |
| Paper success | logged-in | `satisfied` | secondary rich UI demo if auth stable |
| Paper missing field | logged-in | `not_satisfied` | secondary logged-in failure if auth stable |

Each prepared run needs the same proof format: contract hash, PR, preview, Browserbase replay, screenshots, criterion-level observed values, verdict, and payment/merge eligibility.

## 25. Repair And Verification Error Semantics

Repair policy is now exact:

- 3 total implementation attempts maximum.
- `not_satisfied` can trigger code repair.
- `verification_error` retries verification or pauses; it must not trigger code repair automatically.
- all criteria rerun after every repair.
- payment capture and merge eligibility stay blocked until a full `satisfied` verdict.

This distinction matters in the demo:

> A failed predicate means the implementation did not satisfy the contract.
>
> Missing/stale/unavailable evidence means Signoff cannot tell, so it fails closed without blaming the executor.
