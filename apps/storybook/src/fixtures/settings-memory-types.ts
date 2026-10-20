export enum EMemoryType {
  User = "user",
  Feedback = "feedback",
  Project = "project",
  Reference = "reference",
}

export enum EMemoryStoreKind {
  Global = "global",
  Project = "project",
}

export type MemoryEntry = {
  id: string;
  file: string;
  name: string;
  description: string;
  type: EMemoryType;
  recorded: string;
  body: string;
};

export type MemoryStore = {
  id: string;
  kind: EMemoryStoreKind;
  label: string;
  path: string;
  indexLines: number;
  indexBytes: number;
  memories: MemoryEntry[];
};

export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = 25_000;
export const MEMORY_RECONCILE_THRESHOLD = 0.8;

export const MEMORY_TYPE_LABELS: Record<EMemoryType, string> = {
  [EMemoryType.User]: "User",
  [EMemoryType.Feedback]: "Feedback",
  [EMemoryType.Project]: "Project",
  [EMemoryType.Reference]: "Reference",
};

export const MEMORY_TYPE_OPTIONS = Object.values(EMemoryType).map((type) => ({
  value: type,
  label: MEMORY_TYPE_LABELS[type],
}));

export const MEMORY_GLOBAL_STORE_ID = "global";
export const MEMORY_RS_CRM_STORE_ID = "rs-crm";
