'use client'

import { isValidElement, useEffect, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from 'cn'
import { defaultComponents, useIsCodeFenceIncomplete } from 'streamdown'
import type { ExtraProps } from 'streamdown'

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '#components/code-block'
import { loadHighlighter } from '#lib/highlighter'

type MarkdownCodeProps = ComponentProps<'code'> & ExtraProps

const LANGUAGE_CLASS = /language-([^\s]+)/
const MERMAID_LANGUAGE = 'mermaid'
const PLAIN_LANGUAGE = 'text'

export function languageOf(className: string | undefined): string {
  return className?.match(LANGUAGE_CLASS)?.[1] ?? ''
}

export function codeTextOf(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (isValidElement<{ children?: unknown }>(children)) {
    const inner = children.props.children
    return typeof inner === 'string' ? inner : ''
  }
  return ''
}

function useHighlightedLines({
  code,
  language,
  enabled,
}: {
  code: string
  language: string
  enabled: boolean
}) {
  const [result, setResult] = useState<{
    code: string
    language: string
    lines: ReactNode[]
  } | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    loadHighlighter(language)
      .then((highlighter) => {
        if (cancelled || highlighter === null) return
        setResult({ code, language, lines: highlighter.highlight(code).lines })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [code, language, enabled])

  return result?.code === code && result.language === language ? result.lines : null
}

function FencedCode({ source, language }: { source: string; language: string }) {
  const incomplete = useIsCodeFenceIncomplete()
  const code = source.replace(/\n$/, '')
  const highlighted = useHighlightedLines({ code, language, enabled: !incomplete })
  const lines = highlighted ?? code.split('\n')

  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle className="font-mono text-xs text-muted-foreground">
          {language || PLAIN_LANGUAGE}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="max-h-96">
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function InlineCode({ node: _node, className, ...props }: MarkdownCodeProps) {
  return (
    <code
      data-slot="inline-code"
      className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]', className)}
      {...props}
    />
  )
}

export function MarkdownCode(props: MarkdownCodeProps) {
  if (!('data-block' in props)) return <InlineCode {...props} />

  const language = languageOf(props.className)
  if (language === MERMAID_LANGUAGE) return <defaultComponents.code {...props} />

  return <FencedCode source={codeTextOf(props.children)} language={language} />
}
