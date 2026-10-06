import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { afterEach } from 'bun:test'

import {
  EAgentStart,
  toEventId,
  toRunId,
  toThreadId,
  type EventDraft,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { JsonlEventLog } from '../../../store/sessions/event-log'
import { eventLogFile, sessionDirectory, threadMetaFile } from '../../../store/sessions/paths'
import { SessionRegistry } from '../../../store/sessions/registry'
import { JsonlThreadStore } from '../../../store/sessions/thread-store'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { TRANSCRIPT_ORIGIN_FILE_NAME } from '../descend-validate'
import { useAtlasHome } from './descend-fixture'
import { archiveDescriptorOf, extractExportInto } from './fake-cloud-bridge'
import { CLOUD_THREAD } from './fixture'

export const AT = '2026-09-17T12:00:00.000Z'
export const fixedClock = { now: () => AT }

export const said = (text: string): EventDraft => ({ type: 'user-said', text })

let runs = 0
export const descendIds = (): IdPort => ({
  nextThreadId: () => toThreadId('brn_unused'),
  nextRunId: () => toRunId(`run_descend_${(runs += 1)}`),
  nextEventId: () => toEventId(`evt_descend_${(runs += 1)}`),
  nextCallId: () => {
    throw new Error('unused')
  },
})

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

export const scratchHome = (prefix: string): string => {
  const home = mkdtempSync(join(tmpdir(), prefix))
  homes.push(home)
  return home
}

export type StoreHome = {
  home: string
  log: JsonlEventLog
  threads: JsonlThreadStore
  registry: SessionRegistry
}

export const useStoreHome = (): StoreHome => {
  const home = useAtlasHome()
  const registry = new SessionRegistry(home)
  const ids = descendIds()
  const log = new JsonlEventLog(home, registry, fixedClock, ids)
  const threads = new JsonlThreadStore(home, registry, fixedClock, ids, log)
  return { home, log, threads, registry }
}

export const sessionDirOf = ({ home }: { home: string }): string =>
  sessionDirectory({ home, sessionId: CLOUD_THREAD })

export const readLocalLogBytes = ({ home }: { home: string }): Buffer =>
  readFileSync(eventLogFile({ sessionDir: sessionDirOf({ home }), threadId: CLOUD_THREAD }))

export const seedLocalHistory = async (args: {
  home: string
  threads: JsonlThreadStore
  texts: readonly string[]
}): Promise<void> => {
  await args.threads.createWithFirstEvents({
    threadId: CLOUD_THREAD,
    runId: toRunId('run_local_seed'),
    drafts: args.texts.map(said),
    workspace: '/work',
  })
}

export const fileArchiveOf = async (args: {
  drafts: readonly EventDraft[]
  rootMeta?: boolean
}): Promise<SessionArchiveDescriptor> => {
  const home = scratchHome('atlas-descend-preserve-')
  const registry = new SessionRegistry(home)
  const ids = descendIds()
  const log = new JsonlEventLog(home, registry, fixedClock, ids)
  const threads = new JsonlThreadStore(home, registry, fixedClock, ids, log)
  if (args.rootMeta === false) {
    await log.append({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_cloud_seed'),
      drafts: args.drafts,
    })
  } else {
    await threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_cloud_seed'),
      drafts: args.drafts,
      workspace: '/work',
    })
  }
  return archiveDescriptorOf({ sessionDir: sessionDirOf({ home }) })
}

export const capabilitiesOnlyArchive = (): Promise<SessionArchiveDescriptor> =>
  fileArchiveOf({
    drafts: [
      { type: 'context-loaded', slot: 'capabilities', key: 'tools', content: 'you can do things' },
    ],
  })

export const stampProvenance = ({ sessionDir }: { sessionDir: string }): void => {
  writeFileSync(
    join(sessionDir, TRANSCRIPT_ORIGIN_FILE_NAME),
    JSON.stringify({ threadId: CLOUD_THREAD, archiveDigest: null, initialized: true }),
  )
}

export const stagedArchiveOf = async (args: {
  drafts: readonly EventDraft[]
  provenance?: boolean
}): Promise<SessionArchiveDescriptor> => {
  const staging = scratchHome('atlas-descend-preserve-stage-')
  const stagedDir = sessionDirOf({ home: staging })
  await extractExportInto({
    archive: await fileArchiveOf({ drafts: args.drafts }),
    sessionDir: stagedDir,
  })
  if (args.provenance === true) stampProvenance({ sessionDir: stagedDir })
  return archiveDescriptorOf({ sessionDir: stagedDir })
}

const fileBytesOf = ({ root, dir }: { root: string; dir: string }): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      Object.assign(out, fileBytesOf({ root, dir: path }))
      continue
    }
    if (entry.name === 'lock') continue
    out[relative(root, path)] = readFileSync(path).toString('base64')
  }
  return out
}

export const sessionDirBytes = ({ home }: { home: string }): Record<string, string> =>
  fileBytesOf({ root: sessionDirOf({ home }), dir: sessionDirOf({ home }) })

export type FamilyStaging = {
  stagedDir: string
  staging: string
  log: JsonlEventLog
  threads: JsonlThreadStore
}

export const familyArchiveWithChild = async (args: {
  child: ThreadId
  mutate: (given: { stagedDir: string }) => void
}): Promise<SessionArchiveDescriptor> => {
  const staging = scratchHome('atlas-descend-preserve-family-')
  const stagedDir = sessionDirOf({ home: staging })
  await extractExportInto({
    archive: await fileArchiveOf({ drafts: [said('parent speaks')] }),
    sessionDir: stagedDir,
  })
  const registry = new SessionRegistry(staging)
  const ids = descendIds()
  const log = new JsonlEventLog(staging, registry, fixedClock, ids)
  const threads = new JsonlThreadStore(staging, registry, fixedClock, ids, log)
  await threads.createWithFirstEvents({
    threadId: args.child,
    runId: toRunId('run_child_seed'),
    drafts: [said('child speaks')],
    workspace: '/work',
    agent: { spawnedBy: CLOUD_THREAD, type: 'explore' },
  })
  await log.append({
    threadId: CLOUD_THREAD,
    runId: toRunId('run_spawn_seed'),
    drafts: [
      {
        type: 'agent-spawned',
        agentId: args.child,
        agentType: 'explore',
        intent: 'check the thing',
        mode: EAgentStart.Fresh,
      },
    ],
  })
  args.mutate({ stagedDir })
  return archiveDescriptorOf({ sessionDir: stagedDir })
}

export const tearChildLog = (args: { stagedDir: string; child: ThreadId }): void => {
  appendFileSync(
    eventLogFile({ sessionDir: args.stagedDir, threadId: args.child }),
    '{"v":1,"id":"evt_torn","seq":2',
  )
}

export const dropChildFiles = (args: { stagedDir: string; child: ThreadId }): void => {
  rmSync(threadMetaFile({ sessionDir: args.stagedDir, threadId: args.child }), { force: true })
  rmSync(eventLogFile({ sessionDir: args.stagedDir, threadId: args.child }), { force: true })
}

export const stageFamilyWithChild = async (args: { child: ThreadId }): Promise<FamilyStaging> => {
  const staging = scratchHome('atlas-descend-preserve-family-')
  const stagedDir = sessionDirOf({ home: staging })
  await extractExportInto({
    archive: await fileArchiveOf({ drafts: [said('parent speaks')] }),
    sessionDir: stagedDir,
  })
  const registry = new SessionRegistry(staging)
  const ids = descendIds()
  const log = new JsonlEventLog(staging, registry, fixedClock, ids)
  const threads = new JsonlThreadStore(staging, registry, fixedClock, ids, log)
  await threads.createWithFirstEvents({
    threadId: args.child,
    runId: toRunId('run_child_seed'),
    drafts: [said('child speaks')],
    workspace: '/work',
    agent: { spawnedBy: CLOUD_THREAD, type: 'explore' },
  })
  await log.append({
    threadId: CLOUD_THREAD,
    runId: toRunId('run_spawn_seed'),
    drafts: [
      {
        type: 'agent-spawned',
        agentId: args.child,
        agentType: 'explore',
        intent: 'check the thing',
        mode: EAgentStart.Fresh,
      },
    ],
  })
  return { stagedDir, staging, log, threads }
}

export const archiveOfStagedDir = ({
  stagedDir,
}: {
  stagedDir: string
}): Promise<SessionArchiveDescriptor> => archiveDescriptorOf({ sessionDir: stagedDir })

export const spawnGrandchild = async (args: {
  family: FamilyStaging
  child: ThreadId
  grandchild: ThreadId
}): Promise<void> => {
  await args.family.threads.createWithFirstEvents({
    threadId: args.grandchild,
    runId: toRunId('run_grandchild_seed'),
    drafts: [said('grandchild speaks')],
    workspace: '/work',
    agent: { spawnedBy: args.child, type: 'explore' },
  })
  await args.family.log.append({
    threadId: args.child,
    runId: toRunId('run_grandspawn_seed'),
    drafts: [
      {
        type: 'agent-spawned',
        agentId: args.grandchild,
        agentType: 'explore',
        intent: 'go deeper',
        mode: EAgentStart.Fresh,
      },
    ],
  })
}
