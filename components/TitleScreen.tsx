'use client';

import React, { useState, useEffect, useRef } from 'react';
import { sounds } from '../lib/soundEngine';
import { Volume2, VolumeX, Shield, Swords, Sparkles, Users, Server, Check, AlertCircle, RefreshCw, Globe, HelpCircle, X } from 'lucide-react';
import { getActiveSocketUrl } from '../lib/socket';

interface TitleScreenProps {
  isServerConnected?: boolean;
  isServerConnecting?: boolean;
  networkMode?: 'server' | 'mesh';
  serverErrorMessage?: string | null;
  initialRoomCode?: string;
  onCreateRoom: (hostName: string) => void;
  onJoinRoom: (roomCode: string, playerName: string) => void;
  onQuickSolo: (hostName: string) => void;
  onSaveSocketUrl?: (url: string) => void;
}

export function TitleScreen({
  isServerConnected = true,
  isServerConnecting = false,
  networkMode = 'server',
  serverErrorMessage = null,
  initialRoomCode = '',
  onCreateRoom,
  onJoinRoom,
  onQuickSolo,
  onSaveSocketUrl,
}: TitleScreenProps) {
  const [playerName, setPlayerName] = useState('Summoner');
  const [roomCode, setRoomCode] = useState(initialRoomCode || '');
  const [isJoining, setIsJoining] = useState(!!initialRoomCode);
  const [isMuted, setIsMuted] = useState(false);
  const [socketUrl, setSocketUrl] = useState(() => (typeof window !== 'undefined' ? window.localStorage.getItem('custom_socket_url') || '' : ''));
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [showDeployGuide, setShowDeployGuide] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ testing: boolean; message: string | null; ok: boolean | null }>({
    testing: false,
    message: null,
    ok: null,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Ambient grassy particles / mystic runes canvas background
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    interface Particle {
      x: number;
      y: number;
      radius: number;
      speedX: number;
      speedY: number;
      alpha: number;
      color: string;
    }

    const particles: Particle[] = Array.from({ length: 45 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 2.5 + 1,
      speedX: (Math.random() - 0.5) * 0.4,
      speedY: -Math.random() * 0.6 - 0.2,
      alpha: Math.random() * 0.6 + 0.2,
      color: Math.random() > 0.4 ? '#0ac8b9' : '#c8aa6e',
    }));

    const render = () => {
      ctx.fillStyle = '#08121a';
      ctx.fillRect(0, 0, width, height);

      // Subtle diagonal mid lane grass gradient
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#0c2229');
      grad.addColorStop(0.5, '#0a1d1d');
      grad.addColorStop(1, '#1a1811');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Grassy subtle grid
      ctx.strokeStyle = 'rgba(200, 170, 110, 0.04)';
      ctx.lineWidth = 1;
      const gridSize = 50;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Mystic energy motes
      particles.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;
        if (p.y < 0) p.y = height;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleToggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
    if (!muted) sounds.playClick();
  };

  const handleCreate = () => {
    sounds.playClick();
    onCreateRoom(playerName.trim() || 'Summoner');
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    sounds.playClick();
    onJoinRoom(roomCode.trim().toUpperCase(), playerName.trim() || 'Summoner');
  };

  const handleSolo = () => {
    sounds.playClick();
    onQuickSolo(playerName.trim() || 'Summoner');
  };

  const handleSaveSocketUrl = () => {
    const normalizedUrl = socketUrl.trim().replace(/\/+$/, '');
    if (typeof window !== 'undefined') {
      if (normalizedUrl) window.localStorage.setItem('custom_socket_url', normalizedUrl);
      else window.localStorage.removeItem('custom_socket_url');
    }
    onSaveSocketUrl?.(normalizedUrl);
    setShowServerSettings(false);
    sounds.playClick();
  };

  const handleTestHealth = async () => {
    sounds.playClick();
    setHealthStatus({ testing: true, message: 'Testing server connection...', ok: null });
    const rawTarget = socketUrl.trim().replace(/\/+$/, '').replace(/\/socket\.io\/?$/, '');
    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    const target = rawTarget || currentOrigin;
    const isSameOrigin = !rawTarget || rawTarget === currentOrigin;
    const startTime = Date.now();

    try {
      // 1. Probe /api/health with credentials support
      let res: Response | null = await fetch(`${target}/api/health`, {
        mode: 'cors',
        credentials: isSameOrigin ? 'include' : 'omit',
      }).catch(() => null);

      if (!res || !res.ok) {
        // 2. Fallback to /healthz
        res = await fetch(`${target}/healthz`, {
          mode: 'cors',
          credentials: isSameOrigin ? 'include' : 'omit',
        }).catch(() => null);
      }

      const elapsed = Date.now() - startTime;

      if (res && res.ok) {
        // Also probe Socket.IO polling
        let socketProbeOk = false;
        try {
          const sRes = await fetch(`${target}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`, {
            mode: 'cors',
            credentials: isSameOrigin ? 'include' : 'omit',
          });
          if (sRes.ok) socketProbeOk = true;
        } catch {}

        if (socketProbeOk) {
          setHealthStatus({
            testing: false,
            message: `Connected! Server and Socket.IO active (${elapsed}ms).`,
            ok: true,
          });
        } else {
          setHealthStatus({
            testing: false,
            message: `HTTP endpoint online (${elapsed}ms). Socket.IO ready.`,
            ok: true,
          });
        }
      } else if (res && res.status === 404) {
        if (target.includes('ais-pre-') || target.includes('run.app')) {
          setHealthStatus({
            testing: false,
            message: 'HTTP 404: Shared App URL not yet deployed. Cross-Tab mesh multiplayer is active!',
            ok: false,
          });
        } else {
          setHealthStatus({
            testing: false,
            message: 'Server returned HTTP 404. Verify host URL or ensure "node server.ts" is running.',
            ok: false,
          });
        }
      } else if (res) {
        setHealthStatus({
          testing: false,
          message: `Server returned HTTP ${res.status}.`,
          ok: false,
        });
      } else {
        setHealthStatus({
          testing: false,
          message: 'Could not reach server. Verify URL and SSL certificate.',
          ok: false,
        });
      }
    } catch {
      setHealthStatus({
        testing: false,
        message: 'Could not reach server. Cross-Tab multiplayer is active locally.',
        ok: false,
      });
    }
  };

  const handleResetSocketUrl = () => {
    sounds.playClick();
    setSocketUrl('');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('custom_socket_url');
    }
    onSaveSocketUrl?.('');
    setHealthStatus({ testing: false, message: 'Reset to default host server.', ok: true });
  };

  return (
    <div id="title-screen-container" className="relative w-full h-[100dvh] flex flex-col items-center justify-center overflow-hidden select-none animate-fade-in">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Top Bar with Audio and Server Controls */}
      <div className="absolute top-4 right-6 z-20 flex items-center gap-3">
        <button
          id="btn-sound-toggle"
          onClick={handleToggleSound}
          className="p-2.5 rounded-full border border-[#c8aa6e]/40 bg-[#09141d]/80 text-[#c8aa6e] hover:bg-[#0ac8b9]/20 hover:border-[#0ac8b9] transition-all cursor-pointer shadow-lg"
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {isMuted ? <VolumeX className="w-5 h-5 text-rose-400" /> : <Volume2 className="w-5 h-5 text-[#0ac8b9]" />}
        </button>
        <button
          id="btn-server-settings-toggle"
          onClick={() => {
            sounds.playClick();
            setShowServerSettings((visible) => !visible);
          }}
          className="p-2.5 rounded-full border border-[#c8aa6e]/40 bg-[#09141d]/80 text-[#c8aa6e] hover:bg-[#0ac8b9]/20 hover:border-[#0ac8b9] transition-all cursor-pointer shadow-lg relative"
          title="Server & Online Play Settings"
        >
          <Server className="w-5 h-5 text-[#0ac8b9]" />
          {!isServerConnected && !isServerConnecting && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border border-[#09141d]" />
          )}
        </button>
      </div>

      {showServerSettings && (
        <div
          id="server-settings-modal"
          className="absolute top-16 right-4 sm:right-6 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-xl border-2 border-[#c8aa6e]/60 bg-[#09141d]/95 p-5 shadow-2xl backdrop-blur-xl animate-fade-in"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#c8aa6e]/30 mb-3">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#c8aa6e]">
              <Globe className="w-4 h-4 text-[#0ac8b9]" />
              <span>Multiplayer Server</span>
            </div>
            <button
              onClick={() => setShowServerSettings(false)}
              className="text-zinc-400 hover:text-white text-xs p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mb-3">
            <span className="text-[10px] uppercase font-semibold text-zinc-400 block mb-1">Active Connection URL:</span>
            <div className="text-xs font-mono px-2.5 py-1.5 rounded bg-[#050c12] border border-zinc-700 text-[#0ac8b9] truncate">
              {getActiveSocketUrl()}
            </div>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider text-[#c8aa6e] mb-1.5">
            Custom Backend URL
          </label>
          <input
            id="input-socket-url"
            value={socketUrl}
            onChange={(e) => setSocketUrl(e.target.value)}
            placeholder="https://your-app.onrender.com"
            className="w-full px-3 py-2 bg-[#050c12] border border-[#785a28] rounded-md text-[#f0e6d2] text-xs font-mono focus:outline-none focus:border-[#0ac8b9]"
          />
          <p className="mt-1.5 text-[10px] text-zinc-400">
            Leave blank to use this site&apos;s origin. If hosting backend on Render, Railway, or VPS, paste the URL here.
          </p>

          {/* Test Health / Latency Check */}
          <div className="mt-3 flex items-center gap-2">
            <button
              id="btn-test-health"
              onClick={handleTestHealth}
              disabled={healthStatus.testing}
              className="flex-1 rounded border border-[#0ac8b9]/50 bg-[#005a82]/30 px-2.5 py-1.5 text-[11px] font-semibold text-[#0ac8b9] hover:bg-[#0ac8b9]/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${healthStatus.testing ? 'animate-spin' : ''}`} />
              <span>Test Connection</span>
            </button>
            <button
              id="btn-reset-server"
              onClick={handleResetSocketUrl}
              className="rounded border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800 transition-all cursor-pointer"
            >
              Reset Default
            </button>
          </div>

          {healthStatus.message && (
            <div
              className={`mt-2 p-2 rounded text-[11px] flex items-center gap-2 ${
                healthStatus.ok
                  ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/80 border border-rose-500/40 text-rose-300'
              }`}
            >
              {healthStatus.ok ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              )}
              <span className="truncate">{healthStatus.message}</span>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              id="btn-save-socket-url"
              onClick={handleSaveSocketUrl}
              className="w-full rounded-md bg-[#0ac8b9] py-2 text-xs font-bold uppercase text-[#050c12] hover:brightness-110 shadow cursor-pointer transition-all"
            >
              Save & Reconnect
            </button>
          </div>

          {/* Guide for playing outside AI Studio */}
          <div className="mt-3 pt-3 border-t border-zinc-800">
            <button
              onClick={() => setShowDeployGuide((v) => !v)}
              className="text-[11px] text-[#c8aa6e] hover:text-[#0ac8b9] transition-colors flex items-center gap-1 font-medium cursor-pointer"
            >
              <HelpCircle className="w-3 h-3" />
              <span>How to play online outside Google AI Studio?</span>
            </button>

            {showDeployGuide && (
              <div className="mt-2 text-[10px] text-zinc-300 bg-[#050c12] p-3 rounded border border-zinc-800 space-y-1.5 leading-relaxed">
                <p className="font-semibold text-[#0ac8b9]">Playing with friends online:</p>
                <p>1. Deploy the app repository to <span className="text-white font-mono">Render.com</span>, <span className="text-white font-mono">Railway.app</span>, or any Docker host (use included <span className="font-mono text-[#c8aa6e]">Dockerfile</span>).</p>
                <p>2. Enter your live server URL above and click <span className="font-semibold text-white">Save & Reconnect</span>.</p>
                <p>3. Share room codes or direct invite links with friends anywhere in the world!</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Title Container */}
      <div
        id="main-title-container"
        className="relative z-10 w-full max-w-md px-6 py-8 mx-auto flex flex-col items-center animate-fade-in"
      >
        {/* Hextech Emblem Header */}
        <div className="relative mb-6 text-center">
          <div className="inline-flex items-center justify-center p-3 mb-2 rounded-full border-2 border-[#c8aa6e] bg-[#005a82]/30 shadow-[0_0_25px_rgba(10,200,185,0.4)]">
            <Swords className="w-9 h-9 text-[#c8aa6e] animate-pulse" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-b from-[#f0e6d2] via-[#c8aa6e] to-[#785a28] uppercase drop-shadow-[0_2px_12px_rgba(200,170,110,0.4)]">
            Rift Tactics
          </h1>
          <p className="text-sm font-semibold tracking-widest text-[#0ac8b9] uppercase mt-1 drop-shadow">
            Summoner&apos;s Mid Lane 3v3
          </p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="h-[1px] w-12 bg-gradient-to-r from-transparent to-[#c8aa6e]/60"></span>
            <span className="text-[10px] text-[#c8aa6e]/80 tracking-widest uppercase">Tactical Turn-Based Combat</span>
            <span className="h-[1px] w-12 bg-gradient-to-l from-transparent to-[#c8aa6e]/60"></span>
          </div>

          {/* Server / Offline Mode Status Indicator */}
          <div id="status-server-indicator" className="mt-3 flex flex-col items-center gap-1.5">
            {networkMode === 'mesh' ? (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 text-[11px] font-medium tracking-wider shadow-sm backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                <span>Cross-Tab Multiplayer Active (Multi-Tab Ready)</span>
              </div>
            ) : isServerConnected ? (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium tracking-wider shadow-sm backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                <span>Online Server Connected</span>
              </div>
            ) : isServerConnecting ? (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-950/70 border border-sky-500/40 text-sky-300 text-[11px] font-medium tracking-wider shadow-sm backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                <span>Connecting to Server...</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-950/70 border border-amber-500/40 text-amber-300 text-[11px] font-medium tracking-wider shadow-sm backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                <span>Solo vs AI Mode</span>
              </div>
            )}
            {serverErrorMessage && (
              <p className="text-[10px] text-zinc-400 text-center max-w-xs">{serverErrorMessage}</p>
            )}
          </div>
        </div>

        {/* Action Card */}
        <div className="w-full bg-[#09141d]/90 border border-[#c8aa6e]/50 rounded-xl p-6 shadow-[0_10px_35px_rgba(0,0,0,0.8)] backdrop-blur-md">
          {/* Player Name Input */}
          <div className="mb-5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#c8aa6e] mb-1.5">
              Summoner Name
            </label>
            <input
              id="input-player-name"
              type="text"
              maxLength={16}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#050c12] border border-[#785a28] rounded-md text-[#f0e6d2] placeholder-zinc-500 font-medium focus:outline-none focus:border-[#0ac8b9] focus:ring-1 focus:ring-[#0ac8b9] transition-all"
              placeholder="Enter your name..."
            />
          </div>

          {!isJoining ? (
            <div className="flex flex-col gap-3">
              {/* Quick Play vs Bots */}
              <button
                id="btn-quick-play"
                onClick={handleSolo}
                className="w-full py-3 px-4 rounded-md font-bold text-sm tracking-wider uppercase bg-gradient-to-r from-[#005a82] via-[#0ac8b9] to-[#005a82] text-white hover:brightness-110 active:scale-[0.99] transition-all shadow-[0_0_15px_rgba(10,200,185,0.4)] flex items-center justify-center gap-2 border border-[#0ac8b9]/60 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-yellow-300" />
                Quick Play vs Bots (1-Click)
              </button>

              {/* Create Game */}
              <button
                id="btn-create-game"
                onClick={handleCreate}
                className="w-full py-3 px-4 rounded-md font-bold text-sm tracking-wider uppercase bg-gradient-to-r from-[#785a28] via-[#c8aa6e] to-[#785a28] text-[#050c12] hover:brightness-110 active:scale-[0.99] transition-all shadow-[0_0_15px_rgba(200,170,110,0.3)] flex items-center justify-center gap-2 border border-[#c8aa6e] cursor-pointer"
              >
                <Shield className="w-4 h-4 text-[#050c12]" />
                Create Multiplayer Game
              </button>

              {/* Toggle Join Game */}
              <button
                id="btn-show-join"
                onClick={() => {
                  sounds.playClick();
                  setIsJoining(true);
                }}
                className="w-full py-2.5 px-4 rounded-md font-semibold text-xs tracking-wider uppercase border border-[#c8aa6e]/40 text-[#c8aa6e] hover:bg-[#c8aa6e]/10 hover:border-[#c8aa6e] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Users className="w-4 h-4" />
                Join with Room Code
              </button>
            </div>
          ) : (
            <form onSubmit={handleJoin} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#c8aa6e] mb-1.5">
                  6-Letter Room Code
                </label>
                <input
                  id="input-room-code"
                  type="text"
                  maxLength={6}
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="e.g. RIFT88"
                  className="w-full px-4 py-2.5 bg-[#050c12] border border-[#785a28] rounded-md text-[#0ac8b9] font-mono text-center tracking-widest text-lg font-bold placeholder-zinc-600 focus:outline-none focus:border-[#0ac8b9] transition-all"
                  autoFocus
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  id="btn-back-join"
                  onClick={() => {
                    sounds.playClick();
                    setIsJoining(false);
                  }}
                  className="w-1/3 py-2.5 px-3 rounded-md font-semibold text-xs tracking-wider uppercase border border-zinc-700 text-zinc-400 hover:text-white transition-all cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  id="btn-submit-join"
                  disabled={roomCode.trim().length < 4}
                  className="w-2/3 py-2.5 px-4 rounded-md font-bold text-xs tracking-wider uppercase bg-gradient-to-r from-[#005a82] to-[#0ac8b9] text-white disabled:opacity-50 hover:brightness-110 transition-all cursor-pointer shadow-md"
                >
                  Join Game
                </button>
              </div>
            </form>
          )}

          {/* Quick info badges */}
          <div className="mt-5 pt-4 border-t border-[#c8aa6e]/20 flex items-center justify-between text-[11px] text-[#c8aa6e]/70">
            <span>⚔️ 3v3 Best of 3</span>
            <span>🛡️ Outer Turrets</span>
            <span>👾 Minion Waves</span>
          </div>
        </div>
      </div>

      {/* Footer Credits */}
      <div
        id="title-footer-credits"
        className="absolute bottom-3 sm:bottom-4 left-0 right-0 z-20 flex items-center justify-center pointer-events-none px-4"
      >
        <p className="text-xs font-medium tracking-widest text-[#c8aa6e]/85 uppercase flex items-center gap-1.5 bg-[#09141d]/80 px-3.5 py-1 rounded-full border border-[#c8aa6e]/30 shadow-lg backdrop-blur-sm">
          <span>Created by</span>
          <span className="text-[#f0e6d2] font-bold tracking-wider">Ayaan Khan</span>
        </p>
      </div>
    </div>
  );
}
