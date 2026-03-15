import type {
  CatalogRepository,
  UserRepository,
  ViewlistRepository,
  WishlistRepository,
} from "../domain/ports";

export class ListService {
  constructor(
    private readonly users: UserRepository,
    private readonly catalog: CatalogRepository,
    private readonly wishlists: WishlistRepository,
    private readonly viewlists: ViewlistRepository,
  ) {}

  async addWishlistItem(userId: number, productId: number) {
    const user = await this.users.getById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    const productExists = await this.catalog.productExists(productId);
    if (!productExists) {
      throw new Error("Product not found");
    }
    const wishlist = await this.wishlists.getOrCreateDefault(userId);
    const duplicateId = await this.wishlists.findDuplicate(wishlist.id, productId);
    if (duplicateId !== null) {
      return { ok: true, itemId: duplicateId, duplicated: true };
    }
    const itemId = await this.wishlists.addItem(wishlist.id, productId);
    return { ok: true, itemId, duplicated: false };
  }

  async getWishlist(userId: number) {
    const wishlist = await this.wishlists.getOrCreateDefault(userId);
    const items = await this.wishlists.listItems(wishlist.id);
    return { wishlistId: wishlist.id, items };
  }

  async deleteWishlistItem(userId: number, itemId: number) {
    const wishlist = await this.wishlists.getOrCreateDefault(userId);
    const exists = await this.wishlists.hasItem(wishlist.id, itemId);
    if (!exists) {
      throw new Error("Item not found");
    }
    await this.wishlists.deleteItem(itemId);
    return { ok: true };
  }

  async addViewlistItem(userId: number, variantId: number, quantity: number, note: string | null) {
    const user = await this.users.getById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    const variantExists = await this.catalog.variantExists(variantId);
    if (!variantExists) {
      throw new Error("Variant not found");
    }
    const viewlist = await this.viewlists.getOrCreateDefault(userId);
    const itemId = await this.viewlists.addItem({
      viewlistId: viewlist.id,
      variantId,
      quantity: Math.max(quantity, 1),
      note,
    });
    return { ok: true, itemId };
  }

  async getViewlist(userId: number) {
    const viewlist = await this.viewlists.getOrCreateDefault(userId);
    const items = await this.viewlists.listItems(viewlist.id);
    return { viewlistId: viewlist.id, items };
  }

  async deleteViewlistItem(userId: number, itemId: number) {
    const viewlist = await this.viewlists.getOrCreateDefault(userId);
    const exists = await this.viewlists.hasItem(viewlist.id, itemId);
    if (!exists) {
      throw new Error("Item not found");
    }
    await this.viewlists.deleteItem(itemId);
    return { ok: true };
  }
}
