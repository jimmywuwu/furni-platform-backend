import type {
  AdminVariantInput,
  AdminProductRepository,
  BatchUpdateAdminProductsInput,
  CreateAdminProductInput,
  UserRepository,
} from "../domain/ports";

type UpdateAdminProductPayload = {
  name?: string;
  status?: "draft" | "published" | "archived";
  description?: string | null;
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
  imageUrls?: string[];
  variantImages?: Array<{
    variantCode: string;
    imageUrls: string[];
  }>;
  variants?: AdminVariantInput[];
};

export class AdminProductService {
  constructor(
    private readonly users: UserRepository,
    private readonly repository: AdminProductRepository,
  ) {}

  async ensureManager(userId: number) {
    const user = await this.users.getById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  }

  listProducts() {
    return this.repository.listAdminProducts();
  }

  private validateVariants(variants: AdminVariantInput[]) {
    if (!variants.length) {
      throw new Error("At least one SKU is required");
    }
    for (const variant of variants) {
      if (variant.price < 0) {
        throw new Error("SKU price must be >= 0");
      }
      if (variant.stock < 0) {
        throw new Error("SKU stock must be >= 0");
      }
    }
  }

  async createProduct(input: CreateAdminProductInput) {
    if (!input.name.trim()) {
      throw new Error("Product name is required");
    }
    this.validateVariants(input.variants);
    return { id: await this.repository.createAdminProduct(input) };
  }

  async updateProduct(productId: number, input: UpdateAdminProductPayload) {
    if (input.name !== undefined && !input.name.trim()) {
      throw new Error("Product name is required");
    }
    if (input.variants !== undefined) {
      this.validateVariants(input.variants);
    }
    await this.repository.updateAdminProduct(productId, input);
    return { ok: true };
  }

  async deleteProduct(productId: number) {
    await this.repository.deleteAdminProduct(productId);
    return { ok: true };
  }

  async batchUpdateProducts(input: BatchUpdateAdminProductsInput) {
    if (!input.productIds.length) {
      throw new Error("product_ids is required");
    }
    if (
      input.widthCm === undefined
      && input.depthCm === undefined
      && input.heightCm === undefined
    ) {
      throw new Error("At least one batch field is required");
    }
    const updated = await this.repository.batchUpdateAdminProducts(input);
    return { ok: true, updated };
  }
}
