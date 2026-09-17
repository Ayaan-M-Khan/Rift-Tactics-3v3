import { DraftAbility, DraftChampion, DraftRoleFilter, TacticalStats } from '../types/draft';
import localData from '../data/ddragon_champions.json';

const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

export function cleanDescription(desc: string): string {
  if (!desc) return '';
  return desc
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapRoles(tags: string[], id: string): DraftRoleFilter[] {
  const roles = new Set<DraftRoleFilter>();
  const safeTags = tags || [];
  if (safeTags.includes('Marksman')) roles.add('BOT');
  if (safeTags.includes('Support')) roles.add('SUPPORT');
  if (safeTags.includes('Mage')) {
    roles.add('MID');
    if (safeTags.includes('Support') || ['Morgana', 'Brand', 'Zyra', 'Lux', 'Karma', 'Velkoz', 'Xerath', 'Seraphine'].includes(id)) {
      roles.add('SUPPORT');
    }
  }
  if (safeTags.includes('Assassin')) {
    roles.add('MID');
    roles.add('JUNGLE');
  }
  if (safeTags.includes('Fighter')) {
    roles.add('TOP');
    roles.add('JUNGLE');
  }
  if (safeTags.includes('Tank')) {
    roles.add('TOP');
    roles.add('SUPPORT');
    roles.add('JUNGLE');
  }
  if (roles.size === 0) roles.add('MID');
  return Array.from(roles);
}

// In-memory cache
let championsCache: Record<string, DraftChampion> = localData.champions as unknown as Record<string, DraftChampion>;
let activePatch = (localData as { patch?: string }).patch || '16.18.1';
let isFetching = false;

export async function fetchLatestPatch(): Promise<string> {
  try {
    const res = await fetch(`${DDRAGON_BASE}/api/versions.json`, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const versions: string[] = await res.json();
    return versions[0] || activePatch;
  } catch (err) {
    console.warn('[DDragon] Failed to resolve latest version, using fallback patch:', activePatch, err);
    return activePatch;
  }
}

export async function fetchChampions(forceRefresh = false): Promise<Record<string, DraftChampion>> {
  if (!forceRefresh && Object.keys(championsCache).length > 0) {
    return championsCache;
  }

  if (isFetching) {
    return championsCache;
  }

  isFetching = true;
  try {
    const patch = await fetchLatestPatch();
    activePatch = patch;

    const res = await fetch(`${DDRAGON_BASE}/cdn/${patch}/data/en_US/championFull.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fullData = await res.json();
    const rawList = Object.values(fullData.data) as Array<{
      id: string;
      key: string;
      name: string;
      title: string;
      tags: string[];
      image: { full: string };
      stats: {
        hp: number;
        mp: number;
        armor: number;
        attackdamage: number;
        attackrange: number;
      };
      passive?: {
        name: string;
        description: string;
        image?: { full: string };
      };
      spells?: Array<{
        id: string;
        name: string;
        description: string;
        image?: { full: string };
        costBurn?: string;
        cooldownBurn?: string;
        rangeBurn?: string;
      }>;
    }>;

    const normalized: Record<string, DraftChampion> = {};
    const keys: Array<'Q' | 'W' | 'E' | 'R'> = ['Q', 'W', 'E', 'R'];

    for (const c of rawList) {
      const rawRange = c.stats.attackrange || 125;
      const tacticalRange = rawRange > 300 ? 3 : 1;

      const passive: DraftAbility = {
        key: 'P',
        name: c.passive ? c.passive.name : 'Passive',
        description: c.passive ? cleanDescription(c.passive.description) : '',
        icon: c.passive?.image?.full
          ? `${DDRAGON_BASE}/cdn/${patch}/img/passive/${c.passive.image.full}`
          : '',
      };

      const abilities: DraftAbility[] = (c.spells || []).map((s, idx) => ({
        key: keys[idx] || 'Q',
        name: s.name,
        description: cleanDescription(s.description),
        icon: s.image?.full
          ? `${DDRAGON_BASE}/cdn/${patch}/img/spell/${s.image.full}`
          : '',
        cost: s.costBurn || '',
        cooldown: s.cooldownBurn || '',
        range: s.rangeBurn ? (parseInt(s.rangeBurn, 10) > 300 ? 3 : 1) : 2,
      }));

      const tacticalStats: TacticalStats = {
        hp: Math.round(c.stats.hp),
        mp: Math.round(c.stats.mp),
        armor: Math.round(c.stats.armor),
        attackDamage: Math.round(c.stats.attackdamage),
        attackRange: tacticalRange,
        moveSpeed: 3,
        rawAttackRange: rawRange,
      };

      normalized[c.id] = {
        id: c.id,
        key: c.key,
        name: c.name,
        title: c.title,
        tags: c.tags || [],
        roles: mapRoles(c.tags, c.id),
        squareIcon: `${DDRAGON_BASE}/cdn/${patch}/img/champion/${c.image.full}`,
        loadingArt: `${DDRAGON_BASE}/cdn/img/champion/loading/${c.id}_0.jpg`,
        splashArt: `${DDRAGON_BASE}/cdn/img/champion/splash/${c.id}_0.jpg`,
        passive,
        abilities,
        stats: tacticalStats,
      };
    }

    championsCache = normalized;
    return championsCache;
  } catch (err) {
    console.warn('[DDragon] Failed to fetch live champions, using local cache:', err);
    return championsCache;
  } finally {
    isFetching = false;
  }
}

export function getChampionsSync(): DraftChampion[] {
  return Object.values(championsCache);
}

export function getChampionById(id: string): DraftChampion | undefined {
  if (!id) return undefined;
  // Case-insensitive lookup as fallback
  if (championsCache[id]) return championsCache[id];
  const lower = id.toLowerCase();
  return Object.values(championsCache).find(
    (c) => c.id.toLowerCase() === lower || c.name.toLowerCase() === lower
  );
}

export function getActivePatch(): string {
  return activePatch;
}

export function getChampionPortraitUrl(champId: string): string {
  if (!champId) return '';
  const dChamp = getChampionById(champId);
  if (dChamp?.squareIcon) return dChamp.squareIcon;
  const formatted = champId.charAt(0).toUpperCase() + champId.slice(1);
  return `${DDRAGON_BASE}/cdn/${activePatch}/img/champion/${formatted}.png`;
}

export function getItemIconUrl(itemId?: string): string {
  if (!itemId) return '';
  return `${DDRAGON_BASE}/cdn/${activePatch}/img/item/${itemId}.png`;
}
