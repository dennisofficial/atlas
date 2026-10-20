export enum EWorkspaceRole {
  Owner = "owner",
  Admin = "admin",
  Member = "member",
}

export type SelectOption = { value: string; label: string };

export type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: EWorkspaceRole;
  joined: string;
  lastActive: string;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: EWorkspaceRole;
  invitedBy: string;
  expiresInDays: number;
};

export const ROLE_LABELS: Record<EWorkspaceRole, string> = {
  [EWorkspaceRole.Owner]: "Owner",
  [EWorkspaceRole.Admin]: "Admin",
  [EWorkspaceRole.Member]: "Member",
};

export const ASSIGNABLE_ROLES: EWorkspaceRole[] = [EWorkspaceRole.Admin, EWorkspaceRole.Member];

export const ASSIGNABLE_ROLE_OPTIONS: SelectOption[] = ASSIGNABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export function parseRole(value: string | null): EWorkspaceRole | null {
  return Object.values(EWorkspaceRole).find((role) => role === value) ?? null;
}

export const REGION_OPTIONS: SelectOption[] = [
  { value: "iad1", label: "iad1 · Washington, D.C." },
  { value: "sfo1", label: "sfo1 · San Francisco" },
  { value: "fra1", label: "fra1 · Frankfurt" },
];

export const DEFAULT_MODEL_OPTIONS: SelectOption[] = [
  { value: "claude-sonnet", label: "Claude Sonnet" },
  { value: "claude-opus", label: "Claude Opus" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5-mini", label: "GPT-5 mini" },
];

export const WORKSPACE_DETAILS = {
  id: "ws_01J9K4M2QZ7T5V8R3N6B0CXEYD",
  createdAt: "Mar 4, 2026",
  ownerName: "Dennis Lysenko",
  ownerInitials: "DL",
};

export const WORKSPACE_GENERAL_DEFAULTS = {
  hasLogo: true,
  name: "DL Tech",
  slug: "dltech",
  region: "iad1",
  model: "claude-sonnet",
};

export const WORKSPACE_MEMBERS: WorkspaceMember[] = [
  {
    id: "mem_dennis",
    name: "Dennis Lysenko",
    email: "dennis@dltech.dev",
    initials: "DL",
    role: EWorkspaceRole.Owner,
    joined: "Mar 4, 2026",
    lastActive: "Just now",
  },
  {
    id: "mem_maya",
    name: "Maya Okafor",
    email: "maya@dltech.dev",
    initials: "MO",
    role: EWorkspaceRole.Admin,
    joined: "Mar 11, 2026",
    lastActive: "12m ago",
  },
  {
    id: "mem_tomas",
    name: "Tomás Rivera",
    email: "tomas@dltech.dev",
    initials: "TR",
    role: EWorkspaceRole.Member,
    joined: "Apr 2, 2026",
    lastActive: "1h ago",
  },
  {
    id: "mem_priya",
    name: "Priya Nair",
    email: "priya@dltech.dev",
    initials: "PN",
    role: EWorkspaceRole.Member,
    joined: "Apr 19, 2026",
    lastActive: "3h ago",
  },
  {
    id: "mem_jonas",
    name: "Jonas Weber",
    email: "jonas@dltech.dev",
    initials: "JW",
    role: EWorkspaceRole.Member,
    joined: "Jun 8, 2026",
    lastActive: "Yesterday",
  },
  {
    id: "mem_chloe",
    name: "Chloe Martin",
    email: "chloe@dltech.dev",
    initials: "CM",
    role: EWorkspaceRole.Member,
    joined: "Aug 27, 2026",
    lastActive: "5d ago",
  },
];

export const PENDING_INVITES: PendingInvite[] = [
  {
    id: "inv_sam",
    email: "sam@dltech.dev",
    role: EWorkspaceRole.Member,
    invitedBy: "Dennis Lysenko",
    expiresInDays: 6,
  },
  {
    id: "inv_ana",
    email: "ana.costa@contractor.io",
    role: EWorkspaceRole.Member,
    invitedBy: "Maya Okafor",
    expiresInDays: 6,
  },
  {
    id: "inv_leo",
    email: "leo@dltech.dev",
    role: EWorkspaceRole.Admin,
    invitedBy: "Dennis Lysenko",
    expiresInDays: 3,
  },
];
