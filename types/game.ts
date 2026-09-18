export type Team = 'blue' | 'red';
export type Role = 'jungle' | 'carry' | 'support';
export type GamePhase = 'lobby' | 'ban' | 'pick' | 'spells' | 'loading' | 'playing' | 'round_end' | 'match_end';

export type TerrainType = 'lane' | 'river' | 'brush' | 'wall' | 'turret' | 'base_shop';

export interface GridTile {
  x: number;
  y: number;
  terrain: TerrainType;
  team?: Team; // for base_shop or turret
}

export type SummonerSpellId = 
  | 'flash'
  | 'barrier'
  | 'heal'
  | 'ghost'
  | 'snowball'
  | 'cleanse'
  | 'ignite'
  | 'exhaust';

export interface SummonerSpellData {
  id: SummonerSpellId;
  name: string;
  description: string;
  icon: string;
  range: number;
  targetType: 'self' | 'tile' | 'enemy' | 'ally';
}

export type ItemId = string;
export type AbilityKey = 'Q' | 'W' | 'E' | 'R';

export interface AbilityData {
  key: AbilityKey;
  name: string;
  description: string;
  manaCost: number;
  cooldownRounds: number;
  currentCooldown: number;
  range: number;
  targetType: 'single_enemy' | 'single_ally' | 'self' | 'line' | 'cone' | 'aoe' | 'dash_target' | 'tile' | 'summon_decoy';
  areaRadius?: number; // for AOE
  baseDamage?: number;
  scaling?: { stat: 'ad' | 'ap'; ratio: number };
  damageType?: 'physical' | 'magic' | 'true';
  healAmount?: number;
  shieldAmount?: number;
  statusEffect?: 'stun' | 'root' | 'silence' | 'slow' | 'knockback' | 'airborne' | 'stealth' | 'ghost';
  effectDuration?: number; // turns the statusEffect lasts; defaults to 1 if omitted
  moveSpeedBonus?: number; // used with statusEffect 'ghost' to set a custom bonus (default 2)
  decoyDurationTurns?: number; // used with targetType 'summon_decoy'
  icon?: string;
}

export interface ChampionData {
  id: string;
  name: string;
  title: string;
  role: Role;
  secondaryRole?: string;
  avatarColor: string;
  accentColor: string;
  iconText: string;
  lore: string;
  
  // Base stats
  baseHp: number;
  baseMana: number;
  baseAd: number;
  baseAp: number;
  baseArmor: number;
  baseMr: number;
  attackRange: number; // 1 = melee, 2-4 = ranged
  moveSpeed: number; // grid tiles per turn (default 3)

  abilities: AbilityData[];
}

export interface ItemData {
  id: string;
  name: string;
  icon?: string;
  ddragonId?: string;
  cost: number;
  description: string;
  passiveName?: string;
  activeName?: string;
  activeCooldown?: number;
  ad?: number;
  ap?: number;
  hp?: number;
  mana?: number;
  armor?: number;
  mr?: number;
  moveBonus?: number;
  critRate?: number; // e.g. 0.25
  lifesteal?: number; // e.g. 0.15
  category: 'starter' | 'ad' | 'ap' | 'tank' | 'mr' | 'boots' | 'consumable';
}

export interface ActiveStatusEffect {
  type: 'stun' | 'root' | 'silence' | 'slow' | 'shield' | 'stealth' | 'zhonya' | 'ghost' | 'ignite' | 'knockback' | 'airborne';
  durationTurns: number;
  value?: number;
  sourceChampionId?: string;
}

export interface ChampionState {
  id: string; // matches champion data id
  playerId: string;
  playerName: string;
  team: Team;
  role: Role;
  x: number;
  y: number;
  currentHp: number;
  maxHp: number;
  currentMana: number;
  maxMana: number;
  shield: number;
  isDead: boolean;
  isBot: boolean;
  
  gold: number;
  items: string[]; // item IDs (up to 6 slots)
  lastPurchasedItemId?: string;
  summonerSpell: SummonerSpellId;
  spellCooldownRounds: number; // cooldown remaining (in rounds)
  
  abilities: AbilityData[];
  statusEffects: ActiveStatusEffect[];
  
  // Action economy for current turn
  hasMoved: boolean;
  movedFrom?: { x: number; y: number };
  hasActed: boolean; // attacked or used ability
  hasAttacked?: boolean;
  
  // Stats calculated from base + items + buffs
  effectiveAd: number;
  effectiveAp: number;
  effectiveArmor: number;
  effectiveMr: number;
  effectiveRange: number;
  effectiveMoveSpeed: number;
  
  // Scoreboard stats
  kills: number;
  deaths: number;
  assists: number;
  minionKills: number;
  damageDealt: number;
}

export interface MinionUnit {
  id: string;
  team: Team;
  type: 'melee' | 'caster' | 'cannon';
  x: number;
  y: number;
  currentHp: number;
  maxHp: number;
  ad: number;
  attackRange: number;
  goldBounty: number;
  hasAttacked: boolean;
}

// A decoy illusion (e.g. Neeko's Shapesplitter) that occupies a tile,
// visually impersonates the caster, and can be moved by its owner as
// an alternative to moving their real champion. Popping it (being
// attacked/targeted, or expiring) deals an AOE burst around it.
export interface DecoyUnit {
  id: string;
  ownerId: string; // playerId of the champion it impersonates
  team: Team;
  championId: string; // which champion it visually mimics
  x: number;
  y: number;
  turnsRemaining: number;
  burstDamage: number; // pre-computed from caster's AP at creation time
}

export interface TurretUnit {
  team: Team;
  x: number;
  y: number;
  currentHp: number;
  maxHp: number;
  armor: number;
  attackRange: number; // default 3 tiles
  ad: number;
  isDestroyed: boolean;
}

export interface CombatFloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  createdAt: number;
}

export interface VisualFxAnimation {
  id: string;
  type: 'attack_beam' | 'skillshot_line' | 'aoe_circle' | 'dash' | 'flash' | 'heal' | 'explosion';
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  color: string;
  radius?: number;
  createdAt: number;
  durationMs: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  socketId?: string;
  isHost: boolean;
  team: Team;
  role: Role;
  isBot: boolean;
  isReady: boolean;
  isDisconnected: boolean;
  disconnectedAt?: number;
  championId?: string;
  summonerSpell?: SummonerSpellId;
  banChampionId?: string;
}

export interface DraftState {
  currentPickerIndex: number; // index in pickOrder
  pickOrder: string[]; // player IDs
  timeRemainingSeconds: number;
  bannedChampions: string[]; // champion IDs
  lockedBans: Record<string, string>; // playerId -> champId
  lockedPicks: Record<string, string>; // playerId -> champId
  selectedSpells: Record<string, SummonerSpellId>; // playerId -> spell
}

export interface CombatLogEntry {
  id: string;
  text: string;
  turnNumber: number;
  timestamp: number;
  type?: 'kill' | 'spell' | 'attack' | 'item' | 'system';
}

export interface GameRoomState {
  roomCode: string;
  phase: GamePhase;
  createdAt: number;
  hostPlayerId: string;
  fillBots: boolean;
  
  players: LobbyPlayer[];
  
  // Match format: Best of 3
  currentRound: number; // 1, 2, 3
  waveNumber: number;
  blueScore: number;
  redScore: number;
  roundWinner?: Team;
  matchWinner?: Team;
  
  // Draft
  draft?: DraftState;
  
  // In-Game state
  turnQueue: string[]; // list of active player IDs for this round in turn order
  currentTurnIndex: number;
  totalTurnsElapsed?: number;
  activePlayerId?: string;
  turnTimeRemainingSeconds: number;
  
  turrets: Record<Team, TurretUnit>;
  minions: MinionUnit[];
  champions: Record<string, ChampionState>; // keyed by playerId
  decoys: DecoyUnit[];
  
  combatLogs: string[];
  combatLogEntries?: CombatLogEntry[];
  visualFx: VisualFxAnimation[];
  floatingTexts: CombatFloatingText[];
}
