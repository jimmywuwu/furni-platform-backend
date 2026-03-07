from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (
    Collection,
    CollectionItem,
    FeedSlot,
    Product,
    ProductImage,
    ProductVariant,
    User,
    Viewlist,
    Wishlist,
)


def _catalog_specs() -> list[dict]:
    names = [
        ("BED", "Nordic Wooden Bed Frame", "bedroom"),
        ("SFA", "Minimal Linen Sofa", "living-room"),
        ("LMP", "Arc Floor Lamp", "lighting"),
        ("TBL", "Oak Coffee Table", "living-room"),
        ("CHR", "Curved Dining Chair", "dining"),
        ("RUG", "Wool Area Rug", "textile"),
        ("CAB", "Sliding Door Cabinet", "storage"),
        ("DSK", "Compact Work Desk", "office"),
        ("NST", "Floating Nightstand", "bedroom"),
        ("BNH", "Entryway Bench", "entry"),
        ("MIR", "Round Wall Mirror", "decor"),
        ("DRW", "6-Drawer Dresser", "bedroom"),
    ]
    images = [
        "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85",
        "https://images.unsplash.com/photo-1493666438817-866a91353ca9",
        "https://images.unsplash.com/photo-1519710164239-da123dc03ef4",
        "https://images.unsplash.com/photo-1484101403633-562f891dc89a",
        "https://images.unsplash.com/photo-1554995207-c18c203602cb",
        "https://images.unsplash.com/photo-1501045661006-fcebe0257c3f",
    ]
    colors = ["Walnut", "Natural", "Black", "White", "Gray", "Beige"]
    sizes = ["S", "M", "L", "Queen", "King"]
    mats = ["Wood", "Linen", "Steel", "Glass", "Wool", "Leather"]

    specs: list[dict] = []
    for i in range(36):
        base = names[i % len(names)]
        code = f"{base[0]}-{i + 1:03d}"
        price_base = 120 + (i % 10) * 55
        specs.append(
            {
                "code": code,
                "name": f"{base[1]} #{i + 1}",
                "brand": "David Field",
                "category": base[2],
                "description": f"Test product for feed rendering ({code}).",
                "image": images[i % len(images)],
                "variants": [
                    {
                        "code": f"{code}-A",
                        "color": colors[i % len(colors)],
                        "size": sizes[i % len(sizes)],
                        "material": mats[i % len(mats)],
                        "price": price_base,
                        "stock": (i % 5) + 1,
                    },
                    {
                        "code": f"{code}-B",
                        "color": colors[(i + 2) % len(colors)],
                        "size": sizes[(i + 1) % len(sizes)],
                        "material": mats[(i + 1) % len(mats)],
                        "price": price_base + 80,
                        "stock": i % 3,
                    },
                ],
            }
        )
    return specs


def _upsert_product_catalog(db: Session, specs: list[dict]) -> None:
    for p in specs:
        existing = db.scalar(select(Product).where(Product.product_code == p["code"]))
        if existing:
            continue

        product = Product(
            product_code=p["code"],
            name=p["name"],
            brand=p["brand"],
            category=p["category"],
            description=p["description"],
            cover_image_url=p["image"],
        )
        db.add(product)
        db.flush()

        db.add(
            ProductImage(
                product_id=product.id,
                image_url=p["image"],
                image_type="cover",
                position=0,
            )
        )

        for v in p["variants"]:
            db.add(
                ProductVariant(
                    product_id=product.id,
                    variant_code=v["code"],
                    color=v["color"],
                    size_label=v["size"],
                    material=v["material"],
                    price=v["price"],
                    stock=v["stock"],
                )
            )


def seed_data(db: Session) -> None:
    target_feed_slots = 360

    def ensure_feed_slots() -> None:
        product_ids = db.scalars(select(Product.id).order_by(Product.id.asc())).all()
        if not product_ids:
            return

        current_count = db.scalar(select(func.count(FeedSlot.id))) or 0
        if current_count >= target_feed_slots:
            return

        max_position = db.scalar(select(func.max(FeedSlot.position))) or 0
        needed = target_feed_slots - current_count
        for i in range(needed):
            product_id = product_ids[(current_count + i) % len(product_ids)]
            db.add(
                FeedSlot(
                    slot_type="product",
                    ref_id=product_id,
                    position=max_position + i + 1,
                )
            )

    has_user = db.scalar(select(User.id).limit(1))
    if has_user:
        _upsert_product_catalog(db, _catalog_specs())
        ensure_feed_slots()
        db.commit()
        return

    user = User(display_name="Demo User", email="demo@example.com")
    db.add(user)
    db.flush()

    _upsert_product_catalog(db, _catalog_specs())

    wishlist = Wishlist(user_id=user.id, title="My Wishlist")
    viewlist = Viewlist(user_id=user.id, title="My Viewlist")
    db.add_all([wishlist, viewlist])
    db.flush()

    collection = Collection(
        owner_id=user.id,
        title="Small Nordic Bedroom",
        description="A compact and warm bedroom setup.",
        cover_image_url="https://images.unsplash.com/photo-1505693416388-ac5ce068fe85",
    )
    db.add(collection)
    db.flush()

    first_product_id = db.scalar(select(Product.id).order_by(Product.id.asc()).limit(1))
    if first_product_id:
        db.add(CollectionItem(collection_id=collection.id, product_id=first_product_id, position=1))

    ensure_feed_slots()
    db.commit()
