export type Role = "OWNER" | "ADMIN" | "RECRUITER" | "REVIEWER";
export type InvitableRole = Exclude<Role, "OWNER">;

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
}

export interface SessionResponse {
  accessToken: string;
  user: User;
  company: Company;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationPreview {
  email: string;
  role: Role;
  companyName: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  RECRUITER: "Recruiter",
  REVIEWER: "Reviewer",
};

export const ROLE_DESCRIPTIONS: Record<InvitableRole, string> = {
  ADMIN: "Manages the team and company settings",
  RECRUITER: "Manages candidates and interviews",
  REVIEWER: "Reviews AI evaluations and writes final decisions",
};

export const canManageTeam = (role: Role | undefined): boolean => role === "OWNER" || role === "ADMIN";
