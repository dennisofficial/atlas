import { EFileIcon } from './enum'
import { FILE_EXTENSIONS, FILE_NAME_PATTERNS, FILE_NAMES, FOLDER_NAMES } from './rules'

export function fileIconOf(args: { name: string; folder: boolean }): EFileIcon {
  const name = args.name.toLowerCase()
  if (args.folder)
    return Object.hasOwn(FOLDER_NAMES, name)
      ? (FOLDER_NAMES[name] ?? EFileIcon.Folder)
      : EFileIcon.Folder
  if (Object.hasOwn(FILE_NAMES, name)) return FILE_NAMES[name] ?? EFileIcon.File
  for (const rule of FILE_NAME_PATTERNS) {
    if (rule.pattern.test(name)) return rule.icon
  }
  for (let dot = name.indexOf('.', 1); dot !== -1; dot = name.indexOf('.', dot + 1)) {
    const extension = name.slice(dot + 1)
    if (Object.hasOwn(FILE_EXTENSIONS, extension))
      return FILE_EXTENSIONS[extension] ?? EFileIcon.File
  }
  return EFileIcon.File
}
