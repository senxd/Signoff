import { env } from "../config/env";

export type SentryGateResult = {
  skipped: boolean;
  passed: boolean;
  issueUrls: string[];
  summary: string;
};

export async function checkSentryGate(): Promise<SentryGateResult> {
  if (!env.sentryAuthToken || !env.sentryOrg || !env.sentryProject) {
    return {
      skipped: true,
      passed: true,
      issueUrls: [],
      summary: "Sentry gate skipped because Sentry env vars are not configured.",
    };
  }

  const query = encodeURIComponent("is:unresolved level:error");
  const response = await fetch(
    `https://sentry.io/api/0/projects/${env.sentryOrg}/${env.sentryProject}/issues/?query=${query}&limit=5`,
    {
      headers: {
        Authorization: `Bearer ${env.sentryAuthToken}`,
      },
    },
  );

  if (!response.ok) {
    return {
      skipped: false,
      passed: false,
      issueUrls: [],
      summary: `Sentry API check failed with HTTP ${response.status}.`,
    };
  }

  const issues = (await response.json()) as Array<{ permalink?: string }>;
  return {
    skipped: false,
    passed: issues.length === 0,
    issueUrls: issues.flatMap((issue) => (issue.permalink ? [issue.permalink] : [])),
    summary:
      issues.length === 0
        ? "No unresolved error-level Sentry issues found."
        : `Found ${issues.length} unresolved error-level Sentry issue(s).`,
  };
}
