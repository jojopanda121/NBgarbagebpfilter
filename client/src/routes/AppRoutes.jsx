import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AuthGuard from "../components/AuthGuard";
import AppLayout from "../components/AppLayout";
import LoadingFallback from "../components/LoadingFallback";

const LoginPage = lazy(() => import("../pages/LoginPage"));
const ForgotPasswordPage = lazy(() => import("../pages/ForgotPasswordPage"));
const LandingPage = lazy(() => import("../pages/LandingPage"));
const DashboardPage = lazy(() => import("../pages/DashboardPage"));
const DemoReportPage = lazy(() => import("../pages/DemoReportPage"));
const ReportPage = lazy(() => import("../pages/ReportPage"));
const SettingsPage = lazy(() => import("../pages/SettingsPage"));
const HistoryPage = lazy(() => import("../pages/HistoryPage"));
const AdminPage = lazy(() => import("../pages/AdminPage"));
const LeaderboardPage = lazy(() => import("../pages/LeaderboardPage"));
const ProjectPage = lazy(() => import("../pages/ProjectPage"));
const PlatformStatsPage = lazy(() => import("../pages/PlatformStatsPage"));
const TrackingDashboardPage = lazy(() => import("../pages/TrackingDashboardPage"));
const WorkspaceProjectListPage = lazy(() => import("../pages/WorkspaceProjectListPage"));
const WorkspaceProjectPage = lazy(() => import("../pages/WorkspaceProjectPage"));
const PublicTeaserPage = lazy(() => import("../pages/PublicTeaserPage"));

export default function AppRoutes() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/demo" element={<DemoReportPage />} />
        <Route path="/report/:taskId" element={<ReportPage />} />
        <Route path="/report/s/:shareToken" element={<ReportPage />} />
        <Route path="/project/:taskId" element={<ProjectPage />} />
        <Route path="/teaser/:token" element={<PublicTeaserPage />} />

        <Route
          element={
            <AuthGuard>
              <AppLayout />
            </AuthGuard>
          }
        >
          <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="/app/dashboard" element={<DashboardPage />} />
          <Route path="/app/history" element={<HistoryPage />} />
          <Route path="/app/projects" element={<WorkspaceProjectListPage />} />
          <Route path="/app/projects/:id" element={<WorkspaceProjectPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/app/leaderboard" element={<LeaderboardPage />} />
          <Route path="/app/stats" element={<PlatformStatsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/tracking" element={<TrackingDashboardPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
