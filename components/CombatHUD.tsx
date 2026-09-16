'use client';

import React, { useState } from 'react';
import { AbilityKey, GameRoomState, ItemData, ItemId, SummonerSpellId } from '../types/game';
import { CHAMPIONS } from '../data/champions';
import { SHOP_ITEMS } from '../data/items';
import { SUMMONER_SPELLS } from '../data/spells';
import { TargetSelectionMode } from './GameCanvas';
import { sounds } from '../lib/soundEngine';
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
} from 'lucide-react';

interface CombatHUDProps {
  room: GameRoomState;
  currentPlayerId: string;
  targetMode: TargetSelectionMode;
  setTargetMode: React.Dispatch<React.SetStateAction<TargetSelectionMode>>;
  onUndoMove: () => void;
  onPassTurn: () => void;
  onBuyItem: (itemId: ItemId) => void;
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
  onUseItem,
  onPlayAgain,
  spectatorTargetId,
  onSelectSpectatorTarget,
}: CombatHUDProps) {
  const [showShop, setShowShop] = useState(false);
  const [showCombatLog, setShowCombatLog] = useState(false);
  const [shopCategory, setShopCategory] = useState<string>('all');
  const [isMuted, setIsMuted] = useState(false);

  const me = room.champions[currentPlayerId];
  const isMyTurn = room.activePlayerId === currentPlayerId;
  const isDead = me ? me.isDead : true;

  // Active unit in initiative queue
  const activeUnitId = room.activePlayerId;
  const activeUnitChamp = activeUnitId ? room.champions[activeUnitId] : null;

  const champData = me ? CHAMPIONS[me.id] : null;
  const mySpell = me ? SUMMONER_SPELLS[me.summonerSpell] : null;

  // Shop item filtering
  const filteredItems = Object.values(SHOP_ITEMS).filter((item) => {
    if (shopCategory === 'all') return true;
    return item.category === shopCategory;
  });

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
    // Check cooldown and mana
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
    if (!me || me.gold < item.cost) return;
    sounds.playGold();
    onBuyItem(item.id);
  };

  // Teammates for spectator cycle
  const myTeam = me?.team || (room.players.find((p) => p.id === currentPlayerId)?.team || 'blue');
  const livingTeammates = Object.values(room.champions).filter(
    (c) => c.team === myTeam && !c.isDead
  );

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

              return (
                <div
                  key={`${pid}-${idx}`}
                  className={`relative flex items-center justify-center w-8 h-8 rounded-full border transition-all shrink-0 ${
                    isTurn
                      ? 'border-[#c8aa6e] ring-2 ring-[#c8aa6e] scale-110 shadow-[0_0_12px_rgba(200,170,110,0.8)] z-10'
                      : 'border-zinc-700 opacity-70'
                  } ${team === 'blue' ? 'bg-[#005a82]' : 'bg-rose-950'}`}
                  title={champ.playerName}
                >
                  <span className="text-xs">
                    {CHAMPIONS[champ.id]?.iconText || '⚔️'}
                  </span>
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

        {/* Action Tray: Log, Mute */}
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

      {/* 2. Side Combat Log Drawer */}
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
              room.combatLogs.slice(-15).reverse().map((log, idx) => (
                <div key={idx} className="text-zinc-300 border-b border-zinc-900 pb-1">
                  <span>{log}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 3. Spectator Banner (if eliminated or spectating) */}
      {isDead && (
        <div className="mx-auto bg-[#09141d]/95 border-2 border-[#c8aa6e] rounded-xl px-6 py-2.5 shadow-2xl backdrop-blur-md pointer-events-auto flex items-center gap-4 animate-bounce">
          <Eye className="w-5 h-5 text-[#0ac8b9]" />
          <div>
            <div className="text-xs font-black uppercase text-[#f0e6d2] tracking-wider">
              Spectator Mode • Dead until next round
            </div>
            <div className="text-[11px] text-zinc-400">
              Select an allied champion to follow their camera:
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {livingTeammates.map((mate) => (
              <button
                key={mate.playerId}
                onClick={() => {
                  sounds.playClick();
                  onSelectSpectatorTarget(mate.playerId);
                }}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-all border ${
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

      {/* 4. Bottom Main Action Bar (Classic League of Legends HUD) */}
      <div className="w-full max-w-4xl mx-auto bg-[#09141d]/95 border-2 border-[#c8aa6e]/60 rounded-xl p-3 shadow-2xl backdrop-blur-md pointer-events-auto flex flex-wrap items-center justify-between gap-4 z-30">
        {/* Left: Champion Portrait, Stats & Gold */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div
              className="w-14 h-14 rounded-full border-2 border-[#c8aa6e] flex items-center justify-center text-2xl shadow-inner bg-[#050c12]"
              style={{ backgroundColor: champData?.avatarColor }}
            >
              {champData?.iconText || '⚔️'}
            </div>
            {/* Gold Badge */}
            <button
              id="btn-open-shop"
              onClick={() => {
                sounds.playClick();
                setShowShop(true);
              }}
              className="absolute -bottom-2 -right-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-600 to-yellow-500 border border-yellow-300 text-black font-black text-[10px] flex items-center gap-1 shadow hover:scale-105 transition-all cursor-pointer"
              title="Open Shop"
            >
              <span>🪙</span>
              <span>{me?.gold ?? 0}</span>
            </button>
          </div>

          {/* Bars & Numerical Stats */}
          <div className="flex flex-col gap-1 min-w-[140px]">
            <div className="flex items-center justify-between text-xs font-black text-[#f0e6d2]">
              <span>{me?.playerName || 'Champion'}</span>
              <span className="text-[10px] text-[#0ac8b9] uppercase">{me?.role}</span>
            </div>

            {/* Health Bar */}
            <div className="relative w-36 h-4 bg-[#050c12] rounded border border-[#c8aa6e]/40 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.max(0, ((me?.currentHp || 0) / (me?.maxHp || 1)) * 100)}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-bold text-white drop-shadow">
                {me?.currentHp || 0} / {me?.maxHp || 0}
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

        {/* Center: Action Buttons (Move, Attack, Q, W, E, R, Spell) */}
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

          {/* Ability Buttons: Q, W, E, R */}
          {champData?.abilities.map((ab) => {
            const cd = me?.abilities.find((a) => a.key === ab.key)?.currentCooldown || 0;
            const notEnoughMana = (me?.currentMana || 0) < ab.manaCost;
            const disabled = !isMyTurn || cd > 0 || notEnoughMana || isDead;
            const isSelected = targetMode.type === 'ability' && targetMode.abilityKey === ab.key;

            return (
              <button
                key={ab.key}
                id={`btn-ability-${ab.key.toLowerCase()}`}
                disabled={disabled}
                onClick={() => handleSelectAbility(ab.key)}
                className={`relative flex flex-col items-center justify-center w-12 h-12 rounded-lg border font-bold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_15px_#a855f7]'
                    : disabled
                    ? 'bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed opacity-60'
                    : 'bg-[#050c12] text-purple-300 border-purple-500/60 hover:bg-purple-500/20'
                }`}
                title={`${ab.name} (${ab.key}) - Mana: ${ab.manaCost}\n${ab.description}`}
              >
                <span className="text-xs font-black">{ab.key}</span>
                <span className="text-[8px] truncate max-w-[40px] text-zinc-400">{ab.name}</span>

                {/* Cooldown Overlay */}
                {cd > 0 && (
                  <div className="absolute inset-0 bg-black/75 rounded-lg flex items-center justify-center text-yellow-400 font-mono text-xs font-black">
                    {cd}
                  </div>
                )}

                {/* Mana cost badge */}
                {ab.manaCost > 0 && cd === 0 && (
                  <span className="absolute -top-1 -right-1 px-1 rounded bg-sky-950 text-sky-400 border border-sky-600/50 text-[8px] font-mono">
                    {ab.manaCost}
                  </span>
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
              className={`relative flex flex-col items-center justify-center w-12 h-12 rounded-lg border font-bold transition-all cursor-pointer ${
                targetMode.type === 'spell'
                  ? 'bg-amber-500 text-black border-yellow-300 shadow-[0_0_12px_#f59e0b]'
                  : (me?.spellCooldownRounds || 0) > 0
                  ? 'bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed opacity-60'
                  : 'bg-[#050c12] text-yellow-400 border-yellow-500/60 hover:bg-yellow-500/20'
              }`}
              title={`${mySpell.name} (D/F)\n${mySpell.description}`}
            >
              <span className="text-sm">{mySpell.icon}</span>
              <span className="text-[8px] text-zinc-300 truncate max-w-[40px]">{mySpell.name}</span>

              {(me?.spellCooldownRounds || 0) > 0 && (
                <div className="absolute inset-0 bg-black/75 rounded-lg flex items-center justify-center text-yellow-400 font-mono text-xs font-black">
                  {me?.spellCooldownRounds}
                </div>
              )}
            </button>
          )}
        </div>

        {/* Right: Items Tray & Pass Turn */}
        <div className="flex items-center gap-3">
          {/* 4 Item Slots */}
          <div className="grid grid-cols-2 gap-1 bg-[#050c12] p-1.5 rounded-lg border border-zinc-800">
            {Array.from({ length: 4 }).map((_, idx) => {
              const itemId = me?.items[idx];
              const item = itemId ? SHOP_ITEMS[itemId] : null;
              const hasActive = !!item?.activeName;

              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (hasActive && isMyTurn && item) {
                      sounds.playSpell();
                      onUseItem(item.id);
                    }
                  }}
                  className={`w-7 h-7 rounded border flex items-center justify-center text-xs transition-all ${
                    item
                      ? hasActive
                        ? 'border-yellow-400 bg-yellow-950/40 cursor-pointer hover:scale-105'
                        : 'border-[#c8aa6e]/50 bg-[#09141d]'
                      : 'border-zinc-800 bg-black/40 text-zinc-700'
                  }`}
                  title={item ? `${item.name} (${hasActive ? 'Click to Use Active' : 'Passive'})` : 'Empty Slot'}
                >
                  {item ? item.icon : '•'}
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
            className="p-2.5 rounded-lg bg-[#050c12] border border-[#c8aa6e]/60 text-[#c8aa6e] hover:bg-[#c8aa6e]/20 transition-all cursor-pointer"
            title="Open Shop"
          >
            <ShoppingBag className="w-5 h-5" />
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

      {/* 5. Item Shop Modal */}
      {showShop && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 pointer-events-auto">
          <div className="w-full max-w-2xl bg-[#09141d] border-2 border-[#c8aa6e] rounded-xl p-5 shadow-2xl flex flex-col max-h-[85vh]">
            {/* Shop Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[#c8aa6e]/30">
              <div className="flex items-center gap-3">
                <ShoppingBag className="w-6 h-6 text-[#c8aa6e]" />
                <div>
                  <h3 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-[#f0e6d2] via-[#c8aa6e] to-[#785a28] uppercase tracking-wider">
                    Item Shop
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Your Gold: <span className="text-yellow-400 font-bold">{me?.gold || 0}🪙</span> • Items: {me?.items.length || 0}/6
                  </p>
                </div>
              </div>

              <button
                id="btn-close-shop"
                onClick={() => setShowShop(false)}
                className="p-1 rounded text-zinc-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Categories */}
            <div className="flex items-center gap-2 py-3 border-b border-zinc-800">
              {[
                { id: 'all', label: 'All Items' },
                { id: 'ad', label: 'Damage' },
                { id: 'ap', label: 'Ability Power' },
                { id: 'tank', label: 'Tank' },
                { id: 'boots', label: 'Boots' },
                { id: 'consumable', label: 'Potions' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    sounds.playClick();
                    setShopCategory(cat.id);
                  }}
                  className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition-all border ${
                    shopCategory === cat.id
                      ? 'bg-[#c8aa6e] text-[#050c12] border-[#c8aa6e]'
                      : 'bg-[#050c12] text-zinc-400 border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Items Grid */}
            <div className="flex-1 overflow-y-auto py-4 grid grid-cols-1 sm:grid-cols-2 gap-3 pr-1">
              {filteredItems.map((item) => {
                const canAfford = (me?.gold || 0) >= item.cost;
                const hasSpace = (me?.items.length || 0) < 6;
                const disabled = !canAfford || !hasSpace;

                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-[#050c12] hover:border-[#c8aa6e]/50 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded border border-[#c8aa6e]/40 bg-[#09141d] flex items-center justify-center text-xl">
                        {item.icon || '📦'}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[#f0e6d2]">{item.name}</div>
                        <div className="text-[10px] text-zinc-400 line-clamp-1">{item.description}</div>
                        <div className="text-[10px] text-yellow-400 font-mono font-bold">{item.cost} Gold</div>
                      </div>
                    </div>

                    <button
                      disabled={disabled}
                      onClick={() => handleBuy(item)}
                      className="px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all border disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-[#785a28] to-[#c8aa6e] text-[#050c12] hover:brightness-110"
                    >
                      Buy
                    </button>
                  </div>
                );
              })}
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
