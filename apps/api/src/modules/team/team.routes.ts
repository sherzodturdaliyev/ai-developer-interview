import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseInput } from "../../lib/http.js";
import { getAuth } from "../../middleware/auth.js";
import {
  emailSchema,
  newPasswordSchema,
  sessionBody,
  setSessionCookie,
  type CookieSettings,
} from "../auth/auth.routes.js";
import type { TeamService } from "./team.service.js";

const invitableRole = z.enum(["ADMIN", "RECRUITER", "REVIEWER"]);
const idParam = z.object({ id: z.string().min(1).max(64) });

const inviteBody = z.object({ email: emailSchema, role: invitableRole });

const updateMemberBody = z
  .object({ role: invitableRole.optional(), isActive: z.boolean().optional() })
  .refine((b) => b.role !== undefined || b.isActive !== undefined, {
    message: "Provide role or isActive",
  });

const tokenParam = z.object({ token: z.string().min(16).max(128) });
const acceptBody = z.object({
  token: z.string().min(16).max(128),
  name: z.string().trim().min(1).max(100),
  password: newPasswordSchema,
});

/** Mounted behind requireAuth + requireRole("OWNER", "ADMIN"). */
export function teamRouter(team: TeamService): Router {
  const router = Router();

  router.get(
    "/members",
    asyncHandler(async (req, res) => {
      res.json({ members: await team.listMembers(getAuth(req).companyId) });
    }),
  );

  router.patch(
    "/members/:id",
    asyncHandler(async (req, res) => {
      const { id } = parseInput(idParam, req.params);
      const body = parseInput(updateMemberBody, req.body);
      res.json({ member: await team.updateMember(getAuth(req), id, body) });
    }),
  );

  router.get(
    "/invitations",
    asyncHandler(async (req, res) => {
      res.json({ invitations: await team.listInvitations(getAuth(req).companyId) });
    }),
  );

  router.post(
    "/invitations",
    asyncHandler(async (req, res) => {
      const body = parseInput(inviteBody, req.body);
      res.status(201).json(await team.invite(getAuth(req), body));
    }),
  );

  router.delete(
    "/invitations/:id",
    asyncHandler(async (req, res) => {
      const { id } = parseInput(idParam, req.params);
      await team.revokeInvitation(getAuth(req), id);
      res.status(204).end();
    }),
  );

  return router;
}

/** Public endpoints used by the invite acceptance page. */
export function invitationsRouter(team: TeamService, cookie: CookieSettings): Router {
  const router = Router();

  router.get(
    "/:token",
    asyncHandler(async (req, res) => {
      const { token } = parseInput(tokenParam, req.params);
      res.json({ invitation: await team.describeInvitation(token) });
    }),
  );

  router.post(
    "/accept",
    asyncHandler(async (req, res) => {
      const body = parseInput(acceptBody, req.body);
      const session = await team.acceptInvitation(body);
      setSessionCookie(res, session, cookie);
      res.status(201).json(sessionBody(session));
    }),
  );

  return router;
}
