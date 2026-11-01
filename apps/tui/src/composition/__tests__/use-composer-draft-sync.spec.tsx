import type { ComposerDraftApi } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { useComposerDraftSync } from '../use-composer-draft-sync'
import { mountProbe, type Mounted } from './mention-reader-fixture'

type Props = { value: string; scope: string | null; api: ComposerDraftApi | null }

type Restored = { text: string; images: readonly unknown[] }

const DEBOUNCE_SETTLED_MS = 650

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function scriptedApi(stored: string | null) {
  const calls: string[] = []
  const api: ComposerDraftApi = {
    load: async ({ scope }) => {
      calls.push(`load:${scope}`)
      return stored
    },
    save: async ({ scope, text }) => {
      calls.push(`save:${scope}:${text}`)
    },
    discard: async ({ scope }) => {
      calls.push(`discard:${scope}`)
    },
  }
  return { api, calls }
}

const restored: Restored[] = []
const editor = { current: { plainText: '' } }

function Probe(props: Props): React.ReactNode {
  const cloud = React.useMemo(() => ({ composerDraftApi: () => props.api }), [props.api])
  useComposerDraftSync({
    cloud,
    scope: props.scope,
    value: props.value,
    editor,
    tokens: { restore: (next) => restored.push(next) },
  })
  return <text>{props.value}</text>
}

const open: Mounted<Props>[] = []

async function mounted(props: Props): Promise<Mounted<Props>> {
  const harness = await mountProbe<Props>({ render: (next) => <Probe {...next} />, props })
  open.push(harness)
  return harness
}

afterEach(async () => {
  restored.length = 0
  editor.current.plainText = ''
  for (const harness of open.splice(0)) await harness.done()
})

describe('composer draft sync in the workspace', () => {
  it('restores the server draft into the composer when the conversation opens', async () => {
    const { api } = scriptedApi('left off here')
    await mounted({ value: '', scope: 'thread-1', api })
    await wait(10)

    expect(restored).toEqual([{ text: 'left off here', images: [] }])
  })

  it('leaves a composer that already holds text alone', async () => {
    const { api } = scriptedApi('left off here')
    editor.current.plainText = 'typing already'
    await mounted({ value: 'typing already', scope: 'thread-1', api })
    await wait(10)

    expect(restored).toEqual([])
  })

  it('puts only the settled text after a burst of edits', async () => {
    const { api, calls } = scriptedApi(null)
    const harness = await mounted({ value: '', scope: 'thread-1', api })

    await harness.rerender({ value: 'a', scope: 'thread-1', api })
    await harness.rerender({ value: 'ab', scope: 'thread-1', api })
    expect(calls).toEqual(['load:thread-1'])

    await wait(DEBOUNCE_SETTLED_MS)
    expect(calls).toEqual(['load:thread-1', 'save:thread-1:ab'])
  })

  it('clears the server draft when a send empties the composer', async () => {
    const { api, calls } = scriptedApi(null)
    const harness = await mounted({ value: '', scope: 'thread-1', api })

    await harness.rerender({ value: 'ship it', scope: 'thread-1', api })
    await wait(DEBOUNCE_SETTLED_MS)
    await harness.rerender({ value: '', scope: 'thread-1', api })
    await wait(10)

    expect(calls).toEqual(['load:thread-1', 'save:thread-1:ship it', 'discard:thread-1'])
  })

  it('does nothing for a fully local session', async () => {
    const withoutApi = await mounted({ value: 'a', scope: 'thread-1', api: null })
    await withoutApi.rerender({ value: 'ab', scope: 'thread-1', api: null })

    const { api, calls } = scriptedApi('stored')
    const withoutScope = await mounted({ value: 'a', scope: null, api })
    await withoutScope.rerender({ value: '', scope: null, api })
    await wait(DEBOUNCE_SETTLED_MS)

    expect(calls).toEqual([])
    expect(restored).toEqual([])
  })
})
