import { formatSemver, nextReleaseVersion } from "@dltech/atlas-core";

import {
  RELEASE_TAG_PREFIX,
  latestRelease,
} from "../src/composition/update-check";

function run(cmd: readonly string[]): string {
  const proc = Bun.spawnSync({ cmd: [...cmd], stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(
      `${cmd.join(" ")} exited ${proc.exitCode}: ${proc.stderr.toString()}`,
    );
  }
  return proc.stdout.toString();
}

function nonEmptyLines(text: string): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function releaseTags(): readonly string[] {
  return nonEmptyLines(run(["git", "tag", "--list", `${RELEASE_TAG_PREFIX}*`]));
}

function subjectsSince(tag: string | null): readonly string[] {
  const range = tag === null ? [] : [`${tag}..HEAD`];
  return nonEmptyLines(run(["git", "log", ...range, "--format=%s"]));
}

const latest = latestRelease({
  tags: releaseTags(),
  prefix: RELEASE_TAG_PREFIX,
});
const subjects = subjectsSince(latest?.tag ?? null);
const next = nextReleaseVersion({ current: latest?.version ?? null, subjects });

if (next === null) {
  console.log("skip=true");
  process.exit(0);
}

console.log(`version=${formatSemver(next)}`);
console.log(`prev_tag=${latest?.tag ?? ""}`);
