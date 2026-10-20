import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Confirmation, EConfirmationState } from "../confirmation";

const render = (state?: EConfirmationState, always = false) =>
  renderToStaticMarkup(
    <Confirmation
      title="Run rm -rf node_modules?"
      state={state}
      evidence={["matched: recursive delete"]}
      onApprove={() => {}}
      onDeny={() => {}}
      onApproveAlways={always ? () => {} : undefined}
    />,
  );

describe("Confirmation", () => {
  it("renders enabled approve and deny actions while pending", () => {
    const html = render();

    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
    expect(html).not.toContain(' disabled=""');
    expect(html).toContain("matched: recursive delete");
  });

  it("shows keyboard shortcut hints while pending", () => {
    const html = render();

    expect(html).toContain("Esc");
    expect(html).toContain("↵");
    expect(html).toContain('tabindex="0"');
  });

  it("disables the actions and states the outcome once approved", () => {
    const html = render(EConfirmationState.Approved);

    expect(html.match(/ disabled=""/g)?.length).toBe(2);
    expect(html).toContain("Approved");
    expect(html).not.toContain("↵");
    expect(html).not.toContain("matched: recursive delete");
  });

  it("states the outcome once denied", () => {
    const html = render(EConfirmationState.Denied);

    expect(html).toContain("Denied");
    expect(html.match(/ disabled=""/g)?.length).toBe(2);
  });

  it("offers an always-allow action only when a handler is given", () => {
    expect(render(undefined, true)).toContain("Always allow");
    expect(render()).not.toContain("Always allow");
  });
});
