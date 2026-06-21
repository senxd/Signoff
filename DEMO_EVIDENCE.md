# Signoff Demo Evidence

## Live Runner

- Runner URL: `https://alumni-cents-columns-selections.trycloudflare.com`
- Agent address: `agent1qtp9z99kad93vwtqm9vfs6dqh3ngrqrt02yh9qh446f3r50ujkpzzhay3wt`
- Agentverse profile: https://agentverse.ai/agents/details/agent1qtp9z99kad93vwtqm9vfs6dqh3ngrqrt02yh9qh446f3r50ujkpzzhay3wt/profile
- Demo repo: `senxd/finance-2`
- Primary route: `/watchlist`

## ASI Transcript

The ASI chat has been validated with three status retrievals through the Signoff Agentverse agent:

- `hm6jdwiUc2`: satisfied/captured success path
- `C1Hk2msP2w`: not_satisfied/cancelled failure path
- `WvtF5uPHbO`: not_satisfied first attempt, automatic repair, satisfied/captured final path

Creating the public ASI shared-chat URL is intentionally not done yet because it exposes the authenticated transcript publicly. It requires explicit approval to click ASI's `Share` control.

## Demo Matrix Coverage

| Run | Job / Evidence | Status |
| --- | --- | --- |
| W1 Watchlist success | `hm6jdwiUc2` | completed, satisfied, payment captured |
| W2 Watchlist final refusal | `C1Hk2msP2w` | failed, not_satisfied, payment cancelled |
| W3 Watchlist repair success | `WvtF5uPHbO` | attempt 1 not_satisfied, attempt 2 satisfied, payment captured |
| W5 verification_error | `JtjMuHdPch` | failed, verification_error, payment cancelled |
| G1 SHA mismatch | `bun run test:policy` | deterministic policy returns verification_error when verified runtime SHA differs from implementation SHA |

## Green Path

- Job: `hm6jdwiUc2`
- Status: `completed`
- Verdict: `satisfied`
- Payment: `captured`
- PR: https://github.com/senxd/finance-2/pull/19
- Proof: https://alumni-cents-columns-selections.trycloudflare.com/jobs/hm6jdwiUc2/proof
- Browserbase replay: https://www.browserbase.com/sessions/984929b1-a129-45e3-bced-fc2fd9c33441
- GitHub check: `Signoff / verified completion`, conclusion `success`, posted on commit `73d2e74e47409f6e0a52de3c99fb1a36d3e93305`

Key machine evidence:

- `build_passes`: passed
- `watchlist_seeded`: `["NVDA","AAPL","MSFT","SPY"]`
- `watchlist_mobile_no_overflow`: `scrollWidth=390`, `innerWidth=390`
- `watchlist_mobile_cards_visible`: `NVDA`, `AAPL`, and `MSFT` present
- `watchlist_desktop_table_exists`: table and thead present
- Browserbase replay and screenshots attached

## Red Path

- Job: `C1Hk2msP2w`
- Status: `failed`
- Verdict: `not_satisfied`
- Payment: `cancelled`
- PR: https://github.com/senxd/finance-2/pull/20
- Proof: https://alumni-cents-columns-selections.trycloudflare.com/jobs/C1Hk2msP2w/proof
- Browserbase replay: https://www.browserbase.com/sessions/ac043e82-2fe5-4405-bc5a-20244aee47eb
- GitHub check: `Signoff / verified completion`, conclusion `failure`, posted on commit `ca1b21602374c1716ceda5c27f94d388236ea55f`

Key machine evidence:

- `build_passes`: passed
- `watchlist_seeded`: `["NVDA","AAPL","MSFT","SPY"]`
- `watchlist_mobile_no_overflow`: failed with `scrollWidth=927`, `innerWidth=390`
- Merge eligible: false
- Payment eligible: false
- Stripe authorization cancelled

## Repair Path

- Job: `WvtF5uPHbO`
- Status: `completed`
- Verdict: `satisfied`
- Payment: `captured`
- Repair attempts used: `1` of `2`
- Contract hash: `3758d29da534a555fbb641a1223b839615859993d78b0b9f1f00c9e5d89a0b59`
- PR: https://github.com/senxd/finance-2/pull/23
- Proof: https://alumni-cents-columns-selections.trycloudflare.com/jobs/WvtF5uPHbO/proof
- Browserbase replay, failed attempt: https://www.browserbase.com/sessions/e03854b8-6594-426a-b476-1c4fa9205b9d
- Browserbase replay, repaired attempt: https://www.browserbase.com/sessions/3afc33ce-79b5-40a9-b2d0-21d27e9eb2c2
- GitHub check: `Signoff / verified completion`, conclusion `success`, posted on commit `b9819062c7263376e80eaebd847f40f81d263105`

Key repair evidence:

- Attempt 1 build passed and opened PR #23 at commit `884e96750a7580a2d3df228ee284fe5ea3e47c1b`
- Attempt 1 failed `watchlist_mobile_no_overflow` with `scrollWidth=927`, `innerWidth=390`
- `repair.started` fired under the same frozen `contractHash`
- Stripe stayed `authorized` during repair and was not cancelled after the first `not_satisfied` verdict
- Attempt 2 build passed at commit `b9819062c7263376e80eaebd847f40f81d263105`
- Attempt 2 passed `watchlist_mobile_no_overflow` with `scrollWidth=390`, `innerWidth=390`
- Attempt 2 passed mobile card visibility for `NVDA`, `AAPL`, and `MSFT`
- Stripe authorization captured only after the final satisfied verdict

## Verification Error Path

- Job: `JtjMuHdPch`
- Status: `failed`
- Verdict: `verification_error`
- Payment: `cancelled`
- PR: https://github.com/senxd/finance-2/pull/18
- Proof: https://alumni-cents-columns-selections.trycloudflare.com/jobs/JtjMuHdPch/proof
- Browserbase replay: https://www.browserbase.com/sessions/3e5f6072-9a35-417a-9878-7e76aa1f78e7

Key machine evidence:

- Build passed and PR opened.
- Browserbase verification returned unusable route evidence after a tunnel navigation failure.
- Deterministic verdict was `verification_error`, not `satisfied` or `not_satisfied`.
- Merge eligible: false
- Payment eligible: false
- Stripe authorization cancelled

## SHA Mismatch Policy

The commit-binding rule is covered by the deterministic policy test:

```bash
bun run test:policy
```

The `sha_mismatch` case constructs a frozen approved contract with all criteria passing, then sets `implementationSha` and `verifiedCommitSha` to different values. The expected and observed verdict is `verification_error` with merge/payment eligibility blocked.

## Verification Commands

```bash
bun run check
bun run test:policy
curl -s https://alumni-cents-columns-selections.trycloudflare.com/jobs/hm6jdwiUc2
curl -s https://alumni-cents-columns-selections.trycloudflare.com/jobs/C1Hk2msP2w
curl -s https://alumni-cents-columns-selections.trycloudflare.com/jobs/WvtF5uPHbO
curl -s https://alumni-cents-columns-selections.trycloudflare.com/jobs/JtjMuHdPch
```
