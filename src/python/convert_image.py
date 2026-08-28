import os
import platform
import sys
from pathlib import Path

# Homebrew keeps Cairo outside macOS' default dynamic-library search path.
if sys.platform == "darwin":
    homebrew_prefix = Path("/opt/homebrew" if platform.machine() == "arm64" else "/usr/local")
    homebrew_lib = str(homebrew_prefix / "lib")
    current_library_path = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
    os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = os.pathsep.join(
        part for part in (homebrew_lib, current_library_path) if part
    )

from cairosvg import svg2png
from PIL import Image


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: convert_image.py <input> <output>")

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if input_path.suffix.lower() == ".svg":
        svg2png(url=str(input_path), write_to=str(output_path), scale=3)
        return 0

    with Image.open(input_path) as image:
        if image.mode not in {"RGB", "RGBA", "L", "LA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

        if image.mode == "LA":
            image = image.convert("RGBA")

        image.save(output_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
