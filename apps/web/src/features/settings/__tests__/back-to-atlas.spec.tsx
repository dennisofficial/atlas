import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

beforeEach(() => {
  sessionStorage.clear()
})

const { SettingsTopBar } = await import('../settings-top-bar')
const { ProjectSettingsShell } = await import('../../project-settings/project-settings-shell')
const { EProjectSettingsSection } = await import('../../project-settings/project-settings-nav')
const { rememberReturnPath } = await import('../../shell/return-path')

async function backHrefOf(node: ReactNode): Promise<string | null> {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(node))
  const link = [...container.querySelectorAll('a')].find((a) =>
    a.textContent?.includes('Back to Atlas'),
  )
  const href = link?.getAttribute('href') ?? null
  await act(async () => root.unmount())
  return href
}

const projectShell = (
  <ProjectSettingsShell projectId="prj_1" active={EProjectSettingsSection.Overview} title="" bare>
    {null}
  </ProjectSettingsShell>
)

describe('Back to Atlas', () => {
  it('returns to the thread the operator left from', async () => {
    rememberReturnPath('/threads/thr_1')
    expect(await backHrefOf(<SettingsTopBar />)).toBe('/threads/thr_1')
    expect(await backHrefOf(projectShell)).toBe('/threads/thr_1')
  })

  it('keeps the query of the page the operator left from', async () => {
    rememberReturnPath('/threads/new?project=prj_1')
    expect(await backHrefOf(<SettingsTopBar />)).toBe('/threads/new?project=prj_1')
  })

  it('falls back to the thread list when nothing was remembered', async () => {
    expect(await backHrefOf(<SettingsTopBar />)).toBe('/threads')
    expect(await backHrefOf(projectShell)).toBe('/threads')
  })

  it('ignores a stored value that is not an in-app path', async () => {
    sessionStorage.setItem('atlas:return-path', '//evil.example/threads')
    expect(await backHrefOf(<SettingsTopBar />)).toBe('/threads')
  })
})
