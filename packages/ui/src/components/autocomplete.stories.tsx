import type { Meta, StoryObj } from '@storybook/react'

import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from '#components/autocomplete'

const meta = {
  title: 'Components/Autocomplete',
  component: Autocomplete,
} satisfies Meta<typeof Autocomplete>

export default meta

type Story = StoryObj<typeof meta>

const paths = ['apps/', 'apps/api/', 'apps/web/', 'packages/', 'README.md']

export const Default: Story = {
  render: () => (
    <Autocomplete items={paths}>
      <AutocompleteInput placeholder="Type a path" className="w-64 font-mono" />
      <AutocompleteContent>
        <AutocompleteList>
          {(item: string) => (
            <AutocompleteItem key={item} value={item} className="font-mono text-xs">
              {item}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  ),
}
