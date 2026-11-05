import { NEW_TAB_URL } from './browser-model'
import { parseWebUrl } from './web-url'

const NEW_TAB_TITLE = 'New tab'

export function titleOf(args: { url: string; title: string | undefined }): string {
  const { url, title } = args
  if (url === NEW_TAB_URL) return NEW_TAB_TITLE
  if (title !== undefined) return title
  const parsed = parseWebUrl(url)
  if (parsed === null) return url
  return parsed.pathname === '/' ? parsed.host : parsed.pathname
}
