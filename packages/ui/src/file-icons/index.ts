import { FILE_ICON_ART } from './art'
import type { EFileIcon } from './enum'
import type { IconPath } from './types'

export { FILE_ICON_ART } from './art'
export { EFileIcon } from './enum'
export { fileIconOf } from './resolve'
export { EIconPart, type IconArt, type IconPath } from './types'

export function artOf(args: { icon: EFileIcon; open: boolean }): IconPath[] {
  const art = FILE_ICON_ART[args.icon]
  return args.open && art.open ? art.open : art.paths
}
