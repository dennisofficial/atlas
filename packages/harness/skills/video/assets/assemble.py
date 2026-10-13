import os, pathlib, sys

TICK = 1 / 60
frames = sorted(pathlib.Path(sys.argv[1]).resolve().glob('*.jpg'))
ticks_dir = pathlib.Path(sys.argv[2])
times = [int(f.stem) / 1e6 for f in frames]
slots = [0]
for t in times[1:]:
    slots.append(max(slots[-1] + 1, round((t - times[0]) / TICK)))
ticks_dir.mkdir(parents=True, exist_ok=True)
for frame, start, end in zip(frames, slots, slots[1:] + [slots[-1] + 1]):
    for tick in range(start, end):
        os.symlink(frame, ticks_dir / f'{tick:06d}.jpg')
