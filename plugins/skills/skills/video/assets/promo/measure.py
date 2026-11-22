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
    return {"x": vals["x"], "y": vals["y"], "w": vals["width"], "h": vals["height"]}


def run_step(step):
    do = step["do"]
    if do == "click":
        run(["click", resolve(step)])
        time.sleep(step.get("settle", 0.8))
    elif do == "dwell":
        time.sleep(step["s"])
    elif do == "wait":
        run(["wait", "--load", step.get("what", "networkidle")])
    elif do == "type":
        for chunk in step["chunks"]:
            run(["keyboard", "type", chunk])
            time.sleep(step.get("gap", 0.13))
    elif do == "park":
        pass


def union(boxes):
    x0 = min(b["x"] for b in boxes)
    y0 = min(b["y"] for b in boxes)
    x1 = max(b["x"] + b["w"] for b in boxes)
    y1 = max(b["y"] + b["h"] for b in boxes)
    return {"x": round(x0), "y": round(y0), "w": round(x1 - x0), "h": round(y1 - y0)}


def main():
    promo_path, out_path = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "subjects.json"
    promo = json.load(open(promo_path))
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
    for step in promo.get("setup", []):
        run_step(step)
    subjects = {}
    for name, spec in promo["subjects"].items():
        measured = []
        for sel in spec:
            b = box_of(resolve(sel))
            if sel.get("cropH") is not None:
                b["h"] = sel["cropH"]
            measured.append(b)
        subjects[name] = union(measured) if len(measured) > 1 else {
            k: round(v) for k, v in measured[0].items()
        }
    json.dump({"subjects": subjects}, open(out_path, "w"), indent=1)
    print(json.dumps(subjects, indent=1))


main()
