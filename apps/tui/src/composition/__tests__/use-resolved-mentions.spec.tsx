import type { FileMention } from '@dltech/atlas-core'
import type { MentionReader } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { useResolvedMentions } from '../use-resolved-mentions'
import {
  mountProbe,
  scriptedReader,
  trackUnhandledRejections,
  type Mounted,
} from './mention-reader-fixture'

type Props = { text: string; files: MentionReader | undefined }

const seen: { mentions: readonly FileMention[]; problems: string[] } = {
  mentions: [],
  problems: [],
}

function Probe(props: Props): React.ReactNode {
  seen.mentions = useResolvedMentions({
    text: props.text,
    files: props.files,
    onProblem: (reason) => seen.problems.push(reason),
  })
  return <text>{seen.mentions.length}</text>
}

const paths = (): string[] => seen.mentions.map((mention) => mention.path)

const open: Mounted<Props>[] = []

async function mounted(props: Props): Promise<Mounted<Props>> {
  seen.mentions = []
  seen.problems = []
  const harness = await mountProbe<Props>({
    render: (next) => <Probe {...next} />,
    props,
  })
  open.push(harness)
  return harness
}

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.done()
})

describe('mentions resolved against a reader', () => {
  it('paints a mention only once the reader confirms it, asking once per spelling', async () => {
    const reader = scriptedReader()
    const harness = await mounted({ text: 'see @a.md', files: reader })

    expect(paths()).toEqual([])
    expect(reader.checked).toEqual(['a.md'])

    await harness.act(() => reader.pendingChecks[0]?.resolve(true))
    expect(paths()).toEqual(['a.md'])

    await harness.rerender({ text: 'see @a.md and', files: reader })
    expect(reader.checked).toEqual(['a.md'])
  })

  it('leaves a mention the reader denies unpainted', async () => {
    const reader = scriptedReader()
    const harness = await mounted({ text: '@nope.md', files: reader })

    await harness.act(() => reader.pendingChecks[0]?.resolve(false))
    expect(paths()).toEqual([])
  })

  it('drops the old reader’s highlight at once and resolves the draft on the new reader', async () => {
    const local = scriptedReader()
    const cloud = scriptedReader()
    const text = 'read @a.md'
    const harness = await mounted({ text, files: local })

    await harness.act(() => local.pendingChecks[0]?.resolve(true))
    expect(paths()).toEqual(['a.md'])

    await harness.rerender({ text, files: cloud })
    expect(paths()).toEqual([])
    expect(cloud.checked).toEqual(['a.md'])

    await harness.act(() => cloud.pendingChecks[0]?.resolve(false))
    expect(paths()).toEqual([])

    await harness.rerender({ text, files: local })
    expect(paths()).toEqual([])
  })

  it('ignores a previous reader’s answer that lands after the switch', async () => {
    const local = scriptedReader()
    const cloud = scriptedReader()
    const text = '@a.md'
    const harness = await mounted({ text, files: local })

    await harness.rerender({ text, files: cloud })
    await harness.act(() => local.pendingChecks[0]?.resolve(true))
    expect(paths()).toEqual([])

    await harness.act(() => cloud.pendingChecks[0]?.resolve(true))
    expect(paths()).toEqual(['a.md'])
  })

  it('reports a rejected lookup and retries when the draft changes', async () => {
    const watch = trackUnhandledRejections()
    try {
      const reader = scriptedReader()
      const harness = await mounted({ text: '@a.md', files: reader })

      await harness.act(() => reader.pendingChecks[0]?.reject(new Error('the sandbox is parked')))
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(paths()).toEqual([])
      expect(seen.problems).toHaveLength(1)
      expect(seen.problems[0]).toContain('the sandbox is parked')

      await harness.rerender({ text: '@a.md', files: reader })
      expect(reader.checked).toEqual(['a.md'])
      await harness.rerender({ text: '@a.md ok', files: reader })
      expect(reader.checked).toEqual(['a.md', 'a.md'])
      await harness.act(() => reader.pendingChecks[1]?.resolve(true))
      expect(paths()).toEqual(['a.md'])
      expect(watch.seen).toEqual([])
    } finally {
      watch.stop()
    }
  })

  it('asks the new reader again about a spelling the old one failed on', async () => {
    const local = scriptedReader()
    const cloud = scriptedReader()
    const harness = await mounted({ text: '@a.md', files: local })

    await harness.act(() => local.pendingChecks[0]?.reject(new Error('down')))
    await harness.rerender({ text: '@a.md', files: cloud })
    expect(cloud.checked).toEqual(['a.md'])
  })

  it('paints nothing and asks nothing without a reader', async () => {
    await mounted({ text: '@a.md', files: undefined })
    expect(paths()).toEqual([])
  })
})
