import re
from sqlalchemy import text
from sqlalchemy.orm import Session


def _slugify(value: str) -> str:
    s = (value or "").strip().lower()
    s = s.replace("_", "-").replace(" ", "-")
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "other"


def _infer_category_slug(raw_category: str | None, product_name: str | None) -> str:
    raw = _slugify(raw_category or "")
    if raw and raw not in {"imported", "imported-group", "imported-sku"}:
        return raw

    name = (product_name or "").lower()
    if any(k in name for k in ["lamp", "lighting", "candle"]):
        return "lighting"
    if any(k in name for k in ["sofa", "living", "coffee table"]):
        return "living-room"
    if any(k in name for k in ["bed", "nightstand", "dresser"]):
        return "bedroom"
    if any(k in name for k in ["chair", "dining"]):
        return "dining"
    if any(k in name for k in ["rug", "textile"]):
        return "textile"
    if any(k in name for k in ["cabinet", "storage"]):
        return "storage"
    if any(k in name for k in ["desk", "office"]):
        return "office"
    if any(k in name for k in ["bench", "entry"]):
        return "entry"
    if any(k in name for k in ["mirror", "decor", "vase", "bookend"]):
        return "decor"
    return "accessories"


def run_schema_migrations(session: Session) -> None:
    conn = session.connection()

    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(255) NOT NULL,
                owner_user_id INTEGER,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )

    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS store_memberships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                store_id INTEGER NOT NULL,
                role_in_store VARCHAR(32) DEFAULT 'staff',
                is_default BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, store_id)
            )
            """
        )
    )

    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS oauth_identities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                provider VARCHAR(32) NOT NULL,
                provider_user_id VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, provider_user_id)
            )
            """
        )
    )

    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug VARCHAR(64) UNIQUE NOT NULL,
                name_zh VARCHAR(128) NOT NULL,
                name_en VARCHAR(128),
                parent_id INTEGER,
                level INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )

    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS product_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                category_id INTEGER NOT NULL,
                is_primary BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(product_id, category_id)
            )
            """
        )
    )

    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS collection_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                image_url TEXT NOT NULL,
                caption TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )

    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS collection_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    )

    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS highlight_products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section VARCHAR(32) NOT NULL,
                product_id INTEGER NOT NULL,
                position INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(section, product_id)
            )
            """
        )
    )

    product_cols = {
        row[1]
        for row in conn.execute(text("PRAGMA table_info(products)")).fetchall()
    }
    if "category_id" not in product_cols:
        conn.execute(text("ALTER TABLE products ADD COLUMN category_id INTEGER"))

    collection_cols = {
        row[1]
        for row in conn.execute(text("PRAGMA table_info(collections)")).fetchall()
    }
    if "visibility" not in collection_cols:
        conn.execute(text("ALTER TABLE collections ADD COLUMN visibility VARCHAR(16) DEFAULT 'private'"))
    if "is_store_scene" not in collection_cols:
        conn.execute(text("ALTER TABLE collections ADD COLUMN is_store_scene BOOLEAN DEFAULT 0"))
    if "store_id" not in collection_cols:
        conn.execute(text("ALTER TABLE collections ADD COLUMN store_id INTEGER"))
    conn.execute(text("UPDATE collections SET visibility = COALESCE(visibility, 'private')"))
    conn.execute(text("UPDATE collections SET is_store_scene = COALESCE(is_store_scene, 0)"))

    user_cols = {
        row[1]
        for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()
    }
    if "role" not in user_cols:
        conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'customer'"))
    conn.execute(text("UPDATE users SET role = COALESCE(role, 'customer')"))
    conn.execute(
        text(
            """
            UPDATE users
            SET role = 'store_admin'
            WHERE id IN (
                SELECT DISTINCT owner_id
                FROM collections
                WHERE COALESCE(is_store_scene, 0) = 1
            )
            """
        )
    )

    # Backfill stores and memberships from existing store scenes.
    store_owner_rows = conn.execute(
        text(
            """
            SELECT DISTINCT c.owner_id, COALESCE(u.display_name, 'Store')
            FROM collections c
            LEFT JOIN users u ON u.id = c.owner_id
            WHERE COALESCE(c.is_store_scene, 0) = 1
            """
        )
    ).fetchall()
    owner_to_store_id: dict[int, int] = {}
    for owner_id, owner_name in store_owner_rows:
        if owner_id is None:
            continue
        existing = conn.execute(
            text("SELECT id FROM stores WHERE owner_user_id = :uid LIMIT 1"),
            {"uid": owner_id},
        ).fetchone()
        if existing:
            owner_to_store_id[int(owner_id)] = int(existing[0])
            continue
        store_name = f"{owner_name} Store".strip()
        conn.execute(
            text(
                """
                INSERT INTO stores (name, owner_user_id, is_active)
                VALUES (:name, :uid, 1)
                """
            ),
            {"name": store_name, "uid": owner_id},
        )
        created_id = conn.execute(
            text("SELECT id FROM stores WHERE owner_user_id = :uid ORDER BY id DESC LIMIT 1"),
            {"uid": owner_id},
        ).fetchone()[0]
        owner_to_store_id[int(owner_id)] = int(created_id)

    for owner_id, store_id in owner_to_store_id.items():
        conn.execute(
            text(
                """
                INSERT OR IGNORE INTO store_memberships (user_id, store_id, role_in_store, is_default)
                VALUES (:uid, :sid, 'owner', 1)
                """
            ),
            {"uid": owner_id, "sid": store_id},
        )
        conn.execute(
            text(
                """
                UPDATE collections
                SET store_id = :sid
                WHERE owner_id = :uid
                  AND COALESCE(is_store_scene, 0) = 1
                  AND store_id IS NULL
                """
            ),
            {"uid": owner_id, "sid": store_id},
        )

    default_categories = [
        ("bedroom", "臥室"),
        ("living-room", "客廳"),
        ("lighting", "燈飾"),
        ("dining", "餐廳"),
        ("textile", "織品"),
        ("storage", "收納"),
        ("office", "辦公"),
        ("entry", "玄關"),
        ("decor", "家飾"),
        ("accessories", "配件"),
        ("other", "其他"),
    ]
    for slug, name_zh in default_categories:
        conn.execute(
            text(
                """
                INSERT INTO categories (slug, name_zh, level, sort_order, is_active, created_at)
                SELECT :slug, :name_zh, 1, 0, 1, CURRENT_TIMESTAMP
                WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = :slug)
                """
            ),
            {"slug": slug, "name_zh": name_zh},
        )

    rows = conn.execute(
        text("SELECT id, category, name FROM products")
    ).fetchall()

    slug_to_id: dict[str, int] = {
        row[1]: row[0]
        for row in conn.execute(text("SELECT id, slug FROM categories")).fetchall()
    }

    for product_id, raw_category, product_name in rows:
        slug = _infer_category_slug(raw_category, product_name)
        if slug not in slug_to_id:
            conn.execute(
                text(
                    """
                    INSERT INTO categories (slug, name_zh, level, sort_order, is_active, created_at)
                    VALUES (:slug, :name_zh, 1, 0, 1, CURRENT_TIMESTAMP)
                    """
                ),
                {"slug": slug, "name_zh": slug},
            )
            category_id = conn.execute(
                text("SELECT id FROM categories WHERE slug = :slug"),
                {"slug": slug},
            ).fetchone()[0]
            slug_to_id[slug] = category_id
        category_id = slug_to_id[slug]

        conn.execute(
            text("UPDATE products SET category_id = :cid WHERE id = :pid"),
            {"cid": category_id, "pid": product_id},
        )
        conn.execute(
            text(
                """
                INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary)
                VALUES (:pid, :cid, 1)
                """
            ),
            {"pid": product_id, "cid": category_id},
        )
