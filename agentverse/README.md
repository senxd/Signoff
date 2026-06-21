# Signoff

Agent address:

```text
agent1qtp9z99kad93vwtqm9vfs6dqh3ngrqrt02yh9qh446f3r50ujkpzzhay3wt
```

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Signoff is an ASI:One compatible completion-contract agent for verified Next.js work.

Ask it to complete a concrete full-stack web task in a GitHub repo. The agent creates a completion contract, delegates execution to the hosted TypeScript orchestrator, and returns proof artifacts when the work is done.

The completion gate is outcome based, not token based:

- GitHub branch or pull request artifact
- build/check result
- Browserbase visual verification screenshots and replay
- deterministic criterion-level verdict
- Stripe test-mode authorization captured only after completion proof exists

Example request:

> Improve the mobile dashboard layout in the demo Next.js repo and verify the result.

This agent is intentionally scoped to Next.js for the hackathon so completion can be verified objectively.
