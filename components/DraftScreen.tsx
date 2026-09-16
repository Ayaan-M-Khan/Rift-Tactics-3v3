'use client';

import React, { useState } from 'react';
import { ChampionData, GameRoomState, Role, SummonerSpellId } from '../types/game';
import { CHAMPIONS } from '../data/champions';
import { SUMMONER_SPELLS } from '../data/spells';
import { sounds } from '../lib/soundEngine';
import { Ban, Check, Clock, Search, Shield, Zap } from 'lucide-react';

interface DraftScreenProps {
  room: GameRoomState;
  currentPlayerId: string;
  onLockBan: (championId: string) => void;
  onLockPick: (championId: string) => void;
  onSelectSpell: (spellId: SummonerSpellId) => void;
}

export function DraftScreen({
  room,
  currentPlayerId,
  onLockBan,
  onLockPick,
  onSelectSpell,
}: DraftScreenProps) {
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChampionId, setSelectedChampionId] = useState<string | null>(null);
  const [showSpellPicker, setShowSpellPicker] = useState(false);

  const draft = room.draft;
  const isBanPhase = room.phase === 'ban';
  const isPickPhase = room.phase === 'pick';

  const me = room.players.find((p) => p.id === currentPlayerId);
  const myLockedBan = draft?.lockedBans[currentPlayerId];
  const myLockedPick = draft?.lockedPicks[currentPlayerId];
  const mySpell = draft?.selectedSpells[currentPlayerId] || me?.summonerSpell || 'flash';

  const currentPickerId = draft && isPickPhase ? draft.pickOrder[draft.currentPickerIndex] : null;
  const isMyTurnToPick = currentPickerId === currentPlayerId;

  const bluePlayers = room.players.filter((p) => p.team === 'blue');
  const redPlayers = room.players.filter((p) => p.team === 'red');

  // Filter champions
  const championList = Object.values(CHAMPIONS).filter((c) => {
    if (selectedRoleFilter !== 'all' && c.role !== selectedRoleFilter) return false;
    if (searchQuery.trim() && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleSelectChampion = (champ: ChampionData) => {
    sounds.playClick();
    setSelectedChampionId(champ.id);
  };

  const handleConfirmBan = () => {
    if (!selectedChampionId) return;
    sounds.playLockIn();
    onLockBan(selectedChampionId);
  };

  const handleConfirmPick = () => {
    if (!selectedChampionId) return;
    sounds.playLockIn();
    onLockPick(selectedChampionId);
  };

  const handlePickSpell = (spellId: SummonerSpellId) => {
    sounds.playClick();
    onSelectSpell(spellId);
    setShowSpellPicker(false);
  };

  const activeChamp = selectedChampionId ? CHAMPIONS[selectedChampionId] : null;

  return (
    <div id="draft-screen" className="relative w-full h-[100dvh] flex flex-col justify-between bg-[#04090d] text-[#f0e6d2] overflow-hidden select-none">
      {/* Top Header: Phase Title & Timer */}
      <div className="w-full bg-[#08121a] border-b border-[#c8aa6e]/30 px-6 py-2.5 flex items-center justify-between shadow-lg z-20">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-[#0ac8b9] shadow-[0_0_10px_#0ac8b9] animate-pulse"></div>
          <div>
            <h1 className="text-lg sm:text-xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#f0e6d2] via-[#c8aa6e] to-[#785a28]">
              {isBanPhase ? 'BAN A CHAMPION!' : isMyTurnToPick ? 'YOUR TURN TO PICK!' : 'CHOOSE YOUR CHAMPION!'}
            </h1>
            <p className="text-[11px] text-[#0ac8b9] uppercase tracking-wider">
              {isBanPhase ? 'Simultaneous Ban Phase (30s)' : `Pick Order: ${draft?.currentPickerIndex ? draft.currentPickerIndex + 1 : 1} of 6`}
            </p>
          </div>
        </div>

        {/* Big Countdown Timer */}
        <div className="flex items-center gap-2 bg-[#050c12] border border-[#c8aa6e]/60 px-5 py-1.5 rounded-full shadow-[0_0_15px_rgba(200,170,110,0.2)]">
          <Clock className="w-5 h-5 text-[#c8aa6e] animate-spin" style={{ animationDuration: '6s' }} />
          <span className="text-2xl font-mono font-black text-[#f0e6d2] min-w-[36px] text-center">
            {draft?.timeRemainingSeconds ?? 0}
          </span>
        </div>

        {/* Room Code Indicator */}
        <div className="text-right hidden sm:block">
          <span className="text-[10px] text-[#c8aa6e]/70 uppercase tracking-wider block">Match Code</span>
          <span className="text-sm font-mono font-bold text-[#0ac8b9]">{room.roomCode}</span>
        </div>
      </div>

      {/* Main Draft Area: Blue Slots | Center Champion Grid & Info | Red Slots */}
      <div className="flex-1 flex w-full overflow-hidden">
        {/* Left Side: Blue Team Slots */}
        <div className="w-56 sm:w-64 border-r border-[#0ac8b9]/30 bg-[#061017]/90 flex flex-col justify-around p-3 z-10">
          <div className="text-xs font-black uppercase tracking-wider text-[#0ac8b9] pb-1 border-b border-[#0ac8b9]/30 flex items-center justify-between">
            <span>Blue Team</span>
            <span className="w-2 h-2 rounded-full bg-[#0ac8b9]"></span>
          </div>

          <div className="flex flex-col gap-3 py-2">
            {bluePlayers.map((player) => {
              const pickId = draft?.lockedPicks[player.id];
              const champ = pickId ? CHAMPIONS[pickId] : null;
              const banId = draft?.lockedBans[player.id];
              const banChamp = banId ? CHAMPIONS[banId] : null;
              const isCurrent = isPickPhase && currentPickerId === player.id;
              const isMe = player.id === currentPlayerId;

              return (
                <div
                  key={player.id}
                  className={`relative p-2.5 rounded-lg border transition-all ${
                    isCurrent
                      ? 'border-[#0ac8b9] bg-[#0ac8b9]/15 ring-2 ring-[#0ac8b9] shadow-[0_0_15px_rgba(10,200,185,0.3)] animate-pulse'
                      : 'border-[#0ac8b9]/30 bg-[#050d14]'
                  } ${isMe ? 'bg-[#c8aa6e]/10' : ''}`}
                >
                  <div className="flex items-center gap-2.5">
                    {/* Portrait or Placeholder */}
                    <div className="relative w-12 h-12 rounded-full border-2 border-[#0ac8b9] overflow-hidden bg-zinc-900 flex items-center justify-center shrink-0 shadow-inner">
                      {champ ? (
                        <div
                          className="w-full h-full flex items-center justify-center text-xl font-bold"
                          style={{ backgroundColor: champ.avatarColor }}
                        >
                          {champ.iconText}
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-500 font-bold">{player.role[0].toUpperCase()}</span>
                      )}
                    </div>

                    <div className="overflow-hidden flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-black text-[#f0e6d2] truncate">{player.name}</span>
                        {isMe && <span className="text-[10px] text-[#c8aa6e] font-bold">(You)</span>}
                      </div>
                      <div className="text-[11px] text-[#0ac8b9] font-semibold truncate">
                        {champ ? champ.name : isCurrent ? 'Picking...' : 'Waiting...'}
                      </div>
                      <div className="text-[10px] text-zinc-400 capitalize">{player.role}</div>
                    </div>
                  </div>

                  {/* Banned Champ badge */}
                  {banChamp && (
                    <div className="mt-1.5 pt-1 border-t border-zinc-800 flex items-center gap-1 text-[10px] text-rose-400">
                      <Ban className="w-3 h-3" />
                      <span className="truncate">Ban: {banChamp.name}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Center: Champion Filter, Grid, and Detail Preview */}
        <div className="flex-1 flex flex-col bg-[#050c12] p-4 overflow-hidden">
          {/* Champion Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#c8aa6e]/20">
            {/* Role Tabs */}
            <div className="flex items-center gap-1.5">
              {[
                { id: 'all', label: 'All Roles' },
                { id: 'carry', label: 'Carry' },
                { id: 'jungle', label: 'Jungle' },
                { id: 'support', label: 'Support' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    sounds.playClick();
                    setSelectedRoleFilter(tab.id);
                  }}
                  className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all border cursor-pointer ${
                    selectedRoleFilter === tab.id
                      ? 'bg-[#c8aa6e] text-[#050c12] border-[#c8aa6e] shadow-[0_0_10px_rgba(200,170,110,0.4)]'
                      : 'bg-[#08121a] text-zinc-400 border-zinc-700 hover:border-[#c8aa6e]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search champion..."
                className="w-full pl-8 pr-3 py-1.5 bg-[#08121a] border border-zinc-700 rounded text-xs text-[#f0e6d2] focus:outline-none focus:border-[#0ac8b9]"
              />
            </div>
          </div>

          {/* Champion Grid */}
          <div className="flex-1 overflow-y-auto py-4 pr-1 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {championList.map((champ) => {
              const isBanned = draft?.bannedChampions.includes(champ.id);
              const isPicked = Object.values(draft?.lockedPicks || {}).includes(champ.id);
              const isSelected = selectedChampionId === champ.id;
              const disabled = isBanned || isPicked;

              return (
                <button
                  key={champ.id}
                  disabled={disabled}
                  onClick={() => handleSelectChampion(champ)}
                  className={`relative group flex flex-col items-center p-2.5 rounded-lg border transition-all cursor-pointer ${
                    disabled
                      ? 'opacity-40 grayscale border-zinc-800 bg-zinc-950 cursor-not-allowed'
                      : isSelected
                      ? 'border-[#0ac8b9] bg-[#0ac8b9]/20 shadow-[0_0_15px_rgba(10,200,185,0.4)] scale-105'
                      : 'border-[#785a28]/60 bg-[#08121a] hover:border-[#c8aa6e] hover:bg-[#0c1c28]'
                  }`}
                >
                  <div
                    className="w-14 h-14 rounded-full border-2 border-[#c8aa6e]/60 flex items-center justify-center text-2xl shadow-inner mb-1.5"
                    style={{ backgroundColor: champ.avatarColor }}
                  >
                    {champ.iconText}
                  </div>

                  <span className="text-xs font-bold text-[#f0e6d2] truncate max-w-full group-hover:text-[#c8aa6e]">
                    {champ.name}
                  </span>
                  <span className="text-[10px] text-zinc-400 capitalize">{champ.secondaryRole || champ.role}</span>

                  {isBanned && (
                    <div className="absolute inset-0 bg-black/60 rounded-lg flex flex-col items-center justify-center text-rose-400 font-bold text-[10px]">
                      <Ban className="w-5 h-5 mb-0.5" />
                      BANNED
                    </div>
                  )}

                  {isPicked && (
                    <div className="absolute inset-0 bg-black/60 rounded-lg flex flex-col items-center justify-center text-[#c8aa6e] font-bold text-[10px]">
                      <Check className="w-5 h-5 mb-0.5" />
                      PICKED
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Active Champion Ability Preview Tray */}
          {activeChamp && (
            <div className="bg-[#08121a] border border-[#c8aa6e]/40 rounded-lg p-3 mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                  style={{ backgroundColor: activeChamp.avatarColor }}
                >
                  {activeChamp.iconText}
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-[#f0e6d2]">
                    {activeChamp.name} - <span className="text-[#c8aa6e] font-normal italic">{activeChamp.title}</span>
                  </h4>
                  <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                    <span>Range: {activeChamp.attackRange} tiles</span>
                    <span>HP: {activeChamp.baseHp}</span>
                    <span>AD: {activeChamp.baseAd}</span>
                    <span>Armor: {activeChamp.baseArmor}</span>
                  </div>
                </div>
              </div>

              {/* Abilities Row */}
              <div className="flex items-center gap-2">
                {activeChamp.abilities.map((ab) => (
                  <div
                    key={ab.key}
                    className="p-1.5 px-2 rounded bg-[#050c12] border border-zinc-700 text-center"
                    title={`${ab.name}: ${ab.description}`}
                  >
                    <span className="text-[10px] font-black text-[#0ac8b9] block">{ab.key}</span>
                    <span className="text-[10px] text-zinc-300 truncate max-w-[70px] block">{ab.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Red Team Slots */}
        <div className="w-56 sm:w-64 border-l border-rose-500/30 bg-[#061017]/90 flex flex-col justify-around p-3 z-10">
          <div className="text-xs font-black uppercase tracking-wider text-rose-400 pb-1 border-b border-rose-500/30 flex items-center justify-between">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            <span>Red Team</span>
          </div>

          <div className="flex flex-col gap-3 py-2">
            {redPlayers.map((player) => {
              const pickId = draft?.lockedPicks[player.id];
              const champ = pickId ? CHAMPIONS[pickId] : null;
              const banId = draft?.lockedBans[player.id];
              const banChamp = banId ? CHAMPIONS[banId] : null;
              const isCurrent = isPickPhase && currentPickerId === player.id;
              const isMe = player.id === currentPlayerId;

              return (
                <div
                  key={player.id}
                  className={`relative p-2.5 rounded-lg border transition-all ${
                    isCurrent
                      ? 'border-rose-500 bg-rose-500/15 ring-2 ring-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse'
                      : 'border-rose-500/30 bg-[#050d14]'
                  } ${isMe ? 'bg-[#c8aa6e]/10' : ''}`}
                >
                  <div className="flex items-center gap-2.5">
                    {/* Portrait or Placeholder */}
                    <div className="relative w-12 h-12 rounded-full border-2 border-rose-500 overflow-hidden bg-zinc-900 flex items-center justify-center shrink-0 shadow-inner">
                      {champ ? (
                        <div
                          className="w-full h-full flex items-center justify-center text-xl font-bold"
                          style={{ backgroundColor: champ.avatarColor }}
                        >
                          {champ.iconText}
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-500 font-bold">{player.role[0].toUpperCase()}</span>
                      )}
                    </div>

                    <div className="overflow-hidden flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-black text-[#f0e6d2] truncate">{player.name}</span>
                        {isMe && <span className="text-[10px] text-[#c8aa6e] font-bold">(You)</span>}
                      </div>
                      <div className="text-[11px] text-rose-400 font-semibold truncate">
                        {champ ? champ.name : isCurrent ? 'Picking...' : 'Waiting...'}
                      </div>
                      <div className="text-[10px] text-zinc-400 capitalize">{player.role}</div>
                    </div>
                  </div>

                  {/* Banned Champ badge */}
                  {banChamp && (
                    <div className="mt-1.5 pt-1 border-t border-zinc-800 flex items-center gap-1 text-[10px] text-rose-400">
                      <Ban className="w-3 h-3" />
                      <span className="truncate">Ban: {banChamp.name}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Arch: Summoner Spell Selector & Hextech "LOCK IN" Button */}
      <div className="relative w-full bg-[#08121a] border-t border-[#c8aa6e]/30 px-6 py-3 flex items-center justify-between z-30 shadow-2xl">
        {/* Left: Summoner Spell Tray */}
        <div className="relative flex items-center gap-3">
          <span className="text-xs font-black uppercase tracking-wider text-[#c8aa6e]">
            Summoner Spell:
          </span>

          <button
            id="btn-spell-select"
            onClick={() => {
              sounds.playClick();
              setShowSpellPicker(!showSpellPicker);
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#050c12] border border-[#c8aa6e] rounded-md text-xs font-bold text-[#f0e6d2] hover:border-[#0ac8b9] transition-all cursor-pointer shadow"
          >
            <span className="text-base">{SUMMONER_SPELLS[mySpell]?.icon}</span>
            <span>{SUMMONER_SPELLS[mySpell]?.name}</span>
            <Zap className="w-3.5 h-3.5 text-yellow-400" />
          </button>

          {/* Spell Selector Dropdown Popover */}
          {showSpellPicker && (
            <div className="absolute bottom-14 left-0 w-80 bg-[#09141d] border-2 border-[#c8aa6e] rounded-xl p-3 shadow-2xl z-50 flex flex-col gap-2">
              <div className="text-xs font-bold text-[#c8aa6e] uppercase tracking-wider pb-1 border-b border-zinc-800">
                Choose 1 Special Summoner Spell
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                {Object.values(SUMMONER_SPELLS).map((spell) => (
                  <button
                    key={spell.id}
                    onClick={() => handlePickSpell(spell.id)}
                    className={`p-2 rounded border text-left transition-all cursor-pointer ${
                      mySpell === spell.id
                        ? 'bg-[#0ac8b9]/20 border-[#0ac8b9]'
                        : 'bg-[#050c12] border-zinc-800 hover:border-[#c8aa6e]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs text-[#f0e6d2]">
                      <span>{spell.icon}</span>
                      <span>{spell.name}</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{spell.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center: Glowing Hextech "LOCK IN" or "BAN" Confirmation Button */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-6">
          {isBanPhase && (
            <button
              id="btn-lock-ban"
              disabled={!selectedChampionId || !!myLockedBan}
              onClick={handleConfirmBan}
              className="px-8 py-3 rounded-full bg-gradient-to-r from-rose-700 via-rose-500 to-rose-700 disabled:opacity-40 hover:brightness-110 active:scale-95 text-white font-black text-sm uppercase tracking-widest border-2 border-rose-400 shadow-[0_0_25px_rgba(244,63,94,0.6)] flex items-center gap-2 cursor-pointer transition-all"
            >
              <Ban className="w-5 h-5" />
              {myLockedBan ? 'Ban Locked' : 'Ban Champion'}
            </button>
          )}

          {isPickPhase && (
            <button
              id="btn-lock-pick"
              disabled={!selectedChampionId || !isMyTurnToPick || !!myLockedPick}
              onClick={handleConfirmPick}
              className="px-10 py-3 rounded-full bg-gradient-to-r from-[#005a82] via-[#0ac8b9] to-[#005a82] disabled:opacity-40 hover:brightness-110 active:scale-95 text-white font-black text-sm uppercase tracking-widest border-2 border-[#0ac8b9] shadow-[0_0_30px_rgba(10,200,185,0.7)] flex items-center gap-2 cursor-pointer transition-all"
            >
              <Shield className="w-5 h-5" />
              {myLockedPick ? 'Champion Locked' : isMyTurnToPick ? 'LOCK IN' : 'Waiting Turn'}
            </button>
          )}
        </div>

        {/* Right Status */}
        <div className="text-right text-xs text-[#c8aa6e]/80 italic">
          {isBanPhase && 'Ban phase ends when all players confirm or timer reaches 0'}
          {isPickPhase && (isMyTurnToPick ? '✨ Your turn to select and lock in!' : 'Waiting for current picker...')}
        </div>
      </div>
    </div>
  );
}
