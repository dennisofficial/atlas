#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import time

AB = os.environ.get("AGENT_BROWSER", "agent-browser")


def run(args):
    return subprocess.run([AB, *args], capture_output=True, text=True)


def resolve(sel):
    if "css" in sel:
        return sel["css"]
    for line in run(["snapshot", "-i"]).stdout.splitlines():
        if sel["name"] in line:
            m = re.search(r"ref=(e\d+)", line)
            if m:
                return "@" + m.group(1)
    raise SystemExit(f"no snapshot ref matching {sel['name']!r}")


def box_of(sel):
    vals = {}
    for line in run(["get", "box", sel]).stdout.splitlines():
        k, _, v = line.partition(":")
        vals[k.strip()] = float(v.strip())
    return vals["x"], vals["y"], vals["width"], vals["height"]


class Log:
    def __init__(self):
        self.t0 = time.time()
        self.events = []

    def ev(self, type_, **kw):
        self.events.append({"t": round(time.time() - self.t0, 3), "type": type_, **kw})


def glide(log, x, y, ms, label):
    log.ev("glide_start", dur_ms=ms, label=label)
    run(["mouse", "move", str(int(x)), str(int(y)), "--duration", str(ms), "--steps", "30"])
    log.ev("glide_end", x=x, y=y)


def step_click(log, step):
    sel = resolve(step)
    bx, by, bw, bh = box_of(sel)
    tx, ty = int(bx + bw / 2), int(by + bh / 2)
    log.ev("beat", action=step["action"], bx=bx, by=by, bw=bw, bh=bh)
    glide(log, tx, ty, step.get("glideMs", 560), step["action"])
    time.sleep(step.get("settle", 0.22))
    run(["click", sel])
    log.ev("click", x=tx, y=ty, action=step["action"])


def take(promo, out_mp4):
    vp = promo.get("viewport", {"cssW": 1920, "cssH": 1080, "scale": 2})
    run(["close"])
    run(["open", "about:blank"])
    run(["set", "viewport", str(vp["cssW"]), str(vp["cssH"]), str(vp.get("scale", 2))])
    run(["open", promo["url"]])
    run(["wait", "--load", "networkidle"])
    if promo.get("resetEval"):
        run(["eval", promo["resetEval"]])
        run(["reload"])
        run(["wait", "--load", "networkidle"])
    time.sleep(1)
    sc = promo.get("startCursor", {"x": 960, "y": 880})
    run(["mouse", "move", str(sc["x"]), str(sc["y"])])
    run(["record", "start", out_mp4, "--fps", str(promo.get("fps", 30))])
    time.sleep(0.1)
    log = Log()
    log.ev("start")
    time.sleep(promo.get("leadIn", 0.9))
    for step in promo["steps"]:
        do = step["do"]
        if do == "click":
            step_click(log, step)
        elif do == "park":
            glide(log, step["x"], step["y"], step.get("glideMs", 370), step.get("label", "park"))
            log.ev("park", x=step["x"], y=step["y"])
        elif do == "dwell":
            time.sleep(step["s"])
        elif do == "type":
            log.ev("type_start")
            for chunk in step["chunks"]:
                run(["keyboard", "type", chunk])
                time.sleep(step.get("gap", 0.13))
            log.ev("type_end")
        elif do == "wait":
            run(["wait", "--load", step.get("what", "networkidle")])
        else:
            raise SystemExit(f"unknown step do={do!r}")
    closer = promo.get("closer")
    if closer:
        glide(log, closer["x"], closer["y"], closer.get("glideMs", 370), "closer")
        log.ev("park", x=closer["x"], y=closer["y"])
        time.sleep(closer.get("hold", 1.4))
    log.ev("end")
    run(["record", "stop"])
    return log.events


def playable(path):
    return subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True,
    ).returncode == 0


def main():
    promo_path, out_mp4, events_json = sys.argv[1], sys.argv[2], sys.argv[3]
    promo = json.load(open(promo_path))
    attempts = int(promo.get("attempts", 4))
    events = None
    for attempt in range(1, attempts + 1):
        events = take(promo, out_mp4)
        if playable(out_mp4):
            break
        print(f"attempt {attempt}: mp4 has no moov atom (encoder fell behind), retaking")
    else:
        raise SystemExit(f"recording failed {attempts} times")
    json.dump(events, open(events_json, "w"), indent=1)
    counts = {}
    for e in events:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    print(f"{len(events)} events: {counts}")
    pos = None
    for e in events:
        if e["type"] == "glide_end":
            pos = (e["x"], e["y"])
        if e["type"] == "click" and (e["x"], e["y"]) != pos:
            raise SystemExit(f"click {e['action']} not at its glide end")


main()
