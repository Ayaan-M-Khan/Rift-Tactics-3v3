'use client';

import React, { useState } from 'react';
import { AbilityKey, GameRoomState, ItemData, ItemId, SummonerSpellId } from '../types/game';
import { CHAMPIONS } from '../data/champions';
import { SHOP_ITEMS } from '../data/items';
import { SUMMONER_SPELLS, getSummonerSpellIconUrl } from '../data/spells';
import { TargetSelectionMode } from './GameCanvas';
import { sounds } from '../lib/soundEngine';
import { getChampionPortraitUrl, getItemIconUrl, getChampionById } from '../lib/ddragon';
import { isInBaseShopZone } from '../data/map';
import {
  RotateCcw,
  ShoppingBag,
  SkipForward,
  Swords,
  Footprints,
  Sparkles,
  Shield,
  Eye,
  Scroll,
  X,
  Volume2,
  VolumeX,
  Undo2,
  Coins,
  Info,
  Check,
} from 'lucide-react';

interface CombatHUDProps {
  room: GameRoomState;
  currentPlayerId: string;
  targetMode: TargetSelectionMode;
  setTargetMode: React.Dispatch<React.SetStateAction<TargetSelectionMode>>;
  onUndoMove: () => void;
  onPassTurn: () => void;
  onBuyItem: (itemId: ItemId) => void;
  onSellItem?: (itemIndex: number) => void;
  onUndoBuyItem?: () => void;
  onUseItem: (itemId: ItemId) => void;
  onPlayAgain: () => void;
  spectatorTargetId?: string;
  onSelectSpectatorTarget: (targetId: string) => void;
}

export function CombatHUD({
  room,
  currentPlayerId,
  targetMode,
  setTargetMode,
  onUndoMove,
  onPassTurn,
  onBuyItem,
  onSellItem,
  onUndoBuyItem,
  onUseItem,
  onPlayAgain,
  spectatorTargetId,
  onSelectSpectatorTarget,
}: CombatHUDProps) {
  const [showShop, setShowShop] = useState(false);
  const [showCombatLog, setShowCombatLog] = useState(false);
  const [shopCategory, setShopCategory] = useState<string>('all');
  const [selectedShopItemId, setSelectedShopItemId] = useState<ItemId | null>('infinity_edge');
  const [selectedHudItemIndex, setSelectedHudItemIndex] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Tooltip hover states
  const [hoveredAbility, setHoveredAbility] = useState<{
    name: string;
    key: string;
    manaCost: number;
    cooldownTurns: number;
    description: string;
  } | null>(null);
  const [hoveredPassive, setHoveredPassive] = useState<{
    name: string;
    description: string;
  } | null>(null);
  const [hoveredSpell, setHoveredSpell] = useState<boolean>(false);

  const me = room.champions[currentPlayerId];
  const isMyTurn = room.activePlayerId === currentPlayerId;
  const isDead = me ? me.isDead : true;
  const inBase = me ? isInBaseShopZone(me.x, me.y, me.team) : false;

  const champData = me ? CHAMPIONS[me.id] : null;
  const ddragonChamp = me ? getChampionById(me.id) : undefined;
  const mySpell = me ? SUMMONER_SPELLS[me.summonerSpell] : null;

  // Shop item filtering
  const filteredItems = Object.values(SHOP_ITEMS).filter((item) => {
    if (shopCategory === 'all') return true;
    return item.category === shopCategory;
  });

  const selectedShopItem = selectedShopItemId ? SHOP_ITEMS[selectedShopItemId] || filteredItems[0] : filteredItems[0];

  const handleToggleMute = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
    if (!muted) sounds.playClick();
  };

  const handleSelectMove = () => {
    if (!isMyTurn || me?.hasMoved) return;
    sounds.playClick();
    if (targetMode.type === 'move') {
      setTargetMode({ type: 'none' });
    } else {
      setTargetMode({ type: 'move' });
    }
  };

  const handleSelectAttack = () => {
    if (!isMyTurn || me?.hasActed) return;
    sounds.playClick();
    if (targetMode.type === 'attack') {
      setTargetMode({ type: 'none' });
    } else {
      setTargetMode({ type: 'attack', range: me?.effectiveRange || 1 });
    }
  };

  const handleSelectAbility = (abilityKey: AbilityKey) => {
    if (!isMyTurn || !champData || !me) return;
    sounds.playClick();
    const ability = champData.abilities.find((a) => a.key === abilityKey);
    if (!ability) return;

    const cd = me.abilities.find((a) => a.key === abilityKey)?.currentCooldown || 0;
    if (cd > 0 || me.currentMana < ability.manaCost) return;

    if (targetMode.type === 'ability' && targetMode.abilityKey === abilityKey) {
      setTargetMode({ type: 'none' });
    } else {
      setTargetMode({
        type: 'ability',
        abilityKey,
        range: ability.range,
        targetType: ability.targetType,
        areaRadius: ability.areaRadius,
      });
    }
  };

  const handleSelectSpell = () => {
    if (!isMyTurn || !mySpell || !me) return;
    sounds.playClick();
    if (me.spellCooldownRounds > 0) return;

    if (targetMode.type === 'spell') {
      setTargetMode({ type: 'none' });
    } else {
      setTargetMode({
        type: 'spell',
        range: mySpell.range,
        targetType: mySpell.targetType,
      });
    }
  };

  const handleBuy = (item: ItemData) => {
    if (!me || me.gold < item.cost || !inBase || me.items.length >= 6) return;
    sounds.playGold();
    onBuyItem(item.id);
  };

  const handleSell = (index: number) => {
    if (!me || !inBase || index < 0 || index >= me.items.length) return;
    sounds.playGold();
    onSellItem?.(index);
    setSelectedHudItemIndex(null);
  };

  const handleUndo = () => {
    if (!me || !inBase || !me.lastPurchasedItemId) return;
    sounds.playGold();
    onUndoBuyItem?.();
  };

  // Teammates for spectator cycle
  const myTeam = me?.team || (room.players.find((p) => p.id === currentPlayerId)?.team || 'blue');
  const livingTeammates = Object.values(room.champions).filter(
    (c) => c.team === myTeam && !c.isDead
  );

  // Auto-fading action log entries (Requirement 6: 3-turn expiration)
  const currentTurn = room.totalTurnsElapsed ?? 0;
  const rawEntries = room.combatLogEntries && room.combatLogEntries.length > 0
    ? room.combatLogEntries
    : room.combatLogs.map((log, idx) => ({
        id: `raw_${idx}`,
        text: log,
        turnNumber: currentTurn,
        timestamp: 0,
        type: 'system' as const,
      }));

  const visibleLogs = rawEntries
    .filter((entry) => currentTurn - entry.turnNumber < 3)
    .slice(-6);

  return (
    <div id="combat-hud-overlay" className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3 select-none overflow-hidden">
      {/* 1. Top Bar: Scores, Best of 3, Turn Queue, Clock, Mute */}
      <div className="w-full flex items-center justify-between gap-4 pointer-events-auto">
        {/* Match Score & Bo3 */}
        <div className="bg-[#09141d]/90 border border-[#c8aa6e]/50 rounded-lg px-4 py-2 flex items-center gap-4 shadow-xl backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0ac8b9] shadow-[0_0_8px_#0ac8b9]"></span>
            <span className="text-sm font-black text-[#0ac8b9]">{room.blueScore}</span>
          </div>
          <div className="text-center">
            <span className="text-[10px] text-[#c8aa6e] uppercase tracking-widest font-black block">
              Round {room.currentRound} of 3
            </span>
            <span className="text-[11px] text-zinc-300 font-semibold tracking-wider">
              Best of Three
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-rose-400">{room.redScore}</span>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
          </div>
        </div>

        {/* Turn Queue Initiative Track */}
        <div className="flex-1 max-w-2xl bg-[#09141d]/90 border border-[#c8aa6e]/50 rounded-lg px-4 py-1.5 flex items-center justify-between gap-3 shadow-xl backdrop-blur-sm overflow-x-auto">
          <div className="flex items-center gap-1 text-[11px] text-[#c8aa6e] font-black uppercase tracking-wider shrink-0">
            <span>Queue:</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto py-1">
            {room.turnQueue.map((pid, idx) => {
              const isTurn = idx === room.currentTurnIndex;
              const champ = room.champions[pid];
              if (!champ || champ.isDead) return null;
              const team = champ.team;
              const portrait = getChampionPortraitUrl(champ.id);

              return (
                <div
                  key={`${pid}-${idx}`}
                  className={`relative flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all shrink-0 overflow-hidden ${
                    isTurn
                      ? 'border-[#c8aa6e] ring-2 ring-[#c8aa6e] scale-110 shadow-[0_0_12px_rgba(200,170,110,0.8)] z-10'
                      : team === 'blue'
                      ? 'border-[#0ac8b9]/60 opacity-80'
                      : 'border-[#e84057]/60 opacity-80'
                  }`}
                  title={`${champ.playerName} (${CHAMPIONS[champ.id]?.name || champ.id})`}
                >
                  <img
                    src={portrait}
                    alt={champ.playerName}
                    className="w-full h-full object-cover"
                  />
                  {isTurn && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#c8aa6e] animate-ping"></span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Turn Timer Clock */}
          <div className="flex items-center gap-1.5 bg-[#050c12] border border-[#c8aa6e]/60 px-3 py-1 rounded-full shrink-0">
            <span className="text-xs text-[#c8aa6e] font-mono">⏱️</span>
            <span
              className={`text-sm font-mono font-bold ${
                room.turnTimeRemainingSeconds <= 5 ? 'text-rose-400 animate-pulse' : 'text-[#f0e6d2]'
              }`}
            >
              {room.turnTimeRemainingSeconds}s
            </span>
          </div>
        </div>

        {/* Action Tray: Camera, Log, Mute */}
        <div className="flex items-center gap-2">
          <button
            id="btn-toggle-combat-log"
            onClick={() => {
              sounds.playClick();
              setShowCombatLog(!showCombatLog);
            }}
            className="p-2 rounded-lg bg-[#09141d]/90 border border-[#c8aa6e]/40 text-[#c8aa6e] hover:border-[#0ac8b9] transition-all cursor-pointer shadow"
            title="Combat Events Log"
          >
            <Scroll className="w-5 h-5" />
          </button>
          <button
            id="btn-hud-sound-toggle"
            onClick={handleToggleMute}
            className="p-2 rounded-lg bg-[#09141d]/90 border border-[#c8aa6e]/40 text-[#c8aa6e] hover:border-[#0ac8b9] transition-all cursor-pointer shadow"
            title="Toggle Sound"
          >
            {isMuted ? <VolumeX className="w-5 h-5 text-rose-400" /> : <Volume2 className="w-5 h-5 text-[#0ac8b9]" />}
          </button>
        </div>
      </div>

      {/* 2. Side Combat Log Drawer (Full history) */}
      {showCombatLog && (
        <div className="absolute top-16 right-4 w-80 max-h-96 bg-[#09141d]/95 border-2 border-[#c8aa6e] rounded-xl p-3 shadow-2xl backdrop-blur-md pointer-events-auto z-40 flex flex-col">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <span className="text-xs font-black uppercase tracking-wider text-[#c8aa6e]">
              Combat Log
            </span>
            <button
              onClick={() => setShowCombatLog(false)}
              className="p-1 rounded text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2 space-y-1 text-[11px]">
            {room.combatLogs.length === 0 ? (
              <p className="text-zinc-500 italic">No combat events yet.</p>
            ) : (
              room.combatLogs.slice(-20).reverse().map((log, idx) => (
                <div key={idx} className="text-zinc-300 border-b border-zinc-900 pb-1">
                  <span>{log}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 2b. Auto-Fading Left-Side Combat Event Feed (Requirement 6: 3-Turn Expiration) */}
      <div className="fixed left-4 top-20 z-20 pointer-events-none max-w-sm flex flex-col gap-1.5">
        {visibleLogs.map((entry) => {
          const age = currentTurn - entry.turnNumber;
          // age 0: full opacity; age 1: 80% opacity; age 2: 45% opacity
          const opacityClass =
            age === 0
              ? 'opacity-100'
              : age === 1
              ? 'opacity-80'
              : 'opacity-45';

          return (
            <div
              key={entry.id}
              className={`transition-opacity duration-700 ease-in-out px-3 py-1.5 rounded-lg bg-[#09141d]/90 border-l-3 shadow-md backdrop-blur-sm flex items-center gap-2 text-xs text-zinc-200 ${
                entry.type === 'kill'
                  ? 'border-l-rose-500 shadow-rose-950/40'
                  : entry.type === 'item'
                  ? 'border-l-amber-400 shadow-amber-950/40'
                  : entry.type === 'spell'
                  ? 'border-l-purple-500 shadow-purple-950/40'
                  : 'border-l-[#c8aa6e] shadow-zinc-950/40'
              } ${opacityClass}`}
            >
              <span className="text-[10px] text-zinc-400 font-mono shrink-0">T{entry.turnNumber}</span>
              <span className="font-medium text-[11px] leading-snug">{entry.text}</span>
            </div>
          );
        })}
      </div>

      {/* 3. Spectator Banner (if eliminated or spectating) */}
      {isDead && (
        <div className="w-full max-w-md mx-auto bg-rose-950/80 border-2 border-rose-500/80 rounded-xl p-3 shadow-2xl backdrop-blur-md pointer-events-auto text-center flex flex-col items-center gap-2 z-30">
          <div className="flex items-center gap-2 text-rose-300 font-black text-sm uppercase tracking-wider">
            <Eye className="w-5 h-5 text-rose-400 animate-pulse" />
            <span>Spectator Mode • You were eliminated</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-300">Watch teammate:</span>
            {livingTeammates.map((mate) => (
              <button
                key={mate.playerId}
                onClick={() => {
                  sounds.playClick();
                  onSelectSpectatorTarget(mate.playerId);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all border ${
                  spectatorTargetId === mate.playerId
                    ? 'bg-[#0ac8b9] text-[#050c12] border-[#0ac8b9]'
                    : 'bg-[#050c12] text-zinc-300 border-zinc-700 hover:border-[#c8aa6e]'
                }`}
              >
                {mate.playerName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating Ability / Passive / Spell High-Fidelity Tooltip */}
      {(hoveredAbility || hoveredPassive || hoveredSpell) && (
        <div className="w-full max-w-md mx-auto mb-1 bg-[#09141d]/95 border-2 border-[#c8aa6e] rounded-xl p-3.5 shadow-2xl backdrop-blur-md z-40 pointer-events-none text-left">
          {hoveredAbility && (
            <>
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
                <span className="font-black text-sm text-[#f0e6d2]">
                  {hoveredAbility.name} <span className="text-[#c8aa6e]">[{hoveredAbility.key}]</span>
                </span>
                <div className="flex items-center gap-2 text-xs font-mono font-bold">
                  {hoveredAbility.manaCost > 0 && (
                    <span className="text-sky-400">{hoveredAbility.manaCost} Mana</span>
                  )}
                  <span className="text-yellow-400">{hoveredAbility.cooldownTurns} Turn CD</span>
                </div>
              </div>
              <p className="text-xs text-zinc-300 mt-2 leading-relaxed">
                {hoveredAbility.description}
              </p>
            </>
          )}
          {hoveredPassive && (
            <>
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
                <span className="font-black text-sm text-[#c8aa6e]">{hoveredPassive.name}</span>
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-mono font-bold">Passive</span>
              </div>
              <p className="text-xs text-zinc-300 mt-2 leading-relaxed">
                {hoveredPassive.description}
              </p>
            </>
          )}
          {hoveredSpell && mySpell && (
            <>
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
                <span className="font-black text-sm text-yellow-400">{mySpell.name} [D]</span>
                <span className="text-xs text-zinc-400 font-mono">Summoner Spell</span>
              </div>
              <p className="text-xs text-zinc-300 mt-2 leading-relaxed">
                {mySpell.description}
              </p>
            </>
          )}
        </div>
      )}

      {/* Floating HUD Item Detail Popover */}
      {selectedHudItemIndex !== null && me?.items[selectedHudItemIndex] && (() => {
        const item = SHOP_ITEMS[me.items[selectedHudItemIndex]];
        if (!item) return null;
        const refundGold = Math.floor(item.cost * 0.7);

        return (
          <div className="fixed bottom-24 right-6 w-72 bg-[#09141d]/95 border-2 border-[#c8aa6e] rounded-xl p-3.5 shadow-2xl backdrop-blur-md pointer-events-auto z-40 flex flex-col gap-2">
            <div className="flex items-start justify-between border-b border-zinc-800 pb-2">
              <div className="flex items-center gap-2.5">
                <img
                  src={getItemIconUrl(item.ddragonId)}
                  alt={item.name}
                  className="w-10 h-10 rounded border border-[#c8aa6e]/60"
                />
                <div>
                  <div className="text-xs font-black text-[#f0e6d2]">{item.name}</div>
                  <div className="text-[10px] text-yellow-400 font-mono font-bold">
                    Cost: {item.cost}g • Sell: +{refundGold}g
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedHudItemIndex(null)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-[11px] text-zinc-300 leading-relaxed">
              {item.description}
            </div>

            <div className="flex items-center gap-2 pt-1">
              {item.activeName && (
                <button
                  disabled={!isMyTurn || isDead}
                  onClick={() => {
                    sounds.playSpell();
                    onUseItem(item.id);
                    setSelectedHudItemIndex(null);
                  }}
                  className="flex-1 py-1.5 rounded bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xs uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Use Active
                </button>
              )}

              <button
                disabled={!isMyTurn || !inBase || isDead}
                onClick={() => handleSell(selectedHudItemIndex)}
                className="flex-1 py-1.5 rounded bg-rose-950 border border-rose-600 hover:bg-rose-900 text-rose-300 font-bold text-xs uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                title={!inBase ? 'Must be in base to sell items' : `Sell for ${refundGold}g`}
              >
                Sell (+{refundGold}g)
              </button>
            </div>
            {!inBase && (
              <span className="text-[9.5px] text-zinc-400 text-center italic">
                Return to base behind turret to sell items
              </span>
            )}
          </div>
        );
      })()}

      {/* 4. Bottom Main Action Bar (Classic League of Legends HUD) */}
      <div className="w-full max-w-4xl mx-auto bg-[#09141d]/95 border-2 border-[#c8aa6e]/60 rounded-xl p-3 shadow-2xl backdrop-blur-md pointer-events-auto flex flex-wrap items-center justify-between gap-4 z-30">
        {/* Left: Champion Portrait, Stats & Gold */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div
              className={`w-14 h-14 rounded-full border-2 flex items-center justify-center overflow-hidden shadow-inner bg-[#050c12] ${
                me?.team === 'blue' ? 'border-[#0ac8b9]' : 'border-[#e84057]'
              }`}
            >
              <img
                src={me ? getChampionPortraitUrl(me.id) : ''}
                alt={champData?.name || 'Champion'}
                className="w-full h-full object-cover"
              />
            </div>
            {/* Gold Badge / Open Shop */}
            <button
              id="btn-open-shop"
              onClick={() => {
                sounds.playClick();
                setShowShop(true);
              }}
              className={`absolute -bottom-2 -right-1 px-2 py-0.5 rounded-full border text-black font-black text-[10px] flex items-center gap-1 shadow hover:scale-105 transition-all cursor-pointer ${
                inBase
                  ? 'bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 border-yellow-200 ring-2 ring-amber-400/50'
                  : 'bg-gradient-to-r from-amber-600 to-yellow-500 border-yellow-300'
              }`}
              title={inBase ? 'In Base Shop Zone! Click to Open Shop' : 'Open Shop'}
            >
              <span>🪙</span>
              <span>{me?.gold ?? 0}</span>
              {inBase && <span className="w-1.5 h-1.5 rounded-full bg-emerald-700 animate-ping"></span>}
            </button>
          </div>

          {/* Bars & Numerical Stats */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <div className="flex items-center justify-between text-xs font-black text-[#f0e6d2]">
              <span>{champData?.name || me?.playerName || 'Champion'}</span>
              <span className="text-[10px] text-[#0ac8b9] uppercase">{me?.role}</span>
            </div>

            {/* Health Bar */}
            <div className="relative w-36 h-4 bg-[#050c12] rounded border border-[#c8aa6e]/40 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.max(0, ((me?.currentHp || 0) / (me?.maxHp || 1)) * 100)}%` }}
              />
              {me && me.shield > 0 && (
                <div
                  className="absolute top-0 bottom-0 bg-sky-400/80 transition-all"
                  style={{
                    left: `${Math.max(0, ((me.currentHp || 0) / (me.maxHp || 1)) * 100)}%`,
                    width: `${Math.min(100, (me.shield / me.maxHp) * 100)}%`,
                  }}
                />
              )}
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-bold text-white drop-shadow">
                {me?.currentHp || 0} / {me?.maxHp || 0} {me && me.shield > 0 ? `(+${me.shield})` : ''}
              </span>
            </div>

            {/* Mana Bar */}
            {(me?.maxMana || 0) > 0 && (
              <div className="relative w-36 h-3 bg-[#050c12] rounded border border-blue-900/60 overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{ width: `${Math.max(0, ((me?.currentMana || 0) / (me?.maxMana || 1)) * 100)}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-mono font-bold text-white drop-shadow">
                  {me?.currentMana || 0} / {me?.maxMana || 0}
                </span>
              </div>
            )}

            {/* Compact Stats */}
            <div className="flex items-center gap-2 text-[10px] text-zinc-300 font-mono">
              <span title="Attack Damage">⚔️ {me?.effectiveAd || 0}</span>
              <span title="Ability Power">✨ {me?.effectiveAp || 0}</span>
              <span title="Armor">🛡️ {me?.effectiveArmor || 0}</span>
              <span title="Range">🎯 {me?.effectiveRange || 1}</span>
            </div>
          </div>
        </div>

        {/* Center: Action Buttons (Move, Attack, Passive, Q, W, E, R, Spell) */}
        <div className="flex items-center gap-2">
          {/* Move Button */}
          <button
            id="btn-action-move"
            disabled={!isMyTurn || !!me?.hasMoved || isDead}
            onClick={handleSelectMove}
            className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg border font-bold text-[10px] transition-all cursor-pointer ${
              targetMode.type === 'move'
                ? 'bg-[#0ac8b9] text-[#050c12] border-[#0ac8b9] shadow-[0_0_12px_#0ac8b9]'
                : me?.hasMoved
                ? 'bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed'
                : 'bg-[#050c12] text-[#0ac8b9] border-[#0ac8b9]/60 hover:bg-[#0ac8b9]/20'
            }`}
            title="Move Champion"
          >
            <Footprints className="w-4 h-4 mb-0.5" />
            <span>MOVE</span>
          </button>

          {/* Undo Move Button */}
          {isMyTurn && me?.hasMoved && !me.hasActed && (
            <button
              id="btn-undo-move"
              onClick={() => {
                sounds.playClick();
                onUndoMove();
              }}
              className="flex flex-col items-center justify-center w-12 h-12 rounded-lg border border-yellow-500/60 bg-yellow-950/40 text-yellow-400 font-bold text-[9px] hover:bg-yellow-500/20 transition-all cursor-pointer"
              title="Undo Move"
            >
              <RotateCcw className="w-4 h-4 mb-0.5" />
              <span>UNDO</span>
            </button>
          )}

          {/* Basic Attack Button */}
          <button
            id="btn-action-attack"
            disabled={!isMyTurn || !!me?.hasActed || isDead}
            onClick={handleSelectAttack}
            className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg border font-bold text-[10px] transition-all cursor-pointer ${
              targetMode.type === 'attack'
                ? 'bg-rose-500 text-white border-rose-500 shadow-[0_0_12px_#f43f5e]'
                : me?.hasActed
                ? 'bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed'
                : 'bg-[#050c12] text-rose-400 border-rose-500/60 hover:bg-rose-500/20'
            }`}
            title="Basic Attack"
          >
            <Swords className="w-4 h-4 mb-0.5" />
            <span>ATTACK</span>
          </button>

          {/* Passive Ability Icon (Requirement 5) */}
          {ddragonChamp?.passive && (
            <div
              onMouseEnter={() =>
                setHoveredPassive({
                  name: ddragonChamp.passive.name,
                  description: ddragonChamp.passive.description,
                })
              }
              onMouseLeave={() => setHoveredPassive(null)}
              className="relative w-12 h-12 rounded-lg border border-[#c8aa6e]/60 bg-[#050c12] flex items-center justify-center overflow-hidden cursor-help shadow"
              title={`${ddragonChamp.passive.name} (Passive)`}
            >
              {ddragonChamp.passive.icon ? (
                <img
                  src={ddragonChamp.passive.icon}
                  alt={ddragonChamp.passive.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-sm font-black text-[#c8aa6e]">P</span>
              )}
              <span className="absolute bottom-0.5 right-1 text-[8.5px] font-black text-amber-300 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                P
              </span>
            </div>
          )}

          {/* Ability Buttons: Q, W, E, R (Requirement 5: Authentic DDragon Spell Icons) */}
          {champData?.abilities.map((ab) => {
            const cd = me?.abilities.find((a) => a.key === ab.key)?.currentCooldown || 0;
            const notEnoughMana = (me?.currentMana || 0) < ab.manaCost;
            const disabled = !isMyTurn || cd > 0 || notEnoughMana || isDead;
            const isSelected = targetMode.type === 'ability' && targetMode.abilityKey === ab.key;
            const dAbility = ddragonChamp?.abilities.find((a) => a.key === ab.key);
            const spellIcon = dAbility?.icon || (ab.icon ? `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/spell/${ab.icon}.png` : '');

            return (
              <button
                key={ab.key}
                id={`btn-ability-${ab.key.toLowerCase()}`}
                disabled={disabled}
                onClick={() => handleSelectAbility(ab.key)}
                onMouseEnter={() =>
                  setHoveredAbility({
                    name: dAbility?.name || ab.name,
                    key: ab.key,
                    manaCost: ab.manaCost,
                    cooldownTurns: ab.cooldownRounds,
                    description: dAbility?.description || ab.description,
                  })
                }
                onMouseLeave={() => setHoveredAbility(null)}
                className={`relative w-12 h-12 rounded-lg border font-bold transition-all cursor-pointer overflow-hidden ${
                  isSelected
                    ? 'border-purple-400 shadow-[0_0_15px_#a855f7] ring-2 ring-purple-400'
                    : disabled
                    ? 'border-zinc-800 opacity-60'
                    : 'border-[#c8aa6e]/60 hover:border-[#0ac8b9]'
                }`}
              >
                {spellIcon ? (
                  <img
                    src={spellIcon}
                    alt={ab.name}
                    className={`w-full h-full object-cover ${disabled ? 'grayscale' : ''}`}
                  />
                ) : (
                  <span className="text-xs font-black">{ab.key}</span>
                )}

                {/* Key Letter Badge */}
                <span className="absolute bottom-0.5 right-1 text-[9px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                  {ab.key}
                </span>

                {/* Mana cost badge */}
                {ab.manaCost > 0 && cd === 0 && (
                  <span className="absolute top-0.5 right-0.5 px-1 rounded bg-sky-950/90 text-sky-300 border border-sky-600/50 text-[8px] font-mono leading-tight">
                    {ab.manaCost}
                  </span>
                )}

                {/* Cooldown Dark Overlay */}
                {cd > 0 && (
                  <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-yellow-400 font-mono text-base font-black">
                    {cd}
                  </div>
                )}
              </button>
            );
          })}

          {/* Summoner Spell (D) */}
          {mySpell && (
            <button
              id="btn-action-spell"
              disabled={!isMyTurn || (me?.spellCooldownRounds || 0) > 0 || isDead}
              onClick={handleSelectSpell}
              onMouseEnter={() => setHoveredSpell(true)}
              onMouseLeave={() => setHoveredSpell(false)}
              className={`relative w-12 h-12 rounded-lg border font-bold transition-all cursor-pointer overflow-hidden ${
                targetMode.type === 'spell'
                  ? 'border-yellow-300 shadow-[0_0_12px_#f59e0b] ring-2 ring-yellow-400'
                  : (me?.spellCooldownRounds || 0) > 0
                  ? 'border-zinc-800 opacity-60'
                  : 'border-[#c8aa6e]/60 hover:border-yellow-400'
              }`}
            >
              <img
                src={getSummonerSpellIconUrl(me?.summonerSpell || 'flash')}
                alt={mySpell.name}
                className={`w-full h-full object-cover ${(me?.spellCooldownRounds || 0) > 0 ? 'grayscale' : ''}`}
              />
              <span className="absolute bottom-0.5 right-1 text-[9px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                D
              </span>

              {(me?.spellCooldownRounds || 0) > 0 && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center text-yellow-400 font-mono text-base font-black">
                  {me?.spellCooldownRounds}
                </div>
              )}
            </button>
          )}
        </div>

        {/* Right: 6 Item Slots (Requirement 4: 2x3 Grid) & Pass Turn */}
        <div className="flex items-center gap-3">
          {/* 6 Item Slots (2 rows of 3) */}
          <div className="grid grid-cols-3 gap-1 bg-[#050c12] p-1.5 rounded-lg border border-zinc-800">
            {Array.from({ length: 6 }).map((_, idx) => {
              const itemId = me?.items[idx];
              const item = itemId ? SHOP_ITEMS[itemId] : null;
              const hasActive = !!item?.activeName;
              const isSelected = selectedHudItemIndex === idx;

              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (item) {
                      sounds.playClick();
                      setSelectedHudItemIndex(isSelected ? null : idx);
                    }
                  }}
                  className={`relative w-8 h-8 rounded border flex items-center justify-center transition-all cursor-pointer overflow-hidden ${
                    isSelected
                      ? 'border-[#0ac8b9] ring-2 ring-[#0ac8b9]'
                      : item
                      ? hasActive
                        ? 'border-yellow-400 bg-yellow-950/40 shadow-[0_0_8px_rgba(245,158,11,0.5)] hover:scale-105'
                        : 'border-[#c8aa6e]/60 bg-[#09141d] hover:border-[#0ac8b9]'
                      : 'border-zinc-800/80 bg-black/40 text-zinc-600'
                  }`}
                  title={item ? `${item.name} (Click for details/sell)` : `Slot ${idx + 1}`}
                >
                  {item ? (
                    <img
                      src={getItemIconUrl(item.ddragonId)}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] font-mono text-zinc-600">{idx + 1}</span>
                  )}
                  {hasActive && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Shop Button */}
          <button
            id="btn-open-shop-drawer"
            onClick={() => {
              sounds.playClick();
              setShowShop(true);
            }}
            className={`p-2.5 rounded-lg border transition-all cursor-pointer relative ${
              inBase
                ? 'bg-gradient-to-br from-amber-950/60 to-yellow-950/60 border-amber-400 text-yellow-300 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                : 'bg-[#050c12] border-[#c8aa6e]/60 text-[#c8aa6e] hover:bg-[#c8aa6e]/20'
            }`}
            title={inBase ? 'Open Shop (In Base - Ready to Buy!)' : 'Open Shop'}
          >
            <ShoppingBag className="w-5 h-5" />
            {inBase && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            )}
          </button>

          {/* Pass Turn Button */}
          <button
            id="btn-pass-turn"
            disabled={!isMyTurn || isDead}
            onClick={() => {
              sounds.playClick();
              setTargetMode({ type: 'none' });
              onPassTurn();
            }}
            className={`px-4 py-3 rounded-lg font-black text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
              isMyTurn && !isDead
                ? 'bg-gradient-to-r from-[#785a28] via-[#c8aa6e] to-[#785a28] text-[#050c12] hover:brightness-110 shadow-[0_0_15px_rgba(200,170,110,0.5)] active:scale-95'
                : 'bg-zinc-900 text-zinc-600 border border-zinc-800 cursor-not-allowed'
            }`}
          >
            <SkipForward className="w-4 h-4" />
            <span>PASS</span>
          </button>
        </div>
      </div>

      {/* 5. Authentic League 1-to-1 Shop Modal (Requirement 3) */}
      {showShop && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 pointer-events-auto">
          <div className="w-full max-w-4xl bg-[#09141d] border-2 border-[#c8aa6e] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            {/* Shop Header */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#c8aa6e]/30 bg-[#050c12]">
              <div className="flex items-center gap-3">
                <ShoppingBag className="w-6 h-6 text-[#c8aa6e]" />
                <div>
                  <h3 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-[#f0e6d2] via-[#c8aa6e] to-[#785a28] uppercase tracking-wider">
                    Item Shop
                  </h3>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-zinc-300">
                      Gold: <strong className="text-yellow-400 font-mono text-sm">{me?.gold || 0}g</strong>
                    </span>
                    <span className="text-zinc-500">•</span>
                    <span className="text-zinc-300">
                      Inventory: <strong className="text-[#0ac8b9] font-mono">{me?.items.length || 0}/6</strong>
                    </span>
                    <span className="text-zinc-500">•</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      inBase
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50'
                        : 'bg-amber-950 text-amber-300 border border-amber-600/50'
                    }`}>
                      {inBase ? '✓ In Base - Shop Active' : '⚠️ Outside Base - Behind Turret Required'}
                    </span>
                  </div>
                </div>
              </div>

              <button
                id="btn-close-shop"
                onClick={() => setShowShop(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Category Tabs */}
            <div className="flex items-center gap-2 px-6 py-2.5 border-b border-zinc-800 bg-[#09141d] overflow-x-auto">
              {[
                { id: 'all', label: 'All Items' },
                { id: 'ad', label: 'Attack Damage (AD)' },
                { id: 'ap', label: 'Ability Power (AP)' },
                { id: 'tank', label: 'Armor & Health' },
                { id: 'mr', label: 'Magic Resist' },
                { id: 'boots', label: 'Boots' },
                { id: 'consumable', label: 'Potions' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    sounds.playClick();
                    setShopCategory(cat.id);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider transition-all border whitespace-nowrap cursor-pointer ${
                    shopCategory === cat.id
                      ? 'bg-[#c8aa6e] text-[#050c12] border-[#c8aa6e] shadow-[0_0_10px_rgba(200,170,110,0.5)]'
                      : 'bg-[#050c12] text-zinc-400 border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Main Content Area: 2 Columns (Left: Item Grid, Right: Item Detail Panel) */}
            <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-3 min-h-[380px]">
              {/* Left Column: Authentic League Item Grid */}
              <div className="md:col-span-2 p-4 overflow-y-auto border-r border-zinc-800/80 bg-[#050c12]/60">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {filteredItems.map((item) => {
                    const canAfford = (me?.gold || 0) >= item.cost;
                    const isSelected = selectedShopItem?.id === item.id;

                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          sounds.playClick();
                          setSelectedShopItemId(item.id);
                        }}
                        className={`p-2 rounded-lg border flex flex-col items-center justify-between gap-1.5 transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#c8aa6e] bg-[#c8aa6e]/15 ring-2 ring-[#c8aa6e] scale-[1.03]'
                            : canAfford
                            ? 'border-zinc-800 bg-[#09141d] hover:border-[#0ac8b9] hover:bg-[#09141d]/80'
                            : 'border-zinc-900 bg-black/40 opacity-50 hover:opacity-80'
                        }`}
                      >
                        <img
                          src={getItemIconUrl(item.ddragonId)}
                          alt={item.name}
                          className="w-12 h-12 rounded object-cover border border-[#c8aa6e]/40 shadow"
                        />
                        <span className="text-[11px] font-bold text-center text-zinc-200 line-clamp-1 w-full">
                          {item.name}
                        </span>
                        <span className="text-[10px] font-mono font-black text-yellow-400">
                          🪙 {item.cost}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Item Detail Panel */}
              <div className="p-5 flex flex-col justify-between bg-[#09141d]">
                {selectedShopItem ? (
                  <div className="flex flex-col gap-3">
                    {/* Header */}
                    <div className="flex items-center gap-3 pb-3 border-b border-zinc-800">
                      <img
                        src={getItemIconUrl(selectedShopItem.ddragonId)}
                        alt={selectedShopItem.name}
                        className="w-14 h-14 rounded-lg border-2 border-[#c8aa6e] shadow-lg"
                      />
                      <div>
                        <h4 className="text-base font-black text-[#f0e6d2]">
                          {selectedShopItem.name}
                        </h4>
                        <div className="text-xs text-yellow-400 font-mono font-bold flex items-center gap-1.5">
                          <span>🪙 {selectedShopItem.cost} Gold</span>
                          <span className="text-zinc-500">•</span>
                          <span className="text-zinc-400 capitalize">{selectedShopItem.category}</span>
                        </div>
                      </div>
                    </div>

                    {/* Stats List */}
                    <div className="flex flex-wrap gap-1.5 py-1">
                      {selectedShopItem.ad && (
                        <span className="px-2 py-0.5 rounded bg-rose-950/60 border border-rose-700/60 text-rose-300 font-mono text-[11px] font-bold">
                          +{selectedShopItem.ad} Attack Damage
                        </span>
                      )}
                      {selectedShopItem.ap && (
                        <span className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-700/60 text-purple-300 font-mono text-[11px] font-bold">
                          +{selectedShopItem.ap} Ability Power
                        </span>
                      )}
                      {selectedShopItem.armor && (
                        <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300 font-mono text-[11px] font-bold">
                          +{selectedShopItem.armor} Armor
                        </span>
                      )}
                      {selectedShopItem.mr && (
                        <span className="px-2 py-0.5 rounded bg-sky-950/60 border border-sky-700/60 text-sky-300 font-mono text-[11px] font-bold">
                          +{selectedShopItem.mr} Magic Resist
                        </span>
                      )}
                      {selectedShopItem.hp && (
                        <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 font-mono text-[11px] font-bold">
                          +{selectedShopItem.hp} Health
                        </span>
                      )}
                      {selectedShopItem.mana && (
                        <span className="px-2 py-0.5 rounded bg-blue-950/60 border border-blue-700/60 text-blue-300 font-mono text-[11px] font-bold">
                          +{selectedShopItem.mana} Mana
                        </span>
                      )}
                      {selectedShopItem.moveBonus && (
                        <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-700/60 text-cyan-300 font-mono text-[11px] font-bold">
                          +{selectedShopItem.moveBonus} Movement
                        </span>
                      )}
                      {selectedShopItem.critRate && (
                        <span className="px-2 py-0.5 rounded bg-yellow-950/60 border border-yellow-700/60 text-yellow-300 font-mono text-[11px] font-bold">
                          +{Math.round(selectedShopItem.critRate * 100)}% Critical Strike
                        </span>
                      )}
                      {selectedShopItem.lifesteal && (
                        <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-700/60 text-red-300 font-mono text-[11px] font-bold">
                          +{Math.round(selectedShopItem.lifesteal * 100)}% Lifesteal
                        </span>
                      )}
                    </div>

                    {/* Passive / Active descriptions */}
                    <div className="bg-[#050c12] p-3 rounded-lg border border-zinc-800/80 flex flex-col gap-2">
                      {selectedShopItem.passiveName && (
                        <div>
                          <span className="text-amber-300 font-black text-xs uppercase tracking-wider block">
                            Passive: {selectedShopItem.passiveName}
                          </span>
                        </div>
                      )}
                      {selectedShopItem.activeName && (
                        <div>
                          <span className="text-sky-300 font-black text-xs uppercase tracking-wider block">
                            Active: {selectedShopItem.activeName}
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-zinc-300 leading-relaxed">
                        {selectedShopItem.description}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">Select an item to view stats</p>
                )}

                {/* Buy Action Section */}
                <div className="pt-4 border-t border-zinc-800 flex flex-col gap-2">
                  {selectedShopItem && (() => {
                    const canAfford = (me?.gold || 0) >= selectedShopItem.cost;
                    const hasSpace = (me?.items.length || 0) < 6;
                    const canBuy = isMyTurn && inBase && canAfford && hasSpace && !isDead;

                    return (
                      <>
                        <button
                          id="btn-modal-buy-item"
                          disabled={!canBuy}
                          onClick={() => handleBuy(selectedShopItem)}
                          className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all border disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-[#785a28] via-[#c8aa6e] to-[#785a28] text-[#050c12] hover:brightness-110 shadow-[0_0_15px_rgba(200,170,110,0.4)] cursor-pointer active:scale-95"
                        >
                          Buy {selectedShopItem.name} ({selectedShopItem.cost}g)
                        </button>

                        {/* Status helper text */}
                        {!inBase ? (
                          <p className="text-[11px] text-amber-400 text-center font-medium">
                            ⚠️ Move champion to your base shop zone to purchase.
                          </p>
                        ) : !canAfford ? (
                          <p className="text-[11px] text-rose-400 text-center font-medium">
                            Need {selectedShopItem.cost - (me?.gold || 0)} more gold.
                          </p>
                        ) : !hasSpace ? (
                          <p className="text-[11px] text-amber-400 text-center font-medium">
                            Inventory full (6/6 slots). Sell an item to free space.
                          </p>
                        ) : (
                          <p className="text-[11px] text-emerald-400 text-center font-medium">
                            ✓ Ready for immediate purchase.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Shop Bottom Bar: Current Inventory Preview + Undo Purchase */}
            <div className="px-6 py-3 border-t border-[#c8aa6e]/30 bg-[#050c12] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-black uppercase text-[#c8aa6e] tracking-wider">
                  Your Inventory:
                </span>
                <div className="flex items-center gap-2">
                  {Array.from({ length: 6 }).map((_, idx) => {
                    const itemId = me?.items[idx];
                    const item = itemId ? SHOP_ITEMS[itemId] : null;

                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          if (item && inBase && isMyTurn) {
                            handleSell(idx);
                          }
                        }}
                        className={`w-9 h-9 rounded border flex items-center justify-center transition-all ${
                          item
                            ? 'border-[#c8aa6e]/80 bg-[#09141d] hover:border-rose-400 cursor-pointer'
                            : 'border-zinc-800 bg-black/40 text-zinc-700'
                        }`}
                        title={item ? `${item.name} (Click to Sell for +${Math.floor(item.cost * 0.7)}g)` : `Slot ${idx + 1}`}
                      >
                        {item ? (
                          <img
                            src={getItemIconUrl(item.ddragonId)}
                            alt={item.name}
                            className="w-full h-full object-cover rounded-sm"
                          />
                        ) : (
                          <span className="text-[10px] font-mono text-zinc-600">{idx + 1}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Undo Last Purchase Button */}
              {me?.lastPurchasedItemId && inBase && isMyTurn && (
                <button
                  id="btn-shop-undo-purchase"
                  onClick={handleUndo}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-950/60 border border-amber-500/80 text-amber-300 text-xs font-black uppercase tracking-wider hover:bg-amber-900/80 flex items-center gap-1.5 transition-all cursor-pointer shadow"
                  title="Undo last purchase for 100% gold refund"
                >
                  <Undo2 className="w-4 h-4" />
                  <span>Undo Purchase</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. Round End Overlay */}
      {room.phase === 'round_end' && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4 pointer-events-auto">
          <div className="w-full max-w-md bg-[#09141d] border-2 border-[#c8aa6e] rounded-2xl p-6 shadow-2xl text-center flex flex-col items-center">
            <h3 className="text-3xl font-black uppercase tracking-widest text-[#c8aa6e] mb-2">
              Round {room.currentRound} Finished!
            </h3>
            <div className="flex items-center justify-center gap-6 my-4 text-2xl font-black">
              <span className="text-[#0ac8b9]">Blue: {room.blueScore}</span>
              <span className="text-zinc-500">•</span>
              <span className="text-rose-400">Red: {room.redScore}</span>
            </div>
            <p className="text-xs text-zinc-400 animate-pulse">
              Starting next round in a few seconds...
            </p>
          </div>
        </div>
      )}

      {/* 7. Match End Overlay (Victory / Defeat) */}
      {room.phase === 'match_end' && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 pointer-events-auto">
          <div className="w-full max-w-lg bg-[#09141d] border-2 border-[#c8aa6e] rounded-2xl p-8 shadow-2xl text-center flex flex-col items-center">
            <div className="text-5xl mb-3">
              {room.matchWinner === myTeam ? '🏆' : '💀'}
            </div>
            <h2 className="text-4xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#f0e6d2] via-[#c8aa6e] to-[#785a28] mb-1">
              {room.matchWinner === myTeam ? 'VICTORY' : 'DEFEAT'}
            </h2>
            <p className="text-sm font-semibold uppercase tracking-wider text-[#0ac8b9] mb-4">
              {room.matchWinner?.toUpperCase()} TEAM WINS THE MATCH!
            </p>

            <div className="w-full bg-[#050c12] border border-zinc-800 rounded-lg p-4 mb-6">
              <div className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Final Score</div>
              <div className="text-3xl font-mono font-black flex items-center justify-center gap-4">
                <span className="text-[#0ac8b9]">Blue {room.blueScore}</span>
                <span className="text-zinc-600">-</span>
                <span className="text-rose-400">{room.redScore} Red</span>
              </div>
            </div>

            <button
              id="btn-play-again"
              onClick={() => {
                sounds.playLockIn();
                onPlayAgain();
              }}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-[#005a82] via-[#0ac8b9] to-[#005a82] text-white font-black text-sm uppercase tracking-widest border border-[#0ac8b9] shadow-[0_0_25px_rgba(10,200,185,0.5)] hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              Play Again (Return to Lobby)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
