import { apiFetch, apiWebSocketUrl, getAccessToken } from "./api";

let socket: WebSocket | null = null;
let heartbeat: number | null = null;
let reconnectTimer: number | null = null;
let listeners = 0;
let manuallyStopped = false;
let reconnectAttempts = 0;
let lastEventId = 0;

function status(value: string) {
  window.dispatchEvent(new CustomEvent("sound-buddy-realtime-status", { detail: value }));
}

export function startRealtime() {
  listeners += 1;
  manuallyStopped = false;
  if (socket || !getAccessToken()) return () => stopRealtime();
  void connect();
  return () => stopRealtime();
}

async function connect() {
  const token = getAccessToken();
  if (!token || manuallyStopped) return;
  status("connecting");
  try {
    const { ticket } = await apiFetch<{ ticket: string }>("/api/auth/realtime-ticket", { method: "POST" });
    if (manuallyStopped || !getAccessToken()) return;
    lastEventId = 0;
    socket = new WebSocket(`${apiWebSocketUrl()}?ticket=${encodeURIComponent(ticket)}`);
  } catch {
    status("disconnected");
    scheduleReconnect();
    return;
  }
  socket.onopen = () => {
    reconnectAttempts = 0;
    status("connected");
    heartbeat = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
    }, 25000);
  };
  socket.onmessage = event => {
    try {
      const message = JSON.parse(event.data) as { id?: number; type?: string; data?: unknown };
      if (message.type === "connected") return;
      if (typeof message.id === "number") {
        if (message.id <= lastEventId) return;
        lastEventId = message.id;
      }
      window.dispatchEvent(new CustomEvent("sound-buddy-realtime", { detail: message }));
    } catch { /* ignore malformed frames */ }
  };
  socket.onclose = () => {
    if (heartbeat) window.clearInterval(heartbeat);
    heartbeat = null;
    socket = null;
    status("disconnected");
    if (!manuallyStopped && listeners > 0 && !reconnectTimer) {
      const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts++);
      status("reconnecting");
      reconnectTimer = window.setTimeout(() => { reconnectTimer = null; connect(); }, delay);
    }
  };
  socket.onerror = () => socket?.close();
}

function dispatchRealtime(type: string, data: unknown) {
  window.dispatchEvent(new CustomEvent("sound-buddy-realtime", { detail: { type, data } }));
}

function scheduleReconnect() {
  if (!manuallyStopped && listeners > 0 && !reconnectTimer) {
    const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts++);
    status("reconnecting");
    reconnectTimer = window.setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }
}

function reconnectWhenVisible() {
  if (document.visibilityState !== "visible" || manuallyStopped || listeners === 0) return;
  if (!socket && !reconnectTimer) void connect();
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", reconnectWhenVisible);

function stopRealtime() {
  listeners = Math.max(0, listeners - 1);
  if (listeners === 0) {
    manuallyStopped = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (heartbeat) window.clearInterval(heartbeat);
    heartbeat = null;
    socket?.close();
    socket = null;
    status("disconnected");
  }
}

export function stopAllRealtime() {
  listeners = 0;
  manuallyStopped = true;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (heartbeat) window.clearInterval(heartbeat);
  heartbeat = null;
  socket?.close();
  socket = null;
  reconnectAttempts = 0;
  status("disconnected");
}
