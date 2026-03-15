import type {
  AuthRepository,
  CatalogRepository,
  CollectionRepository,
  CreateCollectionCommentInput,
  CreateCollectionImageInput,
  CreateCollectionInput,
  CreateCollectionItemInput,
  CreateViewlistItemInput,
  RepositoryFactory,
  StoreRepository,
  UpdateCollectionInput,
  UserRepository,
  ViewlistRepository,
  WishlistRepository,
} from "../../domain/ports";
import type {
  AuthSession,
  Category,
  Collection,
  CollectionComment,
  CollectionImage,
  CollectionItem,
  FeedItem,
  HighlightSection,
  OAuthIdentity,
  Product,
  ProductImage,
  ProductVariant,
  Store,
  User,
  Viewlist,
  ViewlistItem,
  Wishlist,
  WishlistItem,
} from "../../domain/models";
import { D1Client, lastRowId, toBoolean, toNumber, toText } from "./client";

type FeedRow = {
  slot_type: string;
  product_id: number | null;
  product_name: string | null;
  cover_image_url: string | null;
  category_slug: string | null;
  min_price: number | string | null;
};

function mapUser(row: Record<string, unknown>): User {
  return {
    id: toNumber(row.id) ?? 0,
    displayName: toText(row.display_name) ?? "",
    role: toText(row.role) ?? "customer",
    avatarUrl: toText(row.avatar_url),
    email: toText(row.email),
    createdAt: toText(row.created_at),
  };
}

function mapFeedItem(row: FeedRow): FeedItem {
  return {
    type: "product",
    id: Number(row.product_id ?? 0),
    name: row.product_name ?? "",
    image: row.cover_image_url,
    price: toNumber(row.min_price),
  };
}

export class D1CatalogRepository implements CatalogRepository {
  constructor(private readonly client: D1Client) {}

  async listFeedRows() {
    const rows = await this.client.all<FeedRow>(
      `
        SELECT fs.slot_type,
               p.id AS product_id,
               p.name AS product_name,
               p.cover_image_url,
               COALESCE(cat.slug, p.category) AS category_slug,
               (
                 SELECT MIN(pv.price)
                 FROM product_variants pv
                 WHERE pv.product_id = p.id
               ) AS min_price
        FROM feed_slots fs
        LEFT JOIN products p ON p.id = fs.ref_id
        LEFT JOIN categories cat ON cat.id = p.category_id
        ORDER BY fs.position ASC
      `,
    );
    return rows
      .filter((row) => row.slot_type === "product" && row.product_id !== null && row.product_name !== null)
      .map((row) => ({
        slotType: row.slot_type,
        item: mapFeedItem(row),
        categorySlug: row.category_slug,
      }));
  }

  async listCategories(): Promise<Category[]> {
    const rows = await this.client.all<Record<string, unknown>>(
      `
        SELECT id, slug, name_zh, name_en, parent_id, level, sort_order, is_active
        FROM categories
        WHERE is_active = 1
        ORDER BY level ASC, sort_order ASC, id ASC
      `,
    );
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      slug: toText(row.slug) ?? "",
      nameZh: toText(row.name_zh) ?? "",
      nameEn: toText(row.name_en),
      parentId: toNumber(row.parent_id),
      level: toNumber(row.level) ?? 0,
      sortOrder: toNumber(row.sort_order) ?? 0,
      isActive: toBoolean(row.is_active),
    }));
  }

  async getProductById(productId: number): Promise<Product | null> {
    const product = await this.client.first<Record<string, unknown>>(
      `
        SELECT p.id, p.product_code, p.name, p.brand, p.category,
               cat.slug AS category_slug, p.description, p.cover_image_url
        FROM products p
        LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE p.id = ?
        LIMIT 1
      `,
      productId,
    );
    if (!product) {
      return null;
    }

    const variants = await this.client.all<Record<string, unknown>>(
      `
        SELECT id, product_id, variant_code, color, size_label, material, price, stock
        FROM product_variants
        WHERE product_id = ?
        ORDER BY id ASC
      `,
      productId,
    );

    const images = await this.client.all<Record<string, unknown>>(
      `
        SELECT id, product_id, variant_id, image_url, image_type, position
        FROM product_images
        WHERE product_id = ?
        ORDER BY position ASC, id ASC
      `,
      productId,
    );

    return {
      id: toNumber(product.id) ?? 0,
      productCode: toText(product.product_code) ?? "",
      name: toText(product.name) ?? "",
      brand: toText(product.brand),
      category: toText(product.category),
      categorySlug: toText(product.category_slug),
      description: toText(product.description),
      coverImageUrl: toText(product.cover_image_url),
      variants: variants.map<ProductVariant>((variant) => ({
        id: toNumber(variant.id) ?? 0,
        productId: toNumber(variant.product_id) ?? 0,
        variantCode: toText(variant.variant_code) ?? "",
        color: toText(variant.color),
        sizeLabel: toText(variant.size_label),
        material: toText(variant.material),
        price: toNumber(variant.price) ?? 0,
        stock: toNumber(variant.stock) ?? 0,
      })),
      images: images.map<ProductImage>((image) => ({
        id: toNumber(image.id) ?? 0,
        productId: toNumber(image.product_id) ?? 0,
        variantId: toNumber(image.variant_id),
        imageUrl: toText(image.image_url) ?? "",
        imageType: toText(image.image_type),
        position: toNumber(image.position) ?? 0,
      })),
    };
  }

  async listHighlightProducts(section: HighlightSection, limit: number): Promise<FeedItem[]> {
    const rows = await this.client.all<FeedRow>(
      `
        SELECT hp.section AS slot_type,
               p.id AS product_id,
               p.name AS product_name,
               p.cover_image_url,
               NULL AS category_slug,
               (
                 SELECT MIN(pv.price)
                 FROM product_variants pv
                 WHERE pv.product_id = p.id
               ) AS min_price
        FROM highlight_products hp
        JOIN products p ON p.id = hp.product_id
        WHERE hp.section = ?
        ORDER BY hp.position ASC, hp.id ASC
        LIMIT ?
      `,
      section,
      limit,
    );
    return rows.map(mapFeedItem);
  }

  async listLatestProducts(limit: number): Promise<FeedItem[]> {
    const rows = await this.client.all<FeedRow>(
      `
        SELECT 'product' AS slot_type,
               p.id AS product_id,
               p.name AS product_name,
               p.cover_image_url,
               NULL AS category_slug,
               (
                 SELECT MIN(pv.price)
                 FROM product_variants pv
                 WHERE pv.product_id = p.id
               ) AS min_price
        FROM products p
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?
      `,
      limit,
    );
    return rows.map(mapFeedItem);
  }

  async listDiscountProducts(limit: number): Promise<FeedItem[]> {
    const rows = await this.client.all<FeedRow>(
      `
        SELECT 'product' AS slot_type,
               p.id AS product_id,
               p.name AS product_name,
               p.cover_image_url,
               NULL AS category_slug,
               x.min_price
        FROM products p
        JOIN (
          SELECT product_id, MIN(price) AS min_price
          FROM product_variants
          GROUP BY product_id
        ) x ON x.product_id = p.id
        ORDER BY x.min_price ASC, p.created_at DESC, p.id DESC
        LIMIT ?
      `,
      limit,
    );
    return rows.map(mapFeedItem);
  }

  async productExists(productId: number): Promise<boolean> {
    const row = await this.client.first<{ id: number }>(
      "SELECT id FROM products WHERE id = ? LIMIT 1",
      productId,
    );
    return row !== null;
  }

  async variantExists(variantId: number): Promise<boolean> {
    const row = await this.client.first<{ id: number }>(
      "SELECT id FROM product_variants WHERE id = ? LIMIT 1",
      variantId,
    );
    return row !== null;
  }
}

export class D1UserRepository implements UserRepository {
  constructor(private readonly client: D1Client) {}

  async getById(userId: number): Promise<User | null> {
    const row = await this.client.first<Record<string, unknown>>(
      "SELECT id, display_name, role, avatar_url, email, created_at FROM users WHERE id = ? LIMIT 1",
      userId,
    );
    return row ? mapUser(row) : null;
  }

  async findByDisplayNameAndEmail(displayName: string, email: string | null): Promise<User | null> {
    const row = email === null
      ? await this.client.first<Record<string, unknown>>(
          `
            SELECT id, display_name, role, avatar_url, email, created_at
            FROM users
            WHERE display_name = ? AND email IS NULL
            LIMIT 1
          `,
          displayName,
        )
      : await this.client.first<Record<string, unknown>>(
          `
            SELECT id, display_name, role, avatar_url, email, created_at
            FROM users
            WHERE display_name = ? AND email = ?
            LIMIT 1
          `,
          displayName,
          email,
        );
    return row ? mapUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.client.first<Record<string, unknown>>(
      "SELECT id, display_name, role, avatar_url, email, created_at FROM users WHERE email = ? LIMIT 1",
      email,
    );
    return row ? mapUser(row) : null;
  }

  async create(displayName: string, email: string | null): Promise<User> {
    const result = await this.client.run(
      "INSERT INTO users (display_name, email) VALUES (?, ?)",
      displayName,
      email,
    );
    const user = await this.getById(lastRowId(result));
    if (!user) {
      throw new Error("Failed to create user");
    }
    return user;
  }

  async updateProfile(userId: number, patch: { displayName?: string; email?: string | null }): Promise<void> {
    const current = await this.getById(userId);
    if (!current) {
      return;
    }
    await this.client.run(
      "UPDATE users SET display_name = ?, email = ? WHERE id = ?",
      patch.displayName ?? current.displayName,
      patch.email === undefined ? current.email : patch.email,
      userId,
    );
  }
}

export class D1StoreRepository implements StoreRepository {
  constructor(private readonly client: D1Client) {}

  async getById(storeId: number): Promise<Store | null> {
    const row = await this.client.first<Record<string, unknown>>(
      `
        SELECT id, name, owner_user_id, is_active, created_at
        FROM stores
        WHERE id = ?
        LIMIT 1
      `,
      storeId,
    );
    if (!row) {
      return null;
    }
    return {
      id: toNumber(row.id) ?? 0,
      name: toText(row.name) ?? "",
      ownerUserId: toNumber(row.owner_user_id),
      isActive: toBoolean(row.is_active),
      createdAt: toText(row.created_at),
    };
  }

  async hasMembership(userId: number, storeId: number): Promise<boolean> {
    const row = await this.client.first<{ id: number }>(
      "SELECT id FROM store_memberships WHERE user_id = ? AND store_id = ? LIMIT 1",
      userId,
      storeId,
    );
    return row !== null;
  }
}

export class D1CollectionRepository implements CollectionRepository {
  constructor(private readonly client: D1Client) {}

  private async fetchCollections(sql: string, ...params: D1Value[]): Promise<Collection[]> {
    const rows = await this.client.all<Record<string, unknown>>(sql, ...params);
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      ownerId: toNumber(row.owner_id) ?? 0,
      storeId: toNumber(row.store_id),
      storeName: toText(row.store_name),
      title: toText(row.title) ?? "",
      description: toText(row.description),
      coverImageUrl: toText(row.cover_image_url),
      visibility: toText(row.visibility) ?? "private",
      isStoreScene: toBoolean(row.is_store_scene) || toNumber(row.store_id) !== null,
      createdAt: toText(row.created_at),
    }));
  }

  async create(input: CreateCollectionInput): Promise<number> {
    const result = await this.client.run(
      `
        INSERT INTO collections (
          owner_id, title, description, cover_image_url, store_id, visibility, is_store_scene
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      input.ownerId,
      input.title,
      input.description,
      input.coverImageUrl,
      input.storeId,
      input.visibility,
      input.isStoreScene ? 1 : 0,
    );
    return lastRowId(result);
  }

  async getById(collectionId: number): Promise<Collection | null> {
    const rows = await this.fetchCollections(
      `
        SELECT c.id, c.owner_id, c.store_id, c.title, c.description, c.cover_image_url,
               c.visibility, c.is_store_scene, c.created_at, s.name AS store_name
        FROM collections c
        LEFT JOIN stores s ON s.id = c.store_id
        WHERE c.id = ?
        LIMIT 1
      `,
      collectionId,
    );
    return rows[0] ?? null;
  }

  async list(ownerId?: number): Promise<Collection[]> {
    return ownerId === undefined
      ? this.fetchCollections(
          `
            SELECT c.id, c.owner_id, c.store_id, c.title, c.description, c.cover_image_url,
                   c.visibility, c.is_store_scene, c.created_at, s.name AS store_name
            FROM collections c
            LEFT JOIN stores s ON s.id = c.store_id
            ORDER BY c.id DESC
          `,
        )
      : this.fetchCollections(
          `
            SELECT c.id, c.owner_id, c.store_id, c.title, c.description, c.cover_image_url,
                   c.visibility, c.is_store_scene, c.created_at, s.name AS store_name
            FROM collections c
            LEFT JOIN stores s ON s.id = c.store_id
            WHERE c.owner_id = ?
            ORDER BY c.id DESC
          `,
          ownerId,
        );
  }

  async update(collectionId: number, input: UpdateCollectionInput): Promise<void> {
    await this.client.run(
      `
        UPDATE collections
        SET title = ?, description = ?, cover_image_url = ?, store_id = ?, visibility = ?, is_store_scene = ?
        WHERE id = ?
      `,
      input.title,
      input.description,
      input.coverImageUrl,
      input.storeId,
      input.visibility,
      input.isStoreScene ? 1 : 0,
      collectionId,
    );
  }

  async delete(collectionId: number): Promise<void> {
    await this.client.batch([
      { sql: "DELETE FROM collection_items WHERE collection_id = ?", params: [collectionId] },
      { sql: "DELETE FROM collection_images WHERE collection_id = ?", params: [collectionId] },
      { sql: "DELETE FROM collection_comments WHERE collection_id = ?", params: [collectionId] },
      { sql: "DELETE FROM collections WHERE id = ?", params: [collectionId] },
    ]);
  }

  async searchPublic(keyword: string, limit: number): Promise<Collection[]> {
    return keyword
      ? this.fetchCollections(
          `
            SELECT c.id, c.owner_id, c.store_id, c.title, c.description, c.cover_image_url,
                   c.visibility, c.is_store_scene, c.created_at, s.name AS store_name
            FROM collections c
            LEFT JOIN stores s ON s.id = c.store_id
            WHERE c.visibility = 'public'
              AND (
                lower(c.title) LIKE ?
                OR lower(COALESCE(c.description, '')) LIKE ?
              )
            ORDER BY c.id DESC
            LIMIT ?
          `,
          `%${keyword}%`,
          `%${keyword}%`,
          limit,
        )
      : this.fetchCollections(
          `
            SELECT c.id, c.owner_id, c.store_id, c.title, c.description, c.cover_image_url,
                   c.visibility, c.is_store_scene, c.created_at, s.name AS store_name
            FROM collections c
            LEFT JOIN stores s ON s.id = c.store_id
            WHERE c.visibility = 'public'
            ORDER BY c.id DESC
            LIMIT ?
          `,
          limit,
        );
  }

  async listLatestStoreCollections(limit: number): Promise<Collection[]> {
    return this.fetchCollections(
      `
        SELECT c.id, c.owner_id, c.store_id, c.title, c.description, c.cover_image_url,
               c.visibility, c.is_store_scene, c.created_at, s.name AS store_name
        FROM collections c
        LEFT JOIN stores s ON s.id = c.store_id
        WHERE c.visibility = 'public'
          AND (c.store_id IS NOT NULL OR c.is_store_scene = 1)
        ORDER BY c.id DESC
        LIMIT ?
      `,
      limit,
    );
  }

  async addItem(input: CreateCollectionItemInput): Promise<number> {
    const result = await this.client.run(
      `
        INSERT INTO collection_items (collection_id, product_id, variant_id, position, note)
        VALUES (?, ?, ?, ?, ?)
      `,
      input.collectionId,
      input.productId,
      input.variantId,
      input.position,
      input.note,
    );
    return lastRowId(result);
  }

  async listItems(collectionId: number): Promise<CollectionItem[]> {
    const rows = await this.client.all<Record<string, unknown>>(
      `
        SELECT id, collection_id, product_id, variant_id, position, note, created_at
        FROM collection_items
        WHERE collection_id = ?
      `,
      collectionId,
    );
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      collectionId: toNumber(row.collection_id) ?? 0,
      productId: toNumber(row.product_id) ?? 0,
      variantId: toNumber(row.variant_id),
      position: toNumber(row.position),
      note: toText(row.note),
      createdAt: toText(row.created_at),
    }));
  }

  async deleteItem(collectionId: number, itemId: number): Promise<void> {
    await this.client.run(
      "DELETE FROM collection_items WHERE collection_id = ? AND id = ?",
      collectionId,
      itemId,
    );
  }

  async addImage(input: CreateCollectionImageInput): Promise<number> {
    const result = await this.client.run(
      "INSERT INTO collection_images (collection_id, image_url, caption) VALUES (?, ?, ?)",
      input.collectionId,
      input.imageUrl,
      input.caption,
    );
    return lastRowId(result);
  }

  async listImages(collectionId: number): Promise<CollectionImage[]> {
    const rows = await this.client.all<Record<string, unknown>>(
      `
        SELECT id, collection_id, image_url, caption, created_at
        FROM collection_images
        WHERE collection_id = ?
        ORDER BY id DESC
      `,
      collectionId,
    );
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      collectionId: toNumber(row.collection_id) ?? 0,
      imageUrl: toText(row.image_url) ?? "",
      caption: toText(row.caption),
      createdAt: toText(row.created_at),
    }));
  }

  async deleteImage(collectionId: number, imageId: number): Promise<void> {
    await this.client.run(
      "DELETE FROM collection_images WHERE collection_id = ? AND id = ?",
      collectionId,
      imageId,
    );
  }

  async addComment(input: CreateCollectionCommentInput): Promise<number> {
    const result = await this.client.run(
      "INSERT INTO collection_comments (collection_id, user_id, content) VALUES (?, ?, ?)",
      input.collectionId,
      input.userId,
      input.content,
    );
    return lastRowId(result);
  }

  async listComments(collectionId: number): Promise<CollectionComment[]> {
    const rows = await this.client.all<Record<string, unknown>>(
      `
        SELECT cc.id, cc.collection_id, cc.user_id, cc.content, cc.created_at,
               u.display_name AS user_name
        FROM collection_comments cc
        LEFT JOIN users u ON u.id = cc.user_id
        WHERE cc.collection_id = ?
        ORDER BY cc.id DESC
      `,
      collectionId,
    );
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      collectionId: toNumber(row.collection_id) ?? 0,
      userId: toNumber(row.user_id) ?? 0,
      userName: toText(row.user_name) ?? `User ${toNumber(row.user_id) ?? 0}`,
      content: toText(row.content) ?? "",
      createdAt: toText(row.created_at),
    }));
  }
}

export class D1WishlistRepository implements WishlistRepository {
  constructor(private readonly client: D1Client) {}

  async getOrCreateDefault(userId: number): Promise<Wishlist> {
    const existing = await this.client.first<Record<string, unknown>>(
      `
        SELECT id, user_id, title, created_at
        FROM wishlists
        WHERE user_id = ?
        ORDER BY id ASC
        LIMIT 1
      `,
      userId,
    );
    if (existing) {
      return {
        id: toNumber(existing.id) ?? 0,
        userId: toNumber(existing.user_id) ?? 0,
        title: toText(existing.title) ?? "My Wishlist",
        createdAt: toText(existing.created_at),
      };
    }
    const result = await this.client.run(
      "INSERT INTO wishlists (user_id, title) VALUES (?, ?)",
      userId,
      "My Wishlist",
    );
    return {
      id: lastRowId(result),
      userId,
      title: "My Wishlist",
      createdAt: null,
    };
  }

  async findDuplicate(wishlistId: number, productId: number): Promise<number | null> {
    const row = await this.client.first<{ id: number }>(
      "SELECT id FROM wishlist_items WHERE wishlist_id = ? AND product_id = ? LIMIT 1",
      wishlistId,
      productId,
    );
    return row?.id ?? null;
  }

  async addItem(wishlistId: number, productId: number): Promise<number> {
    const result = await this.client.run(
      "INSERT INTO wishlist_items (wishlist_id, product_id) VALUES (?, ?)",
      wishlistId,
      productId,
    );
    return lastRowId(result);
  }

  async listItems(wishlistId: number): Promise<WishlistItem[]> {
    const rows = await this.client.all<Record<string, unknown>>(
      `
        SELECT wi.id, wi.wishlist_id, wi.created_at, p.id AS product_id, p.name AS product_name,
               p.cover_image_url AS image
        FROM wishlist_items wi
        JOIN products p ON p.id = wi.product_id
        WHERE wi.wishlist_id = ?
        ORDER BY wi.id ASC
      `,
      wishlistId,
    );
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      wishlistId: toNumber(row.wishlist_id) ?? 0,
      productId: toNumber(row.product_id) ?? 0,
      productName: toText(row.product_name) ?? "",
      image: toText(row.image),
      createdAt: toText(row.created_at),
    }));
  }

  async hasItem(wishlistId: number, itemId: number): Promise<boolean> {
    const row = await this.client.first<{ id: number }>(
      "SELECT id FROM wishlist_items WHERE wishlist_id = ? AND id = ? LIMIT 1",
      wishlistId,
      itemId,
    );
    return row !== null;
  }

  async deleteItem(itemId: number): Promise<void> {
    await this.client.run("DELETE FROM wishlist_items WHERE id = ?", itemId);
  }
}

export class D1ViewlistRepository implements ViewlistRepository {
  constructor(private readonly client: D1Client) {}

  async getOrCreateDefault(userId: number): Promise<Viewlist> {
    const existing = await this.client.first<Record<string, unknown>>(
      `
        SELECT id, user_id, title, created_at
        FROM viewlists
        WHERE user_id = ?
        ORDER BY id ASC
        LIMIT 1
      `,
      userId,
    );
    if (existing) {
      return {
        id: toNumber(existing.id) ?? 0,
        userId: toNumber(existing.user_id) ?? 0,
        title: toText(existing.title) ?? "My Viewlist",
        createdAt: toText(existing.created_at),
      };
    }
    const result = await this.client.run(
      "INSERT INTO viewlists (user_id, title) VALUES (?, ?)",
      userId,
      "My Viewlist",
    );
    return {
      id: lastRowId(result),
      userId,
      title: "My Viewlist",
      createdAt: null,
    };
  }

  async addItem(input: CreateViewlistItemInput): Promise<number> {
    const result = await this.client.run(
      "INSERT INTO viewlist_items (viewlist_id, variant_id, quantity, note) VALUES (?, ?, ?, ?)",
      input.viewlistId,
      input.variantId,
      input.quantity,
      input.note,
    );
    return lastRowId(result);
  }

  async listItems(viewlistId: number): Promise<ViewlistItem[]> {
    const rows = await this.client.all<Record<string, unknown>>(
      `
        SELECT vi.id, vi.viewlist_id, vi.quantity, vi.note, vi.created_at,
               pv.id AS variant_id, pv.product_id, pv.price, p.name AS product_name
        FROM viewlist_items vi
        JOIN product_variants pv ON pv.id = vi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
        WHERE vi.viewlist_id = ?
        ORDER BY vi.id ASC
      `,
      viewlistId,
    );
    return rows.map((row) => ({
      id: toNumber(row.id) ?? 0,
      viewlistId: toNumber(row.viewlist_id) ?? 0,
      variantId: toNumber(row.variant_id) ?? 0,
      productId: toNumber(row.product_id) ?? 0,
      productName: toText(row.product_name),
      quantity: toNumber(row.quantity) ?? 1,
      note: toText(row.note),
      price: toNumber(row.price),
      createdAt: toText(row.created_at),
    }));
  }

  async hasItem(viewlistId: number, itemId: number): Promise<boolean> {
    const row = await this.client.first<{ id: number }>(
      "SELECT id FROM viewlist_items WHERE viewlist_id = ? AND id = ? LIMIT 1",
      viewlistId,
      itemId,
    );
    return row !== null;
  }

  async deleteItem(itemId: number): Promise<void> {
    await this.client.run("DELETE FROM viewlist_items WHERE id = ?", itemId);
  }
}

export class D1AuthRepository implements AuthRepository {
  constructor(private readonly client: D1Client) {}

  async createSession(userId: number, token: string, provider: string): Promise<void> {
    await this.client.run(
      "INSERT INTO auth_sessions (user_id, token, provider) VALUES (?, ?, ?)",
      userId,
      token,
      provider,
    );
  }

  async findSession(token: string): Promise<AuthSession | null> {
    const row = await this.client.first<Record<string, unknown>>(
      `
        SELECT s.token, s.provider, u.id AS user_id, u.display_name, u.email
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        LIMIT 1
      `,
      token,
    );
    if (!row) {
      return null;
    }
    return {
      token: toText(row.token) ?? "",
      provider: toText(row.provider) ?? "local",
      userId: toNumber(row.user_id) ?? 0,
      displayName: toText(row.display_name) ?? "",
      email: toText(row.email),
    };
  }

  async deleteSession(token: string): Promise<void> {
    await this.client.run("DELETE FROM auth_sessions WHERE token = ?", token);
  }

  async findOAuthIdentity(provider: string, providerUserId: string): Promise<OAuthIdentity | null> {
    const row = await this.client.first<Record<string, unknown>>(
      `
        SELECT id, user_id, provider, provider_user_id, email
        FROM oauth_identities
        WHERE provider = ? AND provider_user_id = ?
        LIMIT 1
      `,
      provider,
      providerUserId,
    );
    if (!row) {
      return null;
    }
    return {
      id: toNumber(row.id) ?? 0,
      userId: toNumber(row.user_id) ?? 0,
      provider: toText(row.provider) ?? "",
      providerUserId: toText(row.provider_user_id) ?? "",
      email: toText(row.email),
    };
  }

  async createOAuthIdentity(userId: number, provider: string, providerUserId: string, email: string | null): Promise<void> {
    await this.client.run(
      `
        INSERT INTO oauth_identities (user_id, provider, provider_user_id, email)
        VALUES (?, ?, ?, ?)
      `,
      userId,
      provider,
      providerUserId,
      email,
    );
  }

  async updateOAuthIdentityEmail(identityId: number, email: string | null): Promise<void> {
    await this.client.run(
      "UPDATE oauth_identities SET email = ? WHERE id = ?",
      email,
      identityId,
    );
  }
}

export function createD1Repositories(db: D1Database): RepositoryFactory {
  const client = new D1Client(db);
  return {
    catalog: new D1CatalogRepository(client),
    users: new D1UserRepository(client),
    stores: new D1StoreRepository(client),
    collections: new D1CollectionRepository(client),
    wishlists: new D1WishlistRepository(client),
    viewlists: new D1ViewlistRepository(client),
    auth: new D1AuthRepository(client),
  };
}
