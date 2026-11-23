import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, useState, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import type { Account } from '../../../data/personal/accounts-api'
import { ClassifierCard } from '../classifier-card'

const GATEWAY_KEY = 'gateway/typesafe-ai/jev'
const TYPESAFE_DIRECT = 'typesafe/jev-latest'
const OPENAI_DECISIONS = 'openai/gpt-6-luna'

const account = (args: { id: string; provider: string; kind: string }): Account => ({
  id: args.id,
  provider: args.provider,
  kind: args.kind,
  label: args.kind === 'api-key' ? 'Key saved' : args.provider,
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
})

const gatewayKey = [account({ id: 'acc_gw', provider: 'gateway', kind: 'api-key' })]

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

const click = async (element: Element | null | undefined): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const press = async (element: Element): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: 'mouse',
      }),
    )
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const buttonNamed = (name: string): Element | undefined =>
  [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === name)

const Card = ({
  stored,
  accounts,
  lastTest = null,
  dirty = false,
  onPickModel = () => {},
  onTest = () => {},
  onSave = () => {},
}: {
  stored: string
  accounts: readonly Account[]
  lastTest?:
    | { ok: true; model: string; ms: number }
    | { ok: false; fault: string; detail: string }
    | null
  dirty?: boolean
  onPickModel?: (model: string) => void
  onTest?: () => void
  onSave?: () => void
}) => (
  <ClassifierCard
    stored={stored}
    accounts={accounts}
    lastTest={lastTest}
    skillsSuggest
    qualityEnabled={false}
    dirty={dirty}
    saving={false}
    testing={false}
    credentialRow={null}
    onPickModel={onPickModel}
    onTest={onTest}
    onSave={onSave}
    onDiscard={() => {}}
  />
)

describe('ClassifierCard states', () => {
  it('reads not set up and offers the saved provider', async () => {
    const element = await render(<Card stored="" accounts={gatewayKey} />)

    expect(element.textContent).toContain('No classifier is set.')
    expect(buttonNamed('Use Jev through Vercel AI Gateway')).toBeDefined()
  })

  it('reads set up and working', async () => {
    const element = await render(
      <Card
        stored={GATEWAY_KEY}
        accounts={gatewayKey}
        lastTest={{ ok: true, model: 'typesafe-ai/jev', ms: 210 }}
      />,
    )

    expect(element.textContent).toContain('Vercel AI Gateway is connected.')
    expect(element.textContent).toContain('● Working — typesafe-ai/jev, 210 ms')
    expect(buttonNamed('Use Jev through Vercel AI Gateway')).toBeUndefined()
  })

  it('reads a missing credential', async () => {
    const element = await render(<Card stored={TYPESAFE_DIRECT} accounts={[]} />)

    expect(element.textContent).toContain('Off — TypeSafe AI is not connected.')
  })

  it('reads a provider error from the last test', async () => {
    const element = await render(
      <Card
        stored={OPENAI_DECISIONS}
        accounts={[account({ id: 'acc_key', provider: 'openai', kind: 'api-key' })]}
        lastTest={{ ok: false, fault: 'rejected', detail: 'the provider refused the key (401).' }}
      />,
    )

    expect(element.textContent).toContain('Off — the provider refused the key (401).')
  })

  it('disables Test until the draft is saved', async () => {
    const element = await render(<Card stored={GATEWAY_KEY} accounts={gatewayKey} dirty />)

    expect(element.textContent).toContain('Save first')
    const test = [...element.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Test',
    )
    expect(test).toBeDefined()
    expect(test?.hasAttribute('disabled')).toBe(true)
  })
})

describe('ClassifierCard draft', () => {
  it('writes nothing until Save when the suggestion is used', async () => {
    const onPickModel = mock(() => {})
    const onSave = mock(() => {})
    await render(<Card stored="" accounts={gatewayKey} onPickModel={onPickModel} onSave={onSave} />)

    await click(buttonNamed('Use Jev through Vercel AI Gateway'))

    expect(onPickModel).toHaveBeenCalledWith(GATEWAY_KEY)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('sets the draft to the ref when a model is picked', async () => {
    const picked: string[] = []
    const Harness = () => {
      const [model, setModel] = useState('')
      return (
        <Card
          stored={model}
          accounts={gatewayKey}
          onPickModel={(next) => {
            picked.push(next)
            setModel(next)
          }}
        />
      )
    }
    await render(<Harness />)

    const trigger = document.querySelector('[aria-label="Classifier model"]')
    if (trigger === null) throw new Error('no model select rendered')
    await press(trigger)
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (candidate) => candidate.textContent?.trim() === 'Jev through Vercel AI Gateway',
    )
    if (option === undefined) throw new Error('the model option did not render')
    await press(option)

    expect(picked).toEqual([GATEWAY_KEY])
  })
})
