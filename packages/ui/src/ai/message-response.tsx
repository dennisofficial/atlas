'use client'

import 'katex/dist/katex.min.css'

import { memo, useMemo } from 'react'
import type { ComponentProps } from 'react'
import { createMathPlugin } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { cn } from 'cn'
import remarkGemoji from 'remark-gemoji'
import { defaultRemarkPlugins, Streamdown } from 'streamdown'

import { remarkGithubAlerts } from './internal/markdown-alerts'
import { markdownComponents } from './internal/markdown-elements'
import { starRuleHandler } from './internal/markdown-rules'
import { mermaidOptions } from './internal/mermaid-theme'
import { useDiagramWheelDamping } from './internal/mermaid-wheel'

export type MessageResponseProps = ComponentProps<typeof Streamdown>

const plugins = { mermaid, math: createMathPlugin({ singleDollarTextMath: true }) }
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkGemoji, remarkGithubAlerts]
const allowedTags = { blockquote: ['cite', 'dataAlert'] }
const remendOptions = { handlers: [starRuleHandler] }
const linkSafety = { enabled: false }
const controls = { mermaid: { panZoom: false } }

export const MessageResponse = memo(
  function MessageResponse({ className, components, ...props }: MessageResponseProps) {
    const merged = useMemo(() => ({ ...markdownComponents, ...components }), [components])
    useDiagramWheelDamping()

    return (
      <Streamdown
        className={cn(
          'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>*:last-child]:after:text-primary',
          className,
        )}
        allowedTags={allowedTags}
        components={merged}
        controls={controls}
        linkSafety={linkSafety}
        mermaid={mermaidOptions}
        plugins={plugins}
        remarkPlugins={remarkPlugins}
        remend={remendOptions}
        {...props}
      />
    )
  },
  (previous, next) =>
    previous.children === next.children && previous.isAnimating === next.isAnimating,
)

MessageResponse.displayName = 'MessageResponse'
