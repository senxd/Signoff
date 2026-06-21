import { createHmac, createSign, randomBytes } from "node:crypto";
import { env } from "../config/env";

type GitHubRepository = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
};

export type GitHubConnection = {
  connectionId: string;
  sender: string;
  conversationId?: string;
  nonce: string;
  expiresAt: string;
  consumedAt?: string;
  installationId?: number;
  setupAction?: string;
  githubUserId?: number;
  githubLogin?: string;
  accountLogin?: string;
  repositorySelection?: string;
  repositories: GitHubRepository[];
  validated: boolean;
  validationSummary: string;
  createdAt: string;
  updatedAt: string;
};

export type GitHubInstallationTokenRole = "survey" | "executor" | "verifier";

const pendingConnections = new Map<string, GitHubConnection>();
const connectionsById = new Map<string, GitHubConnection>();
const connectionBySender = new Map<string, string>();

function now() {
  return new Date().toISOString();
}

function base64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64url(input: string) {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stateSecret() {
  const secret = env.githubConnectionStateSecret ?? env.runnerSharedSecret;
  if (!secret) {
    throw new Error("GITHUB_CONNECTION_STATE_SECRET or RUNNER_SHARED_SECRET is required.");
  }
  return secret;
}

function signState(payload: Record<string, unknown>) {
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac("sha256", stateSecret()).update(body).digest());
  return `${body}.${signature}`;
}

function verifyState(state: string) {
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new Error("Invalid GitHub connection state.");

  const expected = base64url(createHmac("sha256", stateSecret()).update(body).digest());
  if (signature !== expected) throw new Error("Invalid GitHub connection state signature.");

  const payload = JSON.parse(fromBase64url(body)) as {
    connectionId: string;
    nonce: string;
    exp: number;
  };
  if (!payload.connectionId || !payload.nonce || !payload.exp) {
    throw new Error("Invalid GitHub connection state payload.");
  }
  if (Date.now() > payload.exp) throw new Error("GitHub connection state expired.");
  return payload;
}

function normalizePrivateKey(key: string) {
  return key.includes("\\n") ? key.replaceAll("\\n", "\n") : key;
}

function createAppJwt() {
  if (!env.githubAppId || !env.githubAppPrivateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required.");
  }

  const issuedAt = Math.floor(Date.now() / 1000) - 60;
  const payload = {
    iat: issuedAt,
    exp: issuedAt + 540,
    iss: env.githubAppId,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(env.githubAppPrivateKey));
  return `${unsigned}.${base64url(signature)}`;
}

async function githubJson<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`);
  }
  return (await response.json()) as T;
}

async function exchangeCodeForUserToken(code: string) {
  if (!env.githubAppClientId || !env.githubAppClientSecret) return undefined;

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.githubAppClientId,
      client_secret: env.githubAppClientSecret,
      code,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub OAuth exchange failed with HTTP ${response.status}`);
  }
  const data = (await response.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(data.error_description ?? "GitHub OAuth exchange did not return an access token.");
  }
  return data.access_token;
}

async function getGitHubUser(token: string) {
  return githubJson<{ id: number; login: string }>("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
}

async function userCanAccessInstallation(token: string, installationId: number) {
  const data = await githubJson<{
    installations: Array<{ id: number }>;
  }>("https://api.github.com/user/installations", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  return data.installations.some((installation) => installation.id === installationId);
}

async function getInstallation(installationId: number) {
  return githubJson<{
    id: number;
    account?: { login?: string };
    repository_selection?: string;
  }>(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      authorization: `Bearer ${createAppJwt()}`,
    },
  });
}

async function getInstallationRepositories(installationId: number) {
  const data = await githubJson<{
    repositories: Array<{
      id: number;
      name: string;
      full_name: string;
      private: boolean;
    }>;
  }>(`https://api.github.com/installation/repositories`, {
    headers: {
      authorization: `Bearer ${await createInstallationAccessToken({
        installationId,
        role: "survey",
      })}`,
    },
  });

  return data.repositories.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
  }));
}

export function createGitHubConnectionStart(params: {
  sender: string;
  conversationId?: string;
}) {
  if (!env.githubAppSlug) {
    throw new Error("GITHUB_APP_SLUG is required to create a GitHub App install URL.");
  }

  const connectionId = randomBytes(12).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const expiresAtMs = Date.now() + 10 * 60 * 1000;
  const connection: GitHubConnection = {
    connectionId,
    sender: params.sender,
    conversationId: params.conversationId,
    nonce,
    expiresAt: new Date(expiresAtMs).toISOString(),
    repositories: [],
    validated: false,
    validationSummary: "GitHub connection started; waiting for installation callback.",
    createdAt: now(),
    updatedAt: now(),
  };

  pendingConnections.set(connectionId, connection);
  connectionsById.set(connectionId, connection);

  const state = signState({
    connectionId,
    nonce,
    exp: expiresAtMs,
  });
  const installUrl = new URL(`https://github.com/apps/${env.githubAppSlug}/installations/new`);
  installUrl.searchParams.set("state", state);

  return {
    connection,
    state,
    installUrl: installUrl.toString(),
  };
}

export async function completeGitHubConnection(params: {
  state: string;
  code?: string;
  installationId?: string;
  setupAction?: string;
}) {
  const payload = verifyState(params.state);
  const connection = pendingConnections.get(payload.connectionId);
  if (!connection) throw new Error("GitHub connection state was not found or already consumed.");
  if (connection.nonce !== payload.nonce) throw new Error("GitHub connection nonce mismatch.");

  const installationId = Number(params.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new Error("GitHub callback did not include a valid installation_id.");
  }

  let githubUser: { id: number; login: string } | undefined;
  let userValidated = false;
  if (params.code) {
    const userToken = await exchangeCodeForUserToken(params.code);
    if (userToken) {
      githubUser = await getGitHubUser(userToken);
      userValidated = await userCanAccessInstallation(userToken, installationId);
      if (!userValidated) {
        throw new Error("Authenticated GitHub user cannot access the selected installation.");
      }
    }
  }

  const installation = await getInstallation(installationId);
  const repositories = await getInstallationRepositories(installationId);
  const allowedOwner = env.githubAllowedOwner;
  if (allowedOwner && !repositories.some((repo) => repo.fullName.startsWith(`${allowedOwner}/`))) {
    throw new Error(`GitHub App installation did not grant access to ${allowedOwner} repositories.`);
  }

  connection.installationId = installationId;
  connection.setupAction = params.setupAction;
  connection.githubUserId = githubUser?.id;
  connection.githubLogin = githubUser?.login;
  connection.accountLogin = installation.account?.login;
  connection.repositorySelection = installation.repository_selection;
  connection.repositories = repositories;
  connection.validated = userValidated;
  connection.validationSummary = userValidated
    ? "GitHub App installation validated against the authenticated GitHub user."
    : "GitHub App installation recorded. Enable user authorization on install to validate ownership.";
  connection.consumedAt = now();
  connection.updatedAt = now();

  pendingConnections.delete(payload.connectionId);
  connectionBySender.set(connection.sender, connection.connectionId);
  return connection;
}

export function getGitHubConnection(connectionId: string) {
  return connectionsById.get(connectionId);
}

export function getGitHubConnectionForSender(sender: string) {
  const connectionId = connectionBySender.get(sender);
  return connectionId ? connectionsById.get(connectionId) : undefined;
}

export async function createInstallationAccessToken(params: {
  installationId: number;
  role: GitHubInstallationTokenRole;
  repositoryIds?: number[];
}) {
  const permissionsByRole: Record<GitHubInstallationTokenRole, Record<string, string>> = {
    survey: {
      contents: "read",
    },
    executor: {
      contents: "write",
      pull_requests: "write",
    },
    verifier: {
      checks: "write",
      pull_requests: "write",
    },
  };

  const data = await githubJson<{ token: string }>(
    `https://api.github.com/app/installations/${params.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${createAppJwt()}`,
      },
      body: JSON.stringify({
        permissions: permissionsByRole[params.role],
        repository_ids: params.repositoryIds,
      }),
    },
  );
  return data.token;
}
