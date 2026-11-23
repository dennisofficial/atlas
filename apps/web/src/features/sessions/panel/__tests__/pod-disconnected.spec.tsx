import { describe, expect, it } from 'bun:test'
import { SESSION_ARCHIVED_MESSAGE } from '@dltech/atlas-protocol'
import { renderToStaticMarkup } from 'react-dom/server'

import { PodDisconnected } from '../pod-disconnected'

const html = (state: 'asleep' | 'waking' | 'timeout' | 'elsewhere'): string =>
  renderToStaticMarkup(<PodDisconnected tab="Files" state={state} onWake={() => undefined} />)

describe('PodDisconnected', () => {
  it('offers Wake pod while asleep', () => {
    expect(html('asleep')).toContain('Disconnected')
    expect(html('asleep')).toContain('Files live in the pod, which is asleep')
    expect(html('asleep')).toContain('Wake pod')
  })

  it('shows a spinner while waking', () => {
    const markup = html('waking')
    expect(markup).toContain('Waking pod…')
    expect(markup).not.toContain('Wake pod')
  })

  it('offers Try again after a timeout', () => {
    const markup = html('timeout')
    expect(markup).toContain('Pod did not wake')
    expect(markup).toContain('Try again')
  })

  it('says why a wake was refused when the API gives a reason', () => {
    const markup = renderToStaticMarkup(
      <PodDisconnected
        tab="Files"
        state="timeout"
        message={SESSION_ARCHIVED_MESSAGE}
        onWake={() => undefined}
      />,
    )
    expect(markup).toContain(SESSION_ARCHIVED_MESSAGE)
    expect(markup).not.toContain('Pod did not wake')
    expect(markup).toContain('Try again')
  })

  it('offers no button when another instance holds the pod', () => {
    const markup = html('elsewhere')
    expect(markup).toContain('This pod is held by another instance')
    expect(markup).not.toContain('Wake pod')
  })
})
