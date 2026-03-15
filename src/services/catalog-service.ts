import type { CatalogRepository } from "../domain/ports";

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  async getFeed(cursor: number, limit: number, category: string | null) {
    const rows = await this.repository.listFeedRows();
    const totalSlots = rows.length;
    if (totalSlots === 0) {
      return { items: [], nextCursor: null };
    }

    const cursorNorm = cursor % totalSlots;
    let selected = rows;
    let nextCursor = cursorNorm;

    if (category) {
      const collected: typeof rows = [];
      let scanned = 0;
      let idx = cursorNorm;
      while (scanned < totalSlots && collected.length < limit) {
        const row = rows[idx];
        scanned += 1;
        idx = (idx + 1) % totalSlots;
        if (row.categorySlug === category) {
          collected.push(row);
        }
      }
      selected = collected;
      nextCursor = (cursorNorm + scanned) % totalSlots;
    } else {
      selected = [];
      let idx = cursorNorm;
      for (let i = 0; i < Math.min(limit, totalSlots); i += 1) {
        selected.push(rows[idx]);
        idx = (idx + 1) % totalSlots;
      }
      nextCursor = (cursorNorm + selected.length) % totalSlots;
    }

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
