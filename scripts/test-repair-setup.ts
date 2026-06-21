import { createInitialContract } from "../src/contracts";
import { shouldApplyWatchlistFakeMobilePatch } from "../src/executor/executor";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const defaults = createInitialContract("repair-defaults", {
  goal: "Make the Watchlist page work well on mobile.",
  requestedBy: "test",
});

assert(defaults.maxRepairAttempts === 1, "default maxRepairAttempts should be 1");

const firstAttempt = {
  ...defaults,
  demoFixture: "watchlist_mobile" as const,
  maxRepairAttempts: 1,
  repairAttempts: 0,
};
assert(
  shouldApplyWatchlistFakeMobilePatch(firstAttempt),
  "first attempt with repair enabled should use the intentional overflow failure patch",
);

const repairAttempt = {
  ...firstAttempt,
  repairAttempts: 1,
};
assert(
  !shouldApplyWatchlistFakeMobilePatch(repairAttempt),
  "repair attempt should apply the real mobile patch",
);

const noRepair = {
  ...defaults,
  demoFixture: "watchlist_mobile" as const,
  maxRepairAttempts: 0,
  repairAttempts: 0,
};
assert(
  !shouldApplyWatchlistFakeMobilePatch(noRepair),
  "jobs without repair should not use the failure patch",
);

console.log("repair setup: ok");
