import { Role, SummonerSpellId, Team } from './game';

export type DraftRoleFilter = 'ALL' | 'TOP' | 'JUNGLE' | 'MID' | 'BOT' | 'SUPPORT';

export interface TacticalStats {
  hp: number;
  mp: number;
  armor: number;
  attackDamage: number;
  attackRange: number; // 1 for melee, 3 for ranged
  moveSpeed: number; // constant 3 tiles
  rawAttackRange: number;
}

export interface DraftAbility {
  key: 'P' | 'Q' | 'W' | 'E' | 'R';
  name: string;
  description: string;
  icon: string;
  cost?: string;
  cooldown?: string;
  range?: number;
}

export interface DraftChampion {
  id: string; // e.g. "Aatrox", "Ahri", "Jinx"
  key: string; // e.g. "266"
  name: string; // e.g. "Aatrox"
  title: string; // e.g. "the Darkin Blade"
  tags: string[]; // ["Fighter", "Tank"]
  roles: DraftRoleFilter[]; // ['TOP', 'JUNGLE']
  squareIcon: string;
  loadingArt: string;
  splashArt: string;
  passive: DraftAbility;
  abilities: DraftAbility[]; // [Q, W, E, R]
  stats: TacticalStats;
  lore?: string;
}

export interface DraftPlayerSlot {
  playerId: string;
  playerName: string;
  team: Team;
  role: Role;
  isMe: boolean;
  isCurrentPicker: boolean;
  hasBanned: boolean;
  hasPicked: boolean;
  bannedChampionId?: string;
  pickedChampionId?: string;
  summonerSpell?: SummonerSpellId;
}

export type DraftSortMode = 'name' | 'role';
