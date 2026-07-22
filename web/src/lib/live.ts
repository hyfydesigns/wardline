import { useEffect, useRef, useState } from 'react';
import { tokenStore, type Alert } from './api';
import { wsUrl } from './config';

export interface LiveAlertMessage { type: 'alert'; alert: Partial<Alert> & { id: string }; }

/**
 * Subscribes to the server's WebSocket alert stream. Reconnects with backoff.
 * `onAlert` fires for each new alert pushed while the dashboard is open.
 */
export function useLiveAlerts(onAlert: (alert: LiveAlertMessage['alert']) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) return;
    let socket: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      socket = new WebSocket(wsUrl(`/ws?token=${encodeURIComponent(token)}`));
      socket.onopen = () => { retry = 0; setConnected(true); };
      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as LiveAlertMessage | { type: string };
          if (msg.type === 'alert') onAlertRef.current((msg as LiveAlertMessage).alert);
        } catch { /* ignore */ }
      };
      socket.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, 500 * 2 ** retry);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { connected };
}
