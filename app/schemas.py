from pydantic import BaseModel

from .enums import ImageType


class VariantOut(BaseModel):
    id: int
    variant_code: str
    color: str | None = None
    size_label: str | None = None
    material: str | None = None
    price: float
    stock: int

    model_config = {"from_attributes": True}


class ImageOut(BaseModel):
    id: int
    image_url: str
    image_type: ImageType | None = None
    position: int

    model_config = {"from_attributes": True}

class ProductDetailOut(BaseModel):
    id: int
    product_code: str
    name: str
    brand: str | None = None
    category: str | None = None
    category_slug: str | None = None
    description: str | None = None
    cover_image_url: str | None = None
    variants: list[VariantOut]
    images: list[ImageOut]


class FeedItemOut(BaseModel):
    type: str
    id: int
    name: str
    image: str | None = None
    price: float | None = None


class FeedOut(BaseModel):
    items: list[FeedItemOut]
    next_cursor: int | None = None


class AddWishlistItemIn(BaseModel):
    user_id: int
    product_id: int


class AddViewlistItemIn(BaseModel):
    user_id: int
    variant_id: int
    quantity: int = 1
    note: str | None = None


class CreateCollectionIn(BaseModel):
    owner_id: int
    title: str
    description: str | None = None
    cover_image_url: str | None = None
    store_id: int | None = None
    visibility: str = "private"
    is_store_scene: bool = False


class UpdateCollectionIn(BaseModel):
    title: str | None = None
    description: str | None = None
    cover_image_url: str | None = None
    store_id: int | None = None
    visibility: str | None = None
    is_store_scene: bool | None = None


class AddCollectionItemIn(BaseModel):
    product_id: int
    variant_id: int | None = None
    position: int | None = None
    note: str | None = None


class AddCollectionImageIn(BaseModel):
    image_url: str
    caption: str | None = None


class AddCollectionCommentIn(BaseModel):
    user_id: int
    content: str


class CategoryOut(BaseModel):
    id: int
    slug: str
    name_zh: str
    name_en: str | None = None
    parent_id: int | None = None
    level: int
    sort_order: int
    is_active: bool

    model_config = {"from_attributes": True}


class LoginIn(BaseModel):
    display_name: str
    email: str | None = None


class AuthOut(BaseModel):
    token: str
    user_id: int
    display_name: str
    email: str | None = None
