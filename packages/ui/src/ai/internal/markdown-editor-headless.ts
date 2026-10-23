// MDXEditor ships no headless markdown round-trip API: corePlugin is excluded from its public
// typings, so it is read off the module namespace and driven through a bare Realm. onChange only
// fires when the export differs from the input, so the result is read from the markdown$ cell.
// https://github.com/mdx-editor/editor
import * as mdxeditor from '@mdxeditor/editor'
import type { RealmPlugin, ToMarkdownOptions } from '@mdxeditor/editor'

import { MARKDOWN_EXPORT_OPTIONS } from './markdown-editor-config'
import { createDocumentPlugins } from './markdown-editor-document'

type CorePluginParams = {
  initialMarkdown: string
  trim: boolean
  toMarkdownOptions: ToMarkdownOptions
  onChange: (markdown: string) => void
  onError: (payload: { error: string; source: string }) => void
}

export type RoundTrip = { markdown: string; error: string | null }

const SETTLE_MS = 5

function resolveCorePlugin(): (params: CorePluginParams) => RealmPlugin {
  const candidate: unknown = Reflect.get(mdxeditor, 'corePlugin')
  if (typeof candidate !== 'function')
    throw new Error('@mdxeditor/editor no longer exports corePlugin')
  return (params) => candidate(params)
}

export async function roundTripMarkdown(markdown: string): Promise<RoundTrip> {
  let error: string | null = null
  const corePlugin = resolveCorePlugin()
  const plugins = [
    corePlugin({
      initialMarkdown: markdown,
      trim: true,
      toMarkdownOptions: MARKDOWN_EXPORT_OPTIONS,
      onChange: () => {},
      onError: (payload) => {
        error = payload.error
      },
    }),
    ...createDocumentPlugins(),
  ]
  const realm = new mdxeditor.Realm()
  for (const plugin of plugins) plugin.init?.(realm)
  for (const plugin of plugins) plugin.postInit?.(realm)
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  if (error !== null) return { markdown: markdown.trim(), error }
  return { markdown: realm.getValue(mdxeditor.markdown$), error: null }
}
