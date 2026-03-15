import type { AuthRepository, UserRepository, WishlistRepository, ViewlistRepository } from "../domain/ports";

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly auth: AuthRepository,
    private readonly wishlists: WishlistRepository,
    private readonly viewlists: ViewlistRepository,
  ) {}

  private async ensureDefaults(userId: number) {
    await this.wishlists.getOrCreateDefault(userId);
    await this.viewlists.getOrCreateDefault(userId);
  }

  private async createSession(userId: number, provider: string) {
    const user = await this.users.getById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    const token = generateToken();
    await this.auth.createSession(userId, token, provider);
    return {
      token,
      user_id: user.id,
      display_name: user.displayName,
      email: user.email,
    };
  }

  async login(displayName: string, email: string | null) {
    let user = await this.users.findByDisplayNameAndEmail(displayName, email);
    if (!user) {
      user = await this.users.create(displayName, email);
    }
    await this.ensureDefaults(user.id);
    return this.createSession(user.id, "local");
  }

  async getSession(token: string) {
    return this.auth.findSession(token);
  }

  async logout(token: string) {
    await this.auth.deleteSession(token);
    return { ok: true };
  }

  async loginViaSimpleProvider(provider: "line", displayName: string, email: string | null) {
    let user = await this.users.findByDisplayNameAndEmail(displayName, email);
    if (!user) {
      user = await this.users.create(displayName, email);
    }
    await this.ensureDefaults(user.id);
    return this.createSession(user.id, provider);
  }

  async loginViaOAuth(provider: "line" | "google", providerUserId: string, displayName: string, email: string | null) {
    const identity = await this.auth.findOAuthIdentity(provider, providerUserId);
    if (identity) {
      const user = await this.users.getById(identity.userId);
      if (!user) {
        throw new Error("Linked user not found");
      }
      if (displayName && user.displayName !== displayName) {
        await this.users.updateProfile(user.id, { displayName });
      }
      if (email && user.email !== email) {
        await this.users.updateProfile(user.id, { email });
        await this.auth.updateOAuthIdentityEmail(identity.id, email);
      }
      await this.ensureDefaults(user.id);
      return this.createSession(user.id, provider);
    }

    let user = email ? await this.users.findByEmail(email) : null;
    if (!user) {
      user = await this.users.create(displayName, email);
    }
    await this.ensureDefaults(user.id);
    await this.auth.createOAuthIdentity(user.id, provider, providerUserId, email);
    return this.createSession(user.id, provider);
  }
}
