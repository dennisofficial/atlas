import { describe, expect, it } from 'bun:test'

import {
  EBeforeToolDecision,
  EToolEffect,
  toCallId,
  toThreadId,
  type ToolCall,
} from '@dltech/atlas-core'

import ForeignCheckoutPlugin, { guardForeignCheckout } from '..'

const PROJECT = '/Users/dennis/Developer/atlas'

const callOf = (args: { name: string; input: unknown; effect?: EToolEffect | undefined }): ToolCall => ({
  callId: toCallId('call-1'),
  name: args.name,
  input: args.input,
  effect: args.effect ?? EToolEffect.Write,
  threadId: toThreadId('thread-1'),
})

const run = (args: { name?: string; input?: unknown; effect?: EToolEffect }) =>
  guardForeignCheckout({
    call: callOf({ name: args.name ?? 'write', input: args.input ?? {}, effect: args.effect }),
    projectDirectory: PROJECT,
    events: [],
    signal: new AbortController().signal,
  })

describe('guardForeignCheckout', () => {
  it('denies a write into a sibling worktree and teaches enter_worktree', async () => {
    const outcome = await run({
      input: { path: `${PROJECT}/.atlas/worktrees/cheap-shimmer/src/x.ts` },
    })

    expect(outcome.decision).toBe(EBeforeToolDecision.Deny)
    if (outcome.decision !== EBeforeToolDecision.Deny) return
    expect(outcome.reason).toContain('enter_worktree')
  })

  it('denies edit and multi_edit too, not only write', async () => {
    for (const name of ['edit', 'multi_edit']) {
      const outcome = await run({
        name,
        input: { path: `${PROJECT}/.atlas/worktrees/cheap-shimmer/src/x.ts` },
      })

      expect(outcome.decision).toBe(EBeforeToolDecision.Deny)
    }
  })

  it('allows writes inside the project directory', async () => {
    const outcome = await run({ input: { path: `${PROJECT}/packages/core/src/index.ts` } })

    expect(outcome).toEqual({
      decision: EBeforeToolDecision.Allow,
      input: { path: `${PROJECT}/packages/core/src/index.ts` },
    })
  })

  it('allows outside-project writes with no checkout segment', async () => {
    const outcome = await run({ input: { path: '/Users/dennis/.atlas/memory/note.md' } })

    expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
  })

  it('ignores non-write effects even when the call names a worktree path', async () => {
    for (const effect of [EToolEffect.Read, EToolEffect.Destructive]) {
      const outcome = await run({
        name: 'read',
        input: { path: `${PROJECT}/.atlas/worktrees/cheap-shimmer/src/x.ts` },
        effect,
      })

      expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
    }
  })

  it('ignores a write-effect call whose input carries no string path', async () => {
    for (const input of [{}, { path: 42 }, 'nope', { brief: 'look around' }]) {
      const outcome = await run({ input })

      expect(outcome.decision).toBe(EBeforeToolDecision.Allow)
    }
  })
})

describe('ForeignCheckoutPlugin', () => {
  it('contributes the guard as a before-tool hook', async () => {
    const contribution = await new ForeignCheckoutPlugin().contribute()

    expect(contribution.hooks).toHaveLength(1)
    expect(contribution.hooks?.[0]?.name).toBe('guard-writes')
    expect(contribution.hooks?.[0]?.run).toBe(guardForeignCheckout)
  })
})
