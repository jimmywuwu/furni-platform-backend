from contextlib import asynccontextmanager
import base64
import json
import os
import secrets
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from .database import Base, engine, get_db
from .env import get_env
from .models import (
    AuthSession,
    Category,
    Collection,
    CollectionComment,
    CollectionImage,
    CollectionItem,
    FeedSlot,
    HighlightProduct,
    OAuthIdentity,
    Product,
    ProductVariant,
    Store,
    StoreMembership,
    User,
    Viewlist,
    ViewlistItem,
    Wishlist,
    WishlistItem,
)
from .schemas import (
    AddCollectionCommentIn,
    AddCollectionImageIn,
    AddCollectionItemIn,
    AddViewlistItemIn,
    AddWishlistItemIn,
    AuthOut,
    CategoryOut,
    CreateCollectionIn,
    FeedItemOut,
    FeedOut,
    ImageOut,
    LoginIn,
    ProductDetailOut,
    UpdateCollectionIn,
    VariantOut,
)
from .migrations import run_schema_migrations
from .paths import ASSETS_DIR, STATIC_DIR, ensure_runtime_dirs
from .seed import seed_data

ensure_runtime_dirs()

@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with Session(engine) as db:
        run_schema_migrations(db)
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
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


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


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    value = authorization.strip()
    if not value.lower().startswith("bearer "):
        return None
    return value[7:].strip()


def _session_to_auth_out(db: Session, session: AuthSession) -> AuthOut:
    user = db.scalar(select(User).where(User.id == session.user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return AuthOut(
        token=session.token,
        user_id=user.id,
        display_name=user.display_name,
        email=user.email,
    )


def _create_auth_session(db: Session, user: User, provider: str) -> AuthOut:
    token = secrets.token_urlsafe(32)
    session = AuthSession(user_id=user.id, token=token, provider=provider)
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_to_auth_out(db, session)


def _oauth_post_form(url: str, data: dict) -> dict:
    payload = urlencode(data).encode("utf-8")
    req = UrlRequest(
        url,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        detail = body or str(exc)
        raise HTTPException(status_code=400, detail=detail) from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail="OAuth provider unavailable") from exc


def _oauth_get_json(url: str, headers: dict | None = None) -> dict:
    req = UrlRequest(url, headers=headers or {}, method="GET")
    try:
        with urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        detail = body or str(exc)
        raise HTTPException(status_code=400, detail=detail) from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail="OAuth provider unavailable") from exc


def _get_or_create_user(db: Session, display_name: str, email: str | None) -> User:
    user = db.scalar(
        select(User).where(
            User.display_name == display_name,
            User.email == email,
        )
    )
    if not user:
        user = User(display_name=display_name, email=email)
        db.add(user)
        db.flush()
        _get_or_create_wishlist(db, user.id)
        _get_or_create_viewlist(db, user.id)
    return user


def _decode_jwt_payload(token: str | None) -> dict:
    if not token:
        return {}
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload + padding)
        return json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return {}


def _get_or_create_oauth_user(
    db: Session,
    provider: str,
    provider_user_id: str,
    display_name: str,
    email: str | None,
) -> User:
    identity = db.scalar(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == provider,
            OAuthIdentity.provider_user_id == provider_user_id,
        )
    )
    if identity:
        user = db.scalar(select(User).where(User.id == identity.user_id))
        if not user:
            raise HTTPException(status_code=404, detail="Linked user not found")
        updated = False
        if display_name and user.display_name != display_name:
            user.display_name = display_name
            updated = True
        if email and user.email != email:
            user.email = email
            identity.email = email
            updated = True
        if updated:
            db.commit()
            db.refresh(user)
        return user

    user = None
    if email:
        user = db.scalar(select(User).where(User.email == email))
    if not user:
        if email:
            user = _get_or_create_user(db, display_name=display_name, email=email)
        else:
            user = User(display_name=display_name, email=None)
            db.add(user)
            db.flush()
            _get_or_create_wishlist(db, user.id)
            _get_or_create_viewlist(db, user.id)

    identity = OAuthIdentity(
        user_id=user.id,
        provider=provider,
        provider_user_id=provider_user_id,
        email=email,
    )
    db.add(identity)
    db.commit()
    db.refresh(user)
    return user


def _normalize_visibility(value: str | None) -> str:
    v = (value or "private").strip().lower()
    if v not in {"private", "public"}:
        return "private"
    return v


def _serialize_collection(db: Session, collection: Collection) -> dict:
    store_name = None
    if collection.store_id:
        store = db.scalar(select(Store).where(Store.id == collection.store_id))
        store_name = store.name if store else None
    return {
        "id": collection.id,
        "owner_id": collection.owner_id,
        "store_id": collection.store_id,
        "store_name": store_name,
        "title": collection.title,
        "description": collection.description,
        "cover_image_url": collection.cover_image_url,
        "visibility": collection.visibility,
        "is_store_scene": bool(collection.is_store_scene) or (collection.store_id is not None),
    }


def _line_redirect_uri(request: Request) -> str:
    env = get_env("LINE_REDIRECT_URI")
    return env or str(request.url_for("line_callback_oauth"))


def _google_redirect_uri(request: Request) -> str:
    env = get_env("GOOGLE_REDIRECT_URI")
    return env or str(request.url_for("google_callback_oauth"))


def _oauth_success_redirect(provider: str, token: str) -> RedirectResponse:
    return RedirectResponse(url=f"/#token={token}&provider={provider}")


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
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    total_slots = db.scalar(select(func.count(FeedSlot.id))) or 0
    if total_slots == 0:
        return FeedOut(items=[], next_cursor=None)

    cursor_norm = cursor % total_slots
    ordered_slots = db.scalars(select(FeedSlot).order_by(FeedSlot.position.asc())).all()
    if not ordered_slots:
        return FeedOut(items=[], next_cursor=None)

    if category:
        slots: list[FeedSlot] = []
        scanned = 0
        idx = cursor_norm
        while scanned < total_slots and len(slots) < limit:
            slot = ordered_slots[idx]
            scanned += 1
            idx = (idx + 1) % total_slots
            if slot.slot_type != "product":
                continue
            product = db.scalar(select(Product).where(Product.id == slot.ref_id))
            if not product:
                continue
            category_slug = (
                product.primary_category.slug
                if product.primary_category is not None
                else (product.category or "")
            )
            if category_slug == category:
                slots.append(slot)
        next_cursor = (cursor_norm + scanned) % total_slots
    else:
        slots = []
        idx = cursor_norm
        for _ in range(min(limit, total_slots)):
            slots.append(ordered_slots[idx])
            idx = (idx + 1) % total_slots
        next_cursor = (cursor_norm + len(slots)) % total_slots

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

    return FeedOut(items=items, next_cursor=next_cursor)


@app.get("/api/v1/categories", response_model=list[CategoryOut])
def get_categories(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Category).where(Category.is_active == True).order_by(Category.level.asc(), Category.sort_order.asc(), Category.id.asc())
    ).all()
    return [CategoryOut.model_validate(c) for c in rows]


@app.get("/api/v1/products/{product_id}", response_model=ProductDetailOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.scalar(
        select(Product)
        .where(Product.id == product_id)
        .options(joinedload(Product.variants), joinedload(Product.images), joinedload(Product.primary_category))
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
        category_slug=product.primary_category.slug if product.primary_category else None,
        description=product.description,
        cover_image_url=product.cover_image_url,
        variants=variants,
        images=images,
    )


@app.get("/api/v1/products/{product_id}/drawer", response_model=ProductDetailOut)
def get_product_drawer(product_id: int, db: Session = Depends(get_db)):
    return get_product(product_id=product_id, db=db)


@app.get("/api/v1/products/highlights/latest")
def get_latest_products(
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    slots = db.scalars(
        select(HighlightProduct)
        .where(HighlightProduct.section == "latest")
        .order_by(HighlightProduct.position.asc(), HighlightProduct.id.asc())
        .limit(limit)
    ).all()
    if slots:
        items: list[FeedItemOut] = []
        for slot in slots:
            product = db.scalar(select(Product).where(Product.id == slot.product_id))
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
        return {"items": items}

    rows = db.scalars(
        select(Product)
        .order_by(Product.created_at.desc(), Product.id.desc())
        .limit(limit)
    ).all()
    items: list[FeedItemOut] = []
    for product in rows:
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
    return {"items": items}


@app.get("/api/v1/products/highlights/discount")
def get_discount_products(
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    slots = db.scalars(
        select(HighlightProduct)
        .where(HighlightProduct.section == "discount")
        .order_by(HighlightProduct.position.asc(), HighlightProduct.id.asc())
        .limit(limit)
    ).all()
    if slots:
        items: list[FeedItemOut] = []
        for slot in slots:
            product = db.scalar(select(Product).where(Product.id == slot.product_id))
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
        return {"items": items}

    price_subq = (
        select(
            ProductVariant.product_id.label("product_id"),
            func.min(ProductVariant.price).label("min_price"),
        )
        .group_by(ProductVariant.product_id)
        .subquery()
    )
    rows = db.execute(
        select(Product, price_subq.c.min_price)
        .join(price_subq, price_subq.c.product_id == Product.id)
        .order_by(price_subq.c.min_price.asc(), Product.created_at.desc(), Product.id.desc())
        .limit(limit)
    ).all()
    items: list[FeedItemOut] = []
    for product, min_price in rows:
        items.append(
            FeedItemOut(
                type="product",
                id=product.id,
                name=product.name,
                image=product.cover_image_url,
                price=float(min_price) if min_price is not None else None,
            )
        )
    return {"items": items}


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


@app.delete("/api/v1/viewlist/items/{item_id}")
def delete_viewlist_item(item_id: int, user_id: int, db: Session = Depends(get_db)):
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


@app.post("/api/v1/collections")
def create_collection(payload: CreateCollectionIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.id == payload.owner_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    store_id = payload.store_id
    if store_id is not None:
        store = db.scalar(select(Store).where(Store.id == store_id, Store.is_active == True))
        if not store:
            raise HTTPException(status_code=404, detail="Store not found")
        membership = db.scalar(
            select(StoreMembership).where(
                StoreMembership.user_id == payload.owner_id,
                StoreMembership.store_id == store_id,
            )
        )
        if not membership and store.owner_user_id != payload.owner_id:
            raise HTTPException(status_code=403, detail="No permission for this store")

    collection = Collection(
        owner_id=payload.owner_id,
        title=payload.title,
        description=payload.description,
        cover_image_url=payload.cover_image_url,
        store_id=store_id,
        visibility=_normalize_visibility(payload.visibility),
        is_store_scene=bool(payload.is_store_scene) or (store_id is not None),
    )
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return {"ok": True, "id": collection.id}


@app.get("/api/v1/collections")
def list_collections(owner_id: int | None = None, db: Session = Depends(get_db)):
    stmt = select(Collection).order_by(Collection.id.desc())
    if owner_id is not None:
        stmt = stmt.where(Collection.owner_id == owner_id)
    rows = db.scalars(stmt).all()
    return {"items": [_serialize_collection(db, c) for c in rows]}


@app.patch("/api/v1/collections/{collection_id}")
def update_collection(collection_id: int, payload: UpdateCollectionIn, db: Session = Depends(get_db)):
    collection = db.scalar(select(Collection).where(Collection.id == collection_id))
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if payload.title is not None:
        collection.title = payload.title
    if payload.description is not None:
        collection.description = payload.description
    if payload.cover_image_url is not None:
        collection.cover_image_url = payload.cover_image_url
    if payload.store_id is not None:
        store = db.scalar(select(Store).where(Store.id == payload.store_id, Store.is_active == True))
        if not store:
            raise HTTPException(status_code=404, detail="Store not found")
        membership = db.scalar(
            select(StoreMembership).where(
                StoreMembership.user_id == collection.owner_id,
                StoreMembership.store_id == payload.store_id,
            )
        )
        if not membership and store.owner_user_id != collection.owner_id:
            raise HTTPException(status_code=403, detail="No permission for this store")
        collection.store_id = payload.store_id
    if payload.visibility is not None:
        collection.visibility = _normalize_visibility(payload.visibility)
    if payload.is_store_scene is not None:
        collection.is_store_scene = bool(payload.is_store_scene)
    if collection.store_id is not None:
        collection.is_store_scene = True

    db.commit()
    db.refresh(collection)
    return {"ok": True}


@app.delete("/api/v1/collections/{collection_id}")
def delete_collection(collection_id: int, user_id: int, db: Session = Depends(get_db)):
    collection = db.scalar(select(Collection).where(Collection.id == collection_id))
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if collection.owner_id != user_id:
        raise HTTPException(status_code=403, detail="No permission to delete this collection")

    db.query(CollectionItem).filter(CollectionItem.collection_id == collection_id).delete()
    db.query(CollectionImage).filter(CollectionImage.collection_id == collection_id).delete()
    db.query(CollectionComment).filter(CollectionComment.collection_id == collection_id).delete()
    db.delete(collection)
    db.commit()
    return {"ok": True}


@app.get("/api/v1/collections/public/search")
def search_public_collections(
    q: str = Query(default="", min_length=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    keyword = q.strip().lower()
    stmt = select(Collection).where(Collection.visibility == "public")
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where(
            or_(
                func.lower(Collection.title).like(like),
                func.lower(func.coalesce(Collection.description, "")).like(like),
            )
        )
    rows = db.scalars(stmt.order_by(Collection.id.desc()).limit(limit)).all()
    return {"items": [_serialize_collection(db, c) for c in rows]}


@app.get("/api/v1/collections/store/latest")
def get_latest_store_collections(
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Collection)
        .where(
            Collection.visibility == "public",
            or_(Collection.store_id.is_not(None), Collection.is_store_scene == True),
        )
        .order_by(Collection.id.desc())
        .limit(limit)
    ).all()
    return {"items": [_serialize_collection(db, c) for c in rows]}


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
            "owner_id": collection.owner_id,
            "store_id": collection.store_id,
            "title": collection.title,
            "description": collection.description,
            "visibility": collection.visibility,
            "is_store_scene": bool(collection.is_store_scene) or (collection.store_id is not None),
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


@app.get("/api/v1/collections/{collection_id}/images")
def list_collection_images(collection_id: int, db: Session = Depends(get_db)):
    collection = db.scalar(select(Collection).where(Collection.id == collection_id))
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    rows = db.scalars(
        select(CollectionImage).where(CollectionImage.collection_id == collection_id).order_by(CollectionImage.id.desc())
    ).all()
    return {
        "items": [
            {
                "id": r.id,
                "image_url": r.image_url,
                "caption": r.caption,
            }
            for r in rows
        ]
    }


@app.post("/api/v1/collections/{collection_id}/images")
def add_collection_image(
    collection_id: int,
    payload: AddCollectionImageIn,
    db: Session = Depends(get_db),
):
    collection = db.scalar(select(Collection).where(Collection.id == collection_id))
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    row = CollectionImage(
        collection_id=collection_id,
        image_url=payload.image_url,
        caption=payload.caption,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "id": row.id}


@app.delete("/api/v1/collections/{collection_id}/images/{image_id}")
def delete_collection_image(collection_id: int, image_id: int, db: Session = Depends(get_db)):
    row = db.scalar(
        select(CollectionImage).where(
            CollectionImage.id == image_id,
            CollectionImage.collection_id == collection_id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Image not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@app.get("/api/v1/collections/{collection_id}/comments")
def list_collection_comments(collection_id: int, db: Session = Depends(get_db)):
    collection = db.scalar(select(Collection).where(Collection.id == collection_id))
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    rows = db.scalars(
        select(CollectionComment).where(CollectionComment.collection_id == collection_id).order_by(CollectionComment.id.desc())
    ).all()
    result = []
    for row in rows:
        user = db.scalar(select(User).where(User.id == row.user_id))
        result.append(
            {
                "id": row.id,
                "user_id": row.user_id,
                "user_name": user.display_name if user else f"User {row.user_id}",
                "content": row.content,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return {"items": result}


@app.post("/api/v1/collections/{collection_id}/comments")
def add_collection_comment(
    collection_id: int,
    payload: AddCollectionCommentIn,
    db: Session = Depends(get_db),
):
    collection = db.scalar(select(Collection).where(Collection.id == collection_id))
    user = db.scalar(select(User).where(User.id == payload.user_id))
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content is empty")

    row = CollectionComment(
        collection_id=collection_id,
        user_id=payload.user_id,
        content=content,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "id": row.id}


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


@app.delete("/api/v1/wishlist/items/{item_id}")
def delete_wishlist_item(item_id: int, user_id: int, db: Session = Depends(get_db)):
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


@app.get("/api/v1/users/{user_id}/collections")
def get_user_collections(user_id: int, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Collection).where(Collection.owner_id == user_id).order_by(Collection.id.desc())
    ).all()
    return {"items": [_serialize_collection(db, c) for c in rows]}


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


@app.get("/api/v1/auth/line/start")
def line_start(request: Request):
    client_id = get_env("LINE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=500, detail="LINE_CLIENT_ID not configured")

    redirect_uri = _line_redirect_uri(request)
    state = secrets.token_urlsafe(24)
    query = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": "profile openid email",
            "state": state,
        }
    )

    resp = RedirectResponse(f"https://access.line.me/oauth2/v2.1/authorize?{query}")
    resp.set_cookie("oauth_state_line", state, max_age=600, httponly=True, samesite="lax")
    return resp


@app.get("/api/v1/auth/google/start")
def google_start(request: Request):
    client_id = get_env("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured")

    redirect_uri = _google_redirect_uri(request)
    state = secrets.token_urlsafe(24)
    query = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": "openid email profile",
            "state": state,
            "access_type": "offline",
            "prompt": "consent",
        }
    )

    resp = RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{query}")
    resp.set_cookie("oauth_state_google", state, max_age=600, httponly=True, samesite="lax")
    return resp


@app.get("/api/v1/auth/line/callback")
def line_callback_oauth(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if error:
        raise HTTPException(status_code=400, detail=f"LINE login failed: {error}")
    expected_state = request.cookies.get("oauth_state_line")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing LINE OAuth callback parameters")
    if not expected_state or expected_state != state:
        raise HTTPException(status_code=400, detail="Invalid state")

    client_id = get_env("LINE_CLIENT_ID")
    client_secret = get_env("LINE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="LINE OAuth secret not configured")

    token_data = _oauth_post_form(
        "https://api.line.me/oauth2/v2.1/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _line_redirect_uri(request),
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="LINE token exchange failed")

    profile = _oauth_get_json(
        "https://api.line.me/v2/profile",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    id_token_payload = _decode_jwt_payload(token_data.get("id_token"))
    provider_user_id = str(profile.get("userId") or id_token_payload.get("sub") or "").strip()
    if not provider_user_id:
        raise HTTPException(status_code=400, detail="LINE user identifier missing")
    display_name = (profile.get("displayName") or id_token_payload.get("name") or "LINE User").strip()
    email = id_token_payload.get("email")
    user = _get_or_create_oauth_user(
        db,
        provider="line",
        provider_user_id=provider_user_id,
        display_name=display_name,
        email=email,
    )
    auth = _create_auth_session(db, user, provider="line")

    resp = _oauth_success_redirect(provider="line", token=auth.token)
    resp.delete_cookie("oauth_state_line")
    return resp


@app.get("/api/v1/auth/google/callback")
def google_callback_oauth(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if error:
        raise HTTPException(status_code=400, detail=f"Google login failed: {error}")
    expected_state = request.cookies.get("oauth_state_google")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing Google OAuth callback parameters")
    if not expected_state or expected_state != state:
        raise HTTPException(status_code=400, detail="Invalid state")

    client_id = get_env("GOOGLE_CLIENT_ID")
    client_secret = get_env("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="GOOGLE OAuth secret not configured")

    token_data = _oauth_post_form(
        "https://oauth2.googleapis.com/token",
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _google_redirect_uri(request),
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Google token exchange failed")

    profile = _oauth_get_json(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    provider_user_id = str(profile.get("sub") or "").strip()
    if not provider_user_id:
        raise HTTPException(status_code=400, detail="Google user identifier missing")
    display_name = (profile.get("name") or profile.get("email") or "Google User").strip()
    email = profile.get("email")
    user = _get_or_create_oauth_user(
        db,
        provider="google",
        provider_user_id=provider_user_id,
        display_name=display_name,
        email=email,
    )
    auth = _create_auth_session(db, user, provider="google")

    resp = _oauth_success_redirect(provider="google", token=auth.token)
    resp.delete_cookie("oauth_state_google")
    return resp


@app.post("/api/v1/auth/login", response_model=AuthOut)
def auth_login(payload: LoginIn, db: Session = Depends(get_db)):
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name is required")

    user = _get_or_create_user(db, display_name=display_name, email=payload.email)
    return _create_auth_session(db, user, provider="local")


@app.get("/api/v1/auth/me", response_model=AuthOut)
def auth_me(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    session = db.scalar(select(AuthSession).where(AuthSession.token == token))
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    return _session_to_auth_out(db, session)


@app.post("/api/v1/auth/logout")
def auth_logout(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    token = _extract_bearer_token(authorization)
    if not token:
        return {"ok": True}

    session = db.scalar(select(AuthSession).where(AuthSession.token == token))
    if session:
        db.delete(session)
        db.commit()
    return {"ok": True}


@app.post("/api/v1/auth/line/callback", response_model=AuthOut)
def line_callback(payload: dict, db: Session = Depends(get_db)):
    profile_name = (payload.get("display_name") or payload.get("name") or "LINE User").strip()
    email = payload.get("email")
    user = _get_or_create_user(db, display_name=profile_name, email=email)
    return _create_auth_session(db, user, provider="line")
