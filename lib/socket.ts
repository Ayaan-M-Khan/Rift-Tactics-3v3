import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io({
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socketInstance;
}

const SESSION_KEY = 'rift_tactics_session';

export interface SavedSession {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  playerName: string;
}

export function saveSession(session: SavedSession) {
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
  }
}

export function loadSession(): SavedSession | null {
  if (typeof window !== 'undefined') {
    try {
      const data = sessionStorage.getItem(SESSION_KEY);
      if (data) return JSON.parse(data);
    } catch {
      // ignore
    }
  }
  return null;
}

export function clearSession() {
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }
}
