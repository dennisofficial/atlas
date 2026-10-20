import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { ATLAS_MCP_FILE_NAME } from '../settings/paths'
import { skillsTree } from '../user-layer-sync/tree-skills'

export enum EPublishKind {
  Skill = 'skill',
  Instructions = 'instructions',
  Mcp = 'mcp',
}

export type PublishFile = { archiveKey: string; path: string }

export type Publishable = {
  id: string
  kind: EPublishKind
  label: string
  files: readonly PublishFile[]
  bytes: number
  hash: string
}

type Draft = { id: string; kind: EPublishKind; label: string; files: PublishFile[] }

type FileDigest = { size: number; digest: string }

const SKILL_ARCHIVE_PREFIX = 'user-layer/skills/'
const INSTRUCTIONS_NAME = 'ATLAS.md'
const INSTRUCTIONS_ARCHIVE_KEY = 'user-layer/instructions/.atlas/ATLAS.md'
const MCP_ARCHIVE_KEY = '.atlas/mcp.json'
const SKILL_KEY_SEGMENTS = 3
const READ_CONCURRENCY = 32

const sha256Hex = (content: Uint8Array | string): string => createHash('sha256').update(content).digest('hex')

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  )

const byLabel = (left: Draft, right: Draft): number => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0)

async function skillDrafts(args: { atlasHome: string; home: string }): Promise<readonly Draft[]> {
  const scanned = await skillsTree(args).scan()
  const groups = new Map<string, Draft>()
  for (const [key, path] of scanned) {
    const segments = key.split('/')
    if (segments.length < SKILL_KEY_SEGMENTS) continue

    const label = `${segments[0]}/${segments[1]}`
    const draft = groups.get(label) ?? { id: `skill:${label}`, kind: EPublishKind.Skill, label, files: [] }
    draft.files.push({ archiveKey: `${SKILL_ARCHIVE_PREFIX}${key}`, path })
    groups.set(label, draft)
  }
  return [...groups.values()].sort(byLabel)
}

async function singleFileDraft(args: {
  path: string
  archiveKey: string
  id: string
  kind: EPublishKind
  label: string
}): Promise<readonly Draft[]> {
  if (!(await isFile(args.path))) return []
  return [{ id: args.id, kind: args.kind, label: args.label, files: [{ archiveKey: args.archiveKey, path: args.path }] }]
}

async function digestAll(paths: readonly string[]): Promise<ReadonlyMap<string, FileDigest>> {
  const digests = new Map<string, FileDigest>()
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const path = paths[next]
      next += 1
      if (path === undefined) return
      const content = await readFile(path).catch(() => null)
      if (content !== null) digests.set(path, { size: content.byteLength, digest: sha256Hex(content) })
    }
  }
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker))
  return digests
}

function measured(args: { draft: Draft; digests: ReadonlyMap<string, FileDigest> }): Publishable | null {
  const files = args.draft.files
    .filter((file) => args.digests.has(file.path))
    .sort((left, right) => (left.archiveKey < right.archiveKey ? -1 : 1))
  if (files.length === 0) return null

  let bytes = 0
  const hash = createHash('sha256')
  for (const file of files) {
    const known = args.digests.get(file.path)
    if (known === undefined) continue
    bytes += known.size
    hash.update(`${file.archiveKey}\0${known.digest}\n`)
  }
  return { id: args.draft.id, kind: args.draft.kind, label: args.draft.label, files, bytes, hash: hash.digest('hex') }
}

export async function scanPublishables(args: { atlasHome: string; home: string }): Promise<readonly Publishable[]> {
  const drafts = [
    ...(await skillDrafts(args)),
    ...(await singleFileDraft({
      path: join(args.atlasHome, INSTRUCTIONS_NAME),
      archiveKey: INSTRUCTIONS_ARCHIVE_KEY,
      id: `instructions:${INSTRUCTIONS_NAME}`,
      kind: EPublishKind.Instructions,
      label: INSTRUCTIONS_NAME,
    })),
    ...(await singleFileDraft({
      path: join(args.atlasHome, ATLAS_MCP_FILE_NAME),
      archiveKey: MCP_ARCHIVE_KEY,
      id: 'mcp',
      kind: EPublishKind.Mcp,
      label: ATLAS_MCP_FILE_NAME,
    })),
  ]
  const digests = await digestAll([...new Set(drafts.flatMap((draft) => draft.files.map((file) => file.path)))])
  return drafts.flatMap((draft) => measured({ draft, digests }) ?? [])
}
