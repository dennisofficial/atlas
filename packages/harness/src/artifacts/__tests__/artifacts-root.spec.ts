import { describe, expect, it } from 'bun:test'

import { artifactFolderNameOf, artifactsRootOf } from '../artifacts-root'

describe('artifactsRootOf', () => {
  it('uses the workspaces tree in a cloud pod', () => {
    expect(
      artifactsRootOf({
        projectDirectory: '/atlas/workspaces/workspace',
        atlasHome: '/atlas/home',
      }),
    ).toBe('/atlas/workspaces/artifacts')
  })

  it('keeps the pod path for a worktree beside the workspace', () => {
    expect(
      artifactsRootOf({
        projectDirectory: '/atlas/workspaces/atlas/.atlas/worktrees/dennis/x',
        atlasHome: '/atlas/home',
      }),
    ).toBe('/atlas/workspaces/artifacts')
  })

  it('uses atlas home on a developer machine', () => {
    expect(
      artifactsRootOf({
        projectDirectory: '/Users/dennis/Developer/atlas',
        atlasHome: '/Users/dennis/.atlas',
      }),
    ).toBe('/Users/dennis/.atlas/artifacts')
  })

  it('treats a directory named like the root but outside it as local', () => {
    expect(
      artifactsRootOf({
        projectDirectory: '/atlas/workspaces-other/workspace',
        atlasHome: '/atlas/home',
      }),
    ).toBe('/atlas/home/artifacts')
  })
})

describe('artifactFolderNameOf', () => {
  it('keeps a name that is already a slug', () => {
    expect(artifactFolderNameOf('todo-app')).toBe('todo-app')
  })

  it('lowers case and folds runs of punctuation into one dash', () => {
    expect(artifactFolderNameOf('Poker  Dealer!')).toBe('poker-dealer')
    expect(artifactFolderNameOf('a/b_c.d')).toBe('a-b-c-d')
  })

  it('trims leading and trailing dashes', () => {
    expect(artifactFolderNameOf('  --Demo--  ')).toBe('demo')
  })

  it('falls back when nothing usable is left', () => {
    expect(artifactFolderNameOf('')).toBe('artifact')
    expect(artifactFolderNameOf('***')).toBe('artifact')
  })

  it('caps the folder name at 60 characters', () => {
    const slug = artifactFolderNameOf('a'.repeat(80))

    expect(slug).toHaveLength(60)
  })

  it('drops a dash the cap would leave dangling', () => {
    expect(artifactFolderNameOf(`${'a'.repeat(59)}-b`)).toBe('a'.repeat(59))
  })
})
