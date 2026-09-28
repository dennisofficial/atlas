import { testRender } from '@opentui/react/test-utils'
import { afterAll, describe, expect, test } from 'bun:test'
import React from 'react'

import { NoticeBlock } from '../notice-block'

type Setup = Awaited<ReturnType<typeof testRender>>

const mounted: Setup[] = []

afterAll(() => {
  for (const setup of mounted) setup.renderer.destroy()
})

const renderNotice = async (
  props: Partial<Parameters<typeof NoticeBlock>[0]> = {},
): Promise<Setup> => {
  const setup = await testRender(
    <NoticeBlock
      text="Sub-agent explore resumed"
      body=""
      failed={false}
      width={80}
      openHint="↵ report"
      {...props}
    />,
    { width: 80, height: 10 },
  )
  mounted.push(setup)
  await setup.flush()
  return setup
}

describe('a notice with no body', () => {
  test('shows its silent note when it has one', async () => {
    const setup = await renderNotice({ silentNote: 'reported nothing' })

    const frame = setup.captureCharFrame()
    expect(frame).toContain('Sub-agent explore resumed')
    expect(frame).toContain('reported nothing')
  })

  test('stands as its headline alone when there is nothing to say about silence', async () => {
    const setup = await renderNotice()

    const frame = setup.captureCharFrame()
    expect(frame).toContain('Sub-agent explore resumed')
    expect(frame).not.toContain('nothing')
  })
})
