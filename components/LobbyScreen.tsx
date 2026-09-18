'use client';

import React, { useState } from 'react';
import { GameRoomState, LobbyPlayer, Role, Team } from '../types/game';
import { sounds } from '../lib/soundEngine';
import { Copy, Check, Swords, Bot, UserX, Shield, Crown, Share2 } from 'lucide-react';

interface LobbyScreenProps {
  room: GameRoomState;
  currentPlayerId: string;
  onUpdateSlot: (team: Team, role: Role) => void;
  onToggleBotFill: () => void;
  onKickPlayer: (targetPlayerId: string) => void;
  onStartDraft: () => void;
}

export function LobbyScreen({
  room,
  currentPlayerId,
  onUpdateSlot,
  onToggleBotFill,
  onKickPlayer,
  onStartDraft,
}: LobbyScreenProps) {
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const me = room.players.find((p) => p.id === currentPlayerId);
  const isHost = me?.isHost || room.hostPlayerId === currentPlayerId;

  const bluePlayers = room.players.filter((p) => p.team === 'blue');
  const redPlayers = room.players.filter((p) => p.team === 'red');

  const roles: { role: Role; label: string; icon: string }[] = [
    { role: 'carry', label: 'Carry (ADC/Mid)', icon: '⚔️' },
    { role: 'jungle', label: 'Jungle', icon: '🌲' },
    { role: 'support', label: 'Support', icon: '🛡️' },
  ];

  const handleCopyCode = () => {
    sounds.playClick();
    navigator.clipboard.writeText(room.roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    sounds.playClick();
    if (typeof window !== 'undefined') {
      const custom = window.localStorage.getItem('custom_socket_url');
      let url = `${window.location.origin}/?room=${room.roomCode}`;
      if (custom) {
        url += `&server=${encodeURIComponent(custom)}`;
      }
      navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleSelectRole = (newRole: Role) => {
    if (!me) return;
    sounds.playClick();
    onUpdateSlot(me.team, newRole);
  };

  const handleSwitchTeam = (newTeam: Team) => {
    if (!me) return;
    sounds.playClick();
    onUpdateSlot(newTeam, me.role);
  };

  const renderSlot = (team: Team, role: Role, player?: LobbyPlayer) => {
    const isMe = player?.id === currentPlayerId;
    const teamBg = team === 'blue' ? 'border-[#0ac8b9]/40 bg-[#005a82]/20' : 'border-rose-500/40 bg-rose-950/20';
    const highlight = isMe ? 'ring-2 ring-[#c8aa6e] bg-[#c8aa6e]/10' : '';

    return (
      <div
        key={`${team}-${role}`}
        className={`relative flex items-center justify-between p-3.5 rounded-lg border transition-all ${teamBg} ${highlight}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border border-[#c8aa6e]/50 flex items-center justify-center bg-[#050c12] text-base shadow-inner">
            {role === 'carry' ? '⚔️' : role === 'jungle' ? '🌲' : '🛡️'}
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-[#f0e6d2] truncate max-w-[140px]">
                {player ? player.name : <span className="text-zinc-500 italic">Empty Slot</span>}
              </span>
              {player?.isHost && (
                <span title="Room Host">
                  <Crown className="w-3.5 h-3.5 text-yellow-400" />
                </span>
              )}
              {player?.isBot && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-cyan-400 border border-cyan-500/40 font-mono">
                  BOT
                </span>
              )}
            </div>
            <span className="text-[11px] uppercase tracking-wider text-[#c8aa6e]/80 font-medium">
              {role}
            </span>
          </div>
        </div>

        {/* Slot Controls */}
        <div className="flex items-center gap-2">
          {!player && me && me.team !== team && (
            <button
              onClick={() => {
                sounds.playClick();
                onUpdateSlot(team, role);
              }}
              className="text-xs px-2.5 py-1 rounded border border-[#c8aa6e]/60 text-[#c8aa6e] hover:bg-[#c8aa6e]/20 transition-all font-semibold cursor-pointer"
            >
              Take Slot
            </button>
          )}

          {isHost && player && !player.isHost && (
            <button
              onClick={() => {
                sounds.playClick();
                onKickPlayer(player.id);
              }}
              className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 transition-all cursor-pointer"
              title="Kick player"
            >
              <UserX className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div id="lobby-screen" className="w-full h-[100dvh] flex flex-col items-center justify-between p-4 sm:p-6 bg-[#08121a] text-[#f0e6d2] overflow-y-auto">
      {/* Header with Room Code */}
      <div className="w-full max-w-4xl flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#c8aa6e]/30">
        <div>
          <h2 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#f0e6d2] via-[#c8aa6e] to-[#785a28]">
            Mid Lane Tactical Lobby
          </h2>
          <p className="text-xs text-[#0ac8b9] tracking-wider uppercase">
            3v3 Summoner&apos;s Rift • Best of 3 Rounds
          </p>
        </div>

        {/* Room Code Card */}
        <div className="flex items-center gap-2 sm:gap-3 bg-[#09141d] border border-[#c8aa6e]/50 px-3 sm:px-4 py-2 rounded-lg shadow-md">
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-widest text-[#c8aa6e]/70 block">Room Code</span>
            <span className="text-lg font-mono font-black text-[#0ac8b9] tracking-widest">{room.roomCode}</span>
          </div>
          <button
            id="btn-copy-code"
            onClick={handleCopyCode}
            className="p-2 rounded border border-[#785a28] hover:border-[#0ac8b9] bg-[#050c12] text-[#c8aa6e] hover:text-[#0ac8b9] transition-all cursor-pointer"
            title="Copy room code"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            id="btn-copy-invite-link"
            onClick={handleCopyLink}
            className="p-2 rounded border border-[#785a28] hover:border-[#0ac8b9] bg-[#050c12] text-[#c8aa6e] hover:text-[#0ac8b9] transition-all cursor-pointer flex items-center gap-1 text-xs"
            title="Copy direct invite link"
          >
            {copiedLink ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}
            <span className="hidden sm:inline font-semibold text-[11px]">Invite Link</span>
          </button>
        </div>
      </div>

      {/* Main Teams Layout */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6 my-auto py-4">
        {/* Blue Team */}
        <div className="bg-[#09141d]/80 border-2 border-[#0ac8b9]/60 rounded-xl p-5 shadow-[0_0_20px_rgba(10,200,185,0.15)] flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#0ac8b9]/30">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#0ac8b9] shadow-[0_0_8px_#0ac8b9]"></span>
              <h3 className="font-extrabold tracking-wider uppercase text-base text-[#0ac8b9]">
                Blue Team ({bluePlayers.length}/3)
              </h3>
            </div>
            {me?.team !== 'blue' && (
              <button
                onClick={() => handleSwitchTeam('blue')}
                className="text-xs font-bold px-3 py-1 rounded border border-[#0ac8b9] text-[#0ac8b9] hover:bg-[#0ac8b9]/20 transition-all cursor-pointer uppercase"
              >
                Join Blue
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            {roles.map((r) => {
              const player = bluePlayers.find((p) => p.role === r.role);
              return renderSlot('blue', r.role, player);
            })}
          </div>
        </div>

        {/* Red Team */}
        <div className="bg-[#09141d]/80 border-2 border-rose-500/60 rounded-xl p-5 shadow-[0_0_20px_rgba(244,63,94,0.15)] flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-rose-500/30">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
              <h3 className="font-extrabold tracking-wider uppercase text-base text-rose-400">
                Red Team ({redPlayers.length}/3)
              </h3>
            </div>
            {me?.team !== 'red' && (
              <button
                onClick={() => handleSwitchTeam('red')}
                className="text-xs font-bold px-3 py-1 rounded border border-rose-500 text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer uppercase"
              >
                Join Red
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            {roles.map((r) => {
              const player = redPlayers.find((p) => p.role === r.role);
              return renderSlot('red', r.role, player);
            })}
          </div>
        </div>
      </div>

      {/* Role Selection & Host Controls Bar */}
      <div className="w-full max-w-4xl bg-[#09141d]/90 border border-[#c8aa6e]/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl">
        {/* My Role Selector */}
        {me && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#c8aa6e]">
              My Role:
            </span>
            <div className="flex gap-1.5">
              {roles.map((r) => {
                const isSelected = me.role === r.role;
                return (
                  <button
                    key={r.role}
                    onClick={() => handleSelectRole(r.role)}
                    className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-[#c8aa6e] text-[#09141d] border-[#c8aa6e] shadow-[0_0_10px_rgba(200,170,110,0.5)]'
                        : 'bg-[#050c12] text-zinc-400 border-zinc-700 hover:border-[#c8aa6e]'
                    }`}
                  >
                    {r.icon} {r.role}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Host Controls */}
        <div className="flex items-center gap-3 ml-auto">
          {isHost && (
            <button
              id="btn-toggle-bot-fill"
              onClick={() => {
                sounds.playClick();
                onToggleBotFill();
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                room.fillBots
                  ? 'bg-cyan-950/60 text-[#0ac8b9] border-[#0ac8b9]'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-white'
              }`}
            >
              <Bot className="w-4 h-4" />
              Bot Fill: {room.fillBots ? 'ON' : 'OFF'}
            </button>
          )}

          {isHost ? (
            <button
              id="btn-start-draft"
              onClick={() => {
                sounds.playLockIn();
                onStartDraft();
              }}
              className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-[#005a82] via-[#0ac8b9] to-[#005a82] hover:brightness-110 active:scale-95 text-white font-black text-sm uppercase tracking-widest border border-[#0ac8b9] shadow-[0_0_20px_rgba(10,200,185,0.4)] flex items-center gap-2 cursor-pointer transition-all"
            >
              <Swords className="w-4 h-4" />
              Start Draft Phase
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-[#c8aa6e]/80 italic">
              <Shield className="w-4 h-4 text-[#c8aa6e]" />
              Waiting for host to start draft...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
