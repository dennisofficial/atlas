import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus } from '@dltech/atlas-core'

import type { ShellSnapshot } from '../background-shell'
import type { ShellRegistryPort } from '../shell-registry'
import { MATCHED_LINES_CAP } from '../shell-watch'
import {
  announced,
  closeRegistries,
  matchedDraft,
  openRegistry,
  recorded,
  recordedDraft,
  RecordingLog,
  settle,
  shellAdapters,
  THREAD,
} from './shell-registry-fixture'

const matchedInLog = (log: RecordingLog | undefined) =>
  matchedDraft(log?.appended.find((draft) => draft.type === 'background-shell-matched'))

afterEach(closeRegistries)

const watching = async ({
  registry,
  command,
  watch,
}: {
  registry: ShellRegistryPort
  command: string
  watch: string
}): Promise<ShellSnapshot> => {
  const started = await registry.start({
    threadId: THREAD,
    command,
    description: 'Watch a long job',
    watch,
  })
  if (!started.ok) throw new Error(started.reason)
  return started.snapshot
}

const readable = async ({
  registry,
  shellId,
}: {
  registry: ShellRegistryPort
  shellId: string
}): Promise<string> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const read = await registry.read({ shellId, threadId: THREAD })
    if (read.ok && read.delta.text.length > 0) return read.delta.text
    await Bun.sleep(25)
  }
  throw new Error(`background shell ${shellId} printed nothing`)
}

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('telling the model what a running shell just printed', async () => {
      it('delivers the matching lines while the shell is still running', async () => {
        const { registry, log } = openRegistry({ adapter })
        const snapshot = await watching({
          registry,
          command: 'echo building; echo "ERROR: the build fell over"; sleep 30',
          watch: 'ERROR|FAILED',
        })

        await announced({ registry })
        await recordedDraft({ log, type: 'background-shell-matched' })

        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
        expect(matchedInLog(log)).toMatchObject({
          type: 'background-shell-matched',
          shellId: snapshot.shellId,
          command: 'echo building; echo "ERROR: the build fell over"; sleep 30',
          pattern: 'ERROR|FAILED',
          lines: 'ERROR: the build fell over',
          matchCount: 1,
        })
        expect(registry.list({ threadId: THREAD })[0]?.status).toBe(EShellStatus.Running)
      })

      it('batches a burst of matching lines into one notice rather than one each', async () => {
        const { registry, log } = openRegistry({ adapter })
        await watching({
          registry,
          command: 'for i in 1 2 3 4 5; do echo "hit $i"; done; sleep 30',
          watch: 'hit',
        })

        await announced({ registry })
        await recordedDraft({ log, type: 'background-shell-matched' })

        expect(matchedInLog(log)).toMatchObject({
          matchCount: 5,
          lines: ['hit 1', 'hit 2', 'hit 3', 'hit 4', 'hit 5'].join('\n'),
        })
      })

      it('says nothing when no line matches, however much the shell prints', async () => {
        const { registry } = openRegistry({ adapter })
        const snapshot = await watching({
          registry,
          command: 'echo quiet progress; sleep 30',
          watch: 'ERROR',
        })
        await readable({ registry, shellId: snapshot.shellId })
        await Bun.sleep(400)

        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
      })

      it('leaves a shell with no watch entirely alone', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start({
          threadId: THREAD,
          command: 'echo ERROR: unwatched; sleep 30',
          description: 'Run unwatched',
        })
        if (!started.ok) throw new Error(started.reason)
        await readable({ registry, shellId: started.snapshot.shellId })
        await Bun.sleep(400)

        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
      })
    })

    describe('keeping the watch off the shell_output cursor', async () => {
      it('leaves every matched line where a read can still find it', async () => {
        const { registry, log } = openRegistry({ adapter })
        const snapshot = await watching({
          registry,
          command: 'echo quiet; echo "ERROR: boom"; sleep 30',
          watch: 'ERROR',
        })

        await announced({ registry })
        await recordedDraft({ log, type: 'background-shell-matched' })
        expect(matchedInLog(log).lines).toBe('ERROR: boom')

        const read = await registry.read({ shellId: snapshot.shellId, threadId: THREAD })

        expect(read.ok && read.delta.text).toBe('quiet\nERROR: boom\n')
      })

      it('still delivers the match after a read has consumed the output it came from', async () => {
        const { registry, log } = openRegistry({ adapter })
        const snapshot = await watching({
          registry,
          command: 'echo "ERROR: boom"; sleep 30',
          watch: 'ERROR',
        })

        expect(await readable({ registry, shellId: snapshot.shellId })).toBe('ERROR: boom\n')
        await announced({ registry })
        await recordedDraft({ log, type: 'background-shell-matched' })

        expect(matchedInLog(log)).toMatchObject({
          lines: 'ERROR: boom',
          matchCount: 1,
        })
      })
    })

    describe('disarming a watch that has said enough', async () => {
      it('stops at the cap, says so, and leaves the shell running', async () => {
        const { registry, log } = openRegistry({ adapter })
        const snapshot = await watching({
          registry,
          command: `for i in $(seq 1 ${MATCHED_LINES_CAP + 50}); do echo "hit $i"; done; sleep 30`,
          watch: 'hit',
        })

        await announced({ registry })
        await recordedDraft({ log, type: 'background-shell-matched' })
        const matched = matchedInLog(log)

        expect(matched.matchCount).toBe(MATCHED_LINES_CAP)
        expect(matched.watchDisarmed).toBe(true)
        expect(matched.lines.split('\n')).toHaveLength(MATCHED_LINES_CAP)
        expect(registry.list({ threadId: THREAD })[0]?.status).toBe(EShellStatus.Running)

        const killed = registry.kill({
          shellId: snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!killed.ok || killed.settled === undefined) throw new Error('a model kill hands back the settled continuation')
        const ending = await killed.settled

        expect(ending.died).toBe(true)
        if (ending.died) expect(ending.snapshot.shellId).toBe(snapshot.shellId)
        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
      }, 30_000)
    })

    describe('never telling on a dead shell', async () => {
      it('keeps the match and the ending in occurrence order, so the model reads life then death', async () => {
        const { registry, log } = openRegistry({ adapter })
        const snapshot = await watching({
          registry,
          command: 'echo "ERROR: late hit"; sleep 30',
          watch: 'ERROR',
        })

        await announced({ registry })
        await recordedDraft({ log, type: 'background-shell-matched' })

        const killed = registry.kill({
          shellId: snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!killed.ok) throw new Error('the kill should land')
        await settle({ registry, shellId: snapshot.shellId })
        await recorded({ log })

        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
        const types = (log?.appended ?? []).map((draft) => draft.type)
        const matchedAt = types.indexOf('background-shell-matched')
        const endedAt = types.indexOf('background-shell-ended')
        expect(matchedAt).toBeGreaterThanOrEqual(0)
        expect(endedAt).toBeGreaterThan(matchedAt)
      })

      it('never delivers a match that landed inside the exit window', async () => {
        const { registry, log } = openRegistry({ adapter })
        const snapshot = await watching({
          registry,
          command: 'echo "ERROR: boom and gone"',
          watch: 'ERROR',
        })

        await settle({ registry, shellId: snapshot.shellId })
        await recorded({ log })

        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
        expect(log?.appended.some((draft) => draft.type === 'background-shell-matched')).toBe(
          false,
        )
      })
    })

    describe('refusing a pattern that is not one', async () => {
      it('names the syntax error and starts nothing', async () => {
        const { registry } = openRegistry({ adapter })

        const started = await registry.start({
          threadId: THREAD,
          command: 'echo hi',
          description: 'Watch nonsense',
          watch: '(unclosed',
        })

        expect(started.ok).toBe(false)
        expect(!started.ok && started.reason).toContain('not a regular expression')
        expect(registry.list({ threadId: THREAD })).toEqual([])
      })
    })

  })
}
