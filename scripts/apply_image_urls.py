from pathlib import Path
import sqlite3

from app.paths import ASSETS_DIR, DB_PATH

DB = DB_PATH
IMG_DIR = ASSETS_DIR / 'product-images'

conn = sqlite3.connect(DB)
cur = conn.cursor()

updated = 0
for img in IMG_DIR.glob('*.png'):
    code = img.stem
    rel = f"/assets/product-images/{img.name}"
    cur.execute(
        "update products set cover_image_url=? where product_code=?",
        (rel, code),
    )
    updated += cur.rowcount

conn.commit()
print(f"UPDATED_PRODUCTS={updated}")
