import type {
  AdminProductSummary,
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
  Store,
  User,
  Viewlist,
  ViewlistItem,
  Wishlist,
  WishlistItem,
} from "./models";

export type CreateCollectionInput = {
  ownerId: number;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  storeId: number | null;
  visibility: string;
  isStoreScene: boolean;
};

export type UpdateCollectionInput = {
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  storeId: number | null;
  visibility: string;
  isStoreScene: boolean;
};

export type CreateCollectionItemInput = {
  collectionId: number;
  productId: number;
  variantId: number | null;
  position: number | null;
  note: string | null;
};

export type CreateCollectionImageInput = {
  collectionId: number;
  imageUrl: string;
  caption: string | null;
};

export type CreateCollectionCommentInput = {
  collectionId: number;
  userId: number;
  content: string;
};

export type CreateViewlistItemInput = {
  viewlistId: number;
  variantId: number;
  quantity: number;
  note: string | null;
};

export type AdminVariantInput = {
  id?: number;
  variantCode?: string | null;
  color?: string | null;
  sizeLabel?: string | null;
  material?: string | null;
  price: number;
  stock: number;
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
};

export type CreateAdminProductInput = {
  name: string;
  status?: "draft" | "published" | "archived";
  description: string | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  imageUrls: string[];
  variantImages?: Array<{
    variantCode: string;
    imageUrls: string[];
  }>;
  variants: AdminVariantInput[];
};

export type UpdateAdminProductInput = {
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

export type BatchUpdateAdminProductsInput = {
  productIds: number[];
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
};

export interface CatalogRepository {
  listFeedRows(): Promise<Array<{ slotType: string; item: FeedItem; categorySlug: string | null }>>;
  listCategories(): Promise<Category[]>;
  getProductById(productId: number): Promise<Product | null>;
  listHighlightProducts(section: HighlightSection, limit: number): Promise<FeedItem[]>;
  listLatestProducts(limit: number): Promise<FeedItem[]>;
  listDiscountProducts(limit: number): Promise<FeedItem[]>;
  productExists(productId: number): Promise<boolean>;
  variantExists(variantId: number): Promise<boolean>;
}

export interface AdminProductRepository {
  listAdminProducts(): Promise<AdminProductSummary[]>;
  createAdminProduct(input: CreateAdminProductInput): Promise<number>;
  updateAdminProduct(productId: number, input: UpdateAdminProductInput): Promise<void>;
  deleteAdminProduct(productId: number): Promise<void>;
  batchUpdateAdminProducts(input: BatchUpdateAdminProductsInput): Promise<number>;
}

export interface UserRepository {
  getById(userId: number): Promise<User | null>;
  findByDisplayNameAndEmail(displayName: string, email: string | null): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(displayName: string, email: string | null): Promise<User>;
  updateProfile(userId: number, patch: { displayName?: string; email?: string | null }): Promise<void>;
}

export interface StoreRepository {
  getById(storeId: number): Promise<Store | null>;
  hasMembership(userId: number, storeId: number): Promise<boolean>;
}

export interface CollectionRepository {
  create(input: CreateCollectionInput): Promise<number>;
  getById(collectionId: number): Promise<Collection | null>;
  list(ownerId?: number): Promise<Collection[]>;
  update(collectionId: number, input: UpdateCollectionInput): Promise<void>;
  delete(collectionId: number): Promise<void>;
  searchPublic(keyword: string, limit: number): Promise<Collection[]>;
  listLatestStoreCollections(limit: number): Promise<Collection[]>;
  addItem(input: CreateCollectionItemInput): Promise<number>;
  listItems(collectionId: number): Promise<CollectionItem[]>;
  deleteItem(collectionId: number, itemId: number): Promise<void>;
  addImage(input: CreateCollectionImageInput): Promise<number>;
  listImages(collectionId: number): Promise<CollectionImage[]>;
  deleteImage(collectionId: number, imageId: number): Promise<void>;
  addComment(input: CreateCollectionCommentInput): Promise<number>;
  listComments(collectionId: number): Promise<CollectionComment[]>;
}

export interface WishlistRepository {
  getOrCreateDefault(userId: number): Promise<Wishlist>;
  findDuplicate(wishlistId: number, productId: number): Promise<number | null>;
  addItem(wishlistId: number, productId: number): Promise<number>;
  listItems(wishlistId: number): Promise<WishlistItem[]>;
  hasItem(wishlistId: number, itemId: number): Promise<boolean>;
  deleteItem(itemId: number): Promise<void>;
}

export interface ViewlistRepository {
  getOrCreateDefault(userId: number): Promise<Viewlist>;
  addItem(input: CreateViewlistItemInput): Promise<number>;
  listItems(viewlistId: number): Promise<ViewlistItem[]>;
  hasItem(viewlistId: number, itemId: number): Promise<boolean>;
  deleteItem(itemId: number): Promise<void>;
}

export interface AuthRepository {
  createSession(userId: number, token: string, provider: string): Promise<void>;
  findSession(token: string): Promise<AuthSession | null>;
  deleteSession(token: string): Promise<void>;
  findOAuthIdentity(provider: string, providerUserId: string): Promise<OAuthIdentity | null>;
  createOAuthIdentity(userId: number, provider: string, providerUserId: string, email: string | null): Promise<void>;
  updateOAuthIdentityEmail(identityId: number, email: string | null): Promise<void>;
}

export interface RepositoryFactory {
  catalog: CatalogRepository;
  adminProducts: AdminProductRepository;
  users: UserRepository;
  stores: StoreRepository;
  collections: CollectionRepository;
  wishlists: WishlistRepository;
  viewlists: ViewlistRepository;
  auth: AuthRepository;
}
