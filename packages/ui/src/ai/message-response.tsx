'use client'

import 'katex/dist/katex.min.css'

import { memo, useMemo } from 'react'
import type { ComponentProps } from 'react'
import { createMathPlugin } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { cn } from 'cn'
import remarkBreaks from 'remark-breaks'
import remarkGemoji from 'remark-gemoji'
import { defaultRemarkPlugins, Streamdown } from 'streamdown'

import {
  DiagramRepairContext,
  MermaidErrorView,
  type RepairDiagram,
} from './internal/diagram-repair-context'
import { remarkGithubAlerts } from './internal/markdown-alerts'
import { remarkLiteralHtml } from './internal/markdown-literal-html'
import {
  MarkdownLinkClickContext,
  markdownComponents,
  type MarkdownLinkClick,
} from './internal/markdown-elements'
import { starRuleHandler } from './internal/markdown-rules'
import { repairTableDelimiters } from './internal/markdown-tables'
import { mermaidOptions } from './internal/mermaid-theme'
import { useDiagramWheelDamping } from './internal/mermaid-wheel'

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  onLinkClick?: MarkdownLinkClick
  onRepairDiagram?: RepairDiagram
  breaks?: boolean
}

// remark-math pairs the first `$` with the next one even across a clause, so money in an agent
// reply ("for $21.94, ten times … cost $54.80") rendered as KaTeX: math mode drops the spaces,
// sets the run in a serif italic, shows `*` literally and refuses to wrap. Only `$$` is math.
const plugins = {
  mermaid,
  math: createMathPlugin({ singleDollarTextMath: false }),
}
const remarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  remarkGemoji,
  remarkGithubAlerts,
  remarkLiteralHtml,
]
const remarkPluginsWithBreaks = [...remarkPlugins, remarkBreaks]
const allowedTags = { blockquote: ['cite', 'dataAlert'] }
const remendOptions = { handlers: [starRuleHandler] }
const linkSafety = { enabled: false }
const messageMermaidOptions = {
  ...mermaidOptions,
  errorComponent: MermaidErrorView,
}

export const MessageResponse = memo(
  function MessageResponse({
    className,
    components,
    onLinkClick,
    onRepairDiagram,
    breaks = false,
    children,
    ...props
  }: MessageResponseProps) {
    const merged = useMemo(() => ({ ...markdownComponents, ...components }), [components])
    const markdown = useMemo(() => repairTableDelimiters(children ?? ''), [children])
    useDiagramWheelDamping()

    return (
      <MarkdownLinkClickContext.Provider value={onLinkClick}>
        <DiagramRepairContext.Provider value={onRepairDiagram}>
          <Streamdown
            className={cn(
              'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>*:last-child]:after:text-primary',
              className,
            )}
            allowedTags={allowedTags}
            components={merged}
            linkSafety={linkSafety}
            mermaid={messageMermaidOptions}
            plugins={plugins}
            remarkPlugins={breaks ? remarkPluginsWithBreaks : remarkPlugins}
            remend={remendOptions}
            {...props}
          >
            {markdown}
          </Streamdown>
        </DiagramRepairContext.Provider>
      </MarkdownLinkClickContext.Provider>
    )
  },
  (previous, next) =>
    previous.children === next.children &&
    previous.isAnimating === next.isAnimating &&
    previous.breaks === next.breaks &&
    previous.onLinkClick === next.onLinkClick &&
    previous.onRepairDiagram === next.onRepairDiagram,
)

MessageResponse.displayName = 'MessageResponse'
