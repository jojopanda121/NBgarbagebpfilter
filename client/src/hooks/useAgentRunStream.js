import { useEffect, useRef, useState, useCallback } from "react";

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
  const esRef = useRef(null);

  const reset = useCallback(() => {
    setAgents(INITIAL_AGENTS);
    setFinished(false);
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!runId) return;

    reset();

    const es = new EventSource(`/api/agents/run/${runId}/stream`, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (evt) => {
      let data;
      try { data = JSON.parse(evt.data); } catch { return; }

      if (data.type === "agent_update") {
        const { agent, status, userOutput, error } = data;
        if (!AGENT_NAMES.includes(agent)) return;
        setAgents((prev) => ({
          ...prev,
          [agent]: { status, userOutput: userOutput ?? prev[agent]?.userOutput ?? null, error: error ?? null },
        }));
      } else if (data.type === "run_finished") {
        setFinished(true);
        es.close();
      }
    };

    es.onerror = () => {
      setConnected(false);
      // Don't close — browser will auto-reconnect unless we do
      // If run is already finished, close to avoid reconnect loop
      if (finished) es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { agents, finished, connected };
}
