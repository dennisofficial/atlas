export enum EOwnerKind {
  Personal = "Personal",
  Workspace = "Workspace",
}

export interface ProjectOwner {
  id: string;
  name: string;
  kind: EOwnerKind;
  initials: string;
}

export interface ProjectSummary {
  id: string;
  owner: string;
  name: string;
  description?: string;
  updated: string;
  threads: number;
  members: number;
  activity: number[];
}

export const PROJECT_OWNERS: ProjectOwner[] = [
  { id: "dennisofficial", name: "dennisofficial", kind: EOwnerKind.Personal, initials: "DL" },
  { id: "compai", name: "Comp AI", kind: EOwnerKind.Workspace, initials: "C" },
];

export const PROJECTS: ProjectSummary[] = [
  {
    id: "dennisofficial/atlas",
    owner: "dennisofficial",
    name: "atlas",
    description: "Coding-agent harness: the loop, the TUI, and Atlas Cloud.",
    updated: "Updated today",
    threads: 14,
    members: 3,
    activity: [2, 3, 2, 5, 4, 7, 6, 9, 8, 12, 10, 14, 11, 15],
  },
  {
    id: "dennisofficial/rs-crm",
    owner: "dennisofficial",
    name: "rs-crm",
    description: "Service tickets and billing for Recycling Solution.",
    updated: "Updated 2d ago",
    threads: 6,
    members: 1,
    activity: [0, 1, 0, 2, 3, 1, 4, 2, 0, 1, 3, 5, 2, 1],
  },
  {
    id: "compai/comp-v2",
    owner: "compai",
    name: "comp-v2",
    description: "Compliance automation platform, maintenance branch.",
    updated: "Updated 5d ago",
    threads: 9,
    members: 5,
    activity: [6, 5, 7, 4, 5, 3, 4, 2, 3, 2, 1, 2, 1, 1],
  },
  {
    id: "compai/comp-v3",
    owner: "compai",
    name: "comp-v3",
    updated: "Updated yesterday",
    threads: 23,
    members: 7,
    activity: [3, 4, 6, 5, 8, 9, 7, 11, 10, 13, 12, 16, 14, 18],
  },
  {
    id: "compai/csa",
    owner: "compai",
    name: "csa",
    description: "Customer success agent: onboarding and Slack triage.",
    updated: "Updated 3d ago",
    threads: 4,
    members: 2,
    activity: [1, 0, 2, 1, 3, 2, 2, 4, 3, 2, 5, 3, 4, 3],
  },
];

export function filterProjects(input: {
  projects: ProjectSummary[];
  ownerId: string | null;
  query: string;
}): ProjectSummary[] {
  const needle = input.query.trim().toLowerCase();
  return input.projects.filter((project) => {
    if (input.ownerId && project.owner !== input.ownerId) return false;
    if (!needle) return true;
    const haystack = `${project.owner}/${project.name} ${project.description ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}
