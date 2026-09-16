import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socketInstance) {
    const socketUrl =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

    socketInstance = io(socketUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      upgrade: true,
      withCredentials: false,
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (socketInstance && !socketInstance.connected) {
          console.log('[Network] Wi-Fi restored. Reconnecting socket...');
          socketInstance.connect();
        }
      });
    }
  }
  return socketInstance;
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
      localStorage.setItem(SESSION_KEY, serialized);
      localStorage.setItem('sessionToken', session.sessionToken);
      localStorage.setItem('roomCode', session.roomCode);
      localStorage.setItem('playerId', session.playerId);
      localStorage.setItem('playerName', session.playerName);
      sessionStorage.setItem(SESSION_KEY, serialized);
    } catch {
      // ignore
    }
  }
}

export function loadSession(): SavedSession | null {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
      if (data) {
        return JSON.parse(data);
      }
      const token = localStorage.getItem('sessionToken');
      const roomCode = localStorage.getItem('roomCode');
      const playerId = localStorage.getItem('playerId');
      const playerName = localStorage.getItem('playerName') || 'Summoner';
      if (token && roomCode && playerId) {
        return { sessionToken: token, roomCode, playerId, playerName };
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

