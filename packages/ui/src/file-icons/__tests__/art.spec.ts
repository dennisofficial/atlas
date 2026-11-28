import { describe, expect, it } from 'bun:test'
import { artOf, EFileIcon, EIconPart, FILE_ICON_ART } from '..'
import { FILE_EXTENSIONS, FILE_NAME_PATTERNS, FILE_NAMES, FOLDER_NAMES } from '../rules'

describe('file icon art', () => {
  it.each(Object.values(EFileIcon))('has valid art for %s', (icon) => {
    const art = FILE_ICON_ART[icon]
    expect(art).toBeDefined()
    expect(art.viewBox).toMatch(/^\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/)
    expect(art.paths.length).toBeGreaterThan(0)
    const folder = icon.startsWith('folder')
    if (folder) expect(art.open?.length).toBeGreaterThan(0)
    else expect(art.open).toBeUndefined()
    for (const paths of [art.paths, ...(art.open ? [art.open] : [])]) {
      for (const path of paths) {
        expect(path.d.length).toBeGreaterThan(0)
        expect(path.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/)
        if (path.fill !== null) expect(path.fill).toMatch(/^#[\da-f]{6}$/)
        expect(Object.values(EIconPart)).toContain(path.part)
        if (!folder) expect(path.part).toBe(EIconPart.Glyph)
      }
      if (folder) expect(paths.some((path) => path.part === EIconPart.Body)).toBe(true)
    }
  })

  it('only references icons that have art', () => {
    for (const table of [FILE_NAMES, FILE_EXTENSIONS, FOLDER_NAMES]) {
      for (const [name, icon] of Object.entries(table)) {
        expect(name).toBe(name.toLowerCase())
        expect(FILE_ICON_ART[icon]).toBeDefined()
      }
    }
    for (const rule of FILE_NAME_PATTERNS) expect(FILE_ICON_ART[rule.icon]).toBeDefined()
  })

  it('uses open paths only when the icon has an open variant', () => {
    expect(FILE_ICON_ART[EFileIcon.Folder].open).toBe(artOf({ icon: EFileIcon.Folder, open: true }))
    expect(artOf({ icon: EFileIcon.Folder, open: false })).toBe(
      FILE_ICON_ART[EFileIcon.Folder].paths,
    )
    expect(artOf({ icon: EFileIcon.TypeScript, open: true })).toBe(
      FILE_ICON_ART[EFileIcon.TypeScript].paths,
    )
  })

  it('keeps neutral brand marks visible using the foreground', () => {
    for (const icon of [EFileIcon.Vercel, EFileIcon.Agents]) {
      expect(FILE_ICON_ART[icon].paths.some((path) => path.fill === null)).toBe(true)
    }
  })
})
