import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ETranscriptKind, type SignInItem } from '../data/transcript-items'
import { TranscriptSignIn } from '../transcript/transcript-sign-in'

const URL = 'https://provider.test/authorize?client_id=c&code_challenge=xyz'

const itemOf = (extra: Partial<SignInItem> = {}): SignInItem => ({
  kind: ETranscriptKind.SignIn,
  id: 'e1',
  text: `sign in to the posthog MCP server: ${URL}`,
  subject: 'posthog',
  url: URL,
  ...extra,
})

const render = (extra: Partial<SignInItem> = {}) =>
  renderToStaticMarkup(<TranscriptSignIn item={itemOf(extra)} />)

describe('the sign-in card', () => {
  it('names the server and opens the provider in a new tab', () => {
    const html = render()

    expect(html).toContain('posthog needs a sign-in')
    expect(html).toContain('Sign in')
    expect(html).toContain('href="https://provider.test/authorize?client_id=c&amp;code_challenge=xyz"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })

  it('never prints the raw url as text', () => {
    expect(render()).not.toContain('provider.test/authorize</')
  })

  it('reads signed in once the flow resolves', () => {
    const html = render({ result: 'connected', text: 'signed in to the posthog MCP server' })

    expect(html).toContain('Signed in to posthog')
    expect(html).not.toContain('Sign in')
    expect(html).not.toContain('<a ')
  })

  it('says why a sign-in failed', () => {
    const html = render({ result: 'failed', reason: 'the provider refused the code' })

    expect(html).toContain('Could not sign in to posthog')
    expect(html).toContain('the provider refused the code')
    expect(html).not.toContain('<a ')
  })
})
