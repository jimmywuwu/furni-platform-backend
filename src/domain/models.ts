export type ProductStatus = "draft" | "published" | "archived";

export type FeedItem = {
  type: "product";
  id: number;
  name: string;
  image: string | null;
  price: number | null;
};

export type Category = {
  id: number;
  slug: string;
  nameZh: string;
  nameEn: string | null;
  parentId: number | null;
  level: number;
  sortOrder: number;
  isActive: boolean;
};

export type ProductVariant = {
  id: number;
  productId: number;
  variantCode: string;
  color: string | null;
  sizeLabel: string | null;
  material: string | null;
  price: number;
  stock: number;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
};

export type ProductImage = {
  id: number;
  productId: number;
  variantId: number | null;
  imageUrl: string;
  imageType: string | null;
  position: number;
};

export type Product = {
  id: number;
  productCode: string;
  name: string;
  status: ProductStatus;
  brand: string | null;
  category: string | null;
  categorySlug: string | null;
  description: string | null;
  coverImageUrl: string | null;
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
  variants: ProductVariant[];
  images: ProductImage[];
};

export type AdminProductSummary = {
  id: number;
  productCode: string;
  name: string;
  status: ProductStatus;
  coverImageUrl: string | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  stock: number;
  skuCount: number;
  minPrice: number | null;
  primaryVariantId: number | null;
  createdAt: string | null;
};

export type User = {
  id: number;
  displayName: string;
  role: string;
  avatarUrl: string | null;
  email: string | null;
  createdAt: string | null;
};

export type Store = {
  id: number;
  name: string;
  ownerUserId: number | null;
  isActive: boolean;
  createdAt: string | null;
};

export type Collection = {
  id: number;
  ownerId: number;
  storeId: number | null;
  storeName: string | null;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  visibility: string;
  isStoreScene: boolean;
  createdAt: string | null;
};

export type CollectionItem = {
  id: number;
  collectionId: number;
  productId: number;
  variantId: number | null;
  position: number | null;
  note: string | null;
  createdAt: string | null;
};

export type CollectionImage = {
  id: number;
  collectionId: number;
  imageUrl: string;
  caption: string | null;
  createdAt: string | null;
};

export type CollectionComment = {
  id: number;
  collectionId: number;
  userId: number;
  userName: string;
  content: string;
  createdAt: string | null;
};

export type Wishlist = {
  id: number;
  userId: number;
  title: string;
  createdAt: string | null;
};

export type WishlistItem = {
  id: number;
  wishlistId: number;
  productId: number;
  productName: string;
  image: string | null;
  createdAt: string | null;
};

export type Viewlist = {
  id: number;
  userId: number;
  title: string;
  createdAt: string | null;
};

export type ViewlistItem = {
  id: number;
  viewlistId: number;
  variantId: number;
  productId: number;
  productName: string | null;
  quantity: number;
  note: string | null;
  price: number | null;
  createdAt: string | null;
};

export type AuthSession = {
  token: string;
  userId: number;
  displayName: string;
  email: string | null;
  provider: string;
};

export type OAuthIdentity = {
  id: number;
  userId: number;
  provider: string;
  providerUserId: string;
  email: string | null;
};

export type HighlightSection = "latest" | "discount";
