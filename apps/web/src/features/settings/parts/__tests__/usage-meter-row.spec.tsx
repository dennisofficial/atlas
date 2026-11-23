import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import type { UsageReportDto } from '@dltech/atlas-protocol'

import { UsageMeters } from '../usage-meter-row'

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

const NOW = Date.parse('2026-11-23T12:00:00.000Z')

const inMinutes = (minutes: number): string => new Date(NOW + minutes * 60_000).toISOString()

const reportOf = (overrides: Partial<UsageReportDto> = {}): UsageReportDto => ({
  accountId: 'acc_1',
  label: 'dennis@byatlas.io',
  metered: true,
  fiveHour: { utilization: 68, resetsAt: inMinutes(42) },
  sevenDay: { utilization: 41, resetsAt: inMinutes(51 * 60) },
  fetchedAt: new Date(NOW).toISOString(),
  ...overrides,
})

const classOf = (element: HTMLDivElement, text: string): string => {
  const found = [...element.querySelectorAll('span')].find(
    (span) => span.textContent?.trim() === text,
  )
  if (found === undefined) throw new Error(`no span reading ${text}`)
  return found.className
}

describe('UsageMeters', () => {
  it('colours each window by its own band', async () => {
    const element = await render(<UsageMeters report={reportOf()} now={NOW} />)

    expect(classOf(element, '68%')).toContain('text-warning')
    expect(classOf(element, '41%')).not.toContain('text-warning')
    expect(classOf(element, '41%')).not.toContain('text-destructive')
  })

  it('names the window, its reading and when it resets', async () => {
    const element = await render(<UsageMeters report={reportOf()} now={NOW} />)

    expect(element.textContent).toContain('5-hour')
    expect(element.textContent).toContain('7-day')
    expect(element.textContent).toContain('resets in 42m')
    expect(element.textContent).toContain('resets in 2d3h')
  })

  it('draws the bar only for a window the provider reports', async () => {
    const element = await render(<UsageMeters report={reportOf({ fiveHour: null })} now={NOW} />)

    const readings = [...element.querySelectorAll('span')].filter((span) =>
      span.textContent?.trim().endsWith('%'),
    )
    expect(element.textContent).toContain('—')
    expect(readings.map((span) => span.textContent?.trim())).toEqual(['41%'])
  })

  it('renders nothing for an account with no plan window', async () => {
    const element = await render(
      <UsageMeters
        report={reportOf({ metered: false, fiveHour: null, sevenDay: null })}
        now={NOW}
      />,
    )

    expect(element.innerHTML).toBe('')
  })

  it('shows the age of a reading older than five minutes', async () => {
    const element = await render(
      <UsageMeters report={reportOf({ fetchedAt: inMinutes(-7) })} now={NOW} />,
    )

    expect(element.textContent).toContain('read 7m ago')
  })

  it('shows no age while the reading is fresh', async () => {
    const element = await render(
      <UsageMeters report={reportOf({ fetchedAt: inMinutes(-4) })} now={NOW} />,
    )

    expect(element.textContent).not.toContain('read ')
  })
})
