import { describe, expect, it } from "bun:test";

import {
  ECommitKind,
  classifyCommitSubject,
  nextReleaseVersion,
} from "../release-bump";
import { formatSemver, parseSemver, type Semver } from "../semver";

const semver = (text: string): Semver => {
  const parsed = parseSemver(text);
  if (parsed === null) throw new Error(`fixture is not a semver: ${text}`);
  return parsed;
};

describe("classifyCommitSubject", () => {
  it("reads a plain feat as a feature", () => {
    expect(classifyCommitSubject("feat: add the thing")).toBe(
      ECommitKind.Feature,
    );
  });

  it("reads a scoped feat as a feature", () => {
    expect(classifyCommitSubject("feat(tui): add the thing")).toBe(
      ECommitKind.Feature,
    );
  });

  it("reads a plain fix as a fix", () => {
    expect(classifyCommitSubject("fix: stop the crash")).toBe(ECommitKind.Fix);
  });

  it("reads a scoped fix as a fix", () => {
    expect(classifyCommitSubject("fix(core): stop the crash")).toBe(
      ECommitKind.Fix,
    );
  });

  it("reads a bang after the type as breaking", () => {
    expect(classifyCommitSubject("feat!: drop the old flag")).toBe(
      ECommitKind.Breaking,
    );
  });

  it("reads a bang after a scope as breaking", () => {
    expect(classifyCommitSubject("fix(scope)!: drop the old flag")).toBe(
      ECommitKind.Breaking,
    );
  });

  it("treats chore, docs, ci, refactor, perf, test, build and style as other", () => {
    for (const type of [
      "chore",
      "docs",
      "ci",
      "refactor",
      "perf",
      "test",
      "build",
      "style",
    ]) {
      expect(classifyCommitSubject(`${type}: tidy something`)).toBe(
        ECommitKind.Other,
      );
    }
  });

  it("treats a non-conventional subject as other", () => {
    expect(
      classifyCommitSubject("Merge pull request #1 from dennis/thing"),
    ).toBe(ECommitKind.Other);
  });
});

describe("nextReleaseVersion", () => {
  it("returns null when there is no current version and nothing release-worthy", () => {
    expect(
      nextReleaseVersion({
        current: null,
        subjects: ["chore: tidy", "docs: fix typo"],
      }),
    ).toBe(null);
  });

  it("returns null when a current version has no release-worthy commits since", () => {
    expect(
      nextReleaseVersion({
        current: semver("1.2.3"),
        subjects: ["ci: bump runner"],
      }),
    ).toBe(null);
  });

  it("returns null for an empty subject list", () => {
    expect(nextReleaseVersion({ current: semver("1.2.3"), subjects: [] })).toBe(
      null,
    );
  });

  it("baselines a first-ever release at 0.1.0 before bumping", () => {
    const next = nextReleaseVersion({
      current: null,
      subjects: ["feat: add the thing"],
    });
    expect(next).not.toBeNull();
    expect(formatSemver(next as Semver)).toBe("0.2.0");
  });

  it("bumps patch for a fix", () => {
    const next = nextReleaseVersion({
      current: semver("0.1.0"),
      subjects: ["fix: stop the crash"],
    });
    expect(formatSemver(next as Semver)).toBe("0.1.1");
  });

  it("bumps minor for a feat", () => {
    const next = nextReleaseVersion({
      current: semver("0.1.0"),
      subjects: ["feat: add the thing"],
    });
    expect(formatSemver(next as Semver)).toBe("0.2.0");
  });

  it("bumps minor for a breaking change while major is 0", () => {
    const next = nextReleaseVersion({
      current: semver("0.5.0"),
      subjects: ["feat!: drop the old flag"],
    });
    expect(formatSemver(next as Semver)).toBe("0.6.0");
  });

  it("bumps major for a breaking change once major is nonzero", () => {
    const next = nextReleaseVersion({
      current: semver("1.2.3"),
      subjects: ["feat!: drop the old flag"],
    });
    expect(formatSemver(next as Semver)).toBe("2.0.0");
  });

  it("takes the highest bump among several commits", () => {
    const next = nextReleaseVersion({
      current: semver("1.0.0"),
      subjects: ["fix: small thing", "chore: tidy", "feat: bigger thing"],
    });
    expect(formatSemver(next as Semver)).toBe("1.1.0");
  });

  it("resets the lower parts on every bump", () => {
    const next = nextReleaseVersion({
      current: semver("1.2.3"),
      subjects: ["feat: add the thing"],
    });
    expect(formatSemver(next as Semver)).toBe("1.3.0");
  });
});
