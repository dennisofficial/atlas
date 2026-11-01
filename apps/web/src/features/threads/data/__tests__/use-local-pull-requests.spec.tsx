import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EServeFrame } from '@dltech/atlas-client/channel'
import { readied } from '@dltech/atlas-client/channel-fixture'
import { EPullRequestStateWire, type WireThread } from '@dltech/atlas-wire/web'

import { ELocalPodState } from '@/features/desktop/desktop-wire'
import { localThreadOf } from '@/features/desktop/local-thread'

import { usePullRequests } from '../use-pull-requests'
import { installObservationIntersections, observationSourceRig } from './pr-observation.fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const local = localThreadOf({
  threadId: 'brn_local',
  projectId: 'project_mac',
  createdAt: new Date().toISOString(),
  state: ELocalPodState.Running,
})
const link = {
  repo: 'owner/repo',
  number: 901,
  url: 'https://github.com/owner/repo/pull/901',
  branch: 'local',
  state: EPullRequestStateWire.Open,
}

describe('local Details PR states', () => {
  it('does not call Cloud while metadata is loading or local, but keeps live pod state and rendered checks usable', async () => {
    const source = observationSourceRig()
    const intersections = installObservationIntersections()
    const serve = readied()
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    const root = createRoot(container)
    function Probe({ thread }: { thread: WireThread | undefined }) {
      const result = usePullRequests({
        threadId: local.id,
        channel: serve.channel,
        thread,
        subscribe: source.subscribe,
      })
      return (
        <section ref={result.observationRef}>
          {result.rows.map((row) => (
            <p key={row.key}>
              {row.label}:{row.checks?.passed ?? 'unknown'}
            </p>
          ))}
        </section>
      )
    }
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    try {
      await act(async () => root.render(<Probe thread={undefined} />))
      expect(source.connections).toHaveLength(0)
      await act(async () => root.render(<Probe thread={{ ...local, pullRequests: [link] }} />))
      const section = container.querySelector('section')
      if (section === null) throw new Error('Missing local Details section')
      await act(async () => intersections.emit([{ element: section, visible: true }]))
      expect(source.connections).toHaveLength(0)
      await act(async () =>
        serve.receive({
          kind: EServeFrame.PrStates,
          states: [
            { ...link, checksRunning: 0, checksPassed: 3, checksFailed: 0, mergeable: true },
          ],
        }),
      )
      expect(container.textContent).toBe('#901:3')
      await act(async () =>
        serve.receive({
          kind: EServeFrame.PrStates,
          states: [
            { ...link, checksRunning: 0, checksPassed: 4, checksFailed: 0, mergeable: true },
          ],
        }),
      )
      expect(container.textContent).toBe('#901:4')
      expect(source.connections).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      serve.channel.close()
      intersections.restore()
    }
  })
})
