from __future__ import annotations

import argparse
import io
import subprocess
import tempfile
from pathlib import Path

from openpyxl import load_workbook


def convert_xls_to_xlsx(excel_path: Path, output_dir: Path) -> Path:
    cmd = [
        "libreoffice",
        "--headless",
        "--convert-to",
        "xlsx",
        "--outdir",
        str(output_dir),
        str(excel_path),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise SystemExit("libreoffice is required but was not found in PATH") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or "unknown error"
        raise SystemExit(f"libreoffice conversion failed: {detail}") from exc

    xlsx_path = output_dir / f"{excel_path.stem}.xlsx"
    if not xlsx_path.exists():
        raise SystemExit(f"Converted file not found: {xlsx_path}")
    return xlsx_path


def extract_sheet1_images(xlsx_path: Path, output_dir: Path) -> int:
    wb = load_workbook(xlsx_path)
    ws = wb.worksheets[0]

    count = 0
    for image in getattr(ws, "_images", []):
        anchor = getattr(image, "anchor", None)
        marker = getattr(anchor, "_from", None)
        if marker is None:
            continue

        row = marker.row + 1
        if row < 3:
            continue

        image_bytes = image._data()
        image_format = (getattr(image, "format", None) or "png").lower()
        output_path = output_dir / f"img_{count:04d}.{image_format}"
        output_path.write_bytes(image_bytes if isinstance(image_bytes, bytes) else io.BytesIO(image_bytes).getvalue())
        count += 1

    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract images from Excel Sheet1 on Linux")
    parser.add_argument("--excel", required=True, help="Path to the source .xls file")
    parser.add_argument("--output", required=True, help="Directory to store extracted images")
    args = parser.parse_args()

    excel_path = Path(args.excel).expanduser()
    output_dir = Path(args.output).expanduser()

    if not excel_path.exists():
        raise SystemExit(f"Excel file not found: {excel_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="furni-xlsx-") as tmpdir:
        xlsx_path = convert_xls_to_xlsx(excel_path, Path(tmpdir))
        count = extract_sheet1_images(xlsx_path, output_dir)

    print(f"EXTRACTED_COUNT={count}")


if __name__ == "__main__":
    main()
