#!/usr/bin/env python3

import argparse
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--cpu-threads", type=int, default=16)
    parser.add_argument("--language", default="")
    args = parser.parse_args()

    audio_path = Path(args.audio_path)
    if not audio_path.exists():
      raise FileNotFoundError(f"Audio file not found: {audio_path}")

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=args.cpu_threads,
    )

    segments, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        language=args.language or None,
        vad_filter=True,
        condition_on_previous_text=True,
    )

    text_parts = []
    segment_items = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            text_parts.append(text)
        segment_items.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": text,
            }
        )

    payload = {
        "text": " ".join(text_parts).strip(),
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "segments": segment_items,
        "model": args.model,
        "backend": "local-whisper",
    }
    json.dump(payload, sys.stdout, ensure_ascii=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

