import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { OPERATOR_INPUT_PRIVACY, OperatorInputCard } from '../operator-input-card'

const request = { requestId: 'opin_1', description: 'Paste the login code', path: '/tmp/code' }

const render = (props: { url?: string; submitting?: boolean }) =>
  renderToStaticMarkup(
    <OperatorInputCard
      request={{ ...request, ...(props.url === undefined ? {} : { url: props.url }) }}
      submitting={props.submitting ?? false}
      onSubmit={() => undefined}
    />,
  )

describe('OperatorInputCard', () => {
  it('shows what the agent asked for and the privacy note', () => {
    const html = render({})
    expect(html).toContain('Atlas needs you')
    expect(html).toContain('Paste the login code')
    expect(html).toContain(OPERATOR_INPUT_PRIVACY)
  })

  it('links the url when the request carries one', () => {
    expect(render({})).not.toContain('<a ')
    expect(render({ url: 'https://example.com/login' })).toContain(
      'href="https://example.com/login"',
    )
  })

  it('starts with Send disabled and locks the field while submitting', () => {
    expect(render({})).toContain('disabled=""')
    const html = render({ submitting: true })
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
