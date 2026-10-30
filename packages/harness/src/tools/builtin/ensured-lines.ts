import type { EnsuredService } from '../../services/declared-ensure'

export function ensuredLine(one: EnsuredService): string {
  const state = one.ready
    ? 'ready'
    : `NOT ready${one.reason === undefined ? '' : ` (${one.reason})`}`
  const links = one.links.map((link) => `\n    ${link.title}: ${link.url}`).join('')
  return `${one.name}  ${one.status}  ${state}${one.url === undefined ? '' : `  ${one.url}`}${links}`
}
