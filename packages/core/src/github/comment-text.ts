const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g

export const stripHtmlComments = (text: string): string => text.replace(HTML_COMMENT, '')

export const reviewCommentPlace = ({
  path,
  line,
}: {
  path: string | undefined
  line: number | undefined
}): string | undefined => {
  if (path === undefined) return undefined
  return line === undefined ? path : `${path}:${line}`
}
