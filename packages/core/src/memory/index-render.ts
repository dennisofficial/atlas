export const MAX_INDEX_LINES = 200

const NONE_YET = '(none yet)'

export type MemoryIndexLine = { name: string; description: string }

const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ')

const lineOf = (entry: MemoryIndexLine): string =>
  `- ${oneLine(entry.name)} — ${oneLine(entry.description)}`

const overflowLine = (omitted: number): string =>
  `> ${omitted} more memories are not listed. Consolidate: merge overlapping memories and delete dead ones.`

function sectionOf(args: { heading: string; lines: readonly string[] }): readonly string[] {
  return [args.heading, ...(args.lines.length === 0 ? [NONE_YET] : args.lines)]
}

export function renderMemoryIndex({
  global,
  project,
}: {
  global: readonly MemoryIndexLine[]
  project: { key: string; entries: readonly MemoryIndexLine[] } | null
}): string {
  const total = global.length + (project?.entries.length ?? 0)
  const globalShown = global.slice(0, MAX_INDEX_LINES)
  const projectShown = (project?.entries ?? []).slice(0, MAX_INDEX_LINES - globalShown.length)

  const sections = [sectionOf({ heading: '### Global', lines: globalShown.map(lineOf) })]
  if (project !== null) {
    sections.push(
      sectionOf({ heading: `### Project ${project.key}`, lines: projectShown.map(lineOf) }),
    )
  }

  const omitted = total - globalShown.length - projectShown.length
  const body = sections.map((section) => section.join('\n')).join('\n\n')
  return omitted > 0 ? `${body}\n\n${overflowLine(omitted)}` : body
}
