import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

import { teardown } from '../markdown/__tests__/harness'
import { ContextSection } from '../components/sidebar/context'

const WIDTH = 40
const HEIGHT = 10

const mount = (node: React.ReactNode) =>
  testRender(
    <box flexDirection="column" width={WIDTH} height={HEIGHT}>
      {node}
    </box>,
    { width: WIDTH, height: HEIGHT },
  )

describe('the context sidebar section', () => {
  it('lists the files with their marks', async () => {
    const setup = await mount(
      <ContextSection
        entries={[{ name: 'plan.md', isDirectory: false }, { name: 'notes', isDirectory: true }]}
        loading={false}
        cells={30}
        onOpen={() => undefined}
      />,
    )
    try {
      await setup.flush()
      const text = setup.captureCharFrame()
      expect(text).toContain('CONTEXT')
      expect(text).toContain('plan.md')
      expect(text).toContain('notes/')
    } finally {
      await teardown(setup)
    }
  })

  it('explains loading and empty folders', async () => {
    const loading = await mount(
      <ContextSection entries={[]} loading={true} cells={30} onOpen={() => undefined} />,
    )
    try {
      await loading.flush()
      expect(loading.captureCharFrame()).toContain('Reading context…')
    } finally {
      await teardown(loading)
    }

    const empty = await mount(
      <ContextSection entries={[]} loading={false} cells={30} onOpen={() => undefined} />,
    )
    try {
      await empty.flush()
      expect(empty.captureCharFrame()).toContain('No context files yet')
    } finally {
      await teardown(empty)
    }
  })

  it('opens the named file on click', async () => {
    const opened: string[] = []
    const setup = await mount(
      <ContextSection
        entries={[{ name: 'plan.md', isDirectory: false }]}
        loading={false}
        cells={30}
        onOpen={(name) => opened.push(name)}
      />,
    )
    try {
      await setup.flush()
      const rows = setup.captureCharFrame().split('\n')
      const row = rows.findIndex((line) => line.includes('plan.md'))
      const column = (rows[row] ?? '').indexOf('plan.md')
      expect(row).toBeGreaterThanOrEqual(0)

      await act(async () => {
        await setup.mockMouse.click(column, row)
      })
      await setup.flush()

      expect(opened).toEqual(['plan.md'])
    } finally {
      await teardown(setup)
    }
  })
})
