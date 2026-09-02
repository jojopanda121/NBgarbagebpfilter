const apiRoutes = [
  ["/api/auth", "./auth"],
  ["/api/analyze", "./analyze"],
  ["/api/task", "./task"],
  ["/api/quota", "./quota"],
  ["/api/user", "./user"],
  ["/api/verify", "./verify"],
  ["/api/token", "./token"],
  ["/api/admin", "./admin"],
  ["/api/feedback", "./feedback"],
  ["/api/packages", "./packages"],
  ["/api/announcement", "./announcement"],
  ["/api/leaderboard", "./leaderboard"],
  ["/api/projects", "./projects"],
  ["/api/stats", "./stats"],
  ["/api/workspace", "./workspace"],
  ["/api/agents", "./agents"],
  ["/api/workspace-projects", "./workspaceProjects"],
  ["/api/skills", "./skills"],
  ["/api/teaser", "./teaser"],
  ["/api/forum", "./forum"],
  ["/api/llm", "./llm"],
];

function mountApiRoutes(app) {
  for (const [mountPath, routePath] of apiRoutes) {
    app.use(mountPath, require(routePath));
  }
}

module.exports = {
  apiRoutes,
  mountApiRoutes,
};
