import { describe, expect, it } from 'bun:test'
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

  it('offers no button when another instance holds the pod', () => {
    const markup = html('elsewhere')
    expect(markup).toContain('This pod is held by another instance')
    expect(markup).not.toContain('Wake pod')
  })
})
