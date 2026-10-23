import {
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  quotePlugin,
  type RealmPlugin,
  tablePlugin,
  thematicBreakPlugin,
} from '@mdxeditor/editor'

import { CODE_BLOCK_LANGUAGES } from './markdown-editor-config'
import { ATLAS_CODEMIRROR_EXTENSIONS } from './markdown-editor-highlight'

export function createDocumentPlugins(): RealmPlugin[] {
  return [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
    codeMirrorPlugin({
      codeBlockLanguages: CODE_BLOCK_LANGUAGES,
      codeMirrorExtensions: ATLAS_CODEMIRROR_EXTENSIONS,
    }),
  ]
}
