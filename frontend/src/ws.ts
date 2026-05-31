import { useEffect, useRef, useState } from "react";

type Handler = (event: string, data: any) => void;

export type WsStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

export function useWebSocket(enabled: boolean, onMessage: Handler): WsStatus {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const [status, setStatus] = useState<WsStatus>("disconnected");

  useEffect(() => {
    if (!enabled) {
      setStatus("disconnected");
      return;
    }

    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    const connect = () => {
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);

      ws.onopen = () => {
        attempt = 0;
        setStatus("connected");
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          handlerRef.current(msg.event, msg.data);
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        if (closed) return;
        setStatus("reconnecting");
        attempt += 1;
        const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 4));
        retry = setTimeout(connect, delay);
      };

      ws.onerror = () => ws?.close();
    };

    connect();

    const onOnline = () => {
      if (!closed && ws?.readyState !== WebSocket.OPEN) {
        if (retry) clearTimeout(retry);
        attempt = 0;
        connect();
      }
    };
    window.addEventListener("online", onOnline);

    return () => {
      closed = true;
      window.removeEventListener("online", onOnline);
      if (retry) clearTimeout(retry);
      ws?.close();
      setStatus("disconnected");
    };
  }, [enabled]);

  return status;
}
