'use client'

import { createContext, useContext, type ComponentProps, type MouseEvent } from 'react'
import { cn } from 'cn'
import type { Components, ExtraProps } from 'streamdown'

import { Separator } from '#components/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#components/table'
import {
  MarkdownBlockquote,
  MarkdownInput,
  MarkdownListItem,
  MarkdownOrderedList,
  MarkdownUnorderedList,
} from './markdown-blocks'
import { MarkdownCode } from './markdown-code'

const INCOMPLETE_LINK = 'streamdown:incomplete-link'

export type MarkdownLinkClick = (args: {
  href: string
  event: MouseEvent<HTMLAnchorElement>
}) => void

export const MarkdownLinkClickContext = createContext<MarkdownLinkClick | undefined>(undefined)

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

const HEADING_CLASSES: Record<HeadingTag, string> = {
  h1: 'mt-6 mb-2 text-lg font-semibold text-balance',
  h2: 'mt-5 mb-2 text-base font-semibold text-balance text-primary',
  h3: 'mt-4 mb-1.5 text-sm font-semibold text-balance',
  h4: 'mt-4 mb-1.5 text-sm font-medium text-balance',
  h5: 'mt-3 mb-1 text-sm font-medium text-muted-foreground',
  h6: 'mt-3 mb-1 text-xs font-medium text-muted-foreground uppercase',
}

function heading(Tag: HeadingTag) {
  return function MarkdownHeading({
    node: _node,
    className,
    ...props
  }: ComponentProps<'h1'> & ExtraProps) {
    return <Tag className={cn(HEADING_CLASSES[Tag], className)} {...props} />
  }
}

function MarkdownLink({
  node: _node,
  className,
  href,
  children,
  target: _target,
  rel: _rel,
  onClick,
  ...props
}: ComponentProps<'a'> & ExtraProps) {
  const onLinkClick = useContext(MarkdownLinkClickContext)
  if (href === INCOMPLETE_LINK) return <span>{children}</span>
  const inPage = href?.startsWith('#') ?? false
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (href !== undefined) onLinkClick?.({ href, event })
  }

  return (
    <a
      href={href}
      target={inPage ? undefined : '_blank'}
      rel={inPage ? undefined : 'noreferrer'}
      className={cn(
        'font-medium wrap-anywhere text-link underline-offset-4 hover:underline',
        className,
      )}
      {...props}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}

function MarkdownTable({ node: _node, className, ...props }: ComponentProps<'table'> & ExtraProps) {
  return <Table variant="framed" className={className} {...props} />
}

function MarkdownTableHeader({ node: _node, ...props }: ComponentProps<'thead'> & ExtraProps) {
  return <TableHeader {...props} />
}

function MarkdownTableBody({ node: _node, ...props }: ComponentProps<'tbody'> & ExtraProps) {
  return <TableBody {...props} />
}

function MarkdownTableRow({ node: _node, ...props }: ComponentProps<'tr'> & ExtraProps) {
  return <TableRow {...props} />
}

function MarkdownTableHead({
  node: _node,
  className,
  ...props
}: ComponentProps<'th'> & ExtraProps) {
  return <TableHead className={cn('whitespace-normal', className)} {...props} />
}

function MarkdownTableCell({
  node: _node,
  className,
  ...props
}: ComponentProps<'td'> & ExtraProps) {
  return <TableCell className={cn('align-top whitespace-normal', className)} {...props} />
}

function MarkdownRule() {
  return <Separator className="my-6" />
}

export const markdownComponents: Components = {
  a: MarkdownLink,
  blockquote: MarkdownBlockquote,
  code: MarkdownCode,
  input: MarkdownInput,
  li: MarkdownListItem,
  ol: MarkdownOrderedList,
  ul: MarkdownUnorderedList,
  h1: heading('h1'),
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
  h5: heading('h5'),
  h6: heading('h6'),
  hr: MarkdownRule,
  table: MarkdownTable,
  thead: MarkdownTableHeader,
  tbody: MarkdownTableBody,
  tr: MarkdownTableRow,
  th: MarkdownTableHead,
  td: MarkdownTableCell,
}
