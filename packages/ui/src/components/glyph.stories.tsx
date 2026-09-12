import type { Meta, StoryObj } from "@storybook/react-vite";

import { GLYPHS, Glyph, type GlyphName } from "./glyph";

const meta = {
  title: "Iconography/Glyph",
  component: Glyph,
  tags: ["autodocs"],
  argTypes: {
    name: { control: "select", options: Object.keys(GLYPHS) },
  },
  args: { name: "block" },
} satisfies Meta<typeof Glyph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllGlyphs: Story = {
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
      {(Object.entries(GLYPHS) as [GlyphName, string][]).map(([name]) => (
        <div
          key={name}
          className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
        >
          <Glyph name={name} className="text-primary" />
          <span className="font-mono text-xs text-meta">{name}</span>
        </div>
      ))}
    </div>
  ),
};

export const Status: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-sm">
      <span className="inline-flex items-center gap-2 text-foreground">
        <Glyph name="active" color="var(--primary)" /> Active session
      </span>
      <span className="inline-flex items-center gap-2 text-meta">
        <Glyph name="available" /> Available
      </span>
      <span className="inline-flex items-center gap-2 text-foreground">
        <Glyph name="unseen" color="var(--steel)" /> Unseen output
      </span>
      <span className="inline-flex items-center gap-2 text-hint">
        <Glyph name="seen" /> Seen
      </span>
      <span className="inline-flex items-center gap-2 text-warning">
        <Glyph name="warning" /> Awaiting input
      </span>
      <span className="inline-flex items-center gap-2 text-success">
        <Glyph name="passed" /> Tests passed
      </span>
      <span className="inline-flex items-center gap-2 text-destructive">
        <Glyph name="failed" /> Tests failed
      </span>
    </div>
  ),
};

export const Spinning: Story = {
  args: { spin: true, color: "var(--primary)" },
};

export const WithTitle: Story = {
  args: { name: "thinking", title: "Thinking", color: "var(--meta)" },
};
