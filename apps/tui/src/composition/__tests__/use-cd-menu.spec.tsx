import type { DirectoryEntry } from '@dltech/atlas-core'
import type { MentionReader } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { useCdMenu, type CdMenuControl } from '../use-cd-menu'
import { mountProbe, press, scriptedReader, type Mounted } from './mention-reader-fixture'

type Props = { files: MentionReader | undefined }

type Probe = {
  control: CdMenuControl | null
  completions: string[]
}

const probe: Probe = { control: null, completions: [] }

function Menu(props: Props): React.ReactNode {
  probe.control = useCdMenu({
    files: props.files,
    currentDirectory: '/workspace/atlas',
    onComplete: (text) => probe.completions.push(text),
  })
  return <text>{probe.control.state === null ? 'closed' : 'open'}</text>
}

const control = (): CdMenuControl => {
  if (probe.control === null) throw new Error('the probe never mounted')
  return probe.control
}

const directory = (name: string): DirectoryEntry => ({
  name,
  isDirectory: true,
})

const open: Mounted<Props>[] = []

async function mounted(files: MentionReader): Promise<Mounted<Props>> {
  probe.control = null
  probe.completions = []
  const harness = await mountProbe<Props>({
    render: (props) => <Menu {...props} />,
    props: { files },
  })
  open.push(harness)
  return harness
}

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.done()
})

describe('the cd menu', () => {
  it('opens on the listing of the typed directory and completes on tab', async () => {
    const reader = scriptedReader()
    const harness = await mounted(reader)

    await harness.act(() => control().handleTextChanged('/cd /tmp/al'))
    await harness.act(() =>
      reader.pendingLists[0]?.resolve([directory('alpha'), directory('beta')]),
    )
    expect(control().state?.matches.map((entry) => entry.name)).toEqual(['alpha'])

    await harness.act(() => void control().handleKey(press('tab')))
    expect(probe.completions).toEqual(['/cd /tmp/alpha/'])
    expect(control().state).toBeNull()
  })

  it('does not complete a stale menu once the draft has changed, even before React re-renders', async () => {
    const reader = scriptedReader()
    const harness = await mounted(reader)

    await harness.act(() => control().handleTextChanged('/cd /tmp/'))
    await harness.act(() => reader.pendingLists[0]?.resolve([directory('alpha')]))
    expect(control().state).not.toBeNull()

    const rendered = control()
    let consumed = true
    await harness.act(() => {
      rendered.handleTextChanged('look around')
      consumed = rendered.handleKey(press('return'))
    })

    expect(consumed).toBe(false)
    expect(probe.completions).toEqual([])
    expect(control().state).toBeNull()
  })

  it('treats a key as unconsumed when the listing has landed but React has not rendered it yet', async () => {
    const reader = scriptedReader()
    const harness = await mounted(reader)

    await harness.act(() => control().handleTextChanged('/cd /tmp/'))

    const rendered = control()
    let consumed = false
    await harness.act(async () => {
      reader.pendingLists[0]?.resolve([directory('alpha')])
      await Promise.resolve()
      consumed = rendered.handleKey(press('tab'))
    })

    expect(consumed).toBe(true)
    expect(probe.completions).toEqual(['/cd /tmp/alpha/'])
  })
})
