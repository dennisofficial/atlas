import { GITHUB_REPOS, type GithubRepo } from "./new-project-fixtures";

export enum ERepoInputKind {
  Empty = "Empty",
  Valid = "Valid",
  Invalid = "Invalid",
}

export type RepoInput =
  | { kind: ERepoInputKind.Empty }
  | { kind: ERepoInputKind.Valid; repo: string }
  | { kind: ERepoInputKind.Invalid };

const GITHUB_REPO_PATTERN = /^[A-Za-z0-9-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/;
const GITHUB_PREFIX = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|git@github\.com:)/i;
const FOREIGN_HOST = /^(?:[a-z][a-z0-9+.-]*:\/\/|git@|[^/]*\.[a-z]{2,}\/)/i;

export const BAD_REPO_INPUT_MESSAGE =
  "That is not a GitHub repository. Paste a github.com URL or owner/name.";

export function parseRepoInput(raw: string): RepoInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: ERepoInputKind.Empty };
  const prefix = GITHUB_PREFIX.exec(trimmed);
  if (!prefix && FOREIGN_HOST.test(trimmed)) return { kind: ERepoInputKind.Invalid };
  const parts = trimmed.slice(prefix ? prefix[0].length : 0).split("/");
  if (!prefix && parts.length !== 2) return { kind: ERepoInputKind.Invalid };
  const [owner, name] = parts;
  if (!owner || !name) return { kind: ERepoInputKind.Invalid };
  const candidate = `${owner}/${name.replace(/\.git$/i, "")}`;
  if (!GITHUB_REPO_PATTERN.test(candidate)) return { kind: ERepoInputKind.Invalid };
  return { kind: ERepoInputKind.Valid, repo: candidate };
}

export function findGithubRepo(fullName: string): GithubRepo | undefined {
  return GITHUB_REPOS.find((repo) => repo.fullName.toLowerCase() === fullName.toLowerCase());
}

export function repoChoices({ query, excluded }: { query: string; excluded: string[] }): string[] {
  const parsed = parseRepoInput(query);
  const needle = (parsed.kind === ERepoInputKind.Valid ? parsed.repo : query).trim().toLowerCase();
  const known = GITHUB_REPOS.map((repo) => repo.fullName).filter(
    (name) => !excluded.includes(name) && name.toLowerCase().includes(needle),
  );
  if (parsed.kind !== ERepoInputKind.Valid) return known;
  if (excluded.includes(parsed.repo) || findGithubRepo(parsed.repo)) return known;
  return [...known, parsed.repo];
}

export function repoInputError({ query, choices }: { query: string; choices: string[] }): string | null {
  if (choices.length > 0) return null;
  return parseRepoInput(query).kind === ERepoInputKind.Invalid ? BAD_REPO_INPUT_MESSAGE : null;
}

export function branchChoices(repo: string): string[] {
  return findGithubRepo(repo)?.branches ?? [];
}

export function defaultBranchOf(repo: string): string | null {
  return findGithubRepo(repo)?.defaultBranch ?? null;
}
