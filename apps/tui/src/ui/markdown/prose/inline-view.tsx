import { TextAttributes } from '@opentui/core'
import React, { useSyncExternalStore } from 'react'

import { linkHoverUrl, subscribeLinkHover } from '../../../composition/link-click'
import { linkHoverStyle } from '../../link-hover-style'
import { glyph, theme } from '../../theme'
import { EInline, type InlineNode } from './inline'
import { codeForeground, LINK_ARROW, markAttributes, markForeground } from './prose-style'

export function InlineRun(props: {
  nodes: readonly InlineNode[]
  ground: string
  slab: string
}): React.ReactNode {
  return (
    <>
      {props.nodes.map((node, index) => (
        <InlineSpan key={index} node={node} ground={props.ground} slab={props.slab} />
      ))}
    </>
  )
}

const InlineSpan = React.memo(InnerSpan, isSameSpan)

function isSameSpan(
  previous: { node: InlineNode; ground: string; slab: string },
  next: { node: InlineNode; ground: string; slab: string },
): boolean {
  return previous.node === next.node && previous.ground === next.ground && previous.slab === next.slab
}

function InnerSpan(props: { node: InlineNode; ground: string; slab: string }): React.ReactNode {
  const { node } = props
  const href = hrefOf(node)
  const hovered = useSyncExternalStore(subscribeLinkHover, () => href !== null && linkHoverUrl() === href)
  const linkInk = hovered ? linkHoverStyle(theme.link) : { fg: theme.link }

  if (node.kind === EInline.Text) {
    return (
      <span
        fg={markForeground({ marks: node.marks, ground: props.ground })}
        attributes={markAttributes(node.marks)}
      >
        {node.text}
      </span>
    )
  }

  if (node.kind === EInline.Code) {
    return (
      <span fg={codeForeground(node.marks)} bg={props.slab} attributes={markAttributes(node.marks)}>
        {node.text}
      </span>
    )
  }

  if (node.kind === EInline.Link) {
    return (
      <>
        <span
          {...linkInk}
          attributes={TextAttributes.UNDERLINE}
          link={{ url: node.href }}
        >
          {plain(node.label)}
        </span>
        <span fg={theme.hint}>{` ${node.host} ${LINK_ARROW}`}</span>
      </>
    )
  }

  if (node.kind === EInline.FilePath) {
    const url = fileHref({ path: node.path, line: node.line })
    return (
      <span {...linkInk} attributes={TextAttributes.UNDERLINE} link={{ url }}>
        {node.text}
      </span>
    )
  }

  if (node.kind === EInline.Image) {
    return (
      <>
        <span fg={theme.court.external}>{`${glyph.image} `}</span>
        <span fg={props.ground}>{node.alt}</span>
        <span fg={theme.hint}>{` · ${node.path}`}</span>
      </>
    )
  }

  return <span fg={theme.link}>{node.marker}</span>
}

function hrefOf(node: InlineNode): string | null {
  if (node.kind === EInline.Link) return node.href
  if (node.kind === EInline.FilePath) return fileHref({ path: node.path, line: node.line })
  return null
}

function fileHref(args: { path: string; line?: number | undefined }): string {
  const line = args.line === undefined ? '' : `:${args.line}`
  return `file://${args.path}${line}`
}

function plain(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) =>
      node.kind === EInline.Text || node.kind === EInline.Code
        ? node.text
        : node.kind === EInline.Link
          ? plain(node.label)
          : node.kind === EInline.Image
            ? node.alt
            : node.kind === EInline.FilePath
              ? node.text
              : node.marker,
    )
    .join('')
}
