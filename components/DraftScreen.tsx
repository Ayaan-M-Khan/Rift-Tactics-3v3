'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { GameRoomState, SummonerSpellId } from '../types/game';
import { DraftAbility, DraftChampion, DraftRoleFilter, DraftSortMode } from '../types/draft';
import { fetchChampions, getChampionsSync } from '../lib/ddragon';
import { SUMMONER_SPELLS } from '../data/spells';
import { sounds } from '../lib/soundEngine';
import { getSocket } from '../lib/socket';
import {
  Ban,
  Check,
  Clock,
  Search,
  Zap,
  Shield,
  Swords,
  Flame,
  Crosshair,
  Sparkles,
  Heart,
  ArrowUpDown,
  Volume2,
  VolumeX,
  HelpCircle,
  X,
  Minus,
} from 'lucide-react';

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
  // All 170+ champions state, initialized synchronously with fallback
  const [championsMap, setChampionsMap] = useState<Record<string, DraftChampion>>(() => {
    const list = getChampionsSync();
    const map: Record<string, DraftChampion> = {};
    for (const c of list) {
      map[c.id] = c;
    }
    return map;
  });

  const [selectedRoleFilter, setSelectedRoleFilter] = useState<DraftRoleFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<DraftSortMode>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedChampionId, setSelectedChampionId] = useState<string | null>(null);
  const [hoveredAbility, setHoveredAbility] = useState<DraftAbility | null>(null);
  const [showSpellPicker, setShowSpellPicker] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [remoteHovers, setRemoteHovers] = useState<Record<string, string>>({}); // playerId -> championId

  // Fetch / verify latest champion dataset from Riot Data Dragon
  useEffect(() => {
    let mounted = true;
    fetchChampions().then((data) => {
      if (mounted && data && Object.keys(data).length > 0) {
        setChampionsMap(data);
      }
    });

    const socket = getSocket();
    const handleRemoteHover = (payload: { playerId: string; championId: string }) => {
      if (payload && payload.playerId) {
        setRemoteHovers((prev) => ({
          ...prev,
          [payload.playerId]: payload.championId,
        }));
      }
    };

    socket.on('draft_hovered', handleRemoteHover);

    return () => {
      mounted = false;
      socket.off('draft_hovered', handleRemoteHover);
    };
  }, []);

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

  // Filter and sort champions
  const filteredChampions = useMemo(() => {
    const list = Object.values(championsMap);
    const filtered = list.filter((c) => {
      if (selectedRoleFilter !== 'ALL' && !c.roles.includes(selectedRoleFilter)) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = c.name.toLowerCase().includes(query);
        const matchesTitle = c.title.toLowerCase().includes(query);
        const matchesTag = c.tags.some((t) => t.toLowerCase().includes(query));
        if (!matchesName && !matchesTitle && !matchesTag) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortAsc ? cmp : -cmp;
    });

    return filtered;
  }, [championsMap, selectedRoleFilter, searchQuery, sortAsc]);

  // Handle champion hover/select
  const handleSelectChampion = (champ: DraftChampion) => {
    const isBanned = draft?.bannedChampions.includes(champ.id);
    const isPicked = Object.values(draft?.lockedPicks || {}).includes(champ.id);
    if (isBanned || (isPicked && isPickPhase)) return;

    sounds.playClick();
    setSelectedChampionId(champ.id);

    // Notify server of hover
    const socket = getSocket();
    socket.emit('draft_select', {
      roomCode: room.roomCode,
      playerId: currentPlayerId,
      championId: champ.id,
    });
  };

  const handleConfirmBan = () => {
    if (!selectedChampionId || !!myLockedBan) return;
    sounds.playLockIn();
    onLockBan(selectedChampionId);
    const socket = getSocket();
    socket.emit('draft_ban', {
      roomCode: room.roomCode,
      playerId: currentPlayerId,
      championId: selectedChampionId,
    });
  };

  const handleConfirmPick = () => {
    if (!selectedChampionId || !isMyTurnToPick || !!myLockedPick) return;
    sounds.playLockIn();
    onLockPick(selectedChampionId);
    const socket = getSocket();
    socket.emit('draft_lock', {
      roomCode: room.roomCode,
      playerId: currentPlayerId,
      championId: selectedChampionId,
    });
  };

  const handlePickSpell = (spellId: SummonerSpellId) => {
    sounds.playClick();
    onSelectSpell(spellId);
    setShowSpellPicker(false);
  };

  const toggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
  };

  const activeChamp = selectedChampionId ? championsMap[selectedChampionId] : null;
  const timeRemaining = draft?.timeRemainingSeconds ?? 30;
  const isTimeCritical = timeRemaining <= 10;

  // Resolve player avatar image
  const getPlayerDisplayChampion = (playerId: string) => {
    const lockedPick = draft?.lockedPicks[playerId];
    if (lockedPick) return championsMap[lockedPick] || null;
    const hovered = remoteHovers[playerId];
    if (hovered) return championsMap[hovered] || null;
    if (playerId === currentPlayerId && selectedChampionId) {
      return championsMap[selectedChampionId] || null;
    }
    return null;
  };

  return (
    <div
      id="draft-screen"
      className="relative w-full h-[100dvh] max-h-[100dvh] flex flex-col justify-between bg-[#010a13] text-[#f0e6d2] overflow-hidden select-none font-sans"
    >
      {/* Background ambient vignette & subtle hextech backdrop */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#091428]/60 via-[#010a13]/90 to-[#00050a] pointer-events-none z-0" />
      {activeChamp && (
        <div
          className="absolute inset-0 opacity-15 bg-cover bg-center transition-all duration-700 pointer-events-none z-0 blur-sm scale-105"
          style={{ backgroundImage: `url(${activeChamp.splashArt})` }}
        />
      )}

      {/* TOP HEADER: League Client Phase Bar & Countdown Ring */}
      <header className="relative w-full h-16 bg-gradient-to-b from-[#091428] to-[#010a13]/90 border-b border-[#785a28]/50 px-6 flex items-center justify-between shadow-2xl z-20">
        {/* Left: Mode / Room indicator */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border border-[#c8aa6e]/60 bg-[#091428] flex items-center justify-center text-[#c8aa6e] shadow-[0_0_10px_rgba(200,170,110,0.3)]">
            <Swords className="w-4 h-4 text-[#0ac8b9]" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-[#c8aa6e]/80">
              3v3 Rift Tactics • Match {room.roomCode}
            </div>
            <div className="text-xs font-bold text-zinc-300">
              {isBanPhase ? 'Ban Phase (Simultaneous)' : 'Draft Phase (Alternating)'}
            </div>
          </div>
        </div>

        {/* Center: Official LoL Phase Header with Progress Bar & Pulse Timer */}
        <div className="flex flex-col items-center justify-center">
          <div className="flex items-center gap-4">
            <div className="h-[1px] w-12 sm:w-24 bg-gradient-to-r from-transparent to-[#c8aa6e]" />
            <h1 className="text-lg sm:text-2xl font-black uppercase tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-b from-[#f0e6d2] via-[#c8aa6e] to-[#785a28] drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
              {isBanPhase
                ? 'BAN A CHAMPION!'
                : isMyTurnToPick
                ? 'CHOOSE YOUR CHAMPION!'
                : 'PREPARE YOUR CHAMPION!'}
            </h1>
            <div className="h-[1px] w-12 sm:w-24 bg-gradient-to-l from-transparent to-[#c8aa6e]" />
          </div>

          {/* Thin Hextech glowing progress line */}
          <div className="w-64 sm:w-96 h-[2px] bg-zinc-800 rounded-full mt-1 relative overflow-hidden">
            <div
              className={`h-full transition-all duration-1000 ${
                isTimeCritical
                  ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]'
                  : 'bg-gradient-to-r from-[#005a82] via-[#0ac8b9] to-[#c8aa6e] shadow-[0_0_10px_#0ac8b9]'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, (timeRemaining / 30) * 100))}%` }}
            />
          </div>
        </div>

        {/* Right: Circular Timer Ring & Window Controls */}
        <div className="flex items-center gap-4">
          {/* Circular Countdown Ring */}
          <div
            className={`relative flex items-center justify-center w-12 h-12 rounded-full border-2 transition-all duration-300 ${
              isTimeCritical
                ? 'border-rose-500 bg-rose-950/40 shadow-[0_0_20px_rgba(244,63,94,0.6)] animate-pulse'
                : 'border-[#c8aa6e] bg-[#091428] shadow-[0_0_15px_rgba(200,170,110,0.3)]'
            }`}
          >
            <span
              className={`text-xl font-mono font-black tracking-tight ${
                isTimeCritical ? 'text-rose-400' : 'text-[#f0e6d2]'
              }`}
            >
              {timeRemaining}
            </span>
          </div>

          {/* Decorative League Client Window Controls */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-zinc-800 text-zinc-400">
            <button
              onClick={toggleSound}
              title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
              className="p-1.5 hover:text-[#c8aa6e] hover:bg-zinc-800/60 rounded transition-colors"
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-[#0ac8b9]" />}
            </button>
            <button
              title="Help & Info"
              className="p-1.5 hover:text-[#c8aa6e] hover:bg-zinc-800/60 rounded transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              title="Minimize"
              className="p-1.5 hover:text-[#c8aa6e] hover:bg-zinc-800/60 rounded transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              title="Close"
              className="p-1.5 hover:text-rose-400 hover:bg-zinc-800/60 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* MAIN DRAFT ARENA: Blue Roster | Center Filter & 170+ Champion Grid | Red Roster */}
      <div className="relative flex-1 flex w-full overflow-hidden z-10">
        {/* LEFT COLUMN: Blue Team Roster */}
        <aside className="w-64 sm:w-72 bg-[#020b13]/80 border-r border-[#0ac8b9]/25 flex flex-col justify-between p-3.5 backdrop-blur-sm shadow-xl z-10">
          <div className="flex items-center justify-between pb-2 border-b border-[#0ac8b9]/30">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0ac8b9] shadow-[0_0_8px_#0ac8b9]" />
              <span className="text-xs font-black uppercase tracking-widest text-[#0ac8b9]">
                Blue Team
              </span>
            </div>
            <span className="text-[10px] font-mono text-zinc-400">ORDER</span>
          </div>

          <div className="flex flex-col gap-3 py-2 flex-1 justify-around">
            {bluePlayers.map((player) => {
              const pickId = draft?.lockedPicks[player.id];
              const banId = draft?.lockedBans[player.id];
              const champ = getPlayerDisplayChampion(player.id);
              const banChamp = banId ? championsMap[banId] : null;
              const isCurrent = isPickPhase && currentPickerId === player.id;
              const isMe = player.id === currentPlayerId;
              const spellId = draft?.selectedSpells[player.id] || player.summonerSpell || 'flash';
              const spell = SUMMONER_SPELLS[spellId] || SUMMONER_SPELLS.flash;

              return (
                <div
                  key={player.id}
                  className={`relative p-2.5 rounded-xl border transition-all duration-300 ${
                    isCurrent
                      ? 'border-[#0ac8b9] bg-[#0ac8b9]/10 ring-2 ring-[#0ac8b9]/80 shadow-[0_0_20px_rgba(10,200,185,0.4)]'
                      : 'border-[#0ac8b9]/20 bg-[#040e17]/80 hover:border-[#0ac8b9]/40'
                  } ${isMe ? 'bg-[#c8aa6e]/10 border-[#c8aa6e]/50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Left: Two Summoner Spell Badges */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <div
                        className="w-5 h-5 rounded border border-[#0ac8b9]/60 bg-zinc-900 flex items-center justify-center text-[10px] shadow"
                        title={spell.name}
                      >
                        <span>{spell.icon}</span>
                      </div>
                      <div
                        className="w-5 h-5 rounded border border-yellow-500/60 bg-zinc-900 flex items-center justify-center text-[10px] shadow"
                        title="Flash"
                      >
                        <span>⚡</span>
                      </div>
                    </div>

                    {/* Circular Champion Portrait Ring */}
                    <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                      {/* Active Picker Animated Cyan Arc Ring */}
                      {isCurrent && (
                        <div className="absolute inset-[-4px] rounded-full border-2 border-transparent border-t-[#0ac8b9] border-r-[#0ac8b9] animate-spin shadow-[0_0_12px_#0ac8b9]" />
                      )}
                      <div className="relative w-13 h-13 rounded-full border-2 border-[#0ac8b9]/80 overflow-hidden bg-[#091428] flex items-center justify-center shadow-inner">
                        {champ ? (
                          <Image
                            src={champ.squareIcon}
                            alt={champ.name}
                            width={52}
                            height={52}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="text-sm font-bold text-zinc-500 font-mono">
                            {player.role[0].toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Player Info & Picking Status */}
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-black text-[#f0e6d2] truncate">
                          {player.name}
                        </span>
                        {isMe && (
                          <span className="text-[9px] font-bold text-[#c8aa6e] bg-[#c8aa6e]/20 px-1 py-0.5 rounded">
                            YOU
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-semibold truncate mt-0.5">
                        {pickId ? (
                          <span className="text-[#0ac8b9] font-bold">{champ?.name || pickId}</span>
                        ) : isCurrent ? (
                          <span className="text-[#0ac8b9] animate-pulse flex items-center gap-1 font-bold">
                            Picking...
                          </span>
                        ) : champ ? (
                          <span className="text-zinc-400 italic">{champ.name} (Hover)</span>
                        ) : (
                          <span className="text-zinc-500">Waiting...</span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-400 uppercase tracking-wider capitalize font-mono">
                        {player.role}
                      </div>
                    </div>

                    {/* Current Picker Countdown Indicator */}
                    {isCurrent && (
                      <div className="shrink-0 text-right">
                        <span className="text-xs font-mono font-black text-[#0ac8b9] bg-[#0ac8b9]/20 px-1.5 py-0.5 rounded border border-[#0ac8b9]/60 animate-pulse">
                          {timeRemaining}s
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Banned Champion Badge */}
                  {banChamp && (
                    <div className="mt-2 pt-1.5 border-t border-zinc-800/80 flex items-center gap-1.5 text-[10px] text-rose-400">
                      <Ban className="w-3 h-3 text-rose-500" />
                      <span className="truncate font-medium">Banned: {banChamp.name}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-[10px] font-mono text-zinc-500 text-center py-1">
            Pick order alternates 1-2-2-1
          </div>
        </aside>

        {/* CENTER AREA: Filter Bar & 170+ Champion Grid */}
        <main className="flex-1 flex flex-col bg-[#010a13]/90 px-4 py-3 overflow-hidden z-10">
          {/* FILTER BAR: Role Tabs, Sort Mode, Search Input */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#785a28]/40">
            {/* Role Category Tabs */}
            <div className="flex items-center gap-1.5 bg-[#030d17] p-1 rounded-lg border border-[#785a28]/30">
              {[
                { id: 'ALL', label: 'All', icon: Sparkles },
                { id: 'TOP', label: 'Top', icon: Swords },
                { id: 'JUNGLE', label: 'Jungle', icon: Flame },
                { id: 'MID', label: 'Mid', icon: Zap },
                { id: 'BOT', label: 'Bot', icon: Crosshair },
                { id: 'SUPPORT', label: 'Support', icon: Heart },
              ].map((tab) => {
                const IconComponent = tab.icon;
                const isActive = selectedRoleFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      sounds.playClick();
                      setSelectedRoleFilter(tab.id as DraftRoleFilter);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#c8aa6e] text-[#010a13] shadow-[0_0_12px_rgba(200,170,110,0.5)] font-black'
                        : 'text-zinc-400 hover:text-[#f0e6d2] hover:bg-zinc-800/60'
                    }`}
                  >
                    <IconComponent className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Middle: Sort Mode Toggle */}
            <button
              onClick={() => {
                sounds.playClick();
                setSortAsc(!sortAsc);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#030d17] border border-[#785a28]/40 rounded-lg text-xs font-semibold text-[#c8aa6e] hover:border-[#c8aa6e] transition-colors cursor-pointer"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>Sort: {sortAsc ? 'A to Z' : 'Z to A'}</span>
            </button>

            {/* Right: Search Input with Champion Counter */}
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search 170+ Champions..."
                className="w-full pl-8 pr-8 py-1.5 bg-[#030d17] border border-[#785a28]/40 rounded-lg text-xs text-[#f0e6d2] placeholder-zinc-500 focus:outline-none focus:border-[#0ac8b9] focus:ring-1 focus:ring-[#0ac8b9]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-zinc-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Roster Counter */}
          <div className="flex items-center justify-between text-[11px] text-zinc-400 py-1.5 px-1 font-mono">
            <span>
              Showing <strong className="text-[#c8aa6e]">{filteredChampions.length}</strong> Champions
            </span>
            <span className="text-zinc-500">Official Riot Data Dragon Roster</span>
          </div>

          {/* 170+ CHAMPION SCROLLABLE GRID */}
          <div className="flex-1 overflow-y-auto pr-1 grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-2.5 content-start pb-4">
            {filteredChampions.map((champ) => {
              const isBanned = draft?.bannedChampions.includes(champ.id);
              const isPicked = Object.values(draft?.lockedPicks || {}).includes(champ.id);
              const isSelected = selectedChampionId === champ.id;
              const disabled = isBanned || (isPicked && isPickPhase);

              return (
                <button
                  key={champ.id}
                  disabled={disabled}
                  onClick={() => handleSelectChampion(champ)}
                  className={`group relative flex flex-col items-center p-1.5 rounded-lg border transition-all duration-150 cursor-pointer ${
                    disabled
                      ? 'opacity-35 grayscale border-zinc-800 bg-zinc-950 cursor-not-allowed'
                      : isSelected
                      ? 'border-[#0ac8b9] bg-[#0ac8b9]/20 shadow-[0_0_16px_rgba(10,200,185,0.6)] ring-2 ring-[#0ac8b9] scale-105 z-10'
                      : 'border-[#785a28]/50 bg-[#040e17] hover:border-[#c8aa6e] hover:bg-[#091824] hover:scale-105 hover:shadow-[0_0_12px_rgba(200,170,110,0.3)]'
                  }`}
                >
                  {/* Square Champion Portrait */}
                  <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded border border-[#785a28]/60 overflow-hidden bg-zinc-900 shadow-md mb-1 group-hover:border-[#c8aa6e]">
                    <Image
                      src={champ.squareIcon}
                      alt={champ.name}
                      width={64}
                      height={64}
                      className="w-full h-full object-cover transition-transform group-hover:scale-110"
                      unoptimized
                    />

                    {/* Role badge in corner */}
                    <div className="absolute bottom-0 right-0 bg-[#010a13]/85 text-[8px] font-bold px-1 text-[#c8aa6e] rounded-tl border-t border-l border-[#785a28]/40">
                      {champ.roles[0]}
                    </div>
                  </div>

                  {/* Champion Name */}
                  <span
                    className={`text-[11px] font-bold truncate max-w-full tracking-tight transition-colors ${
                      isSelected
                        ? 'text-[#0ac8b9]'
                        : 'text-[#f0e6d2] group-hover:text-[#c8aa6e]'
                    }`}
                  >
                    {champ.name}
                  </span>

                  {/* Banned Overlay */}
                  {isBanned && (
                    <div className="absolute inset-0 bg-black/75 rounded-lg flex flex-col items-center justify-center text-rose-400 font-black text-[10px] tracking-wider z-20">
                      <Ban className="w-5 h-5 mb-0.5 text-rose-500" />
                      BANNED
                    </div>
                  )}

                  {/* Picked Overlay */}
                  {isPicked && isPickPhase && (
                    <div className="absolute inset-0 bg-black/75 rounded-lg flex flex-col items-center justify-center text-[#c8aa6e] font-black text-[10px] tracking-wider z-20">
                      <Check className="w-5 h-5 mb-0.5 text-[#c8aa6e]" />
                      LOCKED
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </main>

        {/* RIGHT COLUMN: Red Team Roster */}
        <aside className="w-64 sm:w-72 bg-[#020b13]/80 border-l border-rose-500/25 flex flex-col justify-between p-3.5 backdrop-blur-sm shadow-xl z-10">
          <div className="flex items-center justify-between pb-2 border-b border-rose-500/30">
            <span className="text-[10px] font-mono text-zinc-400">CHAOS</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-widest text-rose-400">
                Red Team
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
            </div>
          </div>

          <div className="flex flex-col gap-3 py-2 flex-1 justify-around">
            {redPlayers.map((player) => {
              const pickId = draft?.lockedPicks[player.id];
              const banId = draft?.lockedBans[player.id];
              const champ = getPlayerDisplayChampion(player.id);
              const banChamp = banId ? championsMap[banId] : null;
              const isCurrent = isPickPhase && currentPickerId === player.id;
              const isMe = player.id === currentPlayerId;
              const spellId = draft?.selectedSpells[player.id] || player.summonerSpell || 'flash';
              const spell = SUMMONER_SPELLS[spellId] || SUMMONER_SPELLS.flash;

              return (
                <div
                  key={player.id}
                  className={`relative p-2.5 rounded-xl border transition-all duration-300 ${
                    isCurrent
                      ? 'border-rose-500 bg-rose-500/10 ring-2 ring-rose-500/80 shadow-[0_0_20px_rgba(244,63,94,0.4)]'
                      : 'border-rose-500/20 bg-[#040e17]/80 hover:border-rose-500/40'
                  } ${isMe ? 'bg-[#c8aa6e]/10 border-[#c8aa6e]/50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Current Picker Countdown Indicator */}
                    {isCurrent && (
                      <div className="shrink-0">
                        <span className="text-xs font-mono font-black text-rose-400 bg-rose-500/20 px-1.5 py-0.5 rounded border border-rose-500/60 animate-pulse">
                          {timeRemaining}s
                        </span>
                      </div>
                    )}

                    {/* Player Info & Picking Status */}
                    <div className="flex-1 overflow-hidden text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isMe && (
                          <span className="text-[9px] font-bold text-[#c8aa6e] bg-[#c8aa6e]/20 px-1 py-0.5 rounded">
                            YOU
                          </span>
                        )}
                        <span className="text-xs font-black text-[#f0e6d2] truncate">
                          {player.name}
                        </span>
                      </div>
                      <div className="text-[11px] font-semibold truncate mt-0.5">
                        {pickId ? (
                          <span className="text-rose-400 font-bold">{champ?.name || pickId}</span>
                        ) : isCurrent ? (
                          <span className="text-rose-400 animate-pulse flex items-center justify-end gap-1 font-bold">
                            Picking...
                          </span>
                        ) : champ ? (
                          <span className="text-zinc-400 italic">{champ.name} (Hover)</span>
                        ) : (
                          <span className="text-zinc-500">Waiting...</span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-400 uppercase tracking-wider capitalize font-mono">
                        {player.role}
                      </div>
                    </div>

                    {/* Circular Champion Portrait Ring */}
                    <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                      {/* Active Picker Animated Rose Arc Ring */}
                      {isCurrent && (
                        <div className="absolute inset-[-4px] rounded-full border-2 border-transparent border-t-rose-500 border-l-rose-500 animate-spin shadow-[0_0_12px_#f43f5e]" />
                      )}
                      <div className="relative w-13 h-13 rounded-full border-2 border-rose-500/80 overflow-hidden bg-[#091428] flex items-center justify-center shadow-inner">
                        {champ ? (
                          <Image
                            src={champ.squareIcon}
                            alt={champ.name}
                            width={52}
                            height={52}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <span className="text-sm font-bold text-zinc-500 font-mono">
                            {player.role[0].toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Two Summoner Spell Badges */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <div
                        className="w-5 h-5 rounded border border-rose-500/60 bg-zinc-900 flex items-center justify-center text-[10px] shadow"
                        title={spell.name}
                      >
                        <span>{spell.icon}</span>
                      </div>
                      <div
                        className="w-5 h-5 rounded border border-yellow-500/60 bg-zinc-900 flex items-center justify-center text-[10px] shadow"
                        title="Flash"
                      >
                        <span>⚡</span>
                      </div>
                    </div>
                  </div>

                  {/* Banned Champion Badge */}
                  {banChamp && (
                    <div className="mt-2 pt-1.5 border-t border-zinc-800/80 flex items-center justify-end gap-1.5 text-[10px] text-rose-400">
                      <span className="truncate font-medium">Banned: {banChamp.name}</span>
                      <Ban className="w-3 h-3 text-rose-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-[10px] font-mono text-zinc-500 text-center py-1">
            Red team has final counter-pick
          </div>
        </aside>
      </div>

      {/* BOTTOM TRAY: Champion Preview (Stats + Passive + QWER Abilities) & Hextech Lock-In */}
      <footer className="relative w-full bg-gradient-to-t from-[#00050a] via-[#05111b] to-[#091428] border-t border-[#785a28]/60 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 z-30 shadow-[0_-5px_25px_rgba(0,0,0,0.8)]">
        {/* Left: Highlighted Champion Preview (Portrait + Tactical Stats + 5 Ability Icons) */}
        <div className="flex items-center gap-4 flex-1 min-w-[320px]">
          {activeChamp ? (
            <div className="flex items-center gap-3 bg-[#030d17]/80 border border-[#785a28]/50 rounded-xl p-2 pr-4 shadow-xl">
              {/* High-res Square Icon */}
              <div className="relative w-12 h-12 rounded-lg border-2 border-[#c8aa6e] overflow-hidden bg-zinc-900 shadow-md shrink-0">
                <Image
                  src={activeChamp.squareIcon}
                  alt={activeChamp.name}
                  width={48}
                  height={48}
                  className="w-full h-full object-cover"
                  unoptimized
                />
              </div>

              {/* Name & Tactical Base Stats */}
              <div>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-black text-[#f0e6d2] tracking-wide">
                    {activeChamp.name}
                  </h3>
                  <span className="text-[11px] text-[#c8aa6e] italic capitalize font-serif truncate max-w-[150px]">
                    {activeChamp.title}
                  </span>
                </div>

                {/* Tactical Stats Chips */}
                <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-300 mt-0.5">
                  <span className="text-emerald-400 font-bold">HP {activeChamp.stats.hp}</span>
                  <span className="text-rose-400 font-bold">AD {activeChamp.stats.attackDamage}</span>
                  <span className="text-amber-400 font-bold">ARM {activeChamp.stats.armor}</span>
                  <span className="text-[#0ac8b9] font-bold">
                    RNG {activeChamp.stats.attackRange === 3 ? '3 (Ranged)' : '1 (Melee)'}
                  </span>
                </div>
              </div>

              {/* 5 Ability Icons: Passive + Q + W + E + R with Rich Hover Tooltips */}
              <div className="flex items-center gap-1.5 pl-3 border-l border-zinc-700/60 ml-2">
                {/* Passive */}
                <div
                  className="relative group cursor-pointer"
                  onMouseEnter={() => setHoveredAbility(activeChamp.passive)}
                  onMouseLeave={() => setHoveredAbility(null)}
                >
                  <div className="w-8 h-8 rounded border border-[#c8aa6e]/80 overflow-hidden bg-zinc-950 hover:border-[#0ac8b9] transition-all">
                    {activeChamp.passive.icon ? (
                      <Image
                        src={activeChamp.passive.icon}
                        alt={activeChamp.passive.name}
                        width={32}
                        height={32}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-[#c8aa6e]">
                        P
                      </div>
                    )}
                  </div>
                  <span className="absolute -bottom-1 -right-1 bg-[#010a13] text-[#c8aa6e] text-[8px] font-mono font-bold px-1 rounded border border-[#785a28]/60">
                    P
                  </span>
                </div>

                {/* Q, W, E, R Abilities */}
                {activeChamp.abilities.map((ab) => (
                  <div
                    key={ab.key}
                    className="relative group cursor-pointer"
                    onMouseEnter={() => setHoveredAbility(ab)}
                    onMouseLeave={() => setHoveredAbility(null)}
                  >
                    <div className="w-8 h-8 rounded border border-zinc-700 overflow-hidden bg-zinc-950 hover:border-[#0ac8b9] transition-all">
                      {ab.icon ? (
                        <Image
                          src={ab.icon}
                          alt={ab.name}
                          width={32}
                          height={32}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-zinc-300">
                          {ab.key}
                        </div>
                      )}
                    </div>
                    <span className="absolute -bottom-1 -right-1 bg-[#010a13] text-[#0ac8b9] text-[8px] font-mono font-bold px-1 rounded border border-[#005a82]">
                      {ab.key}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-400 italic">
              Select a champion from the roster above to view tactical stats & abilities.
            </div>
          )}

          {/* Floating Tooltip for Hovered Ability */}
          {hoveredAbility && (
            <div className="absolute bottom-16 left-6 w-80 bg-[#040e17] border-2 border-[#c8aa6e] rounded-xl p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md">
              <div className="flex items-center justify-between pb-1.5 border-b border-[#785a28]/40 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-[#091428] text-[#0ac8b9] font-mono font-bold text-xs flex items-center justify-center border border-[#0ac8b9]/60">
                    {hoveredAbility.key}
                  </span>
                  <span className="text-xs font-bold text-[#f0e6d2]">{hoveredAbility.name}</span>
                </div>
                {hoveredAbility.cooldown && (
                  <span className="text-[10px] font-mono text-zinc-400">
                    CD: {hoveredAbility.cooldown}s
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed max-h-32 overflow-y-auto">
                {hoveredAbility.description}
              </p>
            </div>
          )}
        </div>

        {/* Center Action: Official Hextech "LOCK IN" / "BAN" Button */}
        <div className="flex items-center justify-center">
          {isBanPhase && (
            <button
              id="btn-lock-ban"
              disabled={!selectedChampionId || !!myLockedBan}
              onClick={handleConfirmBan}
              className="relative px-10 py-3 rounded-md bg-gradient-to-r from-rose-900 via-rose-600 to-rose-900 disabled:opacity-35 disabled:cursor-not-allowed hover:brightness-110 active:scale-95 text-white font-black text-sm uppercase tracking-[0.2em] border-2 border-rose-400 shadow-[0_0_25px_rgba(244,63,94,0.6)] flex items-center gap-2.5 transition-all cursor-pointer"
            >
              <Ban className="w-5 h-5" />
              <span>{myLockedBan ? 'BAN LOCKED' : 'BAN CHAMPION'}</span>
            </button>
          )}

          {isPickPhase && (
            <div className="relative flex items-center justify-center">
              {/* Hextech wing ornaments */}
              <div className="absolute -left-6 w-6 h-10 border-t-2 border-b-2 border-l-2 border-[#c8aa6e]/60 rounded-l-md pointer-events-none hidden sm:block" />
              <button
                id="btn-lock-pick"
                disabled={!selectedChampionId || !isMyTurnToPick || !!myLockedPick}
                onClick={handleConfirmPick}
                className={`px-12 py-3.5 rounded-sm font-black text-sm uppercase tracking-[0.25em] border-2 transition-all duration-200 flex items-center gap-2.5 ${
                  myLockedPick
                    ? 'bg-zinc-800 border-zinc-600 text-zinc-400 cursor-not-allowed'
                    : isMyTurnToPick && selectedChampionId
                    ? 'bg-gradient-to-r from-[#005a82] via-[#0ac8b9] to-[#005a82] text-white border-[#0ac8b9] shadow-[0_0_35px_rgba(10,200,185,0.8)] hover:brightness-115 active:scale-95 cursor-pointer animate-pulse'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-500 cursor-not-allowed opacity-50'
                }`}
              >
                <Shield className="w-5 h-5" />
                <span>
                  {myLockedPick
                    ? 'CHAMPION LOCKED'
                    : isMyTurnToPick
                    ? 'LOCK IN'
                    : 'WAITING YOUR TURN'}
                </span>
              </button>
              <div className="absolute -right-6 w-6 h-10 border-t-2 border-b-2 border-r-2 border-[#c8aa6e]/60 rounded-r-md pointer-events-none hidden sm:block" />
            </div>
          )}
        </div>

        {/* Right: Summoner Spell Customization Dropdown */}
        <div className="relative flex items-center gap-3">
          <div className="relative">
            <button
              id="btn-spell-select"
              onClick={() => {
                sounds.playClick();
                setShowSpellPicker(!showSpellPicker);
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#030d17] border border-[#c8aa6e] rounded-lg text-xs font-bold text-[#f0e6d2] hover:border-[#0ac8b9] transition-all cursor-pointer shadow-lg"
            >
              <span className="text-base">{SUMMONER_SPELLS[mySpell]?.icon || '⚡'}</span>
              <span>{SUMMONER_SPELLS[mySpell]?.name || 'Flash'}</span>
              <Zap className="w-3.5 h-3.5 text-yellow-400" />
            </button>

            {/* Spell Selector Dropdown Popover */}
            {showSpellPicker && (
              <div className="absolute bottom-12 right-0 w-72 bg-[#040e17] border-2 border-[#c8aa6e] rounded-xl p-3 shadow-2xl z-50 flex flex-col gap-2 backdrop-blur-md animate-in fade-in">
                <div className="text-xs font-bold text-[#c8aa6e] uppercase tracking-wider pb-1 border-b border-zinc-800">
                  Select Summoner Spell
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                  {Object.values(SUMMONER_SPELLS).map((spell) => (
                    <button
                      key={spell.id}
                      onClick={() => handlePickSpell(spell.id)}
                      className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                        mySpell === spell.id
                          ? 'bg-[#0ac8b9]/20 border-[#0ac8b9] shadow-[0_0_8px_rgba(10,200,185,0.4)]'
                          : 'bg-[#06121c] border-zinc-800 hover:border-[#c8aa6e]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs text-[#f0e6d2]">
                        <span>{spell.icon}</span>
                        <span>{spell.name}</span>
                      </div>
                      <p className="text-[9px] text-zinc-400 mt-1 line-clamp-2 leading-tight">
                        {spell.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
