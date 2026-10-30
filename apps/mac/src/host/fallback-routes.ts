import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const PLACEHOLDER = '_'

interface IPlaceholderFile {
  segments: string[]
  wildcards: number
}

const tables = new Map<string, Promise<IPlaceholderFile[]>>()

function isPlaceholderSegment({ segment, last }: { segment: string; last: boolean }): boolean {
  return segment === PLACEHOLDER || (last && segment.startsWith(`${PLACEHOLDER}.`))
}

function toPlaceholderFile(relative: string): IPlaceholderFile | undefined {
  const segments = relative.split(/[\\/]/)
  if (segments[0] === '_next') return undefined
  const wildcards = segments.filter((segment, index) =>
    isPlaceholderSegment({ segment, last: index === segments.length - 1 }),
  ).length
  return wildcards === 0 ? undefined : { segments, wildcards }
}

async function scan(root: string): Promise<IPlaceholderFile[]> {
  const entries = await readdir(root, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => [])
  const files: IPlaceholderFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const file = toPlaceholderFile(join(entry.parentPath, entry.name).slice(root.length + 1))
    if (file) files.push(file)
  }
  return files.sort((a, b) => a.wildcards - b.wildcards)
}

function segmentMatches({
  pattern,
  actual,
  last,
}: {
  pattern: string
  actual: string
  last: boolean
}): boolean {
  if (pattern === actual) return true
  if (pattern === PLACEHOLDER) return actual !== ''
  if (!last || !pattern.startsWith(`${PLACEHOLDER}.`)) return false
  const extension = pattern.slice(PLACEHOLDER.length)
  return actual.length > extension.length && actual.endsWith(extension)
}

function fileMatches({ file, lookup }: { file: IPlaceholderFile; lookup: string[] }): boolean {
  if (file.segments.length !== lookup.length) return false
  return file.segments.every((pattern, index) =>
    segmentMatches({
      pattern,
      actual: lookup[index] ?? '',
      last: index === lookup.length - 1,
    }),
  )
}

export function placeholderFilesFor(root: string): Promise<IPlaceholderFile[]> {
  const cached = tables.get(root)
  if (cached) return cached
  const created = scan(root)
  tables.set(root, created)
  return created
}

export async function placeholderLookup({
  root,
  segments,
}: {
  root: string
  segments: string[]
}): Promise<string[] | undefined> {
  if (segments.length === 0) return undefined
  const files = await placeholderFilesFor(root)
  const last = segments[segments.length - 1] ?? ''
  const lookups = [
    segments,
    [...segments.slice(0, -1), `${last}.html`],
    [...segments, 'index.html'],
  ]
  for (const lookup of lookups) {
    const match = files.find((file) => fileMatches({ file, lookup }))
    if (match) return match.segments
  }
  return undefined
}
