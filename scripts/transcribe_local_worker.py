#!/usr/bin/env python3

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from faster_whisper import WhisperModel


def write_message(payload: dict) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=True)
    sys.stdout.write("\n")
    sys.stdout.flush()


def transcribe(model: WhisperModel, audio_path: str, language: Optional[str]) -> dict:
    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        language=language or None,
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

    return {
        "text": " ".join(text_parts).strip(),
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "segments": segment_items,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--cpu-threads", type=int, default=16)
    parser.add_argument("--language", default="")
    args = parser.parse_args()

    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        cpu_threads=args.cpu_threads,
    )

    write_message(
        {
            "type": "ready",
            "backend": "local-whisper",
            "model": args.model,
        }
    )

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request = json.loads(line)
        request_id = request.get("id")
        request_type = request.get("type", "transcribe")

        if request_type == "shutdown":
          write_message({"type": "shutdown", "ok": True})
          return 0

        audio_path = Path(request["audio_path"])
        language = request.get("language") or args.language or None

        try:
            if not audio_path.exists():
                raise FileNotFoundError(f"Audio file not found: {audio_path}")

            result = transcribe(model, str(audio_path), language)
            write_message(
                {
                    "type": "result",
                    "id": request_id,
                    "ok": True,
                    "model": args.model,
                    "backend": "local-whisper",
                    **result,
                }
            )
        except Exception as error:
            write_message(
                {
                    "type": "result",
                    "id": request_id,
                    "ok": False,
                    "error": str(error),
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
