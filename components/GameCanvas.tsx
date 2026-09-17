'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChampionState, GameRoomState, Team } from '../types/game';
import {
  BLUE_TURRET_POS,
  BRAZIERS,
  BRUSH_TILES,
  getDistance,
  getLineTiles,
  isTileWalkable,
  MAP_GRID,
  MAP_HEIGHT,
  MAP_WIDTH,
  RED_TURRET_POS,
  RIVER_TILES,
  LANE_TILES,
} from '../data/map';
import { CHAMPIONS } from '../data/champions';
import { sounds } from '../lib/soundEngine';
import {
  Sparkles,
  Swords,
  Zap,
  Shield,
  Flame,
  Camera as CameraIcon,
  Lock,
  Unlock,
  Crosshair,
  Focus,
  Eye,
} from 'lucide-react';

export interface Camera {
  x: number; // Center world X position
  y: number; // Center world Y position
  zoom: number; // Default 1.0 (or scalable)
  isLocked: boolean; // True: locked to client champion; False: free look
}

export interface TargetSelectionMode {
  type: 'none' | 'move' | 'attack' | 'ability' | 'spell';
  abilityKey?: 'Q' | 'W' | 'E' | 'R';
  range?: number;
  targetType?: 'single_enemy' | 'single_ally' | 'self' | 'line' | 'cone' | 'aoe' | 'dash_target' | 'tile' | 'enemy' | 'ally';
  areaRadius?: number;
}

export interface AnimatedDamageNumber {
  id: string;
  text: string;
  amount: number;
  worldX: number; // in world pixels
  worldY: number; // in world pixels
  color: string;
  secondaryColor?: string;
  strokeColor: string;
  fontSize: number;
  isCrit: boolean;
  isHeal: boolean;
  isShield: boolean;
  isGold: boolean;
  isStatus: boolean;
  createdAt: number;
  durationMs: number;
  vx: number; // slight horizontal drift
  maxScale: number;
}

export interface ImpactParticle {
  id: string;
  worldX: number;
  worldY: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  createdAt: number;
  durationMs: number;
  isStar: boolean;
}

export interface ImpactRing {
  id: string;
  worldX: number;
  worldY: number;
  color: string;
  maxRadius: number;
  createdAt: number;
  durationMs: number;
}

export interface RecentDamageEvent {
  id: string;
  targetName: string;
  amountText: string;
  type: 'physical' | 'magic' | 'true' | 'crit' | 'heal' | 'shield' | 'gold' | 'status';
  color: string;
  timestamp: number;
}

interface GameCanvasProps {
  room: GameRoomState;
  currentPlayerId: string;
  targetMode: TargetSelectionMode;
  onTileClick: (x: number, y: number, unitId?: string, unitType?: 'champion' | 'minion' | 'turret') => void;
  spectatorTargetId?: string;
  onSelectSpectatorTarget?: (targetId: string) => void;
  isCameraLocked?: boolean;
  onToggleCameraLock?: () => void;
  onSetCameraLocked?: (locked: boolean) => void;
  centerCameraTrigger?: number;
}

export function GameCanvas({
  room,
  currentPlayerId,
  targetMode,
  onTileClick,
  spectatorTargetId,
  onSelectSpectatorTarget,
  isCameraLocked: isCameraLockedProp,
  onToggleCameraLock,
  onSetCameraLocked,
  centerCameraTrigger,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);

  const TILE_SIZE = 56; // 56px per tactical grid tile

  const me = room.champions[currentPlayerId];
  const myTeam: Team = me ? me.team : (room.players.find((p) => p.id === currentPlayerId)?.team || 'blue');

  // --- 1. DYNAMIC CAMERA SYSTEM (CENTERED PROJECTION) ---
  const initialLock = isCameraLockedProp !== undefined ? isCameraLockedProp : true;
  const [localLocked, setLocalLocked] = useState(initialLock);
  const isLocked = isCameraLockedProp !== undefined ? isCameraLockedProp : localLocked;

  const cameraRef = useRef<Camera>({
    x: (MAP_WIDTH * TILE_SIZE) / 2,
    y: (MAP_HEIGHT * TILE_SIZE) / 2,
    zoom: 1.0,
    isLocked,
  });

  useEffect(() => {
    cameraRef.current.isLocked = isLocked;
  }, [isLocked]);

  const isSpaceHeldRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isMinimapDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mousePosRef = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });
  const mouseInCanvasRef = useRef(false);
  const [hoveredTile, setHoveredTile] = useState<{ x: number; y: number } | null>(null);

  // Turn alert banner state
  const prevActivePlayerRef = useRef<string | null | undefined>(null);
  const [turnBannerMessage, setTurnBannerMessage] = useState<string | null>(null);

  // Center camera trigger prop from parent
  useEffect(() => {
    if (centerCameraTrigger !== undefined && centerCameraTrigger > 0) {
      if (me && !me.isDead) {
        cameraRef.current.x = me.x * TILE_SIZE + TILE_SIZE / 2;
        cameraRef.current.y = me.y * TILE_SIZE + TILE_SIZE / 2;
      }
    }
  }, [centerCameraTrigger, me, TILE_SIZE]);

  // Clamp camera position to prevent panning outside boundaries
  const clampCamera = useCallback((cx: number, cy: number) => {
    const marginX = TILE_SIZE * 2;
    const marginY = TILE_SIZE * 2;
    const minX = marginX;
    const maxX = MAP_WIDTH * TILE_SIZE - marginX;
    const minY = marginY;
    const maxY = MAP_HEIGHT * TILE_SIZE - marginY;
    return {
      x: Math.max(minX, Math.min(maxX, cx)),
      y: Math.max(minY, Math.min(maxY, cy)),
    };
  }, [TILE_SIZE]);

  // Center camera on specific tile (smooth target or snap)
  const centerCameraOn = useCallback((tileX: number, tileY: number, snap = false) => {
    const targetPxX = tileX * TILE_SIZE + TILE_SIZE / 2;
    const targetPxY = tileY * TILE_SIZE + TILE_SIZE / 2;
    const clamped = clampCamera(targetPxX, targetPxY);
    if (snap) {
      cameraRef.current.x = clamped.x;
      cameraRef.current.y = clamped.y;
    } else {
      cameraRef.current.x += (clamped.x - cameraRef.current.x) * 0.4;
      cameraRef.current.y += (clamped.y - cameraRef.current.y) * 0.4;
    }
  }, [clampCamera, TILE_SIZE]);

  // Initial camera center on spawn
  useEffect(() => {
    if (me) {
      centerCameraOn(me.x, me.y, true);
    } else {
      centerCameraOn(12, 6, true);
    }
  }, [centerCameraOn, me]);

  // --- 2. ENFORCED TURN LOCK & TURN PROMPTS ---
  useEffect(() => {
    if (prevActivePlayerRef.current !== room.activePlayerId) {
      if (room.activePlayerId === currentPlayerId) {
        cameraRef.current.isLocked = true;
        sounds.playSpell();

        const timer = setTimeout(() => {
          setLocalLocked(true);
          if (onSetCameraLocked) onSetCameraLocked(true);
          setTurnBannerMessage('Your Turn - Camera Locked');
        }, 0);

        const hideTimer = setTimeout(() => {
          setTurnBannerMessage(null);
        }, 2600);

        return () => {
          clearTimeout(timer);
          clearTimeout(hideTimer);
        };
      }
    }
    prevActivePlayerRef.current = room.activePlayerId;
  }, [room.activePlayerId, currentPlayerId, onSetCameraLocked]);

  // Toggle Camera Lock helper
  const handleToggleLock = useCallback(() => {
    const nextLocked = !isLocked;
    cameraRef.current.isLocked = nextLocked;
    setLocalLocked(nextLocked);
    if (onToggleCameraLock) onToggleCameraLock();
    if (onSetCameraLocked) onSetCameraLocked(nextLocked);
    sounds.playClick();
  }, [isLocked, onToggleCameraLock, onSetCameraLocked]);

  // Recenter on Champion helper
  const handleRecenterOnMe = useCallback(() => {
    if (me && !me.isDead) {
      centerCameraOn(me.x, me.y, false);
    } else if (spectatorTargetId && room.champions[spectatorTargetId]) {
      const spec = room.champions[spectatorTargetId];
      centerCameraOn(spec.x, spec.y, false);
    }
    sounds.playClick();
  }, [centerCameraOn, me, room.champions, spectatorTargetId]);

  // Keyboard Shortcuts: Y (Toggle Lock) and Spacebar (Hold/Press to Center)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'KeyY') {
        e.preventDefault();
        handleToggleLock();
      } else if (e.code === 'Space') {
        e.preventDefault();
        isSpaceHeldRef.current = true;
        handleRecenterOnMe();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceHeldRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleToggleLock, handleRecenterOnMe]);

  // --- FLOATING DAMAGE NUMBERS & COMBAT OVERLAY ENGINE ---
  const floatingNumbersRef = useRef<AnimatedDamageNumber[]>([]);
  const impactParticlesRef = useRef<ImpactParticle[]>([]);
  const impactRingsRef = useRef<ImpactRing[]>([]);
  const processedFloatingTextIds = useRef<Set<string>>(new Set());
  const hurtVignetteUntilRef = useRef<number>(0);
  const [damageNumbersEnabled, setDamageNumbersEnabled] = useState(true);
  const damageNumbersEnabledRef = useRef(true);
  useEffect(() => {
    damageNumbersEnabledRef.current = damageNumbersEnabled;
  }, [damageNumbersEnabled]);
  const [showDamageFeed, setShowDamageFeed] = useState(true);
  const [recentDamageEvents, setRecentDamageEvents] = useState<RecentDamageEvent[]>([]);

  // Snapshot of units to detect HP losses in real-time
  const prevUnitsRef = useRef<{
    champions: Record<string, { hp: number; shield: number; x: number; y: number; name: string }>;
    minions: Record<string, { hp: number; x: number; y: number; team: Team }>;
    turrets: Record<string, { hp: number; x: number; y: number }>;
  }>({ champions: {}, minions: {}, turrets: {} });

  // Helper to spawn impact particles
  const spawnImpactParticles = useCallback((wx: number, wy: number, color: string, isCrit: boolean, count = 7) => {
    const num = isCrit ? count + 5 : count;
    const particles: ImpactParticle[] = [];
    for (let i = 0; i < num; i++) {
      const angle = (Math.PI * 2 * i) / num + (Math.random() * 0.4 - 0.2);
      const speed = (isCrit ? 2.8 : 1.8) + Math.random() * 2.2;
      particles.push({
        id: 'pt_' + Math.random().toString(36).substring(2, 9),
        worldX: wx,
        worldY: wy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (isCrit ? 1.6 : 0.9),
        color: isCrit && Math.random() > 0.4 ? '#fef08a' : color,
        radius: isCrit ? 2.8 + Math.random() * 2.2 : 2.0 + Math.random() * 1.6,
        createdAt: Date.now(),
        durationMs: 380 + Math.random() * 180,
        isStar: isCrit || Math.random() > 0.5,
      });
    }
    impactParticlesRef.current.push(...particles);
  }, []);

  // Helper to spawn impact rings
  const spawnImpactRing = useCallback((wx: number, wy: number, color: string, isCrit: boolean) => {
    impactRingsRef.current.push({
      id: 'rng_' + Math.random().toString(36).substring(2, 9),
      worldX: wx,
      worldY: wy,
      color,
      maxRadius: isCrit ? 36 : 24,
      createdAt: Date.now(),
      durationMs: 340,
    });
  }, []);

  // Spawn damage number instance
  const spawnFloatingDamageNumber = useCallback((params: {
    id?: string;
    text: string;
    amount?: number;
    tileX: number;
    tileY: number;
    color: string;
    targetName?: string;
    isCrit?: boolean;
    isHeal?: boolean;
    isShield?: boolean;
    isGold?: boolean;
    isStatus?: boolean;
  }) => {
    if (!damageNumbersEnabledRef.current) return;

    const wx = params.tileX * TILE_SIZE + TILE_SIZE / 2 + (Math.random() * 16 - 8);
    const wy = params.tileY * TILE_SIZE + 16;
    const isCrit = !!params.isCrit || params.text.includes('CRIT') || params.color === '#fbbf24';
    const isHeal = !!params.isHeal || (params.text.startsWith('+') && !params.text.includes('Shield') && !params.text.includes('g') && !params.text.includes('Speed'));
    const isShield = !!params.isShield || params.text.includes('Shield');
    const isGold = !!params.isGold || params.text.includes('g');
    const isStatus = !!params.isStatus || (!params.text.startsWith('-') && !params.text.startsWith('+'));

    // Extract amount
    const numMatch = params.text.match(/\d+/);
    const amount = params.amount ?? (numMatch ? parseInt(numMatch[0], 10) : 0);

    const newNumber: AnimatedDamageNumber = {
      id: params.id || 'fn_' + Math.random().toString(36).substring(2, 9),
      text: params.text,
      amount,
      worldX: wx,
      worldY: wy,
      color: params.color,
      secondaryColor: isCrit ? '#fef08a' : undefined,
      strokeColor: '#020617',
      fontSize: isCrit ? 22 : isStatus ? 13 : isGold ? 14 : isHeal ? 16 : 17,
      isCrit,
      isHeal,
      isShield,
      isGold,
      isStatus,
      createdAt: Date.now(),
      durationMs: isCrit ? 1500 : isGold ? 1200 : 1350,
      vx: (Math.random() - 0.5) * 1.8,
      maxScale: isCrit ? 1.75 : 1.4,
    };

    floatingNumbersRef.current.push(newNumber);
    spawnImpactParticles(wx, wy, params.color, isCrit);
    spawnImpactRing(wx, wy, params.color, isCrit);

    // Play impact sound effect
    if (!isGold && !isStatus) {
      sounds.playDamageImpact(isCrit);
    }

    // Add to recent damage feed
    if (params.targetName && amount > 0) {
      const type: RecentDamageEvent['type'] = isCrit
        ? 'crit'
        : isHeal
        ? 'heal'
        : isShield
        ? 'shield'
        : params.color === '#a855f7' || params.color === '#c084fc'
        ? 'magic'
        : params.color === '#ffffff'
        ? 'true'
        : 'physical';

      setRecentDamageEvents((prev) => [
        {
          id: 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          targetName: params.targetName || 'Unit',
          amountText: params.text,
          type,
          color: params.color,
          timestamp: Date.now(),
        },
        ...prev.slice(0, 4),
      ]);
    }
  }, [spawnImpactParticles, spawnImpactRing, TILE_SIZE]);

  // Synchronize with room.floatingTexts and detect unit HP reductions
  useEffect(() => {
    if (room.floatingTexts && room.floatingTexts.length > 0) {
      room.floatingTexts.forEach((ft) => {
        if (processedFloatingTextIds.current.has(ft.id)) return;
        processedFloatingTextIds.current.add(ft.id);

        const isCrit = ft.text.includes('CRIT') || ft.color === '#fbbf24';
        const isHeal = ft.text.startsWith('+') && !ft.text.includes('Shield') && !ft.text.includes('g') && !ft.text.includes('Speed');
        const isShield = ft.text.includes('Shield');
        const isGold = ft.text.includes('g');
        const isStatus = !ft.text.startsWith('-') && !ft.text.startsWith('+');

        // Check if victim is current player
        if (me && ft.x === me.x && ft.y === me.y && ft.text.startsWith('-')) {
          hurtVignetteUntilRef.current = Date.now() + 350;
        }

        spawnFloatingDamageNumber({
          id: ft.id,
          text: ft.text,
          tileX: ft.x,
          tileY: ft.y,
          color: ft.color,
          isCrit,
          isHeal,
          isShield,
          isGold,
          isStatus,
        });
      });
    }

    // Diff Champion HPs
    const currentChamps: Record<string, { hp: number; shield: number; x: number; y: number; name: string }> = {};
    Object.values(room.champions).forEach((c) => {
      currentChamps[c.playerId] = { hp: c.currentHp, shield: c.shield, x: c.x, y: c.y, name: c.playerName };
      const prev = prevUnitsRef.current.champions[c.playerId];
      if (prev && prev.hp > c.currentHp) {
        const dmg = prev.hp - c.currentHp;
        if (c.playerId === currentPlayerId) {
          hurtVignetteUntilRef.current = Date.now() + 350;
        }
        const alreadySpawned = room.floatingTexts?.some(
          (ft) => ft.x === c.x && ft.y === c.y && Date.now() - ft.createdAt < 250
        );
        if (!alreadySpawned) {
          spawnFloatingDamageNumber({
            text: `-${dmg}`,
            amount: dmg,
            tileX: c.x,
            tileY: c.y,
            color: '#ff4655',
            targetName: c.playerName,
          });
        }
      }
    });

    // Diff Minion HPs
    const currentMinions: Record<string, { hp: number; x: number; y: number; team: Team }> = {};
    room.minions.forEach((m) => {
      currentMinions[m.id] = { hp: m.currentHp, x: m.x, y: m.y, team: m.team };
      const prev = prevUnitsRef.current.minions[m.id];
      if (prev && prev.hp > m.currentHp) {
        const dmg = prev.hp - m.currentHp;
        const alreadySpawned = room.floatingTexts?.some(
          (ft) => ft.x === m.x && ft.y === m.y && Date.now() - ft.createdAt < 250
        );
        if (!alreadySpawned) {
          spawnFloatingDamageNumber({
            text: `-${dmg}`,
            amount: dmg,
            tileX: m.x,
            tileY: m.y,
            color: '#f59e0b',
            targetName: `${m.team.toUpperCase()} Minion`,
          });
        }
      }
    });

    // Diff Turrets
    const currentTurrets: Record<string, { hp: number; x: number; y: number }> = {};
    (['blue', 'red'] as Team[]).forEach((team) => {
      const turret = room.turrets[team];
      currentTurrets[team] = { hp: turret.currentHp, x: turret.x, y: turret.y };
      const prev = prevUnitsRef.current.turrets[team];
      if (prev && prev.hp > turret.currentHp) {
        const dmg = prev.hp - turret.currentHp;
        const alreadySpawned = room.floatingTexts?.some(
          (ft) => ft.x === turret.x && ft.y === turret.y && Date.now() - ft.createdAt < 250
        );
        if (!alreadySpawned) {
          spawnFloatingDamageNumber({
            text: `-${dmg}`,
            amount: dmg,
            tileX: turret.x,
            tileY: turret.y,
            color: '#f43f5e',
            targetName: `${team.toUpperCase()} Turret`,
          });
        }
      }
    });

    prevUnitsRef.current = {
      champions: currentChamps,
      minions: currentMinions,
      turrets: currentTurrets,
    };
  }, [room, currentPlayerId, me, spawnFloatingDamageNumber]);

  // --- UNIT VISIBILITY CHECK FOR FOG OF WAR & MINIMAP ---
  const isUnitVisibleToTeam = useCallback(
    (unitX: number, unitY: number, unitTeam: Team): boolean => {
      // Allied units are always visible
      if (unitTeam === myTeam) return true;

      const isInBrush = BRUSH_TILES.has(`${unitX},${unitY}`);

      // Check allied champions
      for (const champ of Object.values(room.champions)) {
        if (champ.team === myTeam && !champ.isDead) {
          const dist = getDistance(champ.x, champ.y, unitX, unitY);
          if (isInBrush) {
            if (dist <= 1) return true;
          } else {
            if (dist <= 6) return true;
          }
        }
      }

      // Check allied minions
      for (const minion of room.minions) {
        if (minion.team === myTeam && minion.currentHp > 0) {
          const dist = getDistance(minion.x, minion.y, unitX, unitY);
          if (isInBrush) {
            if (dist <= 1) return true;
          } else {
            if (dist <= 4) return true;
          }
        }
      }

      // Check allied turret (true vision within 3 tiles, vision within 5 tiles)
      const turretPos = myTeam === 'blue' ? BLUE_TURRET_POS : RED_TURRET_POS;
      const alliedTurret = room.turrets[myTeam];
      if (!alliedTurret.isDestroyed) {
        const turretDist = getDistance(turretPos.x, turretPos.y, unitX, unitY);
        if (isInBrush) {
          if (turretDist <= 3) return true;
        } else {
          if (turretDist <= 5) return true;
        }
      }

      return false;
    },
    [myTeam, room.champions, room.minions, room.turrets]
  );

  // --- 3. INTERACTIVE MINIMAP WITH PLAYER & UNIT ICONS ---
  const renderMinimap = useCallback(() => {
    const mini = minimapRef.current;
    if (!mini) return;
    const ctx = mini.getContext('2d');
    if (!ctx) return;

    const mW = mini.width;
    const mH = mini.height;
    const scaleX = mW / MAP_WIDTH;
    const scaleY = mH / MAP_HEIGHT;

    // Minimap Void Background
    ctx.fillStyle = '#060f15';
    ctx.fillRect(0, 0, mW, mH);

    // Flanking Grass Base
    ctx.fillStyle = '#10281f';
    ctx.fillRect(0, 0, mW, mH);

    // Mid Lane Corridor
    LANE_TILES.forEach((k) => {
      const [lx, ly] = k.split(',').map(Number);
      ctx.fillStyle = '#1e3d30';
      ctx.fillRect(lx * scaleX, ly * scaleY, scaleX + 0.5, scaleY + 0.5);
    });

    // River
    RIVER_TILES.forEach((k) => {
      const [rx, ry] = k.split(',').map(Number);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(rx * scaleX, ry * scaleY, scaleX + 0.5, scaleY + 0.5);
    });

    // Brushes (Dark foliage patches)
    BRUSH_TILES.forEach((k) => {
      const [bx, by] = k.split(',').map(Number);
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(bx * scaleX, by * scaleY, scaleX + 0.5, scaleY + 0.5);
    });

    // Base Zones
    ctx.fillStyle = 'rgba(10, 200, 185, 0.35)';
    ctx.fillRect(0, 9 * scaleY, 3 * scaleX, 3 * scaleY);
    ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
    ctx.fillRect(21 * scaleX, 2 * scaleY, 3 * scaleX, 3 * scaleY);

    // Turrets
    (['blue', 'red'] as Team[]).forEach((team) => {
      const turret = room.turrets[team];
      const pos = team === 'blue' ? BLUE_TURRET_POS : RED_TURRET_POS;
      const tx = pos.x * scaleX + scaleX / 2;
      const ty = pos.y * scaleY + scaleY / 2;

      if (!turret.isDestroyed) {
        ctx.fillStyle = team === 'blue' ? '#0ac8b9' : '#f43f5e';
        ctx.beginPath();
        ctx.arc(tx, ty, 4.5, 0, Math.PI * 2);
        ctx.fill();

        // HP ring
        const hpPct = Math.max(0, turret.currentHp / turret.maxHp);
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tx, ty, 5.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpPct);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#52525b';
        ctx.fillRect(tx - 3, ty - 3, 6, 6);
      }
    });

    // Minions
    room.minions.forEach((m) => {
      if (m.currentHp <= 0) return;
      if (!isUnitVisibleToTeam(m.x, m.y, m.team)) return;

      ctx.fillStyle = m.team === 'blue' ? '#38bdf8' : '#fb7185';
      ctx.beginPath();
      ctx.arc(m.x * scaleX + scaleX / 2, m.y * scaleY + scaleY / 2, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Champions (Allies always, Enemies only when visible in FoW)
    Object.values(room.champions).forEach((c) => {
      if (c.isDead) return;
      const isVisible = isUnitVisibleToTeam(c.x, c.y, c.team);
      if (!isVisible) return;

      const cx = c.x * scaleX + scaleX / 2;
      const cy = c.y * scaleY + scaleY / 2;
      const isMe = c.playerId === currentPlayerId;

      // Outer team ring
      ctx.fillStyle = c.team === 'blue' ? '#0ac8b9' : '#f43f5e';
      ctx.beginPath();
      ctx.arc(cx, cy, isMe ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Inner avatar circle
      ctx.fillStyle = CHAMPIONS[c.id]?.avatarColor || (c.team === 'blue' ? '#0284c7' : '#be123c');
      ctx.beginPath();
      ctx.arc(cx, cy, isMe ? 4 : 3.2, 0, Math.PI * 2);
      ctx.fill();

      // Golden highlight for local player
      if (isMe) {
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Translucent Viewport Rectangle Indicator
    const canvas = canvasRef.current;
    if (canvas) {
      const cam = cameraRef.current;
      const worldVpW = canvas.width / cam.zoom;
      const worldVpH = canvas.height / cam.zoom;
      const worldVpLeft = cam.x - worldVpW / 2;
      const worldVpTop = cam.y - worldVpH / 2;

      const totalWorldW = MAP_WIDTH * TILE_SIZE;
      const totalWorldH = MAP_HEIGHT * TILE_SIZE;

      const vpX = (worldVpLeft / totalWorldW) * mW;
      const vpY = (worldVpTop / totalWorldH) * mH;
      const vpW = (worldVpW / totalWorldW) * mW;
      const vpH = (worldVpH / totalWorldH) * mH;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(vpX, vpY, vpW, vpH);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vpX, vpY, vpW, vpH);
    }
  }, [currentPlayerId, isUnitVisibleToTeam, room.champions, room.minions, room.turrets, TILE_SIZE]);

  // --- MAIN CANVAS RENDERING LOOP ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const resize = () => {
      if (!canvas) return;
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const now = Date.now();
      const cam = cameraRef.current;

      // 1. Camera Update (Lock Lerp, Spacebar Center, or Edge Scrolling)
      if (cam.isLocked || isSpaceHeldRef.current) {
        // Locked to local champion or spectator target
        let targetX = (MAP_WIDTH * TILE_SIZE) / 2;
        let targetY = (MAP_HEIGHT * TILE_SIZE) / 2;

        if (me && !me.isDead) {
          targetX = me.x * TILE_SIZE + TILE_SIZE / 2;
          targetY = me.y * TILE_SIZE + TILE_SIZE / 2;
        } else if (spectatorTargetId && room.champions[spectatorTargetId]) {
          const spec = room.champions[spectatorTargetId];
          targetX = spec.x * TILE_SIZE + TILE_SIZE / 2;
          targetY = spec.y * TILE_SIZE + TILE_SIZE / 2;
        }

        const clamped = clampCamera(targetX, targetY);
        cam.x += (clamped.x - cam.x) * 0.12;
        cam.y += (clamped.y - cam.y) * 0.12;
      } else if (!isDraggingRef.current && mouseInCanvasRef.current) {
        // Free look: edge scrolling within 24px of canvas border
        const { x: mx, y: my, width: cw, height: ch } = mousePosRef.current;
        const edgeDist = 24;
        const panSpeed = 9;
        let deltaX = 0;
        let deltaY = 0;

        if (mx <= edgeDist) deltaX -= panSpeed;
        if (mx >= cw - edgeDist) deltaX += panSpeed;
        if (my <= edgeDist) deltaY -= panSpeed;
        if (my >= ch - edgeDist) deltaY += panSpeed;

        if (deltaX !== 0 || deltaY !== 0) {
          cam.x += deltaX / cam.zoom;
          cam.y += deltaY / cam.zoom;
          const clamped = clampCamera(cam.x, cam.y);
          cam.x = clamped.x;
          cam.y = clamped.y;
        }
      }

      ctx.save();
      // Background void
      ctx.fillStyle = '#060f15';
      ctx.fillRect(0, 0, width, height);

      // --- WORLD-TO-SCREEN TRANSFORMATION (CENTERED PROJECTION) ---
      // screenX = (worldX - camera.x) * camera.zoom + canvas.width / 2
      // screenY = (worldY - camera.y) * camera.zoom + canvas.height / 2
      ctx.translate(width / 2, height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      // Visible frustum bounds in world coordinates
      const halfVisW = (width / 2) / cam.zoom;
      const halfVisH = (height / 2) / cam.zoom;
      const viewLeft = cam.x - halfVisW;
      const viewRight = cam.x + halfVisW;
      const viewTop = cam.y - halfVisH;
      const viewBottom = cam.y + halfVisH;

      // --- 4. MAP TERRAIN RENDERING & VISUAL POLISH ---
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const tile = MAP_GRID[y][x];
          const px = x * TILE_SIZE;
          const py = y * TILE_SIZE;

          // Frustum culling
          if (px + TILE_SIZE < viewLeft || px > viewRight || py + TILE_SIZE < viewTop || py > viewBottom) {
            continue;
          }

          if (tile.terrain === 'wall') {
            // Jungle Rocks / Outer Trees (Multi-layered basalt stone with cracks & moss)
            ctx.fillStyle = '#0a161b';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            // Shaded rock body
            ctx.fillStyle = '#11252d';
            ctx.beginPath();
            ctx.roundRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6, 7);
            ctx.fill();

            // Bevel highlight
            ctx.fillStyle = '#1d3d4b';
            ctx.beginPath();
            ctx.moveTo(px + 4, py + 4);
            ctx.lineTo(px + TILE_SIZE - 4, py + 4);
            ctx.lineTo(px + TILE_SIZE - 9, py + 9);
            ctx.lineTo(px + 9, py + 9);
            ctx.closePath();
            ctx.fill();

            // Moss speckles
            ctx.fillStyle = 'rgba(34, 197, 94, 0.35)';
            ctx.fillRect(px + 10, py + 12, 8, 6);
            ctx.fillRect(px + 28, py + 26, 12, 7);
          } else if (tile.terrain === 'base_shop') {
            // Base / Shop Zone with Glowing Golden Border & Runes
            ctx.fillStyle = tile.team === 'blue' ? '#042738' : '#3d0a14';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            // Glowing Golden Rune Border
            ctx.strokeStyle = '#c8aa6e';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

            // Arcane floor seal
            const basePulse = Math.sin(now * 0.004 + x + y) * 2;
            ctx.strokeStyle = tile.team === 'blue' ? 'rgba(10, 200, 185, 0.4)' : 'rgba(244, 63, 94, 0.4)';
            ctx.beginPath();
            ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 3 + basePulse, 0, Math.PI * 2);
            ctx.stroke();

            // Golden corner glyphs
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(px + 3, py + 3, 3, 3);
            ctx.fillRect(px + TILE_SIZE - 6, py + 3, 3, 3);
            ctx.fillRect(px + 3, py + TILE_SIZE - 6, 3, 3);
            ctx.fillRect(px + TILE_SIZE - 6, py + TILE_SIZE - 6, 3, 3);
          } else if (tile.terrain === 'river') {
            // River Water with Wave Gradient & Water Shimmer
            const wave = Math.sin(now * 0.003 + x * 0.7 + y * 0.5) * 4;
            const wave2 = Math.cos(now * 0.0025 + x * 0.5 - y * 0.6) * 3;

            // Deep sapphire water base
            ctx.fillStyle = '#092c3e';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            // Flow current shimmer
            ctx.fillStyle = '#0d3d54';
            ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);

            // Animated undulating wave ripples
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(px + 4, py + 16 + wave);
            ctx.bezierCurveTo(px + 18, py + 8 - wave, px + 36, py + 24 + wave2, px + 52, py + 16 - wave);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(186, 230, 253, 0.2)';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(px + 6, py + 36 - wave2);
            ctx.bezierCurveTo(px + 22, py + 44 + wave, px + 38, py + 30 - wave, px + 50, py + 38 + wave2);
            ctx.stroke();
          } else if (tile.terrain === 'lane') {
            // Mid Lane: Textured Paving Stones with Wear Lines
            ctx.fillStyle = '#16362b'; // Dark edge stone
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            // Paving flagstone center
            ctx.fillStyle = '#204638';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

            // Paver tile seams
            ctx.strokeStyle = '#122b22';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px + TILE_SIZE / 2, py + 2);
            ctx.lineTo(px + TILE_SIZE / 2, py + TILE_SIZE - 2);
            ctx.moveTo(px + 2, py + TILE_SIZE / 2);
            ctx.lineTo(px + TILE_SIZE - 2, py + TILE_SIZE / 2);
            ctx.stroke();

            // Center wear path (earth/sand lines from champion & minion foot traffic)
            ctx.fillStyle = 'rgba(180, 140, 80, 0.18)';
            ctx.fillRect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12);
          } else {
            // Flanking Summoner's Rift Grassy Areas
            ctx.fillStyle = '#122c22';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            ctx.fillStyle = '#183a2d';
            ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);

            // Grass tufts
            ctx.fillStyle = 'rgba(74, 222, 128, 0.2)';
            ctx.fillRect(px + 14, py + 16, 4, 8);
            ctx.fillRect(px + 28, py + 32, 6, 5);
          }

          // Subtle Tactical Grid Border
          ctx.strokeStyle = 'rgba(200, 170, 110, 0.08)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        }
      }

      // --- BRUSHES: SEMI-TRANSPARENT TALL GRASS & ALLIED STEALTH HIGHLIGHT ---
      BRUSH_TILES.forEach((key) => {
        const [bx, by] = key.split(',').map(Number);
        const px = bx * TILE_SIZE;
        const py = by * TILE_SIZE;

        if (px + TILE_SIZE < viewLeft || px > viewRight || py + TILE_SIZE < viewTop || py > viewBottom) return;

        const allyInside = Object.values(room.champions).some(
          (c) => !c.isDead && c.x === bx && c.y === by && c.team === myTeam
        );

        const sway = Math.sin(now * 0.0025 + bx * 2 + by) * 2.5;

        // Base semi-transparent dense brush foliage
        ctx.fillStyle = 'rgba(6, 78, 59, 0.85)';
        ctx.beginPath();
        ctx.roundRect(px + 2 + sway, py + 2, TILE_SIZE - 4, TILE_SIZE - 4, 10);
        ctx.fill();

        // Tall leaf clusters
        ctx.fillStyle = '#059669';
        ctx.beginPath();
        ctx.arc(px + 16 + sway, py + 18, 12, 0, Math.PI * 2);
        ctx.arc(px + 38 - sway, py + 20, 14, 0, Math.PI * 2);
        ctx.arc(px + 28, py + 38 + sway, 13, 0, Math.PI * 2);
        ctx.fill();

        // Highlight brush when an allied unit is inside
        if (allyInside) {
          ctx.strokeStyle = '#0ac8b9';
          ctx.lineWidth = 2.5;
          ctx.shadowColor = '#0ac8b9';
          ctx.shadowBlur = 10;
          ctx.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          ctx.shadowBlur = 0;

          // Eye Stealth Indicator
          ctx.fillStyle = '#0ac8b9';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('👁️ HIDDEN', px + TILE_SIZE / 2, py + 14);
        }
      });

      // --- BRAZIERS (TORCH PILLARS WITH WARM LIGHT) ---
      BRAZIERS.forEach((b) => {
        const px = b.x * TILE_SIZE;
        const py = b.y * TILE_SIZE;
        const flicker = Math.sin(now * 0.01 + b.x) * 3;

        ctx.fillStyle = '#27272a';
        ctx.fillRect(px + 18, py + 22, 20, 24);

        const glowGrad = ctx.createRadialGradient(
          px + 28, py + 18, 4,
          px + 28, py + 18, 34 + flicker
        );
        glowGrad.addColorStop(0, 'rgba(251, 191, 36, 0.85)');
        glowGrad.addColorStop(0.4, 'rgba(249, 115, 22, 0.4)');
        glowGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(px + 28, py + 18, 34 + flicker, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(px + 28, py + 18, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      // --- TURRETS WITH DYNAMIC THREAT RANGE RINGS ---
      const renderTurret = (tX: number, tY: number, team: Team) => {
        const turret = room.turrets[team];
        const px = tX * TILE_SIZE;
        const py = tY * TILE_SIZE;

        if (turret.isDestroyed) {
          ctx.fillStyle = '#3f3f46';
          ctx.fillRect(px + 10, py + 10, TILE_SIZE - 20, TILE_SIZE - 20);
          ctx.fillStyle = '#71717a';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('RUINS', px + TILE_SIZE / 2, py + 32);
          return;
        }

        // Threat Check: Enemy units within 3-tile radius perimeter
        const enemyTeam: Team = team === 'blue' ? 'red' : 'blue';
        const hasEnemyInThreat =
          Object.values(room.champions).some(
            (c) => !c.isDead && c.team === enemyTeam && getDistance(c.x, c.y, tX, tY) <= 3
          ) ||
          room.minions.some(
            (m) => m.currentHp > 0 && m.team === enemyTeam && getDistance(m.x, m.y, tX, tY) <= 3
          );

        // Range Threat Ring
        ctx.save();
        if (hasEnemyInThreat) {
          const pulse = Math.sin(now * 0.01) * 2;
          ctx.strokeStyle = team === 'blue' ? 'rgba(10, 200, 185, 0.7)' : 'rgba(244, 63, 94, 0.7)';
          ctx.lineWidth = 2.5 + pulse * 0.5;
          ctx.setLineDash([8, 6]);
          ctx.lineDashOffset = -now * 0.025;
          ctx.fillStyle = team === 'blue' ? 'rgba(10, 200, 185, 0.08)' : 'rgba(244, 63, 94, 0.08)';
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.strokeStyle = team === 'blue' ? 'rgba(10, 200, 185, 0.18)' : 'rgba(244, 63, 94, 0.18)';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();

        // Stone Base
        ctx.fillStyle = '#1c1917';
        ctx.beginPath();
        ctx.roundRect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12, 8);
        ctx.fill();
        ctx.strokeStyle = team === 'blue' ? '#0ac8b9' : '#f43f5e';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Crystal Core
        const pulse = Math.sin(now * 0.005) * 3;
        const crystalColor = team === 'blue' ? '#38bdf8' : '#fb7185';
        ctx.fillStyle = crystalColor;
        ctx.shadowBlur = 16;
        ctx.shadowColor = crystalColor;
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 12 + pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Turret HP Bar
        const barW = TILE_SIZE;
        const barH = 6;
        const hpPercent = Math.max(0, turret.currentHp / turret.maxHp);
        ctx.fillStyle = '#050c12';
        ctx.fillRect(px, py - 12, barW, barH);
        ctx.fillStyle = team === 'blue' ? '#0ac8b9' : '#f43f5e';
        ctx.fillRect(px, py - 12, barW * hpPercent, barH);
        ctx.strokeStyle = '#c8aa6e';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py - 12, barW, barH);

        // Name
        ctx.fillStyle = '#f0e6d2';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${team.toUpperCase()} TURRET`, px + TILE_SIZE / 2, py - 16);
      };

      renderTurret(BLUE_TURRET_POS.x, BLUE_TURRET_POS.y, 'blue');
      renderTurret(RED_TURRET_POS.x, RED_TURRET_POS.y, 'red');

      // --- TARGETING OVERLAYS ---
      if (me && !me.isDead && room.activePlayerId === currentPlayerId) {
        if (targetMode.type === 'move' && !me.hasMoved) {
          for (let dy = -me.effectiveMoveSpeed; dy <= me.effectiveMoveSpeed; dy++) {
            for (let dx = -me.effectiveMoveSpeed; dx <= me.effectiveMoveSpeed; dx++) {
              const tx = me.x + dx;
              const ty = me.y + dy;
              if (getDistance(me.x, me.y, tx, ty) <= me.effectiveMoveSpeed && isTileWalkable(tx, ty)) {
                ctx.fillStyle = 'rgba(10, 200, 185, 0.25)';
                ctx.fillRect(tx * TILE_SIZE + 2, ty * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                ctx.strokeStyle = '#0ac8b9';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(tx * TILE_SIZE + 2, ty * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
              }
            }
          }
        } else if (targetMode.type === 'attack') {
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(
            me.x * TILE_SIZE + TILE_SIZE / 2,
            me.y * TILE_SIZE + TILE_SIZE / 2,
            me.effectiveRange * TILE_SIZE + TILE_SIZE / 2,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        } else if (targetMode.type === 'ability' && targetMode.range) {
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(
            me.x * TILE_SIZE + TILE_SIZE / 2,
            me.y * TILE_SIZE + TILE_SIZE / 2,
            targetMode.range * TILE_SIZE + TILE_SIZE / 2,
            0,
            Math.PI * 2
          );
          ctx.stroke();

          if (hoveredTile && targetMode.targetType === 'line') {
            const tiles = getLineTiles(me.x, me.y, hoveredTile.x, hoveredTile.y);
            tiles.forEach((t) => {
              if (getDistance(me.x, me.y, t.x, t.y) <= (targetMode.range || 4)) {
                ctx.fillStyle = 'rgba(168, 85, 247, 0.35)';
                ctx.fillRect(t.x * TILE_SIZE + 2, t.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
              }
            });
          }
        }
      }

      // --- MINIONS ---
      room.minions.forEach((minion) => {
        const px = minion.x * TILE_SIZE;
        const py = minion.y * TILE_SIZE;

        if (px + TILE_SIZE < viewLeft || px > viewRight || py + TILE_SIZE < viewTop || py > viewBottom) return;

        ctx.fillStyle = minion.team === 'blue' ? '#0284c7' : '#e11d48';
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f0e6d2';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(minion.type === 'melee' ? '🛡️' : '🪄', px + TILE_SIZE / 2, py + TILE_SIZE / 2);

        // HP bar
        const hpPct = Math.max(0, minion.currentHp / minion.maxHp);
        ctx.fillStyle = '#050c12';
        ctx.fillRect(px + 8, py + 2, TILE_SIZE - 16, 4);
        ctx.fillStyle = minion.team === 'blue' ? '#38bdf8' : '#fb7185';
        ctx.fillRect(px + 8, py + 2, (TILE_SIZE - 16) * hpPct, 4);
      });

      // --- CHAMPIONS ---
      Object.values(room.champions).forEach((champ) => {
        if (champ.isDead) return;

        const px = champ.x * TILE_SIZE;
        const py = champ.y * TILE_SIZE;

        if (px + TILE_SIZE < viewLeft || px > viewRight || py + TILE_SIZE < viewTop || py > viewBottom) return;

        const champData = CHAMPIONS[champ.id];
        const isTurn = room.activePlayerId === champ.playerId;
        const isSelectedSpectator = spectatorTargetId === champ.playerId;

        // Stealth check
        const isStealth = champ.statusEffects.some((e) => e.type === 'stealth');
        if (isStealth && champ.team !== myTeam) {
          const adjacentAlly = Object.values(room.champions).some(
            (c) => !c.isDead && c.team === myTeam && getDistance(c.x, c.y, champ.x, champ.y) <= 1
          );
          const alliedTurretPos = myTeam === 'blue' ? BLUE_TURRET_POS : RED_TURRET_POS;
          const nearTurret = getDistance(champ.x, champ.y, alliedTurretPos.x, alliedTurretPos.y) <= 3;
          if (!adjacentAlly && !nearTurret) return;
        }

        ctx.save();
        if (isStealth) ctx.globalAlpha = 0.55;

        // Active Turn Halo
        if (isTurn) {
          const haloPulse = Math.sin(now * 0.008) * 4;
          ctx.strokeStyle = '#c8aa6e';
          ctx.lineWidth = 3;
          ctx.shadowBlur = 12;
          ctx.shadowColor = '#c8aa6e';
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 22 + haloPulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        if (isSelectedSpectator) {
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        }

        // Token Body
        ctx.fillStyle = champData?.avatarColor || '#38bdf8';
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 19, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = champ.team === 'blue' ? '#0ac8b9' : '#f43f5e';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Icon Emoji
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(champData?.iconText || '⚔️', px + TILE_SIZE / 2, py + TILE_SIZE / 2);

        // Role badge
        ctx.fillStyle = '#050c12';
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE - 10, py + TILE_SIZE - 10, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c8aa6e';
        ctx.font = '9px sans-serif';
        ctx.fillText(champ.role[0].toUpperCase(), px + TILE_SIZE - 10, py + TILE_SIZE - 9);

        // Health & Mana Bars
        const barW = 44;
        const barH = 5;
        const barX = px + (TILE_SIZE - barW) / 2;
        const barY = py - 14;

        ctx.fillStyle = '#050c12';
        ctx.fillRect(barX, barY, barW, barH);
        const hpPct = Math.max(0, champ.currentHp / champ.maxHp);
        ctx.fillStyle = champ.team === 'blue' ? '#22c55e' : '#ef4444';
        ctx.fillRect(barX, barY, barW * hpPct, barH);

        if (champ.shield > 0) {
          const shieldPct = Math.min(1, champ.shield / champ.maxHp);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(barX + barW * hpPct - (barW * shieldPct) / 2, barY, barW * shieldPct, barH);
        }

        ctx.strokeStyle = '#c8aa6e';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(barX, barY, barW, barH);

        if (champ.maxMana > 0) {
          const manaPct = Math.max(0, champ.currentMana / champ.maxMana);
          ctx.fillStyle = '#050c12';
          ctx.fillRect(barX, barY + 5, barW, 3);
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(barX, barY + 5, barW * manaPct, 3);
        }

        // Name
        ctx.fillStyle = '#f0e6d2';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(champ.playerName, px + TILE_SIZE / 2, barY - 4);
        ctx.restore();
      });

      // --- VISUAL FX (PROJECTILES, SLASH ARCS, BEAMS, FLASH, AOE) ---
      room.visualFx.forEach((fx) => {
        const age = now - fx.createdAt;
        if (age > fx.durationMs) return;
        const progress = age / fx.durationMs;

        ctx.save();
        const startPxX = fx.startX * TILE_SIZE + TILE_SIZE / 2;
        const startPxY = fx.startY * TILE_SIZE + TILE_SIZE / 2;
        const targetPxX = fx.targetX * TILE_SIZE + TILE_SIZE / 2;
        const targetPxY = fx.targetY * TILE_SIZE + TILE_SIZE / 2;

        if (fx.type === 'attack_beam' || fx.type === 'skillshot_line') {
          const curPxX = startPxX + (targetPxX - startPxX) * progress;
          const curPxY = startPxY + (targetPxY - startPxY) * progress;

          ctx.strokeStyle = fx.color || '#38bdf8';
          ctx.lineWidth = 3 * (1 - progress * 0.5);
          ctx.shadowColor = fx.color || '#38bdf8';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(startPxX, startPxY);
          ctx.lineTo(curPxX, curPxY);
          ctx.stroke();

          // Projectile head
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(curPxX, curPxY, 5, 0, Math.PI * 2);
          ctx.fill();
        } else if (fx.type === 'aoe_circle' || fx.type === 'explosion') {
          const maxR = (fx.radius || 2) * TILE_SIZE;
          const curR = maxR * Math.sin(progress * Math.PI * 0.5);
          ctx.strokeStyle = fx.color || '#f59e0b';
          ctx.lineWidth = 3 * (1 - progress);
          ctx.fillStyle = fx.color ? `${fx.color}33` : 'rgba(245, 158, 11, 0.2)';
          ctx.beginPath();
          ctx.arc(targetPxX, targetPxY, curR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (fx.type === 'flash' || fx.type === 'heal') {
          const curR = 28 * Math.sin(progress * Math.PI);
          ctx.strokeStyle = fx.color || '#facc15';
          ctx.lineWidth = 2.5 * (1 - progress);
          ctx.shadowColor = fx.color || '#facc15';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(targetPxX, targetPxY, curR, 0, Math.PI * 2);
          ctx.stroke();
        } else if (fx.type === 'dash') {
          ctx.strokeStyle = fx.color || '#0ac8b9';
          ctx.lineWidth = 4 * (1 - progress);
          ctx.beginPath();
          ctx.moveTo(startPxX, startPxY);
          ctx.lineTo(targetPxX, targetPxY);
          ctx.stroke();
        }
        ctx.restore();
      });

      // --- FLOATING DAMAGE NUMBERS & IMPACTS ---
      if (damageNumbersEnabledRef.current) {
        // Ground Shockwave Rings
        impactRingsRef.current = impactRingsRef.current.filter((ring) => {
          const age = now - ring.createdAt;
          if (age > ring.durationMs) return false;
          const progress = age / ring.durationMs;
          const radius = 6 + (ring.maxRadius - 6) * Math.sin(progress * Math.PI * 0.5);
          const alpha = (1 - progress) * 0.75;

          ctx.save();
          ctx.strokeStyle = ring.color;
          ctx.lineWidth = 2.5 * (1 - progress);
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          ctx.beginPath();
          ctx.ellipse(ring.worldX, ring.worldY, radius * 1.25, radius * 0.7, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          return true;
        });

        // Impact Sparkles & Particles
        impactParticlesRef.current = impactParticlesRef.current.filter((p) => {
          const age = now - p.createdAt;
          if (age > p.durationMs) return false;
          const progress = age / p.durationMs;
          const alpha = (1 - progress) * 0.9;
          const px = p.worldX + p.vx * (age / 16);
          const py = p.worldY + p.vy * (age / 16) + 0.05 * Math.pow(age / 16, 1.7);

          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          if (p.isStar) {
            const sz = p.radius * (1 - progress * 0.4);
            ctx.moveTo(px, py - sz);
            ctx.lineTo(px + sz, py);
            ctx.lineTo(px, py + sz);
            ctx.lineTo(px - sz, py);
            ctx.closePath();
          } else {
            ctx.arc(px, py, Math.max(0.5, p.radius * (1 - progress * 0.5)), 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.restore();
          return true;
        });

        // Damage Numbers
        floatingNumbersRef.current = floatingNumbersRef.current.filter((fn) => {
          const age = now - fn.createdAt;
          if (age > fn.durationMs) return false;

          let scale = 1.0;
          if (age < 90) {
            const t = age / 90;
            scale = 0.4 + (fn.maxScale - 0.4) * Math.sin(t * Math.PI * 0.6);
          } else if (age < 210) {
            const t = (age - 90) / 120;
            scale = fn.maxScale - t * (fn.maxScale - 1.0);
          } else {
            scale = 1.0;
          }

          const floatProgress = Math.pow(age / fn.durationMs, 0.65);
          const curY = fn.worldY - floatProgress * 54;
          const curX = fn.worldX + fn.vx * (age / 75);

          let alpha = 1.0;
          const fadeStart = fn.durationMs * 0.6;
          if (age > fadeStart) {
            alpha = 1.0 - (age - fadeStart) / (fn.durationMs - fadeStart);
          }

          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          ctx.translate(curX, curY);
          ctx.scale(scale, scale);

          ctx.font = `900 ${fn.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';

          ctx.lineWidth = fn.isCrit ? 5.0 : 3.5;
          ctx.strokeStyle = fn.strokeColor || '#020617';
          ctx.strokeText(fn.text, 0, 0);

          ctx.shadowColor = fn.isCrit ? '#f59e0b' : fn.color;
          ctx.shadowBlur = fn.isCrit ? 14 : 7;
          ctx.fillStyle = fn.color;
          ctx.fillText(fn.text, 0, 0);

          if (fn.isCrit) {
            ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.fillStyle = '#fef08a';
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 8;
            ctx.fillText('CRIT!', 0, -fn.fontSize * 0.72);
          }
          ctx.restore();
          return true;
        });
      }

      // Hover Tile Cursor
      if (hoveredTile && isTileWalkable(hoveredTile.x, hoveredTile.y)) {
        ctx.strokeStyle = '#c8aa6e';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          hoveredTile.x * TILE_SIZE + 1,
          hoveredTile.y * TILE_SIZE + 1,
          TILE_SIZE - 2,
          TILE_SIZE - 2
        );
      }

      ctx.restore(); // Restore World Transform to Screen Coordinates

      // --- SCREEN-SPACE HURT VIGNETTE ---
      if (hurtVignetteUntilRef.current > now && canvas) {
        const hurtAge = hurtVignetteUntilRef.current - now;
        const hurtProgress = hurtAge / 350;
        const hurtAlpha = Math.min(0.38, hurtProgress * 0.45);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const w = canvas.width;
        const h = canvas.height;
        const grad = ctx.createRadialGradient(
          w / 2, h / 2, Math.min(w, h) * 0.35,
          w / 2, h / 2, Math.max(w, h) * 0.75
        );
        grad.addColorStop(0, 'rgba(239, 68, 68, 0)');
        grad.addColorStop(1, `rgba(239, 68, 68, ${hurtAlpha})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      // Render Minimap
      renderMinimap();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [
    clampCamera,
    currentPlayerId,
    hoveredTile,
    me,
    myTeam,
    renderMinimap,
    room.activePlayerId,
    room.champions,
    room.floatingTexts,
    room.minions,
    room.turrets,
    room.visualFx,
    spectatorTargetId,
    targetMode,
    TILE_SIZE,
  ]);

  // --- MOUSE & POINTER HANDLERS ---
  const getPointerWorldCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { worldX: 0, worldY: 0, tileX: 0, tileY: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    const cam = cameraRef.current;
    const worldX = (screenX - canvas.width / 2) / cam.zoom + cam.x;
    const worldY = (screenY - canvas.height / 2) / cam.zoom + cam.y;
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    return { worldX, worldY, tileX, tileY };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Right click (2), middle click (1), or shift-click drags the camera
    if (e.button === 2 || e.button === 1 || e.shiftKey) {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };

      // Automatically unlock camera when dragging
      if (cameraRef.current.isLocked) {
        cameraRef.current.isLocked = false;
        setLocalLocked(false);
        if (onSetCameraLocked) onSetCameraLocked(false);
      }
      return;
    }

    // Left click selects tile or unit
    if (e.button === 0) {
      const { tileX, tileY } = getPointerWorldCoords(e.clientX, e.clientY);
      if (tileX < 0 || tileX >= MAP_WIDTH || tileY < 0 || tileY >= MAP_HEIGHT) return;

      // Unit selection check
      const clickedChamp = Object.values(room.champions).find(
        (c) => !c.isDead && c.x === tileX && c.y === tileY
      );
      if (clickedChamp) {
        if (onSelectSpectatorTarget) onSelectSpectatorTarget(clickedChamp.playerId);
        onTileClick(tileX, tileY, clickedChamp.playerId, 'champion');
        return;
      }

      const clickedMinion = room.minions.find((m) => m.currentHp > 0 && m.x === tileX && m.y === tileY);
      if (clickedMinion) {
        onTileClick(tileX, tileY, clickedMinion.id, 'minion');
        return;
      }

      if (tileX === BLUE_TURRET_POS.x && tileY === BLUE_TURRET_POS.y) {
        onTileClick(tileX, tileY, 'blue_turret', 'turret');
        return;
      }
      if (tileX === RED_TURRET_POS.x && tileY === RED_TURRET_POS.y) {
        onTileClick(tileX, tileY, 'red_turret', 'turret');
        return;
      }

      onTileClick(tileX, tileY);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mousePosRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    mouseInCanvasRef.current = true;

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const cam = cameraRef.current;
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
      const clamped = clampCamera(cam.x, cam.y);
      cam.x = clamped.x;
      cam.y = clamped.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const { tileX, tileY } = getPointerWorldCoords(e.clientX, e.clientY);
    if (tileX >= 0 && tileX < MAP_WIDTH && tileY >= 0 && tileY < MAP_HEIGHT) {
      if (!hoveredTile || hoveredTile.x !== tileX || hoveredTile.y !== tileY) {
        setHoveredTile({ x: tileX, y: tileY });
      }
    } else {
      if (hoveredTile) setHoveredTile(null);
    }
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const handlePointerLeave = () => {
    isDraggingRef.current = false;
    mouseInCanvasRef.current = false;
    setHoveredTile(null);
  };

  // Zoom control via mouse wheel
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const nextZoom = Math.max(0.75, Math.min(1.35, cameraRef.current.zoom * zoomFactor));
    cameraRef.current.zoom = nextZoom;
  };

  // --- MINIMAP INTERACTION (CLICK & DRAG TO PAN) ---
  const panToMinimapCoord = (clientX: number, clientY: number) => {
    const mini = minimapRef.current;
    if (!mini) return;
    const rect = mini.getBoundingClientRect();
    const mx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const my = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

    const targetWorldX = mx * (MAP_WIDTH * TILE_SIZE);
    const targetWorldY = my * (MAP_HEIGHT * TILE_SIZE);

    // Clicking minimap sets camera.isLocked = false (Free Look)
    cameraRef.current.isLocked = false;
    setLocalLocked(false);
    if (onSetCameraLocked) onSetCameraLocked(false);

    const clamped = clampCamera(targetWorldX, targetWorldY);
    cameraRef.current.x = clamped.x;
    cameraRef.current.y = clamped.y;
  };

  const handleMinimapMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isMinimapDraggingRef.current = true;
    panToMinimapCoord(e.clientX, e.clientY);
  };

  const handleMinimapMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isMinimapDraggingRef.current) {
      panToMinimapCoord(e.clientX, e.clientY);
    }
  };

  const handleMinimapMouseUp = () => {
    isMinimapDraggingRef.current = false;
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-[#050c12]">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full h-full cursor-crosshair block"
      />

      {/* Turn Transition Prompt: "Your Turn - Camera Locked" */}
      {turnBannerMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center gap-2.5 px-6 py-2.5 rounded-xl bg-[#09141d]/95 border-2 border-[#c8aa6e] shadow-[0_0_25px_rgba(200,170,110,0.65)] backdrop-blur-md">
            <Focus className="w-5 h-5 text-[#facc15] animate-pulse" />
            <span className="text-sm font-black tracking-wider uppercase text-[#f0e6d2]">
              {turnBannerMessage}
            </span>
            <Lock className="w-4 h-4 text-[#facc15]" />
          </div>
        </div>
      )}

      {/* Top-Left Combat Overlay: Floating Damage Numbers Toggle & Live Damage Ticker */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => setDamageNumbersEnabled((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border backdrop-blur-md transition-all shadow-lg ${
              damageNumbersEnabled
                ? 'bg-[#09141d]/85 text-[#facc15] border-[#facc15]/50 hover:bg-[#0f1d2a]'
                : 'bg-zinc-900/80 text-zinc-400 border-zinc-700/50 hover:bg-zinc-800'
            }`}
            title="Toggle Floating Combat Numbers on GameCanvas"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#facc15]" />
            <span>Damage Numbers: {damageNumbersEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {recentDamageEvents.length > 0 && (
            <button
              onClick={() => setShowDamageFeed((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#0ac8b9] bg-[#09141d]/85 border border-[#0ac8b9]/40 hover:bg-[#0f1d2a] backdrop-blur-md transition-all"
              title="Toggle Live Damage Ticker"
            >
              <Swords className="w-3 h-3 text-[#0ac8b9]" />
              <span>{showDamageFeed ? 'Hide Feed' : 'Show Feed'}</span>
            </button>
          )}
        </div>

        {/* Recent Damage Feed Stream */}
        {showDamageFeed && damageNumbersEnabled && recentDamageEvents.length > 0 && (
          <div className="flex flex-col gap-1 mt-0.5">
            {recentDamageEvents.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#09141d]/90 border border-zinc-800/80 text-[11px] shadow-md backdrop-blur-sm animate-fade-in pointer-events-auto w-fit"
              >
                <span className="text-zinc-300 font-medium">{ev.targetName}</span>
                <span
                  className="font-bold px-1.5 py-0.5 rounded text-[11px]"
                  style={{
                    color: ev.color,
                    backgroundColor: `${ev.color}15`,
                    border: `1px solid ${ev.color}40`,
                  }}
                >
                  {ev.amountText}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-zinc-400">
                  {ev.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating Interactive Minimap with Unit Icons & Viewport in Bottom-Right */}
      <div className="absolute bottom-4 right-4 z-20 bg-[#09141d]/95 border-2 border-[#c8aa6e]/60 rounded-xl p-2 shadow-2xl backdrop-blur-md flex flex-col gap-1.5">
        {/* Minimap Toolbar Header */}
        <div className="flex items-center justify-between text-[11px] px-0.5">
          <div className="flex items-center gap-1.5 font-bold text-[#c8aa6e]">
            <CameraIcon className="w-3.5 h-3.5 text-[#c8aa6e]" />
            <span>MINIMAP</span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Lock / Unlock Toggle Button */}
            <button
              onClick={handleToggleLock}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all cursor-pointer ${
                isLocked
                  ? 'bg-[#0ac8b9]/20 text-[#0ac8b9] border-[#0ac8b9]/60 hover:bg-[#0ac8b9]/30 shadow-[0_0_8px_rgba(10,200,185,0.4)]'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
              }`}
              title="Toggle Camera Lock (Shortcut: Y)"
            >
              {isLocked ? <Lock className="w-3 h-3 text-[#0ac8b9]" /> : <Unlock className="w-3 h-3 text-zinc-400" />}
              <span>{isLocked ? 'LOCKED [Y]' : 'FREE [Y]'}</span>
            </button>

            {/* Recenter Button */}
            <button
              onClick={handleRecenterOnMe}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-800/90 hover:bg-zinc-700 text-[#f0e6d2] border border-zinc-700 transition-all cursor-pointer"
              title="Center Camera on Champion (Spacebar)"
            >
              <Crosshair className="w-3 h-3 text-[#c8aa6e]" />
              <span>SPACE</span>
            </button>
          </div>
        </div>

        {/* Minimap Canvas */}
        <canvas
          ref={minimapRef}
          width={216}
          height={126}
          onMouseDown={handleMinimapMouseDown}
          onMouseMove={handleMinimapMouseMove}
          onMouseUp={handleMinimapMouseUp}
          onMouseLeave={handleMinimapMouseUp}
          className="rounded border border-zinc-800 cursor-pointer block hover:brightness-105 transition-all"
          title="Click or Drag on Minimap to Pan Camera"
        />

        <div className="flex items-center justify-between text-[9px] text-[#c8aa6e]/80 px-0.5">
          <span>Click/Drag to Pan</span>
          <span className="text-[#0ac8b9] flex items-center gap-1">
            <Eye className="w-2.5 h-2.5" />
            <span>Vision Active</span>
          </span>
        </div>
      </div>
    </div>
  );
}
