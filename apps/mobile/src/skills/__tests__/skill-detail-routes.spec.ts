import { describe, expect, it } from 'bun:test'
import {
  personalSkillTarget,
  groupSkillTarget,
  projectSkillTarget,
} from '@dltech/atlas-client/settings'
import { ESkillFileAction, skillFileActions, SKILL_FILE_ACTION_LABELS } from '../skill-file-actions'
import { skillFileFormInputOf } from '../skill-file-form-input'
import { skillDetailRouteOf, skillFileFormRouteOf } from '../skill-routes'
import { SETTINGS_STACK_SCREENS } from '../../settings/settings-routes'

describe('skill detail routes', () => {
  it('shows folder creation only on folders and labels every menu action', () => {
    expect(skillFileActions(false)).toEqual([ESkillFileAction.Rename, ESkillFileAction.Delete])
    expect(skillFileActions(true)).toEqual(Object.values(ESkillFileAction))
    for (const action of Object.values(ESkillFileAction))
      expect(SKILL_FILE_ACTION_LABELS[action].length).toBeGreaterThan(0)
  })
  it('opens all three scopes and registers their detail screens', () => {
    expect(skillDetailRouteOf({ target: personalSkillTarget, skill: 'test' })).toBe(
      '/settings/skills/test',
    )
    expect(
      skillDetailRouteOf({ target: groupSkillTarget({ groupId: 'g 1' }), skill: 'test' }),
    ).toBe('/group-settings/g%201/skills/test')
    expect(
      skillDetailRouteOf({ target: projectSkillTarget({ projectId: 'p' }), skill: 'test' }),
    ).toBe('/project-settings/p/skills/test')
    expect(
      SETTINGS_STACK_SCREENS.filter((screen) => screen.name.endsWith('/skills/[skillId]')),
    ).toHaveLength(3)
    expect(
      SETTINGS_STACK_SCREENS.find((screen) => screen.name === 'settings/skill-file')?.sheet,
    ).toBeDefined()
  })
  it('preserves scope, file and folder when opening the form sheet', () => {
    expect(
      skillFileFormRouteOf({
        target: { ...projectSkillTarget({ projectId: 'p' }), skill: 'test' },
        action: ESkillFileAction.Rename,
        path: 'refs',
        folder: true,
      }),
    ).toEqual({
      pathname: '/settings/skill-file',
      params: {
        scope: 'project',
        projectId: 'p',
        groupId: undefined,
        skillId: 'test',
        action: 'rename',
        path: 'refs',
        folder: 'true',
      },
    })
  })
})

describe('skill file form input', () => {
  it('rejects missing scope ids, skills and invalid actions', () => {
    expect(skillFileFormInputOf({})).toBeNull()
    expect(
      skillFileFormInputOf({ scope: 'personal', skillId: 'test', action: 'delete' }),
    ).toBeNull()
    expect(
      skillFileFormInputOf({ scope: 'project', skillId: 'test', action: 'new-file' }),
    ).toBeNull()
    expect(
      skillFileFormInputOf({ scope: 'group', skillId: 'test', action: 'rename', path: 'a.md' }),
    ).toBeNull()
    expect(
      skillFileFormInputOf({ scope: 'personal', skillId: 'test', action: 'rename' }),
    ).toBeNull()
  })
  it('creates in the selected folder and renames beside the old file', () => {
    expect(
      skillFileFormInputOf({
        scope: 'group',
        groupId: 'g',
        skillId: 'test',
        action: 'new-file',
        path: 'refs',
        folder: 'true',
      })?.basePath,
    ).toBe('refs')
    expect(
      skillFileFormInputOf({
        scope: 'personal',
        skillId: 'test',
        action: 'rename',
        path: 'refs/a.md',
      })?.basePath,
    ).toBe('refs')
  })
  it('distinguishes root upload, folder upload and exact-path replace', () => {
    const params = { scope: 'personal', skillId: 'test', action: 'upload' }
    expect(skillFileFormInputOf(params)?.replacing).toBe(false)
    expect(skillFileFormInputOf({ ...params, path: 'refs', folder: 'true' })?.replacing).toBe(false)
    expect(skillFileFormInputOf({ ...params, path: 'refs/logo.png' })?.replacing).toBe(true)
  })
})
