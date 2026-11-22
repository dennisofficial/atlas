# Video transcription — validation and release inventory

The skill contains timestamped narration, recognition evidence, and selected visual frames. Raw videos, audio, model weights, and temporary extraction files are not bundled.

## Method and limits

- Full-length stereo AAC tracks were extracted as mono 16 kHz PCM. Exact audio durations come from WAV sample counts; video durations come from ffmpeg metadata.
- Primary local MLX model: `mlx-community/whisper-large-v3-turbo` at revision `a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb`; engine `mlx-whisper 0.4.3`.
- Independent local model: `mlx-community/whisper-large-v3-mlx` at revision `49e6aa286ad60c14352c404340ded53710378a11`. Each video received both full-file decodes; 17 difficult/gap/outro clips were additionally decoded without previous-text conditioning.
- The whole-file large-v3 output was worse: it introduced incoherent phrases and omitted genuine clauses. Turbo was selected instead; large-v3 isolated clips informed two phrase repairs. Five total spelling/phrase normalizations are explicitly recorded, with raw text and original word evidence preserved.
- Narration was inspected for coherent English at the beginning, middle, and end of every video. All primary segments were text-reviewed. No direct human listening verification was performed; recognition caveats are retained in each transcript.
- Ending music/comparison intervals generated inconsistent short phrases (All right, Thank you, Bye, or a repeated closing sentence). These are marked suspected hallucinations, excluded from narration, and preserved in JSON. No content was invented to fill gaps.
- All 40 JPEGs were visually reviewed in contact sheets or individually. Source aspect ratio is retained at 1280 × 720. Frame cadence never exceeds 143 seconds, with extra meaningful teaching transitions.
- Checks: nonempty English JSON/Markdown; finite bounded monotonic timestamps; exact accepted-plus-excluded segment accounting; narration parity between JSON and Markdown; all local links resolve; each Markdown file ≤300 lines; no audio/video/model binaries in this bundle.

## Exact durations and ending coverage

| Video | Video seconds | Audio seconds | Raw last end | Accepted narration end | Tail interval | Segments | Frames |
|---|---:|---:|---:|---:|---:|---:|---:|
| content-design | 728.45 | 728.4480000 | 728.42 | 703.90 | 24.5480000 | 140 | 13 |
| complex-form | 672.85 | 672.8533125 | 672.80 | 650.02 | 22.8333125 | 127 | 12 |
| dashboard | 1039.98 | 1039.9786875 | 1026.54 | 1016.48 | 23.4986875 | 283 | 15 |

## Internal intervals of at least two seconds

These are recorded gaps between recognized utterances, not proven missing speech. Longer intervals are explicitly exposed rather than disguised as continuous narration.

### Content design

- 05:32.54–05:35.56: 3.02 seconds.
- 07:32.12–07:34.22: 2.10 seconds.
- 08:27.56–08:31.92: 4.36 seconds.
- 09:01.74–09:11.70: 9.96 seconds.
- 10:14.66–10:17.54: 2.88 seconds.
- 10:55.38–10:57.58: 2.20 seconds.
- 11:36.94–11:39.50: 2.56 seconds.

### Complex form

- 01:04.32–01:06.86: 2.54 seconds.
- 01:55.94–01:58.42: 2.48 seconds.
- 03:51.74–03:53.84: 2.10 seconds.
- 05:56.54–06:00.66: 4.12 seconds.
- 07:11.10–07:13.92: 2.82 seconds.
- 07:47.20–07:49.78: 2.58 seconds.

### Dashboard

- 01:34.58–01:38.90: 4.32 seconds.
- 03:37.00–03:39.58: 2.58 seconds.
- 05:09.64–05:11.70: 2.06 seconds.
- 05:37.64–05:39.64: 2.00 seconds.
- 06:40.08–06:42.40: 2.32 seconds.
- 07:34.46–07:36.56: 2.10 seconds.
- 07:53.90–07:56.52: 2.62 seconds.
- 08:15.76–08:19.38: 3.62 seconds.
- 09:32.00–09:36.20: 4.20 seconds.
- 10:17.16–10:21.86: 4.70 seconds.
- 11:44.12–11:47.74: 3.62 seconds.
- 14:07.36–14:12.14: 4.78 seconds.
- 15:26.24–15:28.30: 2.06 seconds.
- 16:48.24–16:51.18: 2.94 seconds.

The longest internal interval is content-design 09:01.74–09:11.70 (9.96 seconds). The 08:56–09:15 isolated decode repeated the surrounding narration without recovering additional speech in the gap.

## Output paths

- [complex-form/complex-form.json](../assets/video-complex-form.json)
- [complex-form/complex-form.md](video-complex-form.md)
- [complex-form/frames/complex-form-00-05.jpg](../assets/video-complex-form-00-05.jpg)
- [complex-form/frames/complex-form-00-30.jpg](../assets/video-complex-form-00-30.jpg)
- [complex-form/frames/complex-form-01-56.jpg](../assets/video-complex-form-01-56.jpg)
- [complex-form/frames/complex-form-02-42.jpg](../assets/video-complex-form-02-42.jpg)
- [complex-form/frames/complex-form-03-52.jpg](../assets/video-complex-form-03-52.jpg)
- [complex-form/frames/complex-form-05-12.jpg](../assets/video-complex-form-05-12.jpg)
- [complex-form/frames/complex-form-06-13.jpg](../assets/video-complex-form-06-13.jpg)
- [complex-form/frames/complex-form-07-47.jpg](../assets/video-complex-form-07-47.jpg)
- [complex-form/frames/complex-form-09-16.jpg](../assets/video-complex-form-09-16.jpg)
- [complex-form/frames/complex-form-09-32.jpg](../assets/video-complex-form-09-32.jpg)
- [complex-form/frames/complex-form-10-44.jpg](../assets/video-complex-form-10-44.jpg)
- [complex-form/frames/complex-form-11-03.jpg](../assets/video-complex-form-11-03.jpg)
- [content-design/content-design.json](../assets/video-content-design.json)
- [content-design/content-design.md](video-content-design.md)
- [content-design/frames/content-design-00-05.jpg](../assets/video-content-design-00-05.jpg)
- [content-design/frames/content-design-00-30.jpg](../assets/video-content-design-00-30.jpg)
- [content-design/frames/content-design-01-52.jpg](../assets/video-content-design-01-52.jpg)
- [content-design/frames/content-design-02-58.jpg](../assets/video-content-design-02-58.jpg)
- [content-design/frames/content-design-04-30.jpg](../assets/video-content-design-04-30.jpg)
- [content-design/frames/content-design-05-34.jpg](../assets/video-content-design-05-34.jpg)
- [content-design/frames/content-design-06-06.jpg](../assets/video-content-design-06-06.jpg)
- [content-design/frames/content-design-07-30.jpg](../assets/video-content-design-07-30.jpg)
- [content-design/frames/content-design-08-30.jpg](../assets/video-content-design-08-30.jpg)
- [content-design/frames/content-design-09-52.jpg](../assets/video-content-design-09-52.jpg)
- [content-design/frames/content-design-10-52.jpg](../assets/video-content-design-10-52.jpg)
- [content-design/frames/content-design-11-37.jpg](../assets/video-content-design-11-37.jpg)
- [content-design/frames/content-design-11-58.jpg](../assets/video-content-design-11-58.jpg)
- [dashboard/dashboard-part-1.md](video-dashboard-part-1.md)
- [dashboard/dashboard-part-2.md](video-dashboard-part-2.md)
- [dashboard/dashboard.json](../assets/video-dashboard.json)
- [dashboard/frames/dashboard-00-05.jpg](../assets/video-dashboard-00-05.jpg)
- [dashboard/frames/dashboard-00-30.jpg](../assets/video-dashboard-00-30.jpg)
- [dashboard/frames/dashboard-02-02.jpg](../assets/video-dashboard-02-02.jpg)
- [dashboard/frames/dashboard-03-37.jpg](../assets/video-dashboard-03-37.jpg)
- [dashboard/frames/dashboard-04-43.jpg](../assets/video-dashboard-04-43.jpg)
- [dashboard/frames/dashboard-05-33.jpg](../assets/video-dashboard-05-33.jpg)
- [dashboard/frames/dashboard-06-40.jpg](../assets/video-dashboard-06-40.jpg)
- [dashboard/frames/dashboard-07-55.jpg](../assets/video-dashboard-07-55.jpg)
- [dashboard/frames/dashboard-09-44.jpg](../assets/video-dashboard-09-44.jpg)
- [dashboard/frames/dashboard-10-34.jpg](../assets/video-dashboard-10-34.jpg)
- [dashboard/frames/dashboard-11-44.jpg](../assets/video-dashboard-11-44.jpg)
- [dashboard/frames/dashboard-14-07.jpg](../assets/video-dashboard-14-07.jpg)
- [dashboard/frames/dashboard-15-27.jpg](../assets/video-dashboard-15-27.jpg)
- [dashboard/frames/dashboard-16-48.jpg](../assets/video-dashboard-16-48.jpg)
- [dashboard/frames/dashboard-17-10.jpg](../assets/video-dashboard-17-10.jpg)
- [Machine-readable walkthrough coverage](../assets/video-coverage.json).
