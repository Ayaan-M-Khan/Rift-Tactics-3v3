import {
  ActiveStatusEffect,
  ChampionData,
  ChampionState,
  CombatFloatingText,
  DecoyUnit,
  DraftState,
  GamePhase,
  GameRoomState,
  LobbyPlayer,
  MinionUnit,
  Role,
  SummonerSpellId,
  Team,
  TurretUnit,
  VisualFxAnimation,
} from '../types/game';
import { CHAMPIONS } from '../data/champions';
import { SHOP_ITEMS } from '../data/items';
import {
  BLUE_BASE_BOUNDS,
  BLUE_MINION_PATH,
  BLUE_SPAWN_POINTS,
  BLUE_TURRET_POS,
  BRUSH_TILES,
  getDistance,
  getLineTiles,
  isInBaseShopZone,
  isTileInBounds,
  isTileWalkable,
  MAP_GRID,
  RED_BASE_BOUNDS,
  RED_MINION_PATH,
  RED_SPAWN_POINTS,
  RED_TURRET_POS,
} from '../data/map';

export class GameEngine {
  private rooms: Map<string, GameRoomState> = new Map();
  private playerSessions: Map<string, { roomCode: string; playerId: string }> = new Map();
  private turnTimers: Map<string, ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>> = new Map();
  // NETWORK FIX: rooms with zero connected humans are never garbage-collected otherwise,
  // leaking memory (and stale intervals) for the lifetime of the process.
  private abandonedRoomTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private onRoomUpdated?: (room: GameRoomState) => void;

  constructor(onRoomUpdated?: (room: GameRoomState) => void) {
    this.onRoomUpdated = onRoomUpdated;
  }

  public setUpdateListener(callback: (room: GameRoomState) => void) {
    this.onRoomUpdated = callback;
  }

  private emitUpdate(room: GameRoomState) {
    // 1. Prune expired visualFx (older than durationMs + 400ms)
    const now = Date.now();
    if (room.visualFx && room.visualFx.length > 0) {
      room.visualFx = room.visualFx.filter((fx) => (now - fx.createdAt) <= (fx.durationMs || 600) + 400);
    }
    // 2. Prune expired floatingTexts (older than 2000ms, cap at 15)
    if (room.floatingTexts && room.floatingTexts.length > 0) {
      room.floatingTexts = room.floatingTexts.filter((ft) => (now - ft.createdAt) <= 2000).slice(-15);
    }
    // 3. Cap combatLogs to latest 30 entries to prevent payload bloat
    if (room.combatLogs && room.combatLogs.length > 30) {
      room.combatLogs = room.combatLogs.slice(-30);
    }
    if (this.onRoomUpdated) {
      this.onRoomUpdated(room);
    }
  }

  // --- Room Lifecycle ---

  public createRoom(hostName: string, socketId?: string): { room: GameRoomState; playerId: string; sessionToken: string } {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let roomCode = '';
    do {
      roomCode = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (this.rooms.has(roomCode));

    const playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    const sessionToken = 'tok_' + Math.random().toString(36).substring(2, 15);

    const hostPlayer: LobbyPlayer = {
      id: playerId,
      name: hostName.trim() || 'Summoner 1',
      socketId,
      isHost: true,
      team: 'blue',
      role: 'carry',
      isBot: false,
      isReady: false,
      isDisconnected: false,
    };

    const room: GameRoomState = {
      roomCode,
      phase: 'lobby',
      createdAt: Date.now(),
      hostPlayerId: playerId,
      fillBots: true, // defaults to true for immediate testing/playability!
      players: [hostPlayer],
      currentRound: 1,
      waveNumber: 0,
      blueScore: 0,
      redScore: 0,
      turnQueue: [],
      currentTurnIndex: 0,
      turnTimeRemainingSeconds: 30,
      turrets: this.createInitialTurrets(),
      minions: [],
      decoys: [],
      champions: {},
      combatLogs: [`Lobby created. Code: ${roomCode}`],
      visualFx: [],
      floatingTexts: [],
    };

    this.rooms.set(roomCode, room);
    this.playerSessions.set(sessionToken, { roomCode, playerId });
    this.emitUpdate(room);

    return { room, playerId, sessionToken };
  }

  public joinRoom(
    roomCode: string,
    playerName: string,
    socketId?: string
  ): { success: boolean; error?: string; room?: GameRoomState; playerId?: string; sessionToken?: string } {
    const code = roomCode.toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) {
      return { success: false, error: 'Room not found. Please check the code.' };
    }

    if (room.phase !== 'lobby') {
      return { success: false, error: 'Game is already in progress.' };
    }

    const humanPlayers = room.players.filter((p) => !p.isBot);
    if (humanPlayers.length >= 6) {
      return { success: false, error: 'Room is full (max 6 players).' };
    }

    // Assign team & role
    const blueCount = room.players.filter((p) => p.team === 'blue').length;
    const redCount = room.players.filter((p) => p.team === 'red').length;
    const team: Team = blueCount <= redCount ? 'blue' : 'red';

    const usedRolesInTeam = new Set(room.players.filter((p) => p.team === team).map((p) => p.role));
    const allRoles: Role[] = ['carry', 'jungle', 'support'];
    const availableRole = allRoles.find((r) => !usedRolesInTeam.has(r)) || 'carry';

    const playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    const sessionToken = 'tok_' + Math.random().toString(36).substring(2, 15);

    const newPlayer: LobbyPlayer = {
      id: playerId,
      name: playerName.trim() || `Summoner ${room.players.length + 1}`,
      socketId,
      isHost: false,
      team,
      role: availableRole,
      isBot: false,
      isReady: false,
      isDisconnected: false,
    };

    room.players.push(newPlayer);
    this.playerSessions.set(sessionToken, { roomCode: code, playerId });
    room.combatLogs.push(`${newPlayer.name} joined the lobby.`);
    this.emitUpdate(room);

    return { success: true, room, playerId, sessionToken };
  }

  public reconnectPlayer(
    sessionToken: string,
    newSocketId: string = 'local'
  ): { success: boolean; room?: GameRoomState; player?: LobbyPlayer } {
    const session = this.playerSessions.get(sessionToken);
    if (!session) return { success: false };

    const room = this.rooms.get(session.roomCode);
    if (!room) return { success: false };

    const player = room.players.find((p) => p.id === session.playerId);
    if (!player) return { success: false };

    player.isDisconnected = false;
    player.socketId = newSocketId;
    delete player.disconnectedAt;

    // NETWORK FIX: someone came back, so cancel any pending room teardown.
    const pendingTeardown = this.abandonedRoomTimers.get(room.roomCode);
    if (pendingTeardown) {
      clearTimeout(pendingTeardown);
      this.abandonedRoomTimers.delete(room.roomCode);
    }

    room.combatLogs.push(`${player.name} reconnected.`);
    this.emitUpdate(room);
    return { success: true, room, player };
  }

  // NETWORK FIX: tear down a room's timers and remove it from memory.
  // Safe to call at any time -- ticking intervals already no-op once
  // this.rooms.get(roomCode) returns undefined.
  private cleanupRoom(roomCode: string) {
    const timer = this.turnTimers.get(roomCode);
    if (timer) {
      clearInterval(timer as ReturnType<typeof setInterval>);
      clearTimeout(timer as ReturnType<typeof setTimeout>);
      this.turnTimers.delete(roomCode);
    }
    const abandonTimer = this.abandonedRoomTimers.get(roomCode);
    if (abandonTimer) {
      clearTimeout(abandonTimer);
      this.abandonedRoomTimers.delete(roomCode);
    }
    // Clean up playerSessions associated with this roomCode
    for (const [token, session] of this.playerSessions.entries()) {
      if (session.roomCode === roomCode) {
        this.playerSessions.delete(token);
      }
    }
    this.rooms.delete(roomCode);
  }

  public leaveRoom(roomCode: string, playerId?: string, socketId?: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const playerIndex = room.players.findIndex(
      (p) => (playerId && p.id === playerId) || (socketId && p.socketId === socketId)
    );
    if (playerIndex === -1) return false;

    const player = room.players[playerIndex];

    if (room.phase === 'lobby') {
      // In lobby, completely remove the player from the room
      room.players.splice(playerIndex, 1);
      room.combatLogs.push(`${player.name} left the lobby.`);

      const remainingHumans = room.players.filter((p) => !p.isBot);
      if (remainingHumans.length === 0) {
        // No human players left in lobby -> tear down immediately
        this.cleanupRoom(roomCode);
        return true;
      }

      // If host left, reassign host to the first human
      if (player.isHost || room.hostPlayerId === player.id) {
        const nextHost = remainingHumans[0];
        nextHost.isHost = true;
        room.hostPlayerId = nextHost.id;
        room.combatLogs.push(`${nextHost.name} is now the room host.`);
      }

      this.emitUpdate(room);
      return true;
    } else {
      // In draft or playing phase, mark disconnected
      player.isDisconnected = true;
      player.disconnectedAt = Date.now();
      room.combatLogs.push(`${player.name} left the game.`);

      if (player.isHost || room.hostPlayerId === player.id) {
        const nextHost = room.players.find((p) => !p.isDisconnected && !p.isBot);
        if (nextHost) {
          player.isHost = false;
          nextHost.isHost = true;
          room.hostPlayerId = nextHost.id;
          room.combatLogs.push(`${nextHost.name} is now the room host.`);
        }
      }

      const anyHumanConnected = room.players.some((p) => !p.isBot && !p.isDisconnected);
      if (!anyHumanConnected && !this.abandonedRoomTimers.has(room.roomCode)) {
        const abandonTimer = setTimeout(() => {
          this.abandonedRoomTimers.delete(roomCode);
          this.cleanupRoom(roomCode);
        }, 60 * 1000);
        this.abandonedRoomTimers.set(roomCode, abandonTimer);
      }

      this.emitUpdate(room);
      return true;
    }
  }

  public handleDisconnect(socketId: string) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (player) {
        player.isDisconnected = true;
        player.disconnectedAt = Date.now();
        room.combatLogs.push(`${player.name} disconnected.`);

        // Host migration if host disconnects
        if (player.isHost) {
          const nextHost = room.players.find((p) => !p.isDisconnected && !p.isBot);
          if (nextHost) {
            player.isHost = false;
            nextHost.isHost = true;
            room.hostPlayerId = nextHost.id;
            room.combatLogs.push(`${nextHost.name} is now the room host.`);
          }
        }

        // If in draft or active game and it's their turn, skip after brief timeout
        if (room.phase === 'playing' && room.activePlayerId === player.id) {
          setTimeout(() => {
            if (player.isDisconnected && room.activePlayerId === player.id) {
              this.passTurn(room.roomCode, player.id);
            }
          }, 3000);
        }

        // If in lobby phase and no humans remain, clean up immediately
        const anyHumanStillConnected = room.players.some((p) => !p.isBot && !p.isDisconnected);
        if (!anyHumanStillConnected) {
          if (room.phase === 'lobby') {
            this.cleanupRoom(room.roomCode);
            return;
          }
          if (!this.abandonedRoomTimers.has(room.roomCode)) {
            const roomCode = room.roomCode;
            const abandonTimer = setTimeout(() => {
              this.abandonedRoomTimers.delete(roomCode);
              this.cleanupRoom(roomCode);
            }, 60 * 1000); // 1 minute grace period for active game
            this.abandonedRoomTimers.set(room.roomCode, abandonTimer);
          }
        }

        this.emitUpdate(room);
        break;
      }
    }
  }

  public updateLobbySlot(
    roomCode: string,
    playerId: string,
    team: Team,
    role: Role
  ): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'lobby') return false;

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return false;

    // Check if team already has 3 members
    const teamMembers = room.players.filter((p) => p.team === team && p.id !== playerId);
    if (teamMembers.length >= 3) return false;

    // Check if role is taken in team
    const roleTaken = teamMembers.some((p) => p.role === role);
    if (roleTaken) return false;

    player.team = team;
    player.role = role;
    this.emitUpdate(room);
    return true;
  }

  public toggleBotFill(roomCode: string, playerId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'lobby' || room.hostPlayerId !== playerId) return false;

    room.fillBots = !room.fillBots;
    this.emitUpdate(room);
    return true;
  }

  public kickPlayer(roomCode: string, hostPlayerId: string, targetPlayerId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'lobby' || room.hostPlayerId !== hostPlayerId) return false;
    if (targetPlayerId === hostPlayerId) return false;

    const idx = room.players.findIndex((p) => p.id === targetPlayerId);
    if (idx !== -1) {
      const removed = room.players.splice(idx, 1)[0];
      room.combatLogs.push(`${removed.name} was removed by host.`);
      this.emitUpdate(room);
      return true;
    }
    return false;
  }

  // --- Champion Select & Draft Phase ---

  public startDraft(roomCode: string, hostPlayerId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'lobby' || room.hostPlayerId !== hostPlayerId) return false;

    // Fill bots if enabled to ensure 3v3 (6 slots)
    if (room.fillBots) {
      this.fillWithBots(room);
    }

    // Ensure we have balanced teams
    const blueCount = room.players.filter((p) => p.team === 'blue').length;
    const redCount = room.players.filter((p) => p.team === 'red').length;
    if (blueCount !== 3 || redCount !== 3) {
      // Auto balance if needed
      this.autoBalanceSlots(room);
    }

    // Snake pick order: Blue 1 -> Red 1 -> Red 2 -> Blue 2 -> Blue 3 -> Red 3
    const bluePlayers = room.players.filter((p) => p.team === 'blue');
    const redPlayers = room.players.filter((p) => p.team === 'red');

    const pickOrder: string[] = [
      bluePlayers[0].id,
      redPlayers[0].id,
      redPlayers[1].id,
      bluePlayers[1].id,
      bluePlayers[2].id,
      redPlayers[2].id,
    ];

    room.phase = 'ban';
    room.draft = {
      currentPickerIndex: 0,
      pickOrder,
      timeRemainingSeconds: 30,
      bannedChampions: [],
      lockedBans: {},
      lockedPicks: {},
      selectedSpells: {},
    };

    // Default summoner spells
    for (const p of room.players) {
      room.draft.selectedSpells[p.id] = 'flash';
      p.summonerSpell = 'flash';
    }

    room.combatLogs.push('Draft Phase started! Ban phase underway (30s).');
    this.startDraftTimer(roomCode);
    this.emitUpdate(room);

    // Bot auto-bans immediately
    this.processBotBans(room);

    return true;
  }

  private fillWithBots(room: GameRoomState) {
    const roles: Role[] = ['jungle', 'carry', 'support'];
    const botNames = ['AhriBot', 'LeeSinBot', 'ThreshBot', 'JinxBot', 'GarenBot', 'LuxBot', 'ViBot'];

    for (const team of ['blue', 'red'] as Team[]) {
      for (const role of roles) {
        const hasSlot = room.players.some((p) => p.team === team && p.role === role);
        if (!hasSlot) {
          const botId = 'bot_' + Math.random().toString(36).substring(2, 9);
          const name = botNames[Math.floor(Math.random() * botNames.length)] + ` (${team[0].toUpperCase()})`;
          room.players.push({
            id: botId,
            name: `[BOT] ${name}`,
            isHost: false,
            team,
            role,
            isBot: true,
            isReady: true,
            isDisconnected: false,
          });
        }
      }
    }
  }

  private autoBalanceSlots(room: GameRoomState) {
    const roles: Role[] = ['jungle', 'carry', 'support'];
    for (const team of ['blue', 'red'] as Team[]) {
      for (const role of roles) {
        const existing = room.players.find((p) => p.team === team && p.role === role);
        if (!existing) {
          const botId = 'bot_' + Math.random().toString(36).substring(2, 9);
          room.players.push({
            id: botId,
            name: `[BOT] RiftBot ${team[0].toUpperCase()}`,
            isHost: false,
            team,
            role,
            isBot: true,
            isReady: true,
            isDisconnected: false,
          });
        }
      }
    }
  }

  public lockBan(roomCode: string, playerId: string, championId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'ban' || !room.draft) return false;

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return false;

    room.draft.lockedBans[playerId] = championId;
    player.banChampionId = championId;
    if (!room.draft.bannedChampions.includes(championId)) {
      room.draft.bannedChampions.push(championId);
    }

    // Check if all players locked their ban
    if (Object.keys(room.draft.lockedBans).length >= room.players.length) {
      this.transitionToPickPhase(room);
    } else {
      this.emitUpdate(room);
    }

    return true;
  }

  public lockPick(roomCode: string, playerId: string, championId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'pick' || !room.draft) return false;

    const currentPickerId = room.draft.pickOrder[room.draft.currentPickerIndex];
    if (currentPickerId !== playerId) return false;

    // Check if champion is banned or already picked
    if (room.draft.bannedChampions.includes(championId)) return false;
    if (Object.values(room.draft.lockedPicks).includes(championId)) return false;

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return false;

    room.draft.lockedPicks[playerId] = championId;
    player.championId = championId;
    room.combatLogs.push(`${player.name} locked in ${CHAMPIONS[championId]?.name || championId}!`);

    // Advance to next pick
    room.draft.currentPickerIndex++;
    room.draft.timeRemainingSeconds = 25;

    if (room.draft.currentPickerIndex >= room.draft.pickOrder.length) {
      this.transitionToMatch(room);
    } else {
      this.emitUpdate(room);
      this.checkAndProcessBotPick(room);
    }

    return true;
  }

  public setSummonerSpell(roomCode: string, playerId: string, spellId: SummonerSpellId): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || !room.draft) return false;

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return false;

    room.draft.selectedSpells[playerId] = spellId;
    player.summonerSpell = spellId;
    this.emitUpdate(room);
    return true;
  }

  private processBotBans(room: GameRoomState) {
    if (!room.draft) return;
    const champKeys = Object.keys(CHAMPIONS);

    for (const player of room.players) {
      if (player.isBot && !room.draft.lockedBans[player.id]) {
        const unbanned = champKeys.filter((c) => !room.draft!.bannedChampions.includes(c));
        const pickBan = unbanned[Math.floor(Math.random() * unbanned.length)] || champKeys[0];
        room.draft.lockedBans[player.id] = pickBan;
        player.banChampionId = pickBan;
        room.draft.bannedChampions.push(pickBan);
      }
    }
  }

  private checkAndProcessBotPick(room: GameRoomState) {
    if (!room.draft || room.phase !== 'pick') return;
    const currentPickerId = room.draft.pickOrder[room.draft.currentPickerIndex];
    const player = room.players.find((p) => p.id === currentPickerId);

    if (player && player.isBot) {
      setTimeout(() => {
        if (room.phase !== 'pick' || !room.draft) return;
        const availableChamps = Object.values(CHAMPIONS).filter(
          (c) =>
            !room.draft!.bannedChampions.includes(c.id) &&
            !Object.values(room.draft!.lockedPicks).includes(c.id)
        );

        // Prefer champion matching role
        const roleChamps = availableChamps.filter((c) => c.role === player.role);
        const choice = roleChamps.length > 0 ? roleChamps[0] : availableChamps[0];

        if (choice) {
          this.lockPick(room.roomCode, player.id, choice.id);
        }
      }, 400);
    }
  }

  private transitionToPickPhase(room: GameRoomState) {
    if (!room.draft) return;
    room.phase = 'pick';
    room.draft.currentPickerIndex = 0;
    room.draft.timeRemainingSeconds = 25;
    room.combatLogs.push('Bans completed! Pick phase underway.');
    this.emitUpdate(room);
    this.checkAndProcessBotPick(room);
  }

  private startDraftTimer(roomCode: string) {
    if (this.turnTimers.has(roomCode)) {
      clearInterval(this.turnTimers.get(roomCode)!);
    }

    const interval = setInterval(() => {
      const room = this.rooms.get(roomCode);
      if (!room || !room.draft || (room.phase !== 'ban' && room.phase !== 'pick')) {
        clearInterval(interval);
        return;
      }

      room.draft.timeRemainingSeconds--;

      if (room.draft.timeRemainingSeconds <= 0) {
        if (room.phase === 'ban') {
          // Auto ban for missing
          this.processBotBans(room);
          for (const p of room.players) {
            if (!room.draft.lockedBans[p.id]) {
              const unbanned = Object.keys(CHAMPIONS).filter((c) => !room.draft!.bannedChampions.includes(c));
              const autoBan = unbanned[0] || 'jinx';
              this.lockBan(roomCode, p.id, autoBan);
            }
          }
          this.transitionToPickPhase(room);
        } else if (room.phase === 'pick') {
          // Auto pick for active player
          const activeId = room.draft.pickOrder[room.draft.currentPickerIndex];
          const available = Object.keys(CHAMPIONS).filter(
            (c) =>
              !room.draft!.bannedChampions.includes(c) &&
              !Object.values(room.draft!.lockedPicks).includes(c)
          );
          const autoPick = available[0] || 'garen';
          this.lockPick(roomCode, activeId, autoPick);
        }
      } else {
        this.emitUpdate(room);
      }
    }, 1000);

    this.turnTimers.set(roomCode, interval);
  }

  // --- Match Initialization & Round Flow ---

  private transitionToMatch(room: GameRoomState) {
    if (this.turnTimers.has(room.roomCode)) {
      clearInterval(this.turnTimers.get(room.roomCode)!);
    }

    room.phase = 'playing';
    room.currentRound = 1;
    room.waveNumber = 0;
    room.blueScore = 0;
    room.redScore = 0;
    room.turrets = this.createInitialTurrets();
    room.minions = [];
    room.decoys = [];
    room.champions = {};

    this.initRound(room);
  }

  private createInitialTurrets(): Record<Team, TurretUnit> {
    return {
      blue: {
        team: 'blue',
        x: BLUE_TURRET_POS.x,
        y: BLUE_TURRET_POS.y,
        currentHp: 1000,
        maxHp: 1000,
        armor: 40,
        attackRange: 3,
        ad: 150,
        isDestroyed: false,
      },
      red: {
        team: 'red',
        x: RED_TURRET_POS.x,
        y: RED_TURRET_POS.y,
        currentHp: 1000,
        maxHp: 1000,
        armor: 40,
        attackRange: 3,
        ad: 150,
        isDestroyed: false,
      },
    };
  }

  private initRound(room: GameRoomState) {
    const bluePlayers = room.players.filter((p) => p.team === 'blue');
    const redPlayers = room.players.filter((p) => p.team === 'red');

    // Spawn champions at base
    bluePlayers.forEach((p, idx) => {
      const champData = CHAMPIONS[p.championId || 'garen'] || CHAMPIONS.garen;
      const spawn = BLUE_SPAWN_POINTS[idx % BLUE_SPAWN_POINTS.length];
      const existingChamp = room.champions[p.id];

      // Keep gold and items across rounds!
      const currentGold = existingChamp ? existingChamp.gold : 500;
      const currentItems = existingChamp ? existingChamp.items : [];
      const kills = existingChamp ? existingChamp.kills : 0;
      const deaths = existingChamp ? existingChamp.deaths : 0;
      const assists = existingChamp ? existingChamp.assists : 0;
      const minionKills = existingChamp ? existingChamp.minionKills : 0;
      const damageDealt = existingChamp ? existingChamp.damageDealt : 0;

      const state: ChampionState = {
        id: champData.id,
        playerId: p.id,
        playerName: p.name,
        team: 'blue',
        role: p.role,
        x: spawn.x,
        y: spawn.y,
        currentHp: champData.baseHp,
        maxHp: champData.baseHp,
        currentMana: champData.baseMana,
        maxMana: champData.baseMana,
        shield: 0,
        isDead: false,
        isBot: p.isBot,
        gold: currentGold,
        items: currentItems,
        summonerSpell: p.summonerSpell || 'flash',
        spellCooldownRounds: 0,
        abilities: JSON.parse(JSON.stringify(champData.abilities)),
        statusEffects: [],
        hasMoved: false,
        hasActed: false,
        effectiveAd: champData.baseAd,
        effectiveAp: champData.baseAp,
        effectiveArmor: champData.baseArmor,
        effectiveMr: champData.baseMr,
        effectiveRange: champData.attackRange,
        effectiveMoveSpeed: champData.moveSpeed,
        kills,
        deaths,
        assists,
        minionKills,
        damageDealt,
      };

      this.recalculateChampionStats(state);
      room.champions[p.id] = state;
    });

    redPlayers.forEach((p, idx) => {
      const champData = CHAMPIONS[p.championId || 'ahri'] || CHAMPIONS.ahri;
      const spawn = RED_SPAWN_POINTS[idx % RED_SPAWN_POINTS.length];
      const existingChamp = room.champions[p.id];

      const currentGold = existingChamp ? existingChamp.gold : 500;
      const currentItems = existingChamp ? existingChamp.items : [];
      const kills = existingChamp ? existingChamp.kills : 0;
      const deaths = existingChamp ? existingChamp.deaths : 0;
      const assists = existingChamp ? existingChamp.assists : 0;
      const minionKills = existingChamp ? existingChamp.minionKills : 0;
      const damageDealt = existingChamp ? existingChamp.damageDealt : 0;

      const state: ChampionState = {
        id: champData.id,
        playerId: p.id,
        playerName: p.name,
        team: 'red',
        role: p.role,
        x: spawn.x,
        y: spawn.y,
        currentHp: champData.baseHp,
        maxHp: champData.baseHp,
        currentMana: champData.baseMana,
        maxMana: champData.baseMana,
        shield: 0,
        isDead: false,
        isBot: p.isBot,
        gold: currentGold,
        items: currentItems,
        summonerSpell: p.summonerSpell || 'flash',
        spellCooldownRounds: 0,
        abilities: JSON.parse(JSON.stringify(champData.abilities)),
        statusEffects: [],
        hasMoved: false,
        hasActed: false,
        effectiveAd: champData.baseAd,
        effectiveAp: champData.baseAp,
        effectiveArmor: champData.baseArmor,
        effectiveMr: champData.baseMr,
        effectiveRange: champData.attackRange,
        effectiveMoveSpeed: champData.moveSpeed,
        kills,
        deaths,
        assists,
        minionKills,
        damageDealt,
      };

      this.recalculateChampionStats(state);
      room.champions[p.id] = state;
    });

    // Reset turrets for round
    room.turrets = this.createInitialTurrets();

    // Spawn minion waves every two rounds.
    room.minions = [];
    room.decoys = [];
    if (room.currentRound % 2 === 1) {
      room.waveNumber++;
      this.spawnMinionWave(room);
    }

    // Initiative order: interleave Blue and Red champions based on champion base speed/role
    // Standard tactical interleaving: Blue 1, Red 1, Blue 2, Red 2, Blue 3, Red 3
    room.turnQueue = [];
    for (let i = 0; i < 3; i++) {
      if (bluePlayers[i]) room.turnQueue.push(bluePlayers[i].id);
      if (redPlayers[i]) room.turnQueue.push(redPlayers[i].id);
    }

    room.currentTurnIndex = 0;
    room.activePlayerId = room.turnQueue[0];
    room.turnTimeRemainingSeconds = 45;

    // Award passive gold +100 to initial player
    const firstChamp = room.champions[room.activePlayerId];
    if (firstChamp) {
      firstChamp.gold += 100;
    }

    room.combatLogs.push(`=== ROUND ${room.currentRound} STARTED === (Best of 3)`);
    room.combatLogs.push(`Initiative: ${firstChamp?.playerName || 'Champion'}'s turn.`);

    this.startTurnTimer(room.roomCode);
    this.emitUpdate(room);

    this.checkAndProcessBotTurn(room);
  }

  private spawnMinionWave(room: GameRoomState) {
    const isCannonWave = room.waveNumber % 3 === 0;
    const createWave = (team: Team): MinionUnit[] => {
      const isBlue = team === 'blue';
      const baseX = isBlue ? BLUE_SPAWN_POINTS[0].x : RED_SPAWN_POINTS[0].x;
      const baseY = isBlue ? BLUE_SPAWN_POINTS[0].y : RED_SPAWN_POINTS[0].y;
      const direction = isBlue ? 1 : -1;
      const idPrefix = `min_${team}_${room.waveNumber}_${Date.now()}`;
      const units: MinionUnit[] = [];

      const addMinion = (
        type: MinionUnit['type'],
        index: number,
        xOffset: number,
        yOffset: number,
        currentHp: number,
        ad: number,
        attackRange: number,
        goldBounty: number
      ) => {
        units.push({
          id: `${idPrefix}_${type}_${index}`,
          team,
          type,
          x: baseX + direction * xOffset,
          y: baseY + yOffset,
          currentHp,
          maxHp: currentHp,
          ad,
          attackRange,
          goldBounty,
          hasAttacked: false,
        });
      };

      addMinion('melee', 1, 0, 0, 477, 12, 1, 21);
      addMinion('melee', 2, 1, 0, 477, 12, 1, 21);
      addMinion('melee', 3, 2, 0, 477, 12, 1, 21);
      if (isCannonWave) {
        const cannonBounty = 60 + Math.floor((room.waveNumber - 3) / 3) * 3;
        addMinion('cannon', 1, 1, 1, 912, 41, 3, cannonBounty);
      }
      addMinion('caster', 1, 0, -1, 296, 24, 3, 14);
      addMinion('caster', 2, 1, -1, 296, 24, 3, 14);
      addMinion('caster', 3, 2, -1, 296, 24, 3, 14);
      return units;
    };

    room.minions.push(...createWave('blue'), ...createWave('red'));
    room.combatLogs.push(
      `Wave ${room.waveNumber} spawned: ${isCannonWave ? '3 melee, 1 cannon, 3 caster' : '3 melee, 3 caster'} per team.`
    );
  }

  private recalculateChampionStats(champ: ChampionState) {
    const base = CHAMPIONS[champ.id];
    if (!base) return;

    let bonusAd = 0;
    let bonusAp = 0;
    let bonusHp = 0;
    let bonusMana = 0;
    let bonusArmor = 0;
    let bonusMr = 0;
    let bonusMove = 0;

    for (const itemId of champ.items) {
      const item = SHOP_ITEMS[itemId];
      if (item) {
        bonusAd += item.ad || 0;
        bonusAp += item.ap || 0;
        bonusHp += item.hp || 0;
        bonusMana += item.mana || 0;
        bonusArmor += item.armor || 0;
        bonusMr += item.mr || 0;
        bonusMove += item.moveBonus || 0;
      }
    }

    // Status effect modifiers
    for (const e of champ.statusEffects) {
      if (e.type === 'ghost') {
        bonusMove += e.value ?? 2; // per-ability custom bonus (e.g. Akshan's Heroic Swing), default 2 for Ghost spell
      }
    }
    if (champ.statusEffects.some((e) => e.type === 'slow')) {
      bonusMove = Math.max(-2, bonusMove - 1);
    }

    champ.effectiveAd = base.baseAd + bonusAd;
    let totalAp = base.baseAp + bonusAp;
    if (champ.items.includes('rabadons_deathcap')) {
      totalAp = Math.round(totalAp * 1.35);
    }
    champ.effectiveAp = totalAp;
    champ.effectiveArmor = base.baseArmor + bonusArmor;
    champ.effectiveMr = base.baseMr + bonusMr;
    champ.effectiveRange = base.attackRange;
    champ.effectiveMoveSpeed = Math.max(1, base.moveSpeed + bonusMove);
  }

  // Destroys a decoy, dealing its stored burst damage to nearby enemies of the
  // popping team (i.e. the decoy owner's opponents), and reveals it in the log.
  private popDecoy(room: GameRoomState, decoy: DecoyUnit, poppingTeam: Team) {
    room.decoys = room.decoys.filter((d) => d.id !== decoy.id);
    room.combatLogs.push(`It was a decoy! The real ${CHAMPIONS[decoy.championId]?.name || decoy.championId} is elsewhere.`);
    this.addFloatingText(room, decoy.x, decoy.y, 'DECOY!', '#f472b6');
    for (const enemy of Object.values(room.champions)) {
      if (!enemy.isDead && enemy.team !== decoy.team && getDistance(enemy.x, enemy.y, decoy.x, decoy.y) <= 1) {
        this.applyDamageToTarget(room, room.champions[decoy.ownerId] || enemy, 'champion', enemy.playerId, decoy.burstDamage, 'magic');
      }
    }
    room.visualFx.push({
      id: 'fx_' + Date.now(),
      type: 'explosion',
      startX: decoy.x,
      startY: decoy.y,
      targetX: decoy.x,
      targetY: decoy.y,
      radius: 1,
      color: '#f472b6',
      createdAt: Date.now(),
      durationMs: 500,
    });
  }

  // Lets a decoy's owner reposition it (e.g. Neeko's Shapesplitter) on their
  // own turn, as an alternative to moving their real champion.
  public moveDecoy(
    roomCode: string,
    playerId: string,
    decoyId: string,
    targetX: number,
    targetY: number
  ): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return { success: false, error: 'Game not active' };
    if (room.activePlayerId !== playerId) return { success: false, error: 'Not your turn' };

    const champ = room.champions[playerId];
    if (!champ || champ.hasMoved) return { success: false, error: 'Already acted this turn' };

    const decoy = room.decoys.find((d) => d.id === decoyId && d.ownerId === playerId);
    if (!decoy) return { success: false, error: 'Decoy not found' };

    if (!isTileWalkable(targetX, targetY)) return { success: false, error: 'Tile cannot be traversed' };
    const dist = getDistance(decoy.x, decoy.y, targetX, targetY);
    if (dist > champ.effectiveMoveSpeed) return { success: false, error: `Move range is ${champ.effectiveMoveSpeed} tiles` };

    const occupied = Object.values(room.champions).some((c) => !c.isDead && c.x === targetX && c.y === targetY);
    if (occupied) return { success: false, error: 'Tile occupied' };

    decoy.x = targetX;
    decoy.y = targetY;
    champ.hasMoved = true; // moving the decoy uses the owner's move for the turn
    room.combatLogs.push(`${champ.playerName} repositioned their decoy.`);
    this.emitUpdate(room);
    return { success: true };
  }

  // A champion under a 'stealth' effect (river brush, or an ability like Akshan's
  // Going Rogue) cannot be directly targeted by attacks or abilities.
  private isUntargetable(champ: ChampionState): boolean {
    return champ.statusEffects.some((e) => e.type === 'stealth');
  }

  // --- In-Game Actions & Combat Resolution ---

  public moveChampion(
    roomCode: string,
    playerId: string,
    targetX: number,
    targetY: number
  ): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return { success: false, error: 'Game not active' };
    if (room.activePlayerId !== playerId) return { success: false, error: 'Not your turn' };

    const champ = room.champions[playerId];
    if (!champ || champ.isDead) return { success: false, error: 'Champion dead or not found' };
    if (champ.hasMoved) return { success: false, error: 'Already moved this turn' };

    // Check CC (stun or root)
    if (champ.statusEffects.some((e) => e.type === 'stun' || e.type === 'root')) {
      return { success: false, error: 'Cannot move while stunned or rooted!' };
    }

    if (!isTileWalkable(targetX, targetY)) {
      return { success: false, error: 'Tile cannot be traversed' };
    }

    // Distance check
    const dist = getDistance(champ.x, champ.y, targetX, targetY);
    if (dist > champ.effectiveMoveSpeed) {
      return { success: false, error: `Move range is ${champ.effectiveMoveSpeed} tiles` };
    }

    // Check if occupied by another champion
    const occupied = Object.values(room.champions).some((c) => !c.isDead && c.x === targetX && c.y === targetY);
    if (occupied) {
      return { success: false, error: 'Tile occupied by another champion' };
    }

    champ.movedFrom = { x: champ.x, y: champ.y };
    champ.x = targetX;
    champ.y = targetY;
    champ.hasMoved = true;

    // Check if entered brush
    const isBrush = BRUSH_TILES.has(`${targetX},${targetY}`);
    if (isBrush) {
      champ.statusEffects.push({ type: 'stealth', durationTurns: 1 });
      room.combatLogs.push(`${champ.playerName} slipped into the river brush (Stealth).`);
    }

    this.emitUpdate(room);
    return { success: true };
  }

  public undoMove(roomCode: string, playerId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing' || room.activePlayerId !== playerId) return false;

    const champ = room.champions[playerId];
    if (!champ || !champ.hasMoved || !champ.movedFrom || champ.hasActed) return false;

    champ.x = champ.movedFrom.x;
    champ.y = champ.movedFrom.y;
    champ.hasMoved = false;
    delete champ.movedFrom;

    this.emitUpdate(room);
    return true;
  }

  public basicAttack(
    roomCode: string,
    playerId: string,
    targetType: 'champion' | 'minion' | 'turret' | 'decoy',
    targetId: string
  ): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return { success: false, error: 'Game not active' };
    if (room.activePlayerId !== playerId) return { success: false, error: 'Not your turn' };

    const champ = room.champions[playerId];
    if (!champ || champ.isDead || champ.hasActed) return { success: false, error: 'Cannot act' };

    if (champ.statusEffects.some((e) => e.type === 'stun')) {
      return { success: false, error: 'Cannot attack while stunned!' };
    }

    let targetX = 0;
    let targetY = 0;
    let targetArmor = 0;
    let targetName = '';

    if (targetType === 'champion') {
      const targetChamp = room.champions[targetId];
      if (!targetChamp || targetChamp.isDead || targetChamp.team === champ.team) {
        return { success: false, error: 'Invalid enemy champion target' };
      }
      if (this.isUntargetable(targetChamp)) {
        return { success: false, error: `${targetChamp.playerName} cannot be targeted right now` };
      }
      targetX = targetChamp.x;
      targetY = targetChamp.y;
      targetArmor = targetChamp.effectiveArmor;
      targetName = targetChamp.playerName;
    } else if (targetType === 'minion') {
      const minion = room.minions.find((m) => m.id === targetId);
      if (!minion || minion.team === champ.team) return { success: false, error: 'Invalid enemy minion target' };
      targetX = minion.x;
      targetY = minion.y;
      targetArmor = 10;
      targetName = `${minion.team === 'blue' ? 'Blue' : 'Red'} Minion`;
    } else if (targetType === 'turret') {
      const enemyTeam = champ.team === 'blue' ? 'red' : 'blue';
      const turret = room.turrets[enemyTeam];
      if (turret.isDestroyed) return { success: false, error: 'Turret already destroyed' };
      targetX = turret.x;
      targetY = turret.y;
      targetArmor = turret.armor;
      targetName = `${enemyTeam.toUpperCase()} Turret`;
    } else if (targetType === 'decoy') {
      const decoy = room.decoys.find((d) => d.id === targetId);
      if (!decoy || decoy.team === champ.team) return { success: false, error: 'Invalid decoy target' };
      const dist = getDistance(champ.x, champ.y, decoy.x, decoy.y);
      if (dist > champ.effectiveRange) {
        return { success: false, error: `Target out of range (${dist} > ${champ.effectiveRange})` };
      }
      champ.hasActed = true;
      champ.hasAttacked = true;
      this.popDecoy(room, decoy, champ.team);
      this.emitUpdate(room);
      return { success: true };
    }

    const dist = getDistance(champ.x, champ.y, targetX, targetY);
    if (dist > champ.effectiveRange) {
      return { success: false, error: `Target out of range (${dist} > ${champ.effectiveRange})` };
    }

    // Reveal stealth when attacking
    champ.statusEffects = champ.statusEffects.filter((e) => e.type !== 'stealth');

    // Calculate damage
    let damage = champ.effectiveAd;
    let isCrit = false;
    if (champ.items.includes('infinity_edge') && Math.random() < 0.25) {
      damage = Math.round(damage * 1.75);
      isCrit = true;
    }

    const reducedDamage = Math.max(10, Math.round(damage * (100 / (100 + targetArmor))));

    // Apply Damage
    this.applyDamageToTarget(room, champ, targetType, targetId, reducedDamage, 'physical', isCrit);

    // Lifesteal
    if (champ.items.includes('bloodthirster') || champ.items.includes('dorans_blade')) {
      const lifestealRate = (champ.items.includes('bloodthirster') ? 0.18 : 0) + (champ.items.includes('dorans_blade') ? 0.03 : 0);
      const heal = Math.round(reducedDamage * lifestealRate);
      if (heal > 0) {
        champ.currentHp = Math.min(champ.maxHp, champ.currentHp + heal);
        this.addFloatingText(room, champ.x, champ.y, `+${heal}`, '#22c55e');
      }
    }

    // Visual FX
    room.visualFx.push({
      id: 'fx_' + Date.now(),
      type: 'attack_beam',
      startX: champ.x,
      startY: champ.y,
      targetX,
      targetY,
      color: isCrit ? '#f59e0b' : '#38bdf8',
      createdAt: Date.now(),
      durationMs: 400,
    });

    champ.hasActed = true;
    room.combatLogs.push(
      `${champ.playerName} attacked ${targetName} for ${reducedDamage} damage${isCrit ? ' (CRITICAL HIT!)' : ''}.`
    );

    // Turn concludes after action
    this.passTurn(roomCode, playerId);
    return { success: true };
  }

  public castAbility(
    roomCode: string,
    playerId: string,
    abilityKey: 'Q' | 'W' | 'E' | 'R',
    targetX?: number,
    targetY?: number,
    targetUnitId?: string
  ): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing') return { success: false, error: 'Game not active' };
    if (room.activePlayerId !== playerId) return { success: false, error: 'Not your turn' };

    const champ = room.champions[playerId];
    if (!champ || champ.isDead || champ.hasActed) return { success: false, error: 'Cannot act' };

    if (champ.statusEffects.some((e) => e.type === 'stun' || e.type === 'silence')) {
      return { success: false, error: 'Cannot cast abilities while stunned or silenced!' };
    }

    const ability = champ.abilities.find((a) => a.key === abilityKey);
    if (!ability) return { success: false, error: 'Ability not found' };

    if (ability.currentCooldown > 0) {
      return { success: false, error: `${ability.name} on cooldown (${ability.currentCooldown} rounds remaining)` };
    }

    if (champ.currentMana < ability.manaCost) {
      return { success: false, error: `Not enough mana (${champ.currentMana}/${ability.manaCost})` };
    }

    champ.currentMana -= ability.manaCost;
    ability.currentCooldown = ability.cooldownRounds;

    // Reveal from stealth
    champ.statusEffects = champ.statusEffects.filter((e) => e.type !== 'stealth');

    // Calculate base ability damage
    let damage = ability.baseDamage || 0;
    if (ability.scaling) {
      if (ability.scaling.stat === 'ad') damage += Math.round(champ.effectiveAd * ability.scaling.ratio);
      if (ability.scaling.stat === 'ap') damage += Math.round(champ.effectiveAp * ability.scaling.ratio);
    }

    // Execute Ability based on target type
    if (ability.targetType === 'self') {
      if (ability.shieldAmount) {
        champ.shield += ability.shieldAmount;
        this.addFloatingText(room, champ.x, champ.y, `+${ability.shieldAmount} Shield`, '#38bdf8');
      }
      if (ability.healAmount) {
        champ.currentHp = Math.min(champ.maxHp, champ.currentHp + ability.healAmount);
        this.addFloatingText(room, champ.x, champ.y, `+${ability.healAmount} HP`, '#22c55e');
      }
      if (ability.statusEffect) {
        champ.statusEffects.push({
          type: ability.statusEffect,
          durationTurns: ability.effectDuration ?? 1,
          value: ability.statusEffect === 'ghost' ? (ability.moveSpeedBonus ?? 2) : undefined,
        });
        this.recalculateChampionStats(champ);
        const label = ability.statusEffect === 'stealth' ? 'CAMOUFLAGE' : ability.statusEffect.toUpperCase();
        this.addFloatingText(room, champ.x, champ.y, label, '#a855f7');
      }
      room.combatLogs.push(`${champ.playerName} activated ${ability.name}!`);
    } else if (ability.targetType === 'summon_decoy' && targetX !== undefined && targetY !== undefined) {
      const decoy: DecoyUnit = {
        id: `decoy_${champ.playerId}_${Date.now()}`,
        ownerId: champ.playerId,
        team: champ.team,
        championId: champ.id,
        x: targetX,
        y: targetY,
        turnsRemaining: ability.decoyDurationTurns ?? 3,
        burstDamage: Math.max(20, Math.round((ability.baseDamage || 100) + champ.effectiveAp * (ability.scaling?.ratio ?? 0.5))),
      };
      // Only one decoy per owner at a time -- recasting replaces the old one.
      room.decoys = room.decoys.filter((d) => d.ownerId !== champ.playerId);
      room.decoys.push(decoy);
      room.combatLogs.push(`${champ.playerName} split into a decoy!`);
    } else if (ability.targetType === 'line' && targetX !== undefined && targetY !== undefined) {
      const lineTiles = getLineTiles(champ.x, champ.y, targetX, targetY);
      // Affect enemies in line
      for (const tile of lineTiles) {
        if (tile.x === champ.x && tile.y === champ.y) continue;
        const enemyChamp = Object.values(room.champions).find(
          (c) => !c.isDead && c.team !== champ.team && c.x === tile.x && c.y === tile.y && !this.isUntargetable(c)
        );
        if (enemyChamp) {
          const armorOrMr = ability.damageType === 'magic' ? enemyChamp.effectiveMr : enemyChamp.effectiveArmor;
          const finalDmg = Math.max(10, Math.round(damage * (100 / (100 + armorOrMr))));
          this.applyDamageToTarget(room, champ, 'champion', enemyChamp.playerId, finalDmg, ability.damageType || 'magic');

          if (ability.statusEffect) {
            enemyChamp.statusEffects.push({ type: ability.statusEffect, durationTurns: ability.effectDuration ?? 1 });
            this.addFloatingText(room, enemyChamp.x, enemyChamp.y, ability.statusEffect.toUpperCase(), '#eab308');
          }
        }
        // Popping a decoy caught in the line
        const hitDecoy = room.decoys.find((d) => d.x === tile.x && d.y === tile.y && d.team !== champ.team);
        if (hitDecoy) this.popDecoy(room, hitDecoy, champ.team);
      }
      room.visualFx.push({
        id: 'fx_' + Date.now(),
        type: 'skillshot_line',
        startX: champ.x,
        startY: champ.y,
        targetX,
        targetY,
        color: '#06b6d4',
        createdAt: Date.now(),
        durationMs: 500,
      });
      room.combatLogs.push(`${champ.playerName} unleashed ${ability.name}!`);
    } else if (ability.targetType === 'aoe' && targetX !== undefined && targetY !== undefined) {
      const radius = ability.areaRadius || 1;
      for (const enemy of Object.values(room.champions)) {
        if (!enemy.isDead && enemy.team !== champ.team && !this.isUntargetable(enemy)) {
          if (getDistance(enemy.x, enemy.y, targetX, targetY) <= radius) {
            const finalDmg = Math.max(10, Math.round(damage * (100 / (100 + enemy.effectiveMr))));
            this.applyDamageToTarget(room, champ, 'champion', enemy.playerId, finalDmg, ability.damageType || 'magic');
            if (ability.statusEffect) {
              enemy.statusEffects.push({ type: ability.statusEffect, durationTurns: ability.effectDuration ?? 1 });
            }
          }
        }
      }
      // Also damage enemy minions in AOE
      for (const minion of room.minions) {
        if (minion.team !== champ.team && getDistance(minion.x, minion.y, targetX, targetY) <= radius) {
          this.applyDamageToTarget(room, champ, 'minion', minion.id, damage, ability.damageType || 'magic');
        }
      }
      // Pop any enemy decoys caught in the blast
      for (const decoy of [...room.decoys]) {
        if (decoy.team !== champ.team && getDistance(decoy.x, decoy.y, targetX, targetY) <= radius) {
          this.popDecoy(room, decoy, champ.team);
        }
      }
      room.visualFx.push({
        id: 'fx_' + Date.now(),
        type: 'aoe_circle',
        startX: targetX,
        startY: targetY,
        targetX,
        targetY,
        radius,
        color: '#a855f7',
        createdAt: Date.now(),
        durationMs: 600,
      });
      room.combatLogs.push(`${champ.playerName} dropped ${ability.name} on (${targetX}, ${targetY})!`);
    } else if (ability.targetType === 'single_enemy' && targetUnitId) {
      const enemyChamp = room.champions[targetUnitId];
      if (enemyChamp && !enemyChamp.isDead && !this.isUntargetable(enemyChamp)) {
        const finalDmg = ability.damageType === 'true'
          ? damage
          : Math.max(10, Math.round(damage * (100 / (100 + enemyChamp.effectiveArmor))));
        this.applyDamageToTarget(room, champ, 'champion', enemyChamp.playerId, finalDmg, ability.damageType || 'physical');
        if (ability.statusEffect) {
          enemyChamp.statusEffects.push({ type: ability.statusEffect, durationTurns: ability.effectDuration ?? 1 });
          this.addFloatingText(room, enemyChamp.x, enemyChamp.y, ability.statusEffect.toUpperCase(), '#ef4444');
        }
        room.combatLogs.push(`${champ.playerName} struck ${enemyChamp.playerName} with ${ability.name}!`);
      }
    } else if (ability.targetType === 'single_ally' && targetUnitId) {
      const ally = room.champions[targetUnitId];
      if (ally && !ally.isDead) {
        if (ability.shieldAmount) {
          ally.shield += ability.shieldAmount;
          this.addFloatingText(room, ally.x, ally.y, `+${ability.shieldAmount} Shield`, '#38bdf8');
        }
        if (ability.healAmount) {
          ally.currentHp = Math.min(ally.maxHp, ally.currentHp + ability.healAmount);
          this.addFloatingText(room, ally.x, ally.y, `+${ability.healAmount} HP`, '#22c55e');
        }
        room.combatLogs.push(`${champ.playerName} aided ${ally.playerName} with ${ability.name}!`);
      }
    } else if (ability.targetType === 'dash_target' && targetX !== undefined && targetY !== undefined) {
      champ.x = targetX;
      champ.y = targetY;
      room.combatLogs.push(`${champ.playerName} dashed with ${ability.name}!`);
    }

    champ.hasActed = true;
    this.passTurn(roomCode, playerId);
    return { success: true };
  }

  public useSummonerSpell(
    roomCode: string,
    playerId: string,
    targetX?: number,
    targetY?: number,
    targetPlayerId?: string
  ): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing' || room.activePlayerId !== playerId) {
      return { success: false, error: 'Not active turn' };
    }

    const champ = room.champions[playerId];
    if (!champ || champ.isDead) return { success: false, error: 'Champion dead' };

    // Cooldown check (once every 4 rounds)
    if (champ.spellCooldownRounds > 0) {
      return { success: false, error: `Summoner spell on cooldown (${champ.spellCooldownRounds} rounds left)` };
    }

    const spell = champ.summonerSpell;
    champ.spellCooldownRounds = 4; // 4 rounds cooldown

    if (spell === 'flash' && targetX !== undefined && targetY !== undefined) {
      const dist = getDistance(champ.x, champ.y, targetX, targetY);
      if (dist > 2) return { success: false, error: 'Flash maximum range is 2 tiles' };
      if (!isTileWalkable(targetX, targetY)) return { success: false, error: 'Cannot flash into walls' };

      const oldX = champ.x;
      const oldY = champ.y;
      champ.x = targetX;
      champ.y = targetY;

      room.visualFx.push({
        id: 'fx_' + Date.now(),
        type: 'flash',
        startX: oldX,
        startY: oldY,
        targetX,
        targetY,
        color: '#facc15',
        createdAt: Date.now(),
        durationMs: 400,
      });
      room.combatLogs.push(`${champ.playerName} Flashed across the battlefield!`);
    } else if (spell === 'barrier') {
      champ.shield += 160;
      this.addFloatingText(room, champ.x, champ.y, '+160 Shield', '#facc15');
      room.combatLogs.push(`${champ.playerName} activated Barrier!`);
    } else if (spell === 'heal') {
      champ.currentHp = Math.min(champ.maxHp, champ.currentHp + 130);
      this.addFloatingText(room, champ.x, champ.y, '+130 HP', '#22c55e');
      room.combatLogs.push(`${champ.playerName} used Heal!`);
    } else if (spell === 'ghost') {
      champ.statusEffects.push({ type: 'ghost', durationTurns: 1 });
      this.recalculateChampionStats(champ);
      this.addFloatingText(room, champ.x, champ.y, '+2 Speed (Ghost)', '#06b6d4');
      room.combatLogs.push(`${champ.playerName} activated Ghost!`);
    } else if (spell === 'ignite' && targetPlayerId) {
      const enemy = room.champions[targetPlayerId];
      if (enemy && !enemy.isDead && enemy.team !== champ.team) {
        this.applyDamageToTarget(room, champ, 'champion', enemy.playerId, 90, 'true');
        this.addFloatingText(room, enemy.x, enemy.y, 'IGNITED (90 True Dmg)', '#ef4444');
        room.combatLogs.push(`${champ.playerName} Ignited ${enemy.playerName}!`);
      }
    } else if (spell === 'cleanse') {
      champ.statusEffects = champ.statusEffects.filter(
        (e) => e.type !== 'stun' && e.type !== 'root' && e.type !== 'silence' && e.type !== 'slow'
      );
      this.addFloatingText(room, champ.x, champ.y, 'CLEANSED', '#ffffff');
      room.combatLogs.push(`${champ.playerName} Cleansed all crowd control!`);
    }

    this.emitUpdate(room);
    return { success: true };
  }

  public buyItem(roomCode: string, playerId: string, itemId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing' || room.activePlayerId !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    const champ = room.champions[playerId];
    if (!champ || champ.isDead) return { success: false, error: 'Champion unavailable' };

    // Check Base/Shop Zone
    if (!isInBaseShopZone(champ.x, champ.y, champ.team)) {
      return { success: false, error: 'Must be in your Base/Shop zone to buy items!' };
    }

    if (champ.items.length >= 6) {
      return { success: false, error: 'Inventory is full (6/6 slots)' };
    }

    const item = SHOP_ITEMS[itemId];
    if (!item) return { success: false, error: 'Item not found' };

    if (champ.gold < item.cost) {
      return { success: false, error: `Not enough gold (${champ.gold}/${item.cost}g)` };
    }

    champ.gold -= item.cost;
    champ.items.push(itemId);
    champ.lastPurchasedItemId = itemId;
    this.recalculateChampionStats(champ);

    this.addFloatingText(room, champ.x, champ.y, `+${item.name}`, '#f59e0b');
    this.logCombatEvent(room, `${champ.playerName} purchased ${item.name}!`, 'item');

    this.emitUpdate(room);
    return { success: true };
  }

  public sellItem(roomCode: string, playerId: string, itemIndex: number): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing' || room.activePlayerId !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    const champ = room.champions[playerId];
    if (!champ || champ.isDead) return { success: false, error: 'Champion unavailable' };

    if (!isInBaseShopZone(champ.x, champ.y, champ.team)) {
      return { success: false, error: 'Must be in your Base/Shop zone to sell items!' };
    }

    if (itemIndex < 0 || itemIndex >= champ.items.length) {
      return { success: false, error: 'Invalid inventory slot' };
    }

    const itemId = champ.items[itemIndex];
    const item = SHOP_ITEMS[itemId];
    if (!item) return { success: false, error: 'Item not found' };

    const refundGold = Math.floor(item.cost * 0.7); // Authentic League 70% sell value
    champ.items.splice(itemIndex, 1);
    champ.gold += refundGold;
    champ.lastPurchasedItemId = undefined;
    this.recalculateChampionStats(champ);

    this.addFloatingText(room, champ.x, champ.y, `+${refundGold}g (Sold)`, '#f59e0b');
    this.logCombatEvent(room, `${champ.playerName} sold ${item.name} for ${refundGold}g.`, 'item');

    this.emitUpdate(room);
    return { success: true };
  }

  public undoBuyItem(roomCode: string, playerId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing' || room.activePlayerId !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    const champ = room.champions[playerId];
    if (!champ || champ.isDead) return { success: false, error: 'Champion unavailable' };

    if (!isInBaseShopZone(champ.x, champ.y, champ.team)) {
      return { success: false, error: 'Must be in your Base/Shop zone to undo purchase!' };
    }

    if (!champ.lastPurchasedItemId) {
      return { success: false, error: 'No recent purchase to undo' };
    }

    const lastIdx = champ.items.lastIndexOf(champ.lastPurchasedItemId);
    if (lastIdx === -1) {
      champ.lastPurchasedItemId = undefined;
      return { success: false, error: 'Purchased item not in inventory' };
    }

    const item = SHOP_ITEMS[champ.lastPurchasedItemId];
    if (!item) return { success: false, error: 'Item not found' };

    champ.items.splice(lastIdx, 1);
    champ.gold += item.cost;
    const undoneName = item.name;
    champ.lastPurchasedItemId = undefined;
    this.recalculateChampionStats(champ);

    this.addFloatingText(room, champ.x, champ.y, `+${item.cost}g (Undo)`, '#f59e0b');
    this.logCombatEvent(room, `${champ.playerName} undid purchase of ${undoneName}.`, 'item');

    this.emitUpdate(room);
    return { success: true };
  }

  public useItem(roomCode: string, playerId: string, itemId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing' || room.activePlayerId !== playerId) {
      return { success: false, error: 'Not your turn' };
    }

    const champ = room.champions[playerId];
    if (!champ || champ.isDead) return { success: false, error: 'Champion unavailable' };

    const itemIdx = champ.items.indexOf(itemId);
    if (itemIdx === -1) return { success: false, error: 'Item not in inventory' };

    if (itemId === 'health_potion') {
      champ.items.splice(itemIdx, 1);
      champ.currentHp = Math.min(champ.maxHp, champ.currentHp + 110);
      this.addFloatingText(room, champ.x, champ.y, '+110 HP', '#22c55e');
      this.logCombatEvent(room, `${champ.playerName} drank a Health Potion!`, 'item');
    } else if (itemId === 'refillable_potion') {
      champ.currentHp = Math.min(champ.maxHp, champ.currentHp + 125);
      this.addFloatingText(room, champ.x, champ.y, '+125 HP', '#22c55e');
      this.logCombatEvent(room, `${champ.playerName} used Refillable Potion!`, 'item');
    } else if (itemId === 'zhonyas_hourglass') {
      champ.statusEffects.push({ type: 'zhonya', durationTurns: 1 });
      this.addFloatingText(room, champ.x, champ.y, 'GOLDEN STASIS', '#facc15');
      this.logCombatEvent(room, `${champ.playerName} entered Zhonya's Golden Stasis!`, 'item');
    }

    this.emitUpdate(room);
    return { success: true };
  }

  private applyDamageToTarget(
    room: GameRoomState,
    attacker: ChampionState,
    targetType: 'champion' | 'minion' | 'turret',
    targetId: string,
    damage: number,
    damageType: 'physical' | 'magic' | 'true',
    isCrit: boolean = false
  ) {
    attacker.damageDealt += damage;
    const color = isCrit ? '#fbbf24' : damageType === 'true' ? '#ffffff' : damageType === 'magic' ? '#a855f7' : '#ef4444';

    if (targetType === 'champion') {
      const victim = room.champions[targetId];
      if (!victim || victim.isDead) return;

      // Zhonya stasis immunity
      if (victim.statusEffects.some((e) => e.type === 'zhonya')) {
        this.addFloatingText(room, victim.x, victim.y, 'IMMUNE', '#facc15');
        return;
      }

      let remainingDmg = damage;
      if (victim.shield > 0) {
        if (victim.shield >= remainingDmg) {
          victim.shield -= remainingDmg;
          remainingDmg = 0;
          this.addFloatingText(room, victim.x, victim.y, `-${damage} (Shielded)`, '#38bdf8');
        } else {
          remainingDmg -= victim.shield;
          victim.shield = 0;
        }
      }

      if (remainingDmg > 0) {
        victim.currentHp -= remainingDmg;
        this.addFloatingText(room, victim.x, victim.y, isCrit ? `-${remainingDmg} CRIT!` : `-${remainingDmg}`, color);
      }

      // Check elimination
      if (victim.currentHp <= 0) {
        // Guardian Angel check
        if (victim.items.includes('guardian_angel')) {
          const gaIdx = victim.items.indexOf('guardian_angel');
          victim.items.splice(gaIdx, 1);
          victim.currentHp = Math.round(victim.maxHp * 0.5);
          this.addFloatingText(room, victim.x, victim.y, 'REVIVED (GA)', '#f59e0b');
          room.combatLogs.push(`${victim.playerName} was saved by Guardian Angel!`);
          return;
        }

        victim.currentHp = 0;
        victim.isDead = true;
        victim.deaths++;
        attacker.kills++;

        // Gold reward: +300g to killer, +150g to teammates
        attacker.gold += 300;
        this.addFloatingText(room, attacker.x, attacker.y, '+300g (Kill)', '#facc15');

        for (const ally of Object.values(room.champions)) {
          if (ally.team === attacker.team && ally.playerId !== attacker.playerId) {
            ally.gold += 150;
            ally.assists++;
            this.addFloatingText(room, ally.x, ally.y, '+150g (Assist)', '#facc15');
          }
        }

        room.combatLogs.push(`☠️ ${attacker.playerName} eliminated ${victim.playerName}! (+300g)`);
        this.checkRoundWinConditions(room);
      }
    } else if (targetType === 'minion') {
      const minion = room.minions.find((m) => m.id === targetId);
      if (!minion) return;

      minion.currentHp -= damage;
      this.addFloatingText(room, minion.x, minion.y, `-${damage}`, color);

      if (minion.currentHp <= 0) {
        const idx = room.minions.indexOf(minion);
        if (idx !== -1) room.minions.splice(idx, 1);

        const bounty = minion.goldBounty;
        attacker.gold += bounty;
        attacker.minionKills++;
        this.addFloatingText(room, attacker.x, attacker.y, `+${bounty}g`, '#facc15');
        this.logCombatEvent(room, `${attacker.playerName} last-hit a ${minion.type} minion (+${bounty}g).`, 'kill');
      }
    } else if (targetType === 'turret') {
      const turret = room.turrets[attacker.team === 'blue' ? 'red' : 'blue'];
      if (turret.isDestroyed) return;

      turret.currentHp -= damage;
      this.addFloatingText(room, turret.x, turret.y, `-${damage}`, color);

      if (turret.currentHp <= 0) {
        turret.currentHp = 0;
        turret.isDestroyed = true;
        room.combatLogs.push(`🏰 ${turret.team.toUpperCase()} TURRET HAS BEEN DESTROYED!`);

        // +250g team gold
        for (const champ of Object.values(room.champions)) {
          if (champ.team === attacker.team) {
            champ.gold += 250;
            this.addFloatingText(room, champ.x, champ.y, '+250g (Turret)', '#facc15');
          }
        }
        this.checkRoundWinConditions(room);
      }
    }
  }

  private addFloatingText(room: GameRoomState, x: number, y: number, text: string, color: string) {
    room.floatingTexts.push({
      id: 'ft_' + Math.random().toString(36).substring(2, 9),
      x,
      y,
      text,
      color,
      createdAt: Date.now(),
    });
    // Cap floating texts
    if (room.floatingTexts.length > 20) {
      room.floatingTexts.shift();
    }
  }

  public logCombatEvent(
    room: GameRoomState,
    text: string,
    type: 'kill' | 'spell' | 'attack' | 'item' | 'system' = 'system'
  ) {
    room.combatLogs.push(text);
    if (!room.combatLogEntries) room.combatLogEntries = [];
    room.combatLogEntries.push({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text,
      turnNumber: room.totalTurnsElapsed ?? 0,
      timestamp: Date.now(),
      type,
    });
    // Keep last 50 entries
    if (room.combatLogEntries.length > 50) {
      room.combatLogEntries = room.combatLogEntries.slice(-50);
    }
  }

  // --- Turn Progression & Round Conclusion ---

  public passTurn(roomCode: string, playerId: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'playing' || room.activePlayerId !== playerId) return false;

    const champ = room.champions[playerId];
    if (champ) {
      champ.hasMoved = false;
      champ.hasActed = false;
      delete champ.movedFrom;

      // Tick down status effects
      champ.statusEffects = champ.statusEffects
        .map((e) => ({ ...e, durationTurns: e.durationTurns - 1 }))
        .filter((e) => e.durationTurns > 0);

      // Passive health/mana regen in base/shop zone
      if (isInBaseShopZone(champ.x, champ.y, champ.team)) {
        champ.currentHp = Math.min(champ.maxHp, champ.currentHp + 100);
        champ.currentMana = Math.min(champ.maxMana, champ.currentMana + 100);
      }
    }

    room.totalTurnsElapsed = (room.totalTurnsElapsed ?? 0) + 1;

    // Advance turn queue
    let attempts = 0;
    do {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnQueue.length;
      room.activePlayerId = room.turnQueue[room.currentTurnIndex];
      attempts++;

      // If full cycle completed, run environment phase (turret attacks, minion moves, ability cooldowns)
      if (room.currentTurnIndex === 0) {
        this.executeEnvironmentTurn(room);
      }
    } while (room.champions[room.activePlayerId]?.isDead && attempts < room.turnQueue.length);

    // If all players are dead, win condition handled
    if (this.checkRoundWinConditions(room)) {
      return true;
    }

    // Award +100 passive gold to next active player
    const nextChamp = room.champions[room.activePlayerId];
    if (nextChamp && !nextChamp.isDead) {
      nextChamp.gold += 100;
      this.recalculateChampionStats(nextChamp);
    }

    room.turnTimeRemainingSeconds = 45;
    this.logCombatEvent(room, `Turn passed to ${nextChamp?.playerName || 'Player'}.`, 'system');

    this.startTurnTimer(roomCode);
    this.emitUpdate(room);

    this.checkAndProcessBotTurn(room);
    return true;
  }

  private executeEnvironmentTurn(room: GameRoomState) {
    // 1. Ability cooldown tick down
    for (const champ of Object.values(room.champions)) {
      for (const ability of champ.abilities) {
        if (ability.currentCooldown > 0) ability.currentCooldown--;
      }
      if (champ.spellCooldownRounds > 0) champ.spellCooldownRounds--;
    }

    // 1b. Decoy expiry -- pops on its own once its duration runs out
    for (const decoy of [...room.decoys]) {
      decoy.turnsRemaining--;
      if (decoy.turnsRemaining <= 0) {
        this.popDecoy(room, decoy, decoy.team === 'blue' ? 'red' : 'blue');
      }
    }

    // 2. Turret Attacks
    for (const team of ['blue', 'red'] as Team[]) {
      const turret = room.turrets[team];
      if (turret.isDestroyed) continue;

      const enemyTeam: Team = team === 'blue' ? 'red' : 'blue';

      // Find closest enemy champion or minion in range
      const enemyChampsInRange = Object.values(room.champions).filter(
        (c) => !c.isDead && c.team === enemyTeam && getDistance(turret.x, turret.y, c.x, c.y) <= turret.attackRange
      );
      const enemyMinionsInRange = room.minions.filter(
        (m) => m.team === enemyTeam && getDistance(turret.x, turret.y, m.x, m.y) <= turret.attackRange
      );

      // Prioritize enemy minions first to protect champions unless champ attacked under tower
      if (enemyMinionsInRange.length > 0) {
        const targetMinion = enemyMinionsInRange[0];
        targetMinion.currentHp -= turret.ad;
        this.addFloatingText(room, targetMinion.x, targetMinion.y, `-${turret.ad} (Turret)`, '#f43f5e');
        room.visualFx.push({
          id: 'fx_' + Date.now(),
          type: 'attack_beam',
          startX: turret.x,
          startY: turret.y,
          targetX: targetMinion.x,
          targetY: targetMinion.y,
          color: team === 'blue' ? '#06b6d4' : '#ef4444',
          createdAt: Date.now(),
          durationMs: 400,
        });
        if (targetMinion.currentHp <= 0) {
          const idx = room.minions.indexOf(targetMinion);
          if (idx !== -1) room.minions.splice(idx, 1);
        }
      } else if (enemyChampsInRange.length > 0) {
        const targetChamp = enemyChampsInRange[0];
        const reducedDmg = Math.round(turret.ad * (100 / (100 + targetChamp.effectiveArmor)));
        this.applyDamageToTarget(room, targetChamp, 'champion', targetChamp.playerId, reducedDmg, 'physical');
        room.visualFx.push({
          id: 'fx_' + Date.now(),
          type: 'attack_beam',
          startX: turret.x,
          startY: turret.y,
          targetX: targetChamp.x,
          targetY: targetChamp.y,
          color: team === 'blue' ? '#06b6d4' : '#ef4444',
          createdAt: Date.now(),
          durationMs: 400,
        });
        room.combatLogs.push(`⚡ ${team.toUpperCase()} Turret fired at ${targetChamp.playerName} for ${reducedDmg} damage!`);
      }
    }

    // 3. Minion Actions (move & attack)
    for (const minion of [...room.minions]) {
      const enemyTeam: Team = minion.team === 'blue' ? 'red' : 'blue';

      // Look for enemy minions in range
      const enemyMinion = room.minions
        .filter((m) => m.team === enemyTeam && getDistance(minion.x, minion.y, m.x, m.y) <= minion.attackRange)
        .sort((a, b) => getDistance(minion.x, minion.y, a.x, a.y) - getDistance(minion.x, minion.y, b.x, b.y))[0];
      if (enemyMinion) {
        enemyMinion.currentHp -= minion.ad;
        this.addFloatingText(room, enemyMinion.x, enemyMinion.y, `-${minion.ad}`, '#f59e0b');
        if (enemyMinion.currentHp <= 0) {
          const idx = room.minions.indexOf(enemyMinion);
          if (idx !== -1) room.minions.splice(idx, 1);
        }
        continue;
      }

      // Look for enemy champion in range
      const enemyChamp = Object.values(room.champions).find((c) => !c.isDead && c.team === enemyTeam && getDistance(minion.x, minion.y, c.x, c.y) <= minion.attackRange);
      if (enemyChamp) {
        const dmg = Math.round(minion.ad * (100 / (100 + enemyChamp.effectiveArmor)));
        enemyChamp.currentHp = Math.max(0, enemyChamp.currentHp - dmg);
        this.addFloatingText(room, enemyChamp.x, enemyChamp.y, `-${dmg}`, '#f59e0b');
        continue;
      }

      // Otherwise march forward along lane path
      const path = minion.team === 'blue' ? BLUE_MINION_PATH : RED_MINION_PATH;
      // Find current waypoint index or closest
      const closestIdx = path.reduce((bestIdx, pt, i) => {
        const d = getDistance(minion.x, minion.y, pt.x, pt.y);
        const bestD = getDistance(minion.x, minion.y, path[bestIdx].x, path[bestIdx].y);
        return d < bestD ? i : bestIdx;
      }, 0);

      const nextPt = path[Math.min(path.length - 1, closestIdx + 1)];
      const centerClashDistance = getDistance(minion.x, minion.y, 12, 6);
      if (centerClashDistance <= 1 && !enemyMinion) {
        continue;
      }
      if (nextPt && isTileWalkable(nextPt.x, nextPt.y)) {
        minion.x = nextPt.x;
        minion.y = nextPt.y;
      }
    }
  }

  private startTurnTimer(roomCode: string) {
    if (this.turnTimers.has(roomCode)) {
      clearInterval(this.turnTimers.get(roomCode)!);
    }

    const interval = setInterval(() => {
      const room = this.rooms.get(roomCode);
      if (!room || room.phase !== 'playing') {
        clearInterval(interval);
        return;
      }

      room.turnTimeRemainingSeconds--;

      if (room.turnTimeRemainingSeconds <= 0) {
        if (room.activePlayerId) {
          this.passTurn(roomCode, room.activePlayerId);
        }
      } else {
        this.emitUpdate(room);
      }
    }, 1000);

    this.turnTimers.set(roomCode, interval);
  }

  private checkRoundWinConditions(room: GameRoomState): boolean {
    if (room.phase !== 'playing') return false;

    // Condition 1: Turret destruction (Siege)
    if (room.turrets.red.isDestroyed) {
      this.concludeRound(room, 'blue', 'Siege: Red Outer Turret destroyed!');
      return true;
    }
    if (room.turrets.blue.isDestroyed) {
      this.concludeRound(room, 'red', 'Siege: Blue Outer Turret destroyed!');
      return true;
    }

    // Condition 2: Ace (all 3 enemy champions dead)
    const blueLiving = Object.values(room.champions).filter((c) => c.team === 'blue' && !c.isDead);
    const redLiving = Object.values(room.champions).filter((c) => c.team === 'red' && !c.isDead);

    if (redLiving.length === 0) {
      this.concludeRound(room, 'blue', 'ACE! All Red team champions eliminated.');
      return true;
    }
    if (blueLiving.length === 0) {
      this.concludeRound(room, 'red', 'ACE! All Blue team champions eliminated.');
      return true;
    }

    return false;
  }

  private concludeRound(room: GameRoomState, winner: Team, reason: string) {
    if (this.turnTimers.has(room.roomCode)) {
      clearInterval(this.turnTimers.get(room.roomCode)!);
    }

    room.phase = 'round_end';
    room.roundWinner = winner;
    if (winner === 'blue') room.blueScore++;
    if (winner === 'red') room.redScore++;

    room.combatLogs.push(`🎉 ${winner.toUpperCase()} TEAM WINS ROUND ${room.currentRound}! (${reason})`);
    room.combatLogs.push(`Score: Blue ${room.blueScore} - ${room.redScore} Red (Best of 3)`);

    // Check match win condition (First to 2 rounds)
    if (room.blueScore >= 2) {
      room.phase = 'match_end';
      room.matchWinner = 'blue';
      room.combatLogs.push('🏆 BLUE TEAM HAS WON THE MATCH!');
      this.emitUpdate(room);
      return;
    }
    if (room.redScore >= 2) {
      room.phase = 'match_end';
      room.matchWinner = 'red';
      room.combatLogs.push('🏆 RED TEAM HAS WON THE MATCH!');
      this.emitUpdate(room);
      return;
    }

    this.emitUpdate(room);

    // Auto advance to next round after 5 seconds
    setTimeout(() => {
      if (room.phase === 'round_end') {
        room.currentRound++;
        room.phase = 'playing';
        this.initRound(room);
      }
    }, 5000);
  }

  public playAgain(roomCode: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    room.phase = 'lobby';
    room.currentRound = 1;
    room.blueScore = 0;
    room.redScore = 0;
    delete room.roundWinner;
    delete room.matchWinner;
    delete room.draft;
    room.turrets = this.createInitialTurrets();
    room.minions = [];
    room.decoys = [];
    room.champions = {};
    room.combatLogs = ['Ready for next match!'];

    this.emitUpdate(room);
    return true;
  }

  // --- Smart Bot AI Decision Engine ---

  private checkAndProcessBotTurn(room: GameRoomState) {
    if (room.phase !== 'playing' || !room.activePlayerId) return;

    const champ = room.champions[room.activePlayerId];
    if (!champ || !champ.isBot || champ.isDead) return;

    // Natural, responsive bot action pacing (200ms + 150ms)
    setTimeout(() => {
      if (room.phase !== 'playing' || room.activePlayerId !== champ.playerId) return;

      // 1. If in base with gold, buy item
      if (isInBaseShopZone(champ.x, champ.y, champ.team)) {
        if (champ.gold >= 450 && !champ.items.includes('dorans_blade') && !champ.items.includes('dorans_ring')) {
          const item = champ.role === 'carry' && champ.effectiveAd > champ.effectiveAp ? 'dorans_blade' : 'dorans_ring';
          this.buyItem(room.roomCode, champ.playerId, item);
        } else if (champ.gold >= 300 && !champ.items.includes('boots_of_speed')) {
          this.buyItem(room.roomCode, champ.playerId, 'boots_of_speed');
        } else if (champ.gold >= 1300 && !champ.items.includes('bf_sword') && champ.effectiveAd > 60) {
          this.buyItem(room.roomCode, champ.playerId, 'bf_sword');
        }
      }

      // 2. Identify nearest enemy targets
      const enemyTeam = champ.team === 'blue' ? 'red' : 'blue';
      const enemyChamps = Object.values(room.champions).filter((c) => !c.isDead && c.team === enemyTeam);
      const enemyTurret = room.turrets[enemyTeam];
      const enemyMinions = room.minions.filter((m) => m.team === enemyTeam);

      // Find closest enemy champion
      let targetChamp: ChampionState | null = null;
      let minChampDist = 999;
      for (const e of enemyChamps) {
        const d = getDistance(champ.x, champ.y, e.x, e.y);
        if (d < minChampDist) {
          minChampDist = d;
          targetChamp = e;
        }
      }

      // 3. Movement logic
      if (!champ.hasMoved && targetChamp) {
        // If low HP (< 30%), retreat toward allied turret
        if (champ.currentHp < champ.maxHp * 0.3) {
          const alliedTurretPos = champ.team === 'blue' ? BLUE_TURRET_POS : RED_TURRET_POS;
          const step = this.findBestStepTowards(champ.x, champ.y, alliedTurretPos.x, alliedTurretPos.y, champ.effectiveMoveSpeed);
          if (step) {
            this.moveChampion(room.roomCode, champ.playerId, step.x, step.y);
          }
        } else {
          // Move toward closest enemy champion (stopping at attack range)
          if (minChampDist > champ.effectiveRange) {
            const step = this.findBestStepTowards(champ.x, champ.y, targetChamp.x, targetChamp.y, champ.effectiveMoveSpeed);
            if (step) {
              this.moveChampion(room.roomCode, champ.playerId, step.x, step.y);
            }
          }
        }
      }

      // 4. Action logic (Cast ability or Auto-Attack)
      setTimeout(() => {
        if (room.phase !== 'playing' || room.activePlayerId !== champ.playerId) return;

        // Try casting damage ability if in range
        if (targetChamp && !champ.hasActed) {
          const d = getDistance(champ.x, champ.y, targetChamp.x, targetChamp.y);
          const qAbility = champ.abilities.find((a) => a.key === 'Q');
          const rAbility = champ.abilities.find((a) => a.key === 'R');

          if (rAbility && rAbility.currentCooldown === 0 && champ.currentMana >= rAbility.manaCost && d <= rAbility.range && targetChamp.currentHp < targetChamp.maxHp * 0.5) {
            this.castAbility(room.roomCode, champ.playerId, 'R', targetChamp.x, targetChamp.y, targetChamp.playerId);
            return;
          }

          if (qAbility && qAbility.currentCooldown === 0 && champ.currentMana >= qAbility.manaCost && d <= qAbility.range) {
            this.castAbility(room.roomCode, champ.playerId, 'Q', targetChamp.x, targetChamp.y, targetChamp.playerId);
            return;
          }

          // Otherwise basic attack
          if (d <= champ.effectiveRange) {
            this.basicAttack(room.roomCode, champ.playerId, 'champion', targetChamp.playerId);
            return;
          }
        }

        // Try attacking enemy minion in range
        if (!champ.hasActed) {
          const minionInRange = enemyMinions.find((m) => getDistance(champ.x, champ.y, m.x, m.y) <= champ.effectiveRange);
          if (minionInRange) {
            this.basicAttack(room.roomCode, champ.playerId, 'minion', minionInRange.id);
            return;
          }
        }

        // Try attacking turret
        if (!champ.hasActed && !enemyTurret.isDestroyed && getDistance(champ.x, champ.y, enemyTurret.x, enemyTurret.y) <= champ.effectiveRange) {
          this.basicAttack(room.roomCode, champ.playerId, 'turret', 'turret');
          return;
        }

        // Pass turn if no actions executed
        this.passTurn(room.roomCode, champ.playerId);
      }, 150);
    }, 200);
  }

  private findBestStepTowards(fromX: number, fromY: number, toX: number, toY: number, maxDist: number): { x: number; y: number } | null {
    let bestX = fromX;
    let bestY = fromY;
    let minRemainingDist = getDistance(fromX, fromY, toX, toY);

    for (let dx = -maxDist; dx <= maxDist; dx++) {
      for (let dy = -maxDist; dy <= maxDist; dy++) {
        const nx = fromX + dx;
        const ny = fromY + dy;
        if (getDistance(fromX, fromY, nx, ny) <= maxDist && isTileWalkable(nx, ny)) {
          const remDist = getDistance(nx, ny, toX, toY);
          if (remDist < minRemainingDist) {
            minRemainingDist = remDist;
            bestX = nx;
            bestY = ny;
          }
        }
      }
    }

    if (bestX !== fromX || bestY !== fromY) {
      return { x: bestX, y: bestY };
    }
    return null;
  }

  public getRoom(roomCode: string): GameRoomState | undefined {
    return this.rooms.get(roomCode.toUpperCase().trim());
  }
}
