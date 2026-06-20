import React, { lazy } from "react";
import { Navigate } from "react-router-dom";

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
export const ForumLayout = lazy(() => import("../pages/Forum/ForumLayout"));
const ForumListPage = lazy(() => import("../pages/Forum/ForumListPage"));
const ForumPostPage = lazy(() => import("../pages/Forum/ForumPostPage"));
const ForumProfilePage = lazy(() => import("../pages/Forum/ForumProfilePage"));
const MessagesPage = lazy(() => import("../pages/Forum/MessagesPage"));
const AboutPage = lazy(() => import("../pages/AboutPage"));
const PrivacyPage = lazy(() => import("../pages/PrivacyPage"));
const TermsPage = lazy(() => import("../pages/TermsPage"));

const route = (path, element) => ({ path, element });

export const publicRoutes = [
  route("/", <LandingPage />),
  route("/login", <LoginPage />),
  route("/forgot-password", <ForgotPasswordPage />),
  route("/demo", <DemoReportPage />),
  route("/about", <AboutPage />),
  route("/privacy", <PrivacyPage />),
  route("/terms", <TermsPage />),
  route("/report/:taskId", <ReportPage />),
  route("/report/s/:shareToken", <ReportPage />),
  route("/project/:taskId", <ProjectPage />),
  route("/teaser/:token", <PublicTeaserPage />),
];

export const forumRoutes = [
  route("/forum", <ForumListPage />),
  route("/forum/post/:id", <ForumPostPage />),
  route("/forum/me", <ForumProfilePage />),
  route("/forum/u/:id", <ForumProfilePage />),
  route("/forum/messages", <MessagesPage />),
];

export const protectedRoutes = [
  route("/app", <Navigate to="/app/dashboard" replace />),
  route("/app/dashboard", <DashboardPage />),
  route("/app/history", <HistoryPage />),
  route("/app/projects", <WorkspaceProjectListPage />),
  route("/app/projects/:id", <WorkspaceProjectPage />),
  route("/settings", <SettingsPage />),
  route("/app/leaderboard", <LeaderboardPage />),
  route("/app/stats", <PlatformStatsPage />),
  route("/admin", <AdminPage />),
  route("/admin/tracking", <TrackingDashboardPage />),
];
