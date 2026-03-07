from __future__ import annotations

import shutil
from pathlib import Path

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import engine
from app.models import Product


def read_sheet1_item_codes(xls_path: Path) -> list[str]:
    raw = pd.read_excel(xls_path, sheet_name="Sheet1", header=None)
    header = raw.iloc[1].tolist()
    df = raw.iloc[2:].copy()
    df.columns = header

    item_col = header[0]
    codes = (
        df[item_col]
        .dropna()
        .astype(str)
        .str.strip()
        .tolist()
    )
    return [c for c in codes if c]


def main() -> None:
    downloads = Path(r"c:\Users\JIMMY\Downloads")
    xls_candidates = [p for p in downloads.glob("2026.3*.xls") if "(1)" in p.name]
    if not xls_candidates:
        raise SystemExit("Cannot find xls file containing '(1)' in Downloads")
    xls_path = xls_candidates[0]

    source_dir = Path("extracted_images_sheet1")
    if not source_dir.exists():
        raise SystemExit("Missing extracted_images_sheet1 folder")

    image_files = sorted(source_dir.glob("img_*.*"))
    if not image_files:
        raise SystemExit("No extracted images found")

    target_dir = Path("static/product_images")
    target_dir.mkdir(parents=True, exist_ok=True)

    item_codes = read_sheet1_item_codes(xls_path)
    pair_count = min(len(item_codes), len(image_files))

    copied = 0
    mapped = 0
    missing_products = 0

    with Session(engine) as db:
        for idx in range(pair_count):
            code = item_codes[idx]
            src = image_files[idx]
            ext = src.suffix.lower() or ".jpg"
            dst = target_dir / f"{code}{ext}"

            if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dst)
                copied += 1

            product = db.scalar(select(Product).where(Product.product_code == code))
            if not product:
                missing_products += 1
                continue

            product.cover_image_url = f"/static/product_images/{dst.name}"
            mapped += 1

        db.commit()

    print(f"xls={xls_path.name}")
    print(f"sheet_items={len(item_codes)} images={len(image_files)} paired={pair_count}")
    print(f"copied={copied} mapped={mapped} missing_products={missing_products}")


if __name__ == "__main__":
    main()
