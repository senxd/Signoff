import { createHash } from "node:crypto";
import { z } from "zod";

export const completionContractInputSchema = z.object({
  goal: z.string().min(8),
  repoUrl: z.string().url().optional(),
  repoFullName: z.string().default("senxd/signoff-demo-app"),
  baseBranch: z.string().default("main"),
  baseCommitSha: z.string().optional(),
  previewUrl: z.string().url().optional(),
  stack: z.literal("nextjs").default("nextjs"),
  price: z.string().default("$20.00 completion authorization"),
  quoteAmountCents: z.number().int().positive().optional(),
  requestedBy: z.string().default("asi-one"),
  demoFixture: z
    .enum([
      "watchlist_mobile",
      "watchlist_mobile_failure",
      "watchlist_mobile_repair",
      "paper_account_health",
    ])
    .default("watchlist_mobile"),
  maxRepairAttempts: z.number().int().min(0).max(2).default(1),
});

export type CompletionContractInput = z.infer<typeof completionContractInputSchema>;

export type JobStatus =
  | "draft"
  | "approved"
  | "quoted"
  | "payment_pending"
  | "authorized"
  | "building"
  | "verifying"
  | "completed"
  | "failed";

export type VerificationOutcome = "satisfied" | "not_satisfied" | "verification_error";

export type CriterionStatus = "passed" | "failed" | "error" | "missing";

export type VerificationCriterion =
  | {
      id: string;
      description: string;
      kind: "route_loads";
      required: true;
      source: "machine";
      path: string;
      viewport: "desktop" | "mobile";
    }
  | {
      id: string;
      description: string;
      kind: "local_storage_seed";
      required: true;
      source: "machine";
      key: string;
      value: unknown;
    }
  | {
      id: string;
      description: string;
      kind: "no_horizontal_overflow";
      required: true;
      source: "machine";
      path: string;
      viewport: "mobile";
      maxWidth: number;
    }
  | {
      id: string;
      description: string;
      kind: "visible_text";
      required: true;
      source: "machine";
      path: string;
      viewport: "mobile" | "desktop";
      texts: string[];
    }
  | {
      id: string;
      description: string;
      kind: "desktop_table_exists";
      required: true;
      source: "machine";
      path: string;
      viewport: "desktop";
    }
  | {
      id: string;
      description: string;
      kind: "screenshot_attached" | "browserbase_replay_attached" | "build_passes" | "pull_request_opened";
      required: true;
      source: "machine";
    };

export type CriterionEvidence = {
  criterionId: string;
  status: CriterionStatus;
  observed?: Record<string, unknown>;
  error?: string;
};

export type VerificationResult = {
  verifier: "browserbase" | "local";
  verifierVersion: string;
  outcome: VerificationOutcome;
  summary: string;
  startedAt: string;
  completedAt: string;
  runtimeCommitSha?: string;
  verifiedCommitSha?: string;
  criteria: CriterionEvidence[];
  consoleErrors?: string[];
  pageErrors?: string[];
};

export type StripePaymentStatus =
  | "unconfigured"
  | "checkout_pending"
  | "authorized"
  | "capture_pending"
  | "captured"
  | "cancelled"
  | "failed";

export type StripePaymentState = {
  provider: "stripe";
  status: StripePaymentStatus;
  mode: "test";
  amountCents: number;
  currency: string;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  paymentIntentId?: string;
  lastSyncedAt?: string;
  capturedAt?: string;
  cancelledAt?: string;
  failureReason?: string;
};

export type CompletionContract = CompletionContractInput & {
  id: string;
  contractSchemaVersion: "2026-06-21";
  contractVersion: number;
  contractHash?: string;
  approvedAt?: string;
  approvedBy?: string;
  status: JobStatus;
  repairAttempts: number;
  createdAt: string;
  updatedAt: string;
  criteria: VerificationCriterion[];
  acceptance: {
    buildPasses: boolean;
    browserbaseReplayRequired: boolean;
    screenshotRequired: boolean;
    noNewCriticalSentryIssues: boolean;
    pullRequestRequired: boolean;
  };
  artifacts: {
    pullRequestUrl?: string;
    proofPageUrl?: string;
    screenshotUrls: string[];
    browserbaseSessionId?: string;
    browserbaseLiveUrl?: string;
    browserbaseReplayUrl?: string;
    sentryIssueUrls: string[];
    summary?: string;
    implementationSha?: string;
    verifiedCommitSha?: string;
    branchName?: string;
    verification?: VerificationResult;
  };
  payment: StripePaymentState;
  verdict: {
    outcome?: VerificationOutcome;
    mergeEligible: boolean;
    paymentEligible: boolean;
    reason?: string;
  };
  error?: string;
};

export type JobEvent = {
  jobId: string;
  type: string;
  message: string;
  at: string;
  data?: Record<string, unknown>;
};

export function createInitialContract(
  id: string,
  input: CompletionContractInput,
): CompletionContract {
  const parsed = completionContractInputSchema.parse(input);
  const now = new Date().toISOString();

  return {
    id,
    ...parsed,
    contractSchemaVersion: "2026-06-21",
    contractVersion: 1,
    status: "draft",
    repairAttempts: 0,
    createdAt: now,
    updatedAt: now,
    criteria: createCriteriaForInput(parsed),
    acceptance: {
      buildPasses: true,
      browserbaseReplayRequired: true,
      screenshotRequired: true,
      noNewCriticalSentryIssues: true,
      pullRequestRequired: true,
    },
    artifacts: {
      screenshotUrls: [],
      sentryIssueUrls: [],
    },
    payment: {
      provider: "stripe",
      status: "unconfigured",
      mode: "test",
      amountCents: parsed.quoteAmountCents ?? 0,
      currency: "usd",
    },
    verdict: {
      mergeEligible: false,
      paymentEligible: false,
    },
  };
}

export function approveContract(contract: CompletionContract, approvedBy: string) {
  if (contract.status !== "draft") {
    throw new Error(`Contract ${contract.id} is already ${contract.status}; only draft contracts can be approved.`);
  }

  const now = new Date().toISOString();
  contract.approvedAt = now;
  contract.approvedBy = approvedBy;
  contract.contractHash = hashApprovedContract(contract);
  contract.status = "payment_pending";
  contract.updatedAt = now;
}

export function hashApprovedContract(contract: CompletionContract) {
  return createHash("sha256").update(canonicalizeContract(contract)).digest("hex");
}

export function canonicalizeContract(contract: CompletionContract) {
  return stableStringify({
    contractSchemaVersion: contract.contractSchemaVersion,
    contractVersion: contract.contractVersion,
    id: contract.id,
    goal: contract.goal,
    repoUrl: contract.repoUrl,
    repoFullName: contract.repoFullName,
    baseBranch: contract.baseBranch,
    baseCommitSha: contract.baseCommitSha,
    stack: contract.stack,
    price: contract.price,
    quoteAmountCents: contract.quoteAmountCents,
    requestedBy: contract.requestedBy,
    demoFixture: contract.demoFixture,
    maxRepairAttempts: contract.maxRepairAttempts,
    criteria: contract.criteria,
  });
}

export function deriveDeterministicVerdict(contract: CompletionContract): {
  outcome: VerificationOutcome;
  mergeEligible: boolean;
  paymentEligible: boolean;
  reason: string;
} {
  const verification = contract.artifacts.verification;
  if (!contract.contractHash || !contract.approvedAt) {
    return {
      outcome: "verification_error",
      mergeEligible: false,
      paymentEligible: false,
      reason: "Contract was not approved and frozen before verification.",
    };
  }

  if (!verification) {
    return {
      outcome: "verification_error",
      mergeEligible: false,
      paymentEligible: false,
      reason: "Verifier did not return a proof bundle.",
    };
  }

  const evidenceById = new Map(verification.criteria.map((criterion) => [criterion.criterionId, criterion]));
  for (const criterion of contract.criteria) {
    if (!criterion.required) continue;
    const evidence = evidenceById.get(criterion.id);
    if (!evidence || evidence.status === "missing" || evidence.status === "error") {
      return {
        outcome: "verification_error",
        mergeEligible: false,
        paymentEligible: false,
        reason: `${criterion.id} has no usable evidence: ${evidence?.error ?? "missing"}.`,
      };
    }
    if (evidence.status === "failed") {
      return {
        outcome: "not_satisfied",
        mergeEligible: false,
        paymentEligible: false,
        reason: `${criterion.id} failed: ${evidence.error ?? criterion.description}.`,
      };
    }
  }

  if (contract.artifacts.implementationSha) {
    if (!contract.artifacts.verifiedCommitSha) {
      return {
        outcome: "verification_error",
        mergeEligible: false,
        paymentEligible: false,
        reason: "Verifier did not observe the runtime commit SHA.",
      };
    }
    if (contract.artifacts.implementationSha !== contract.artifacts.verifiedCommitSha) {
      return {
        outcome: "verification_error",
        mergeEligible: false,
        paymentEligible: false,
        reason: "Verified runtime commit does not match the implementation commit.",
      };
    }
  }

  return {
    outcome: "satisfied",
    mergeEligible: true,
    paymentEligible: true,
    reason: "Every required frozen criterion passed with machine evidence.",
  };
}

function createCriteriaForInput(input: CompletionContractInput): VerificationCriterion[] {
  if (input.demoFixture === "paper_account_health") {
    return [
      {
        id: "build_passes",
        description: "Project build/check command passes.",
        kind: "build_passes",
        required: true,
        source: "machine",
      },
      {
        id: "paper_loads_mobile",
        description: "/paper loads at mobile width for the demo account.",
        kind: "route_loads",
        required: true,
        source: "machine",
        path: "/paper",
        viewport: "mobile",
      },
      {
        id: "account_health_visible",
        description: "Account Health section shows Buying power, Open positions, and Unrealized.",
        kind: "visible_text",
        required: true,
        source: "machine",
        path: "/paper",
        viewport: "mobile",
        texts: ["Account Health", "Buying power", "Open positions", "Unrealized"],
      },
      {
        id: "paper_mobile_no_overflow",
        description: "At 390px width, /paper has no horizontal overflow.",
        kind: "no_horizontal_overflow",
        required: true,
        source: "machine",
        path: "/paper",
        viewport: "mobile",
        maxWidth: 390,
      },
      {
        id: "pull_request_opened",
        description: "A GitHub pull request is opened for the implementation.",
        kind: "pull_request_opened",
        required: true,
        source: "machine",
      },
    ];
  }

  return [
    {
      id: "build_passes",
      description: "Project build/check command passes.",
      kind: "build_passes",
      required: true,
      source: "machine",
    },
    {
      id: "watchlist_seeded",
      description: 'Browserbase seeds guest watchlist localStorage with ["NVDA","AAPL","MSFT","SPY"].',
      kind: "local_storage_seed",
      required: true,
      source: "machine",
      key: "dashboard.watchlist.symbols.v1",
      value: ["NVDA", "AAPL", "MSFT", "SPY"],
    },
    {
      id: "watchlist_loads_desktop",
      description: "/watchlist loads at desktop width.",
      kind: "route_loads",
      required: true,
      source: "machine",
      path: "/watchlist",
      viewport: "desktop",
    },
    {
      id: "watchlist_mobile_no_overflow",
      description: "At 390px width, /watchlist has no horizontal overflow.",
      kind: "no_horizontal_overflow",
      required: true,
      source: "machine",
      path: "/watchlist",
      viewport: "mobile",
      maxWidth: 390,
    },
    {
      id: "watchlist_mobile_cards_visible",
      description: "At mobile width, visible ticker cards include NVDA, AAPL, and MSFT.",
      kind: "visible_text",
      required: true,
      source: "machine",
      path: "/watchlist",
      viewport: "mobile",
      texts: ["NVDA", "AAPL", "MSFT"],
    },
    {
      id: "watchlist_desktop_table_exists",
      description: "At desktop width, the table layout still exists.",
      kind: "desktop_table_exists",
      required: true,
      source: "machine",
      path: "/watchlist",
      viewport: "desktop",
    },
    {
      id: "browserbase_replay_attached",
      description: "Browserbase replay link is attached.",
      kind: "browserbase_replay_attached",
      required: true,
      source: "machine",
    },
    {
      id: "screenshot_attached",
      description: "Desktop and mobile screenshots are attached.",
      kind: "screenshot_attached",
      required: true,
      source: "machine",
    },
    {
      id: "pull_request_opened",
      description: "A GitHub pull request is opened for the implementation.",
      kind: "pull_request_opened",
      required: true,
      source: "machine",
    },
  ];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
