import { EOwnerKind, PROJECT_OWNERS, type ProjectSummary } from "./projects.fixtures";
import { GITHUB_ACCOUNTS, GITHUB_REPOS } from "./new-project-fixtures";
import {
  ENewProjectStep,
  EProjectSource,
  MAX_PROJECT_NAME_LENGTH,
  type ProjectDraft,
} from "./new-project-types";

export enum ENameError {
  Empty = "Empty",
  TooLong = "TooLong",
  Duplicate = "Duplicate",
}

export enum ENewRepoError {
  Invalid = "Invalid",
  Taken = "Taken",
}

export const NAME_ERROR_MESSAGES: Record<ENameError, string> = {
  [ENameError.Empty]: "Give the project a name.",
  [ENameError.TooLong]: `Keep the name to ${MAX_PROJECT_NAME_LENGTH} characters or fewer.`,
  [ENameError.Duplicate]: "This owner already has a project with that name.",
};

export const NEW_REPO_ERROR_MESSAGES: Record<ENewRepoError, string> = {
  [ENewRepoError.Invalid]: "Use letters, numbers, dots, dashes and underscores only.",
  [ENewRepoError.Taken]: "A repository with that name already exists on this account.",
};

const WORKSPACE_OWNER_ID = PROJECT_OWNERS.find((owner) => owner.kind === EOwnerKind.Workspace)?.id ?? "";
const REPO_NAME_PATTERN = /^(?!\.+$)[A-Za-z0-9_.-]+$/;

export function emptyDraft(defaultOwnerId: string | null): ProjectDraft {
  return {
    source: EProjectSource.Existing,
    repo: null,
    repoQuery: "",
    branch: null,
    newRepoOwner: GITHUB_ACCOUNTS[0] ?? "",
    newRepoName: "",
    newRepoPrivate: true,
    name: "",
    nameTouched: false,
    ownerId: defaultOwnerId ?? WORKSPACE_OWNER_ID,
    description: "",
    additionalRepos: [],
  };
}

export function repoOf(draft: ProjectDraft): string | null {
  if (draft.source === EProjectSource.NoRepo) return null;
  if (draft.source === EProjectSource.Existing) return draft.repo;
  const name = draft.newRepoName.trim();
  return name ? `${draft.newRepoOwner}/${name}` : null;
}

export function suggestedName(draft: ProjectDraft): string {
  return repoOf(draft)?.split("/")[1] ?? "";
}

export function nameErrorOf({
  name,
  ownerId,
  projects,
}: {
  name: string;
  ownerId: string;
  projects: ProjectSummary[];
}): ENameError | null {
  const trimmed = name.trim();
  if (!trimmed) return ENameError.Empty;
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) return ENameError.TooLong;
  const taken = projects.some(
    (project) => project.owner === ownerId && project.name.toLowerCase() === trimmed.toLowerCase(),
  );
  return taken ? ENameError.Duplicate : null;
}

export function visibleNameError({
  error,
  touched,
}: {
  error: ENameError | null;
  touched: boolean;
}): ENameError | null {
  if (error === ENameError.Empty && !touched) return null;
  return error;
}

export function newRepoErrorOf({ owner, name }: { owner: string; name: string }): ENewRepoError | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (!REPO_NAME_PATTERN.test(trimmed)) return ENewRepoError.Invalid;
  const taken = GITHUB_REPOS.some((repo) => repo.fullName.toLowerCase() === `${owner}/${trimmed}`.toLowerCase());
  return taken ? ENewRepoError.Taken : null;
}

export function canContinueFromRepository({
  draft,
  connected,
}: {
  draft: ProjectDraft;
  connected: boolean;
}): boolean {
  if (!connected) return false;
  if (draft.source === EProjectSource.Existing) return draft.repo !== null;
  const error = newRepoErrorOf({ owner: draft.newRepoOwner, name: draft.newRepoName });
  return draft.newRepoName.trim() !== "" && error === null;
}

export function nextStep({ step, source }: { step: ENewProjectStep; source: EProjectSource }): ENewProjectStep {
  if (step === ENewProjectStep.Source) {
    return source === EProjectSource.NoRepo ? ENewProjectStep.Details : ENewProjectStep.Repository;
  }
  return ENewProjectStep.Details;
}

export function previousStep({ step, source }: { step: ENewProjectStep; source: EProjectSource }): ENewProjectStep {
  if (step === ENewProjectStep.Details && source !== EProjectSource.NoRepo) return ENewProjectStep.Repository;
  return ENewProjectStep.Source;
}

export function stepPosition({
  step,
  source,
}: {
  step: ENewProjectStep;
  source: EProjectSource;
}): { current: number; total: number } {
  const skipsRepository = source === EProjectSource.NoRepo;
  const total = skipsRepository ? 2 : 3;
  if (step === ENewProjectStep.Source) return { current: 1, total };
  if (step === ENewProjectStep.Repository) return { current: 2, total };
  return { current: total, total };
}

export function projectFromDraft({ draft, name }: { draft: ProjectDraft; name: string }): ProjectSummary {
  const trimmed = name.trim();
  const description = draft.description.trim();
  return {
    id: `${draft.ownerId}/${trimmed}`,
    owner: draft.ownerId,
    name: trimmed,
    description: description || undefined,
    updated: "Updated just now",
    threads: 0,
    members: 1,
    activity: Array.from({ length: 14 }, () => 0),
  };
}
