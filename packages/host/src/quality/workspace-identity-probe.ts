import type { ProcessPort, ThreadId } from '@dltech/atlas-core'
import { WorkspaceIdentityDeadlineError } from '@dltech/atlas-quality'

export enum EProbeScope {
  Layout = 'layout',
  Refs = 'refs',
}

export enum EProbeSection {
  Paths = 'paths',
  Worktrees = 'worktrees',
  WorktreeConfig = 'worktree-config',
  Origin = 'origin',
  Branch = 'branch',
  Roots = 'roots',
}

export type GitOutput = { exitCode: number; stdout: string }

export type ProbeSections = ReadonlyMap<string, GitOutput>

const SECTION_START = '\x1e'
const EXIT_CODE_START = '\x1f'

const PROBE_SCRIPT = [
  'section() { name=$1; shift; printf "\\036%s\\n" "$name"; git "$@" 2>/dev/null; printf "\\037%s\\n" "$?"; }',
  `if [ "$1" = ${EProbeScope.Layout} ]; then`,
  `  section ${EProbeSection.Paths} rev-parse --show-toplevel --path-format=absolute --git-common-dir --is-shallow-repository`,
  `  section ${EProbeSection.Worktrees} worktree list --porcelain -z`,
  `  section ${EProbeSection.WorktreeConfig} config --get core.worktree`,
  `  section ${EProbeSection.Roots} rev-list --max-parents=0 HEAD`,
  'fi',
  `section ${EProbeSection.Origin} config --get remote.origin.url`,
  `section ${EProbeSection.Branch} symbolic-ref --short -q HEAD`,
].join('\n')

export const probeCommand = (scope: EProbeScope): readonly string[] => [
  'sh',
  '-c',
  PROBE_SCRIPT,
  'sh',
  scope,
]

export function sectionsOf(text: string): ProbeSections {
  const sections = new Map<string, GitOutput>()
  for (const chunk of text.split(SECTION_START).slice(1)) {
    const nameEnd = chunk.indexOf('\n')
    const exitCodeStart = chunk.lastIndexOf(EXIT_CODE_START)
    if (nameEnd < 0 || exitCodeStart < nameEnd) continue
    const exitCode = Number.parseInt(chunk.slice(exitCodeStart + 1), 10)
    if (Number.isNaN(exitCode)) continue
    sections.set(chunk.slice(0, nameEnd), {
      exitCode,
      stdout: chunk.slice(nameEnd + 1, exitCodeStart),
    })
  }
  return sections
}

export function requiredSection(args: { sections: ProbeSections; name: EProbeSection }): GitOutput {
  const output = args.sections.get(args.name)
  if (output === undefined) throw new Error(`the git probe returned no ${args.name} section`)
  return output
}

const discard = (stream: ReadableStream<Uint8Array>): Promise<void> =>
  new Response(stream).text().then(() => undefined)

export async function runProbe(args: {
  process: ProcessPort
  cwd: string
  threadId: ThreadId
  timeoutMs: number
  scope: EProbeScope
}): Promise<ProbeSections> {
  const handle = args.process.spawn({
    cmd: [...probeCommand(args.scope)],
    cwd: args.cwd,
    threadId: args.threadId,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        handle.terminate()
      } catch {}
      reject(new WorkspaceIdentityDeadlineError(args.timeoutMs))
    }, args.timeoutMs)
  })
  expired.catch(() => undefined)
  const collected = Promise.all([
    new Response(handle.stdout).text(),
    handle.exited,
    discard(handle.stderr),
  ])
  collected.catch(() => undefined)
  try {
    const [stdout] = await Promise.race([collected, expired])
    return sectionsOf(stdout)
  } finally {
    clearTimeout(timer)
  }
}
