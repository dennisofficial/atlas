import { describe, expect, it } from 'bun:test'

import { reapOnBootWith } from '../reap-on-boot'
import { fakeApp, scriptedModelPort } from './fake-app'

const model = scriptedModelPort({ script: { thinking: '', reply: 'ok' } })

const reapersThatRecord = () => {
  const calls: string[] = []
  return {
    calls,
    reapers: {
      sandboxes: () => void calls.push('sandboxes'),
      pods: () => void calls.push('pods'),
    },
  }
}

describe('what is reaped at boot', () => {
  it('never starts the row-only Vercel sandbox reaper when pods are on', () => {
    const { calls, reapers } = reapersThatRecord()

    reapOnBootWith(reapers)(fakeApp({ model, pods: true }))

    expect(calls).toEqual(['pods'])
  })

  it('keeps the in-process sandbox reaper when pods are off', () => {
    const { calls, reapers } = reapersThatRecord()

    reapOnBootWith(reapers)(fakeApp({ model }))

    expect(calls).toEqual(['sandboxes'])
  })
})
