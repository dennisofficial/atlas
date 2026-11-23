#!/usr/bin/env python3
import json
import os
import subprocess
import sys

LAUNCH = sys.argv[1] if len(sys.argv) > 1 else "launch"
PORT = sys.argv[2] if len(sys.argv) > 2 else "26890"
AB = os.environ.get("AGENT_BROWSER", "agent-browser")

EVAL = """
(async () => {
  const B = await fetch("beats.json").then(r => r.json());
  const path = document.querySelector("#cursor path");
  const tipLocal = new DOMPoint(2, 1.5);
  const out = [];
  for (const b of B.beats) {
    window.__timelines["main"].seek(b.click.t, false);
    await new Promise(r => requestAnimationFrame(r));
    const m = path.getScreenCTM();
    const tip = tipLocal.matrixTransform(m);
    const s = window.__sample(b.click.t);
    const k = B.win.w / s.cam.Wd;
    const ex = B.win.x + (b.click.x - s.cam.L) * k;
    const ey = B.win.y + (b.click.y - s.cam.T) * k;
    out.push(`${b.action}: drawn tip (${tip.x.toFixed(1)},${tip.y.toFixed(1)}) click (${ex.toFixed(1)},${ey.toFixed(1)}) err ${(Math.abs(tip.x-ex)+Math.abs(tip.y-ey)).toFixed(2)}px`);
  }
  return out.join("\\n");
})()
"""

server = subprocess.Popen(
    ["python3", "-m", "http.server", PORT, "--bind", "127.0.0.1"],
    cwd=LAUNCH, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    subprocess.run(["sleep", "1"])
    subprocess.run([AB, "open", f"http://127.0.0.1:{PORT}/index.html"],
                   capture_output=True, check=True)
    r = subprocess.run([AB, "eval", EVAL], capture_output=True, text=True, check=True)
    text = r.stdout.strip().strip('"').replace("\\n", "\n")
    print(text)
    worst = 0.0
    for line in text.splitlines():
        if "err" in line:
            worst = max(worst, float(line.rsplit("err ", 1)[1].removesuffix("px")))
    if worst > 2:
        raise SystemExit(f"tip check failed: worst error {worst:.2f}px")
    print(f"worst error {worst:.2f}px (DOM measure, threshold 2px)")
finally:
    server.terminate()
