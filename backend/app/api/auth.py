from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, WebSocket, status

from app.config import settings


def verify_internal_request(x_internal_auth: str | None = Header(default=None)) -> None:
    if not x_internal_auth or not secrets.compare_digest(
        x_internal_auth, settings.internal_auth_token
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


async def verify_internal_websocket(websocket: WebSocket) -> bool:
    token = websocket.headers.get("x-internal-auth")
    if token and secrets.compare_digest(token, settings.internal_auth_token):
        return True

    await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    return False