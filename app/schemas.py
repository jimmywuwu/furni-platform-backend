from pydantic import BaseModel


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
    image_type: str | None = None
    position: int

    model_config = {"from_attributes": True}


class ProductDetailOut(BaseModel):
    id: int
    product_code: str
    name: str
    brand: str | None = None
    category: str | None = None
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


class AddCollectionItemIn(BaseModel):
    product_id: int
    variant_id: int | None = None
    position: int | None = None
    note: str | None = None
