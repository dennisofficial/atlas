import React from "react";

import { useClickRegion } from "../hooks/use-click-region";
import { theme } from "../theme";
import { truncateCells } from "./sidebar/cells";

const ARROW = "←";

/**
 * A way back to the session above, drawn as a backgrounded pill rather than a bare line of text —
 * the accent foreground alone read as another dim label, so the pill carries a ground of its own
 * and a brighter wash on hover.
 */
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
    <box flexDirection="row" flexShrink={0} {...region.handlers}>
      <text
        fg={theme.court.external}
        bg={region.wash.bg ?? theme.userBg}
      >{` ${ARROW} ${label} `}</text>
    </box>
  );
}
