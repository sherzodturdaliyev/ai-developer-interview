export const ROLES = ["OWNER", "ADMIN", "RECRUITER", "REVIEWER"] as const;
export type Role = (typeof ROLES)[number];

export interface CompanyRecord {
  id: string;
  name: string;
  slug: string;
}

export interface UserRecord {
  id: string;
  companyId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface InvitationRecord {
  id: string;
  companyId: string;
  email: string;
  role: Role;
  tokenHash: string;
  invitedById: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Identity attached to an authenticated request. Always loaded from the database. */
export interface AuthContext {
  userId: string;
  companyId: string;
  role: Role;
  email: string;
  name: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

export const toPublicUser = (u: UserRecord): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  isActive: u.isActive,
  createdAt: u.createdAt,
});

export interface PublicInvitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}

export const toPublicInvitation = (i: InvitationRecord): PublicInvitation => ({
  id: i.id,
  email: i.email,
  role: i.role,
  expiresAt: i.expiresAt,
  createdAt: i.createdAt,
});

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Persistence boundary for auth and team management. The Prisma implementation is used
 * in production; tests use an in-memory implementation with the same semantics.
 */
export interface AuthRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  findCompanyById(id: string): Promise<CompanyRecord | null>;
  slugExists(slug: string): Promise<boolean>;
  /** Throws a 409 AppError if the email is already registered. */
  createCompanyWithOwner(input: {
    companyName: string;
    slug: string;
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<{ company: CompanyRecord; user: UserRecord }>;
  listUsers(companyId: string): Promise<UserRecord[]>;
  /** Scoped by company. Returns null when the user does not exist in that company. */
  updateUser(
    companyId: string,
    userId: string,
    patch: { role?: Role; isActive?: boolean },
  ): Promise<UserRecord | null>;

  createRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Atomically revokes an active token. Returns false if it was already revoked. */
  revokeRefreshToken(id: string, at: Date): Promise<boolean>;
  revokeAllRefreshTokens(userId: string, at: Date): Promise<void>;

  createInvitation(input: {
    companyId: string;
    email: string;
    role: Role;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }): Promise<InvitationRecord>;
  findInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  listPendingInvitations(companyId: string, now: Date): Promise<InvitationRecord[]>;
  revokePendingInvitations(companyId: string, email: string, at: Date): Promise<void>;
  /** Returns false if no pending invitation with that id exists in the company. */
  revokeInvitation(companyId: string, invitationId: string, at: Date): Promise<boolean>;
  /**
   * Atomically marks the invitation accepted and creates the user.
   * Returns null if the invitation is no longer pending. Throws 409 if the email is taken.
   */
  acceptInvitation(input: {
    invitationId: string;
    companyId: string;
    email: string;
    name: string;
    role: Role;
    passwordHash: string;
    now: Date;
  }): Promise<UserRecord | null>;
}
