const ENTITIES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
])

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ENTITIES.get(character) ?? character)
}
