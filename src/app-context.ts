import type { RepositoryFactory } from "./domain/ports";
import { createD1Repositories } from "./infrastructure/d1/repositories";
import { AdminProductService } from "./services/admin-product-service";
import { AuthService } from "./services/auth-service";
import { CatalogService } from "./services/catalog-service";
import { CollectionService } from "./services/collection-service";
import { ListService } from "./services/list-service";

export function createAppContext(db: D1Database) {
  const repositories: RepositoryFactory = createD1Repositories(db);

  return {
    repositories,
    services: {
      catalog: new CatalogService(repositories.catalog),
      adminProducts: new AdminProductService(
        repositories.users,
        repositories.adminProducts,
      ),
      lists: new ListService(
        repositories.users,
        repositories.catalog,
        repositories.wishlists,
        repositories.viewlists,
      ),
      collections: new CollectionService(
        repositories.users,
        repositories.stores,
        repositories.catalog,
        repositories.collections,
      ),
      auth: new AuthService(
        repositories.users,
        repositories.auth,
        repositories.wishlists,
        repositories.viewlists,
      ),
    },
  };
}
