# Signoff Submission Checklist

## Public Artifacts

- Agentverse profile: https://agentverse.ai/agents/details/agent1qtp9z99kad93vwtqm9vfs6dqh3ngrqrt02yh9qh446f3r50ujkpzzhay3wt/profile
- Implementation branch: `origin/codex/stripe-payment-browserbase-verifier`
- Runner proof base: https://alumni-cents-columns-selections.trycloudflare.com
- Local demo recording draft: `/private/tmp/signoff-demo-draft.webm`

Still approval-gated:

- Public repository: https://github.com/senxd/Signoff.
- Create the public ASI:One shared-chat URL from the validated transcript.
- Publish or upload the final narrated 3-5 minute demo video.

## Demo Script

1. Open in ASI:One with Signoff selected.
2. Explain the product in one sentence:
   "Signoff is asynchronous, fixed-price software delivery with independent proof: the executor can change code, but it cannot change the accepted criteria or certify itself."
3. Show the contract shape:
   - fixed Watchlist mobile goal
   - frozen criteria
   - contract hash
   - Stripe authorization before work starts
4. Show W1 green path:
   - Job `hm6jdwiUc2`
   - PR #19
   - Browserbase replay
   - `scrollWidth=390`, `innerWidth=390`
   - Stripe captured
5. Show W2 red path:
   - Job `C1Hk2msP2w`
   - PR #20
   - build passed but `scrollWidth=927`, `innerWidth=390`
   - merge/payment eligibility false
   - Stripe authorization cancelled
6. Show W3 repair path:
   - Job `WvtF5uPHbO`
   - attempt 1 failed under the same contract hash
   - attempt 2 passed all criteria
   - PR #23 check success
   - Stripe captured only after final satisfaction
7. Show W5 / G1 robustness:
   - `JtjMuHdPch` is `verification_error`, not success
   - `bun run test:policy` proves SHA mismatch is `verification_error`
8. Close:
   "Delegate the task. Review the proof, not the conversation."

## Commands To Revalidate

```bash
bun run check
bun run test:policy
bun run setup:check
curl -s https://alumni-cents-columns-selections.trycloudflare.com/jobs/hm6jdwiUc2
curl -s https://alumni-cents-columns-selections.trycloudflare.com/jobs/C1Hk2msP2w
curl -s https://alumni-cents-columns-selections.trycloudflare.com/jobs/WvtF5uPHbO
curl -s https://alumni-cents-columns-selections.trycloudflare.com/jobs/JtjMuHdPch
```
