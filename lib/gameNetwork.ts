'use client';

import { Socket } from 'socket.io-client';
import { GameRoomState, ItemId, Role, SummonerSpellId, Team } from '../types/game';
import { GameEngine } from '../server/gameEngine';
import { getSocket, getActiveSocketUrl, saveSession, loadSession, clearGameSession } from './socket';

export type NetworkMode = 'server' | 'mesh';

export interface NetworkStatus {
  connected: boolean;
  connecting: boolean;
  mode: NetworkMode;
  serverUrl: string;
  errorMessage: string | null;
}

type RoomUpdatedCallback = (room: GameRoomState) => void;
type DraftHoveredCallback = (data: { playerId: string; championId: string }) => void;
type NetworkStatusCallback = (status: NetworkStatus) => void;

class GameNetworkClient {
  private socket: Socket | null = null;
  private channel: BroadcastChannel | null = null;
  private localEngine: GameEngine | null = null;
  private currentMode: NetworkMode = 'server';
  private isConnected = false;
  private isConnecting = true;
  private errorMessage: string | null = null;
  private activeRoomCode: string | null = null;
  private activePlayerId: string | null = null;

  private roomUpdatedListeners = new Set<RoomUpdatedCallback>();
  private draftHoveredListeners = new Set<DraftHoveredCallback>();
  private statusListeners = new Set<NetworkStatusCallback>();

  private pendingCallbacks = new Map<string, (res: any) => void>();

  constructor() {
    if (typeof window !== 'undefined') {
      this.initBroadcastChannel();
      this.initSocket();
    }
  }

  private currentStatus: NetworkStatus = {
    connected: false,
    connecting: true,
    mode: 'server',
    serverUrl: '',
    errorMessage: null,
  };

  private notifyStatus() {
    this.currentStatus = {
      connected: this.isConnected,
      connecting: this.isConnecting,
      mode: this.currentMode,
      serverUrl: getActiveSocketUrl(),
      errorMessage: this.errorMessage,
    };
    this.statusListeners.forEach((cb) => cb(this.currentStatus));
  }

  private initBroadcastChannel() {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    try {
      this.channel = new BroadcastChannel('rift_tactics_mesh_v1');
      this.channel.onmessage = (event) => {
        this.handleMeshMessage(event.data);
      };

      window.addEventListener('storage', (e) => {
        if (e.key === 'rift_tactics_mesh_sync' && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            this.handleMeshMessage(data);
          } catch {}
        }
      });
    } catch (err) {
      console.warn('[Network] BroadcastChannel unavailable:', err);
    }
  }

  private broadcastToMesh(message: any) {
    if (this.currentMode !== 'mesh') return;
    if (this.channel) {
      this.channel.postMessage(message);
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          'rift_tactics_mesh_sync',
          JSON.stringify({ ...message, _ts: Date.now() + Math.random() })
        );
      } catch {}
    }
  }

  private initSocket() {
    this.socket = getSocket();

    // Always start in multiplayer server mode
    this.currentMode = 'server';
    this.isConnecting = !this.socket.connected;
    this.isConnected = this.socket.connected;

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.isConnecting = false;
      this.currentMode = 'server';
      this.errorMessage = null;
      console.log('[Network] Connected to Socket.IO server at', getActiveSocketUrl());
      this.notifyStatus();
    });

    this.socket.on('connect_error', (err: any) => {
      const errMsg = err?.message || String(err);
      console.warn('[Network] Socket connect error:', errMsg);

      // Never drop to offline mode automatically on connect_error; keep reconnecting in multiplayer mode
      this.isConnected = false;
      this.isConnecting = true;
      this.currentMode = 'server';
      this.errorMessage = 'Connecting to multiplayer server...';
      this.notifyStatus();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Network] Socket disconnected:', reason);
      this.isConnected = false;
      this.isConnecting = true;
      this.currentMode = 'server';
      this.errorMessage = 'Reconnecting to multiplayer server...';
      this.notifyStatus();
    });

    this.socket.on('room_updated', (room: GameRoomState) => {
      // Discard any room updates that do not belong to our active room!
      if (this.activeRoomCode && room.roomCode !== this.activeRoomCode) {
        return;
      }
      if (!this.activeRoomCode) {
        this.activeRoomCode = room.roomCode;
      }
      this.roomUpdatedListeners.forEach((cb) => cb(room));
      if (this.currentMode === 'mesh') {
        this.broadcastToMesh({ type: 'room_updated', room });
      }
    });

    this.socket.on('draft_hovered', (data: { playerId: string; championId: string; roomCode?: string }) => {
      if (data.roomCode && this.activeRoomCode && data.roomCode !== this.activeRoomCode) {
        return;
      }
      this.draftHoveredListeners.forEach((cb) => cb(data));
      if (this.currentMode === 'mesh') {
        this.broadcastToMesh({ type: 'draft_hovered', data });
      }
    });

    if (this.socket.connected) {
      this.isConnected = true;
      this.isConnecting = false;
      this.currentMode = 'server';
      this.notifyStatus();
    } else {
      // Ensure socket begins connecting immediately
      this.socket.connect();
    }
  }

  public ensureSocketConnected(timeoutMs = 5000): Promise<boolean> {
    if (this.socket?.connected) {
      this.isConnected = true;
      this.isConnecting = false;
      this.currentMode = 'server';
      return Promise.resolve(true);
    }

    if (!this.socket) {
      this.initSocket();
    }

    this.isConnecting = true;
    this.currentMode = 'server';
    this.notifyStatus();
    this.socket?.connect();

    return new Promise((resolve) => {
      if (!this.socket) {
        resolve(false);
        return;
      }
      if (this.socket.connected) {
        this.isConnected = true;
        this.isConnecting = false;
        resolve(true);
        return;
      }

      let timer: NodeJS.Timeout | null = null;
      const onConnect = () => {
        if (timer) clearTimeout(timer);
        this.socket?.off('connect', onConnect);
        this.isConnected = true;
        this.isConnecting = false;
        this.currentMode = 'server';
        this.notifyStatus();
        resolve(true);
      };

      timer = setTimeout(() => {
        this.socket?.off('connect', onConnect);
        resolve(this.socket?.connected || false);
      }, timeoutMs);

      this.socket.once('connect', onConnect);
    });
  }

  private enableMeshFallback(reason: string) {
    this.isConnected = true;
    this.isConnecting = false;
    this.currentMode = 'mesh';
    this.errorMessage = reason;
    this.notifyStatus();
  }

  // --- Local Mesh Message Handling ---
  private handleMeshMessage(msg: any) {
    if (!msg || typeof msg !== 'object') return;
    // In server mode, never accept mesh updates from other browser tabs
    if (this.currentMode === 'server') return;

    if (msg.type === 'room_updated' && msg.room) {
      if (this.activeRoomCode && msg.room.roomCode !== this.activeRoomCode) {
        return;
      }
      this.roomUpdatedListeners.forEach((cb) => cb(msg.room));
      return;
    }

    if (msg.type === 'draft_hovered' && msg.data) {
      if (msg.data.roomCode && this.activeRoomCode && msg.data.roomCode !== this.activeRoomCode) {
        return;
      }
      this.draftHoveredListeners.forEach((cb) => cb(msg.data));
      return;
    }

    if (msg.type === 'mesh_response' && msg.requestId) {
      const cb = this.pendingCallbacks.get(msg.requestId);
      if (cb) {
        this.pendingCallbacks.delete(msg.requestId);
        cb(msg.result);
      }
      return;
    }

    // Host handles peer actions
    if (this.localEngine && msg.type === 'peer_action') {
      const { action, payload, requestId } = msg;
      const result = this.executeLocalEngineAction(action, payload);
      if (requestId) {
        this.broadcastToMesh({
          type: 'mesh_response',
          requestId,
          result,
        });
      }
    }
  }

  private executeLocalEngineAction(action: string, payload: any): any {
    if (!this.localEngine) return { success: false, error: 'Host engine not initialized' };

    switch (action) {
      case 'join_room':
        return this.localEngine.joinRoom(payload.roomCode, payload.playerName);
      case 'update_lobby_slot':
        return { success: this.localEngine.updateLobbySlot(payload.roomCode, payload.playerId, payload.team, payload.role) };
      case 'toggle_bot_fill':
        return { success: this.localEngine.toggleBotFill(payload.roomCode, payload.playerId) };
      case 'kick_player':
        return { success: this.localEngine.kickPlayer(payload.roomCode, payload.hostPlayerId, payload.targetPlayerId) };
      case 'start_draft':
        return { success: this.localEngine.startDraft(payload.roomCode, payload.hostPlayerId) };
      case 'lock_ban':
        return { success: this.localEngine.lockBan(payload.roomCode, payload.playerId, payload.championId) };
      case 'lock_pick':
        return { success: this.localEngine.lockPick(payload.roomCode, payload.playerId, payload.championId) };
      case 'draft_select':
        this.broadcastToMesh({
          type: 'draft_hovered',
          data: { playerId: payload.playerId, championId: payload.championId },
        });
        return { success: true };
      case 'set_summoner_spell':
        return { success: this.localEngine.setSummonerSpell(payload.roomCode, payload.playerId, payload.spellId) };
      case 'move_champion':
        return this.localEngine.moveChampion(payload.roomCode, payload.playerId, payload.targetX, payload.targetY);
      case 'undo_move':
        return { success: this.localEngine.undoMove(payload.roomCode, payload.playerId) };
      case 'basic_attack':
        return this.localEngine.basicAttack(payload.roomCode, payload.playerId, payload.targetType, payload.targetId);
      case 'cast_ability':
        return this.localEngine.castAbility(payload.roomCode, payload.playerId, payload.abilityKey, payload.targetX, payload.targetY, payload.targetUnitId);
      case 'move_decoy':
        return this.localEngine.moveDecoy(payload.roomCode, payload.playerId, payload.decoyId, payload.targetX, payload.targetY);
      case 'use_summoner_spell':
        return this.localEngine.useSummonerSpell(payload.roomCode, payload.playerId, payload.targetX, payload.targetY, payload.targetPlayerId);
      case 'buy_item':
        return this.localEngine.buyItem(payload.roomCode, payload.playerId, payload.itemId);
      case 'sell_item':
        return this.localEngine.sellItem(payload.roomCode, payload.playerId, payload.itemIndex);
      case 'undo_buy_item':
        return this.localEngine.undoBuyItem(payload.roomCode, payload.playerId);
      case 'use_item':
        return this.localEngine.useItem(payload.roomCode, payload.playerId, payload.itemId);
      case 'pass_turn':
        return { success: this.localEngine.passTurn(payload.roomCode, payload.playerId) };
      case 'play_again':
        return { success: this.localEngine.playAgain(payload.roomCode) };
      case 'reconnect_session':
        return this.localEngine.reconnectPlayer(payload.sessionToken, payload.socketId || 'local_mesh');
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  // --- Public API ---

  public onRoomUpdated(cb: RoomUpdatedCallback): () => void {
    this.roomUpdatedListeners.add(cb);
    return () => this.roomUpdatedListeners.delete(cb);
  }

  public onDraftHovered(cb: DraftHoveredCallback): () => void {
    this.draftHoveredListeners.add(cb);
    return () => this.draftHoveredListeners.delete(cb);
  }

  public onStatusChange(cb: NetworkStatusCallback): () => void {
    this.statusListeners.add(cb);
    cb({
      connected: this.isConnected,
      connecting: this.isConnecting,
      mode: this.currentMode,
      serverUrl: getActiveSocketUrl(),
      errorMessage: this.errorMessage,
    });
    return () => this.statusListeners.delete(cb);
  }

  public getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  public async createRoom(
    hostName: string,
    callback: (res: { room: GameRoomState; playerId: string; sessionToken: string; error?: string }) => void
  ) {
    const isReady = await this.ensureSocketConnected(4000);
    if (isReady && this.socket?.connected) {
      this.socket.emit('create_room', { hostName }, (res: any) => {
        if (res && res.room) {
          this.activeRoomCode = res.room.roomCode;
          this.activePlayerId = res.playerId;
        }
        callback(res);
      });
      return;
    }

    // Host with local engine if server is truly unreachable
    this.localEngine = new GameEngine((room) => {
      this.roomUpdatedListeners.forEach((cb) => cb(room));
      this.broadcastToMesh({ type: 'room_updated', room });
    });

    const result = this.localEngine.createRoom(hostName);
    this.activeRoomCode = result.room.roomCode;
    this.activePlayerId = result.playerId;
    this.currentMode = 'mesh';
    this.isConnected = true;
    this.notifyStatus();

    this.broadcastToMesh({ type: 'room_updated', room: result.room });
    callback(result);
  }

  public async joinRoom(
    roomCode: string,
    playerName: string,
    callback: (res: { success: boolean; error?: string; room?: GameRoomState; playerId?: string; sessionToken?: string }) => void
  ) {
    const normalizedCode = (roomCode || '').trim().toUpperCase();
    const isReady = await this.ensureSocketConnected(4000);
    if (isReady && this.socket?.connected) {
      this.socket.emit('join_room', { roomCode: normalizedCode, playerName }, (res: any) => {
        if (res?.success && res.room) {
          this.activeRoomCode = res.room.roomCode;
          this.activePlayerId = res.playerId;
        }
        callback(res);
      });
      return;
    }

    // Join via mesh
    const requestId = 'req_' + Math.random().toString(36).substring(2, 9);
    this.pendingCallbacks.set(requestId, (res) => {
      if (res?.success && res.room) {
        this.activeRoomCode = res.room.roomCode;
        this.activePlayerId = res.playerId;
      }
      callback(res);
    });

    this.broadcastToMesh({
      type: 'peer_action',
      action: 'join_room',
      payload: { roomCode: normalizedCode, playerName },
      requestId,
    });

    // Timeout fallback for join
    setTimeout(() => {
      if (this.pendingCallbacks.has(requestId)) {
        this.pendingCallbacks.delete(requestId);
        callback({ success: false, error: 'Could not connect to multiplayer room. Please verify the room code.' });
      }
    }, 4000);
  }

  public async reconnectSession(
    sessionToken: string,
    roomCode: string,
    callback: (res: { success: boolean; room?: GameRoomState; player?: { id: string } }) => void
  ) {
    const isReady = await this.ensureSocketConnected(3000);
    if (isReady && this.socket?.connected) {
      this.socket.emit('reconnect_session', { sessionToken, roomCode }, (res: any) => {
        if (res?.success && res.room && res.player) {
          this.activeRoomCode = res.room.roomCode;
          this.activePlayerId = res.player.id;
        }
        callback(res);
      });
      return;
    }

    if (this.localEngine) {
      const res = this.localEngine.reconnectPlayer(sessionToken);
      if (res?.success && res.room && res.player) {
        this.activeRoomCode = res.room.roomCode;
        this.activePlayerId = res.player.id;
      }
      callback(res);
      return;
    }

    const requestId = 'req_' + Math.random().toString(36).substring(2, 9);
    this.pendingCallbacks.set(requestId, (res) => {
      if (res?.success && res.room && res.player) {
        this.activeRoomCode = res.room.roomCode;
        this.activePlayerId = res.player.id;
      }
      callback(res);
    });
    this.broadcastToMesh({
      type: 'peer_action',
      action: 'reconnect_session',
      payload: { sessionToken, roomCode },
      requestId,
    });

    setTimeout(() => {
      if (this.pendingCallbacks.has(requestId)) {
        this.pendingCallbacks.delete(requestId);
        callback({ success: false });
      }
    }, 3000);
  }

  public async emitAction(action: string, payload: any, callback?: (res: any) => void) {
    if (this.currentMode === 'server') {
      if (this.socket?.connected) {
        this.socket.emit(action, payload, callback);
        return;
      }
      const isReady = await this.ensureSocketConnected(2500);
      if (isReady && this.socket?.connected) {
        this.socket.emit(action, payload, callback);
        return;
      }
    }

    if (this.localEngine) {
      const result = this.executeLocalEngineAction(action, payload);
      if (callback) callback(result);
      return;
    }

    const requestId = 'req_' + Math.random().toString(36).substring(2, 9);
    if (callback) {
      this.pendingCallbacks.set(requestId, callback);
    }

    this.broadcastToMesh({
      type: 'peer_action',
      action,
      payload,
      requestId,
    });
  }

  // Action helpers
  public updateLobbySlot(roomCode: string, playerId: string, team: Team, role: Role, cb?: (res: any) => void) {
    this.emitAction('update_lobby_slot', { roomCode, playerId, team, role }, cb);
  }

  public toggleBotFill(roomCode: string, playerId: string, cb?: (res: any) => void) {
    this.emitAction('toggle_bot_fill', { roomCode, playerId }, cb);
  }

  public kickPlayer(roomCode: string, hostPlayerId: string, targetPlayerId: string, cb?: (res: any) => void) {
    this.emitAction('kick_player', { roomCode, hostPlayerId, targetPlayerId }, cb);
  }

  public startDraft(roomCode: string, hostPlayerId: string, cb?: (res: any) => void) {
    this.emitAction('start_draft', { roomCode, hostPlayerId }, cb);
  }

  public lockBan(roomCode: string, playerId: string, championId: string, cb?: (res: any) => void) {
    this.emitAction('lock_ban', { roomCode, playerId, championId }, cb);
  }

  public lockPick(roomCode: string, playerId: string, championId: string, cb?: (res: any) => void) {
    this.emitAction('lock_pick', { roomCode, playerId, championId }, cb);
  }

  public draftSelect(roomCode: string, playerId: string, championId: string) {
    this.emitAction('draft_select', { roomCode, playerId, championId });
  }

  public setSummonerSpell(roomCode: string, playerId: string, spellId: SummonerSpellId, cb?: (res: any) => void) {
    this.emitAction('set_summoner_spell', { roomCode, playerId, spellId }, cb);
  }

  public moveChampion(roomCode: string, playerId: string, targetX: number, targetY: number, cb?: (res: any) => void) {
    this.emitAction('move_champion', { roomCode, playerId, targetX, targetY }, cb);
  }

  public undoMove(roomCode: string, playerId: string, cb?: (res: any) => void) {
    this.emitAction('undo_move', { roomCode, playerId }, cb);
  }

  public basicAttack(roomCode: string, playerId: string, targetType: string, targetId: string, cb?: (res: any) => void) {
    this.emitAction('basic_attack', { roomCode, playerId, targetType, targetId }, cb);
  }

  public castAbility(
    roomCode: string,
    playerId: string,
    abilityKey: string,
    targetX?: number,
    targetY?: number,
    targetUnitId?: string,
    cb?: (res: any) => void
  ) {
    this.emitAction('cast_ability', { roomCode, playerId, abilityKey, targetX, targetY, targetUnitId }, cb);
  }

  public moveDecoy(roomCode: string, playerId: string, decoyId: string, targetX: number, targetY: number, cb?: (res: any) => void) {
    this.emitAction('move_decoy', { roomCode, playerId, decoyId, targetX, targetY }, cb);
  }

  public useSummonerSpell(
    roomCode: string,
    playerId: string,
    targetX?: number,
    targetY?: number,
    targetPlayerId?: string,
    cb?: (res: any) => void
  ) {
    this.emitAction('use_summoner_spell', { roomCode, playerId, targetX, targetY, targetPlayerId }, cb);
  }

  public buyItem(roomCode: string, playerId: string, itemId: ItemId, cb?: (res: any) => void) {
    this.emitAction('buy_item', { roomCode, playerId, itemId }, cb);
  }

  public sellItem(roomCode: string, playerId: string, itemIndex: number, cb?: (res: any) => void) {
    this.emitAction('sell_item', { roomCode, playerId, itemIndex }, cb);
  }

  public undoBuyItem(roomCode: string, playerId: string, cb?: (res: any) => void) {
    this.emitAction('undo_buy_item', { roomCode, playerId }, cb);
  }

  public useItem(roomCode: string, playerId: string, itemId: ItemId, cb?: (res: any) => void) {
    this.emitAction('use_item', { roomCode, playerId, itemId }, cb);
  }

  public passTurn(roomCode: string, playerId: string, cb?: (res: any) => void) {
    this.emitAction('pass_turn', { roomCode, playerId }, cb);
  }

  public playAgain(roomCode: string, cb?: (res: any) => void) {
    this.emitAction('play_again', { roomCode }, cb);
  }

  public leaveRoom(callback?: (res: any) => void) {
    const prevRoom = this.activeRoomCode;
    const prevPlayer = this.activePlayerId;
    this.activeRoomCode = null;
    this.activePlayerId = null;

    if (this.currentMode === 'server' && this.socket?.connected) {
      this.socket.emit('leave_room', { roomCode: prevRoom, playerId: prevPlayer }, callback);
    } else if (this.localEngine && prevRoom) {
      this.localEngine.leaveRoom(prevRoom, prevPlayer || undefined);
      if (callback) callback({ success: true });
    } else {
      if (callback) callback({ success: true });
    }
  }

  public setActiveRoom(roomCode: string | null, playerId: string | null = null) {
    this.activeRoomCode = roomCode;
    this.activePlayerId = playerId;
  }
}

let networkClientInstance: GameNetworkClient | null = null;

export function getGameNetwork(): GameNetworkClient {
  if (!networkClientInstance) {
    networkClientInstance = new GameNetworkClient();
  }
  return networkClientInstance;
}
