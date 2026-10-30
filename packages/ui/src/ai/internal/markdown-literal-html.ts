const HTML_CONSTRUCTS = { disable: { null: ['htmlFlow', 'htmlText'] } }

export function remarkLiteralHtml(this: { data: () => object }) {
  const data = this.data()
  const existing: unknown = Reflect.get(data, 'micromarkExtensions')
  const extensions = Array.isArray(existing) ? existing : []
  Reflect.set(data, 'micromarkExtensions', [...extensions, HTML_CONSTRUCTS])
}
