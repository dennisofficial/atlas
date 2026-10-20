import type { PublishedBundleSummary } from '@dltech/atlas-wire'

export const PUSH_USAGE: readonly string[] = [
  'atlas push [--yes] [--all]',
  '    publishes your skills, the global ATLAS.md and ~/.atlas/mcp.json to Atlas Cloud, so every',
  '    cloud session starts with them. Sign in to Atlas Cloud first.',
  '',
  '    Re-running only asks about what is new or changed since the last push; your earlier',
  '    choices carry over.',
  '',
  '    --yes   skip the picker and publish the planned selection (new items on, last choices kept).',
  '    --all   open the picker on every item, even when nothing changed, to revise the selection.',
]

const KILOBYTE = 1_000
const MEGABYTE = 1_000_000

export function formatSize(bytes: number): string {
  if (bytes < KILOBYTE) return `${bytes} B`
  if (bytes < MEGABYTE) return `${(bytes / KILOBYTE).toFixed(1)} KB`
  return `${(bytes / MEGABYTE).toFixed(1)} MB`
}

export function publishedLine(summary: PublishedBundleSummary): string {
  const { skills, instructions, mcp } = summary.manifest
  const parts = [
    ...(skills.length === 0 ? [] : [`${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`]),
    ...(instructions.length === 0 ? [] : ['ATLAS.md']),
    ...(mcp ? ['mcp.json'] : []),
  ]
  return `published version ${summary.version} — ${parts.join(', ')} (${formatSize(summary.sizeBytes)})`
}
