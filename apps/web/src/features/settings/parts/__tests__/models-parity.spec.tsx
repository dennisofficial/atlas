import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import type { ModelPicker } from '@/features/threads/data/use-model-picker'

import { BUILT_IN_AGENT_META, BUILT_IN_AGENT_ORDER } from '../../fixtures/settings-agent'
import { RoleCard } from '../agent-role-card'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
})

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  if (container === null) {
    container = document.createElement('div')
    document.body.append(container)
  }
  if (root === null) root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
}))

const PICKER: ModelPicker = {
  ready: true,
  options: { models: [], reconnectProviders: [] },
  personalId: '',
  personalEffort: '',
  pinned: [],
  onPinnedChange: () => undefined,
}

describe('built-in sub-agent role cards', () => {
  it('renders one model-only card per built-in type', async () => {
    for (const type of BUILT_IN_AGENT_ORDER) {
      const element = await render(
        <RoleCard
          meta={BUILT_IN_AGENT_META[type]}
          setting={{ model: 'auto' }}
          picker={PICKER}
          onChange={() => undefined}
        />,
      )
      expect(element.textContent).toContain(`${type} agents`)
      expect(element.textContent).toContain('Follow sub-agents')
      expect(element.textContent).not.toContain('Effort')
    }
  })
})
