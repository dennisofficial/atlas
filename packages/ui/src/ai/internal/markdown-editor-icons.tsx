import type { ReactElement } from 'react'
import {
  BoldIcon,
  CodeIcon,
  FileCodeIcon,
  FileTextIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  Redo2Icon,
  Undo2Icon,
} from 'lucide-react'
import { defaultSvgIcons, type IconKey } from '@mdxeditor/editor'

const ICON_CLASS = 'size-4'

const ATLAS_ICONS: Partial<Record<IconKey, ReactElement>> = {
  undo: <Undo2Icon className={ICON_CLASS} />,
  redo: <Redo2Icon className={ICON_CLASS} />,
  format_bold: <BoldIcon className={ICON_CLASS} />,
  format_italic: <ItalicIcon className={ICON_CLASS} />,
  code: <CodeIcon className={ICON_CLASS} />,
  format_list_bulleted: <ListIcon className={ICON_CLASS} />,
  format_list_numbered: <ListOrderedIcon className={ICON_CLASS} />,
  link: <LinkIcon className={ICON_CLASS} />,
  rich_text: <FileTextIcon className={ICON_CLASS} />,
  markdown: <FileCodeIcon className={ICON_CLASS} />,
}

export function iconComponentFor(name: IconKey): ReactElement {
  return ATLAS_ICONS[name] ?? defaultSvgIcons[name]
}
