import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { EColorScheme, semantic, type SemanticToken } from '@dltech/atlas-ui/tokens'

const meta = {
  title: 'Foundations/Colors',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const groups: { title: string; match: (token: string) => boolean }[] = [
  { title: 'Surfaces', match: (t) => /^(background|foreground|card|popover)/.test(t) },
  { title: 'Brand and actions', match: (t) => /^(primary|secondary|accent|destructive)/.test(t) },
  { title: 'Neutrals and controls', match: (t) => /^(muted|border|input|ring)/.test(t) },
  { title: 'Charts', match: (t) => t.startsWith('chart') },
  { title: 'Sidebar', match: (t) => t.startsWith('sidebar') },
  { title: 'Status', match: (t) => /^(success|warning)/.test(t) },
  { title: 'Diff', match: (t) => t.startsWith('diff') },
  { title: 'Syntax and code', match: (t) => /^(syntax|code|link)/.test(t) },
  { title: 'Scrollbar', match: (t) => t.startsWith('scrollbar') },
]

const tokens = Object.keys(semantic[EColorScheme.Dark]) as SemanticToken[]

function toCssVariable(token: string): string {
  return `--${token.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()}`
}

function Swatch({ token, scheme }: { token: SemanticToken; scheme: EColorScheme }) {
  const value = semantic[scheme][token]
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-8 shrink-0 rounded-md border border-border"
        style={{ backgroundColor: value }}
      />
      <span className="font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  )
}

function TokenRow({ token }: { token: SemanticToken }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_12rem_12rem] items-center gap-4 border-b border-border py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{token}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {toCssVariable(token)}
        </div>
      </div>
      <Swatch token={token} scheme={EColorScheme.Dark} />
      <Swatch token={token} scheme={EColorScheme.Light} />
    </div>
  )
}

export const Semantic: Story = {
  render: () => (
    <div className="flex w-[56rem] max-w-full flex-col gap-8">
      <div className="grid grid-cols-[minmax(0,1fr)_12rem_12rem] gap-4 text-xs font-medium text-muted-foreground uppercase">
        <span>Token</span>
        <span>Dark</span>
        <span>Light</span>
      </div>
      {groups.map((group) => {
        const members = tokens.filter((token) => group.match(token))
        return (
          <section key={group.title} className="flex flex-col">
            <h3 className="mb-1 text-sm font-semibold">{group.title}</h3>
            {members.map((token) => (
              <TokenRow key={token} token={token} />
            ))}
          </section>
        )
      })}
    </div>
  ),
}

export const LiveTheme: Story = {
  name: 'Live theme (follows toolbar)',
  render: () => (
    <div className="grid w-[48rem] max-w-full grid-cols-2 gap-3 sm:grid-cols-4">
      {tokens
        .filter((token) => !token.endsWith('Foreground') && !token.startsWith('scrollbar'))
        .map((token) => (
          <div key={token} className="flex flex-col gap-1.5">
            <div
              className="h-12 rounded-lg border border-border"
              style={{ backgroundColor: `var(${toCssVariable(token)})` }}
            />
            <span className="truncate font-mono text-xs text-muted-foreground">
              {toCssVariable(token)}
            </span>
          </div>
        ))}
    </div>
  ),
}
