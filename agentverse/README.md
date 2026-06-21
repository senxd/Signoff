# Signoff

Agent address:

```text
agent1qtp9z99kad93vwtqm9vfs6dqh3ngrqrt02yh9qh446f3r50ujkpzzhay3wt
```

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Signoff is an ASI:One compatible delivery agent for verified Next.js work.

Ask it for a concrete product change. Signoff turns the request into a short completion contract, gives you the estimated price, waits for your approval, then executes the task and verifies the finished PR before it signs off.

Typical flow:

1. You ask for a feature.
2. Signoff checks GitHub access for the repo.
3. It proposes objective acceptance criteria and a fixed estimate.
4. You approve or adjust the contract.
5. The executor makes the change and opens a PR.
6. Browserbase verifies the finished workflow while Signoff keeps the contract fixed.
7. Signoff returns the PR, replay, screenshots, verdict, and payment state.

The completion gate is outcome-based, not token-based:

- PR and commit evidence
- build/check result
- Browserbase screenshots and replay
- criterion-level observed values
- deterministic verdict
- Stripe test-mode authorization captured only after completion proof passes

Example request:

> Make the Watchlist page work well on mobile while preserving the desktop table.

Example response:

> Sure. I can take this as a fixed-price delivery task. GitHub is connected for the demo repo. I’ll sign off only if `/watchlist` loads, the mobile viewport has no horizontal overflow, the expected tickers are visible, the desktop table still exists, a PR is opened, and Browserbase attaches screenshots and a replay.

This agent is intentionally scoped to Next.js for the hackathon so the result can be verified objectively.
