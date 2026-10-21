import { EBrand } from "@dltech/atlas-ui/components/brand-mark";
export enum EProjectSettingsPage {
  Overview = "overview",
  Sandbox = "sandbox",
  Secrets = "secrets",
  Mcp = "mcp",
}

export enum EShipBehavior {
  OpenPullRequest = "open-pr",
  Push = "push",
  Merge = "merge",
}

export interface ProjectFixture {
  owner: string;
  name: string;
  description: string;
  defaultBranch: string;
  baseBranch: string;
  shipBehavior: EShipBehavior;
  additionalRepositories: readonly string[];
}

export const PROJECT: ProjectFixture = {
  owner: "dennisofficial",
  name: "atlas",
  description: "Coding-agent harness: the loop, the TUI, and Atlas Cloud.",
  defaultBranch: "main",
  baseBranch: "",
  shipBehavior: EShipBehavior.OpenPullRequest,
  additionalRepositories: ["dennisofficial/atlas-docs"],
};

export const SHIP_BEHAVIORS: readonly { value: EShipBehavior; label: string; description: string }[] = [
  {
    value: EShipBehavior.OpenPullRequest,
    label: "Open pull request",
    description: "Push a branch and open a PR for review.",
  },
  {
    value: EShipBehavior.Push,
    label: "Push branch",
    description: "Push the branch; you open the PR yourself.",
  },
  {
    value: EShipBehavior.Merge,
    label: "Merge when green",
    description: "Open a PR and squash-merge it once required checks pass.",
  },
];

export interface SandboxSize {
  id: string;
  vcpus: number;
  memoryGb: number;
  diskGb: number;
  pricePerHour: string;
  unavailableReason?: string;
}

export const SANDBOX_SIZES: readonly SandboxSize[] = [
  { id: "s1.small", vcpus: 1, memoryGb: 2, diskGb: 16, pricePerHour: "$0.06" },
  { id: "s1.medium", vcpus: 2, memoryGb: 4, diskGb: 32, pricePerHour: "$0.12" },
  { id: "s1.large", vcpus: 4, memoryGb: 8, diskGb: 64, pricePerHour: "$0.24" },
  {
    id: "s1.xlarge",
    vcpus: 8,
    memoryGb: 16,
    diskGb: 128,
    pricePerHour: "$0.48",
    unavailableReason: "Above this workspace's limit",
  },
];

export const DEFAULT_SANDBOX_SIZE = "s1.medium";

export const SETUP_SCRIPT = `bun install --frozen-lockfile
bun run --filter @dltech/atlas-ui generate
bunx turbo run typecheck --filter @dltech/atlas-core`;

export interface RepoFileStatus {
  path: string;
  description: string;
  present: boolean;
}

export const REPO_FILES: readonly RepoFileStatus[] = [
  {
    path: ".atlas/container.json",
    description: "Image, setup and start commands, env, and mounts for the sandbox.",
    present: true,
  },
  {
    path: ".devcontainer/devcontainer.json",
    description: "Read for image and postCreateCommand when container.json is absent.",
    present: false,
  },
];

export interface SandboxSnapshot {
  id: string;
  size: string;
  cachedFor: string;
  isProjectDefault: boolean;
}

export const SNAPSHOTS: readonly SandboxSnapshot[] = [
  { id: "snap_01", size: "s1.medium", cachedFor: "Cached 6h ago", isProjectDefault: true },
  { id: "snap_02", size: "s1.large", cachedFor: "Cached 2d ago", isProjectDefault: false },
];

export enum ESecretScope {
  Project = "project",
  Workspace = "workspace",
}

export interface SecretRow {
  name: string;
  value: string;
  scope: ESecretScope;
  updated: string;
  overridesWorkspace?: boolean;
}

export const SECRETS: readonly SecretRow[] = [
  {
    name: "ANTHROPIC_API_KEY",
    value: "sk-ant-api03-q8Zr2mVd7Lk0aPp4xT9e",
    scope: ESecretScope.Project,
    updated: "2h ago",
    overridesWorkspace: true,
  },
  {
    name: "DATABASE_URL",
    value: "postgres://atlas:hunter2@ep-calm-sun.neon.tech/atlas",
    scope: ESecretScope.Project,
    updated: "3d ago",
  },
  {
    name: "VERCEL_TOKEN",
    value: "vcl_6Yb2TnQe1sKx90",
    scope: ESecretScope.Project,
    updated: "1w ago",
  },
  {
    name: "GITHUB_TOKEN",
    value: "ghp_R4nd0mT0k3nV4lu3",
    scope: ESecretScope.Workspace,
    updated: "2w ago",
  },
  {
    name: "NODE_ENV",
    value: "development",
    scope: ESecretScope.Workspace,
    updated: "1mo ago",
  },
];

export const BULK_ADD_SAMPLE = `OPENAI_API_KEY=sk-proj-9fK2
POSTHOG_KEY=phc_live_41b0
# staging only
SENTRY_DSN=https://4c1@o12.ingest.sentry.io/77
not a pair`;

export enum EMcpTransport {
  Stdio = "stdio",
  Http = "http",
}

export enum EMcpStatus {
  Connected = "connected",
  NeedsAuth = "needs-auth",
  Failed = "failed",
}

export interface McpServer {
  id: string;
  transport: EMcpTransport;
  target: string;
  status: EMcpStatus;
  detail: string;
  enabled: boolean;
}

export const MCP_SERVERS: readonly McpServer[] = [
  {
    id: "playwright",
    transport: EMcpTransport.Stdio,
    target: "bunx @playwright/mcp@latest --headless",
    status: EMcpStatus.Connected,
    detail: "21 tools",
    enabled: true,
  },
  {
    id: "posthog",
    transport: EMcpTransport.Http,
    target: "https://mcp.posthog.com/mcp",
    status: EMcpStatus.Connected,
    detail: "38 tools",
    enabled: true,
  },
  {
    id: "linear",
    transport: EMcpTransport.Http,
    target: "https://mcp.linear.app/mcp",
    status: EMcpStatus.NeedsAuth,
    detail: "Sign-in required",
    enabled: true,
  },
  {
    id: "postgres",
    transport: EMcpTransport.Stdio,
    target: "bunx @modelcontextprotocol/server-postgres $DATABASE_URL",
    status: EMcpStatus.Failed,
    detail: "Exited with code 1",
    enabled: false,
  },
];

export interface SuggestedMcpServer {
  id: string;
  name: string;
  brand?: EBrand;
}

export const SUGGESTED_MCP_SERVERS: readonly SuggestedMcpServer[] = [
  { id: "sentry", name: "Sentry", brand: EBrand.Sentry },
  { id: "vercel", name: "Vercel", brand: EBrand.Vercel },
  { id: "neon", name: "Neon", brand: EBrand.Neon },
  { id: "stripe", name: "Stripe", brand: EBrand.Stripe },
  { id: "figma", name: "Figma", brand: EBrand.Figma },
  { id: "context7", name: "Context7" },
];
