import { Prisma, type PrismaClient } from "@prisma/client";
import { conflict } from "../../lib/errors.js";
import type { AuthRepository, Role } from "./auth.types.js";

const emailTaken = () => conflict("EMAIL_TAKEN", "An account with this email already exists");

/** True when `e` is a unique-constraint violation on `field`. */
function isUniqueViolation(e: unknown, field: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target)];
  return fields.some((f) => f.includes(field));
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly db: PrismaClient) {}

  findUserByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  findUserById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  findCompanyById(id: string) {
    return this.db.company.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
  }

  async slugExists(slug: string) {
    return (await this.db.company.count({ where: { slug } })) > 0;
  }

  async createCompanyWithOwner(input: {
    companyName: string;
    slug: string;
    email: string;
    name: string;
    passwordHash: string;
  }) {
    try {
      return await this.db.$transaction(async (tx) => {
        const company = await tx.company.create({ data: { name: input.companyName, slug: input.slug } });
        const user = await tx.user.create({
          data: {
            companyId: company.id,
            email: input.email,
            name: input.name,
            passwordHash: input.passwordHash,
            role: "OWNER",
          },
        });
        return { company: { id: company.id, name: company.name, slug: company.slug }, user };
      });
    } catch (e) {
      if (isUniqueViolation(e, "email")) throw emailTaken();
      if (isUniqueViolation(e, "slug")) {
        throw conflict("COMPANY_SLUG_TAKEN", "Company name was just taken, please retry");
      }
      throw e;
    }
  }

  listUsers(companyId: string) {
    return this.db.user.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
  }

  async updateUser(companyId: string, userId: string, patch: { role?: Role; isActive?: boolean }) {
    const result = await this.db.user.updateMany({ where: { id: userId, companyId }, data: patch });
    if (result.count === 0) return null;
    return this.db.user.findUnique({ where: { id: userId } });
  }

  async createRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    await this.db.refreshToken.create({ data: input });
  }

  findRefreshToken(tokenHash: string) {
    return this.db.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revokeRefreshToken(id: string, at: Date) {
    const result = await this.db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
    return result.count === 1;
  }

  async revokeAllRefreshTokens(userId: string, at: Date) {
    await this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
  }

  createInvitation(input: {
    companyId: string;
    email: string;
    role: Role;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }) {
    return this.db.invitation.create({ data: input });
  }

  findInvitationByTokenHash(tokenHash: string) {
    return this.db.invitation.findUnique({ where: { tokenHash } });
  }

  listPendingInvitations(companyId: string, now: Date) {
    return this.db.invitation.findMany({
      where: { companyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokePendingInvitations(companyId: string, email: string, at: Date) {
    await this.db.invitation.updateMany({
      where: { companyId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeInvitation(companyId: string, invitationId: string, at: Date) {
    const result = await this.db.invitation.updateMany({
      where: { id: invitationId, companyId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: at },
    });
    return result.count === 1;
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
    try {
      return await this.db.$transaction(async (tx) => {
        const claimed = await tx.invitation.updateMany({
          where: { id: input.invitationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: input.now } },
          data: { acceptedAt: input.now },
        });
        if (claimed.count === 0) return null;
        return tx.user.create({
          data: {
            companyId: input.companyId,
            email: input.email,
            name: input.name,
            passwordHash: input.passwordHash,
            role: input.role,
          },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e, "email")) throw emailTaken();
      throw e;
    }
  }
}
