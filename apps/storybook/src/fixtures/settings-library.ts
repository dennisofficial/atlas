export enum ESecretKind {
  Secret = "secret",
  EnvVar = "env",
}

export enum ELibraryScope {
  Personal = "personal",
  Workspace = "workspace",
}

export type LibraryMember = {
  name: string;
  initials: string;
};

export type LibrarySecret = {
  id: string;
  key: string;
  kind: ESecretKind;
  value: string;
  updated: string;
  addedBy: LibraryMember;
};

const DENNIS: LibraryMember = { name: "Dennis Lysenko", initials: "DL" };
const MAYA: LibraryMember = { name: "Maya Chen", initials: "MC" };
const TOMAS: LibraryMember = { name: "Tomás Rivera", initials: "TR" };
const PRIYA: LibraryMember = { name: "Priya Nair", initials: "PN" };

export const PERSONAL_SECRETS: LibrarySecret[] = [
  { id: "p1", key: "ANTHROPIC_API_KEY", kind: ESecretKind.Secret, value: "sk-ant-api03-w8Kq", updated: "3d ago", addedBy: DENNIS },
  { id: "p2", key: "OPENAI_API_KEY", kind: ESecretKind.Secret, value: "sk-proj-m4Rz", updated: "3d ago", addedBy: DENNIS },
  { id: "p3", key: "VERCEL_TOKEN", kind: ESecretKind.Secret, value: "vcp_9fT2xLq", updated: "2w ago", addedBy: DENNIS },
  { id: "p4", key: "NPM_TOKEN", kind: ESecretKind.Secret, value: "npm_hd7Q1vB", updated: "6w ago", addedBy: DENNIS },
  { id: "p5", key: "ATLAS_LOG_LEVEL", kind: ESecretKind.EnvVar, value: "debug", updated: "1d ago", addedBy: DENNIS },
  { id: "p6", key: "NODE_ENV", kind: ESecretKind.EnvVar, value: "development", updated: "5w ago", addedBy: DENNIS },
];

export const WORKSPACE_SECRETS: LibrarySecret[] = [
  { id: "w1", key: "DATABASE_URL", kind: ESecretKind.Secret, value: "postgres://rs_app:x9@db.dltech.dev/rs", updated: "4d ago", addedBy: DENNIS },
  { id: "w2", key: "SENTRY_AUTH_TOKEN", kind: ESecretKind.Secret, value: "sntrys_eyJp", updated: "1w ago", addedBy: MAYA },
  { id: "w3", key: "LINEAR_API_KEY", kind: ESecretKind.Secret, value: "lin_api_Qe3", updated: "2w ago", addedBy: TOMAS },
  { id: "w4", key: "STRIPE_TEST_KEY", kind: ESecretKind.Secret, value: "sk_test_51Nq", updated: "3w ago", addedBy: PRIYA },
  { id: "w5", key: "VERCEL_TEAM_ID", kind: ESecretKind.EnvVar, value: "team_dltech", updated: "8w ago", addedBy: DENNIS },
  { id: "w6", key: "ATLAS_DEFAULT_REGION", kind: ESecretKind.EnvVar, value: "iad1", updated: "8w ago", addedBy: MAYA },
];
