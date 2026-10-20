import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileSearchIcon, SquareTerminalIcon, TriangleAlertIcon } from "lucide-react";

import { Spinner } from "@dltech/atlas-ui/components/spinner";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@dltech/atlas-ui/components/trace";

const meta = {
  title: "Components/Trace",
  component: Trace,
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Trace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Trace {...args}>
      <TraceLine>
        <TraceIcon>
          <FileSearchIcon />
        </TraceIcon>
        <TraceTitle>Read packages/ui/src/tokens/semantic.ts</TraceTitle>
        <TraceDescription>0.2s</TraceDescription>
      </TraceLine>
      <TraceLine status="running">
        <TraceIcon>
          <Spinner />
        </TraceIcon>
        <TraceTitle>Running bun run typecheck</TraceTitle>
      </TraceLine>
      <TraceLine status="pending">
        <TraceIcon>
          <SquareTerminalIcon />
        </TraceIcon>
        <TraceTitle>Run bun run test</TraceTitle>
      </TraceLine>
      <TraceLine status="error">
        <TraceIcon>
          <TriangleAlertIcon />
        </TraceIcon>
        <TraceTitle>bun run build failed</TraceTitle>
        <TraceDescription>exit 1</TraceDescription>
      </TraceLine>
    </Trace>
  ),
};

export const Expandable: Story = {
  render: (args) => (
    <Trace {...args}>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <SquareTerminalIcon />
            </TraceIcon>
            <TraceTitle>Ran bun run typecheck</TraceTitle>
            <TraceDescription>8.4s</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <pre className="font-mono text-xs text-muted-foreground">
            {"$ turbo run typecheck\n 6 packages in scope\n Tasks: 6 successful, 6 total"}
          </pre>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  ),
};
