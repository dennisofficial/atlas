const TARGET = /\]\(([^()\s]+)((?:\s+"[^"]*")?)\)/g

const isResolvable = (target: string): boolean =>
  target.length > 0 &&
  !target.startsWith('#') &&
  !/^[a-z][a-z0-9+.-]*:/i.test(target) &&
  !target.startsWith('<')

/**
 * A page read as markdown carries the links it was written with, and a docs site writes them as
 * `/en-US/docs/...`. Resolving them against the page they came from is what lets the reader follow
 * one without joining urls by hand first.
 */
export function absoluteLinks(args: { markdown: string; base: string }): string {
  return args.markdown.replaceAll(TARGET, (whole, target: string, title: string) => {
    if (!isResolvable(target)) return whole
    try {
      return `](${new URL(target, args.base).toString()}${title})`
    } catch {
      return whole
    }
  })
}
