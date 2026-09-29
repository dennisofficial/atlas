import type { Token, Tokens } from 'marked'

import { raiseSuperscripts, subscript, superscriptNumber } from './unicode'

export enum EInline {
  Text = 'text',
  Code = 'code',
  Link = 'link',
  FilePath = 'filePath',
  Image = 'image',
  Footnote = 'footnote',
}

export type InlineMarks = {
  readonly bold?: true
  readonly italic?: true
  readonly strike?: true
}

export type InlineNode =
  | {
      readonly kind: EInline.Text
      readonly text: string
      readonly marks: InlineMarks
    }
  | {
      readonly kind: EInline.Code
      readonly text: string
      readonly marks: InlineMarks
    }
  | {
      readonly kind: EInline.Link
      readonly label: readonly InlineNode[]
      readonly host: string
      readonly href: string
    }
  | {
      readonly kind: EInline.FilePath
      readonly text: string
      readonly path: string
      readonly line?: number
    }
  | {
      readonly kind: EInline.Image
      readonly alt: string
      readonly path: string
    }
  | { readonly kind: EInline.Footnote; readonly marker: string }

const HTML_COMMENT = /<!--[\s\S]*?-->/g

const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\]/g

const SINGLE_TILDE = /^~[^~]/

/**
 * A `path[:line[:column]]` mention in prose. The leading lookbehind refuses a match that starts
 * mid-URL (`https://…/a.ts:9`), mid-token (`package.json5`), or on the slash of an HTML closing
 * tag (`</summary>`); the bare-filename alternative needs a known extension so plain words never
 * link, while any slash-joined or absolute path matches extension-free.
 */
const FILE_PATH =
  /(?<![\w/@:~+.<-])(?:\/[\w.@~+-][\w.@~+\-/]*|(?:\.{1,2}\/|~\/)[\w.@~+\-/]*|(?:[\w@~+-][\w.@~+-]*\/)+[\w.@~+-]*|[\w@~+-][\w.@~+-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|py|go|rs|java|rb|yml|yaml|toml|css|html|sh)\b)(?::(\d+))?(?::(\d+))?/g

export function inlineNodes(args: {
  tokens: readonly Token[]
  order?: ReadonlyMap<string, number>
}): readonly InlineNode[] {
  return walk({
    tokens: args.tokens,
    marks: {},
    order: args.order ?? new Map(),
  })
}

export function inlinePlainText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) =>
      node.kind === EInline.Link
        ? inlinePlainText(node.label)
        : node.kind === EInline.Image
          ? node.alt
          : node.kind === EInline.Footnote
            ? node.marker
            : node.text,
    )
    .join('')
}

function walk(args: {
  tokens: readonly Token[]
  marks: InlineMarks
  order: ReadonlyMap<string, number>
}): readonly InlineNode[] {
  return args.tokens.flatMap((token) => nodesOf({ ...args, token }))
}

function nodesOf(args: {
  token: Token
  marks: InlineMarks
  order: ReadonlyMap<string, number>
}): readonly InlineNode[] {
  const { token, marks, order } = args

  if (token.type === 'strong') {
    return walk({
      tokens: childrenOf(token),
      marks: { ...marks, bold: true },
      order,
    })
  }
  if (token.type === 'em') {
    return walk({
      tokens: childrenOf(token),
      marks: { ...marks, italic: true },
      order,
    })
  }
  if (token.type === 'del') return deleted({ token: token as Tokens.Del, marks, order })
  if (token.type === 'codespan') {
    /**
     * The design pads this slab with a space either side, which its HTML does with `&nbsp;`. There
     * is no terminal equivalent: OpenTUI 0.4.5 wraps on every Unicode space — U+00A0, U+2007,
     * U+202F and U+2008 all break — so a wrap landing on the pad strands one lit cell at the right
     * margin and moves the word down. The slab hugs its text instead.
     */
    return [
      {
        kind: EInline.Code,
        text: (token as Tokens.Codespan).text,
        marks,
      },
    ]
  }
  if (token.type === 'link') return [linkNode({ token: token as Tokens.Link, marks, order })]
  if (token.type === 'image') {
    const image = token as Tokens.Image
    return [{ kind: EInline.Image, alt: image.text, path: image.href }]
  }
  if (token.type === 'br') return [{ kind: EInline.Text, text: '\n', marks }]
  if (token.type === 'escape') {
    return [{ kind: EInline.Text, text: (token as Tokens.Escape).text, marks }]
  }
  if (token.type === 'html') {
    return textNodes({
      text: stripComments((token as Tokens.HTML).raw),
      marks,
      order,
    })
  }
  if ('tokens' in token && Array.isArray(token.tokens) && token.tokens.length > 0) {
    return walk({ tokens: token.tokens, marks, order })
  }

  return textNodes({
    text: 'text' in token ? String(token.text) : token.raw,
    marks,
    order,
  })
}

function childrenOf(token: Token): readonly Token[] {
  return 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : []
}

function deleted(args: {
  token: Tokens.Del
  marks: InlineMarks
  order: ReadonlyMap<string, number>
}): readonly InlineNode[] {
  if (SINGLE_TILDE.test(args.token.raw)) {
    const lowered = subscript(args.token.text)
    if (lowered !== null) return [{ kind: EInline.Text, text: lowered, marks: args.marks }]
  }
  return walk({
    tokens: childrenOf(args.token),
    marks: { ...args.marks, strike: true },
    order: args.order,
  })
}

function linkNode(args: {
  token: Tokens.Link
  marks: InlineMarks
  order: ReadonlyMap<string, number>
}): InlineNode {
  return {
    kind: EInline.Link,
    label: walk({
      tokens: childrenOf(args.token),
      marks: args.marks,
      order: args.order,
    }),
    host: hostOf(args.token.href),
    href: args.token.href,
  }
}

export function hostOf(href: string): string {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(href)?.[1]
  if (authority === undefined) return href.replace(/^mailto:/i, '')
  return authority.replace(/^www\./i, '')
}

function stripComments(text: string): string {
  return text.replace(HTML_COMMENT, '')
}

function textNodes(args: {
  text: string
  marks: InlineMarks
  order: ReadonlyMap<string, number>
}): readonly InlineNode[] {
  const nodes: InlineNode[] = []
  let cursor = 0

  for (const hit of args.text.matchAll(FOOTNOTE_REFERENCE)) {
    const position = args.order.get(hit[1] ?? '')
    if (position === undefined || hit.index === undefined) continue

    pushPaths({ nodes, text: args.text.slice(cursor, hit.index), marks: args.marks })
    nodes.push({ kind: EInline.Footnote, marker: superscriptNumber(position) })
    cursor = hit.index + hit[0].length
  }

  pushPaths({ nodes, text: args.text.slice(cursor), marks: args.marks })
  return nodes
}

function pushPaths(args: { nodes: InlineNode[]; text: string; marks: InlineMarks }): void {
  let cursor = 0
  for (const hit of args.text.matchAll(FILE_PATH)) {
    if (hit.index === undefined) continue
    push({ nodes: args.nodes, text: args.text.slice(cursor, hit.index), marks: args.marks })
    const line = hit[1] === undefined ? undefined : Number(hit[1])
    args.nodes.push({
      kind: EInline.FilePath,
      text: hit[0],
      path: hit[0].replace(/:\d+(:\d+)?$/, ''),
      ...(line === undefined ? {} : { line }),
    })
    cursor = hit.index + hit[0].length
  }
  push({ nodes: args.nodes, text: args.text.slice(cursor), marks: args.marks })
}

function push(args: { nodes: InlineNode[]; text: string; marks: InlineMarks }): void {
  if (args.text.length === 0) return
  args.nodes.push({
    kind: EInline.Text,
    text: raiseSuperscripts(args.text),
    marks: args.marks,
  })
}
