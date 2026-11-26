import { randomUUID } from "node:crypto";
import { conflict } from "../../src/lib/errors.js";
import type {
  AuthRepository,
  CompanyRecord,
  InvitationRecord,
  RefreshTokenRecord,
  Role,
  UserRecord,
} from "../../src/modules/auth/auth.types.js";

/** In-memory AuthRepository mirroring the Prisma implementation's semantics. */
export class MemoryAuthRepository implements AuthRepository {
  companies = new Map<string, CompanyRecord>();
  users = new Map<string, UserRecord>();
  refreshTokens = new Map<string, RefreshTokenRecord>();
  invitations = new Map<string, InvitationRecord>();

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }

  async findCompanyById(id: string) {
    return this.companies.get(id) ?? null;
  }

  async slugExists(slug: string) {
    return [...this.companies.values()].some((c) => c.slug === slug);
  }

  async createCompanyWithOwner(input: {
    companyName: string;
    slug: string;
    email: string;
    name: string;
    passwordHash: string;
  }) {
    if (await this.findUserByEmail(input.email)) {
      throw conflict("EMAIL_TAKEN", "An account with this email already exists");
    }
    const company: CompanyRecord = { id: randomUUID(), name: input.companyName, slug: input.slug };
    this.companies.set(company.id, company);
    const user = this.insertUser({ ...input, companyId: company.id, role: "OWNER" });
    return { company, user };
  }

  async listUsers(companyId: string) {
    return [...this.users.values()].filter((u) => u.companyId === companyId);
  }

  async updateUser(companyId: string, userId: string, patch: { role?: Role; isActive?: boolean }) {
    const user = this.users.get(userId);
    if (!user || user.companyId !== companyId) return null;
    const updated: UserRecord = {
      ...user,
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    };
    this.users.set(userId, updated);
    return updated;
  }

  async createRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    const id = randomUUID();
    this.refreshTokens.set(id, { id, ...input, revokedAt: null });
  }

  async findRefreshToken(tokenHash: string) {
    return [...this.refreshTokens.values()].find((t) => t.tokenHash === tokenHash) ?? null;
  }

  async revokeRefreshToken(id: string, at: Date) {
    const token = this.refreshTokens.get(id);
    if (!token || token.revokedAt) return false;
    this.refreshTokens.set(id, { ...token, revokedAt: at });
    return true;
  }

  async revokeAllRefreshTokens(userId: string, at: Date) {
    for (const t of this.refreshTokens.values()) {
      if (t.userId === userId && !t.revokedAt) this.refreshTokens.set(t.id, { ...t, revokedAt: at });
    }
  }

  async createInvitation(input: {
    companyId: string;
    email: string;
    role: Role;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }) {
    const invitation: InvitationRecord = {
      id: randomUUID(),
      ...input,
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  async findInvitationByTokenHash(tokenHash: string) {
    return [...this.invitations.values()].find((i) => i.tokenHash === tokenHash) ?? null;
  }

  private isPending(i: InvitationRecord, now: Date) {
    return !i.acceptedAt && !i.revokedAt && i.expiresAt > now;
  }

  async listPendingInvitations(companyId: string, now: Date) {
    return [...this.invitations.values()].filter((i) => i.companyId === companyId && this.isPending(i, now));
  }

  async revokePendingInvitations(companyId: string, email: string, at: Date) {
    for (const i of this.invitations.values()) {
      if (i.companyId === companyId && i.email === email && !i.acceptedAt && !i.revokedAt) {
        this.invitations.set(i.id, { ...i, revokedAt: at });
      }
    }
  }

  async revokeInvitation(companyId: string, invitationId: string, at: Date) {
    const i = this.invitations.get(invitationId);
    if (!i || i.companyId !== companyId || i.acceptedAt || i.revokedAt) return false;
    this.invitations.set(i.id, { ...i, revokedAt: at });
    return true;
  }

  async acceptInvitation(input: {
    invitationId: string;
    companyId: string;
    email: string;
    name: string;
    role: Role;
    passwordHash: string;
    now: Date;
  }) {
    const i = this.invitations.get(input.invitationId);
    if (!i || !this.isPending(i, input.now)) return null;
    if (await this.findUserByEmail(input.email)) {
      throw conflict("EMAIL_TAKEN", "An account with this email already exists");
    }
    this.invitations.set(i.id, { ...i, acceptedAt: input.now });
    return this.insertUser(input);
  }

  private insertUser(input: {
    companyId: string;
    email: string;
    name: string;
    passwordHash: string;
    role: Role;
  }): UserRecord {
    const user: UserRecord = {
      id: randomUUID(),
      companyId: input.companyId,
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      role: input.role,
      isActive: true,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }
}
