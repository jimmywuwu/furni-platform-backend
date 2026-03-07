from __future__ import annotations

from pathlib import Path
import re

import pandas as pd
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.database import Base, engine
from app.models import Product, ProductVariant, FeedSlot


def _num(value, default=0.0):
    n = pd.to_numeric(value, errors="coerce")
    if pd.isna(n):
        return default
    return float(n)


def _int(value, default=0):
    n = pd.to_numeric(value, errors="coerce")
    if pd.isna(n):
        return default
    return int(n)


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    if pd.isna(value):
        return ""
    s = str(value).strip()
    s = re.sub(r"\s+", " ", s)
    if s.lower() == "nan":
        return ""
    return s


def _fallback_image(seed: str) -> str:
    # Deterministic placeholder image for products without image URL in source file.
    return f"https://picsum.photos/seed/{seed}/800/600"


def _pick_stock(row: pd.Series) -> int:
    stock_actual = _int(row.get("actual_stock"), default=-1)
    if stock_actual >= 0:
        return stock_actual
    stock_max = _int(row.get("max_qty"), default=-1)
    if stock_max >= 0:
        return stock_max
    return _int(row.get("store_qty"), default=0)


def load_vendor_xls(path: Path) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name="Sheet1", header=None)
    header = raw.iloc[1].tolist()
    data = raw.iloc[2:].copy()
    data.columns = header

    cols = {
        "Item NO\r\n货品代号": "item_no",
        "Brand NO\r\n品牌代码": "brand_no",
        "Size&Description\r\n货品规格": "size_desc",
        "Packing\r\n包装方式": "packing",
        "GW\r\n毛重": "gw",
        "Cube\r\n材积": "cube",
        "Price (CNY)\r\n单价(CNY)": "price_cny",
        "store information\r\n现有数量": "store_qty",
        "On Sales Order inventory\r\n受订量": "sales_order_qty",
        "On-order inventory\r\n在途量": "inbound_qty",
        "Maximum quantity available \r\n最大可受订量": "max_qty",
        "PIC\r\n货品图片": "pic",
        "实际库存": "actual_stock",
    }
    data = data.rename(columns=cols)
    data = data[[c for c in cols.values() if c in data.columns]]
    data = data.dropna(subset=["item_no"])

    data["item_no"] = data["item_no"].map(_clean_text)
    data["brand_no"] = data.get("brand_no", "").map(_clean_text)
    data["size_desc"] = data.get("size_desc", "").map(_clean_text)
    data = data[data["item_no"] != ""]
    return data


def upsert_products(df: pd.DataFrame) -> tuple[int, int, int]:
    Base.metadata.create_all(bind=engine)

    created_products = 0
    created_variants = 0
    created_slots = 0

    with Session(engine) as db:
        max_position = db.scalar(select(func.max(FeedSlot.position))) or 0

        for _, row in df.iterrows():
            product_code = row["item_no"]
            brand = _clean_text(row.get("brand_no")) or "HD"
            desc = _clean_text(row.get("size_desc"))
            if not desc:
                desc = f"Imported product {product_code}"

            product = db.scalar(select(Product).where(Product.product_code == product_code))
            pic_raw = _clean_text(row.get("pic", ""))
            cover_image = pic_raw if pic_raw else _fallback_image(product_code)
            if not product:
                product = Product(
                    product_code=product_code,
                    name=desc[:255],
                    brand=brand[:100],
                    category="imported",
                    description=desc,
                    cover_image_url=cover_image,
                )
                db.add(product)
                db.flush()
                created_products += 1

                max_position += 1
                db.add(FeedSlot(slot_type="product", ref_id=product.id, position=max_position))
                created_slots += 1
            else:
                product.name = desc[:255]
                product.brand = brand[:100]
                product.category = product.category or "imported"
                product.description = desc
                if not product.cover_image_url or str(product.cover_image_url).strip().lower() == "nan":
                    product.cover_image_url = cover_image

            variant_code = f"{product_code}-DEFAULT"
            variant = db.scalar(
                select(ProductVariant).where(
                    ProductVariant.product_id == product.id,
                    ProductVariant.variant_code == variant_code,
                )
            )

            price = _num(row.get("price_cny"), default=0.0)
            stock = _pick_stock(row)

            if not variant:
                variant = ProductVariant(
                    product_id=product.id,
                    variant_code=variant_code,
                    color=None,
                    size_label=None,
                    material=None,
                    price=price,
                    stock=stock,
                )
                db.add(variant)
                created_variants += 1
            else:
                variant.price = price
                variant.stock = stock

        db.commit()

    return created_products, created_variants, created_slots


def main() -> None:
    candidates = sorted(Path(r"c:\Users\JIMMY\Downloads").glob("2026.3*.xls"))
    if not candidates:
        raise SystemExit("Cannot find target .xls in Downloads")

    file_path = candidates[0]
    df = load_vendor_xls(file_path)
    cp, cv, cs = upsert_products(df)
    print(
        f"imported_rows={len(df)} created_products={cp} created_variants={cv} created_feed_slots={cs}"
    )


if __name__ == "__main__":
    main()
