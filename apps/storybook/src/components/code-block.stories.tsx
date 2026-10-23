import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@dltech/atlas-ui/components/code-block'

const meta = {
  title: 'Components/Code Block',
  component: CodeBlock,
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'destructive'] },
    size: { control: 'inline-radio', options: ['default', 'sm'] },
  },
  args: { variant: 'default', size: 'default' },
  decorators: [
    (Story) => (
      <div className="w-[32rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeBlock>

export default meta

type Story = StoryObj<typeof meta>

const source = `export function nextBackoff(attempt: number): number {
  const base = 250 * 2 ** attempt;
  return Math.min(base, 10_000);
}`

export const Default: Story = {
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockHeader>
        <CodeBlockTitle>reconnect.ts</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={source} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>{source}</CodeBlockContent>
    </CodeBlock>
  ),
}

export const LineNumbers: Story = {
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockContent lineNumbers>{source}</CodeBlockContent>
      <CodeBlockFooter className="px-3 pb-2 text-xs text-muted-foreground">4 lines</CodeBlockFooter>
    </CodeBlock>
  ),
}

export const DiffLines: Story = {
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockHeader>
        <CodeBlockTitle>reconnect.ts</CodeBlockTitle>
      </CodeBlockHeader>
      <CodeBlockContent>
        <CodeBlockLine>{'const base = 250 * 2 ** attempt;'}</CodeBlockLine>
        <CodeBlockLine variant="removed">{'return base;'}</CodeBlockLine>
        <CodeBlockLine variant="added">{'return Math.min(base, 10_000);'}</CodeBlockLine>
        <CodeBlockLine variant="highlighted">{'// capped at ten seconds'}</CodeBlockLine>
      </CodeBlockContent>
    </CodeBlock>
  ),
}

export const Destructive: Story = {
  args: { variant: 'destructive' },
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockContent>
        {'Error: connect ECONNREFUSED 127.0.0.1:7777\n    at TCPConnectWrap.afterConnect'}
      </CodeBlockContent>
    </CodeBlock>
  ),
}

export const Wrapped: Story = {
  render: (args) => (
    <CodeBlock {...args} className="w-64">
      <CodeBlockContent wrap>
        {'bun run typecheck --filter @dltech/atlas-ui --filter @dltech/atlas-storybook'}
      </CodeBlockContent>
    </CodeBlock>
  ),
}
