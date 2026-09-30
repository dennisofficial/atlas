import React from "react";

import { useClickRegion } from "../hooks/use-click-region";
import { theme } from "../theme";
import { truncateCells } from "./sidebar/cells";

const ARROW = "←";

export function BackPill(props: {
  label: string;
  onBack: () => void;
  cells?: number;
}): React.ReactNode {
  const region = useClickRegion(props.onBack);
  const label =
    props.cells === undefined
      ? props.label
      : truncateCells({ text: props.label, cells: props.cells });

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      {...region.handlers}
      {...(region.wash.bg === undefined ? {} : { backgroundColor: region.wash.bg })}
    >
      <text fg={theme.court.external}>{`${ARROW} ${label}`}</text>
    </box>
  );
}
