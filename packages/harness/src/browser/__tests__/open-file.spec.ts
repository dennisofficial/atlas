import { describe, expect, it } from 'bun:test'

import { detectInstalledEditors, EEditor, editorLaunch } from '../open-file'

const PATH = '/repo/src/main.ts'

describe('editorLaunch', () => {
  describe('the OS default opener', () => {
    it('hands the path to the macOS opener, ignoring any line', () => {
      expect(editorLaunch({ editor: EEditor.Default, platform: 'darwin', path: PATH, line: 42 })).toEqual({
        command: 'open',
        args: [PATH],
      })
    })

    it('keeps the empty title argument Windows start needs before the path', () => {
      expect(editorLaunch({ editor: EEditor.Default, platform: 'win32', path: PATH })).toEqual({
        command: 'cmd',
        args: ['/c', 'start', '', PATH],
      })
    })

    it('falls back to xdg-open everywhere else', () => {
      expect(editorLaunch({ editor: EEditor.Default, platform: 'linux', path: PATH })).toEqual({
        command: 'xdg-open',
        args: [PATH],
      })
    })
  })

  describe('cursor', () => {
    it('opens the file at a line through the -g flag', () => {
      expect(editorLaunch({ editor: EEditor.Cursor, platform: 'darwin', path: PATH, line: 42 })).toEqual({
        command: 'cursor',
        args: ['-g', `${PATH}:42`],
      })
    })

    it('omits the line suffix when no line is given', () => {
      expect(editorLaunch({ editor: EEditor.Cursor, platform: 'darwin', path: PATH })).toEqual({
        command: 'cursor',
        args: ['-g', PATH],
      })
    })
  })

  describe('code', () => {
    it('opens the file at a line through the -g flag', () => {
      expect(editorLaunch({ editor: EEditor.Code, platform: 'darwin', path: PATH, line: 7 })).toEqual({
        command: 'code',
        args: ['-g', `${PATH}:7`],
      })
    })

    it('omits the line suffix when no line is given', () => {
      expect(editorLaunch({ editor: EEditor.Code, platform: 'darwin', path: PATH })).toEqual({
        command: 'code',
        args: ['-g', PATH],
      })
    })
  })

  describe('zed', () => {
    it('opens the file at a line as a path:line argument', () => {
      expect(editorLaunch({ editor: EEditor.Zed, platform: 'darwin', path: PATH, line: 3 })).toEqual({
        command: 'zed',
        args: [`${PATH}:3`],
      })
    })

    it('omits the line suffix when no line is given', () => {
      expect(editorLaunch({ editor: EEditor.Zed, platform: 'darwin', path: PATH })).toEqual({
        command: 'zed',
        args: [PATH],
      })
    })
  })

  describe('warp', () => {
    it('opens the warp:// URI through the macOS opener', () => {
      expect(editorLaunch({ editor: EEditor.Warp, platform: 'darwin', path: PATH, line: 9 })).toEqual({
        command: 'open',
        args: [`warp://action/new_tab?path=${PATH}`],
      })
    })

    it('falls back to the OS opener off macOS, where warp:// has no handler here', () => {
      expect(editorLaunch({ editor: EEditor.Warp, platform: 'linux', path: PATH })).toEqual({
        command: 'xdg-open',
        args: [PATH],
      })
    })
  })
})

describe('detectInstalledEditors', () => {
  const noneOnPath = () => false
  const allOnPath = () => true

  it('is empty when no editor binary is on PATH and the app checks find nothing', () => {
    expect(detectInstalledEditors({ platform: 'linux', which: noneOnPath })).toEqual([])
  })

  it('finds the editors whose binaries are on PATH', () => {
    const which = (bin: string) => bin === 'cursor' || bin === 'zed'

    expect(detectInstalledEditors({ platform: 'linux', which })).toEqual([
      EEditor.Cursor,
      EEditor.Zed,
    ])
  })

  it('finds every CLI editor when all binaries are on PATH', () => {
    expect(detectInstalledEditors({ platform: 'linux', which: allOnPath })).toEqual([
      EEditor.Cursor,
      EEditor.Code,
      EEditor.Zed,
    ])
  })

  it('never reports the OS default, which is a behavior rather than an editor', () => {
    expect(detectInstalledEditors({ platform: 'linux', which: allOnPath })).not.toContain(
      EEditor.Default,
    )
  })
})
