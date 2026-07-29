"""
Web WebSocket stream endpoint for browser clients.

This file shows the additions needed in server.py to support the React frontend
(nodestra-agent-ui) with Google Maps integration.

Copy this endpoint into server.py in nodestra-agent-v2.
It handles browser-based voice agents (WebRTC audio → STT → LangGraph → TTS → browser).

Requirements:
- pip install openai  (for Whisper STT, or swap for Deepgram)
- The React frontend connects to ws://localhost:8000/web/stream

Message protocol:
  Client → Server:
    { type: 'config', language: 'en', userId: '...' }
    { type: 'audio', data: '<base64>', format: 'webm'|'ogg'|'mp4', language: 'en' }
    { type: 'ping' }

  Server → Client:
    { type: 'transcript', role: 'user', text: '...' }
    { type: 'transcript', role: 'agent', text: '...' }
    { type: 'audio', data: '<base64 mp3>', format: 'mp3' }
    { type: 'status', state: 'idle'|'thinking'|'speaking' }
    { type: 'map_action', action: { type: 'show_destination'|'show_directions'|'clear', ... } }
    { type: 'error', message: '...' }
"""

import asyncio
import base64
import io
import json
import logging
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import WebSocket, WebSocketDisconnect
from langchain_core.messages import HumanMessage

from agent.graph import ITERATION_CAP, graph, bind_sentence_callback, bind_speak_early_callback
from agent.map_tools import bind_map_callback, MAP_TOOLS

logger = logging.getLogger(__name__)
_web_executor = ThreadPoolExecutor(max_workers=5)


def _stt_transcribe(audio_bytes: bytes, fmt: str, language: str) -> str:
    """Transcribe audio using Whisper (via OpenAI SDK). Swap for Deepgram if preferred."""
    import openai
    ext = {"webm": "webm", "ogg": "ogg", "mp4": "mp4"}.get(fmt, "webm")
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f:
        f.write(audio_bytes)
        f.flush()
        client = openai.OpenAI()
        with open(f.name, "rb") as audio_f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_f,
                language=language[:2] if language else "en",
            )
    return result.text.strip()


def _graph_turn(transcript: str, session_id: str, user_id: str | None) -> dict:
    """Run one LangGraph turn and return {text, hangup}."""
    payload: dict = {"messages": [HumanMessage(content=transcript)]}
    if user_id:
        payload["user_id"] = user_id
    config = {"configurable": {"thread_id": session_id}, "recursion_limit": ITERATION_CAP}
    result = graph.invoke(payload, config=config)
    for msg in reversed(result.get("messages", [])):
        if hasattr(msg, "content") and msg.content and not getattr(msg, "tool_calls", None):
            text = msg.content if isinstance(msg.content, str) else str(msg.content)
            return {"text": text, "hangup": bool(result.get("should_end"))}
    return {"text": "I'm having trouble with that. Please try again.", "hangup": False}


def _tts_to_mp3(text: str) -> bytes:
    """Text-to-speech using ElevenLabs or OpenAI TTS. Adapt as needed."""
    # Uses the existing TTS helpers from server.py — import _tts_mp3_bytes or similar.
    # Example with OpenAI TTS:
    import openai
    client = openai.OpenAI()
    response = client.audio.speech.create(model="tts-1", voice="nova", input=text)
    return response.content


# ---------------------------------------------------------------------------
# WebSocket endpoint — add to server.py FastAPI app
# ---------------------------------------------------------------------------

async def web_stream(ws: WebSocket):
    """
    Browser WebSocket endpoint for the React voice agent UI.

    Add to server.py:
        @app.websocket("/web/stream")
        async def web_stream_route(ws: WebSocket):
            await web_stream(ws)
    """
    await ws.accept()
    loop = asyncio.get_running_loop()

    session_id = str(uuid.uuid4())
    user_id: str | None = None
    language = "en"

    async def send(msg: dict) -> None:
        try:
            await ws.send_json(msg)
        except Exception:
            pass

    await send({"type": "status", "state": "idle"})

    try:
        async for raw in ws.iter_text():
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            msg_type = msg.get("type")

            if msg_type == "ping":
                await send({"type": "status", "state": "idle"})
                continue

            if msg_type == "config":
                language = msg.get("language", "en")
                user_id = msg.get("userId") or None
                continue

            if msg_type != "audio":
                continue

            # ── Decode audio ─────────────────────────────────────────────
            try:
                audio_bytes = base64.b64decode(msg["data"])
                fmt = msg.get("format", "webm")
                lang = msg.get("language", language)
            except Exception as e:
                await send({"type": "error", "message": f"Bad audio payload: {e}"})
                continue

            await send({"type": "status", "state": "thinking"})

            # ── STT ──────────────────────────────────────────────────────
            try:
                transcript = await loop.run_in_executor(
                    _web_executor, _stt_transcribe, audio_bytes, fmt, lang
                )
            except Exception as e:
                logger.error(f"STT failed [{session_id}]: {e}")
                await send({"type": "error", "message": "Could not transcribe audio."})
                await send({"type": "status", "state": "idle"})
                continue

            if not transcript:
                await send({"type": "status", "state": "idle"})
                continue

            await send({"type": "transcript", "role": "user", "text": transcript})

            # ── LangGraph ────────────────────────────────────────────────
            map_actions: list[dict] = []

            def map_cb(action: dict) -> None:
                map_actions.append(action)

            sentence_parts: list[str] = []

            def sentence_cb(text_or_none: str | None) -> None:
                if text_or_none is not None:
                    sentence_parts.append(text_or_none)

            try:
                with bind_speak_early_callback(None):
                    with bind_sentence_callback(sentence_cb):
                        with bind_map_callback(map_cb):
                            reply = await loop.run_in_executor(
                                _web_executor,
                                _graph_turn,
                                transcript,
                                session_id,
                                user_id,
                            )
            except Exception as e:
                logger.error(f"Graph error [{session_id}]: {e}", exc_info=True)
                await send({"type": "error", "message": "Something went wrong. Please try again."})
                await send({"type": "status", "state": "idle"})
                continue

            response_text = reply.get("text", "")
            if not response_text and sentence_parts:
                response_text = " ".join(sentence_parts)

            # ── Send map actions ─────────────────────────────────────────
            for action in map_actions:
                await send({"type": "map_action", "action": action})

            # ── Send agent transcript ────────────────────────────────────
            if response_text:
                await send({"type": "transcript", "role": "agent", "text": response_text})

            await send({"type": "status", "state": "speaking"})

            # ── TTS ──────────────────────────────────────────────────────
            try:
                mp3_bytes = await loop.run_in_executor(
                    _web_executor, _tts_to_mp3, response_text
                )
                await send({
                    "type": "audio",
                    "data": base64.b64encode(mp3_bytes).decode(),
                    "format": "mp3",
                })
            except Exception as e:
                logger.error(f"TTS failed [{session_id}]: {e}")

            await send({"type": "status", "state": "idle"})

            if reply.get("hangup"):
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"web_stream error [{session_id}]: {e}", exc_info=True)
    finally:
        logger.info(f"Web stream closed: {session_id}")
