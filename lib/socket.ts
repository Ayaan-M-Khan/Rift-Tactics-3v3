import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export const normalizeSocketUrl = (url: string): string => {
  return url.trim().replace(/\/+$/, '').replace(/\/socket\.io\/?$/, '');
};

export const getActiveSocketUrl = (): string => {
  if (typeof window !== 'undefined') {
    const custom = window.localStorage.getItem('custom_socket_url');
    if (custom && custom.trim() && !custom.includes('your-app.onrender.com')) {
      return normalizeSocketUrl(custom);
    }
    if (process.env.NEXT_PUBLIC_SOCKET_URL) return normalizeSocketUrl(process.env.NEXT_PUBLIC_SOCKET_URL);
    return normalizeSocketUrl(window.location.origin);
  }
  return process.env.NEXT_PUBLIC_SOCKET_URL ? normalizeSocketUrl(process.env.NEXT_PUBLIC_SOCKET_URL) : 'http://localhost:3000';
};

export const getSocket = (): Socket => {
  if (!socketInstance) {
    let customSocketUrl: string | null = null;
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const queryServer = urlParams.get('server');
      if (queryServer) {
        customSocketUrl = normalizeSocketUrl(queryServer);
        try {
          window.localStorage.setItem('custom_socket_url', customSocketUrl);
        } catch {}
      } else {
        try {
          const stored = window.localStorage.getItem('custom_socket_url');
          if (stored && !stored.includes('your-app.onrender.com')) {
            customSocketUrl = normalizeSocketUrl(stored);
          } else {
            window.localStorage.removeItem('custom_socket_url');
          }
        } catch {}
      }
    }

    const socketUrl =
      customSocketUrl ||
      (process.env.NEXT_PUBLIC_SOCKET_URL ? normalizeSocketUrl(process.env.NEXT_PUBLIC_SOCKET_URL) : '') ||
      (typeof window !== 'undefined' ? normalizeSocketUrl(window.location.origin) : 'http://localhost:3000');

    socketInstance = io(socketUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      randomizationFactor: 0.2,
      timeout: 12000,
      transports: ['websocket', 'polling'],
      upgrade: true,
      withCredentials: true,
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (socketInstance && !socketInstance.connected) {
          console.log('[Network] Network online. Reconnecting socket...');
          socketInstance.connect();
        }
      });

      // If a custom socket URL was used and fails, immediately fall back to the live origin
      socketInstance.on('connect_error', () => {
        if (customSocketUrl && customSocketUrl !== normalizeSocketUrl(window.location.origin)) {
          console.warn('[Network] Custom socket URL unreachable, reverting to origin:', window.location.origin);
          try {
            window.localStorage.removeItem('custom_socket_url');
          } catch {}
          reconnectWithUrl(window.location.origin);
        }
      });
    }
  }
  return socketInstance;
};

export const reconnectWithUrl = (newUrl?: string): Socket => {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
  if (typeof window !== 'undefined') {
    try {
      if (newUrl && newUrl.trim() && !newUrl.includes('your-app.onrender.com')) {
        window.localStorage.setItem('custom_socket_url', newUrl.trim().replace(/\/+$/, ''));
      } else {
        window.localStorage.removeItem('custom_socket_url');
      }
    } catch {}
  }
  return getSocket();
};

export interface SavedSession {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  playerName: string;
}

const SESSION_KEY = 'rift_tactics_session';

export function saveSession(session: SavedSession) {
  if (typeof window !== 'undefined') {
    try {
      const serialized = JSON.stringify(session);
      // Clean up legacy cross-tab storage to prevent tab-session collision
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('roomCode');
      localStorage.removeItem('playerId');
      localStorage.removeItem('playerName');

      // Scoped strictly per-tab so new tabs can join independently
      sessionStorage.setItem(SESSION_KEY, serialized);
    } catch {
      // ignore
    }
  }
}

export function loadSession(): SavedSession | null {
  if (typeof window !== 'undefined') {
    try {
      // Clean up any legacy localStorage so another tab's session never leaks
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('roomCode');
      localStorage.removeItem('playerId');
      localStorage.removeItem('playerName');

      const data = sessionStorage.getItem(SESSION_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function clearGameSession() {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('roomCode');
      localStorage.removeItem('playerId');
      localStorage.removeItem('playerName');
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }
}

export const clearSession = clearGameSession;
