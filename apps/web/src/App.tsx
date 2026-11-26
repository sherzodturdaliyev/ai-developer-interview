import { Route, Routes } from "react-router-dom";
import { GuestOnly, RequireAuth, RequireRole } from "./auth/guards";
import { AppLayout } from "./layouts/AppLayout";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RegisterPage } from "./pages/RegisterPage";
import { TeamPage } from "./pages/TeamPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="team" element={<RequireRole roles={["OWNER", "ADMIN"]}><TeamPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
