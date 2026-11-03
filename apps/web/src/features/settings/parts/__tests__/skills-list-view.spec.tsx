import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { SkillSummary } from '@dltech/atlas-wire/web'

const pushed: string[] = []

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}))

const { SkillsTable } = await import('../skills-list-view')

function summary(
  name: string,
  usedCount30d: number,
  extra: Partial<SkillSummary> = {},
): SkillSummary {
  return {
    name,
    description: '',
    fileCount: 1,
    sizeBytes: 10,
    updatedAt: '2026-11-01T00:00:00Z',
    usage: { usedCount30d, lastUsedAt: null },
    origin: 'personal',
    overridesBuiltIn: false,
    ...extra,
  }
}

const SKILLS = [summary('tdd', 5), summary('stale', 0), summary('memory', 12)]

const BUILT_IN = summary('commit', 3, { origin: 'built-in', description: 'ships with Atlas' })
const OVERRIDING = summary('atlas', 1, { overridesBuiltIn: true })

const DETAIL_HREF = (name: string) => `/settings/skills/${name}`

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
  pushed.length = 0
})

async function renderTable(skills: SkillSummary[] = SKILLS): Promise<HTMLDivElement> {
  const node: ReactNode = (
    <SkillsTable
      skills={skills}
      now={Date.now()}
      title="Skills"
      description="desc"
      detailHref={DETAIL_HREF}
      createSkill={async () => {}}
      deleteSkills={async () => {}}
    />
  )
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

function rowNamed(element: HTMLElement, name: string): HTMLTableRowElement {
  const row = [...element.querySelectorAll<HTMLTableRowElement>('tbody tr')].find((candidate) =>
    candidate.textContent?.includes(name),
  )
  if (row === undefined) throw new Error(`no row for ${name}`)
  return row
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('SkillsTable rows', () => {
  it('opens the skill detail when a row body is clicked', async () => {
    const element = await renderTable()
    const row = rowNamed(element, 'memory')
    const cell = row.querySelectorAll('td')[2]
    if (cell === undefined) throw new Error('no usage cell')
    await click(cell)
    expect(pushed).toEqual([DETAIL_HREF('memory')])
  })

  it('toggles selection without navigating when the checkbox cell is clicked', async () => {
    const element = await renderTable()
    const row = rowNamed(element, 'tdd')
    const cell = row.querySelectorAll('td')[0]
    if (cell === undefined) throw new Error('no select cell')
    await click(cell)
    expect(pushed).toEqual([])
  })

  it('keeps the name link reachable by keyboard', async () => {
    const element = await renderTable()
    const link = element.querySelector<HTMLAnchorElement>('tbody a')
    expect(link?.getAttribute('href')).toBe(DETAIL_HREF('tdd'))
  })
})

describe('SkillsTable sort headers', () => {
  it('cycles off to ascending to descending to off and sets aria-sort', async () => {
    const element = await renderTable()
    const usageHeader = [...element.querySelectorAll('th')].find((candidate) =>
      candidate.textContent?.includes('Usage'),
    )
    if (usageHeader === undefined) throw new Error('no usage header')
    const button = usageHeader.querySelector('button')
    if (button === null) throw new Error('no usage sort button')

    expect(usageHeader.getAttribute('aria-sort')).toBe('none')
    await click(button)
    expect(usageHeader.getAttribute('aria-sort')).toBe('ascending')
    await click(button)
    expect(usageHeader.getAttribute('aria-sort')).toBe('descending')
    await click(button)
    expect(usageHeader.getAttribute('aria-sort')).toBe('none')
  })

  it('orders rows by usage descending after two clicks', async () => {
    const element = await renderTable()
    const usageHeader = [...element.querySelectorAll('th')].find((candidate) =>
      candidate.textContent?.includes('Usage'),
    )
    if (usageHeader === undefined) throw new Error('no usage header')
    const button = usageHeader.querySelector('button')
    if (button === null) throw new Error('no usage sort button')

    await click(button)
    await click(button)
    const names = [...element.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('a')?.textContent,
    )
    expect(names).toEqual(['memory', 'tdd', 'stale'])
  })
})

describe('SkillsTable built-in rows', () => {
  it('shows a Built-in badge and no checkbox for a built-in skill', async () => {
    const element = await renderTable([BUILT_IN])
    const row = rowNamed(element, 'commit')
    expect(row.textContent).toContain('Built-in')
    expect(row.querySelector('[role="checkbox"], input[type="checkbox"]')).toBeNull()
  })

  it('keeps the checkbox for a personal skill', async () => {
    const element = await renderTable([summary('tdd', 5)])
    const row = rowNamed(element, 'tdd')
    expect(row.querySelector('[role="checkbox"], input[type="checkbox"]')).not.toBeNull()
    expect(row.textContent).not.toContain('Built-in')
  })

  it('labels a personal skill that shadows a built-in as overriding it', async () => {
    const element = await renderTable([OVERRIDING])
    const row = rowNamed(element, 'atlas')
    expect(row.textContent).toContain('Overrides built-in')
  })

  it('keeps search matching across personal and built-in rows', async () => {
    const element = await renderTable([summary('tdd', 5), BUILT_IN])
    const input = element.querySelector('input')
    if (input === null) throw new Error('no search input')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(input, 'commit')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const names = [...element.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('a')?.textContent,
    )
    expect(names).toEqual(['commit'])
  })
})
