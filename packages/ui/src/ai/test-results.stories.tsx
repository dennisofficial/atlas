import type { Meta, StoryObj } from '@storybook/react'

import { ETestStatus, TestResults } from './test-results'

import { TEST_SUITES } from '../fixtures/agent'

const meta = {
  title: 'AI/Test Results',
  component: TestResults,
  args: { suites: TEST_SUITES },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TestResults>

export default meta

type Story = StoryObj<typeof meta>

export const WithFailure: Story = {}

export const AllPassing: Story = {
  args: {
    suites: TEST_SUITES.map((suite) => ({
      ...suite,
      tests: suite.tests.map((test) => ({ ...test, status: ETestStatus.Passed })),
    })),
  },
}

export const Collapsed: Story = { args: { defaultOpen: false } }
