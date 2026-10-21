import { describe, expect, it } from "bun:test";

import {
  canContinueFromRepository,
  emptyDraft,
  ENameError,
  nameErrorOf,
  nextStep,
  previousStep,
  projectFromDraft,
  repoOf,
  stepPosition,
  suggestedName,
  visibleNameError,
} from "../new-project-draft";
import { ENewProjectStep, EProjectSource } from "../new-project-types";
import { PROJECTS } from "../projects.fixtures";

const EXISTING = { ...emptyDraft("compai"), repo: "compai/csa" };

describe("nameErrorOf", () => {
  it("flags an empty name", () => {
    expect(nameErrorOf({ name: "  ", ownerId: "compai", projects: PROJECTS })).toBe(ENameError.Empty);
  });

  it("flags a name over the API limit", () => {
    const name = "x".repeat(101);
    expect(nameErrorOf({ name, ownerId: "compai", projects: PROJECTS })).toBe(ENameError.TooLong);
  });

  it("flags a duplicate under the same owner, ignoring case", () => {
    expect(nameErrorOf({ name: "COMP-V3", ownerId: "compai", projects: PROJECTS })).toBe(ENameError.Duplicate);
  });

  it("allows the same name under a different owner", () => {
    expect(nameErrorOf({ name: "comp-v3", ownerId: "dennisofficial", projects: PROJECTS })).toBeNull();
  });
});

describe("visibleNameError", () => {
  it("hides the empty error until the field is touched", () => {
    expect(visibleNameError({ error: ENameError.Empty, touched: false })).toBeNull();
    expect(visibleNameError({ error: ENameError.Empty, touched: true })).toBe(ENameError.Empty);
  });

  it("always shows other errors", () => {
    expect(visibleNameError({ error: ENameError.Duplicate, touched: false })).toBe(ENameError.Duplicate);
  });
});

describe("repoOf and suggestedName", () => {
  it("is null with no repository", () => {
    const draft = { ...EXISTING, source: EProjectSource.NoRepo };
    expect(repoOf(draft)).toBeNull();
    expect(suggestedName(draft)).toBe("");
  });

  it("uses the picked repository", () => {
    expect(repoOf(EXISTING)).toBe("compai/csa");
    expect(suggestedName(EXISTING)).toBe("csa");
  });

  it("composes the new repository from owner and name", () => {
    const draft = { ...emptyDraft(null), source: EProjectSource.NewRepo, newRepoName: " bot " };
    expect(repoOf(draft)).toBe("dennisofficial/bot");
  });
});

describe("canContinueFromRepository", () => {
  it("requires a GitHub connection", () => {
    expect(canContinueFromRepository({ draft: EXISTING, connected: false })).toBe(false);
  });

  it("requires a picked repository", () => {
    expect(canContinueFromRepository({ draft: emptyDraft(null), connected: true })).toBe(false);
    expect(canContinueFromRepository({ draft: EXISTING, connected: true })).toBe(true);
  });

  it("rejects a new repository name that already exists", () => {
    const draft = { ...emptyDraft(null), source: EProjectSource.NewRepo, newRepoName: "atlas" };
    expect(canContinueFromRepository({ draft, connected: true })).toBe(false);
  });

  it("accepts a fresh new repository name", () => {
    const draft = { ...emptyDraft(null), source: EProjectSource.NewRepo, newRepoName: "support-bot" };
    expect(canContinueFromRepository({ draft, connected: true })).toBe(true);
  });
});

describe("step navigation", () => {
  it("skips the repository step when there is no repository", () => {
    expect(nextStep({ step: ENewProjectStep.Source, source: EProjectSource.NoRepo })).toBe(ENewProjectStep.Details);
    expect(previousStep({ step: ENewProjectStep.Details, source: EProjectSource.NoRepo })).toBe(
      ENewProjectStep.Source,
    );
    expect(stepPosition({ step: ENewProjectStep.Details, source: EProjectSource.NoRepo })).toEqual({
      current: 2,
      total: 2,
    });
  });

  it("walks all three steps for a repository source", () => {
    expect(nextStep({ step: ENewProjectStep.Source, source: EProjectSource.Existing })).toBe(
      ENewProjectStep.Repository,
    );
    expect(nextStep({ step: ENewProjectStep.Repository, source: EProjectSource.Existing })).toBe(
      ENewProjectStep.Details,
    );
    expect(previousStep({ step: ENewProjectStep.Details, source: EProjectSource.Existing })).toBe(
      ENewProjectStep.Repository,
    );
    expect(stepPosition({ step: ENewProjectStep.Details, source: EProjectSource.Existing })).toEqual({
      current: 3,
      total: 3,
    });
  });
});

describe("projectFromDraft", () => {
  it("builds a fresh row from the trimmed name and description", () => {
    const draft = { ...EXISTING, description: "  Slack triage  " };
    const project = projectFromDraft({ draft, name: " csa-2 " });
    expect(project.id).toBe("compai/csa-2");
    expect(project.description).toBe("Slack triage");
    expect(project.threads).toBe(0);
    expect(project.activity).toHaveLength(14);
  });

  it("drops a blank description", () => {
    expect(projectFromDraft({ draft: EXISTING, name: "x" }).description).toBeUndefined();
  });
});
