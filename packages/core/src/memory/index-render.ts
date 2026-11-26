export const MAX_INDEX_LINES = 250

const NONE_YET = '(none yet)'

export type MemoryIndexLine = { name: string; description: string }

export type IndexShares = { global: number; group: number; project: number }

const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ')

const lineOf = (entry: MemoryIndexLine): string =>
  `- ${oneLine(entry.name)} — ${oneLine(entry.description)}`

const overflowLine = (omitted: number): string =>
  `> ${omitted} more memories are not listed. Consolidate: merge overlapping memories and delete dead ones.`

function sectionOf(args: { heading: string; lines: readonly string[] }): readonly string[] {
  return [args.heading, ...(args.lines.length === 0 ? [NONE_YET] : args.lines)]
}

export function fairIndexShares(args: {
  global: number
  group?: number
  project: number
  cap: number
}): IndexShares {
  const group = args.group ?? 0
  const globalFloor = Math.ceil(args.cap / 2)
  const global = Math.min(args.global, Math.max(globalFloor, args.cap - group - args.project))
  const remaining = Math.max(0, args.cap - global)
  const groupShown = Math.min(group, Math.ceil(remaining / 2))
  return { global, group: groupShown, project: Math.min(args.project, remaining - groupShown) }
}

export function renderMemoryIndex({
  global,
  group = null,
  project,
}: {
  global: readonly MemoryIndexLine[]
  group?: { key: string; entries: readonly MemoryIndexLine[] } | null
  project: { key: string; entries: readonly MemoryIndexLine[] } | null
}): string {
  const groupEntries = group?.entries ?? []
  const projectEntries = project?.entries ?? []
  const shares = fairIndexShares({
    global: global.length,
    group: groupEntries.length,
    project: projectEntries.length,
    cap: MAX_INDEX_LINES,
  })
  const globalShown = global.slice(0, shares.global)
  const groupShown = groupEntries.slice(0, shares.group)
  const projectShown = projectEntries.slice(0, shares.project)

  const sections = [sectionOf({ heading: '### Global', lines: globalShown.map(lineOf) })]
  if (group !== null) {
    sections.push(sectionOf({ heading: `### Group ${group.key}`, lines: groupShown.map(lineOf) }))
  }
  if (project !== null) {
    sections.push(
      sectionOf({ heading: `### Project ${project.key}`, lines: projectShown.map(lineOf) }),
    )
  }

  const omitted =
    global.length +
    groupEntries.length +
    projectEntries.length -
    globalShown.length -
    groupShown.length -
    projectShown.length
  const body = sections.map((section) => section.join('\n')).join('\n\n')
  return omitted > 0 ? `${body}\n\n${overflowLine(omitted)}` : body
}
