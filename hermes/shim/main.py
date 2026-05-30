"""
NB-Hermes Shim — 北京 NBgarbagebpfilter ↔ 新加坡 Hermes 桥。

对北京暴露 OpenAI Responses 兼容协议：
  GET  /health
  POST /v1/responses   (stream=true → SSE, stream=false → JSON)

内部以 subprocess 调本机 `hermes -z PROMPT --resume <session_id>`。

会话延续策略
─────────────
Hermes session_id 是它自动生成的（格式 YYYYMMDD_HHMMSS_hash），
我们没法预先指定。所以：
  1. shim 自己维护 conversation_id → session_id 映射，落盘到 state.json
  2. 第一次见到某 conversation：跑 `hermes -z`（无 --resume），跑完看
     ~/.hermes/sessions/ 里最新的文件是哪个，存下来作为该 conv 的 session_id
  3. 之后每次：跑 `hermes -z --resume <session_id>`，复用上次的对话历史

并发控制
─────────────
  - 每个 conversation_id 一把 asyncio.Lock：同一 conv 的请求串行
  - 全局一把 asyncio.Lock：仅在"创建新 session 并探测 id"阶段持有，
    避免两条不同 conv 并行创建时把 session id 张冠李戴
"""
import asyncio
import json
import logging
import os
import secrets
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ── config ──────────────────────────────────────────
API_KEY = os.environ.get("SHIM_API_KEY", "").strip()
HERMES_BIN = os.environ.get("HERMES_BIN", "/home/ubuntu/.local/bin/hermes")
HERMES_TIMEOUT = int(os.environ.get("HERMES_TIMEOUT_SECONDS", "180"))
DEFAULT_MODEL_LABEL = os.environ.get("HERMES_MODEL_LABEL", "hermes-agent")
HERMES_SESSIONS_DIR = Path(
    os.environ.get("HERMES_SESSIONS_DIR", "/home/ubuntu/.hermes/sessions")
)
STATE_PATH = Path(
    os.environ.get("SHIM_STATE_PATH", "/home/ubuntu/nb-hermes-shim/state.json")
)

if not API_KEY:
    raise SystemExit("FATAL: SHIM_API_KEY 环境变量必填")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("shim")

app = FastAPI(title="NB-Hermes Shim", version="0.2.0")


# ── auth ────────────────────────────────────────────
def check_auth(authorization: Optional[str]) -> None:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.split(None, 1)[1].strip()
    if not secrets.compare_digest(token, API_KEY):
        raise HTTPException(401, "invalid token")


# ── session map state ───────────────────────────────
_session_map: dict[str, str] = {}
_state_lock = asyncio.Lock()
_new_session_lock = asyncio.Lock()
_conv_locks: dict[str, asyncio.Lock] = {}


def load_state() -> None:
    global _session_map
    if STATE_PATH.exists():
        try:
            _session_map = json.loads(STATE_PATH.read_text())
            log.info("loaded %d session mappings from %s",
                     len(_session_map), STATE_PATH)
        except Exception as e:
            log.warning("state load failed: %s", e)
            _session_map = {}


async def save_state() -> None:
    # 调用前应已持 _state_lock
    tmp = STATE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(_session_map, ensure_ascii=False, indent=2))
    tmp.replace(STATE_PATH)


def get_conv_lock(conv_id: str) -> asyncio.Lock:
    lock = _conv_locks.get(conv_id)
    if lock is None:
        lock = asyncio.Lock()
        _conv_locks[conv_id] = lock
    return lock


def newest_session_id() -> Optional[str]:
    """读 ~/.hermes/sessions/ 里 mtime 最新的 session_*.json 文件名解析出 ID。"""
    try:
        files = sorted(
            HERMES_SESSIONS_DIR.glob("session_*.json"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        if not files:
            return None
        stem = files[0].stem  # session_20260530_111839_85a937
        if stem.startswith("session_"):
            return stem[len("session_"):]
        return stem
    except Exception as e:
        log.warning("newest_session_id failed: %s", e)
        return None


# ── hermes call ─────────────────────────────────────
async def run_hermes_raw(prompt: str, resume_id: Optional[str]) -> str:
    args = [HERMES_BIN, "-z", prompt]
    if resume_id:
        args += ["--resume", resume_id]
    log.info(
        "hermes call resume=%s prompt_len=%d",
        resume_id or "(new)",
        len(prompt),
    )
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, "HERMES_ACCEPT_HOOKS": "1"},
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=HERMES_TIMEOUT
        )
    except asyncio.TimeoutError:
        proc.kill()
        raise HTTPException(504, "hermes timeout")
    if proc.returncode != 0:
        msg = (stderr or b"").decode("utf-8", "replace")[:500]
        log.warning("hermes exit %d: %s", proc.returncode, msg)
        raise HTTPException(502, f"hermes exit {proc.returncode}: {msg}")
    return (stdout or b"").decode("utf-8", "replace").rstrip()


async def call_hermes(prompt: str, conv_id: Optional[str]) -> tuple[str, Optional[str]]:
    """返回 (text, session_id)。无 conv_id 时不维护 session。"""
    if not conv_id:
        text = await run_hermes_raw(prompt, resume_id=None)
        return text, None

    conv_lock = get_conv_lock(conv_id)
    async with conv_lock:
        existing = _session_map.get(conv_id)
        if existing:
            text = await run_hermes_raw(prompt, resume_id=existing)
            return text, existing

        # 第一次见这个 conv，全局锁内创建 + 探测
        async with _new_session_lock:
            text = await run_hermes_raw(prompt, resume_id=None)
            new_id = newest_session_id()
            if new_id:
                async with _state_lock:
                    _session_map[conv_id] = new_id
                    await save_state()
                log.info("conv=%s → session=%s", conv_id, new_id)
            else:
                log.warning("conv=%s: 没探测到新 session_id", conv_id)
            return text, new_id


# ── endpoints ───────────────────────────────────────
@app.on_event("startup")
async def _startup() -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    load_state()


@app.get("/health")
async def health(authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    return {
        "ok": True,
        "service": "nb-hermes-shim",
        "version": "0.2.0",
        "tracked_conversations": len(_session_map),
        "ts": int(time.time()),
    }


class ResponsesBody(BaseModel):
    model: Optional[str] = None
    input: str
    stream: bool = False
    store: bool = True
    conversation: Optional[str] = None
    instructions: Optional[str] = None
    response_format: Optional[Any] = None


def sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


@app.post("/v1/responses")
async def responses(
    body: ResponsesBody,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    check_auth(authorization)
    prompt = (
        f"{body.instructions}\n\n{body.input}"
        if body.instructions
        else body.input
    )
    response_id = f"resp_{uuid.uuid4().hex[:24]}"

    if not body.stream:
        text, session_id = await call_hermes(prompt, body.conversation)
        return {
            "id": response_id,
            "object": "response",
            "created_at": int(time.time()),
            "status": "completed",
            "model": body.model or DEFAULT_MODEL_LABEL,
            "session_id": session_id,
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": text}],
                }
            ],
            "output_text": text,
        }

    async def stream_gen():
        yield sse("response.created", {"response": {"id": response_id}})
        await asyncio.sleep(0)
        try:
            text, _ = await call_hermes(prompt, body.conversation)
        except HTTPException as e:
            yield sse("response.error", {"error": {"message": str(e.detail)}})
            return
        if text:
            yield sse(
                "response.output_text.delta",
                {"delta": text, "response_id": response_id},
            )
        yield sse("response.completed", {"response": {"id": response_id}})

    return StreamingResponse(
        stream_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.delete("/v1/sessions/{conversation_id}")
async def forget_session(
    conversation_id: str,
    authorization: Optional[str] = Header(None),
):
    """北京端要"重置 workspace 对话"时调这个，下次会创建新 session。"""
    check_auth(authorization)
    async with _state_lock:
        existed = _session_map.pop(conversation_id, None)
        if existed:
            await save_state()
    return {"ok": True, "forgot": existed}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.environ.get("SHIM_HOST", "0.0.0.0"),
        port=int(os.environ.get("SHIM_PORT", "8642")),
        log_level="info",
    )
