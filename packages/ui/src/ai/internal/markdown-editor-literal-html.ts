import { addSyntaxExtension$, type RealmPlugin } from '@mdxeditor/editor'

const HTML_CONSTRUCTS = { disable: { null: ['htmlFlow', 'htmlText'] } }

// MDXEditor's core plugin parses content as MDX unless suppressHtmlProcessing is set, and even
// then micromark still tokenizes <tag> as an mdast html node that no visitor handles. Disabling
// the html constructs keeps skill files (plain CommonMark) such as `use <slug>` or `<5%` literal.
// https://github.com/mdx-editor/editor
export function markdownLiteralHtml(): RealmPlugin {
  return {
    init(realm) {
      realm.pubIn({ [addSyntaxExtension$]: HTML_CONSTRUCTS })
    },
  }
}
