"use client";

import { useEffect } from "react";
import { WsMessage } from "@/lib/types";

// ---------------------------------------------------------------------------
// Singleton WebSocket — one connection shared by every subscriber.
// Multiple components can call useWebSocket(...) and each will receive every
// message via their own callback. Reconnects automatically on close.
// ---------------------------------------------------------------------------

type Listener = (msg: WsMessage) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

function getWebSocketUrl(): string | null {
  if (typeof window === "undefined") return null;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function ensureConnection() {
  if (typeof window === "undefined") return;
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const url = getWebSocketUrl();
  if (!url) return;

  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    console.log("[WS] Connected");
  };

  ws.onmessage = (event) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(event.data) as WsMessage;
    } catch {
      return;
    }
    for (const l of listeners) {
      try {
        l(msg);
      } catch {
        // never let one bad listener break the others
      }
    }
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected — reconnecting in 3s");
    socket = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(ensureConnection, 3000);
  };

  if (!pingTimer) {
    pingTimer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send("ping");
      }
    }, 20_000);
  }
}

interface UseWebSocketOptions {
  onMessage: Listener;
}

export function useWebSocket({ onMessage }: UseWebSocketOptions) {
  useEffect(() => {
    ensureConnection();
    listeners.add(onMessage);
    return () => {
      listeners.delete(onMessage);
    };
  }, [onMessage]);
}
