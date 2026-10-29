import { describe, expect, test } from 'bun:test'

import { activeNavOf, activeThreadIdOf } from '../active-route'
import { EShellHoverCard, shellDemoOf } from '../shell-tweaks'
import { EAppNav } from '../shell-types'
import { projectSettingsHref, threadPath } from '../thread-href'

describe('active route', () => {
  test('reads the thread id from the pathname', () => {
    expect(activeThreadIdOf('/threads/thr-snapshots')).toBe('thr-snapshots')
    expect(activeThreadIdOf('/threads/new')).toBeNull()
    expect(activeThreadIdOf('/threads')).toBeNull()
  })

  test('projects nav is active under /projects only', () => {
    expect(activeNavOf('/projects')).toBe(EAppNav.Projects)
    expect(activeNavOf('/projects/rs-crm/settings/overview')).toBe(EAppNav.Projects)
    expect(activeNavOf('/threads/thr-snapshots')).toBe(EAppNav.Threads)
  })
})

describe('hrefs', () => {
  test('build real routes', () => {
    expect(threadPath('thr-ui-rebase')).toBe('/threads/thr-ui-rebase')
    expect(projectSettingsHref('rs-crm')).toBe('/projects/rs-crm/settings/overview')
  })
})

describe('shellDemoOf', () => {
  const OFF = {
    hoverCard: EShellHoverCard.None,
    archived: false,
    accountMenu: false,
    collapsed: false,
  }

  test('is empty with every tweak off', () => {
    expect(shellDemoOf(OFF)).toEqual({})
  })

  test('maps each tweak to its demo state', () => {
    expect(shellDemoOf({ ...OFF, hoverCard: EShellHoverCard.Thread }).threadCardId).toBe(
      'thr-snapshots',
    )
    expect(shellDemoOf({ ...OFF, hoverCard: EShellHoverCard.Project }).projectCardId).toBe('rs-crm')
    expect(shellDemoOf({ ...OFF, archived: true })).toEqual({
      archivedThreadIds: ['thr-wire-zod'],
      archivedBucketOpen: true,
    })
    expect(shellDemoOf({ ...OFF, accountMenu: true, collapsed: true })).toEqual({
      accountMenuOpen: true,
      collapsed: true,
    })
  })
})
