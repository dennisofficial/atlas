import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { parseLedgerLines } from '../src/ledger/jsonl/ledger-lines'
import { listRoots } from '../src/store/sessions/listing'
import {
  readMeta,
  readMetaSync,
  sessionMetaSchema,
  threadMetaSchema,
  writeMeta,
  type SessionMeta,
  type ThreadMeta,
} from '../src/store/sessions/meta'
import { ledgerFile, sessionMetaFile, sessionsDirectory, threadMetaFile, threadsDirectory } from '../src/store/sessions/paths'
import { SessionRegistry } from '../src/store/sessions/registry'
import { threadPlaces } from '../src/store/sessions/thread-places'
import {
  BIG_LOG_COUNT,
  CHILDREN_PER_ROOT,
  LIST_LIMIT,
  ROOTS_PER_PROJECT,
  SESSION_COUNT,
  buildFixture,
  type BenchPaths,
} from './bench-resume-fixture'

function flagValueOf(name: string): string | undefined {
  const prefix = `--${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found?.slice(prefix.length)
}

function projectsOf(): BenchPaths {
  const flag = flagValueOf('project')
  if (flag !== undefined) return { root: flag, child: flag }
  return { root: '/bench', child: '/bench/child' }
}

function tryReadThreadMeta({ sessionDir, id }: { sessionDir: string; id: string }): ThreadMeta | undefined {
  try {
    return readMetaSync({ file: threadMetaFile({ sessionDir, threadId: toThreadId(id) }), schema: threadMetaSchema })
  } catch {
    return undefined
  }
}

async function readThreadMetasSync({ sessionDir }: { sessionDir: string }): Promise<ThreadMeta[]> {
  const names = await readdir(threadsDirectory({ sessionDir })).catch(() => [] as string[])
  const metas: ThreadMeta[] = []
  for (const name of names) {
    if (!name.endsWith('.meta.json')) continue
    const meta = readMetaSync({ file: join(threadsDirectory({ sessionDir }), name), schema: threadMetaSchema })
    if (meta !== undefined) metas.push(meta)
  }
  return metas
}

async function sumSessionSpend({ sessionDir }: { sessionDir: string }): Promise<SessionMeta['spend']> {
  const text = await readFile(ledgerFile({ sessionDir }), 'utf8').catch(() => '')
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  for (const turn of parseLedgerLines({ text })) {
    totals.inputTokens += turn.inputTokens
    totals.outputTokens += turn.outputTokens
    totals.cacheReadTokens += turn.cacheReadTokens
    totals.cacheWriteTokens += turn.cacheWriteTokens
  }
  return totals
}

async function baselineListRoots({
  home,
  registry,
  project,
  write,
}: {
  home: string
  registry: SessionRegistry
  project: string
  write: boolean
}): Promise<{ id: string; activityAt: string }[]> {
  const root = sessionsDirectory({ home })
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  const entries: { sessionDir: string; meta: ThreadMeta; activityAt: string }[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const sessionDir = join(root, dir.name)
    const meta = tryReadThreadMeta({ sessionDir, id: dir.name })
    if (meta === undefined || meta.spawnerThreadId !== null) continue
    if (meta.repo !== project && meta.workspace !== project) continue
    const metas = await readThreadMetasSync({ sessionDir })
    const activityAt = metas.reduce((latest, item) => (item.updatedAt > latest ? item.updatedAt : latest), meta.updatedAt)
    entries.push({ sessionDir, meta, activityAt })
  }
  entries.sort((a, b) => b.activityAt.localeCompare(a.activityAt))
  const summaries: { id: string; activityAt: string }[] = []
  for (const entry of entries.slice(0, LIST_LIMIT)) {
    const places = await threadPlaces({
      home,
      registry,
      sessionDir: entry.sessionDir,
      threadId: toThreadId(entry.meta.id),
    })
    await refreshSessionCaches({ entry, places, write })
    summaries.push({ id: entry.meta.id, activityAt: entry.activityAt })
  }
  return summaries
}

async function refreshSessionCaches({
  entry,
  places,
  write,
}: {
  entry: { sessionDir: string; meta: ThreadMeta; activityAt: string }
  places: { worktree: { path: string } | null; pullRequests: { number: number }[] }
  write: boolean
}): Promise<void> {
  const file = sessionMetaFile({ sessionDir: entry.sessionDir })
  const existing = await readMeta({ file, schema: sessionMetaSchema })
  const spend = existsSync(ledgerFile({ sessionDir: entry.sessionDir }))
    ? await sumSessionSpend({ sessionDir: entry.sessionDir })
    : null
  const next: SessionMeta = {
    format: existing?.format ?? 1,
    id: entry.meta.id,
    title: entry.meta.title,
    createdAt: existing?.createdAt ?? entry.meta.createdAt,
    updatedAt: entry.activityAt,
    home: existing?.home ?? 'host',
    repo: entry.meta.repo,
    workspace: entry.meta.workspace,
    worktree: places.worktree?.path ?? null,
    pullRequests: places.pullRequests.length === 0 ? null : places.pullRequests.map((pr) => pr.number),
    spend: spend ?? existing?.spend ?? null,
  }
  if (write && (existing === undefined || JSON.stringify(existing) !== JSON.stringify(next))) {
    await writeMeta({ file, meta: next })
  }
}

async function measureBaseline({ home, projects, write }: { home: string; projects: BenchPaths; write: boolean }): Promise<void> {
  const registry = new SessionRegistry(home)
  const started = performance.now()
  const rows = await baselineListRoots({ home, registry, project: projects.root, write })
  console.log(`  cold scan+enrich: ${(performance.now() - started).toFixed(1)}ms, rows=${rows.length}`)
}

async function measureNew({ home, project, label }: { home: string; project: string; label: string }): Promise<void> {
  let emissions = 0
  let firstEmissionMs: number | undefined
  const started = performance.now()
  const rows = await listRoots({
    home,
    project,
    onUpdate: () => {
      emissions += 1
      if (firstEmissionMs === undefined) firstEmissionMs = performance.now() - started
    },
  })
  const fullMs = performance.now() - started
  console.log(
    `  ${label}: rows=${rows.length} emissions=${emissions} firstEmission=${firstEmissionMs?.toFixed(1)}ms full=${fullMs.toFixed(1)}ms`,
  )
}

async function measureMemory({ home, project }: { home: string; project: string }): Promise<void> {
  if (typeof globalThis.gc === 'function') globalThis.gc()
  const before = process.memoryUsage()
  await listRoots({ home, project })
  const after = process.memoryUsage()
  console.log(
    `  warm-run memory: rss ${(before.rss / 1048576).toFixed(0)}MB -> ${(after.rss / 1048576).toFixed(0)}MB, ` +
      `heapUsed ${(before.heapUsed / 1048576).toFixed(0)}MB -> ${(after.heapUsed / 1048576).toFixed(0)}MB`,
  )
}

async function main(): Promise<void> {
  const explicitHome = flagValueOf('home')
  const projects = projectsOf()
  const synthetic = explicitHome === undefined
  const home = explicitHome ?? (await mkdtemp(join(tmpdir(), 'atlas-bench-listing-')))
  try {
    if (synthetic) {
      const totals = await buildFixture({ home, projects })
      console.log(
        `fixture: ${SESSION_COUNT} sessions (${ROOTS_PER_PROJECT} roots of project ${projects.root}, ` +
          `${BIG_LOG_COUNT} big logs of 2MiB on the latest roots, small logs elsewhere, ` +
          `${CHILDREN_PER_ROOT} children each), ${(totals.bytes / 1048576).toFixed(0)}MiB of event logs, ` +
          `${totals.eventLines} event lines, ${totals.metaFiles} meta files`,
      )
    } else {
      console.log(`fixture: real home at ${home} (read-only, no writes anywhere)`)
    }
    console.log(`project filter: ${projects.root}`)

    console.log('baseline (HEAD behavior):')
    await measureBaseline({ home, projects, write: synthetic })

    console.log('new listRoots:')
    await measureNew({ home, project: projects.root, label: 'first run' })
    await measureNew({ home, project: projects.root, label: 'repeated run (module cache warm)' })
    await measureMemory({ home, project: projects.root })
    if (!synthetic) console.log('  note: --home is fully read-only; the baseline ran with session-meta writes disabled')
  } finally {
    if (synthetic) await rm(home, { recursive: true, force: true })
  }
}

await main()
