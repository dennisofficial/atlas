import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import { persistSandboxRotationReceipt, type TurnOutcome } from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'
import { createRuntimeCheckpointCapture } from '../runtime-checkpoint'
import type { ServeFamily } from '../serve-app'
import { fakeServeApp } from './fakes'
import { scratchTranscriptStore, type TranscriptStore } from './transcript-store-fixture'

export const threadId = toThreadId('rotation-root')
export const childId = toThreadId('rotation-child')
export const sourceSession = 'sandbox-source'
export const replacementSession = 'sandbox-replacement'
export const token = 'rotation-token'

const homes: string[] = []
const handles: ServeHandle[] = []
let priorHome: string | undefined
let ownsHome = false

const noFiles: WorkspaceFiles = {
  exists: async () => false,
  read: async () => { throw new Error('no such file') },
  write: async () => undefined,
  writeBytes: async () => undefined,
  ensureDirectory: async () => undefined,
  empty: async () => undefined,
}

export const gate = () => {
  let release: () => void = () => undefined
  let fail: (failure: Error) => void = () => undefined
  const promise = new Promise<void>((resolve, reject) => { release = resolve; fail = reject })
  return { promise, release, fail }
}

export async function rotationFixture() {
  const store = scratchTranscriptStore({ prefix: 'rotation-seed' })
  const home = store.home
  homes.push(home)
  if (!ownsHome) { priorHome = process.env.ATLAS_HOME; ownsHome = true }
  process.env.ATLAS_HOME = home
  await mkdir(join(home, 'bootstrap'), { recursive: true })
  await writeFile(join(home, 'bootstrap', 'workspace-spec.json'), JSON.stringify({
    remoteUrl: null, branch: null, commit: null, patch: '', githubToken: null, contextBundle: null,
  }))
  await store.log.append({
    threadId, runId: toRunId('rotation-paused'), drafts: [
      { type: 'user-said', text: 'finish this work' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'partway through' }], interrupted: true },
    ],
  })
  const capture = createRuntimeCheckpointCapture({
    threadId, atlasHome: home, env: { ATLAS_SANDBOX_SESSION_ID: sourceSession },
    token, transcript: store.log, log: () => undefined,
  })
  const checkpoint = await capture.capture({ phase: ERuntimePhase.Rotating })
  if (checkpoint === null) throw new Error('fixture requires a finalized checkpoint')
  const receipt = { version: 1 as const, threadId, sandboxSessionId: sourceSession, resumeParent: true, checkpoint }
  await persistSandboxRotationReceipt({ atlasHome: home, receipt })
  let boots = 0
  const boot = async (args: {
    sessionId?: string
    modelGate?: ReturnType<typeof gate>
    family?: ServeFamily
    adopt?: () => Promise<readonly typeof childId[]>
    onResume?: () => void
    configure?: (args: { app: ReturnType<typeof fakeServeApp>; disk: TranscriptStore }) => Promise<void>
  } = {}) => {
    boots += 1
    const disk = scratchTranscriptStore({ prefix: `rotation-boot-${boots}`, home })
    const app = fakeServeApp({
      threadId, root: '/workspace', intake: true, log: disk.log,
      holdStep: () => args.modelGate?.promise,
      family: args.family,
      adoptChildren: args.adopt ?? (async () => [childId]),
    })
    await args.configure?.({ app, disk })
    const runner = app.runner
    let resumed = 0
    let ran = 0
    const outcomes: TurnOutcome[] = []
    app.runner = {
      resume: async (given) => {
        resumed += 1
        args.onResume?.()
        const outcome = await runner.resume(given)
        outcomes.push(outcome)
        return outcome
      },
      runTurn: async (given) => {
        ran += 1
        const outcome = await runner.runTurn(given)
        outcomes.push(outcome)
        return outcome
      },
    }
    const starting = startServe({
      threadId, port: 0, token, controlPlaneUrl: 'https://api.example.com',
      env: { ATLAS_SANDBOX_SESSION_ID: args.sessionId ?? replacementSession },
      cwd: '/workspace', compose: async () => app,
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      contextFiles: noFiles, write: () => undefined,
    }).then((handle) => { handles.push(handle); return handle })
    return { starting, app, disk, resumed: () => resumed, ran: () => ran, outcomes }
  }
  return { home, receipt, store, boot }
}

export async function cleanupRotationFixtures(): Promise<void> {
  while (handles.length > 0) await handles.pop()?.close()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
  if (!ownsHome) return
  if (priorHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = priorHome
  ownsHome = false
}
