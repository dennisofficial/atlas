import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  OPERATOR_INPUT_PRIVACY,
  OPERATOR_INPUT_WAITING,
  OperatorInputCard,
  type OperatorInputCardProps,
} from '../operator-input-card'

const ask = {
  requestId: 'opin_1',
  description: 'Paste the login code',
}

const render = (props: Partial<OperatorInputCardProps> = {}) =>
  renderToStaticMarkup(
    <OperatorInputCard {...ask} submitting={false} onSubmit={() => undefined} {...props} />,
  )

describe('OperatorInputCard', () => {
  it('shows what the agent asked for and the privacy note', () => {
    const html = render()
    expect(html).toContain('Atlas needs you')
    expect(html).toContain('Paste the login code')
    expect(html).toContain(OPERATOR_INPUT_PRIVACY)
  })

  it('links the url when the request carries one', () => {
    expect(render()).not.toContain('<a ')
    expect(render({ url: 'https://example.com/login' })).toContain(
      'href="https://example.com/login"',
    )
  })

  it('always renders the plain textarea, never a masked field', () => {
    const html = render()
    expect(html).toContain('<textarea')
    expect(html).not.toContain('type="password"')
  })

  it('starts with Send disabled and locks the field while submitting', () => {
    expect(render()).toContain('disabled=""')
    const html = render({ submitting: true })
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain(OPERATOR_INPUT_WAITING)
  })

  it('shows an error line only when the host refused the answer', () => {
    expect(render()).not.toContain('role="alert"')
    expect(render({ error: 'the agent host refused the answer (400)' })).toContain(
      'the agent host refused the answer (400)',
    )
  })

  it('offers Cancel only when the caller can cancel', () => {
    expect(render()).not.toContain('Cancel')
    expect(render({ onCancel: () => undefined })).toContain('Cancel')
  })
})
