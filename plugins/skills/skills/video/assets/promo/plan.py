#!/usr/bin/env python3
import json
import math
import os
import re
import sys

W, H = 1920, 1080
WIN = {"x": 90, "y": 50, "w": 1740, "h": 978.75}
FILL = 0.85
MAX_S = 2.8
MARGIN = 24.0
FILL_STEPS = [0.85 - 0.03 * i for i in range(11)]
WIDE = {"s": 1.0, "L": 0.0, "T": 0.0, "Wd": float(W)}
CAP_H, CAP_CHAR = 64, 18.5
SLOTS = [("bl", 130, 1028 - 14 - CAP_H), ("tl", 130, 64), ("br", None, 1028 - 14 - CAP_H), ("tr", None, 64)]


def frame_box(box, click):
    frame = dict(box)
    if click is not None:
        x0 = min(frame["x"], click["x"] - 10)
        y0 = min(frame["y"], click["y"] - 10)
        x1 = max(frame["x"] + frame["w"], click["x"] + 10)
        y1 = max(frame["y"] + frame["h"], click["y"] + 10)
        frame = {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}
    for f in FILL_STEPS:
        s = min(FILL * f * W / frame["w"], FILL * f * H / frame["h"], MAX_S)
        vw, vh = W / s, H / s
        m = min(MARGIN, frame["x"], frame["y"], W - (frame["x"] + frame["w"]), H - (frame["y"] + frame["h"]))
        if frame["w"] + 2 * m > vw + 1e-6 or frame["h"] + 2 * m > vh + 1e-6:
            continue
        cx, cy = frame["x"] + frame["w"] / 2, frame["y"] + frame["h"] / 2
        L = min(max(cx - vw / 2, 0.0), W - vw)
        T = min(max(cy - vh / 2, 0.0), H - vh)
        if (L <= frame["x"] - m + 1e-6 and L + vw >= frame["x"] + frame["w"] + m - 1e-6
                and T <= frame["y"] - m + 1e-6 and T + vh >= frame["y"] + frame["h"] + m - 1e-6):
            return {"s": round(s, 4), "L": round(L, 2), "T": round(T, 2), "Wd": round(vw, 2)}, frame
    raise SystemExit(f"cannot frame box {frame} with margin")


def ease(name, k):
    if name == "power3.inOut":
        return 4 * k ** 3 if k < 0.5 else 1 - (-2 * k + 2) ** 3 / 2
    if name == "power2.inOut":
        return 2 * k * k if k < 0.5 else 1 - (-2 * k + 2) ** 2 / 2
    return k


def sample_cam(cam, t):
    p = WIDE
    for sgm in cam:
        if t < sgm["t0"]:
            return p
        if t <= sgm["t1"]:
            k = ease(sgm["ease"], (t - sgm["t0"]) / (sgm["t1"] - sgm["t0"]))
            a, b = sgm["from"], sgm["to"]
            Wd = a["Wd"] + (b["Wd"] - a["Wd"]) * k
            return {"L": a["L"] + (b["L"] - a["L"]) * k, "T": a["T"] + (b["T"] - a["T"]) * k,
                    "Wd": Wd, "s": W / Wd}
        p = sgm["to"]
    return p


def sample_cursor(cur, start, t):
    x, y = start["x"], start["y"]
    for c in cur:
        if t < c["t0"]:
            return x, y
        if t <= c["t1"]:
            k = (t - c["t0"]) / (c["t1"] - c["t0"])
            k = k * k * (3 - 2 * k)
            return c["x0"] + (c["x1"] - c["x0"]) * k, c["y0"] + (c["y1"] - c["y0"]) * k
        x, y = c["x1"], c["y1"]
    return x, y


def place_captions(captions, subjects, poses, dur):
    def to_screen(p, x, y):
        k = WIN["w"] / p["Wd"]
        return WIN["x"] + (x - p["L"]) * k, WIN["y"] + (y - p["T"]) * k

    for c in captions:
        text = re.sub("<[^>]+>", "", c["html"])
        c["w"] = round(len(text) * CAP_CHAR + 56)
        if c["t1"] - c["t0"] < 1.2:
            raise SystemExit(f"caption {c['id']} is on screen {c['t1'] - c['t0']:.2f}s; minimum 1.2s")
        if not c.get("subject"):
            c["slot"] = "center"
            continue
        b = subjects[c["subject"]]
        x0, y0 = to_screen(poses[c["subject"]], b["x"], b["y"])
        x1, y1 = to_screen(poses[c["subject"]], b["x"] + b["w"], b["y"] + b["h"])
        for name, left, top in SLOTS:
            if left is None:
                left = 1830 - 40 - c["w"]
            if left + c["w"] < x0 or left > x1 or top + CAP_H < y0 or top > y1:
                c.update(slot=name, left=round(left), top=round(top))
                break
        else:
            raise SystemExit(f"no clear caption slot for {c['id']}")


def main():
    promo_path, events_path, subjects_path, out_path, verify_dir = sys.argv[1:6]
    promo = json.load(open(promo_path))
    ev = json.load(open(events_path))
    subjects = json.load(open(subjects_path))["subjects"]
    offset = promo.get("clockOffset", 0.12)
    for e in ev:
        e["t"] = round(e["t"] + offset, 3)
    dur = round(max(e["t"] for e in ev if e["type"] == "end"), 2)
    start = promo.get("startCursor", {"x": 960, "y": 880})

    glides = {e["label"]: e["t"] for e in ev if e["type"] == "glide_start"}
    clicks = {e["action"]: e for e in ev if e["type"] == "click"}
    if "closer" in glides:
        dur = max(dur, round(ev[-1]["t"], 2))

    poses, frames = {}, {}
    click_in_frame = {b["subject"]: clicks[b["action"]] for b in promo["beats"] if b.get("click")}
    for name, sub in subjects.items():
        poses[name], frames[name] = frame_box(sub, click_in_frame.get(name))

    cam = []

    def seg(t0, dur_, a, b, ease_):
        cam.append({"t0": round(t0, 3), "t1": round(t0 + dur_, 3), "from": a, "to": b, "ease": ease_})

    prev = WIDE
    for beat in promo["beats"]:
        pose = poses[beat["subject"]]
        push, pull, lead = beat.get("push", 0.75), beat.get("pull", 0.67), beat.get("lead", 0.3)
        g = glides[beat["action"]]
        if prev is WIDE:
            seg(g, push, WIDE, pose, "power3.inOut")
        elif prev == pose:
            pass
        elif beat.get("via"):
            seg(g - lead, pull, prev, WIDE, "power2.inOut")
            seg(g - lead + pull, push, WIDE, pose, "power3.inOut")
        else:
            seg(g, push, prev, pose, "power3.inOut")
        if beat.get("result"):
            rpose, rframe = frame_box(subjects[beat["result"]], clicks[beat["action"]])
            frames[beat["result"]] = rframe
            poses[beat["result"]] = rpose
            pan_t = clicks[beat["action"]]["t"] + 0.15
            seg(pan_t, 0.6, pose, rpose, "power3.inOut")
            pose = rpose
        prev = pose
    closer = promo.get("closer")
    if closer:
        seg(glides["closer"], closer.get("pull", 0.9), prev, WIDE, "power2.inOut")

    for a, b in zip(cam, cam[1:]):
        if a["t1"] > b["t0"] + 1e-6:
            raise SystemExit(f"overlapping camera segments: {a} vs {b}")

    cur = []
    pos = (start["x"], start["y"])
    t0 = None
    for e in ev:
        if e["type"] == "glide_start":
            t0 = e["t"]
        elif e["type"] == "glide_end":
            cur.append({"t0": t0, "t1": e["t"], "x0": pos[0], "y0": pos[1], "x1": e["x"], "y1": e["y"]})
            pos = (e["x"], e["y"])
        elif e["type"] == "click":
            if (e["x"], e["y"]) != pos:
                raise SystemExit(f"click not at glide end: {e} vs {pos}")

    captions = promo.get("captions", [])
    place_captions(captions, subjects, poses, dur)

    out = {
        "duration": dur, "offset": offset, "win": WIN, "fill": FILL, "maxScale": MAX_S,
        "subjects": subjects, "poses": poses,
        "beats": [{"action": a, "glideStart": glides[a],
                   "click": {"t": c["t"], "x": c["x"], "y": c["y"]}} for a, c in clicks.items()],
        "typing": [e["t"] for e in ev if e["type"] in ("type_start", "type_end")],
        "camera": cam, "cursor": cur, "captions": captions,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(out, open(out_path, "w"), indent=1)

    os.makedirs(verify_dir, exist_ok=True)
    rows = ["t\tscale\tcentre_x\tcentre_y\tview_L\tview_T\tview_W\tin_bounds"]
    t = 0.0
    while t <= dur + 1e-6:
        p = sample_cam(cam, t)
        cx, cy = p["L"] + p["Wd"] / 2, p["T"] + p["Wd"] * H / W / 2
        ok = (p["L"] >= -0.01 and p["T"] >= -0.01
              and p["L"] + p["Wd"] <= W + 0.01 and p["T"] + p["Wd"] * H / W <= H + 0.01)
        rows.append(f"{t:.2f}\t{p['s']:.3f}\t{cx:.0f}\t{cy:.0f}\t{p['L']:.0f}\t{p['T']:.0f}\t{p['Wd']:.0f}\t{'yes' if ok else 'NO'}")
        t += 0.25
    open(os.path.join(verify_dir, "camera-table.tsv"), "w").write("\n".join(rows) + "\n")

    print("margin table (frame box vs landed view rect, CSS px):")
    fail = False
    for name, fb in frames.items():
        p = poses[name]
        vh = p["Wd"] * H / W
        ml, mt = fb["x"] - p["L"], fb["y"] - p["T"]
        mr, mb = p["L"] + p["Wd"] - (fb["x"] + fb["w"]), p["T"] + vh - (fb["y"] + fb["h"])
        mn = min(ml, mt, mr, mb)
        ok = mn >= -0.01
        fail |= not ok
        print(f"  {name:10s} frame=({fb['x']:6.1f},{fb['y']:6.1f},{fb['w']:6.1f}x{fb['h']:5.1f}) "
              f"view=({p['L']:7.1f},{p['T']:6.1f},{p['Wd']:6.1f}x{vh:5.1f}) s={p['s']:.3f} "
              f"margins L{ml:5.1f} T{mt:5.1f} R{mr:5.1f} B{mb:5.1f} min={mn:5.1f} {'OK' if ok else 'FAIL'}")
    if fail:
        raise SystemExit("margin assertion failed")

    print("camera:")
    for s in cam:
        print(f"  {s['t0']:6.2f}-{s['t1']:6.2f} {s['ease']:13s} s {s['from']['s']:.2f} -> {s['to']['s']:.2f}")
    print("clicks (video t, cam scale at click, cursor err px):")
    for a, c in clicks.items():
        cx, cy = sample_cursor(cur, start, c["t"])
        print(f"  {a:12s} {c['t']:6.2f} s={sample_cam(cam, c['t'])['s']:.2f} err={abs(cx-c['x'])+abs(cy-c['y']):.2f}")
    print("captions:", [(c["id"], c["slot"]) for c in captions])
    print(f"duration {dur}s -> {out_path}")


main()
