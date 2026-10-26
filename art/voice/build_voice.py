"""Turn raw voice recordings into the clips the app plays.

Put recordings in art/voice/raw/ named <emotion>-<n>.<wav|mp3|m4a|flac|ogg>,
e.g. happy-1.wav, happy-2.wav, surprised-1.wav. Emotions are the VoiceKind
names in src/audio/voice.ts (listed in KINDS below).

Usage (from repo root, needs ffmpeg with rubberband):
  python art/voice/build_voice.py                 # as recorded
  python art/voice/build_voice.py --pitch 1.15    # raise pitch 15%, keep formants (sounds younger, not chipmunk)

Each clip is trimmed of leading/trailing silence, loudness-normalized, faded
in/out and encoded to mono MP3 in public/voice/, plus public/voice/manifest.json.
"""

import argparse
import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = Path(__file__).resolve().parent / "raw"
OUT = ROOT / "public" / "voice"
KINDS = ["neutral", "happy", "giggle", "surprised", "curious", "shy", "hurt", "cry", "dizzy",
         "sleepy", "cheer", "angry", "scared", "fly", "hum", "sigh"]
NAME_RE = re.compile(r"^([a-z]+)-(\d+)\.(wav|mp3|m4a|flac|ogg)$")


def build(src: Path, dst: Path, pitch: float):
    chain = [
        # trim silence at both ends
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02",
        "areverse",
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06",
        "areverse",
    ]
    if pitch != 1:
        chain.append(f"rubberband=pitch={pitch}:formant=preserved")
    chain += [
        "loudnorm=I=-18:TP=-2:LRA=9",
        "afade=t=in:d=0.008",
        "areverse",
        "afade=t=in:d=0.04",
        "areverse",
    ]
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-af", ",".join(chain),
         "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-q:a", "4", str(dst)],
        check=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pitch", type=float, default=1.0, help="pitch factor, formants preserved (e.g. 1.15)")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.mp3"):
        old.unlink()
    manifest: dict[str, list[str]] = defaultdict(list)
    for src in sorted(RAW.iterdir()):
        m = NAME_RE.match(src.name)
        if not m:
            continue
        kind = m.group(1)
        if kind not in KINDS:
            print(f"skip {src.name}: unknown emotion '{kind}'")
            continue
        dst = OUT / f"{kind}-{m.group(2)}.mp3"
        build(src, dst, args.pitch)
        manifest[kind].append(dst.name)
        print(f"{src.name} → {dst.name}")
    (OUT / "manifest.json").write_text(json.dumps(dict(sorted(manifest.items())), indent=2, ensure_ascii=False))
    missing = [k for k in KINDS if k not in manifest]
    print(f"{sum(map(len, manifest.values()))} clips; synthesized fallback for: {', '.join(missing) or 'none'}")


if __name__ == "__main__":
    main()
