import type { Meta, StoryObj } from "@storybook/react-vite";

import { ScrollArea, ScrollBar } from "@dltech/atlas-ui/components/scroll-area";
import { Separator } from "@dltech/atlas-ui/components/separator";

const meta = {
  title: "Components/Scroll Area",
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>;

export default meta;

type Story = StoryObj<typeof meta>;

const tools = ["read", "edit", "bash", "grep", "glob", "web_fetch", "web_search", "task_write", "skill", "mcp-edit", "write", "multi_edit", "shell_input", "shell_kill"];

export const Vertical: Story = {
  render: (args) => (
    <ScrollArea className="h-56 w-56 rounded-lg border border-border" {...args}>
      <div className="p-4">
        <h4 className="mb-3 text-sm font-semibold">Tools</h4>
        {tools.map((tool) => (
          <div key={tool}>
            <div className="font-mono text-sm">{tool}</div>
            <Separator className="my-2" />
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  render: (args) => (
    <ScrollArea className="w-80 rounded-lg border border-border whitespace-nowrap" {...args}>
      <div className="flex w-max gap-2 p-4">
        {tools.map((tool) => (
          <div key={tool} className="rounded-md bg-muted px-3 py-2 font-mono text-sm">
            {tool}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
};
