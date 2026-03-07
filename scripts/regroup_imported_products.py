from __future__ import annotations

import re
import sqlite3
from pathlib import Path

DB = Path('furni.db')


def normalize_prefix(code: str) -> str:
    code = (code or '').upper().strip()
    m = re.match(r'^([A-Z]+)', code)
    if m:
        return m.group(1)
    return code[:6] or 'UNKNOWN'


def zh_label_from_desc(desc: str) -> str:
    s = (desc or '').upper()
    if 'HORSE' in s:
        return '馬造型擺件'
    if 'BOOKEND' in s:
        return '書擋擺件'
    if 'GLASS' in s:
        return '玻璃飾品'
    if 'CANDLE' in s:
        return '燭台燈飾'
    if 'WALL ART' in s or 'WALL' in s:
        return '牆面藝術'
    if 'VASE' in s:
        return '花器'
    if 'MIRROR' in s:
        return '鏡飾'
    if 'TRAY' in s:
        return '托盤'
    if 'LAMP' in s:
        return '燈飾'
    return '家飾商品'


def non_empty(v: object) -> bool:
    if v is None:
        return False
    s = str(v).strip().lower()
    return s not in ('', 'nan', 'none', 'null')


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    src_rows = c.execute(
        """
        select p.id as product_id, p.product_code, p.name, p.brand, p.cover_image_url,
               v.id as variant_id, v.price, v.stock
        from products p
        join product_variants v on v.product_id = p.id
        where p.category in ('imported', 'imported_sku')
        order by p.id asc
        """
    ).fetchall()

    if not src_rows:
        print('no imported rows found')
        return

    source_ids = sorted({r['product_id'] for r in src_rows})

    # Keep source rows but mark clearly as SKU-source records.
    c.execute(
        f"update products set category='imported_sku' where id in ({','.join(['?']*len(source_ids))})",
        source_ids,
    )

    # Remove prior grouped products and their relations (idempotent rerun).
    old_grouped = c.execute("select id from products where category='imported_group'").fetchall()
    old_group_ids = [r['id'] for r in old_grouped]
    if old_group_ids:
        ph = ','.join(['?'] * len(old_group_ids))
        c.execute(f"delete from feed_slots where slot_type='product' and ref_id in ({ph})", old_group_ids)
        c.execute(f"delete from product_variants where product_id in ({ph})", old_group_ids)
        c.execute(f"delete from product_images where product_id in ({ph})", old_group_ids)
        c.execute(f"delete from products where id in ({ph})", old_group_ids)

    groups: dict[tuple[str, str], list[sqlite3.Row]] = {}
    for r in src_rows:
        brand = (r['brand'] or 'HD').strip()[:100]
        prefix = normalize_prefix(r['product_code'])
        key = (brand, prefix)
        groups.setdefault(key, []).append(r)

    created_products = 0
    created_variants = 0
    new_group_ids: list[int] = []

    for (brand, prefix), rows in sorted(groups.items(), key=lambda x: x[0]):
        first = rows[0]
        label = zh_label_from_desc(first['name'])
        product_code = f"GRP-{brand}-{prefix}"[:64]
        name_zh = f"{brand} {label}（{prefix}系列）"[:255]
        cover = first['cover_image_url'] if non_empty(first['cover_image_url']) else None

        c.execute(
            """
            insert into products (product_code, name, brand, category, description, cover_image_url, created_at)
            values (?, ?, ?, 'imported_group', ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                product_code,
                name_zh,
                brand,
                f"SKU regrouped by prefix {prefix}.",
                cover,
            ),
        )
        group_pid = c.lastrowid
        new_group_ids.append(group_pid)
        created_products += 1

        for row in rows:
            variant_code = row['product_code']
            c.execute(
                """
                insert into product_variants
                (product_id, variant_code, color, size_label, material, price, stock, created_at)
                values (?, ?, null, null, null, ?, ?, CURRENT_TIMESTAMP)
                """,
                (group_pid, variant_code, row['price'], row['stock']),
            )
            created_variants += 1

    # Rebuild feed slots: put grouped products first, keep other existing product slots after.
    c.execute(
        f"delete from feed_slots where slot_type='product' and ref_id in ({','.join(['?']*len(source_ids))})",
        source_ids,
    )

    other_slots = c.execute(
        """
        select id, slot_type, ref_id
        from feed_slots
        where not (slot_type='product' and ref_id in (select id from products where category='imported_group'))
        order by position asc, id asc
        """
    ).fetchall()

    c.execute("delete from feed_slots")

    pos = 1
    for pid in new_group_ids:
        c.execute(
            "insert into feed_slots (slot_type, ref_id, position) values ('product', ?, ?)",
            (pid, pos),
        )
        pos += 1

    for s in other_slots:
        c.execute(
            "insert into feed_slots (slot_type, ref_id, position) values (?, ?, ?)",
            (s['slot_type'], s['ref_id'], pos),
        )
        pos += 1

    conn.commit()

    print(f"source_sku_products={len(source_ids)}")
    print(f"grouped_products={created_products}")
    print(f"grouped_variants={created_variants}")
    print(f"feed_slots_total={c.execute('select count(*) from feed_slots').fetchone()[0]}")


if __name__ == '__main__':
    main()
