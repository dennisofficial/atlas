import { describe, expect, it } from 'bun:test'

import { z } from 'zod'

import {
  EBeforeToolDecision,
  EQualityReviewStatus,
  EQualitySkipReason,
  EStage,
  EToolEffect,
  type ToolInvocation,
} from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { HookedToolDispatcher } from '../dispatch'
import { InMemoryToolRegistry } from '../registry'
import {
  FakeQuality,
  capturedWrite,
  change,
  dispatchWrite,
  qualityDispatcher,
  reviewNudge,
  reviewRecord,
  writeCall,
} from './quality-fixtures'

const typesOf = (drafts: readonly { type: string }[]): string[] => drafts.map((draft) => draft.type)

describe('dispatching a successful write with quality review wired', () => {
  it('publishes the result first, then the review record, then the nudge', async () => {
    const quality = new FakeQuality()

    const drafts = await dispatchWrite(qualityDispatcher({ quality }))

    expect(typesOf(drafts)).toEqual(['tool-result', 'code-quality-reviewed', 'nudge'])
    expect(drafts[2]).toEqual(reviewNudge)
  })

  it('keeps the tool output and model text exactly as the tool produced them', async () => {
    const withQuality = await dispatchWrite(qualityDispatcher({ quality: new FakeQuality() }))
    const without = await dispatchWrite(qualityDispatcher({}))

    expect(withQuality[0]).toEqual(without[0])
    expect(withQuality[0]).toMatchObject({
      output: { bytes: 3 },
      modelText: 'wrote a.ts',
    })
    expect(JSON.stringify(withQuality[0])).not.toContain('fileChanges')
  })

  it('reviews the actual captured changes with the call, run, events and directory', async () => {
    const quality = new FakeQuality()
    const fault = {
      path: '/workspace/b.ts',
      reason: EQualitySkipReason.SourceUnavailable,
    }
    const dispatcher = qualityDispatcher({
      quality,
      tool: {
        invoke: async () => capturedWrite({ fileChanges: [change], fileChangeFaults: [fault] }),
      },
    })

    await dispatchWrite(dispatcher)

    expect(quality.reviews).toHaveLength(1)
    const [review] = quality.reviews
    expect(review?.changes).toEqual([change])
    expect(review?.captureFaults).toEqual([fault])
    expect(review?.runId).toBe(writeCall.runId)
    expect(review?.call.callId).toBe(writeCall.callId)
    expect(review?.projectDirectory).toBe('/workspace')
    expect(review?.events).toEqual([])
  })

  it('asks whether to capture once per invocation and forwards the answer to the tool', async () => {
    const quality = new FakeQuality()
    const seen: (boolean | undefined)[] = []
    const dispatcher = qualityDispatcher({
      quality,
      tool: {
        invoke: async (invocation: ToolInvocation) => {
          seen.push(invocation.captureFileChanges)
          return capturedWrite({ fileChanges: [change] })
        },
      },
    })

    await dispatchWrite(dispatcher)

    expect(quality.captureChecks).toBe(1)
    expect(seen).toEqual([true])
  })

  it('does not review a successful call that captured nothing', async () => {
    const quality = new FakeQuality()
    const dispatcher = qualityDispatcher({
      quality,
      tool: { invoke: async () => capturedWrite({}) },
    })

    const drafts = await dispatchWrite(dispatcher)

    expect(typesOf(drafts)).toEqual(['tool-result'])
    expect(quality.reviews).toHaveLength(0)
  })
})

describe('dispatching without quality review, or when it is switched off', () => {
  it('leaves the invocation without a capture flag when no port is wired', async () => {
    const seen: ToolInvocation[] = []
    const dispatcher = qualityDispatcher({
      tool: {
        invoke: async (invocation) => {
          seen.push(invocation)
          return capturedWrite({})
        },
      },
    })

    const drafts = await dispatchWrite(dispatcher)

    expect(typesOf(drafts)).toEqual(['tool-result'])
    expect('captureFileChanges' in (seen[0] ?? {})).toBe(false)
  })

  it('forwards no capture flag when the port reports capture off', async () => {
    const seen: ToolInvocation[] = []
    const quality = new FakeQuality({ capture: () => false })
    const dispatcher = qualityDispatcher({
      quality,
      tool: {
        invoke: async (invocation) => {
          seen.push(invocation)
          return capturedWrite({})
        },
      },
    })

    await dispatchWrite(dispatcher)

    expect('captureFileChanges' in (seen[0] ?? {})).toBe(false)
  })

  it('never reviews a failed tool', async () => {
    const quality = new FakeQuality()
    const dispatcher = qualityDispatcher({
      quality,
      tool: { invoke: async () => ({ ok: false, reason: 'disk full' }) },
    })

    const drafts = await dispatchWrite(dispatcher)

    expect(typesOf(drafts)).toEqual(['tool-result'])
    expect(quality.reviews).toHaveLength(0)
  })

  it('never reviews a tool that threw', async () => {
    const quality = new FakeQuality()
    const dispatcher = qualityDispatcher({
      quality,
      tool: {
        invoke: async () => {
          throw new Error('boom')
        },
      },
    })

    const drafts = await dispatchWrite(dispatcher)

    expect(drafts[0]).toMatchObject({
      type: 'tool-result',
      error: { message: 'the write tool threw: boom' },
    })
    expect(quality.reviews).toHaveLength(0)
  })

  it('never reviews a call a guard denied', async () => {
    const quality = new FakeQuality()
    let invoked = false
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([
        {
          name: 'write',
          description: 'w',
          effect: EToolEffect.Write,
          inputSchema: z.object({ path: z.string() }),
          invoke: async () => {
            invoked = true
            return capturedWrite({ fileChanges: [change] })
          },
        },
      ]),
      hooks: new HookChain({
        beforeTool: [
          {
            name: 'deny',
            order: { stage: EStage.Guard, nudge: 0 },
            run: async () => ({
              decision: EBeforeToolDecision.Deny,
              reason: 'no',
            }),
          },
        ],
      }),
      quality,
    })

    const drafts = await dispatchWrite(dispatcher)

    expect(typesOf(drafts)).toEqual(['tool-denied'])
    expect(invoked).toBe(false)
    expect(quality.reviews).toHaveLength(0)
    expect(quality.captureChecks).toBe(0)
  })
})

describe('a faulty review port', () => {
  it('cannot stop a write succeeding when the capture getter throws', async () => {
    const seen: (boolean | undefined)[] = []
    const quality = new FakeQuality({
      capture: () => {
        throw new Error('settings unreadable')
      },
    })
    const dispatcher = qualityDispatcher({
      quality,
      tool: {
        invoke: async (invocation) => {
          seen.push(invocation.captureFileChanges)
          return capturedWrite({})
        },
      },
    })

    const drafts = await dispatchWrite(dispatcher)

    expect(typesOf(drafts)).toEqual(['tool-result'])
    expect(drafts[0]).not.toHaveProperty('error')
    expect(seen).toEqual([undefined])
  })

  it('is replaced by an operational-error record when the reviewer throws', async () => {
    const quality = new FakeQuality({
      review: async () => {
        throw new Error('reviewer exploded')
      },
    })

    const drafts = await dispatchWrite(qualityDispatcher({ quality }))

    expect(typesOf(drafts)).toEqual(['tool-result', 'code-quality-reviewed'])
    expect(drafts[0]).not.toHaveProperty('error')
    expect(drafts[1]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      path: '/workspace/a.ts',
      detail: 'review failed: reviewer exploded',
    })
  })

  it('is replaced by an operational-error record when drafts are malformed', async () => {
    const quality = new FakeQuality({
      review: async () => [reviewRecord, { ...reviewRecord, durationMs: -1 }, reviewNudge],
    })

    const drafts = await dispatchWrite(qualityDispatcher({ quality }))

    expect(typesOf(drafts)).toEqual(['tool-result', 'code-quality-reviewed'])
    expect(drafts[1]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
    })
  })

  it('drops drafts of any kind other than a review record or a nudge', async () => {
    const quality = new FakeQuality({
      review: async () => [{ type: 'user-said', text: 'smuggled' }, reviewNudge],
    })

    const drafts = await dispatchWrite(qualityDispatcher({ quality }))

    expect(typesOf(drafts)).toEqual(['tool-result', 'code-quality-reviewed'])
    expect(drafts[1]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
    })
  })

  it('is replaced by an operational-error record when it returns a non-list', async () => {
    const quality = new FakeQuality({ review: async () => undefined as never })

    const drafts = await dispatchWrite(qualityDispatcher({ quality }))

    expect(typesOf(drafts)).toEqual(['tool-result', 'code-quality-reviewed'])
  })
})
