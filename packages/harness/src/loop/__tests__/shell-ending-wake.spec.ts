import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  defaultPipeline,
  EMPTY_PROMPT,
  EShellStatus,
  toThreadId,
  type ClockPort,
  type ModelPort,
} from '@dltech/atlas-core'

import { buildHarness, ETurnStatus, LoopTurnRunner, type AtlasHarness } from '..'
import { scriptedModel } from '../../model/testing/scripted-model'
import { HookChain } from '../../hooks/registry'
import type { ShellAttachment, ShellLaunchOutcome, ShellLaunchSpec } from '../../shells/port'
import { ShellLauncherPort } from '../../shells/port'
import { endedDraft } from '../../shells/journal'
import { toShellId } from '../../shells/shell-id'
import { BunShellRegistry, type ShellRegistryPort } from '../../shells/shell-registry'
import { RandomIds } from '../../store/ids'
import { appendPending } from '../pending-intake'
import type { PendingDrain } from '../run-turn'
import { RecordingLog } from '../../shells/__tests__/shell-registry-log'
import { createTempHome, type TempHome } from './temp-home'

const PROJECT_DIRECTORY = '/w'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

async function runEndingAfterFinalMessage(args: { wakesTurn: boolean }): Promise<{
  status: ETurnStatus
  tailType: string | undefined
  modelCalls: number
}> {
  const temp = createTempHome()
  const model = scriptedModel({
    script: [{ text: 'the build will wake me when it finishes' }, { text: 'the build failed; rerunning' }],
  })
  const harness = await buildHarness({ home: temp.home, model })
  opened.push({ harness, temp })
  const thread = await harness.threads.create({})

  let endingQueued = false
  const drainPending = async (): Promise<PendingDrain> => {
    if (!endingQueued) return { drafts: [], wakesTurn: false }
    endingQueued = false
    const drafts = [
      endedDraft({
        snapshot: {
          shellId: 'bash_1',
          command: 'bun run build',
          description: 'Build workspace dependencies',
          status: 'exited',
          exitCode: 1,
          totalCharacters: 0,
        } as never,
        delta: { text: '', droppedCharacters: 0, remainingCharacters: 0 },
      }),
    ]
    return { drafts, wakesTurn: args.wakesTurn }
  }

  let queuedOnce = false
  const steered: ModelPort = {
    identity: harness.model.identity,
    step: async (stepArgs) => {
      const result = await harness.model.step(stepArgs)
      if (!queuedOnce) {
        queuedOnce = true
        endingQueued = true
      }
      return result
    },
  }

  const runner = new LoopTurnRunner({
    log: harness.log,
    model: steered,
    ids: harness.ids,
    assembly: defaultPipeline({
      prompt: () => EMPTY_PROMPT,
      launchDirectory: PROJECT_DIRECTORY,
    }),
    drainPending,
  })

  const outcome = await runner.say({
    threadId: thread.id,
    text: 'run the build',
  })
  const events = await harness.log.read({ threadId: thread.id })

  return {
    status: outcome.status,
    tailType: events.at(-1)?.type,
    modelCalls: model.doStreamCalls.length,
  }
}

describe('a shell ending drained after the final message', () => {
  it('is answered by a further step rather than left at the tail when the drain wakes the turn', async () => {
    const result = await runEndingAfterFinalMessage({ wakesTurn: true })

    expect(result.status).toBe(ETurnStatus.Completed)
    expect(result.tailType).toBe('assistant-said')
    expect(result.modelCalls).toBe(2)
  })
})

const SPEC_THREAD = toThreadId('thread-under-test')

const fakeClock: ClockPort = { now: () => '2026-09-26T00:00:00.000Z' }

class AlreadyExitedLauncher extends ShellLauncherPort {
  constructor(private readonly root: string) {
    super()
  }

  launch(spec: ShellLaunchSpec): Promise<ShellLaunchOutcome> {
    const attachment: ShellAttachment = {
      shellId: toShellId('bash_1'),
      startedAt: fakeClock.now(),
      outputPath: join(this.root, 'output.log'),
      cursorPath: join(this.root, 'cursor.json'),
      inputSupported: false,
      totalBytes: () => 0,
      readOutput: () => Promise.resolve(new Uint8Array()),
      writeInput: () => Promise.resolve({ ok: false, reason: 'no input' }),
      kill: () => undefined,
      watch: ({ onExit }) => {
        queueMicrotask(() =>
          onExit({ status: EShellStatus.Exited, exitCode: 0, endedAt: fakeClock.now(), totalBytes: 0 }),
        )
      },
      detach: () => Promise.resolve(),
    }
    void spec
    return Promise.resolve({ ok: true, attachment })
  }

  inspect(): Promise<readonly never[]> {
    return Promise.resolve([])
  }
}

const fakeRegistries: { registry: ShellRegistryPort; root: string }[] = []

afterEach(async () => {
  for (const entry of fakeRegistries.splice(0)) {
    await entry.registry.closeAll()
    rmSync(entry.root, { recursive: true, force: true })
  }
})

function openFakeRegistry(): {
  registry: ShellRegistryPort
  log: RecordingLog
  threadId: typeof SPEC_THREAD
} {
  const root = mkdtempSync(join(tmpdir(), 'atlas-shell-ending-wake-'))
  const log = new RecordingLog()
  const registry = new BunShellRegistry({
    root,
    clock: fakeClock,
    hooks: () => new HookChain({}),
    launcher: new AlreadyExitedLauncher(root),
    log,
    ids: new RandomIds(),
  })
  fakeRegistries.push({ registry, root })
  return { registry, log, threadId: SPEC_THREAD }
}

describe('an ending the occurrence already wrote', () => {
  it('is not appended a second time when the turn drains the wake-up bell', async () => {
    const { registry, log, threadId } = openFakeRegistry()
    const started = await registry.start({
      threadId,
      command: 'echo done',
      description: 'Run a background job',
    })
    if (!started.ok) throw new Error(started.reason)

    for (let attempt = 0; attempt < 400; attempt += 1) {
      const recorded = (await log.read({ threadId })).filter(
        (event) => event.type === 'background-shell-ended',
      )
      if (recorded.length > 0) break
      if (attempt === 399) throw new Error('no background-shell-ended ever reached the log')
      await Bun.sleep(25)
    }

    const drained = await appendPending({
      drain: async ({ threadId: drainedThread }) => {
        const prepare = registry.prepareNotifications
        if (prepare === undefined) throw new Error('this registry prepares no notifications')
        const batch = prepare.call(registry, { threadId: drainedThread })
        return {
          drafts: batch.drafts,
          wakesTurn: batch.wakesTurn,
          acknowledge: batch.acknowledge,
        }
      },
      log,
      ids: new RandomIds(),
      threadId,
    })

    expect(drained.ok && !drained.drained).toBe(true)
    const ended = (await log.read({ threadId })).filter(
      (event) => event.type === 'background-shell-ended',
    )
    expect(ended).toHaveLength(1)
  })
})
