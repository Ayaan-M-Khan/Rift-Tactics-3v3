'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { GameRoomState, ItemId, Role, SummonerSpellId, Team } from '../types/game';
import { getSocket, loadSession, saveSession, clearGameSession } from '../lib/socket';
import { GameEngine } from '../server/gameEngine';
import { TitleScreen } from '../components/TitleScreen';
import { LobbyScreen } from '../components/LobbyScreen';
import { DraftScreen } from '../components/DraftScreen';
import { GameCanvas, TargetSelectionMode } from '../components/GameCanvas';
import { CombatHUD } from '../components/CombatHUD';
import { sounds } from '../lib/soundEngine';

export default function RiftTacticsPage() {
  const [room, setRoom] = useState<GameRoomState | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [targetMode, setTargetMode] = useState<TargetSelectionMode>({ type: 'none' });
  const [spectatorTargetId, setSpectatorTargetId] = useState<string | undefined>(undefined);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isServerConnected, setIsServerConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = loadSession();
      return !!(saved && saved.sessionToken);
    }
    return false;
  });

  const localEngineRef = useRef<GameEngine | null>(null);

  // Initialize socket and attempt session restore
  useEffect(() => {
    const socket = getSocket();

    const handleRoomUpdated = (updatedRoom: GameRoomState) => {
      setRoom(updatedRoom);
      setIsLoading(false);
    };

    const handleConnect = () => {
      setConnectionError(null);
      setIsServerConnected(true);

      // Automatically emit reconnect_session using stored sessionToken and roomCode to restore game state
      const saved = loadSession();
      if (saved && saved.sessionToken) {
        socket.emit(
          'reconnect_session',
          { sessionToken: saved.sessionToken, roomCode: saved.roomCode },
          (res: { success: boolean; room?: GameRoomState; player?: { id: string } }) => {
            if (res && res.success && res.room && res.player) {
              setRoom(res.room);
              setPlayerId(res.player.id);
            }
            setIsLoading(false);
          }
        );
      } else {
        setIsLoading(false);
      }
    };

    const handleConnectError = () => {
      setIsServerConnected(false);
      setConnectionError('Multiplayer server offline. Solo / VS AI mode is active.');
      setIsLoading(false);
    };

    const handleDisconnect = (reason: string) => {
      setIsServerConnected(false);
      if (reason === 'io server disconnect') {
        socket.connect();
      }
      setConnectionError('Network connection interrupted. Reconnecting...');
    };

    socket.on('room_updated', handleRoomUpdated);
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.off('room_updated', handleRoomUpdated);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);

  // 1. Create Room
  const handleCreateRoom = (hostName: string) => {
    setConnectionError(null);
    if (!isServerConnected) {
      const engine = new GameEngine((updatedRoom) => {
        setRoom({ ...updatedRoom });
      });
      localEngineRef.current = engine;
      const res = engine.createRoom(hostName);
      setRoom(res.room);
      setPlayerId(res.playerId);
      return;
    }

    const socket = getSocket();
    socket.emit('create_room', { hostName }, (res: { room: GameRoomState; playerId: string; sessionToken: string }) => {
      if (res && res.room) {
        localEngineRef.current = null;
        setRoom(res.room);
        setPlayerId(res.playerId);
        saveSession({
          roomCode: res.room.roomCode,
          playerId: res.playerId,
          sessionToken: res.sessionToken,
          playerName: hostName,
        });
      }
    });
  };

  // 2. Join Room
  const handleJoinRoom = (roomCode: string, playerName: string) => {
    setConnectionError(null);
    if (!isServerConnected) {
      setConnectionError('Multiplayer server offline. Solo / VS AI mode is active.');
      return;
    }
    const socket = getSocket();
    socket.emit(
      'join_room',
      { roomCode, playerName },
      (res: { success: boolean; room?: GameRoomState; playerId?: string; sessionToken?: string; error?: string }) => {
        if (res.success && res.room && res.playerId && res.sessionToken) {
          localEngineRef.current = null;
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
    if (!isServerConnected) {
      // Mode B: In-Browser Offline / Solo Engine Fallback
      const engine = new GameEngine((updatedRoom) => {
        setRoom({ ...updatedRoom });
      });
      localEngineRef.current = engine;
      const res = engine.createRoom(hostName);
      setRoom(res.room);
      setPlayerId(res.playerId);

      // Automatically trigger start draft with bots enabled
      setTimeout(() => {
        engine.startDraft(res.room.roomCode, res.playerId);
      }, 150);
      return;
    }

    // Mode A: Server Multiplayer
    const socket = getSocket();
    socket.emit('create_room', { hostName }, (res: { room: GameRoomState; playerId: string; sessionToken: string }) => {
      if (res && res.room) {
        localEngineRef.current = null;
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
          socket.emit('start_draft', { roomCode: res.room.roomCode, hostPlayerId: res.playerId });
        }, 150);
      }
    });
  };

  // Lobby actions
  const handleUpdateSlot = (team: Team, role: Role) => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.updateLobbySlot(room.roomCode, playerId, team, role);
      return;
    }
    const socket = getSocket();
    socket.emit('update_lobby_slot', { roomCode: room.roomCode, playerId, team, role });
  };

  const handleToggleBotFill = () => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.toggleBotFill(room.roomCode, playerId);
      return;
    }
    const socket = getSocket();
    socket.emit('toggle_bot_fill', { roomCode: room.roomCode, playerId });
  };

  const handleKickPlayer = (targetPlayerId: string) => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.kickPlayer(room.roomCode, playerId, targetPlayerId);
      return;
    }
    const socket = getSocket();
    socket.emit('kick_player', { roomCode: room.roomCode, hostPlayerId: playerId, targetPlayerId });
  };

  const handleStartDraft = () => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.startDraft(room.roomCode, playerId);
      return;
    }
    const socket = getSocket();
    socket.emit('start_draft', { roomCode: room.roomCode, hostPlayerId: playerId });
  };

  // Draft actions
  const handleLockBan = (championId: string) => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.lockBan(room.roomCode, playerId, championId);
      return;
    }
    const socket = getSocket();
    socket.emit('lock_ban', { roomCode: room.roomCode, playerId, championId });
  };

  const handleLockPick = (championId: string) => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.lockPick(room.roomCode, playerId, championId);
      return;
    }
    const socket = getSocket();
    socket.emit('lock_pick', { roomCode: room.roomCode, playerId, championId });
  };

  const handleSelectSpell = (spellId: SummonerSpellId) => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.setSummonerSpell(room.roomCode, playerId, spellId);
      return;
    }
    const socket = getSocket();
    socket.emit('set_summoner_spell', { roomCode: room.roomCode, playerId, spellId });
  };

  // Combat actions
  const handleUndoMove = () => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.undoMove(room.roomCode, playerId);
      return;
    }
    const socket = getSocket();
    socket.emit('undo_move', { roomCode: room.roomCode, playerId });
  };

  const handlePassTurn = () => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.passTurn(room.roomCode, playerId);
      return;
    }
    const socket = getSocket();
    socket.emit('pass_turn', { roomCode: room.roomCode, playerId });
  };

  const handleBuyItem = (itemId: ItemId) => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.buyItem(room.roomCode, playerId, itemId);
      return;
    }
    const socket = getSocket();
    socket.emit('buy_item', { roomCode: room.roomCode, playerId, itemId });
  };

  const handleUseItem = (itemId: ItemId) => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.useItem(room.roomCode, playerId, itemId);
      return;
    }
    const socket = getSocket();
    socket.emit('use_item', { roomCode: room.roomCode, playerId, itemId });
  };

  const handlePlayAgain = () => {
    if (!room) return;
    if (localEngineRef.current) {
      localEngineRef.current.playAgain(room.roomCode);
      return;
    }
    const socket = getSocket();
    socket.emit('play_again', { roomCode: room.roomCode });
  };

  // Canvas Tile Click handler
  const handleTileClick = useCallback(
    (x: number, y: number, unitId?: string, unitType?: 'champion' | 'minion' | 'turret') => {
      if (!room || room.activePlayerId !== playerId) return;

      if (localEngineRef.current) {
        if (targetMode.type === 'move') {
          sounds.playClick();
          localEngineRef.current.moveChampion(room.roomCode, playerId, x, y);
          setTargetMode({ type: 'none' });
        } else if (targetMode.type === 'attack') {
          if (unitType && unitId) {
            sounds.playAttack();
            localEngineRef.current.basicAttack(room.roomCode, playerId, unitType, unitId);
            setTargetMode({ type: 'none' });
          }
        } else if (targetMode.type === 'ability' && targetMode.abilityKey) {
          sounds.playSpell();
          localEngineRef.current.castAbility(room.roomCode, playerId, targetMode.abilityKey, x, y, unitId);
          setTargetMode({ type: 'none' });
        } else if (targetMode.type === 'spell') {
          sounds.playFlash();
          localEngineRef.current.useSummonerSpell(room.roomCode, playerId, x, y, unitType === 'champion' ? unitId : undefined);
          setTargetMode({ type: 'none' });
        }
        return;
      }

      const socket = getSocket();

      if (targetMode.type === 'move') {
        sounds.playClick();
        socket.emit('move_champion', { roomCode: room.roomCode, playerId, targetX: x, targetY: y });
        setTargetMode({ type: 'none' });
      } else if (targetMode.type === 'attack') {
        if (unitType && unitId) {
          sounds.playAttack();
          socket.emit('basic_attack', {
            roomCode: room.roomCode,
            playerId,
            targetType: unitType,
            targetId: unitId,
          });
          setTargetMode({ type: 'none' });
        }
      } else if (targetMode.type === 'ability' && targetMode.abilityKey) {
        sounds.playSpell();
        socket.emit('cast_ability', {
          roomCode: room.roomCode,
          playerId,
          abilityKey: targetMode.abilityKey,
          targetX: x,
          targetY: y,
          targetUnitId: unitId,
        });
        setTargetMode({ type: 'none' });
      } else if (targetMode.type === 'spell') {
        sounds.playFlash();
        socket.emit('use_summoner_spell', {
          roomCode: room.roomCode,
          playerId,
          targetX: x,
          targetY: y,
          targetPlayerId: unitType === 'champion' ? unitId : undefined,
        });
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
            className="text-rose-400 hover:text-white transition-colors text-sm font-bold px-1"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {isLoading ? (
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
              clearGameSession();
              localEngineRef.current = null;
              setIsLoading(false);
            }}
            className="px-4 py-1.5 rounded bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium border border-zinc-700/60 transition-colors"
          >
            Cancel & Return to Title
          </button>
        </div>
      ) : !room ? (
        <TitleScreen
          isServerConnected={isServerConnected}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuickSolo={handleQuickSolo}
        />
      ) : room.phase === 'lobby' ? (
        <LobbyScreen
          room={room}
          currentPlayerId={playerId}
          onUpdateSlot={handleUpdateSlot}
          onToggleBotFill={handleToggleBotFill}
          onKickPlayer={handleKickPlayer}
          onStartDraft={handleStartDraft}
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
