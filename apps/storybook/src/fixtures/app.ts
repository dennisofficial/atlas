export const SESSION_THREAD_ID = "thr-ui-rebase";

export enum EThreadStatus {
  Running = "running",
  Idle = "idle",
  AwaitingApproval = "awaiting-approval",
  PrOpen = "pr-open",
  PrMerged = "pr-merged",
}

export enum ECiStatus {
  Passing = "passing",
  Failing = "failing",
}

export interface AppUser {
  name: string;
  initials: string;
  email: string;
}

export interface AppWorkspace {
  name: string;
  owner: string;
  initials: string;
}

export interface AppProject {
  id: string;
  owner: string;
  name: string;
}

export interface AppThread {
  id: string;
  projectId: string;
  title: string;
  status: EThreadStatus;
  created: string;
  updated: string;
  added: number;
  removed: number;
  changed: number;
  model: string;
}

export interface ProjectCommit {
  sha: string;
  subject: string;
  authors: string[];
  verified: boolean;
  ci: ECiStatus;
  age: string;
}

export interface ThreadBuckets {
  inactive: number;
  archived: number;
}

export const USER: AppUser = {
  name: "Dennis Lysenko",
  initials: "DL",
  email: "dennis@dltech.dev",
};

export const WORKSPACE: AppWorkspace = {
  name: "Comp AI",
  owner: "compai",
  initials: "C",
};

export const PERSONAL_OWNER = "dennisofficial";

export const PROJECTS: AppProject[] = [
  { id: "atlas", owner: "dennisofficial", name: "atlas" },
  { id: "rs-crm", owner: "dennisofficial", name: "rs-crm" },
  { id: "comp-v2", owner: "compai", name: "comp-v2" },
  { id: "comp-v3", owner: "compai", name: "comp-v3" },
  { id: "csa", owner: "compai", name: "csa" },
];

const OPUS_HIGH = "Claude Opus · High";
const SONNET_MEDIUM = "Claude Sonnet · Medium";
const GPT_HIGH = "GPT-5 Codex · High";

export const THREADS: AppThread[] = [
  {
    id: SESSION_THREAD_ID,
    projectId: "atlas",
    title: "Rebase ui on shadcn base-nova",
    status: EThreadStatus.Running,
    created: "33m ago",
    updated: "just now",
    added: 2200,
    removed: 6,
    changed: 3,
    model: OPUS_HIGH,
  },
  {
    id: "thr-snapshots",
    projectId: "atlas",
    title: "Wire sandbox snapshots into project settings",
    status: EThreadStatus.PrOpen,
    created: "8h ago",
    updated: "2h ago",
    added: 2200,
    removed: 6,
    changed: 3,
    model: OPUS_HIGH,
  },
  {
    id: "thr-wire-zod",
    projectId: "atlas",
    title: "Migrate wire schemas to zod 4",
    status: EThreadStatus.AwaitingApproval,
    created: "5h ago",
    updated: "12m ago",
    added: 412,
    removed: 198,
    changed: 9,
    model: GPT_HIGH,
  },
  {
    id: "thr-device-auth",
    projectId: "atlas",
    title: "Device auth flow for web sign-in",
    status: EThreadStatus.PrMerged,
    created: "2d ago",
    updated: "1d ago",
    added: 860,
    removed: 41,
    changed: 14,
    model: OPUS_HIGH,
  },
  {
    id: "thr-tui-perf",
    projectId: "atlas",
    title: "Trim OpenTUI repaint cost",
    status: EThreadStatus.Idle,
    created: "3d ago",
    updated: "3d ago",
    added: 96,
    removed: 120,
    changed: 5,
    model: SONNET_MEDIUM,
  },
  {
    id: "thr-ticket-pdf",
    projectId: "rs-crm",
    title: "Service ticket PDF export",
    status: EThreadStatus.Idle,
    created: "1d ago",
    updated: "20h ago",
    added: 540,
    removed: 12,
    changed: 7,
    model: SONNET_MEDIUM,
  },
  {
    id: "thr-qbo-sync",
    projectId: "rs-crm",
    title: "QuickBooks invoice sync",
    status: EThreadStatus.PrOpen,
    created: "6h ago",
    updated: "1h ago",
    added: 1300,
    removed: 87,
    changed: 11,
    model: OPUS_HIGH,
  },
  {
    id: "thr-evidence-retry",
    projectId: "comp-v2",
    title: "Fix evidence upload retries",
    status: EThreadStatus.Running,
    created: "1h ago",
    updated: "just now",
    added: 148,
    removed: 33,
    changed: 4,
    model: OPUS_HIGH,
  },
  {
    id: "thr-prosemirror",
    projectId: "comp-v2",
    title: "Pin the ProseMirror family together",
    status: EThreadStatus.PrMerged,
    created: "4d ago",
    updated: "3d ago",
    added: 24,
    removed: 6,
    changed: 2,
    model: SONNET_MEDIUM,
  },
  {
    id: "thr-org-access",
    projectId: "comp-v3",
    title: "Org access provisioning route",
    status: EThreadStatus.AwaitingApproval,
    created: "3h ago",
    updated: "25m ago",
    added: 330,
    removed: 18,
    changed: 6,
    model: GPT_HIGH,
  },
  {
    id: "thr-slack-ack",
    projectId: "csa",
    title: "ACK every Slack event",
    status: EThreadStatus.Idle,
    created: "2d ago",
    updated: "2d ago",
    added: 58,
    removed: 21,
    changed: 3,
    model: SONNET_MEDIUM,
  },
];

export const BUCKETS: ThreadBuckets = { inactive: 12, archived: 38 };

export const RECENT_COMMITS: ProjectCommit[] = [
  {
    sha: "4292196",
    subject: "refactor(ui): rebase design system on shadcn base-nova",
    authors: ["DL", "AK", "MR"],
    verified: true,
    ci: ECiStatus.Passing,
    age: "3h",
  },
  {
    sha: "9b1c0de",
    subject: "fix(api): reject expired device codes before polling",
    authors: ["DL"],
    verified: true,
    ci: ECiStatus.Failing,
    age: "5h",
  },
  {
    sha: "e7a31f2",
    subject: "feat(web): add the sandbox snapshot picker",
    authors: ["AK", "DL"],
    verified: false,
    ci: ECiStatus.Passing,
    age: "1d",
  },
  {
    sha: "03d5b88",
    subject: "chore(deps): bump storybook to 10.6",
    authors: ["MR"],
    verified: true,
    ci: ECiStatus.Passing,
    age: "2d",
  },
];

export function findProject(projectId: string): AppProject {
  const project = PROJECTS.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Unknown project ${projectId}`);
  return project;
}

export function threadsOf(projectId: string): AppThread[] {
  return THREADS.filter((thread) => thread.projectId === projectId);
}

export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
}
