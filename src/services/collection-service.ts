import type {
  CatalogRepository,
  CollectionRepository,
  StoreRepository,
  UserRepository,
} from "../domain/ports";

type CreateCollectionArgs = {
  ownerId: number;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  storeId: number | null;
  visibility: string;
  isStoreScene: boolean;
};

type UpdateCollectionArgs = {
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  storeId: number | null;
  visibility: string;
  isStoreScene: boolean;
};

export class CollectionService {
  constructor(
    private readonly users: UserRepository,
    private readonly stores: StoreRepository,
    private readonly catalog: CatalogRepository,
    private readonly collections: CollectionRepository,
  ) {}

  private async assertStorePermission(userId: number, storeId: number) {
    const store = await this.stores.getById(storeId);
    if (!store || !store.isActive) {
      throw new Error("Store not found");
    }
    const hasMembership = await this.stores.hasMembership(userId, storeId);
    if (!hasMembership && store.ownerUserId !== userId) {
      throw new Error("No permission for this store");
    }
  }

  async createCollection(args: CreateCollectionArgs) {
    const user = await this.users.getById(args.ownerId);
    if (!user) {
      throw new Error("User not found");
    }
    if (args.storeId !== null) {
      await this.assertStorePermission(args.ownerId, args.storeId);
    }
    const id = await this.collections.create({
      ...args,
      isStoreScene: args.isStoreScene || args.storeId !== null,
    });
    return { ok: true, id };
  }

  listCollections(ownerId?: number) {
    return this.collections.list(ownerId);
  }

  async updateCollection(collectionId: number, args: UpdateCollectionArgs) {
    const current = await this.collections.getById(collectionId);
    if (!current) {
      throw new Error("Collection not found");
    }
    if (args.storeId !== null) {
      await this.assertStorePermission(current.ownerId, args.storeId);
    }
    await this.collections.update(collectionId, {
      ...args,
      isStoreScene: args.storeId !== null ? true : args.isStoreScene,
    });
    return { ok: true };
  }

  async deleteCollection(collectionId: number, userId: number) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    if (collection.ownerId !== userId) {
      throw new Error("No permission to delete this collection");
    }
    await this.collections.delete(collectionId);
    return { ok: true };
  }

  searchPublicCollections(keyword: string, limit: number) {
    return this.collections.searchPublic(keyword, limit);
  }

  listLatestStoreCollections(limit: number) {
    return this.collections.listLatestStoreCollections(limit);
  }

  async addCollectionItem(collectionId: number, productId: number, variantId: number | null, position: number | null, note: string | null) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    if (!(await this.catalog.productExists(productId))) {
      throw new Error("Product not found");
    }
    if (variantId !== null && !(await this.catalog.variantExists(variantId))) {
      throw new Error("Variant not found");
    }
    const itemId = await this.collections.addItem({ collectionId, productId, variantId, position, note });
    return { ok: true, itemId };
  }

  async listCollectionItems(collectionId: number) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    const items = await this.collections.listItems(collectionId);
    return { collection, items };
  }

  async deleteCollectionItem(collectionId: number, itemId: number) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    await this.collections.deleteItem(collectionId, itemId);
    return { ok: true };
  }

  async listCollectionImages(collectionId: number) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    return { items: await this.collections.listImages(collectionId) };
  }

  async addCollectionImage(collectionId: number, imageUrl: string, caption: string | null) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    const id = await this.collections.addImage({ collectionId, imageUrl, caption });
    return { ok: true, id };
  }

  async deleteCollectionImage(collectionId: number, imageId: number) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    await this.collections.deleteImage(collectionId, imageId);
    return { ok: true };
  }

  async listCollectionComments(collectionId: number) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    return { items: await this.collections.listComments(collectionId) };
  }

  async addCollectionComment(collectionId: number, userId: number, content: string) {
    const collection = await this.collections.getById(collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }
    const user = await this.users.getById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    const id = await this.collections.addComment({ collectionId, userId, content });
    return { ok: true, id };
  }
}
