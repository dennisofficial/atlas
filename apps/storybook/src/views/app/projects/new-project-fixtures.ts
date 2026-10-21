export interface GithubRepo {
  fullName: string;
  updated: string;
  isPrivate: boolean;
  defaultBranch: string;
  branches: string[];
}

export const GITHUB_ACCOUNTS = ["dennisofficial", "compai"];

export const GITHUB_REPOS: GithubRepo[] = [
  {
    fullName: "dennisofficial/atlas",
    updated: "2h ago",
    isPrivate: false,
    defaultBranch: "main",
    branches: ["main", "dennis/new-project-flow", "release"],
  },
  {
    fullName: "dennisofficial/billing-portal",
    updated: "yesterday",
    isPrivate: true,
    defaultBranch: "main",
    branches: ["main", "stripe-webhooks"],
  },
  {
    fullName: "compai/comp-v3",
    updated: "yesterday",
    isPrivate: true,
    defaultBranch: "main",
    branches: ["main", "staging", "release"],
  },
  {
    fullName: "dennisofficial/rs-crm",
    updated: "2d ago",
    isPrivate: true,
    defaultBranch: "master",
    branches: ["master"],
  },
  {
    fullName: "compai/csa",
    updated: "3d ago",
    isPrivate: true,
    defaultBranch: "main",
    branches: ["main", "slack-triage"],
  },
  {
    fullName: "compai/comp-v2",
    updated: "5d ago",
    isPrivate: true,
    defaultBranch: "main",
    branches: ["main", "maintenance"],
  },
  {
    fullName: "dennisofficial/opentui-playground",
    updated: "2w ago",
    isPrivate: false,
    defaultBranch: "main",
    branches: ["main"],
  },
  {
    fullName: "dennisofficial/dotfiles",
    updated: "3w ago",
    isPrivate: false,
    defaultBranch: "main",
    branches: ["main"],
  },
];

export const RECENT_REPO_COUNT = 4;
