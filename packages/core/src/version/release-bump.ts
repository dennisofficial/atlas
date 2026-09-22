import type { Semver } from "./semver";

export enum ECommitKind {
  Breaking = "breaking",
  Feature = "feature",
  Fix = "fix",
  Other = "other",
}

const CONVENTIONAL_SUBJECT = /^([a-zA-Z]+)(\([^)]*\))?(!)?:\s*\S/;

export function classifyCommitSubject(subject: string): ECommitKind {
  const match = CONVENTIONAL_SUBJECT.exec(subject);
  if (match === null) return ECommitKind.Other;

  if (match[3] === "!") return ECommitKind.Breaking;

  switch (match[1]?.toLowerCase()) {
    case "feat":
      return ECommitKind.Feature;
    case "fix":
      return ECommitKind.Fix;
    default:
      return ECommitKind.Other;
  }
}

export const RELEASE_BASELINE: Semver = {
  major: 0,
  minor: 1,
  patch: 0,
  prerelease: null,
};

export function nextReleaseVersion(args: {
  current: Semver | null;
  subjects: readonly string[];
}): Semver | null {
  const base = args.current ?? RELEASE_BASELINE;
  const kinds = new Set(args.subjects.map(classifyCommitSubject));

  if (kinds.has(ECommitKind.Breaking)) {
    return base.major === 0
      ? { major: base.major, minor: base.minor + 1, patch: 0, prerelease: null }
      : { major: base.major + 1, minor: 0, patch: 0, prerelease: null };
  }

  if (kinds.has(ECommitKind.Feature)) {
    return {
      major: base.major,
      minor: base.minor + 1,
      patch: 0,
      prerelease: null,
    };
  }

  if (kinds.has(ECommitKind.Fix)) {
    return {
      major: base.major,
      minor: base.minor,
      patch: base.patch + 1,
      prerelease: null,
    };
  }

  return null;
}
