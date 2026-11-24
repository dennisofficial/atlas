import { describe, expect, it } from 'bun:test'
import { EMessageOrigin } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'

import { EPendingKind, pendingRows } from '../../../../store/pending-rows'
import { PendingBlock, pendingRuns } from '../pending-block'

describe('message origin in shared pending rows', () => {
  it('does not offer editing for an instruction another agent submitted', async () => {
    const rows = pendingRows({
      entries: [{ id: '1', text: 'parent instruction', via: EMessageOrigin.ParentAgent }],
      notices: [],
      agents: [],
      services: [],
    })
    const setup = await testRender(<PendingBlock rows={rows} width={90} />, {
      width: 100,
      height: 15,
    })
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('parent instruction')
      expect(setup.captureCharFrame()).not.toContain('↑ to edit')
    } finally {
      setup.renderer.destroy()
    }
  })

  it('keeps editable operator drafts separate from immutable agent instructions', () => {
    const rows = pendingRows({
      entries: [
        { id: '1', text: 'parent instruction', via: EMessageOrigin.ParentAgent },
        { id: '2', text: 'operator draft', via: EMessageOrigin.Operator },
      ],
      notices: [],
      agents: [],
      services: [],
    })

    expect(pendingRuns(rows)).toHaveLength(2)
    expect(rows).toEqual([
      { kind: EPendingKind.Operator, id: '1', text: 'parent instruction', editable: false },
      { kind: EPendingKind.Operator, id: '2', text: 'operator draft' },
    ])
  })
})
