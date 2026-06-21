import {
  approveContract,
  createInitialContract,
  deriveDeterministicVerdict,
  type CompletionContract,
  type CriterionEvidence,
} from "../src/contracts";

function baseContract() {
  const contract = createInitialContract("policy-demo", {
    goal: "Make the Watchlist page work well on mobile by showing a compact card layout below 640px.",
    repoFullName: "senxd/signoff-demo-app",
    baseBranch: "main",
    stack: "nextjs",
    price: "$20.00 completion authorization",
    requestedBy: "asi-one",
    demoFixture: "watchlist_mobile",
    maxRepairAttempts: 0,
  });
  approveContract(contract, "policy-test");
  contract.artifacts.implementationSha = "1111111111111111111111111111111111111111";
  contract.artifacts.verifiedCommitSha = "1111111111111111111111111111111111111111";
  return contract;
}

function passedEvidence(contract: CompletionContract): CriterionEvidence[] {
  return contract.criteria.map((criterion) => ({
    criterionId: criterion.id,
    status: "passed",
    observed: { test: "policy" },
  }));
}

function attachEvidence(contract: CompletionContract, criteria: CriterionEvidence[]) {
  contract.artifacts.verification = {
    verifier: "local",
    verifierVersion: "policy-test",
    outcome: "satisfied",
    summary: "Synthetic policy test proof bundle.",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    runtimeCommitSha: contract.artifacts.verifiedCommitSha,
    verifiedCommitSha: contract.artifacts.verifiedCommitSha,
    criteria,
  };
}

function assertOutcome(name: string, contract: CompletionContract, expected: string) {
  const verdict = deriveDeterministicVerdict(contract);
  if (verdict.outcome !== expected) {
    throw new Error(`${name}: expected ${expected}, received ${verdict.outcome}: ${verdict.reason}`);
  }
  console.log(`${name}: ${verdict.outcome} (${verdict.reason})`);
}

const satisfied = baseContract();
attachEvidence(satisfied, passedEvidence(satisfied));
assertOutcome("satisfied", satisfied, "satisfied");

const notSatisfied = baseContract();
const failedCriteria = passedEvidence(notSatisfied);
failedCriteria[3] = {
  criterionId: "watchlist_mobile_no_overflow",
  status: "failed",
  observed: { scrollWidth: 927, innerWidth: 390 },
  error: "Horizontal overflow: scrollWidth 927, innerWidth 390.",
};
attachEvidence(notSatisfied, failedCriteria);
assertOutcome("not_satisfied", notSatisfied, "not_satisfied");

const missingEvidence = baseContract();
attachEvidence(missingEvidence, passedEvidence(missingEvidence).slice(0, -1));
assertOutcome("missing_evidence", missingEvidence, "verification_error");

const shaMismatch = baseContract();
shaMismatch.artifacts.verifiedCommitSha = "2222222222222222222222222222222222222222";
attachEvidence(shaMismatch, passedEvidence(shaMismatch));
assertOutcome("sha_mismatch", shaMismatch, "verification_error");
