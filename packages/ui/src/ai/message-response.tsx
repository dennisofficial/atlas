'use client'

import { memo, useMemo } from 'react'
import type { ComponentProps } from 'react'
import { mermaid } from '@streamdown/mermaid'
import { cn } from 'cn'
import { Streamdown } from 'streamdown'

import { mermaidOptions } from './internal/mermaid-theme'
import { markdownComponents } from './internal/markdown-elements'

export type MessageResponseProps = ComponentProps<typeof Streamdown>

const plugins = { mermaid }
const linkSafety = { enabled: false }
const controls = { mermaid: { panZoom: false } }

export const MessageResponse = memo(
  function MessageResponse({ className, components, ...props }: MessageResponseProps) {
    const merged = useMemo(() => ({ ...markdownComponents, ...components }), [components])

    return (
      <Streamdown
        className={cn(
          'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>*:last-child]:after:text-primary',
          className,
        )}
        components={merged}
        controls={controls}
        linkSafety={linkSafety}
        mermaid={mermaidOptions}
        plugins={plugins}
        {...props}
      />
    )
  },
  (previous, next) =>
    previous.children === next.children && previous.isAnimating === next.isAnimating,
)

MessageResponse.displayName = 'MessageResponse'
