import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp, refreshCookieFrom, registerOwner } from "./helpers/test-app.js";

type App = ReturnType<typeof buildTestApp>["app"];

const tokenFromUrl = (url: string) => new URL(url).searchParams.get("token")!;

async function inviteAndAccept(app: App, inviterToken: string, email: string, role: string) {
  const invite = await request(app)
    .post("/api/team/invitations")
    .set("Authorization", `Bearer ${inviterToken}`)
    .send({ email, role });
  if (invite.status !== 201) throw new Error(`invite failed: ${invite.status} ${JSON.stringify(invite.body)}`);
  const accept = await request(app)
    .post("/api/invitations/accept")
    .send({ token: tokenFromUrl(invite.body.inviteUrl), name: `${role} user`, password: "member-password-123" });
  if (accept.status !== 201) throw new Error(`accept failed: ${accept.status} ${JSON.stringify(accept.body)}`);
  return { accessToken: accept.body.accessToken as string, userId: accept.body.user.id as string };
}

describe("team invitations", () => {
  it("owner invites a recruiter who accepts and joins the same company", async () => {
    const { app } = buildTestApp();
    const ownerSession = await registerOwner(app);

    const invite = await request(app)
      .post("/api/team/invitations")
      .set("Authorization", `Bearer ${ownerSession.accessToken}`)
      .send({ email: "Rita@Acme.test", role: "RECRUITER" });
    expect(invite.status).toBe(201);
    expect(invite.body.invitation).toMatchObject({ email: "rita@acme.test", role: "RECRUITER" });
    expect(invite.body.inviteUrl).toMatch(/^http:\/\/localhost:5173\/accept-invite\?token=/);
    expect(invite.body.invitation.tokenHash).toBeUndefined();

    const token = tokenFromUrl(invite.body.inviteUrl);
    const describe_ = await request(app).get(`/api/invitations/${token}`);
    expect(describe_.status).toBe(200);
    expect(describe_.body.invitation).toEqual({
      email: "rita@acme.test",
      role: "RECRUITER",
      companyName: "Acme Software",
    });

    const accept = await request(app)
      .post("/api/invitations/accept")
      .send({ token, name: "Rita Recruiter", password: "member-password-123" });
    expect(accept.status).toBe(201);
    expect(accept.body.user).toMatchObject({ email: "rita@acme.test", role: "RECRUITER" });
    expect(accept.body.company.id).toBe(ownerSession.body.company.id);
    expect(refreshCookieFrom(accept)).toBeDefined();

    // Single use.
    const again = await request(app)
      .post("/api/invitations/accept")
      .send({ token, name: "Rita", password: "member-password-123" });
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe("INVITATION_INVALID");

    const members = await request(app)
      .get("/api/team/members")
      .set("Authorization", `Bearer ${ownerSession.accessToken}`);
    expect(members.body.members).toHaveLength(2);
  });

  it("re-inviting the same email revokes the earlier link", async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerOwner(app);
    const send = () =>
      request(app)
        .post("/api/team/invitations")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ email: "rev@acme.test", role: "REVIEWER" });

    const first = await send();
    const second = await send();
    expect((await request(app).get(`/api/invitations/${tokenFromUrl(first.body.inviteUrl)}`)).status).toBe(404);
    expect((await request(app).get(`/api/invitations/${tokenFromUrl(second.body.inviteUrl)}`)).status).toBe(200);

    const list = await request(app).get("/api/team/invitations").set("Authorization", `Bearer ${accessToken}`);
    expect(list.body.invitations).toHaveLength(1);
  });

  it("revoked and expired invitations cannot be accepted", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { app } = buildTestApp({}, () => now);
    const { accessToken } = await registerOwner(app);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const revoked = await request(app).post("/api/team/invitations").set(auth).send({ email: "a@acme.test", role: "REVIEWER" });
    expect((await request(app).delete(`/api/team/invitations/${revoked.body.invitation.id}`).set(auth)).status).toBe(204);
    const acceptRevoked = await request(app)
      .post("/api/invitations/accept")
      .send({ token: tokenFromUrl(revoked.body.inviteUrl), name: "A", password: "member-password-123" });
    expect(acceptRevoked.status).toBe(404);

    const expiring = await request(app).post("/api/team/invitations").set(auth).send({ email: "b@acme.test", role: "REVIEWER" });
    now = new Date("2026-01-09T00:00:00Z"); // past the 7-day lifetime
    const acceptExpired = await request(app)
      .post("/api/invitations/accept")
      .send({ token: tokenFromUrl(expiring.body.inviteUrl), name: "B", password: "member-password-123" });
    expect(acceptExpired.status).toBe(404);
  });

  it("rejects inviting an email that already has an account", async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerOwner(app);
    const res = await request(app)
      .post("/api/team/invitations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: "olivia@acme.test", role: "RECRUITER" });
    expect(res.status).toBe(409);
  });

  it("does not allow inviting an OWNER", async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerOwner(app);
    const res = await request(app)
      .post("/api/team/invitations")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: "x@acme.test", role: "OWNER" });
    expect(res.status).toBe(400);
  });
});

describe("team authorization", () => {
  it("recruiters and reviewers cannot access team management", async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerOwner(app);
    const recruiter = await inviteAndAccept(app, accessToken, "r@acme.test", "RECRUITER");
    const reviewer = await inviteAndAccept(app, accessToken, "v@acme.test", "REVIEWER");

    for (const token of [recruiter.accessToken, reviewer.accessToken]) {
      const res = await request(app).get("/api/team/members").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INSUFFICIENT_ROLE");
    }
  });

  it("admins can invite recruiters but not admins, and cannot modify other admins", async () => {
    const { app } = buildTestApp();
    const { accessToken: ownerToken } = await registerOwner(app);
    const admin = await inviteAndAccept(app, ownerToken, "admin@acme.test", "ADMIN");
    const otherAdmin = await inviteAndAccept(app, ownerToken, "admin2@acme.test", "ADMIN");
    const adminAuth = { Authorization: `Bearer ${admin.accessToken}` };

    expect(
      (await request(app).post("/api/team/invitations").set(adminAuth).send({ email: "r@acme.test", role: "RECRUITER" })).status,
    ).toBe(201);

    const inviteAdmin = await request(app)
      .post("/api/team/invitations")
      .set(adminAuth)
      .send({ email: "a3@acme.test", role: "ADMIN" });
    expect(inviteAdmin.status).toBe(403);
    expect(inviteAdmin.body.error.code).toBe("ONLY_OWNER_CAN_MANAGE_ADMINS");

    const demote = await request(app)
      .patch(`/api/team/members/${otherAdmin.userId}`)
      .set(adminAuth)
      .send({ role: "REVIEWER" });
    expect(demote.status).toBe(403);
  });

  it("owner can change roles; changes apply to existing access tokens immediately", async () => {
    const { app } = buildTestApp();
    const { accessToken: ownerToken } = await registerOwner(app);
    const admin = await inviteAndAccept(app, ownerToken, "admin@acme.test", "ADMIN");

    expect((await request(app).get("/api/team/members").set("Authorization", `Bearer ${admin.accessToken}`)).status).toBe(200);

    const demote = await request(app)
      .patch(`/api/team/members/${admin.userId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "REVIEWER" });
    expect(demote.status).toBe(200);
    expect(demote.body.member.role).toBe("REVIEWER");

    expect((await request(app).get("/api/team/members").set("Authorization", `Bearer ${admin.accessToken}`)).status).toBe(403);
  });

  it("deactivating a member blocks their access token and revokes their sessions", async () => {
    const { app } = buildTestApp();
    const { accessToken: ownerToken } = await registerOwner(app);
    const invite = await request(app)
      .post("/api/team/invitations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "r@acme.test", role: "RECRUITER" });
    const accept = await request(app)
      .post("/api/invitations/accept")
      .send({ token: tokenFromUrl(invite.body.inviteUrl), name: "R", password: "member-password-123" });
    const memberCookie = refreshCookieFrom(accept)!;

    const deactivate = await request(app)
      .patch(`/api/team/members/${accept.body.user.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);

    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accept.body.accessToken}`)).status).toBe(401);
    expect((await request(app).post("/api/auth/refresh").set("Cookie", memberCookie)).status).toBe(401);
    expect(
      (await request(app).post("/api/auth/login").send({ email: "r@acme.test", password: "member-password-123" })).status,
    ).toBe(401);
  });

  it("cannot modify yourself, the owner, or members of another company", async () => {
    const { app } = buildTestApp();
    const ownerA = await registerOwner(app);
    const ownerB = await request(app)
      .post("/api/auth/register")
      .send({ companyName: "Beta", name: "Bob", email: "bob@beta.test", password: "correct-horse-battery" });
    const admin = await inviteAndAccept(app, ownerA.accessToken, "admin@acme.test", "ADMIN");

    const self = await request(app)
      .patch(`/api/team/members/${admin.userId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(self.status).toBe(400);

    const ownerTarget = await request(app)
      .patch(`/api/team/members/${ownerA.body.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(ownerTarget.status).toBe(403);

    const crossTenant = await request(app)
      .patch(`/api/team/members/${admin.userId}`)
      .set("Authorization", `Bearer ${ownerB.body.accessToken}`)
      .send({ isActive: false });
    expect(crossTenant.status).toBe(404);

    const listB = await request(app).get("/api/team/members").set("Authorization", `Bearer ${ownerB.body.accessToken}`);
    expect(listB.body.members.map((m: { email: string }) => m.email)).toEqual(["bob@beta.test"]);
  });
});
