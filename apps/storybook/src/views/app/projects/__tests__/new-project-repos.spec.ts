import { describe, expect, it } from "bun:test";

import {
  BAD_REPO_INPUT_MESSAGE,
  ERepoInputKind,
  parseRepoInput,
  repoChoices,
  repoInputError,
} from "../new-project-repos";

describe("parseRepoInput", () => {
  it("is empty for blank input", () => {
    expect(parseRepoInput("   ").kind).toBe(ERepoInputKind.Empty);
  });

  it.each([
    ["owner/name", "owner/name"],
    ["https://github.com/vercel/ai", "vercel/ai"],
    ["https://github.com/vercel/ai.git", "vercel/ai"],
    ["github.com/vercel/ai/tree/main", "vercel/ai"],
    ["git@github.com:vercel/ai.git", "vercel/ai"],
  ])("accepts %s", (raw, repo) => {
    expect(parseRepoInput(raw)).toEqual({ kind: ERepoInputKind.Valid, repo });
  });

  it.each(["gitlab.com/acme/widgets", "https://bitbucket.org/a/b", "just-a-word", "a/b/c d", "owner/.."])(
    "rejects %s",
    (raw) => {
      expect(parseRepoInput(raw).kind).toBe(ERepoInputKind.Invalid);
    },
  );
});

describe("repoChoices", () => {
  it("filters known repositories by substring", () => {
    expect(repoChoices({ query: "comp-v", excluded: [] })).toEqual(["compai/comp-v3", "compai/comp-v2"]);
  });

  it("offers a pasted repository that is not in the list", () => {
    expect(repoChoices({ query: "https://github.com/vercel/ai", excluded: [] })).toEqual(["vercel/ai"]);
  });

  it("resolves a pasted URL to the known repository without duplicating it", () => {
    expect(repoChoices({ query: "https://github.com/compai/csa", excluded: [] })).toEqual(["compai/csa"]);
  });

  it("omits excluded repositories", () => {
    expect(repoChoices({ query: "csa", excluded: ["compai/csa"] })).toEqual([]);
  });
});

describe("repoInputError", () => {
  it("explains a non-GitHub input that matched nothing", () => {
    expect(repoInputError({ query: "gitlab.com/acme/widgets", choices: [] })).toBe(BAD_REPO_INPUT_MESSAGE);
  });

  it("stays quiet when there are matches or no input", () => {
    expect(repoInputError({ query: "csa", choices: ["compai/csa"] })).toBeNull();
    expect(repoInputError({ query: "", choices: [] })).toBeNull();
  });
});
