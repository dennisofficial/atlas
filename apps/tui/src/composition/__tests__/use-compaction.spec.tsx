import { ECompactionAnchor, toRunId, toThreadId } from '@dltech/atlas-core'
import {
  CompactionPort,
  ECompaction,
  ECompactScope,
  type Compaction,
} from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { teardown } from '../../ui/markdown/__tests__/harness'
import { useCompaction, type CompactionControl } from '../use-compaction'
import { fakeApp, scriptedModelPort } from './fake-app'

const THREAD = toThreadId('compaction-port-hook')

type Call =
  | { kind: 'compact'; scope: ECompactScope | undefined; signal: AbortSignal | undefined }
  | { kind: 'summarise'; anchor: ECompactionAnchor; seq: number; signal: AbortSignal | undefined }

class RecordingCompaction extends CompactionPort {
  readonly calls: Call[] = []
  private release: (outcome: Compaction) => void = () => undefined
  outcome: Compaction = { type: ECompaction.Compacted, replaced: 2, fromSeq: 1, throughSeq: 2 }
  held = false

  compact(args: { threadId: typeof THREAD; scope?: ECompactScope | undefined; signal?: AbortSignal | undefined }) {
    this.calls.push({ kind: 'compact', scope: args.scope, signal: args.signal })
    return this.answer()
  }

  summarise(args: { threadId: typeof THREAD; anchor: ECompactionAnchor; seq: number; signal?: AbortSignal | undefined }) {
    this.calls.push({ kind: 'summarise', anchor: args.anchor, seq: args.seq, signal: args.signal })
    return this.answer()
  }

  finish(outcome: Compaction): void {
    this.release(outcome)
  }

  private answer(): Promise<Compaction> {
    if (!this.held) return Promise.resolve(this.outcome)
    return new Promise((resolve) => {
      this.release = resolve
    })
  }
}

type Probe = { control: CompactionControl | null }

const Harness = (props: {
  app: ReturnType<typeof fakeApp>
  probe: Probe
  frozen?: boolean
  events: { failures: string[]; compacted: number; refreshed: number }
}): React.ReactNode => {
  props.probe.control = useCompaction({
    app: props.app,
    threadId: THREAD,
    readClock: () => 0,
    refresh: async () => {
      props.events.refreshed += 1
    },
    onFailure: (reason) => props.events.failures.push(reason),
    onCompacted: () => {
      props.events.compacted += 1
    },
    frozen: props.frozen,
  })
  return <text>probe</text>
}

const mount = async (args: { port?: RecordingCompaction; frozen?: boolean; summarised?: { calls: number } }) => {
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
  const summarised = args.summarised ?? { calls: 0 }
  app.summarise = async () => {
    summarised.calls += 1
    return 'a summary'
  }
  if (args.port !== undefined) app.compaction = args.port
  const probe: Probe = { control: null }
  const events = { failures: [] as string[], compacted: 0, refreshed: 0 }
  const setup = await testRender(
    <Harness app={app} probe={probe} events={events} {...(args.frozen === undefined ? {} : { frozen: args.frozen })} />,
    { width: 20, height: 4 },
  )
  await setup.flush()
  const control = (): CompactionControl => {
    if (probe.control === null) throw new Error('the compaction probe never mounted')
    return probe.control
  }
  return { app, setup, control, events, summarised }
}

describe('the compaction controls over a compaction port', () => {
  it('sends /compact through the port with its scope and settles the result', async () => {
    const port = new RecordingCompaction()
    const { setup, control, events, summarised } = await mount({ port })
    try {
      control().compact(ECompactScope.Everything)
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(port.calls).toMatchObject([{ kind: 'compact', scope: ECompactScope.Everything }])
      expect(events.compacted).toBe(1)
      expect(events.refreshed).toBe(1)
      expect(summarised.calls).toBe(0)
    } finally {
      await teardown(setup)
    }
  })

  it('sends prune-around through the port with its anchor and seq', async () => {
    const port = new RecordingCompaction()
    const { setup, control, summarised } = await mount({ port })
    try {
      control().compactAround({ anchor: ECompactionAnchor.Suffix, seq: 9 })
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(port.calls).toMatchObject([{ kind: 'summarise', anchor: ECompactionAnchor.Suffix, seq: 9 }])
      expect(summarised.calls).toBe(0)
    } finally {
      await teardown(setup)
    }
  })

  it('reports a refusal without refreshing', async () => {
    const port = new RecordingCompaction()
    port.outcome = { type: ECompaction.Refused, reason: 'the sandbox said no' }
    const { setup, control, events } = await mount({ port })
    try {
      control().compact(ECompactScope.Recent)
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(events.failures).toEqual(['the sandbox said no'])
      expect(events.refreshed).toBe(0)
    } finally {
      await teardown(setup)
    }
  })

  it('reports a rejected request as an unfinished compaction', async () => {
    const port = new RecordingCompaction()
    port.compact = () => Promise.reject(new Error('sandbox unreachable'))
    const { setup, control, events } = await mount({ port })
    try {
      control().compact(ECompactScope.Recent)
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(events.failures).toEqual([
        'compacting the history did not finish: sandbox unreachable',
      ])
    } finally {
      await teardown(setup)
    }
  })

  it('aborts the port signal on cancel and stays silent about the abandoned result', async () => {
    const port = new RecordingCompaction()
    port.held = true
    const { setup, control, events } = await mount({ port })
    try {
      control().compact(ECompactScope.Recent)
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(control().compacting).not.toBeNull()

      expect(control().cancel()).toBe(true)
      const signal = port.calls[0]?.signal
      expect(signal?.aborted).toBe(true)
      port.finish({ type: ECompaction.Compacted, replaced: 1, fromSeq: 1, throughSeq: 1 })
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(events.compacted).toBe(0)
      expect(events.failures).toEqual([])
      expect(control().compacting).toBeNull()
      expect(control().cancel()).toBe(false)
    } finally {
      await teardown(setup)
    }
  })

  it('does not start while a placement move is frozen', async () => {
    const port = new RecordingCompaction()
    const { setup, control } = await mount({ port, frozen: true })
    try {
      control().compact(ECompactScope.Recent)
      control().compactAround({ anchor: ECompactionAnchor.Prefix, seq: 1 })
      await setup.flush()

      expect(port.calls).toEqual([])
    } finally {
      await teardown(setup)
    }
  })

  it('falls back to a local compaction over the host stores when the app carries no port', async () => {
    const { app, setup, control, summarised, events } = await mount({})
    try {
      await app.log.append({
        threadId: THREAD,
        runId: toRunId('fallback-run'),
        drafts: [
          { type: 'user-said', text: 'first' },
          { type: 'assistant-said', parts: [{ type: 'text', text: 'second' }] },
        ],
      })
      control().compact(ECompactScope.Everything)
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(summarised.calls).toBe(1)
      expect(events.failures).toEqual([])
    } finally {
      await teardown(setup)
    }
  })
})
