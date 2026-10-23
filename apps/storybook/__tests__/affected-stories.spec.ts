import { describe, expect, test } from 'bun:test'

import {
  selectAffectedStories,
  type PreviewStats,
  type StoryIndex,
} from '../scripts/affected-stories'

const KBD = './../../packages/ui/src/components/kbd.tsx'
const KBD_STORY = './../../packages/ui/src/components/kbd.stories.tsx'
const CONFIRMATION = './../../packages/ui/src/ai/confirmation.tsx'
const CONFIRMATION_STORY = './../../packages/ui/src/ai/confirmation.stories.tsx'
const BUTTON = './../../packages/ui/src/components/button.tsx'
const BUTTON_STORY = './../../packages/ui/src/components/button.stories.tsx'
const PREVIEW = './.storybook/preview.tsx'
const THEME = './src/theme.ts'

function buildStats(graph: Record<string, string[]>): PreviewStats {
  return {
    modules: Object.entries(graph).map(([id, importers]) => ({
      id,
      reasons: importers.map((moduleName) => ({ moduleName })),
    })),
  }
}

const STATS = buildStats({
  [KBD]: [KBD_STORY, CONFIRMATION],
  [CONFIRMATION]: [CONFIRMATION_STORY],
  [BUTTON]: [BUTTON_STORY],
  [KBD_STORY]: ['/virtual:/@storybook/builder-vite/storybook-stories.js'],
  [CONFIRMATION_STORY]: ['/virtual:/@storybook/builder-vite/storybook-stories.js'],
  [BUTTON_STORY]: ['/virtual:/@storybook/builder-vite/storybook-stories.js'],
  [PREVIEW]: [],
  [THEME]: [PREVIEW],
})

const INDEX: StoryIndex = {
  entries: {
    'components-kbd--default': {
      id: 'components-kbd--default',
      importPath: '../../packages/ui/src/components/kbd.stories.tsx',
      type: 'story',
    },
    'components-kbd--docs': {
      id: 'components-kbd--docs',
      importPath: '../../packages/ui/src/components/kbd.stories.tsx',
      type: 'docs',
    },
    'ai-confirmation--default': {
      id: 'ai-confirmation--default',
      importPath: '../../packages/ui/src/ai/confirmation.stories.tsx',
      type: 'story',
    },
    'ai-confirmation--denied': {
      id: 'ai-confirmation--denied',
      importPath: '../../packages/ui/src/ai/confirmation.stories.tsx',
      type: 'story',
    },
    'components-button--default': {
      id: 'components-button--default',
      importPath: '../../packages/ui/src/components/button.stories.tsx',
      type: 'story',
    },
  },
}

function select(changedFiles: string[]) {
  return selectAffectedStories({ stats: STATS, index: INDEX, changedFiles })
}

describe('selectAffectedStories', () => {
  test('a changed leaf component selects its stories transitively, skipping docs entries', () => {
    const result = select(['packages/ui/src/components/kbd.tsx'])
    expect(result.renderAll).toBe(false)
    expect(result.storyIds.sort()).toEqual([
      'ai-confirmation--default',
      'ai-confirmation--denied',
      'components-kbd--default',
    ])
  })

  test('a changed story file selects only its own stories', () => {
    const result = select(['packages/ui/src/components/button.stories.tsx'])
    expect(result.renderAll).toBe(false)
    expect(result.storyIds).toEqual(['components-button--default'])
  })

  test('a file outside the module graph selects nothing', () => {
    const result = select(['apps/tui/src/index.ts', 'README.md'])
    expect(result).toMatchObject({ renderAll: false, storyIds: [] })
  })

  test('a file under apps/storybook maps to its app-relative module id', () => {
    const result = selectAffectedStories({
      stats: buildStats({
        './src/app/auth/auth-preview.tsx': ['./src/app/auth/sign-in.stories.tsx'],
        './src/app/auth/sign-in.stories.tsx': [],
      }),
      index: {
        entries: {
          'app-auth-sign-in--default': {
            id: 'app-auth-sign-in--default',
            importPath: 'src/app/auth/sign-in.stories.tsx',
            type: 'story',
          },
        },
      },
      changedFiles: ['apps/storybook/src/app/auth/auth-preview.tsx'],
    })
    expect(result.storyIds).toEqual(['app-auth-sign-in--default'])
  })

  test('a change that reaches the preview renders everything', () => {
    const result = select(['apps/storybook/src/theme.ts'])
    expect(result.renderAll).toBe(true)
    expect(result.reason).toContain('.storybook/preview.tsx')
  })

  test('stats ids with and without the ./ prefix are treated alike', () => {
    const result = selectAffectedStories({
      stats: buildStats({
        '../../packages/ui/src/components/kbd.tsx': [
          './../../packages/ui/src/components/kbd.stories.tsx',
        ],
        '../../packages/ui/src/components/kbd.stories.tsx': [],
      }),
      index: INDEX,
      changedFiles: ['packages/ui/src/components/kbd.tsx'],
    })
    expect(result.storyIds).toEqual(['components-kbd--default'])
  })

  test.each([
    'apps/storybook/.storybook/main.ts',
    'apps/storybook/.storybook/preview.tsx',
    'apps/storybook/package.json',
    'apps/storybook/scripts/render-check.ts',
    'apps/storybook/src/anything.css',
    'packages/ui/src/styles/theme.css',
    'packages/ui/package.json',
    'bun.lock',
  ])('global trigger %s renders everything', (file) => {
    const result = select([file])
    expect(result.renderAll).toBe(true)
    expect(result.reason).toContain(file)
  })

  test('a global trigger wins over an otherwise narrow change', () => {
    expect(select(['packages/ui/src/components/kbd.tsx', 'bun.lock']).renderAll).toBe(true)
  })
})
