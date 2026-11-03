/**
 * The tools that map one-to-one onto a harness feature worth counting. Everything else (read,
 * bash, edit, …) is too high-frequency to say anything per call — per-turn counts already carry it.
 */
const FEATURE_TOOLS: Readonly<Record<string, string>> = {
  enter_worktree: 'worktree-enter',
  exit_worktree: 'worktree-exit',
  execution_location: 'container-move',
  skill: 'skill-load',
}

export function featureForTool(name: string): string | undefined {
  return FEATURE_TOOLS[name]
}
