export enum EMarkdownAlert {
  Note = 'note',
  Tip = 'tip',
  Important = 'important',
  Warning = 'warning',
  Caution = 'caution',
}

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: { hProperties?: Record<string, unknown> }
}

const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*\n?/i
const ALERT_KINDS = new Set<string>(Object.values(EMarkdownAlert))

export function isMarkdownAlert(value: unknown): value is EMarkdownAlert {
  return typeof value === 'string' && ALERT_KINDS.has(value)
}

function stripMarker(paragraph: MarkdownNode): EMarkdownAlert | null {
  const first = paragraph.children?.[0]
  if (first?.type !== 'text' || first.value === undefined) return null

  const match = first.value.match(ALERT_MARKER)
  const kind = match?.[1]?.toLowerCase()
  if (!match || !isMarkdownAlert(kind)) return null

  first.value = first.value.slice(match[0].length)
  if (first.value === '') paragraph.children?.shift()
  if (paragraph.children?.[0]?.type === 'break') paragraph.children.shift()
  return kind
}

function markAlert(blockquote: MarkdownNode) {
  const paragraph = blockquote.children?.[0]
  if (paragraph?.type !== 'paragraph') return

  const kind = stripMarker(paragraph)
  if (kind === null) return

  if (paragraph.children?.length === 0) blockquote.children?.shift()
  blockquote.data = { ...blockquote.data, hProperties: { dataAlert: kind } }
}

function walk(node: MarkdownNode) {
  if (node.type === 'blockquote') markAlert(node)
  for (const child of node.children ?? []) walk(child)
}

export function remarkGithubAlerts() {
  return walk
}
