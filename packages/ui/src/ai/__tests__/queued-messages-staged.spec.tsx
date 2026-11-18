import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { QueuedMessages } from '../queued-messages'
import { TWO_QUEUED } from '../queued-messages.fixtures'

const noop = () => undefined

const dock = (props: { stagedIds?: ReadonlySet<string> } = {}) =>
  renderToStaticMarkup(
    <QueuedMessages
      messages={TWO_QUEUED}
      onSave={noop}
      onRemove={noop}
      editingId={undefined}
      onEditingChange={noop}
      {...props}
    />,
  )

describe('QueuedMessages staged rows', () => {
  it('dims a staged message to 45% opacity without edit or withdraw actions', () => {
    const html = dock({ stagedIds: new Set(['q1']) })
    expect(html).toContain('opacity-45')
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/Edit queued message/g) ?? []).toHaveLength(1)
    expect(html.match(/Remove queued message/g) ?? []).toHaveLength(1)
  })

  it('keeps a logged pending message full opacity with its actions', () => {
    const html = dock()
    expect(html).not.toContain('opacity-45')
    expect(html).not.toContain('aria-busy="true"')
    expect(html.match(/Remove queued message/g) ?? []).toHaveLength(2)
  })

  it('labels nothing as queued on a staged row', () => {
    expect(dock({ stagedIds: new Set(['q1', 'q2']) })).not.toContain('waiting for the agent')
  })
})
