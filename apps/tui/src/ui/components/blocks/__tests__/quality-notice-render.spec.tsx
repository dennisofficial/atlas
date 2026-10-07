import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { grammarsReady, teardown } from '../../../markdown/__tests__/harness'
import { QualityNoticeBlock } from '../quality-notice-block'

await grammarsReady()

const WIDTH = 80

const BODY = `src/widget.ts · class Widget · Single responsibility
Split the independent behavior.`

describe('a quality notice', () => {
  it('shows the finding title collapsed and its details expanded', async () => {
    const collapsed = await testRender(
      <box flexDirection="column" width={WIDTH} height={10}>
        <QualityNoticeBlock
          text="Single responsibility"
          body={BODY}
          failure={false}
          width={WIDTH}
          expanded={false}
          onToggle={() => undefined}
        />
      </box>,
      { width: WIDTH, height: 10 },
    )
    try {
      await collapsed.flush()
      expect(collapsed.captureCharFrame()).toContain('Single responsibility')
      expect(collapsed.captureCharFrame()).not.toContain('Split the independent behavior')
    } finally {
      await teardown(collapsed)
    }

    const expanded = await testRender(
      <box flexDirection="column" width={WIDTH} height={10}>
        <QualityNoticeBlock
          text="Single responsibility"
          body={BODY}
          failure={false}
          width={WIDTH}
          expanded
          onToggle={() => undefined}
        />
      </box>,
      { width: WIDTH, height: 10 },
    )
    try {
      await expanded.flush()
      expect(expanded.captureCharFrame()).toContain('src/widget.ts · class Widget · Single responsibility')
      expect(expanded.captureCharFrame()).toContain('Split the independent behavior')
    } finally {
      await teardown(expanded)
    }
  })

  it('shows an operational failure compactly', async () => {
    const setup = await testRender(
      <box flexDirection="column" width={WIDTH} height={8}>
        <QualityNoticeBlock
          text="Review failed · timed out"
          body="review exceeded 1000ms"
          failure
          width={WIDTH}
          onToggle={() => undefined}
        />
      </box>,
      { width: WIDTH, height: 8 },
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('Review failed · timed out')
    } finally {
      await teardown(setup)
    }
  })
})
