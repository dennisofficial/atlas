#!/usr/bin/env python3
import json
import sys

LAUNCH = sys.argv[1] if len(sys.argv) > 1 else "launch"
MEDIA = sys.argv[2] if len(sys.argv) > 2 else "take.mp4"
ACCENT = sys.argv[3] if len(sys.argv) > 3 else "#ff6a3d"

B = json.load(open(f"{LAUNCH}/beats.json"))
DUR = B["duration"]

caps = []
for c in B["captions"]:
    if c["slot"] == "center":
        style = "left:0;width:1920px;top:900px;text-align:center"
        cls = "caption big clip"
    else:
        style = f"left:{c['left']}px;top:{c['top']}px"
        cls = "caption clip"
    d = round(c["t1"] - c["t0"], 3)
    caps.append(
        f'      <div id="{c["id"]}" class="{cls}" style="{style}" data-start="{c["t0"]}" '
        f'data-duration="{d}"><div class="inner">{c["html"]}</div></div>'
    )

ripples = "\n".join(f'      <div class="ripple" id="r{i}"></div>' for i in range(len(B["beats"])))

html = f"""<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap");
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ width: 1920px; height: 1080px; overflow: hidden; background: #0d0d10; }}
      #root {{ position: relative; width: 1920px; height: 1080px; font-family: "Inter", system-ui, sans-serif; overflow: hidden; }}
      #bg {{
        position: absolute; inset: 0;
        background:
          radial-gradient(1100px 700px at 12% -8%, rgba(255, 92, 40, 0.32), rgba(255, 92, 40, 0) 62%),
          radial-gradient(1000px 720px at 88% 108%, rgba(150, 66, 255, 0.30), rgba(150, 66, 255, 0) 60%),
          radial-gradient(760px 560px at 82% 10%, rgba(64, 110, 255, 0.16), rgba(64, 110, 255, 0) 65%),
          linear-gradient(160deg, #141416 0%, #0d0d10 55%, #101014 100%);
      }}
      #win {{
        position: absolute; left: {B['win']['x']}px; top: {B['win']['y']}px;
        width: {B['win']['w']}px; height: {B['win']['h']}px;
        border-radius: 22px; border: 1px solid rgba(255, 255, 255, 0.10);
        box-shadow: 0 40px 100px rgba(0,0,0,0.55), 0 8px 28px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.6);
        overflow: hidden; background: #000;
      }}
      #z {{ position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; will-change: transform; }}
      #v {{ display: block; width: 1920px; height: 1080px; object-fit: fill; }}
      #cursor {{
        position: absolute; left: 0; top: 0; z-index: 20; pointer-events: none;
        transform-origin: 3px 2.25px; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.55));
      }}
      #cursor svg {{ display: block; }}
      .ripple {{
        position: absolute; z-index: 19; left: -36px; top: -36px; width: 72px; height: 72px;
        border: 4px solid {ACCENT}; border-radius: 50%; pointer-events: none; opacity: 0;
      }}
      .caption {{ position: absolute; z-index: 10; pointer-events: none; }}
      .caption .inner {{
        display: inline-block; background: rgba(13,13,16,0.84); border: 1px solid rgba(255,255,255,0.14);
        border-radius: 14px; padding: 13px 26px; backdrop-filter: blur(10px);
        box-shadow: 0 18px 48px rgba(0,0,0,0.5); color: #f5f4f2;
        font-size: 34px; line-height: 36px; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap;
      }}
      .caption.big .inner {{ font-size: 52px; line-height: 56px; padding: 20px 40px; border-radius: 18px; }}
      .caption .accent {{ color: {ACCENT}; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{DUR}" data-width="1920" data-height="1080">
      <div id="bg" class="clip" data-start="0" data-duration="{DUR}"></div>
      <div id="win">
        <div id="z">
          <video id="v" src="media/{MEDIA}" class="clip" data-start="0" data-duration="{DUR}" muted></video>
        </div>
      </div>
      <div id="cursor">
        <svg width="42" height="60" viewBox="0 0 28 40" fill="none">
          <path d="M2 1.5 L2 30.5 L9.2 23.9 L13.6 36.2 L17.9 34.2 L13.5 22.1 L22.5 22.1 Z"
            fill="#ffffff" stroke="#1a1a1e" stroke-width="2.4" stroke-linejoin="round" />
        </svg>
      </div>
{ripples}
{chr(10).join(caps)}
    </div>
    <script>
      const B = {json.dumps({k: B[k] for k in ('win', 'camera', 'cursor', 'beats', 'captions')})};
      const W = 1920, DUR = {DUR};
      const WIDE = {{ s: 1, L: 0, T: 0, Wd: W }};
      const EASE = {{
        "power3.inOut": (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
        "power2.inOut": (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
      }};
      function sampleCam(t) {{
        let p = WIDE;
        for (const s of B.camera) {{
          if (t < s.t0) return p;
          if (t <= s.t1) {{
            const k = EASE[s.ease]((t - s.t0) / (s.t1 - s.t0));
            const a = s.from, b = s.to;
            return {{ L: a.L + (b.L - a.L) * k, T: a.T + (b.T - a.T) * k, Wd: a.Wd + (b.Wd - a.Wd) * k }};
          }}
          p = s.to;
        }}
        return p;
      }}
      function sampleCursor(t) {{
        let x = {B.get('cursor', [{}])[0].get('x0', 960)}, y = {B.get('cursor', [{}])[0].get('y0', 880)};
        for (const c of B.cursor) {{
          if (t < c.t0) return {{ x, y }};
          if (t <= c.t1) {{
            let k = (t - c.t0) / (c.t1 - c.t0);
            k = k * k * (3 - 2 * k);
            return {{ x: c.x0 + (c.x1 - c.x0) * k, y: c.y0 + (c.y1 - c.y0) * k }};
          }}
          x = c.x1; y = c.y1;
        }}
        return {{ x, y }};
      }}
      function toScreen(cam, x, y) {{
        const k = B.win.w / cam.Wd;
        return {{ x: B.win.x + (x - cam.L) * k, y: B.win.y + (y - cam.T) * k, k }};
      }}
      const z = document.getElementById("z");
      const cursor = document.getElementById("cursor");
      const rings = B.beats.map((_, i) => document.getElementById("r" + i));
      function render(t) {{
        const cam = sampleCam(t);
        const k = B.win.w / cam.Wd;
        z.style.transform = `scale(${{k}}) translate(${{-cam.L}}px, ${{-cam.T}}px)`;
        const c = sampleCursor(t);
        const s = toScreen(cam, c.x, c.y);
        cursor.style.transform = `translate(${{s.x - 3}}px, ${{s.y - 2.25}}px) scale(${{k}})`;
        B.beats.forEach((b, i) => {{
          const dt = t - b.click.t;
          if (dt < 0 || dt > 0.55) {{ rings[i].style.opacity = 0; return; }}
          const q = 1 - Math.pow(1 - dt / 0.55, 2);
          const r = toScreen(cam, b.click.x, b.click.y);
          rings[i].style.opacity = 1 - q;
          rings[i].style.transform = `translate(${{r.x}}px, ${{r.y}}px) scale(${{(0.35 + 1.25 * q) * Math.min(k, 1.8)}})`;
        }});
      }}
      window.__sample = (t) => ({{ cam: sampleCam(t), cursor: sampleCursor(t) }});
      const tl = gsap.timeline({{ paused: true }});
      const clock = {{ t: 0 }};
      tl.to(clock, {{ t: DUR, duration: DUR, ease: "none", onUpdate: () => render(clock.t) }}, 0);
      for (const c of B.captions) {{
        const sel = "#" + c.id + " .inner";
        tl.fromTo(sel, {{ opacity: 0, y: 22 }}, {{ opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }}, c.t0);
        if (c.t1 < DUR - 0.1) tl.to(sel, {{ opacity: 0, y: -14, duration: 0.3, ease: "power2.in" }}, c.t1 - 0.3);
      }}
      render(0);
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
"""
open(f"{LAUNCH}/index.html", "w").write(html)
print(f"wrote {LAUNCH}/index.html")
