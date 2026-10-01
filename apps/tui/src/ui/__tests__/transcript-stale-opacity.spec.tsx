import { describe, expect, it } from 'bun:test'
import React from 'react'

import { testRender } from '@opentui/react/test-utils'

import { grammarsReady, teardown } from '../markdown/__tests__/harness'
import { frameSettled } from './waiting'
import { HEIGHT, SETTLED, transcript } from './transcript-fixture'

await grammarsReady()

type Node = { id: string; opacity: number; getChildren: () => readonly unknown[] }

const walk = (node: unknown, into: Node[]): void => {
  const candidate = node as Partial<Node>
  if (typeof candidate.opacity === 'number' && typeof candidate.id === 'string') {
    into.push(candidate as Node)
  }
  for (const child of candidate.getChildren?.() ?? []) walk(child, into)
}

const entryOpacities = async (stale: boolean): Promise<Map<string, number>> => {
  const setup = await testRender(
    <box flexDirection="column" width={80} height={HEIGHT}>
      {transcript({ model: SETTLED, width: 80, stale })}
    </box>,
    { width: 80, height: HEIGHT },
  )
  try {
    await frameSettled({ setup })
    const nodes: Node[] = []
    walk(setup.renderer.root, nodes)
    const keys = new Set(SETTLED.entries.map((entry) => entry.key))
    return new Map(
      nodes.filter((node) => keys.has(node.id)).map((node) => [node.id, node.opacity]),
    )
  } finally {
    await teardown(setup)
  }
}

describe('a transcript whose freshness is unproven', () => {
  it('mutes every entry through opacity when stale, without a disconnected socket', async () => {
    const opacities = await entryOpacities(true)

    expect(opacities.size).toBeGreaterThan(0)
    for (const opacity of opacities.values()) expect(opacity).toBe(0.4)
  })

  it('draws the same entries at full strength once freshness is proven', async () => {
    const opacities = await entryOpacities(false)

    expect(opacities.size).toBeGreaterThan(0)
    for (const opacity of opacities.values()) expect(opacity).toBe(1)
  })
})
