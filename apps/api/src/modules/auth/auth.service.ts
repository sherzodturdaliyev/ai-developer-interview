import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomHex, randomToken, sha256 } from "../../lib/crypto.js";
import { conflict, unauthorized } from "../../lib/errors.js";
import {
  normalizeEmail,
  toPublicUser,
  type AuthContext,
  type AuthRepository,
  type CompanyRecord,
  type PublicUser,
  type UserRecord,
} from "./auth.types.js";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const accessTokenPayload = z.object({
  sub: z.string().min(1),
  cid: z.string().min(1),
  typ: z.literal("access"),
});

export interface AuthConfig {
  jwtAccessSecret: string;
  bcryptRounds: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
  company: CompanyRecord;
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export class AuthService {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly repo: AuthRepository,
    private readonly config: AuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.config.bcryptRounds);
  }

  async register(input: {
    companyName: string;
    name: string;
    email: string;
    password: string;
  }): Promise<Session> {
    const email = normalizeEmail(input.email);
    if (await this.repo.findUserByEmail(email)) {
      throw conflict("EMAIL_TAKEN", "An account with this email already exists");
    }
    const passwordHash = await this.hashPassword(input.password);
    const slug = await this.uniqueSlug(input.companyName);
    const { user } = await this.repo.createCompanyWithOwner({
      companyName: input.companyName.trim(),
      slug,
      email,
      name: input.name.trim(),
      passwordHash,
    });
    return this.issueSession(user);
  }

  async login(emailInput: string, password: string): Promise<Session> {
    const user = await this.repo.findUserByEmail(normalizeEmail(emailInput));
    // Compare against a dummy hash for unknown emails so response time does not reveal
    // which addresses have accounts.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const matches = await bcrypt.compare(password, hash);
    if (!user || !matches || !user.isActive) {
      throw unauthorized("INVALID_CREDENTIALS", "Invalid email or password");
    }
    return this.issueSession(user);
  }

  /** Rotates the refresh token. Reusing a rotated token revokes every session of that user. */
  async refresh(rawToken: string | undefined): Promise<Session> {
    if (!rawToken) throw unauthorized("MISSING_REFRESH_TOKEN", "No session, please sign in");
    const now = this.now();
    const record = await this.repo.findRefreshToken(sha256(rawToken));
    if (!record) throw unauthorized("INVALID_REFRESH_TOKEN", "Session expired, please sign in again");

    if (record.revokedAt) {
      await this.repo.revokeAllRefreshTokens(record.userId, now);
      throw unauthorized("REFRESH_TOKEN_REUSED", "Session was revoked, please sign in again");
    }
    if (record.expiresAt <= now) {
      await this.repo.revokeRefreshToken(record.id, now);
      throw unauthorized("INVALID_REFRESH_TOKEN", "Session expired, please sign in again");
    }
    // Conditional revoke: if two requests race with the same token, only one wins.
    if (!(await this.repo.revokeRefreshToken(record.id, now))) {
      await this.repo.revokeAllRefreshTokens(record.userId, now);
      throw unauthorized("REFRESH_TOKEN_REUSED", "Session was revoked, please sign in again");
    }
    const user = await this.repo.findUserById(record.userId);
    if (!user || !user.isActive) {
      throw unauthorized("INVALID_REFRESH_TOKEN", "Session expired, please sign in again");
    }
    return this.issueSession(user);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const record = await this.repo.findRefreshToken(sha256(rawToken));
    if (record && !record.revokedAt) await this.repo.revokeRefreshToken(record.id, this.now());
  }

  /** Verifies the JWT and reloads the user, so deactivation and role changes apply immediately. */
  async authenticate(accessToken: string): Promise<AuthContext> {
    let payload: z.infer<typeof accessTokenPayload>;
    try {
      payload = accessTokenPayload.parse(
        jwt.verify(accessToken, this.config.jwtAccessSecret, { algorithms: ["HS256"] }),
      );
    } catch {
      throw unauthorized("INVALID_TOKEN", "Invalid or expired access token");
    }
    const user = await this.repo.findUserById(payload.sub);
    if (!user || !user.isActive || user.companyId !== payload.cid) {
      throw unauthorized("INVALID_TOKEN", "Invalid or expired access token");
    }
    return {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      email: user.email,
      name: user.name,
    };
  }

  async issueSession(user: UserRecord): Promise<Session> {
    const company = await this.repo.findCompanyById(user.companyId);
    if (!company) throw unauthorized("INVALID_TOKEN", "Company no longer exists");

    const accessToken = jwt.sign({ cid: user.companyId, typ: "access" }, this.config.jwtAccessSecret, {
      algorithm: "HS256",
      subject: user.id,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(this.now().getTime() + REFRESH_TOKEN_TTL_MS);
    await this.repo.createRefreshToken({
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: refreshExpiresAt,
    });
    return { accessToken, refreshToken, refreshExpiresAt, user: toPublicUser(user), company };
  }

  private getDummyHash(): Promise<string> {
    return (this.dummyHash ??= bcrypt.hash(randomToken(), this.config.bcryptRounds));
  }

  private async uniqueSlug(companyName: string): Promise<string> {
    const base = slugify(companyName) || "company";
    if (!(await this.repo.slugExists(base))) return base;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `${base}-${randomHex(3)}`;
      if (!(await this.repo.slugExists(candidate))) return candidate;
    }
    return `${base}-${randomHex(8)}`;
  }
}
