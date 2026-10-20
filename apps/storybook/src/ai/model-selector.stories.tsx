import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { EEffort, ModelSelector } from "@dltech/atlas-ui/ai/model-selector";
import { InputGroup, InputGroupAddon } from "@dltech/atlas-ui/components/input-group";

import { MODELS } from "../fixtures/agent";

const meta = {
  title: "AI/Model Selector",
  component: ModelSelector,
  args: { models: MODELS, value: "claude-sonnet" },
} satisfies Meta<typeof ModelSelector>;

export default meta;

type Story = StoryObj<typeof meta>;

function SelectorDemo({ withEffort }: { withEffort: boolean }) {
  const [model, setModel] = useState("claude-sonnet");
  const [effort, setEffort] = useState(EEffort.Medium);

  return (
    <InputGroup className="w-96">
      <InputGroupAddon align="block-end">
        <ModelSelector
          models={MODELS}
          value={model}
          onValueChange={setModel}
          effort={withEffort ? effort : undefined}
          onEffortChange={setEffort}
        />
      </InputGroupAddon>
    </InputGroup>
  );
}

export const ModelOnly: Story = { render: () => <SelectorDemo withEffort={false} /> };

export const ModelAndEffort: Story = { render: () => <SelectorDemo withEffort /> };
