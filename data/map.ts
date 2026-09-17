import { GridTile, Team, TerrainType } from '../types/game';

export const MAP_WIDTH = 24;
export const MAP_HEIGHT = 14;

export const BLUE_TURRET_POS = { x: 4, y: 9 };
export const RED_TURRET_POS = { x: 19, y: 4 };

export const BLUE_BASE_BOUNDS = { minX: 0, maxX: 2, minY: 9, maxY: 11 };
export const RED_BASE_BOUNDS = { minX: 21, maxX: 23, minY: 2, maxY: 4 };

export const BLUE_SPAWN_POINTS = [
  { x: 5, y: 9 },
  { x: 5, y: 8 },
  { x: 5, y: 10 },
];

export const RED_SPAWN_POINTS = [
  { x: 18, y: 4 },
  { x: 18, y: 3 },
  { x: 18, y: 5 },
];

export const BRAZIERS = [
  { x: 7, y: 6 },
  { x: 10, y: 9 },
  { x: 13, y: 4 },
  { x: 16, y: 7 },
];

// Predefined River Brush Clusters
export const BRUSH_TILES = new Set<string>([
  // Upper River Bush (North-West river entrance)
  '8,3', '8,4', '9,4', '7,3',
  // Upper River Deep Bush
  '5,1', '6,1', '6,2',
  // Lower River Bush (South-East river entrance)
  '14,9', '15,9', '15,10', '16,10',
  // Lower River Deep Bush
  '17,12', '18,12', '18,11',
  // Lane side brush
  '10,2', '11,2',
  '12,11', '13,11'
]);

// River tiles
export const RIVER_TILES = new Set<string>([
  '7,0', '8,0',
  '7,1', '8,1', '9,1',
  '8,2', '9,2', '10,2',
  '8,3', '9,3', '10,3',
  '8,4', '9,4', '10,4', '11,4',
  '9,5', '10,5', '11,5', '12,5',
  '10,6', '11,6', '12,6', '13,6',
  '11,7', '12,7', '13,7', '14,7',
  '12,8', '13,8', '14,8', '15,8',
  '13,9', '14,9', '15,9', '16,9',
  '14,10', '15,10', '16,10',
  '15,11', '16,11', '17,11',
  '16,12', '17,12', '18,12',
  '16,13', '17,13',
]);

// Mid Lane Path points (playable open corridor)
export const LANE_TILES = new Set<string>();

// Populate Lane Tiles as a diagonal band with thickness
for (let x = 0; x < MAP_WIDTH; x++) {
  for (let y = 0; y < MAP_HEIGHT; y++) {
    // Linear equation approximating mid lane from (1, 10) to (22, 3):
    // Slope = (3 - 10) / (22 - 1) = -7 / 21 = -1/3
    // Line: y - 10 = -1/3 * (x - 1) => 3y + x ≈ 31
    const val = 3 * y + x;
    if (val >= 24 && val <= 38) {
      LANE_TILES.add(`${x},${y}`);
    }
  }
}

// Generate complete grid
export function buildMapGrid(): GridTile[][] {
  const grid: GridTile[][] = [];

  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row: GridTile[] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      const key = `${x},${y}`;

      // Check Turrets
      if (x === BLUE_TURRET_POS.x && y === BLUE_TURRET_POS.y) {
        row.push({ x, y, terrain: 'turret', team: 'blue' });
        continue;
      }
      if (x === RED_TURRET_POS.x && y === RED_TURRET_POS.y) {
        row.push({ x, y, terrain: 'turret', team: 'red' });
        continue;
      }

      // Check Base/Shop
      if (
        x >= BLUE_BASE_BOUNDS.minX &&
        x <= BLUE_BASE_BOUNDS.maxX &&
        y >= BLUE_BASE_BOUNDS.minY &&
        y <= BLUE_BASE_BOUNDS.maxY
      ) {
        row.push({ x, y, terrain: 'base_shop', team: 'blue' });
        continue;
      }
      if (
        x >= RED_BASE_BOUNDS.minX &&
        x <= RED_BASE_BOUNDS.maxX &&
        y >= RED_BASE_BOUNDS.minY &&
        y <= RED_BASE_BOUNDS.maxY
      ) {
        row.push({ x, y, terrain: 'base_shop', team: 'red' });
        continue;
      }

      // Check Brush
      if (BRUSH_TILES.has(key)) {
        row.push({ x, y, terrain: 'brush' });
        continue;
      }

      // Check River
      if (RIVER_TILES.has(key)) {
        row.push({ x, y, terrain: 'river' });
        continue;
      }

      // Check Lane
      if (LANE_TILES.has(key)) {
        row.push({ x, y, terrain: 'lane' });
        continue;
      }

      // Outer terrain: walls / jungle forest rocks
      row.push({ x, y, terrain: 'wall' });
    }
    grid.push(row);
  }

  return grid;
}

export const MAP_GRID = buildMapGrid();

export function isTileInBounds(x: number, y: number): boolean {
  return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
}

export function isTileWalkable(x: number, y: number): boolean {
  if (!isTileInBounds(x, y)) return false;
  const tile = MAP_GRID[y][x];
  return tile.terrain !== 'wall' && tile.terrain !== 'turret';
}

export function getDistance(x1: number, y1: number, x2: number, y2: number): number {
  // Chebyshev distance (standard for 8-direction grid movement/ranges)
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

export function getManhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

export function isInBaseShopZone(x: number, y: number, team: Team): boolean {
  const bounds = team === 'blue' ? BLUE_BASE_BOUNDS : RED_BASE_BOUNDS;
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

export function getLineTiles(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let currX = x0;
  let currY = y0;

  while (true) {
    tiles.push({ x: currX, y: currY });
    if (currX === x1 && currY === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      currX += sx;
    }
    if (e2 < dx) {
      err += dx;
      currY += sy;
    }
  }

  return tiles;
}

// Center lane waypoint coordinates for minion marching
export const BLUE_MINION_PATH = [
  { x: 5, y: 9 },
  { x: 7, y: 8 },
  { x: 9, y: 7 },
  { x: 11, y: 6 },
  { x: 12, y: 6 },
  { x: 13, y: 5 },
  { x: 15, y: 5 },
  { x: 17, y: 4 },
  { x: 19, y: 4 }, // Red Turret
];

export const RED_MINION_PATH = [
  { x: 18, y: 4 },
  { x: 15, y: 5 },
  { x: 13, y: 5 },
  { x: 12, y: 6 },
  { x: 11, y: 6 },
  { x: 9, y: 7 },
  { x: 7, y: 8 },
  { x: 5, y: 9 },
  { x: 4, y: 9 }, // Blue Turret
];
