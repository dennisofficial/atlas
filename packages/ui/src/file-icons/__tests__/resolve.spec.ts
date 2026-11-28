import { describe, expect, it } from 'bun:test'
import { EFileIcon, fileIconOf } from '..'
import { FILE_EXTENSIONS, FILE_NAMES, FOLDER_NAMES } from '../rules'

describe('fileIconOf', () => {
  it.each(Object.entries(FILE_NAMES))('resolves the exact file name %s', (name, icon) => {
    expect(fileIconOf({ name, folder: false })).toBe(icon)
    expect(fileIconOf({ name: name.toUpperCase(), folder: false })).toBe(icon)
  })

  it.each(Object.entries(FILE_EXTENSIONS))('resolves extension %s', (extension, icon) => {
    expect(fileIconOf({ name: `example.${extension}`, folder: false })).toBe(icon)
  })

  it.each(Object.entries(FOLDER_NAMES))('resolves folder %s', (name, icon) => {
    expect(fileIconOf({ name, folder: true })).toBe(icon)
    expect(fileIconOf({ name: name.toUpperCase(), folder: true })).toBe(icon)
  })

  it.each([
    ['a.spec.ts', EFileIcon.TypeScriptTest],
    ['a.test.tsx', EFileIcon.ReactTest],
    ['a.stories.tsx', EFileIcon.Storybook],
    ['a.stories.ts', EFileIcon.Storybook],
    ['x.d.ts', EFileIcon.Declaration],
    ['nested.more.a.spec.ts', EFileIcon.TypeScriptTest],
    ['.hidden.spec.ts', EFileIcon.TypeScriptTest],
    ['.env.local', EFileIcon.Environment],
    ['.env.production.enc', EFileIcon.Environment],
    ['tsconfig.build.json', EFileIcon.Tsconfig],
    ['Dockerfile.production', EFileIcon.Docker],
    ['app.dockerfile', EFileIcon.Docker],
    ['docker-compose.production.yaml', EFileIcon.DockerCompose],
    ['compose.local.yml', EFileIcon.DockerCompose],
    ['README.txt', EFileIcon.Readme],
    ['LICENCE.txt', EFileIcon.License],
    ['licence', EFileIcon.License],
    ['CHANGELOG.rst', EFileIcon.Changelog],
    ['foo.unknownext', EFileIcon.File],
    ['bar', EFileIcon.File],
    ['', EFileIcon.File],
    ['.ts', EFileIcon.File],
    ['.unknown', EFileIcon.File],
    ['constructor', EFileIcon.File],
    ['a.constructor', EFileIcon.File],
    ['__proto__', EFileIcon.File],
  ])('resolves precedence and fallback for %s', (name, icon) => {
    expect(fileIconOf({ name, folder: false })).toBe(icon)
  })

  it('does not treat a folder like a file', () => {
    expect(fileIconOf({ name: 'a.spec.ts', folder: true })).toBe(EFileIcon.Folder)
    expect(fileIconOf({ name: 'constructor', folder: true })).toBe(EFileIcon.Folder)
    expect(fileIconOf({ name: 'src', folder: false })).toBe(EFileIcon.File)
  })
})
