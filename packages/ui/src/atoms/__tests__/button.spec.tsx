import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "../button";

describe("Button", () => {
  it("renders a native button by default", () => {
    const html = renderToStaticMarkup(<Button variant="primary">Sign in</Button>);

    expect(html).toStartWith("<button");
    expect(html).toContain("Sign in");
  });

  it("slots onto a single child element with asChild", () => {
    const html = renderToStaticMarkup(
      <Button asChild variant="primary">
        <a href="/sign-in">Sign in</a>
      </Button>,
    );

    expect(html).toStartWith("<a");
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Sign in");
  });
});
