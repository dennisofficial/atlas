import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  EEffort,
  ModelSelector,
  type ModelOption,
} from "@dltech/atlas-ui/ai/model-selector";
import { InputGroup, InputGroupAddon } from "@dltech/atlas-ui/components/input-group";

import { MODELS } from "../fixtures/agent";
import MODEL_CATALOGUE from "../fixtures/model-catalogue.json";

const CATALOGUE: ModelOption[] = MODEL_CATALOGUE;

const DEFAULT_PINNED = ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "openai/gpt-5.5"];

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

function CatalogueDemo({
  defaultOpen,
  initialPinned,
}: {
  defaultOpen: boolean;
  initialPinned: string[];
}) {
  const [model, setModel] = useState("anthropic/claude-sonnet-5");
  const [effort, setEffort] = useState(EEffort.Medium);
  const [pinned, setPinned] = useState(initialPinned);

  return (
    <div className="flex h-[640px] w-[28rem] items-start">
      <InputGroup>
        <InputGroupAddon align="block-end">
          <ModelSelector
            models={CATALOGUE}
            value={model}
            onValueChange={setModel}
            effort={effort}
            onEffortChange={setEffort}
            pinned={pinned}
            onPinnedChange={setPinned}
            defaultOpen={defaultOpen}
          />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

export const ModelOnly: Story = { render: () => <SelectorDemo withEffort={false} /> };

export const ModelAndEffort: Story = { render: () => <SelectorDemo withEffort /> };

export const FullCatalogue: Story = {
  render: () => <CatalogueDemo defaultOpen={false} initialPinned={DEFAULT_PINNED} />,
};

export const FullCatalogueOpen: Story = {
  render: () => <CatalogueDemo defaultOpen initialPinned={DEFAULT_PINNED} />,
};

export const FullCatalogueNoPins: Story = {
  render: () => <CatalogueDemo defaultOpen initialPinned={[]} />,
};
