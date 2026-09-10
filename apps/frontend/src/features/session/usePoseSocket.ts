import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PoseServerMessage,
  PoseUpdateData,
  RepCompletedData,
  SessionClosedData,
  SessionReadyData,
} from '../../types/api';

/**
 * Where the pose WebSocket lives.
 *
 * Accepts either an absolute URL (`ws://localhost:8000/ws/session`) or a
 * same-origin PATH (`/ws/session`). A path is resolved against the page,
 * upgrading http->ws and https->wss, which is what lets the app be served
 * through a single tunnel: the socket then rides the same origin as the page
 * instead of pointing at a `localhost` that only exists on the developer's
 * machine.
 */
function resolvePoseWsUrl(configured: string): string {
  if (!configured.startsWith('/')) return configured;
  if (typeof window === 'undefined') return configured;
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${configured}`;
}

const POSE_WS_URL: string = resolvePoseWsUrl(
  import.meta.env.VITE_POSE_WS_URL ?? 'ws://localhost:8000/ws/session',
);

export type SocketStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'closed'
  | 'error';

export interface PoseSocketError {
  code: string;
  message: string;
  recoverable: boolean;
}

interface UsePoseSocketOptions {
  onPoseUpdate: (data: PoseUpdateData) => void;
  onRepCompleted: (data: RepCompletedData) => void;
  onSessionReady: (data: SessionReadyData) => void;
  /**
   * The pose service has decided the session is over. Receives the whole
   * payload, not just the reason: the session page reports what was achieved
   * before navigating, and a bare string could not tell it.
   */
  onClosed: (data: SessionClosedData) => void;
}

interface UsePoseSocketResult {
  status: SocketStatus;
  error: PoseSocketError | null;
  connect: (ticket: string) => void;
  disconnect: () => void;
  sendFrame: (blob: Blob) => void;
  /** True while a frame is in flight - used for backpressure. */
  isBusy: () => boolean;
  reset: () => void;
}

/**
 * The browser end of the frame stream.
 *
 * Close codes 4000-4999 are application-defined and map to the pose service's
 * refusals (bad ticket, session finished, at capacity). They are surfaced with
 * a specific message rather than a generic "connection lost", because "your
 * session has already been completed" and "the server is busy" call for
 * completely different actions from the patient.
 *
 * There is deliberately NO automatic reconnect loop here: reconnecting needs a
 * fresh pose ticket from the backend, so the session page drives retries
 * explicitly. An endless silent retry against an expired ticket would just
 * hammer the service.
 */
export function usePoseSocket(
  options: UsePoseSocketOptions,
): UsePoseSocketResult {
  const socketRef = useRef<WebSocket | null>(null);
  const busyRef = useRef(false);
  const intentionalCloseRef = useRef(false);

  const [status, setStatus] = useState<SocketStatus>('idle');
  const [error, setError] = useState<PoseSocketError | null>(null);

  // Handlers are held in a ref so reconnecting does not require the caller to
  // memoise every callback.
  const handlersRef = useRef(options);
  handlersRef.current = options;

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    const socket = socketRef.current;
    if (socket) {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, 'Client finished');
      }
      socketRef.current = null;
    }
    busyRef.current = false;
    setStatus('closed');
  }, []);

  const connect = useCallback((ticket: string) => {
    disconnectExisting(socketRef);
    intentionalCloseRef.current = false;
    busyRef.current = false;
    setError(null);
    setStatus('connecting');

    // The ticket travels in the query string because browsers cannot set
    // custom headers on a WebSocket handshake. It is safe here only because
    // it expires in ~2 minutes and authorises exactly one session id.
    const socket = new WebSocket(
      `${POSE_WS_URL}?ticket=${encodeURIComponent(ticket)}`,
    );
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: PoseServerMessage;
      try {
        message = JSON.parse(event.data) as PoseServerMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'session:ready':
          setStatus('ready');
          handlersRef.current.onSessionReady(message.data);
          break;
        case 'pose:update':
          busyRef.current = false;
          handlersRef.current.onPoseUpdate(message.data);
          break;
        case 'rep:completed':
          handlersRef.current.onRepCompleted(message.data);
          break;
        case 'pose:error':
          busyRef.current = false;
          setError({
            code: message.data.code,
            message: message.data.message,
            recoverable: message.data.recoverable,
          });
          break;
        case 'session:closed':
          handlersRef.current.onClosed(message.data);
          break;
        case 'tracking:warning':
          break; // warnings also arrive inside pose:update.errors
      }
    };

    socket.onerror = () => {
      // The Error event carries no detail by design; onclose supplies the code.
      busyRef.current = false;
    };

    socket.onclose = (event: CloseEvent) => {
      busyRef.current = false;
      socketRef.current = null;

      if (intentionalCloseRef.current || event.code === 1000) {
        setStatus('closed');
        return;
      }

      setStatus('error');
      setError(closeCodeToError(event.code));
    };
  }, []);

  const sendFrame = useCallback((blob: Blob) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (busyRef.current) return;

    // Backpressure: never queue frames. If the previous one is still being
    // analysed, DROP this one. A fresh frame a moment later is worth more than
    // a stale frame delivered late, and an unbounded bufferedAmount would grow
    // until the tab stalls.
    busyRef.current = true;
    blob
      .arrayBuffer()
      .then((buffer) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(buffer);
        } else {
          busyRef.current = false;
        }
      })
      .catch(() => {
        busyRef.current = false;
      });
  }, []);

  const reset = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'control', action: 'reset' }));
    }
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return useMemo(
    () => ({
      status,
      error,
      connect,
      disconnect,
      sendFrame,
      isBusy: () => busyRef.current,
      reset,
    }),
    [status, error, connect, disconnect, sendFrame, reset],
  );
}

function disconnectExisting(ref: React.MutableRefObject<WebSocket | null>) {
  const socket = ref.current;
  if (socket && socket.readyState <= WebSocket.OPEN) {
    socket.close(1000, 'Reconnecting');
  }
  ref.current = null;
}

function closeCodeToError(code: number): PoseSocketError {
  switch (code) {
    case 4401:
      return {
        code: 'TICKET_INVALID',
        message:
          'Your analysis session expired before it could start. Press Retry to reconnect.',
        recoverable: true,
      };
    case 4403:
      return {
        code: 'ORIGIN_REJECTED',
        message: 'This page is not allowed to connect to the analysis service.',
        recoverable: false,
      };
    case 4404:
      return {
        code: 'SESSION_REJECTED',
        message:
          'This session is no longer accepting analysis. It may already be finished.',
        recoverable: false,
      };
    case 4422:
      return {
        code: 'UNSUPPORTED_EXERCISE',
        message:
          'This exercise does not have pose analysis configured yet. Contact your therapist.',
        recoverable: false,
      };
    case 4429:
      return {
        code: 'AT_CAPACITY',
        message:
          'The analysis service is busy right now. Please wait a moment and try again.',
        recoverable: true,
      };
    case 4503:
      return {
        code: 'SERVICE_UNAVAILABLE',
        message:
          'The analysis service is unavailable. Please try again in a moment.',
        recoverable: true,
      };
    default:
      return {
        code: 'CONNECTION_LOST',
        message:
          'The connection to the analysis service was lost. Press Retry to reconnect.',
        recoverable: true,
      };
  }
}
