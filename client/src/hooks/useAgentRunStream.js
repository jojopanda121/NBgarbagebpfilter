import { useEffect, useRef, useState, useCallback } from "react";
import useAuthStore from "../store/useAuthStore";
import { API_BASE } from "../constants";

const AGENT_NAMES = [
  "project_summary",
  "founder",
  "financial",
  "competitor",
  "valuation",
  "red_flag",
];

const INITIAL_AGENTS = Object.fromEntries(
  AGENT_NAMES.map((name) => [name, { status: "pending", userOutput: null, error: null }])
);

/**
 * Subscribe to a live agent run via SSE.
 *
 * @param {string|null} runId — the run UUID returned by the backend
 * @returns {{ agents, finished, connected }}
 *   agents: Record<agentName, { status, userOutput, error }>
 *   finished: boolean — true when run_finished event is received
 *   connected: boolean
 */
export function useAgentRunStream(runId) {
  const [agents, setAgents] = useState(INITIAL_AGENTS);
  const [finished, setFinished] = useState(false);
  const [connected, setConnected] = useState(false);
  const abortRef = useRef(null);

  const reset = useCallback(() => {
    setAgents(INITIAL_AGENTS);
    setFinished(false);
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!runId) return;

    reset();

    let cancelled = false;
    const ac = new AbortController();
    abortRef.current = ac;

    async function connect() {
      const token = useAuthStore.getState().token;
      const resp = await fetch(`${API_BASE}/api/agents/run/${runId}/stream`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: ac.signal,
      });
      if (!resp.ok) throw new Error(`SSE failed (${resp.status})`);
      if (!resp.body) throw new Error("SSE stream unavailable");
      if (!cancelled) setConnected(true);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = parseSseData(chunk);
          if (!data) continue;

          if (data.type === "agent_update") {
            const { agent, status, userOutput, error } = data;
            if (!AGENT_NAMES.includes(agent)) continue;
            setAgents((prev) => ({
              ...prev,
              [agent]: { status, userOutput: userOutput ?? prev[agent]?.userOutput ?? null, error: error ?? null },
            }));
          } else if (data.type === "run_finished") {
            setFinished(true);
            ac.abort();
            return;
          }
        }
      }
    }

    connect().catch((err) => {
      if (cancelled || err.name === "AbortError") return;
      setConnected(false);
    });

    return () => {
      cancelled = true;
      ac.abort();
      abortRef.current = null;
    };
  }, [runId, reset]);

  return { agents, finished, connected };
}

function parseSseData(chunk) {
  const dataLines = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (!dataLines.length) return null;
  try { return JSON.parse(dataLines.join("\n")); } catch { return null; }
}
