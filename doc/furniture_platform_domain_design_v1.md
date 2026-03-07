# Furniture Discovery Platform

## Domain Model & System Design (Revised)

Author: Jimmy Version: v1.0

------------------------------------------------------------------------

# 1. Product Philosophy

This platform is designed as a **Furniture Discovery Platform**.

User journey:

Discover → Save → Compose → Visit Store

Typical flow:

Feed → Product → Drawer ├ Add to Wishlist ├ Add to Viewlist └ Add to
Scene

The platform conceptually combines:

Pinterest + IKEA + Zara Home

The key idea is **scene‑based commerce**.

People rarely buy a single item; they buy a **room setup**.

------------------------------------------------------------------------

# 2. Core Domain Entities

Minimal platform domain model:

User\
Product\
Variant (SKU)\
Image\
Collection (Scene)\
CollectionItem\
Wishlist\
Viewlist

------------------------------------------------------------------------

# 3. Domain Responsibilities

## User

Represents platform users.

Responsibilities:

-   create scenes
-   save products
-   build viewing lists

------------------------------------------------------------------------

## Product

Represents the **design concept of a product**.

Example:

Nordic Wooden Bed Frame

Contains:

-   name
-   brand
-   category
-   description
-   style
-   tags

Used in:

-   Feed
-   Search
-   Category
-   Scene

------------------------------------------------------------------------

## Variant (SKU)

Represents the **sellable unit**.

Example:

Nordic Bed Frame - Queen / Walnut - King / Walnut - Queen / Natural Wood

Contains:

-   price
-   color
-   size
-   stock

Commerce happens at the **Variant level**.

------------------------------------------------------------------------

## Image

Furniture relies heavily on imagery.

Types:

-   cover
-   scene
-   detail
-   dimension
-   lifestyle

Each product can have many images.

------------------------------------------------------------------------

## Collection (Scene)

Collection represents a **scene composition**.

Examples:

Small Nordic Bedroom\
Minimal Living Room\
My Bedroom Setup

Used for:

-   curated furniture sets
-   recommendation feeds
-   landing pages

------------------------------------------------------------------------

## CollectionItem

Represents a **product inside a scene**.

Example:

Bedroom Scene

-   Bed
-   Nightstand
-   Lamp
-   Rug

Contains:

-   product reference
-   variant reference (optional)
-   position
-   note

Required because:

Product ↔ Collection is **many‑to‑many**.

------------------------------------------------------------------------

## Wishlist

Represents saved products.

Example:

"My Favorite Furniture"

Used for:

-   bookmarking
-   future purchase consideration

------------------------------------------------------------------------

## Viewlist

Represents **items the user plans to see in store**.

Example:

"Things to check this weekend"

Usually references **variants** because users want a specific
configuration.

------------------------------------------------------------------------

# 4. Entity Relationships

User interactions:

User ├ Wishlist → Product ├ Viewlist → Variant └ Collection →
CollectionItem → Product / Variant

Product structure:

Product ├ Variant └ Image

------------------------------------------------------------------------

# 5. ER Diagram

``` mermaid
erDiagram

USER ||--o{ WISHLIST : owns
USER ||--o{ VIEWLIST : owns
USER ||--o{ COLLECTION : creates

PRODUCT ||--o{ PRODUCT_VARIANT : has
PRODUCT ||--o{ PRODUCT_IMAGE : has

COLLECTION ||--o{ COLLECTION_ITEM : contains
PRODUCT ||--o{ COLLECTION_ITEM : included

WISHLIST ||--o{ WISHLIST_ITEM : contains
PRODUCT ||--o{ WISHLIST_ITEM : saved

VIEWLIST ||--o{ VIEWLIST_ITEM : contains
PRODUCT_VARIANT ||--o{ VIEWLIST_ITEM : selected
```

------------------------------------------------------------------------

# 6. Database Schema

Recommended database: PostgreSQL

------------------------------------------------------------------------

## users

CREATE TABLE users ( id BIGSERIAL PRIMARY KEY, display_name
VARCHAR(100), avatar_url TEXT, email VARCHAR(255), created_at
TIMESTAMPTZ DEFAULT NOW() );

------------------------------------------------------------------------

## products

CREATE TABLE products ( id BIGSERIAL PRIMARY KEY, product_code
VARCHAR(64) UNIQUE, name VARCHAR(255), brand VARCHAR(100), category
VARCHAR(50), description TEXT, cover_image_url TEXT, created_at
TIMESTAMPTZ DEFAULT NOW() );

------------------------------------------------------------------------

## product_variants

CREATE TABLE product_variants ( id BIGSERIAL PRIMARY KEY, product_id
BIGINT REFERENCES products(id), variant_code VARCHAR(64), color
VARCHAR(50), size_label VARCHAR(50), material VARCHAR(100), price
NUMERIC(12,2), created_at TIMESTAMPTZ DEFAULT NOW() );

------------------------------------------------------------------------

## product_images

CREATE TABLE product_images ( id BIGSERIAL PRIMARY KEY, product_id
BIGINT REFERENCES products(id), variant_id BIGINT REFERENCES
product_variants(id), image_url TEXT, image_type VARCHAR(50), position
INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW() );

------------------------------------------------------------------------

## collections

CREATE TABLE collections ( id BIGSERIAL PRIMARY KEY, owner_id BIGINT
REFERENCES users(id), title VARCHAR(255), description TEXT,
cover_image_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW() );

------------------------------------------------------------------------

## collection_items

CREATE TABLE collection_items ( id BIGSERIAL PRIMARY KEY, collection_id
BIGINT REFERENCES collections(id), product_id BIGINT REFERENCES
products(id), variant_id BIGINT REFERENCES product_variants(id),
position INTEGER, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW() );

------------------------------------------------------------------------

## wishlists

CREATE TABLE wishlists ( id BIGSERIAL PRIMARY KEY, user_id BIGINT
REFERENCES users(id), title VARCHAR(255), created_at TIMESTAMPTZ DEFAULT
NOW() );

------------------------------------------------------------------------

## wishlist_items

CREATE TABLE wishlist_items ( id BIGSERIAL PRIMARY KEY, wishlist_id
BIGINT REFERENCES wishlists(id), product_id BIGINT REFERENCES
products(id), created_at TIMESTAMPTZ DEFAULT NOW() );

------------------------------------------------------------------------

## viewlists

CREATE TABLE viewlists ( id BIGSERIAL PRIMARY KEY, user_id BIGINT
REFERENCES users(id), title VARCHAR(255), created_at TIMESTAMPTZ DEFAULT
NOW() );

------------------------------------------------------------------------

## viewlist_items

CREATE TABLE viewlist_items ( id BIGSERIAL PRIMARY KEY, viewlist_id
BIGINT REFERENCES viewlists(id), variant_id BIGINT REFERENCES
product_variants(id), quantity INTEGER DEFAULT 1, note TEXT, created_at
TIMESTAMPTZ DEFAULT NOW() );

------------------------------------------------------------------------

# 7. Feed Strategy (Cold Start)

Feed initially uses **deterministic ordering** controlled by the
merchant.

Feed item types:

-   product
-   collection

------------------------------------------------------------------------

## feed_slots

CREATE TABLE feed_slots ( id BIGSERIAL PRIMARY KEY, slot_type
VARCHAR(50), ref_id BIGINT, position INTEGER );

slot_type:

product collection banner

------------------------------------------------------------------------

# 8. Future Extensions

Future modules may include:

Supplier integration\
Inventory system\
Recommendation engine\
Room builder\
AR furniture preview\
Showroom booking

------------------------------------------------------------------------

End of Document
