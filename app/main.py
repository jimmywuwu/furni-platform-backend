from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from .database import Base, engine, get_db
from .models import (
    Collection,
    CollectionItem,
    FeedSlot,
    Product,
    ProductVariant,
    User,
    Viewlist,
    ViewlistItem,
    Wishlist,
    WishlistItem,
)
from .schemas import (
    AddCollectionItemIn,
    AddViewlistItemIn,
    AddWishlistItemIn,
    CreateCollectionIn,
    FeedItemOut,
    FeedOut,
    ProductDetailOut,
    VariantOut,
    ImageOut,
)
from .seed import seed_data


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with Session(engine) as db:
        seed_data(db)
    yield


app = FastAPI(title="Furniture Platform API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets", StaticFiles(directory="assets"), name="assets")
app.mount("/static", StaticFiles(directory="static"), name="static")


def _get_or_create_wishlist(db: Session, user_id: int) -> Wishlist:
    wishlist = db.scalar(select(Wishlist).where(Wishlist.user_id == user_id).limit(1))
    if not wishlist:
        wishlist = Wishlist(user_id=user_id, title="My Wishlist")
        db.add(wishlist)
        db.flush()
    return wishlist


def _get_or_create_viewlist(db: Session, user_id: int) -> Viewlist:
    viewlist = db.scalar(select(Viewlist).where(Viewlist.user_id == user_id).limit(1))
    if not viewlist:
        viewlist = Viewlist(user_id=user_id, title="My Viewlist")
        db.add(viewlist)
        db.flush()
    return viewlist


@app.get("/")
def index():
    return FileResponse("index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/v1/feed", response_model=FeedOut)
def get_feed(
    cursor: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    total_slots = db.scalar(select(func.count(FeedSlot.id))) or 0
    if total_slots == 0:
        return FeedOut(items=[], next_cursor=None)

    cursor_norm = cursor % total_slots
    slots = db.scalars(
        select(FeedSlot)
        .order_by(FeedSlot.position.asc())
        .offset(cursor_norm)
        .limit(limit)
    ).all()

    if len(slots) < limit:
        extra = db.scalars(
            select(FeedSlot)
            .order_by(FeedSlot.position.asc())
            .offset(0)
            .limit(limit - len(slots))
        ).all()
        slots.extend(extra)

    items: list[FeedItemOut] = []
    for slot in slots:
        if slot.slot_type != "product":
            continue

        product = db.scalar(select(Product).where(Product.id == slot.ref_id))
        if not product:
            continue

        min_price = db.scalar(
            select(func.min(ProductVariant.price)).where(ProductVariant.product_id == product.id)
        )

        items.append(
            FeedItemOut(
                type="product",
                id=product.id,
                name=product.name,
                image=product.cover_image_url,
                price=float(min_price) if min_price is not None else None,
            )
        )

    next_cursor = (cursor_norm + len(slots)) % total_slots

    return FeedOut(items=items, next_cursor=next_cursor)


@app.get("/api/v1/products/{product_id}", response_model=ProductDetailOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.scalar(
        select(Product)
        .where(Product.id == product_id)
        .options(joinedload(Product.variants), joinedload(Product.images))
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    variants = [VariantOut.model_validate(v) for v in product.variants]
    images = [ImageOut.model_validate(i) for i in product.images]

    return ProductDetailOut(
        id=product.id,
        product_code=product.product_code,
        name=product.name,
        brand=product.brand,
        category=product.category,
        description=product.description,
        cover_image_url=product.cover_image_url,
        variants=variants,
        images=images,
    )


@app.get("/api/v1/products/{product_id}/drawer", response_model=ProductDetailOut)
def get_product_drawer(product_id: int, db: Session = Depends(get_db)):
    return get_product(product_id=product_id, db=db)


@app.post("/api/v1/wishlist/items")
def add_wishlist_item(payload: AddWishlistItemIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.id == payload.user_id))
    product = db.scalar(select(Product).where(Product.id == payload.product_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    wishlist = _get_or_create_wishlist(db, payload.user_id)

    duplicate = db.scalar(
        select(WishlistItem).where(
            WishlistItem.wishlist_id == wishlist.id,
            WishlistItem.product_id == payload.product_id,
        )
    )
    if duplicate:
        return {"ok": True, "item_id": duplicate.id, "duplicated": True}

    item = WishlistItem(wishlist_id=wishlist.id, product_id=payload.product_id)
    db.add(item)
    db.commit()
    db.refresh(item)

    return {"ok": True, "item_id": item.id}


@app.post("/api/v1/viewlist/items")
def add_viewlist_item(payload: AddViewlistItemIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.id == payload.user_id))
    variant = db.scalar(select(ProductVariant).where(ProductVariant.id == payload.variant_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")

    viewlist = _get_or_create_viewlist(db, payload.user_id)

    item = ViewlistItem(
        viewlist_id=viewlist.id,
        variant_id=payload.variant_id,
        quantity=max(payload.quantity, 1),
        note=payload.note,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    return {"ok": True, "item_id": item.id}


@app.post("/api/v1/collections")
def create_collection(payload: CreateCollectionIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.id == payload.owner_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    collection = Collection(
        owner_id=payload.owner_id,
        title=payload.title,
        description=payload.description,
        cover_image_url=payload.cover_image_url,
    )
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return {"ok": True, "id": collection.id}


@app.get("/api/v1/collections")
def list_collections(db: Session = Depends(get_db)):
    rows = db.scalars(select(Collection).order_by(Collection.id.desc())).all()
    return {
        "items": [
            {
                "id": c.id,
                "owner_id": c.owner_id,
                "title": c.title,
                "description": c.description,
                "cover_image_url": c.cover_image_url,
            }
            for c in rows
        ]
    }


@app.post("/api/v1/collections/{collection_id}/items")
def add_collection_item(
    collection_id: int,
    payload: AddCollectionItemIn,
    db: Session = Depends(get_db),
):
    collection = db.scalar(select(Collection).where(Collection.id == collection_id))
    product = db.scalar(select(Product).where(Product.id == payload.product_id))
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if payload.variant_id is not None:
        variant = db.scalar(select(ProductVariant).where(ProductVariant.id == payload.variant_id))
        if not variant:
            raise HTTPException(status_code=404, detail="Variant not found")

    item = CollectionItem(
        collection_id=collection_id,
        product_id=payload.product_id,
        variant_id=payload.variant_id,
        position=payload.position,
        note=payload.note,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"ok": True, "item_id": item.id}


@app.get("/api/v1/collections/{collection_id}/items")
def list_collection_items(collection_id: int, db: Session = Depends(get_db)):
    collection = db.scalar(select(Collection).where(Collection.id == collection_id))
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    items = db.scalars(
        select(CollectionItem).where(CollectionItem.collection_id == collection_id)
    ).all()
    return {
        "collection": {
            "id": collection.id,
            "title": collection.title,
            "description": collection.description,
        },
        "items": [
            {
                "id": i.id,
                "product_id": i.product_id,
                "variant_id": i.variant_id,
                "position": i.position,
                "note": i.note,
            }
            for i in items
        ],
    }


@app.delete("/api/v1/collections/{collection_id}/items/{item_id}")
def delete_collection_item(collection_id: int, item_id: int, db: Session = Depends(get_db)):
    item = db.scalar(
        select(CollectionItem).where(
            CollectionItem.id == item_id,
            CollectionItem.collection_id == collection_id,
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(item)
    db.commit()
    return {"ok": True}


@app.get("/api/v1/users/{user_id}/wishlist")
def get_user_wishlist(user_id: int, db: Session = Depends(get_db)):
    wishlist = _get_or_create_wishlist(db, user_id)
    items = db.scalars(select(WishlistItem).where(WishlistItem.wishlist_id == wishlist.id)).all()

    result = []
    for item in items:
        product = db.scalar(select(Product).where(Product.id == item.product_id))
        if product:
            result.append(
                {
                    "id": item.id,
                    "product_id": product.id,
                    "name": product.name,
                    "image": product.cover_image_url,
                }
            )

    return {"wishlist_id": wishlist.id, "items": result}


@app.get("/api/v1/wishlists/default")
def get_default_wishlist(user_id: int, db: Session = Depends(get_db)):
    return get_user_wishlist(user_id=user_id, db=db)


@app.post("/api/v1/wishlists/default/items")
def add_default_wishlist_item(payload: AddWishlistItemIn, db: Session = Depends(get_db)):
    return add_wishlist_item(payload=payload, db=db)


@app.delete("/api/v1/wishlists/default/items/{item_id}")
def delete_default_wishlist_item(item_id: int, user_id: int, db: Session = Depends(get_db)):
    wishlist = _get_or_create_wishlist(db, user_id)
    item = db.scalar(
        select(WishlistItem).where(
            WishlistItem.id == item_id,
            WishlistItem.wishlist_id == wishlist.id,
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(item)
    db.commit()
    return {"ok": True}


@app.get("/api/v1/users/{user_id}/viewlist")
def get_user_viewlist(user_id: int, db: Session = Depends(get_db)):
    viewlist = _get_or_create_viewlist(db, user_id)
    items = db.scalars(select(ViewlistItem).where(ViewlistItem.viewlist_id == viewlist.id)).all()

    result = []
    for item in items:
        variant = db.scalar(select(ProductVariant).where(ProductVariant.id == item.variant_id))
        if not variant:
            continue
        product = db.scalar(select(Product).where(Product.id == variant.product_id))
        result.append(
            {
                "id": item.id,
                "variant_id": variant.id,
                "product_id": variant.product_id,
                "product_name": product.name if product else None,
                "quantity": item.quantity,
                "note": item.note,
                "price": float(variant.price),
            }
        )

    return {"viewlist_id": viewlist.id, "items": result}


@app.get("/api/v1/viewlists/default")
def get_default_viewlist(user_id: int, db: Session = Depends(get_db)):
    return get_user_viewlist(user_id=user_id, db=db)


@app.post("/api/v1/viewlists/default/items")
def add_default_viewlist_item(payload: AddViewlistItemIn, db: Session = Depends(get_db)):
    return add_viewlist_item(payload=payload, db=db)


@app.delete("/api/v1/viewlists/default/items/{item_id}")
def delete_default_viewlist_item(item_id: int, user_id: int, db: Session = Depends(get_db)):
    viewlist = _get_or_create_viewlist(db, user_id)
    item = db.scalar(
        select(ViewlistItem).where(
            ViewlistItem.id == item_id,
            ViewlistItem.viewlist_id == viewlist.id,
        )
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(item)
    db.commit()
    return {"ok": True}


@app.post("/api/v1/auth/line/callback")
def line_callback(payload: dict):
    return {
        "ok": True,
        "message": "LINE callback stub",
        "received": payload,
    }
