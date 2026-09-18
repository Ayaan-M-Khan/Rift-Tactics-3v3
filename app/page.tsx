'use client';

import React, { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { GameRoomState, ItemId, Role, SummonerSpellId, Team } from '../types/game';
import { loadSession, saveSession, clearGameSession, reconnectWithUrl } from '../lib/socket';
import { getGameNetwork, NetworkMode, NetworkStatus } from '../lib/gameNetwork';
import { TitleScreen } from '../components/TitleScreen';
import { LobbyScreen } from '../components/LobbyScreen';
import { DraftScreen } from '../components/DraftScreen';
import { GameCanvas, TargetSelectionMode } from '../components/GameCanvas';
import { CombatHUD } from '../components/CombatHUD';
import { sounds } from '../lib/soundEngine';

const emptySubscribe = () => () => {};

export default function RiftTacticsPage() {
  const [room, setRoom] = useState<GameRoomState | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [targetMode, setTargetMode] = useState<TargetSelectionMode>({ type: 'none' });
  const [spectatorTargetId, setSpectatorTargetId] = useState<string | undefined>(undefined);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const defaultNetworkStatus: NetworkStatus = {
    connected: false,
    connecting: true,
    mode: 'server',
    serverUrl: '',
    errorMessage: null,
  };

  const networkStatus = useSyncExternalStore(
    (callback) => {
      const network = getGameNetwork();
      return network.onStatusChange(callback);
    },
    () => getGameNetwork().getStatus(),
    () => defaultNetworkStatus
  );

  const isServerConnected = networkStatus.connected;
  const isServerConnecting = networkStatus.connecting;
  const networkMode = networkStatus.mode;
  const serverErrorMessage = networkStatus.errorMessage;

  const isHydrated = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const initialRoomCode = useSyncExternalStore(
    emptySubscribe,
    () => {
      if (typeof window === 'undefined') return '';
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room') || params.get('join');
      return roomParam ? roomParam.trim().toUpperCase() : '';
    },
    () => ''
  );
  const hasSavedSession = useSyncExternalStore(
    emptySubscribe,
    () => {
      const saved = loadSession();
      return !!(saved && saved.sessionToken);
    },
    () => false
  );
  const [reconnectFinished, setReconnectFinished] = useState(false);
  const isLoading = isHydrated && hasSavedSession && !reconnectFinished && !room;

  // Initialize unified network client (Socket.IO + Local Cross-Tab Mesh)
  useEffect(() => {
    const network = getGameNetwork();
    const savedSession = loadSession();

    const unsubRoom = network.onRoomUpdated((updatedRoom: GameRoomState) => {
      setRoom((prev) => {
        // Enforce connecting to only the latest active room
        if (prev && prev.roomCode !== updatedRoom.roomCode) {
          return prev;
        }
        return updatedRoom;
      });
      setReconnectFinished(true);
    });

    // Auto reconnect if session saved
    if (savedSession && savedSession.sessionToken) {
      network.setActiveRoom(savedSession.roomCode, savedSession.playerId);
      network.reconnectSession(
        savedSession.sessionToken,
        savedSession.roomCode,
        (res: { success: boolean; room?: GameRoomState; player?: { id: string } }) => {
          if (res && res.success && res.room && res.player) {
            setRoom(res.room);
            setPlayerId(res.player.id);
          } else {
            clearGameSession();
            network.setActiveRoom(null, null);
            setRoom(null);
            setPlayerId('');
          }
          setReconnectFinished(true);
        }
      );
    }

    return () => {
      unsubRoom();
    };
  }, []);

  // Leave room and reset back to title screen
  const handleLeaveRoom = () => {
    const network = getGameNetwork();
    network.leaveRoom();
    clearGameSession();
    setRoom(null);
    setPlayerId('');
    setReconnectFinished(true);
  };

  // 1. Create Room
  const handleCreateRoom = (hostName: string) => {
    setConnectionError(null);
    const network = getGameNetwork();
    network.createRoom(hostName, (res: { room?: GameRoomState; playerId?: string; sessionToken?: string; error?: string }) => {
      if (res && res.room && res.playerId && res.sessionToken) {
        setRoom(res.room);
        setPlayerId(res.playerId);
        saveSession({
          roomCode: res.room.roomCode,
          playerId: res.playerId,
          sessionToken: res.sessionToken,
          playerName: hostName,
        });
      } else if (res?.error) {
        setConnectionError(res.error);
      }
    });
  };

  // 2. Join Room
  const handleJoinRoom = (roomCode: string, playerName: string) => {
    setConnectionError(null);
    const network = getGameNetwork();
    network.joinRoom(
      roomCode,
      playerName,
      (res: { success: boolean; room?: GameRoomState; playerId?: string; sessionToken?: string; error?: string }) => {
        if (res.success && res.room && res.playerId && res.sessionToken) {
          setRoom(res.room);
          setPlayerId(res.playerId);
          saveSession({
            roomCode: res.room.roomCode,
            playerId: res.playerId,
            sessionToken: res.sessionToken,
            playerName,
          });
        } else {
          setConnectionError(res.error || 'Failed to join room');
        }
      }
    );
  };

  // 3. Quick Solo vs Bots (Play vs AI)
  const handleQuickSolo = (hostName: string) => {
    setConnectionError(null);
    const network = getGameNetwork();
    network.createRoom(hostName, (res: { room: GameRoomState; playerId: string; sessionToken: string }) => {
      if (res && res.room) {
        setRoom(res.room);
        setPlayerId(res.playerId);
        saveSession({
          roomCode: res.room.roomCode,
          playerId: res.playerId,
          sessionToken: res.sessionToken,
          playerName: hostName,
        });

        // Automatically trigger start draft with bots enabled
        setTimeout(() => {
          network.startDraft(res.room.roomCode, res.playerId);
        }, 150);
      }
    });
  };

  const handleSaveSocketUrl = (newUrl: string) => {
    reconnectWithUrl(newUrl);
    window.location.reload();
  };

  // Lobby actions
  const handleUpdateSlot = (team: Team, role: Role) => {
    if (!room) return;
    getGameNetwork().updateLobbySlot(room.roomCode, playerId, team, role);
  };

  const handleToggleBotFill = () => {
    if (!room) return;
    getGameNetwork().toggleBotFill(room.roomCode, playerId);
  };

  const handleKickPlayer = (targetPlayerId: string) => {
    if (!room) return;
    getGameNetwork().kickPlayer(room.roomCode, playerId, targetPlayerId);
  };

  const handleStartDraft = () => {
    if (!room) return;
    getGameNetwork().startDraft(room.roomCode, playerId);
  };

  // Draft actions
  const handleLockBan = (championId: string) => {
    if (!room) return;
    getGameNetwork().lockBan(room.roomCode, playerId, championId);
  };

  const handleLockPick = (championId: string) => {
    if (!room) return;
    getGameNetwork().lockPick(room.roomCode, playerId, championId);
  };

  const handleSelectSpell = (spellId: SummonerSpellId) => {
    if (!room) return;
    getGameNetwork().setSummonerSpell(room.roomCode, playerId, spellId);
  };

  // Combat actions
  const handleUndoMove = () => {
    if (!room) return;
    getGameNetwork().undoMove(room.roomCode, playerId);
  };

  const handlePassTurn = () => {
    if (!room) return;
    getGameNetwork().passTurn(room.roomCode, playerId);
  };

  const handleBuyItem = (itemId: ItemId) => {
    if (!room) return;
    getGameNetwork().buyItem(room.roomCode, playerId, itemId);
  };

  const handleSellItem = (itemIndex: number) => {
    if (!room) return;
    getGameNetwork().sellItem(room.roomCode, playerId, itemIndex);
  };

  const handleUndoBuyItem = () => {
    if (!room) return;
    getGameNetwork().undoBuyItem(room.roomCode, playerId);
  };

  const handleUseItem = (itemId: ItemId) => {
    if (!room) return;
    getGameNetwork().useItem(room.roomCode, playerId, itemId);
  };

  const handlePlayAgain = () => {
    if (!room) return;
    getGameNetwork().playAgain(room.roomCode);
  };

  // Canvas Tile Click handler
  const handleTileClick = useCallback(
    (x: number, y: number, unitId?: string, unitType?: 'champion' | 'minion' | 'turret') => {
      if (!room || room.activePlayerId !== playerId) return;

      const network = getGameNetwork();

      if (targetMode.type === 'move') {
        sounds.playClick();
        network.moveChampion(room.roomCode, playerId, x, y);
        setTargetMode({ type: 'none' });
      } else if (targetMode.type === 'attack') {
        if (unitType && unitId) {
          sounds.playAttack();
          network.basicAttack(room.roomCode, playerId, unitType, unitId);
          setTargetMode({ type: 'none' });
        }
      } else if (targetMode.type === 'ability' && targetMode.abilityKey) {
        sounds.playSpell();
        network.castAbility(room.roomCode, playerId, targetMode.abilityKey, x, y, unitId);
        setTargetMode({ type: 'none' });
      } else if (targetMode.type === 'spell') {
        sounds.playFlash();
        network.useSummonerSpell(room.roomCode, playerId, x, y, unitType === 'champion' ? unitId : undefined);
        setTargetMode({ type: 'none' });
      }
    },
    [playerId, room, targetMode]
  );

  return (
    <main className="w-screen h-[100dvh] max-h-[100dvh] flex flex-col overflow-hidden bg-[#04090d] text-[#f0e6d2]">
      {connectionError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-rose-950/90 border border-rose-500/80 text-rose-200 px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xl flex items-center gap-3 backdrop-blur-md">
          <span>{connectionError}</span>
          <button
            onClick={() => setConnectionError(null)}
            className="text-rose-400 hover:text-white transition-colors text-sm font-bold px-1 cursor-pointer"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {!isHydrated ? (
        <TitleScreen
          isServerConnected={isServerConnected}
          isServerConnecting={isServerConnecting}
          networkMode={networkMode}
          serverErrorMessage={serverErrorMessage}
          initialRoomCode=""
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuickSolo={handleQuickSolo}
          onSaveSocketUrl={handleSaveSocketUrl}
        />
      ) : isLoading ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#050b10] px-4">
          <div className="relative flex items-center justify-center mb-6">
            <div className="w-16 h-16 rounded-full border-2 border-[#0ac8b9]/30 border-t-[#0ac8b9] animate-spin" />
            <div className="absolute text-xl">⚔️</div>
          </div>
          <h2 className="text-xl font-bold tracking-widest text-[#f0e6d2] uppercase font-serif mb-1">
            Rift Tactics
          </h2>
          <p className="text-xs text-[#0ac8b9] tracking-wider uppercase mb-6 font-mono">
            Connecting to Summoner&apos;s Rift...
          </p>
          <button
            onClick={() => {
              handleLeaveRoom();
            }}
            className="px-4 py-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium border border-zinc-700/60 transition-colors cursor-pointer"
          >
            Cancel & Return to Title
          </button>
        </div>
      ) : !room ? (
        <TitleScreen
          isServerConnected={isServerConnected}
          isServerConnecting={isServerConnecting}
          networkMode={networkMode}
          serverErrorMessage={serverErrorMessage}
          initialRoomCode={initialRoomCode}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuickSolo={handleQuickSolo}
          onSaveSocketUrl={handleSaveSocketUrl}
        />
      ) : room.phase === 'lobby' ? (
        <LobbyScreen
          room={room}
          currentPlayerId={playerId}
          onUpdateSlot={handleUpdateSlot}
          onToggleBotFill={handleToggleBotFill}
          onKickPlayer={handleKickPlayer}
          onStartDraft={handleStartDraft}
          onLeaveLobby={handleLeaveRoom}
        />
      ) : room.phase === 'ban' || room.phase === 'pick' ? (
        <DraftScreen
          room={room}
          currentPlayerId={playerId}
          onLockBan={handleLockBan}
          onLockPick={handleLockPick}
          onSelectSpell={handleSelectSpell}
        />
      ) : (
        <div className="relative w-full h-full">
          <GameCanvas
            room={room}
            currentPlayerId={playerId}
            targetMode={targetMode}
            onTileClick={handleTileClick}
            spectatorTargetId={spectatorTargetId}
            onSelectSpectatorTarget={(id) => setSpectatorTargetId(id)}
          />
          <CombatHUD
            room={room}
            currentPlayerId={playerId}
            targetMode={targetMode}
            setTargetMode={setTargetMode}
            onUndoMove={handleUndoMove}
            onPassTurn={handlePassTurn}
            onBuyItem={handleBuyItem}
            onSellItem={handleSellItem}
            onUndoBuyItem={handleUndoBuyItem}
            onUseItem={handleUseItem}
            onPlayAgain={handlePlayAgain}
            spectatorTargetId={spectatorTargetId}
            onSelectSpectatorTarget={(id) => setSpectatorTargetId(id)}
          />
        </div>
      )}
    </main>
  );
}
