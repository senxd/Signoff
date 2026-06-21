import { getCompletionJob, approveCompletionJob, createCompletionJob, runJob } from "../src/jobs/orchestrator";
import { store } from "../src/state/store";

const job = await createCompletionJob({
  goal: "Repair e2e: make the Watchlist page work well on mobile while preserving the desktop table.",
  requestedBy: "repair-e2e",
  demoFixture: "watchlist_mobile",
});

await approveCompletionJob(job.id, "repair-e2e");

const approved = await getCompletionJob(job.id);
if (!approved) throw new Error("job missing after approve");
if (approved.maxRepairAttempts !== 1) {
  throw new Error(`expected maxRepairAttempts=1, got ${approved.maxRepairAttempts}`);
}

approved.status = "authorized";
approved.payment.status = "authorized";
await store.saveJob(approved);

console.log(`repair-e2e job ${job.id} starting with maxRepairAttempts=${approved.maxRepairAttempts}`);
await runJob(job.id);

const final = await getCompletionJob(job.id);
if (!final) throw new Error("job missing after run");

console.log(
  JSON.stringify(
    {
      id: final.id,
      status: final.status,
      repairAttempts: final.repairAttempts,
      verdict: final.verdict.outcome,
      payment: final.payment.status,
      pr: final.artifacts.pullRequestUrl,
      replay: final.artifacts.browserbaseReplayUrl,
    },
    null,
    2,
  ),
);

if (final.repairAttempts < 1) {
  throw new Error(`expected at least one repair attempt, got ${final.repairAttempts}`);
}
if (final.verdict.outcome !== "satisfied") {
  throw new Error(`expected satisfied verdict after repair, got ${final.verdict.outcome}: ${final.verdict.reason}`);
}
if (final.payment.status !== "captured") {
  throw new Error(`expected captured payment, got ${final.payment.status}`);
}

console.log("repair-e2e: ok");
