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
} from '../data/map';
import { CHAMPIONS } from '../data/champions';

export interface TargetSelectionMode {
  type: 'none' | 'move' | 'attack' | 'ability' | 'spell';
  abilityKey?: 'Q' | 'W' | 'E' | 'R';
  range?: number;
  targetType?: 'single_enemy' | 'single_ally' | 'self' | 'line' | 'cone' | 'aoe' | 'dash_target' | 'tile' | 'enemy' | 'ally';
  areaRadius?: number;
}

interface GameCanvasProps {
  room: GameRoomState;
  currentPlayerId: string;
  targetMode: TargetSelectionMode;
  onTileClick: (x: number, y: number, unitId?: string, unitType?: 'champion' | 'minion' | 'turret') => void;
  spectatorTargetId?: string;
  onSelectSpectatorTarget?: (targetId: string) => void;
}

export function GameCanvas({
  room,
  currentPlayerId,
  targetMode,
  onTileClick,
  spectatorTargetId,
  onSelectSpectatorTarget,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);

  // Camera coordinates (world pixel offset)
  const cameraRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredTile, setHoveredTile] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const TILE_SIZE = 56; // 56px per tactical grid tile

  const me = room.champions[currentPlayerId];
  const myTeam: Team = me ? me.team : (room.players.find((p) => p.id === currentPlayerId)?.team || 'blue');

  // Center camera on active champion or me
  const centerCameraOn = useCallback((tileX: number, tileY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetPxX = tileX * TILE_SIZE + TILE_SIZE / 2;
    const targetPxY = tileY * TILE_SIZE + TILE_SIZE / 2;
    cameraRef.current = {
      x: targetPxX - canvas.width / 2,
      y: targetPxY - canvas.height / 2,
    };
  }, [TILE_SIZE]);

  // Initial camera center on spawn
  useEffect(() => {
    if (me) {
      centerCameraOn(me.x, me.y);
    } else {
      // Spectator center on mid lane
      centerCameraOn(12, 6);
    }
  }, [centerCameraOn, me]);

  // Spacebar to re-center on champion (Classic LoL shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (me && !me.isDead) {
          centerCameraOn(me.x, me.y);
        } else if (spectatorTargetId && room.champions[spectatorTargetId]) {
          const spec = room.champions[spectatorTargetId];
          centerCameraOn(spec.x, spec.y);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [centerCameraOn, me, room.champions, spectatorTargetId]);

  // Minimap rendering helper
  const renderMinimap = useCallback(() => {
    const mini = minimapRef.current;
    if (!mini) return;
    const ctx = mini.getContext('2d');
    if (!ctx) return;

    const mW = mini.width;
    const mH = mini.height;
    const scaleX = mW / MAP_WIDTH;
    const scaleY = mH / MAP_HEIGHT;

    // Minimap background
    ctx.fillStyle = '#08121a';
    ctx.fillRect(0, 0, mW, mH);

    // Mid lane diagonal
    ctx.fillStyle = '#143026';
    ctx.fillRect(0, 0, mW, mH);

    // River
    RIVER_TILES.forEach((k) => {
      const [rx, ry] = k.split(',').map(Number);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(rx * scaleX, ry * scaleY, scaleX, scaleY);
    });

    // Turrets
    ctx.fillStyle = '#0ac8b9';
    ctx.fillRect(BLUE_TURRET_POS.x * scaleX, BLUE_TURRET_POS.y * scaleY, scaleX * 1.5, scaleY * 1.5);
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(RED_TURRET_POS.x * scaleX, RED_TURRET_POS.y * scaleY, scaleX * 1.5, scaleY * 1.5);

    // Minions
    room.minions.forEach((m) => {
      ctx.fillStyle = m.team === 'blue' ? '#38bdf8' : '#fb7185';
      ctx.fillRect(m.x * scaleX, m.y * scaleY, scaleX, scaleY);
    });

    // Champions
    Object.values(room.champions).forEach((c) => {
      if (c.isDead) return;
      ctx.fillStyle = c.team === 'blue' ? '#0ac8b9' : '#f43f5e';
      ctx.beginPath();
      ctx.arc(c.x * scaleX + scaleX / 2, c.y * scaleY + scaleY / 2, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Camera viewport rectangle
    const canvas = canvasRef.current;
    if (canvas) {
      const vpX = (cameraRef.current.x / (MAP_WIDTH * TILE_SIZE)) * mW;
      const vpY = (cameraRef.current.y / (MAP_HEIGHT * TILE_SIZE)) * mH;
      const vpW = (canvas.width / (MAP_WIDTH * TILE_SIZE)) * mW;
      const vpH = (canvas.height / (MAP_HEIGHT * TILE_SIZE)) * mH;

      ctx.strokeStyle = '#c8aa6e';
      ctx.lineWidth = 1;
      ctx.strokeRect(vpX, vpY, vpW, vpH);
    }
  }, [room.champions, room.minions]);

  // Main Canvas Rendering Loop
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

      // Smooth camera interpolation if spectator target is active
      if (spectatorTargetId && room.champions[spectatorTargetId]) {
        const targetChamp = room.champions[spectatorTargetId];
        const desiredX = targetChamp.x * TILE_SIZE + TILE_SIZE / 2 - width / 2;
        const desiredY = targetChamp.y * TILE_SIZE + TILE_SIZE / 2 - height / 2;
        cameraRef.current.x += (desiredX - cameraRef.current.x) * 0.1;
        cameraRef.current.y += (desiredY - cameraRef.current.y) * 0.1;
      }

      const camX = cameraRef.current.x;
      const camY = cameraRef.current.y;

      ctx.save();
      // Background void
      ctx.fillStyle = '#060f15';
      ctx.fillRect(0, 0, width, height);

      // Translate camera
      ctx.translate(-camX, -camY);

      // 1. Render Map Terrain Grid
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const tile = MAP_GRID[y][x];
          const px = x * TILE_SIZE;
          const py = y * TILE_SIZE;

          // Frustum culling
          if (px + TILE_SIZE < camX || px > camX + width || py + TILE_SIZE < camY || py > camY + height) {
            continue;
          }

          if (tile.terrain === 'wall') {
            // Jungle Rocks / Outer Trees
            ctx.fillStyle = '#0a171c';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            // Rock shading
            ctx.fillStyle = '#0f232b';
            ctx.beginPath();
            ctx.roundRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8, 8);
            ctx.fill();

            // Moss speckles
            ctx.fillStyle = 'rgba(20, 80, 45, 0.4)';
            ctx.fillRect(px + 12, py + 12, 10, 8);
          } else if (tile.terrain === 'base_shop') {
            // Base / Shop Zone
            ctx.fillStyle = tile.team === 'blue' ? '#042738' : '#3d0a14';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            // Rune circles
            ctx.strokeStyle = tile.team === 'blue' ? 'rgba(10, 200, 185, 0.4)' : 'rgba(244, 63, 94, 0.4)';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);

            // Arcane glyph
            ctx.fillStyle = tile.team === 'blue' ? 'rgba(10, 200, 185, 0.15)' : 'rgba(244, 63, 94, 0.15)';
            ctx.beginPath();
            ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
            ctx.fill();
          } else if (tile.terrain === 'river') {
            // River Water with subtle animated ripples
            const wave = Math.sin(now * 0.003 + x * 0.5 + y * 0.5) * 4;
            ctx.fillStyle = '#0d3244';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            // Shimmer waves
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(px + 6, py + 18 + wave);
            ctx.bezierCurveTo(px + 20, py + 10 - wave, px + 36, py + 26 + wave, px + 50, py + 18 - wave);
            ctx.stroke();
          } else {
            // Mid Lane Grass / Cracked Stone Path
            ctx.fillStyle = '#143026'; // Grassy Summoner's Rift green
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

            // Stone flagstones along lane
            ctx.fillStyle = '#1b3d31';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

            // Dirt/stone center lane wear
            ctx.fillStyle = 'rgba(120, 90, 40, 0.15)';
            ctx.fillRect(px + 8, py + 8, TILE_SIZE - 16, TILE_SIZE - 16);
          }

          // Subtle Grid border
          ctx.strokeStyle = 'rgba(200, 170, 110, 0.08)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        }
      }

      // 2. Render River Brush Clusters with lush foliage animation
      BRUSH_TILES.forEach((key) => {
        const [bx, by] = key.split(',').map(Number);
        const px = bx * TILE_SIZE;
        const py = by * TILE_SIZE;

        if (px + TILE_SIZE < camX || px > camX + width || py + TILE_SIZE < camY || py > camY + height) return;

        const sway = Math.sin(now * 0.002 + bx + by) * 2;
        ctx.fillStyle = '#064e3b'; // Dense dark river brush
        ctx.beginPath();
        ctx.roundRect(px + 2 + sway, py + 2, TILE_SIZE - 4, TILE_SIZE - 4, 10);
        ctx.fill();

        ctx.fillStyle = '#059669'; // Upper leaves
        ctx.beginPath();
        ctx.arc(px + 16 + sway, py + 18, 12, 0, Math.PI * 2);
        ctx.arc(px + 38 - sway, py + 20, 14, 0, Math.PI * 2);
        ctx.arc(px + 28, py + 38 + sway, 13, 0, Math.PI * 2);
        ctx.fill();

        // Eye icon if a friendly champion or revealed unit is inside
        const championInBrush = Object.values(room.champions).find(
          (c) => !c.isDead && c.x === bx && c.y === by && c.team === myTeam
        );
        if (championInBrush) {
          ctx.fillStyle = '#0ac8b9';
          ctx.font = '10px sans-serif';
          ctx.fillText('👁️ Stealth', px + 6, py + 14);
        }
      });

      // 3. Render Braziers (Torch Pillars with warm fire light)
      BRAZIERS.forEach((b) => {
        const px = b.x * TILE_SIZE;
        const py = b.y * TILE_SIZE;
        const flicker = Math.sin(now * 0.01 + b.x) * 3;

        // Pillar base
        ctx.fillStyle = '#27272a';
        ctx.fillRect(px + 18, py + 22, 20, 24);

        // Torch flame glow
        const glowGrad = ctx.createRadialGradient(
          px + 28,
          py + 18,
          4,
          px + 28,
          py + 18,
          32 + flicker
        );
        glowGrad.addColorStop(0, 'rgba(251, 191, 36, 0.8)');
        glowGrad.addColorStop(0.4, 'rgba(249, 115, 22, 0.4)');
        glowGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(px + 28, py + 18, 32 + flicker, 0, Math.PI * 2);
        ctx.fill();

        // Fire core
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(px + 28, py + 18, 6, 0, Math.PI * 2);
        ctx.fill();
      });

      // 4. Render Outer Turrets
      const renderTurret = (tX: number, tY: number, team: Team) => {
        const turret = room.turrets[team];
        const px = tX * TILE_SIZE;
        const py = tY * TILE_SIZE;

        if (turret.isDestroyed) {
          // Rubble
          ctx.fillStyle = '#3f3f46';
          ctx.fillRect(px + 10, py + 10, TILE_SIZE - 20, TILE_SIZE - 20);
          ctx.fillStyle = '#71717a';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText('RUINS', px + 12, py + 32);
          return;
        }

        // Turret true vision 3-tile radius ring (faint)
        ctx.strokeStyle = team === 'blue' ? 'rgba(10, 200, 185, 0.15)' : 'rgba(244, 63, 94, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE * 3, 0, Math.PI * 2);
        ctx.stroke();

        // Stone Base
        ctx.fillStyle = '#1c1917';
        ctx.beginPath();
        ctx.roundRect(px + 6, py + 6, TILE_SIZE - 12, TILE_SIZE - 12, 8);
        ctx.fill();
        ctx.strokeStyle = team === 'blue' ? '#0ac8b9' : '#f43f5e';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Crystal Core
        const pulse = Math.sin(now * 0.005) * 3;
        const crystalColor = team === 'blue' ? '#38bdf8' : '#fb7185';
        ctx.fillStyle = crystalColor;
        ctx.shadowBlur = 15;
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

      // 5. Render Targeting Range Overlays
      if (me && !me.isDead && room.activePlayerId === currentPlayerId) {
        if (targetMode.type === 'move' && !me.hasMoved) {
          // Highlight walkable tiles within moveSpeed
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
          // Attack range circle
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
          // Ability Range circle
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

          // If hovering and skillshot line
          if (hoveredTile && targetMode.targetType === 'line') {
            const tiles = getLineTiles(me.x, me.y, hoveredTile.x, hoveredTile.y);
            tiles.forEach((t) => {
              if (getDistance(me.x, me.y, t.x, t.y) <= (targetMode.range || 4)) {
                ctx.fillStyle = 'rgba(168, 85, 247, 0.35)';
                ctx.fillRect(t.x * TILE_SIZE + 2, t.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
              }
            });
          }
          // If hovering and AOE circle
          if (hoveredTile && targetMode.targetType === 'aoe') {
            const rad = targetMode.areaRadius || 1;
            for (let ady = -rad; ady <= rad; ady++) {
              for (let adx = -rad; adx <= rad; adx++) {
                const atx = hoveredTile.x + adx;
                const aty = hoveredTile.y + ady;
                if (getDistance(hoveredTile.x, hoveredTile.y, atx, aty) <= rad) {
                  ctx.fillStyle = 'rgba(168, 85, 247, 0.35)';
                  ctx.fillRect(atx * TILE_SIZE + 2, aty * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                }
              }
            }
          }
        }
      }

      // 6. Render Minions
      room.minions.forEach((minion) => {
        const px = minion.x * TILE_SIZE;
        const py = minion.y * TILE_SIZE;

        if (px + TILE_SIZE < camX || px > camX + width || py + TILE_SIZE < camY || py > camY + height) return;

        // Minion Body
        ctx.fillStyle = minion.team === 'blue' ? '#0284c7' : '#e11d48';
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f0e6d2';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Minion Icon (Shield or Staff)
        ctx.fillStyle = '#ffffff';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(minion.type === 'melee' ? '🛡️' : '🪄', px + TILE_SIZE / 2, py + TILE_SIZE / 2);

        // Minion HP Bar
        const hpPct = Math.max(0, minion.currentHp / minion.maxHp);
        ctx.fillStyle = '#050c12';
        ctx.fillRect(px + 8, py + 2, TILE_SIZE - 16, 4);
        ctx.fillStyle = minion.team === 'blue' ? '#38bdf8' : '#fb7185';
        ctx.fillRect(px + 8, py + 2, (TILE_SIZE - 16) * hpPct, 4);
      });

      // 7. Render Champions
      Object.values(room.champions).forEach((champ) => {
        if (champ.isDead) return;

        const px = champ.x * TILE_SIZE;
        const py = champ.y * TILE_SIZE;

        if (px + TILE_SIZE < camX || px > camX + width || py + TILE_SIZE < camY || py > camY + height) return;

        const champData = CHAMPIONS[champ.id];
        const isMyTurn = room.activePlayerId === champ.playerId;
        const isSelectedSpectator = spectatorTargetId === champ.playerId;

        // Check stealth visibility
        const isStealth = champ.statusEffects.some((e) => e.type === 'stealth');
        if (isStealth && champ.team !== myTeam) {
          // Check if revealed by adjacent friendly champion
          const adjacentAlly = Object.values(room.champions).some(
            (c) => !c.isDead && c.team === myTeam && getDistance(c.x, c.y, champ.x, champ.y) <= 1
          );
          // Check if revealed by true vision of allied turret
          const alliedTurretPos = myTeam === 'blue' ? BLUE_TURRET_POS : RED_TURRET_POS;
          const nearTurret = getDistance(champ.x, champ.y, alliedTurretPos.x, alliedTurretPos.y) <= 3;

          if (!adjacentAlly && !nearTurret) {
            // Invisible to enemy client!
            return;
          }
        }

        ctx.save();
        if (isStealth) {
          ctx.globalAlpha = 0.55; // semi-transparent for allies
        }

        // Active Turn Glowing Halo
        if (isMyTurn) {
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

        // Champion Token Circle
        ctx.fillStyle = champData?.avatarColor || '#38bdf8';
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 19, 0, Math.PI * 2);
        ctx.fill();

        // Team Colored Outer Border
        ctx.strokeStyle = champ.team === 'blue' ? '#0ac8b9' : '#f43f5e';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Zhonya Golden Stasis tint
        if (champ.statusEffects.some((e) => e.type === 'zhonya')) {
          ctx.fillStyle = 'rgba(250, 204, 21, 0.6)';
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 19, 0, Math.PI * 2);
          ctx.fill();
        }

        // Champion Icon Emoji
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(champData?.iconText || '⚔️', px + TILE_SIZE / 2, py + TILE_SIZE / 2);

        // Role badge in corner
        ctx.fillStyle = '#050c12';
        ctx.beginPath();
        ctx.arc(px + TILE_SIZE - 10, py + TILE_SIZE - 10, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c8aa6e';
        ctx.font = '9px sans-serif';
        ctx.fillText(champ.role[0].toUpperCase(), px + TILE_SIZE - 10, py + TILE_SIZE - 9);

        // Floating Health & Mana Bars
        const barW = 44;
        const barH = 5;
        const barX = px + (TILE_SIZE - barW) / 2;
        const barY = py - 14;

        // Health Bar Background
        ctx.fillStyle = '#050c12';
        ctx.fillRect(barX, barY, barW, barH);

        // Health Fill
        const hpPct = Math.max(0, champ.currentHp / champ.maxHp);
        ctx.fillStyle = champ.team === 'blue' ? '#22c55e' : '#ef4444';
        ctx.fillRect(barX, barY, barW * hpPct, barH);

        // Shield Overlay
        if (champ.shield > 0) {
          const shieldPct = Math.min(1, champ.shield / champ.maxHp);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(barX + barW * hpPct - (barW * shieldPct) / 2, barY, barW * shieldPct, barH);
        }

        ctx.strokeStyle = '#c8aa6e';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(barX, barY, barW, barH);

        // Mana Bar (if mana-based champion)
        if (champ.maxMana > 0) {
          const manaPct = Math.max(0, champ.currentMana / champ.maxMana);
          ctx.fillStyle = '#050c12';
          ctx.fillRect(barX, barY + 5, barW, 3);
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(barX, barY + 5, barW * manaPct, 3);
        }

        // Champion Name text above
        ctx.fillStyle = '#f0e6d2';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(champ.playerName, px + TILE_SIZE / 2, barY - 3);

        ctx.restore();
      });

      // 8. Render Visual FX Animations
      room.visualFx.forEach((fx) => {
        const age = now - fx.createdAt;
        if (age > fx.durationMs) return;
        const progress = age / fx.durationMs;

        ctx.save();
        if (fx.type === 'attack_beam' || fx.type === 'skillshot_line') {
          const sx = fx.startX * TILE_SIZE + TILE_SIZE / 2;
          const sy = fx.startY * TILE_SIZE + TILE_SIZE / 2;
          const tx = fx.targetX * TILE_SIZE + TILE_SIZE / 2;
          const ty = fx.targetY * TILE_SIZE + TILE_SIZE / 2;

          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 4 * (1 - progress);
          ctx.shadowBlur = 10;
          ctx.shadowColor = fx.color;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
        } else if (fx.type === 'aoe_circle') {
          const cx = fx.startX * TILE_SIZE + TILE_SIZE / 2;
          const cy = fx.startY * TILE_SIZE + TILE_SIZE / 2;
          const maxRadius = (fx.radius || 1) * TILE_SIZE + TILE_SIZE / 2;

          ctx.strokeStyle = fx.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, maxRadius * progress, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = fx.color;
          ctx.globalAlpha = 0.25 * (1 - progress);
          ctx.fill();
        } else if (fx.type === 'flash') {
          const sx = fx.startX * TILE_SIZE + TILE_SIZE / 2;
          const sy = fx.startY * TILE_SIZE + TILE_SIZE / 2;
          const tx = fx.targetX * TILE_SIZE + TILE_SIZE / 2;
          const ty = fx.targetY * TILE_SIZE + TILE_SIZE / 2;

          // Sparkle burst at old and new position
          [ { x: sx, y: sy }, { x: tx, y: ty } ].forEach((pt) => {
            ctx.fillStyle = fx.color;
            ctx.shadowBlur = 15;
            ctx.shadowColor = fx.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 25 * (1 - progress), 0, Math.PI * 2);
            ctx.fill();
          });
        }
        ctx.restore();
      });

      // 9. Render Floating Combat Text
      room.floatingTexts.forEach((ft) => {
        const age = now - ft.createdAt;
        if (age > 1500) return;
        const progress = age / 1500;
        const alpha = 1 - progress;
        const floatOffset = progress * 32;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = ft.color;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 6;
        ctx.shadowColor = '#000000';
        ctx.fillText(
          ft.text,
          ft.x * TILE_SIZE + TILE_SIZE / 2,
          ft.y * TILE_SIZE - floatOffset
        );
        ctx.restore();
      });

      // 10. Hover Tile Cursor
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

      ctx.restore();

      // Render Minimap in bottom-right
      renderMinimap();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [
    currentPlayerId,
    hoveredTile,
    me,
    myTeam,
    room.activePlayerId,
    room.champions,
    room.floatingTexts,
    room.minions,
    room.turrets,
    room.visualFx,
    spectatorTargetId,
    targetMode,
    renderMinimap,
  ]);

  // Mouse & Pointer Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Right click or middle click drags camera
    if (e.button === 2 || e.button === 1 || e.shiftKey) {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Left click selects tile or unit
    if (e.button === 0) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left + cameraRef.current.x;
      const clickY = e.clientY - rect.top + cameraRef.current.y;

      const tileX = Math.floor(clickX / TILE_SIZE);
      const tileY = Math.floor(clickY / TILE_SIZE);

      if (tileX < 0 || tileX >= MAP_WIDTH || tileY < 0 || tileY >= MAP_HEIGHT) return;

      // Check if clicked a unit
      const clickedChamp = Object.values(room.champions).find(
        (c) => !c.isDead && c.x === tileX && c.y === tileY
      );
      if (clickedChamp) {
        if (onSelectSpectatorTarget) onSelectSpectatorTarget(clickedChamp.playerId);
        onTileClick(tileX, tileY, clickedChamp.playerId, 'champion');
        return;
      }

      const clickedMinion = room.minions.find((m) => m.x === tileX && m.y === tileY);
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
    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      cameraRef.current.x -= dx;
      cameraRef.current.y -= dy;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left + cameraRef.current.x;
    const curY = e.clientY - rect.top + cameraRef.current.y;

    const tileX = Math.floor(curX / TILE_SIZE);
    const tileY = Math.floor(curY / TILE_SIZE);

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

  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const mini = minimapRef.current;
    if (!mini) return;
    const rect = mini.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / mini.width;
    const my = (e.clientY - rect.top) / mini.height;

    const targetTileX = Math.floor(mx * MAP_WIDTH);
    const targetTileY = Math.floor(my * MAP_HEIGHT);
    centerCameraOn(targetTileX, targetTileY);
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-[#050c12]">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full h-full cursor-crosshair block"
      />

      {/* Floating Minimap in Bottom-Right */}
      <div className="absolute bottom-4 right-4 z-20 bg-[#09141d]/90 border-2 border-[#c8aa6e]/60 rounded-lg p-1.5 shadow-2xl backdrop-blur-sm">
        <canvas
          ref={minimapRef}
          width={180}
          height={105}
          onClick={handleMinimapClick}
          className="rounded border border-zinc-800 cursor-pointer block hover:brightness-110 transition-all"
          title="Click to Pan Viewport"
        />
        <div className="flex items-center justify-between text-[10px] text-[#c8aa6e]/80 mt-1 px-1">
          <span>Minimap (Click to Pan)</span>
          <span className="text-[#0ac8b9]">Space: Center</span>
        </div>
      </div>
    </div>
  );
}
