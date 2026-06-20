import React, { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AuthGuard from "../components/AuthGuard";
import AppLayout from "../components/AppLayout";
import LoadingFallback from "../components/LoadingFallback";
import { ForumLayout, forumRoutes, protectedRoutes, publicRoutes } from "./routeConfig";

function renderRoutes(routes) {
  return routes.map(({ path, element }) => (
    <Route key={path} path={path} element={element} />
  ));
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {renderRoutes(publicRoutes)}

        {/* 论坛：公开路由（游客可浏览，软墙由后端控制） */}
        <Route element={<ForumLayout />}>
          {renderRoutes(forumRoutes)}
        </Route>

        <Route
          element={
            <AuthGuard>
              <AppLayout />
            </AuthGuard>
          }
        >
          {renderRoutes(protectedRoutes)}
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
