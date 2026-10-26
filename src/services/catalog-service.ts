import type { CatalogRepository } from "../domain/ports";

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  async getFeed(cursor: number, limit: number, category: string | null) {
    const rows = await this.repository.listFeedRows();
    const filteredRows = category
      ? rows.filter((row) => row.categorySlug === category)
      : rows;
    const totalSlots = filteredRows.length;
    if (totalSlots === 0) {
      return { items: [], nextCursor: null };
    }
    if (cursor >= totalSlots) {
      return { items: [], nextCursor: null };
    }
    const selected = filteredRows.slice(cursor, cursor + limit);
    const nextCursor = cursor + selected.length < totalSlots
      ? cursor + selected.length
      : null;

    return {
      items: selected.map((row) => row.item),
      nextCursor,
    };
  }

  listCategories() {
    return this.repository.listCategories();
  }

  getProductById(productId: number) {
    return this.repository.getProductById(productId);
  }

  async getHighlightProducts(section: "latest" | "discount", limit: number) {
    const configured = await this.repository.listHighlightProducts(section, limit);
    if (configured.length > 0) {
      return configured;
    }
    return section === "latest"
      ? this.repository.listLatestProducts(limit)
      : this.repository.listDiscountProducts(limit);
  }
}
