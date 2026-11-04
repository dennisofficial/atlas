import * as React from 'react'
import { createHighlighterCore, type GrammarState, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import { SHIKI_ALIASES, SHIKI_LANGUAGES, type ShikiLanguage } from './shiki-languages'

let highlighter: Promise<HighlighterCore> | undefined

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })

  return highlighter
}

const isShikiLanguage = (name: string): name is ShikiLanguage => name in SHIKI_LANGUAGES

export function resolveLanguage(language: string): ShikiLanguage | 'ansi' | null {
  const name = language.toLowerCase()

  if (name === 'ansi') {
    return name
  }

  if (isShikiLanguage(name)) {
    return name
  }

  return SHIKI_ALIASES[name] ?? null
}

// Loads a language and returns a highlighter for it, or null for a language
// that is not listed.
export async function loadHighlighter(language: string) {
  const lang = resolveLanguage(language)

  if (!lang) {
    return null
  }

  const shiki = await getHighlighter()

  if (lang !== 'ansi' && !shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage(SHIKI_LANGUAGES[lang])
  }

  return {
    // Returns one React node per line, and the grammar state after the last
    // line. Pass that state back to continue where the code left off.
    highlight(code: string, state?: GrammarState) {
      const tokenize = (text: string) =>
        shiki.codeToTokens(text, {
          lang,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
          grammarState: state,
        }).tokens

      // ANSI has no grammar state, so each line is tokenized on its own and
      // gets the same colors whether it arrives in one piece or streams.
      const tokens =
        lang === 'ansi' ? code.split('\n').flatMap((line) => tokenize(line)) : tokenize(code)

      return {
        lines: tokens.map((line) =>
          line.map((token, index) => (
            <span
              key={index}
              style={token.htmlStyle as React.CSSProperties}
              className="text-(--shiki-light) dark:text-(--shiki-dark)"
            >
              {token.content}
            </span>
          )),
        ),
        state: shiki.getLastGrammarState(tokens),
      }
    },
  }
}

// Returns one React node per line, or null for a language that is not listed.
export async function highlightCode(code: string, language: string) {
  const highlighter = await loadHighlighter(language)

  return highlighter ? highlighter.highlight(code).lines : null
}
