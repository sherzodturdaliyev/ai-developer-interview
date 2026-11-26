import { randomToken, sha256 } from "../../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import type { AuthService, Session } from "../auth/auth.service.js";
import {
  normalizeEmail,
  toPublicInvitation,
  toPublicUser,
  type AuthContext,
  type AuthRepository,
  type InvitationRecord,
  type PublicInvitation,
  type PublicUser,
  type Role,
} from "../auth/auth.types.js";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Roles an inviter may assign. OWNER is created only at company registration. */
export type InvitableRole = Exclude<Role, "OWNER">;

const invalidInvitation = () =>
  notFound("INVITATION_INVALID", "This invitation is invalid, expired or already used");

export class TeamService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly auth: AuthService,
    private readonly options: { webOrigin: string },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listMembers(companyId: string): Promise<PublicUser[]> {
    return (await this.repo.listUsers(companyId)).map(toPublicUser);
  }

  async listInvitations(companyId: string): Promise<PublicInvitation[]> {
    return (await this.repo.listPendingInvitations(companyId, this.now())).map(toPublicInvitation);
  }

  /**
   * Creates an invitation and returns a one-time link. Sending it by email is not
   * implemented yet; the inviter shares the link.
   */
  async invite(
    actor: AuthContext,
    input: { email: string; role: InvitableRole },
  ): Promise<{ invitation: PublicInvitation; inviteUrl: string }> {
    if (input.role === "ADMIN" && actor.role !== "OWNER") {
      throw forbidden("ONLY_OWNER_CAN_MANAGE_ADMINS", "Only the owner can invite admins");
    }
    const email = normalizeEmail(input.email);
    if (await this.repo.findUserByEmail(email)) {
      throw conflict("EMAIL_TAKEN", "A user with this email already exists");
    }
    const now = this.now();
    // Re-inviting the same email replaces any earlier pending link.
    await this.repo.revokePendingInvitations(actor.companyId, email, now);

    const token = randomToken();
    const invitation = await this.repo.createInvitation({
      companyId: actor.companyId,
      email,
      role: input.role,
      tokenHash: sha256(token),
      invitedById: actor.userId,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    });
    const inviteUrl = `${this.options.webOrigin}/accept-invite?token=${encodeURIComponent(token)}`;
    return { invitation: toPublicInvitation(invitation), inviteUrl };
  }

  async revokeInvitation(actor: AuthContext, invitationId: string): Promise<void> {
    if (!(await this.repo.revokeInvitation(actor.companyId, invitationId, this.now()))) {
      throw notFound("INVITATION_NOT_FOUND", "Invitation not found");
    }
  }

  /** Public: lets the invite page show who is inviting whom before the user sets a password. */
  async describeInvitation(token: string): Promise<{ email: string; role: Role; companyName: string }> {
    const invitation = await this.findPendingInvitation(token);
    const company = await this.repo.findCompanyById(invitation.companyId);
    if (!company) throw invalidInvitation();
    return { email: invitation.email, role: invitation.role, companyName: company.name };
  }

  async acceptInvitation(input: { token: string; name: string; password: string }): Promise<Session> {
    const invitation = await this.findPendingInvitation(input.token);
    if (await this.repo.findUserByEmail(invitation.email)) {
      throw conflict("EMAIL_TAKEN", "A user with this email already exists");
    }
    const passwordHash = await this.auth.hashPassword(input.password);
    const user = await this.repo.acceptInvitation({
      invitationId: invitation.id,
      companyId: invitation.companyId,
      email: invitation.email,
      name: input.name.trim(),
      role: invitation.role,
      passwordHash,
      now: this.now(),
    });
    if (!user) throw invalidInvitation();
    return this.auth.issueSession(user);
  }

  async updateMember(
    actor: AuthContext,
    memberId: string,
    patch: { role?: InvitableRole; isActive?: boolean },
  ): Promise<PublicUser> {
    if (memberId === actor.userId) {
      throw badRequest("CANNOT_MODIFY_SELF", "You cannot change your own role or status");
    }
    const member = await this.repo.findUserById(memberId);
    if (!member || member.companyId !== actor.companyId) {
      throw notFound("MEMBER_NOT_FOUND", "Team member not found");
    }
    if (member.role === "OWNER") {
      throw forbidden("CANNOT_MODIFY_OWNER", "The owner cannot be modified");
    }
    if ((member.role === "ADMIN" || patch.role === "ADMIN") && actor.role !== "OWNER") {
      throw forbidden("ONLY_OWNER_CAN_MANAGE_ADMINS", "Only the owner can manage admins");
    }
    const updated = await this.repo.updateUser(actor.companyId, memberId, patch);
    if (!updated) throw notFound("MEMBER_NOT_FOUND", "Team member not found");
    if (patch.isActive === false) await this.repo.revokeAllRefreshTokens(memberId, this.now());
    return toPublicUser(updated);
  }

  private async findPendingInvitation(token: string): Promise<InvitationRecord> {
    const invitation = await this.repo.findInvitationByTokenHash(sha256(token));
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= this.now()
    ) {
      throw invalidInvitation();
    }
    return invitation;
  }
}
