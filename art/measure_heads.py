"""Measure each built sprite's head size relative to idle, to set POSES[...]["scale"].

Usage (from repo root, after build_sprites.py):
  python art/measure_heads.py [--skin <id>] [pose ...]      (default skin: standard)
Requires opencv-python-headless (see requirements.txt). Takes a few minutes for all poses.

Two parts of idle's head are template-matched over scales, small rotations and a
horizontal flip: the whole head (headband, bows, face) and the headband with the
ears. The result is their average. A good match scores about 0.6 or more; below
that (e.g. swirly "dizzy" eyes, a head turned far away) the number is unreliable —
measure that pose another way (e.g. the distance between the eyes) and check.

New scale = current scale / measured head size. Frames that are shown in turn
(walk / run cycles, crop_like families) must share one scale: use their average.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "skins" / "standard" / "sprites"  # --skin picks another skin
# Template regions in idle, as fractions of the sprite: (top, bottom, left, right).
REGIONS = {"head": (0.10, 0.44, 0.16, 0.74), "band": (0.04, 0.30, 0.05, 0.86)}
# Tall (7–8 heads) skins: the head is only the top ~15% of idle. "head" is the face
# and bangs, "band" the headdress / headset with the ears.
SKIN_REGIONS = {
    "mature": {"head": (0.06, 0.19, 0.25, 0.55), "band": (0.008, 0.15, 0.14, 0.67)},
    "deep-blue-mature": {"head": (0.034, 0.133, 0.347, 0.653), "band": (0.007, 0.146, 0.286, 0.776)},
}
SCALES = np.arange(0.6, 1.71, 0.03)
ANGLES = range(-24, 25, 6)


def load(name: str) -> np.ndarray:
    im = Image.open(SPRITES / f"{name}.webp").convert("RGBA")
    bg = Image.new("RGBA", im.size, (128, 128, 128, 255))
    bg.alpha_composite(im)
    return np.array(bg.convert("RGB"))[..., ::-1].copy()


def score(img: np.ndarray, tmpl: np.ndarray, s: float, angle: float) -> float:
    t = cv2.resize(tmpl, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    th, tw = t.shape[:2]
    if th >= img.shape[0] or tw >= img.shape[1]:
        return -1.0
    rot = cv2.getRotationMatrix2D((tw / 2, th / 2), angle, 1)
    t = cv2.warpAffine(t, rot, (tw, th), borderMode=cv2.BORDER_REPLICATE)
    return cv2.minMaxLoc(cv2.matchTemplate(img, t, cv2.TM_CCOEFF_NORMED))[1]


def match(img: np.ndarray, tmpl: np.ndarray) -> tuple[float, float]:
    """(head size, match score): coarse search at half resolution, then refine."""
    small = cv2.resize(img, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    best = (-1.0, 1.0, 0, tmpl)
    for t in (tmpl, tmpl[:, ::-1]):
        for s in SCALES:
            for a in ANGLES:
                v = score(small, t, s * 0.5, a)
                if v > best[0]:
                    best = (v, s, a, t)
    v0, s0, a0, t = best
    for s in np.arange(s0 - 0.04, s0 + 0.041, 0.01):
        for a in range(a0 - 6, a0 + 7, 2):
            v = score(img, t, s, a)
            if v > best[0]:
                best = (v, s, a, t)
    return best[1], best[0]


def main():
    global SPRITES, REGIONS
    args = sys.argv[1:]
    if args[:1] == ["--skin"]:
        SPRITES = ROOT / "skins" / args[1] / "sprites"
        REGIONS = SKIN_REGIONS.get(args[1], REGIONS)
        args = args[2:]
    idle = load("idle")
    h, w = idle.shape[:2]
    tmpls = {k: idle[int(h * r[0]) : int(h * r[1]), int(w * r[2]) : int(w * r[3])] for k, r in REGIONS.items()}
    names = args or list(json.loads((SPRITES / "manifest.json").read_text())["poses"])
    for name in names:
        img = cv2.copyMakeBorder(load(name), 200, 200, 200, 200, cv2.BORDER_CONSTANT, value=(128, 128, 128))
        res = {k: match(img, t) for k, t in tmpls.items()}
        size = np.mean([s for s, _ in res.values()])
        low = min(v for _, v in res.values())
        detail = "  ".join(f"{k} {s:.2f} ({v:.2f})" for k, (s, v) in res.items())
        print(f"{name:16} head {size:.2f}   {detail}{'   UNRELIABLE' if low < 0.55 else ''}", flush=True)


if __name__ == "__main__":
    main()
