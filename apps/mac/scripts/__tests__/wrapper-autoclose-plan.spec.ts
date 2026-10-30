import { describe, expect, test } from 'bun:test'
import { planWrapperAutoclose } from '../wrapper-autoclose-plan'

const base = {
  os: 'macos',
  wrapperPath: '/b/Atlas.app',
  plutilPath: '/usr/bin/plutil',
}

describe('planWrapperAutoclose', () => {
  test('edits the wrapper Info.plist on macOS', () => {
    expect(planWrapperAutoclose(base)).toEqual({
      kind: 'edit',
      plistPath: '/b/Atlas.app/Contents/Info.plist',
      cmd: [
        '/usr/bin/plutil',
        '-replace',
        'LSEnvironment',
        '-json',
        '{"ELECTROBUN_INSTALLER_UI_AUTOCLOSE":"1"}',
        '/b/Atlas.app/Contents/Info.plist',
      ],
    })
  })
  test('tolerates a trailing slash', () => {
    const d = planWrapperAutoclose({ ...base, wrapperPath: '/b/Atlas.app/' })
    expect(d.kind === 'edit' && d.plistPath).toBe('/b/Atlas.app/Contents/Info.plist')
  })
  test('skips off macOS', () => {
    expect(planWrapperAutoclose({ ...base, os: 'linux' }).kind).toBe('skip')
  })
  test('skips without wrapper path or plutil', () => {
    expect(planWrapperAutoclose({ ...base, wrapperPath: undefined }).kind).toBe('skip')
    expect(planWrapperAutoclose({ ...base, plutilPath: null }).kind).toBe('skip')
  })
})
