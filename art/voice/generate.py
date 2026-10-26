"""Generate Chubby Whale's wordless voice clips (galgame-style interjections).

Two OpenAI-compatible APIs are supported:
  --model gpt-4o-mini-tts       POST /audio/speech with acting `instructions` (default)
  --model gpt-4o-audio-preview  POST /chat/completions with audio output
Endpoint and key: VOICE_API_BASE_URL / VOICE_API_KEY, falling back to the image
skill's lookup (IMAGE_API_* or the current Codex provider). Note: Codex/ChatGPT
gateways usually don't serve audio models; use a regular OpenAI API key.

Usage (from repo root):
  python art/voice/generate.py                 # all clips that don't exist yet
  python art/voice/generate.py happy giggle    # only these emotions
  python art/voice/generate.py --voice coral --only "えへへ～" --out /tmp/test.wav
Writes art/voice/raw/<emotion>-<n>.wav and a .json report next to each, then run
art/voice/build_voice.py. Disclose to users that the voice is AI-generated.
"""

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".claude/skills/sub2api-imagegen/scripts"))
from image_api import resolve  # noqa: E402  (shared config lookup)

RAW = Path(__file__).resolve().parent / "raw"
MODEL = "gpt-4o-mini-tts"
VOICE = "shimmer"

DIRECTION = (
    "你是一位日系 galgame 配音演员，正在为一个 Q 版萌系鲸鱼少女角色录制「语气音」。"
    "声线：高音调、甜美、软萌、元气，像动漫里的小女孩角色，带一点撒娇感。"
    "每次只发出用户要求的那一个语气音，语气要夸张、可爱、有感情，像 galgame 里的角色反应音。"
    "绝对不要说任何别的话，不要解释，不要重复，不要加前缀或结尾。"
)

# Emotion → (acting note, interjections). Keep in sync with VoiceKind in src/audio/voice.ts.
CLIPS: dict[str, tuple[str, list[str]]] = {
    "neutral": ("轻松随意地回应", ["ん？", "はーい", "んー"]),
    "happy": ("非常开心、雀跃", ["えへへ～", "わぁい！", "やったぁ！"]),
    "giggle": ("忍不住偷笑、害羞地笑", ["えへへへ", "ふふっ", "くすくす"]),
    "surprised": ("突然被吓到、惊讶", ["きゃっ！", "ひゃっ！", "ふぇっ！？"]),
    "curious": ("歪着头好奇地询问", ["んー？", "ほぇ？", "なになに？"]),
    "shy": ("害羞、脸红、小声", ["はぅ…", "あぅぅ…", "えへ…"]),
    "hurt": ("撞疼了，委屈地叫痛", ["いたっ！", "あぅっ！", "いたたた…"]),
    "cry": ("委屈地哭出来，哭腔", ["ふぇぇぇん…", "うわぁぁん！"]),
    "dizzy": ("头晕眼花、晕乎乎、软绵绵", ["はわわわ…", "ふにゃぁ…", "きゅ～…"]),
    "sleepy": ("困倦地打哈欠、迷迷糊糊", ["ふぁぁ～", "むにゃむにゃ…", "すぅ…すぅ…"]),
    "cheer": ("元气满满地给人加油", ["がんばれ～！", "ファイト！", "えいえいおー！"]),
    "angry": ("鼓着腮帮子假装生气，一点都不凶", ["むぅ～！", "ぷんぷん！", "もう！"]),
    "scared": ("被拎起来慌张害怕", ["ひゃぁぁ！", "わわわっ！", "きゃぁぁ！"]),
    "fly": ("被扔到空中又怕又兴奋地喊", ["わぁぁぁ～い！", "ひゅ～ん！"]),
    "hum": ("心情很好地轻声哼歌", ["ふんふふ～ん♪", "らんらら～♪"]),
    "sigh": ("无奈地轻轻叹气", ["はぁ…", "ふぅ…"]),
}


def request(base: str, key: str, model: str, voice: str, note: str, text: str, timeout: float) -> tuple[bytes, dict]:
    if "tts" in model:
        payload = {
            "model": model,
            "voice": voice,
            "input": text,
            "instructions": f"{DIRECTION}\n这一次的语气：{note}。",
            "response_format": "wav",
        }
        r = requests.post(f"{base}/audio/speech", headers={"Authorization": f"Bearer {key}"}, json=payload, timeout=timeout)
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        return r.content, {"transcript": text}
    payload = {
        "model": model,
        "modalities": ["text", "audio"],
        "audio": {"voice": voice, "format": "wav"},
        "messages": [
            {"role": "system", "content": DIRECTION},
            {"role": "user", "content": f"语气：{note}。请只发出这个语气音：「{text}」"},
        ],
    }
    r = requests.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=payload, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
    msg = r.json()["choices"][0]["message"]
    audio = msg.get("audio") or {}
    if not audio.get("data"):
        raise RuntimeError(f"no audio in response: {json.dumps(msg, ensure_ascii=False)[:300]}")
    return base64.b64decode(audio["data"]), {"transcript": audio.get("transcript"), "usage": r.json().get("usage")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("emotions", nargs="*")
    ap.add_argument("--voice", default=VOICE)
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--only", help="generate one interjection to --out (for auditioning voices)")
    ap.add_argument("--note", default="可爱")
    ap.add_argument("--out")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    # resolve() expects the image script's argparse namespace.
    cfg = argparse.Namespace(
        config=None,
        # A voice key alone means official OpenAI — never send it to the image gateway.
        base_url=os.getenv("VOICE_API_BASE_URL") or ("https://api.openai.com/v1" if os.getenv("VOICE_API_KEY") else None),
        api_key_env=None,
        api_key_file=None,
        api_key=os.getenv("VOICE_API_KEY"),
        model=args.model,
        timeout=120,
    )
    base, key = resolve(cfg)

    if args.only:
        data, info = request(base, key, args.model, args.voice, args.note, args.only, 120)
        Path(args.out).write_bytes(data)
        print(json.dumps({"out": args.out, **info}, ensure_ascii=False))
        return

    RAW.mkdir(parents=True, exist_ok=True)
    for emotion, (note, lines) in CLIPS.items():
        if args.emotions and emotion not in args.emotions:
            continue
        for i, text in enumerate(lines, 1):
            out = RAW / f"{emotion}-{i}.wav"
            if out.exists() and not args.force:
                continue
            t = time.time()
            try:
                data, info = request(base, key, args.model, args.voice, note, text, 120)
            except Exception as e:  # keep going; report at the end
                print(f"FAIL {out.name}: {e}")
                continue
            out.write_bytes(data)
            report = {"emotion": emotion, "text": text, "note": note, "voice": args.voice, "model": args.model, **info}
            out.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(f"ok {out.name} {text} → {info['transcript']!r} ({time.time() - t:.1f}s)")


if __name__ == "__main__":
    main()
