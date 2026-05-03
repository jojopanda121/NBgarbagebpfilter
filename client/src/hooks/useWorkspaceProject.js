import { useEffect, useState, useCallback } from "react";
import workspaceProjectApi from "../services/workspaceProjectApi";

export function useWorkspaceProject(id) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await workspaceProjectApi.getById(id);
      setProject(data);
      setError(null);
    } catch (e) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { project, loading, error, refresh };
}

export function useWorkspaceProjectList(filter = {}) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const filterKey = JSON.stringify(filter);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await workspaceProjectApi.list(JSON.parse(filterKey));
      setProjects(data.projects || []);
      setError(null);
    } catch (e) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filterKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { projects, loading, error, refresh };
}
