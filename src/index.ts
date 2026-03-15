import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { createAppContext } from "./app-context";

type Bindings = {
  ASSETS?: Fetcher;
  DB: D1Database;
  AUTH_PROVIDERS?: string;
  LOCAL_AUTH_MODE?: string;
  PREVIEW_ADMIN_DISPLAY_NAME?: string;
  PREVIEW_ADMIN_EMAIL?: string;
  LINE_CLIENT_ID?: string;
  LINE_CLIENT_SECRET?: string;
  LINE_REDIRECT_URI?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
};

type AppContext = Context<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", cors({ origin: "*", allowHeaders: ["*"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));

app.onError((error) => {
  console.error(error);
  return jsonError(500, error.message || "Internal Server Error");
});

function jsonError(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function services(c: AppContext) {
  return createAppContext(c.env.DB).services;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeVisibility(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "private";
  return normalized === "public" ? "public" : "private";
}

function queryInt(c: AppContext, key: string, defaultValue?: number) {
  const raw = c.req.query(key);
  if (raw == null || raw === "") {
    return defaultValue ?? null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const value = authorization.trim();
  if (!value.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return value.slice(7).trim() || null;
}

function envValue(c: AppContext, key: keyof Bindings): string | null {
  const value = c.env[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function enabledAuthProviders(c: AppContext): string[] {
  const raw = envValue(c, "AUTH_PROVIDERS");
  if (!raw) {
    return ["local", "line", "google"];
  }
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isProviderEnabled(c: AppContext, provider: "local" | "line" | "google"): boolean {
  return enabledAuthProviders(c).includes(provider);
}

function localAuthMode(c: AppContext): string {
  return envValue(c, "LOCAL_AUTH_MODE") ?? "form";
}

async function parseJsonBody<T>(c: AppContext): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

function redirectUri(c: AppContext, envKey: keyof Bindings, pathname: string) {
  const env = envValue(c, envKey);
  if (env) {
    return env;
  }
  const url = new URL(c.req.url);
  url.pathname = pathname;
  url.search = "";
  return url.toString();
}

function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> {
  if (!token) {
    return {};
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return {};
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function postForm(url: string, data: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    throw new Error(typeof parsed === "object" && parsed !== null ? JSON.stringify(parsed) : String(parsed));
  }
  return (parsed as Record<string, unknown>) ?? {};
}

async function getJson(url: string, headers?: Record<string, string>) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    throw new Error(typeof parsed === "object" && parsed !== null ? JSON.stringify(parsed) : String(parsed));
  }
  return (parsed as Record<string, unknown>) ?? {};
}

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/v1/feed", async (c) => {
  const cursor = queryInt(c, "cursor", 0);
  const limit = queryInt(c, "limit", 20);
  const category = normalizeString(c.req.query("category"));
  if (cursor === null || cursor < 0) {
    return jsonError(400, "cursor must be >= 0");
  }
  if (limit === null || limit < 1 || limit > 100) {
    return jsonError(400, "limit must be between 1 and 100");
  }
  const result = await services(c).catalog.getFeed(cursor, limit, category);
  return c.json({ items: result.items, next_cursor: result.nextCursor });
});

app.get("/api/v1/categories", async (c) => {
  const categories = await services(c).catalog.listCategories();
  return c.json(categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    name_zh: category.nameZh,
    name_en: category.nameEn,
    parent_id: category.parentId,
    level: category.level,
    sort_order: category.sortOrder,
    is_active: category.isActive,
  })));
});

app.get("/api/v1/products/:productId", async (c) => {
  const productId = Number(c.req.param("productId"));
  if (!Number.isFinite(productId)) {
    return jsonError(400, "Invalid product id");
  }
  const product = await services(c).catalog.getProductById(productId);
  if (!product) {
    return jsonError(404, "Product not found");
  }
  return c.json({
    id: product.id,
    product_code: product.productCode,
    name: product.name,
    brand: product.brand,
    category: product.category,
    category_slug: product.categorySlug,
    description: product.description,
    cover_image_url: product.coverImageUrl,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      variant_code: variant.variantCode,
      color: variant.color,
      size_label: variant.sizeLabel,
      material: variant.material,
      price: variant.price,
      stock: variant.stock,
    })),
    images: product.images.map((image) => ({
      id: image.id,
      image_url: image.imageUrl,
      image_type: image.imageType,
      position: image.position,
    })),
  });
});

app.get("/api/v1/products/:productId/drawer", async (c) => {
  const productId = Number(c.req.param("productId"));
  if (!Number.isFinite(productId)) {
    return jsonError(400, "Invalid product id");
  }
  const product = await services(c).catalog.getProductById(productId);
  if (!product) {
    return jsonError(404, "Product not found");
  }
  return c.json({
    id: product.id,
    product_code: product.productCode,
    name: product.name,
    brand: product.brand,
    category: product.category,
    category_slug: product.categorySlug,
    description: product.description,
    cover_image_url: product.coverImageUrl,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      variant_code: variant.variantCode,
      color: variant.color,
      size_label: variant.sizeLabel,
      material: variant.material,
      price: variant.price,
      stock: variant.stock,
    })),
    images: product.images.map((image) => ({
      id: image.id,
      image_url: image.imageUrl,
      image_type: image.imageType,
      position: image.position,
    })),
  });
});

app.get("/api/v1/products/highlights/latest", async (c) => {
  const limit = queryInt(c, "limit", 12);
  if (limit === null || limit < 1 || limit > 50) {
    return jsonError(400, "limit must be between 1 and 50");
  }
  return c.json({ items: await services(c).catalog.getHighlightProducts("latest", limit) });
});

app.get("/api/v1/products/highlights/discount", async (c) => {
  const limit = queryInt(c, "limit", 12);
  if (limit === null || limit < 1 || limit > 50) {
    return jsonError(400, "limit must be between 1 and 50");
  }
  return c.json({ items: await services(c).catalog.getHighlightProducts("discount", limit) });
});

app.get("/api/v1/auth/config", (c) => {
  return c.json({
    providers: enabledAuthProviders(c),
    local_mode: localAuthMode(c),
  });
});

app.post("/api/v1/wishlist/items", async (c) => {
  const body = await parseJsonBody<{ user_id?: unknown; product_id?: unknown }>(c);
  const userId = Number(body?.user_id);
  const productId = Number(body?.product_id);
  if (!Number.isFinite(userId) || !Number.isFinite(productId)) {
    return jsonError(400, "user_id and product_id are required");
  }
  try {
    const result = await services(c).lists.addWishlistItem(userId, productId);
    return c.json({ ok: result.ok, item_id: result.itemId, duplicated: result.duplicated || undefined });
  } catch (error) {
    return jsonError(error instanceof Error && error.message.includes("not found") ? 404 : 400, error instanceof Error ? error.message : "Request failed");
  }
});

app.post("/api/v1/viewlist/items", async (c) => {
  const body = await parseJsonBody<{ user_id?: unknown; variant_id?: unknown; quantity?: unknown; note?: unknown }>(c);
  const userId = Number(body?.user_id);
  const variantId = Number(body?.variant_id);
  const quantity = Math.max(Number(body?.quantity ?? 1), 1);
  const note = typeof body?.note === "string" ? body.note : null;
  if (!Number.isFinite(userId) || !Number.isFinite(variantId)) {
    return jsonError(400, "user_id and variant_id are required");
  }
  try {
    const result = await services(c).lists.addViewlistItem(userId, variantId, quantity, note);
    return c.json({ ok: result.ok, item_id: result.itemId });
  } catch (error) {
    return jsonError(error instanceof Error && error.message.includes("not found") ? 404 : 400, error instanceof Error ? error.message : "Request failed");
  }
});

app.delete("/api/v1/viewlist/items/:itemId", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  const userId = queryInt(c, "user_id");
  if (!Number.isFinite(itemId) || userId === null) {
    return jsonError(400, "item_id and user_id are required");
  }
  try {
    return c.json(await services(c).lists.deleteViewlistItem(userId, itemId));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Item not found");
  }
});

app.post("/api/v1/collections", async (c) => {
  const body = await parseJsonBody<{
    owner_id?: unknown;
    title?: unknown;
    description?: unknown;
    cover_image_url?: unknown;
    store_id?: unknown;
    visibility?: unknown;
    is_store_scene?: unknown;
  }>(c);
  const ownerId = Number(body?.owner_id);
  const title = normalizeString(body?.title);
  const storeId = body?.store_id == null ? null : Number(body.store_id);
  if (!Number.isFinite(ownerId) || !title) {
    return jsonError(400, "owner_id and title are required");
  }
  try {
    const result = await services(c).collections.createCollection({
      ownerId,
      title,
      description: typeof body?.description === "string" ? body.description : null,
      coverImageUrl: typeof body?.cover_image_url === "string" ? body.cover_image_url : null,
      storeId: storeId !== null && Number.isFinite(storeId) ? storeId : null,
      visibility: normalizeVisibility(body?.visibility),
      isStoreScene: Boolean(body?.is_store_scene),
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("permission") ? 403 : message.includes("not found") ? 404 : 400;
    return jsonError(status, message);
  }
});

app.get("/api/v1/collections", async (c) => {
  const ownerId = queryInt(c, "owner_id");
  const items = await services(c).collections.listCollections(ownerId ?? undefined);
  return c.json({
    items: items.map((collection) => ({
      id: collection.id,
      owner_id: collection.ownerId,
      store_id: collection.storeId,
      store_name: collection.storeName,
      title: collection.title,
      description: collection.description,
      cover_image_url: collection.coverImageUrl,
      visibility: collection.visibility,
      is_store_scene: collection.isStoreScene,
    })),
  });
});

app.patch("/api/v1/collections/:collectionId", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  if (!Number.isFinite(collectionId)) {
    return jsonError(400, "Invalid collection id");
  }
  const current = await services(c).collections.listCollections();
  const collection = current.find((item) => item.id === collectionId);
  if (!collection) {
    return jsonError(404, "Collection not found");
  }
  const body = await parseJsonBody<{
    title?: unknown;
    description?: unknown;
    cover_image_url?: unknown;
    store_id?: unknown;
    visibility?: unknown;
    is_store_scene?: unknown;
  }>(c);
  try {
    return c.json(await services(c).collections.updateCollection(collectionId, {
      title: body?.title !== undefined ? normalizeString(body.title) ?? collection.title : collection.title,
      description: body?.description !== undefined && typeof body.description === "string" ? body.description : collection.description,
      coverImageUrl: body?.cover_image_url !== undefined && typeof body.cover_image_url === "string" ? body.cover_image_url : collection.coverImageUrl,
      storeId: body?.store_id !== undefined && body.store_id != null && Number.isFinite(Number(body.store_id))
        ? Number(body.store_id)
        : collection.storeId,
      visibility: body?.visibility !== undefined ? normalizeVisibility(body.visibility) : collection.visibility,
      isStoreScene: body?.is_store_scene !== undefined ? Boolean(body.is_store_scene) : collection.isStoreScene,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("permission") ? 403 : message.includes("not found") ? 404 : 400;
    return jsonError(status, message);
  }
});

app.delete("/api/v1/collections/:collectionId", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  const userId = queryInt(c, "user_id");
  if (!Number.isFinite(collectionId) || userId === null) {
    return jsonError(400, "collection_id and user_id are required");
  }
  try {
    return c.json(await services(c).collections.deleteCollection(collectionId, userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("permission") ? 403 : message.includes("not found") ? 404 : 400;
    return jsonError(status, message);
  }
});

app.get("/api/v1/collections/public/search", async (c) => {
  const keyword = (c.req.query("q") ?? "").trim().toLowerCase();
  const limit = queryInt(c, "limit", 20);
  if (limit === null || limit < 1 || limit > 100) {
    return jsonError(400, "limit must be between 1 and 100");
  }
  const items = await services(c).collections.searchPublicCollections(keyword, limit);
  return c.json({
    items: items.map((collection) => ({
      id: collection.id,
      owner_id: collection.ownerId,
      store_id: collection.storeId,
      store_name: collection.storeName,
      title: collection.title,
      description: collection.description,
      cover_image_url: collection.coverImageUrl,
      visibility: collection.visibility,
      is_store_scene: collection.isStoreScene,
    })),
  });
});

app.get("/api/v1/collections/store/latest", async (c) => {
  const limit = queryInt(c, "limit", 12);
  if (limit === null || limit < 1 || limit > 50) {
    return jsonError(400, "limit must be between 1 and 50");
  }
  const items = await services(c).collections.listLatestStoreCollections(limit);
  return c.json({
    items: items.map((collection) => ({
      id: collection.id,
      owner_id: collection.ownerId,
      store_id: collection.storeId,
      store_name: collection.storeName,
      title: collection.title,
      description: collection.description,
      cover_image_url: collection.coverImageUrl,
      visibility: collection.visibility,
      is_store_scene: collection.isStoreScene,
    })),
  });
});

app.post("/api/v1/collections/:collectionId/items", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  if (!Number.isFinite(collectionId)) {
    return jsonError(400, "Invalid collection id");
  }
  const body = await parseJsonBody<{ product_id?: unknown; variant_id?: unknown; position?: unknown; note?: unknown }>(c);
  const productId = Number(body?.product_id);
  const variantId = body?.variant_id == null ? null : Number(body.variant_id);
  const position = body?.position == null ? null : Number(body.position);
  if (!Number.isFinite(productId)) {
    return jsonError(400, "product_id is required");
  }
  try {
    const result = await services(c).collections.addCollectionItem(
      collectionId,
      productId,
      variantId !== null && Number.isFinite(variantId) ? variantId : null,
      position !== null && Number.isFinite(position) ? position : null,
      typeof body?.note === "string" ? body.note : null,
    );
    return c.json({ ok: result.ok, item_id: result.itemId });
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.get("/api/v1/collections/:collectionId/items", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  if (!Number.isFinite(collectionId)) {
    return jsonError(400, "Invalid collection id");
  }
  try {
    const result = await services(c).collections.listCollectionItems(collectionId);
    return c.json({
      collection: {
        id: result.collection.id,
        owner_id: result.collection.ownerId,
        store_id: result.collection.storeId,
        title: result.collection.title,
        description: result.collection.description,
        visibility: result.collection.visibility,
        is_store_scene: result.collection.isStoreScene,
      },
      items: result.items.map((item) => ({
        id: item.id,
        product_id: item.productId,
        variant_id: item.variantId,
        position: item.position,
        note: item.note,
      })),
    });
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.delete("/api/v1/collections/:collectionId/items/:itemId", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  const itemId = Number(c.req.param("itemId"));
  if (!Number.isFinite(collectionId) || !Number.isFinite(itemId)) {
    return jsonError(400, "Invalid ids");
  }
  try {
    return c.json(await services(c).collections.deleteCollectionItem(collectionId, itemId));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.get("/api/v1/collections/:collectionId/images", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  if (!Number.isFinite(collectionId)) {
    return jsonError(400, "Invalid collection id");
  }
  try {
    const result = await services(c).collections.listCollectionImages(collectionId);
    return c.json({
      items: result.items.map((image) => ({
        id: image.id,
        image_url: image.imageUrl,
        caption: image.caption,
      })),
    });
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.post("/api/v1/collections/:collectionId/images", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  if (!Number.isFinite(collectionId)) {
    return jsonError(400, "Invalid collection id");
  }
  const body = await parseJsonBody<{ image_url?: unknown; caption?: unknown }>(c);
  const imageUrl = normalizeString(body?.image_url);
  if (!imageUrl) {
    return jsonError(400, "image_url is required");
  }
  try {
    return c.json(await services(c).collections.addCollectionImage(collectionId, imageUrl, typeof body?.caption === "string" ? body.caption : null));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.delete("/api/v1/collections/:collectionId/images/:imageId", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  const imageId = Number(c.req.param("imageId"));
  if (!Number.isFinite(collectionId) || !Number.isFinite(imageId)) {
    return jsonError(400, "Invalid ids");
  }
  try {
    return c.json(await services(c).collections.deleteCollectionImage(collectionId, imageId));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.get("/api/v1/collections/:collectionId/comments", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  if (!Number.isFinite(collectionId)) {
    return jsonError(400, "Invalid collection id");
  }
  try {
    return c.json(await services(c).collections.listCollectionComments(collectionId));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.post("/api/v1/collections/:collectionId/comments", async (c) => {
  const collectionId = Number(c.req.param("collectionId"));
  if (!Number.isFinite(collectionId)) {
    return jsonError(400, "Invalid collection id");
  }
  const body = await parseJsonBody<{ user_id?: unknown; content?: unknown }>(c);
  const userId = Number(body?.user_id);
  const content = normalizeString(body?.content);
  if (!Number.isFinite(userId)) {
    return jsonError(400, "user_id is required");
  }
  if (!content) {
    return jsonError(400, "Content is empty");
  }
  try {
    return c.json(await services(c).collections.addCollectionComment(collectionId, userId, content));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.get("/api/v1/users/:userId/wishlist", async (c) => {
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) {
    return jsonError(400, "Invalid user id");
  }
  const result = await services(c).lists.getWishlist(userId);
  return c.json({
    wishlist_id: result.wishlistId,
    items: result.items.map((item) => ({
      id: item.id,
      product_id: item.productId,
      name: item.productName,
      image: item.image,
    })),
  });
});

app.delete("/api/v1/wishlist/items/:itemId", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  const userId = queryInt(c, "user_id");
  if (!Number.isFinite(itemId) || userId === null) {
    return jsonError(400, "item_id and user_id are required");
  }
  try {
    return c.json(await services(c).lists.deleteWishlistItem(userId, itemId));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.get("/api/v1/users/:userId/collections", async (c) => {
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) {
    return jsonError(400, "Invalid user id");
  }
  const items = await services(c).collections.listCollections(userId);
  return c.json({
    items: items.map((collection) => ({
      id: collection.id,
      owner_id: collection.ownerId,
      store_id: collection.storeId,
      store_name: collection.storeName,
      title: collection.title,
      description: collection.description,
      cover_image_url: collection.coverImageUrl,
      visibility: collection.visibility,
      is_store_scene: collection.isStoreScene,
    })),
  });
});

app.get("/api/v1/wishlists/default", async (c) => {
  const userId = queryInt(c, "user_id");
  if (userId === null) {
    return jsonError(400, "user_id is required");
  }
  const result = await services(c).lists.getWishlist(userId);
  return c.json({
    wishlist_id: result.wishlistId,
    items: result.items.map((item) => ({
      id: item.id,
      product_id: item.productId,
      name: item.productName,
      image: item.image,
    })),
  });
});

app.post("/api/v1/wishlists/default/items", async (c) => {
  const body = await parseJsonBody<{ user_id?: unknown; product_id?: unknown }>(c);
  const userId = Number(body?.user_id);
  const productId = Number(body?.product_id);
  if (!Number.isFinite(userId) || !Number.isFinite(productId)) {
    return jsonError(400, "user_id and product_id are required");
  }
  try {
    const result = await services(c).lists.addWishlistItem(userId, productId);
    return c.json({ ok: result.ok, item_id: result.itemId, duplicated: result.duplicated || undefined });
  } catch (error) {
    return jsonError(error instanceof Error && error.message.includes("not found") ? 404 : 400, error instanceof Error ? error.message : "Request failed");
  }
});

app.delete("/api/v1/wishlists/default/items/:itemId", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  const userId = queryInt(c, "user_id");
  if (!Number.isFinite(itemId) || userId === null) {
    return jsonError(400, "item_id and user_id are required");
  }
  try {
    return c.json(await services(c).lists.deleteWishlistItem(userId, itemId));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.get("/api/v1/users/:userId/viewlist", async (c) => {
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) {
    return jsonError(400, "Invalid user id");
  }
  const result = await services(c).lists.getViewlist(userId);
  return c.json({
    viewlist_id: result.viewlistId,
    items: result.items.map((item) => ({
      id: item.id,
      variant_id: item.variantId,
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      note: item.note,
      price: item.price,
    })),
  });
});

app.get("/api/v1/viewlists/default", async (c) => {
  const userId = queryInt(c, "user_id");
  if (userId === null) {
    return jsonError(400, "user_id is required");
  }
  const result = await services(c).lists.getViewlist(userId);
  return c.json({
    viewlist_id: result.viewlistId,
    items: result.items.map((item) => ({
      id: item.id,
      variant_id: item.variantId,
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      note: item.note,
      price: item.price,
    })),
  });
});

app.post("/api/v1/viewlists/default/items", async (c) => {
  const body = await parseJsonBody<{ user_id?: unknown; variant_id?: unknown; quantity?: unknown; note?: unknown }>(c);
  const userId = Number(body?.user_id);
  const variantId = Number(body?.variant_id);
  const quantity = Math.max(Number(body?.quantity ?? 1), 1);
  const note = typeof body?.note === "string" ? body.note : null;
  if (!Number.isFinite(userId) || !Number.isFinite(variantId)) {
    return jsonError(400, "user_id and variant_id are required");
  }
  try {
    const result = await services(c).lists.addViewlistItem(userId, variantId, quantity, note);
    return c.json({ ok: result.ok, item_id: result.itemId });
  } catch (error) {
    return jsonError(error instanceof Error && error.message.includes("not found") ? 404 : 400, error instanceof Error ? error.message : "Request failed");
  }
});

app.delete("/api/v1/viewlists/default/items/:itemId", async (c) => {
  const itemId = Number(c.req.param("itemId"));
  const userId = queryInt(c, "user_id");
  if (!Number.isFinite(itemId) || userId === null) {
    return jsonError(400, "item_id and user_id are required");
  }
  try {
    return c.json(await services(c).lists.deleteViewlistItem(userId, itemId));
  } catch (error) {
    return jsonError(404, error instanceof Error ? error.message : "Request failed");
  }
});

app.get("/api/v1/auth/line/start", (c) => {
  if (!isProviderEnabled(c, "line")) {
    return jsonError(404, "LINE login is not enabled");
  }
  const clientId = envValue(c, "LINE_CLIENT_ID");
  if (!clientId) {
    return jsonError(500, "LINE_CLIENT_ID not configured");
  }
  const state = crypto.randomUUID();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(c, "LINE_REDIRECT_URI", "/api/v1/auth/line/callback"),
    scope: "profile openid email",
    state,
  });
  setCookie(c, "oauth_state_line", state, { maxAge: 600, httpOnly: true, sameSite: "Lax", path: "/" });
  return c.redirect(`https://access.line.me/oauth2/v2.1/authorize?${query.toString()}`);
});

app.get("/api/v1/auth/google/start", (c) => {
  if (!isProviderEnabled(c, "google")) {
    return jsonError(404, "Google login is not enabled");
  }
  const clientId = envValue(c, "GOOGLE_CLIENT_ID");
  if (!clientId) {
    return jsonError(500, "GOOGLE_CLIENT_ID not configured");
  }
  const state = crypto.randomUUID();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(c, "GOOGLE_REDIRECT_URI", "/api/v1/auth/google/callback"),
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  setCookie(c, "oauth_state_google", state, { maxAge: 600, httpOnly: true, sameSite: "Lax", path: "/" });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`);
});

app.get("/api/v1/auth/line/callback", async (c) => {
  if (!isProviderEnabled(c, "line")) {
    return jsonError(404, "LINE login is not enabled");
  }
  const code = normalizeString(c.req.query("code"));
  const state = normalizeString(c.req.query("state"));
  const error = normalizeString(c.req.query("error"));
  if (error) {
    return jsonError(400, `LINE login failed: ${error}`);
  }
  const expectedState = getCookie(c, "oauth_state_line");
  if (!code || !state) {
    return jsonError(400, "Missing LINE OAuth callback parameters");
  }
  if (!expectedState || expectedState !== state) {
    return jsonError(400, "Invalid state");
  }
  const clientId = envValue(c, "LINE_CLIENT_ID");
  const clientSecret = envValue(c, "LINE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return jsonError(500, "LINE OAuth secret not configured");
  }
  try {
    const tokenData = await postForm("https://api.line.me/oauth2/v2.1/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(c, "LINE_REDIRECT_URI", "/api/v1/auth/line/callback"),
      client_id: clientId,
      client_secret: clientSecret,
    });
    const accessToken = normalizeString(tokenData.access_token);
    if (!accessToken) {
      return jsonError(400, "LINE token exchange failed");
    }
    const profile = await getJson("https://api.line.me/v2/profile", {
      Authorization: `Bearer ${accessToken}`,
    });
    const idTokenPayload = decodeJwtPayload(normalizeString(tokenData.id_token));
    const providerUserId = normalizeString(profile.userId) ?? normalizeString(idTokenPayload.sub);
    if (!providerUserId) {
      return jsonError(400, "LINE user identifier missing");
    }
    const displayName = normalizeString(profile.displayName) ?? normalizeString(idTokenPayload.name) ?? "LINE User";
    const email = normalizeString(idTokenPayload.email);
    const auth = await services(c).auth.loginViaOAuth("line", providerUserId, displayName, email);
    deleteCookie(c, "oauth_state_line", { path: "/" });
    return c.redirect(`/#token=${auth.token}&provider=line`);
  } catch (oauthError) {
    return jsonError(400, oauthError instanceof Error ? oauthError.message : "LINE login failed");
  }
});

app.get("/api/v1/auth/google/callback", async (c) => {
  if (!isProviderEnabled(c, "google")) {
    return jsonError(404, "Google login is not enabled");
  }
  const code = normalizeString(c.req.query("code"));
  const state = normalizeString(c.req.query("state"));
  const error = normalizeString(c.req.query("error"));
  if (error) {
    return jsonError(400, `Google login failed: ${error}`);
  }
  const expectedState = getCookie(c, "oauth_state_google");
  if (!code || !state) {
    return jsonError(400, "Missing Google OAuth callback parameters");
  }
  if (!expectedState || expectedState !== state) {
    return jsonError(400, "Invalid state");
  }
  const clientId = envValue(c, "GOOGLE_CLIENT_ID");
  const clientSecret = envValue(c, "GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return jsonError(500, "GOOGLE OAuth secret not configured");
  }
  try {
    const tokenData = await postForm("https://oauth2.googleapis.com/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(c, "GOOGLE_REDIRECT_URI", "/api/v1/auth/google/callback"),
      client_id: clientId,
      client_secret: clientSecret,
    });
    const accessToken = normalizeString(tokenData.access_token);
    if (!accessToken) {
      return jsonError(400, "Google token exchange failed");
    }
    const profile = await getJson("https://openidconnect.googleapis.com/v1/userinfo", {
      Authorization: `Bearer ${accessToken}`,
    });
    const providerUserId = normalizeString(profile.sub);
    if (!providerUserId) {
      return jsonError(400, "Google user identifier missing");
    }
    const displayName = normalizeString(profile.name) ?? normalizeString(profile.email) ?? "Google User";
    const email = normalizeString(profile.email);
    const auth = await services(c).auth.loginViaOAuth("google", providerUserId, displayName, email);
    deleteCookie(c, "oauth_state_google", { path: "/" });
    return c.redirect(`/#token=${auth.token}&provider=google`);
  } catch (oauthError) {
    return jsonError(400, oauthError instanceof Error ? oauthError.message : "Google login failed");
  }
});

app.post("/api/v1/auth/login", async (c) => {
  if (!isProviderEnabled(c, "local")) {
    return jsonError(404, "Local login is not enabled");
  }
  const body = await parseJsonBody<{ display_name?: unknown; email?: unknown }>(c);
  const mode = localAuthMode(c);
  const displayName = mode === "fixed_admin"
    ? (envValue(c, "PREVIEW_ADMIN_DISPLAY_NAME") ?? "Preview Admin")
    : normalizeString(body?.display_name);
  const email = mode === "fixed_admin"
    ? envValue(c, "PREVIEW_ADMIN_EMAIL")
    : normalizeString(body?.email);
  if (!displayName) {
    return jsonError(400, "display_name is required");
  }
  return c.json(await services(c).auth.login(displayName, email));
});

app.get("/api/v1/auth/me", async (c) => {
  const token = bearerToken(c.req.header("authorization"));
  if (!token) {
    return jsonError(401, "Missing bearer token");
  }
  const session = await services(c).auth.getSession(token);
  if (!session) {
    return jsonError(401, "Invalid session");
  }
  return c.json({
    token: session.token,
    user_id: session.userId,
    display_name: session.displayName,
    email: session.email,
  });
});

app.post("/api/v1/auth/logout", async (c) => {
  const token = bearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ ok: true });
  }
  return c.json(await services(c).auth.logout(token));
});

app.post("/api/v1/auth/line/callback", async (c) => {
  if (!isProviderEnabled(c, "line")) {
    return jsonError(404, "LINE login is not enabled");
  }
  const body = await parseJsonBody<{ display_name?: unknown; name?: unknown; email?: unknown }>(c);
  const profileName = normalizeString(body?.display_name) ?? normalizeString(body?.name) ?? "LINE User";
  const email = normalizeString(body?.email);
  return c.json(await services(c).auth.loginViaSimpleProvider("line", profileName, email));
});

app.notFound(async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return jsonError(404, "Not Found");
});

export default app;
