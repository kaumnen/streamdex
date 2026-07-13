#!/usr/bin/env python3
"""Extract the built-in Codex v2 pet atlas into Stream Deck-sized frame assets."""

from __future__ import annotations

import argparse
import io
import json
import re
import struct
from pathlib import Path

from PIL import Image


ASSET_PATTERN = re.compile(r"webview/assets/codex-spritesheet-v\d+-.+\.webp$")
CELL_WIDTH = 192
CELL_HEIGHT = 208
STATES = {
    "idle": (0, 6),
    "running-right": (1, 8),
    "running-left": (2, 8),
    "waving": (3, 4),
    "jumping": (4, 5),
    "failed": (5, 8),
    "waiting": (6, 6),
    "running": (7, 6),
    "review": (8, 6),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--asar",
        type=Path,
        default=Path("/Applications/ChatGPT.app/Contents/Resources/app.asar"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "com.kaumnen.streamdex.sdPlugin"
        / "imgs"
        / "codex-pet",
    )
    return parser.parse_args()


def read_header(path: Path) -> tuple[dict, int]:
    with path.open("rb") as source:
        prefix = source.read(16)
        if len(prefix) != 16:
            raise ValueError("Invalid ASAR header")
        header_size = struct.unpack_from("<I", prefix, 4)[0]
        json_size = struct.unpack_from("<I", prefix, 12)[0]
        header = json.loads(source.read(json_size).decode("utf-8"))
    return header, 8 + header_size


def files(entries: dict, parent: str = ""):
    for name, entry in entries.items():
        path = f"{parent}/{name}" if parent else name
        if "files" in entry:
            yield from files(entry["files"], path)
        else:
            yield path, entry


def main() -> None:
    args = parse_args()
    header, data_offset = read_header(args.asar)
    matches = [
        (path, entry)
        for path, entry in files(header["files"])
        if ASSET_PATTERN.fullmatch(path)
    ]
    if len(matches) != 1:
        raise ValueError(f"Expected one Codex pet atlas, found {len(matches)}")

    asset_path, entry = matches[0]
    with args.asar.open("rb") as source:
        source.seek(data_offset + int(entry["offset"]))
        atlas_bytes = source.read(int(entry["size"]))

    with Image.open(io.BytesIO(atlas_bytes)) as atlas:
        atlas.load()
        if atlas.size != (1536, 2288):
            raise ValueError(f"Unexpected Codex pet atlas size: {atlas.size}")
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for state, (row, count) in STATES.items():
            for column in range(count):
                frame = atlas.crop(
                    (
                        column * CELL_WIDTH,
                        row * CELL_HEIGHT,
                        (column + 1) * CELL_WIDTH,
                        (row + 1) * CELL_HEIGHT,
                    )
                )
                frame.save(
                    args.output_dir / f"{state}-{column}.webp",
                    format="WEBP",
                    lossless=True,
                    method=6,
                )

    metadata = {
        "source": str(args.asar),
        "asset": asset_path,
        "cell": [CELL_WIDTH, CELL_HEIGHT],
        "states": {state: count for state, (_, count) in STATES.items()},
    }
    (args.output_dir / "source.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Extracted {sum(count for _, count in STATES.values())} frames from {asset_path}")


if __name__ == "__main__":
    main()
