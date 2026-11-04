import { describe, expect, it } from 'bun:test'

import { loadHighlighter, resolveLanguage } from '../highlighter'
import { languageOfPath } from '../language-of-path'
import { SHIKI_LANGUAGES, type ShikiLanguage } from '../shiki-languages'

const languages = Object.keys(SHIKI_LANGUAGES) as ShikiLanguage[]

describe('shiki languages', () => {
  it('loads and highlights every listed language', async () => {
    const failed: string[] = []
    for (const language of languages) {
      const highlighter = await loadHighlighter(language).catch(() => null)
      if (highlighter === null || highlighter.highlight('x = 1').lines.length !== 1) {
        failed.push(language)
      }
    }

    expect(failed).toEqual([])
  }, 60_000)

  it('resolves the fence names the TUI highlights', () => {
    const fences = ['elixir', 'ex', 'hs', 'scss', 'objc', 'c#', 'f#', 'vbnet', 'vimscript', 'lua']

    expect(fences.filter((fence) => resolveLanguage(fence) === null)).toEqual([])
  })

  it('maps paths for languages the TUI highlights', () => {
    expect(languageOfPath('lib/app.ex')).toBe('elixir')
    expect(languageOfPath('src/Main.hs')).toBe('haskell')
    expect(languageOfPath('styles/site.scss')).toBe('scss')
    expect(languageOfPath('db/schema.prisma')).toBe('prisma')
    expect(languageOfPath('init.lua')).toBe('lua')
    expect(languageOfPath('Gemfile')).toBe('ruby')
  })
})
