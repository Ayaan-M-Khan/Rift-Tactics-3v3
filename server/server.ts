import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { GameEngine } from './gameEngine';

// Determine the listen port:
// - In AI Studio development sandbox: Nginx listens on NGINX_PORT (8080) and proxies to DEFAULT_APP_PORT (3000).
//   We must listen on DEFAULT_APP_PORT (3000) so we do not collide with Nginx.
// - In deployed / published Cloud Run production: There is no Nginx proxy; Cloud Run directly routes to process.env.PORT (8080).
//   We must listen on process.env.PORT (8080) so Cloud Run health checks pass.
const isNginxProxied = Boolean(process.env.NGINX_PORT);
const TARGET_PORT = isNginxProxied
  ? Number(process.env.DEFAULT_APP_PORT || 3000)
  : Number(process.env.PORT || process.env.DEFAULT_APP_PORT || 3000);
const HOST = '0.0.0.0';
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, hostname: HOST, port: TARGET_PORT });
const handle = app.getRequestHandler();

async function bootstrap() {
  await app.prepare();

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      const pathname = parsedUrl.pathname || '';

      // Handle health checks with full CORS support
      if (
        pathname === '/healthz' ||
        pathname === '/healthz/' ||
        pathname === '/health' ||
        pathname === '/health/' ||
        pathname === '/api/health' ||
        pathname === '/api/health/' ||
        pathname === '/api/healthz'
      ) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        });
        res.end(JSON.stringify({ status: 'ok', multiplayer: 'ready', timestamp: Date.now() }));
        return;
      }

      // Handle CORS preflight for any path
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': req.headers.origin || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Allow-Credentials': 'true',
        });
        res.end();
        return;
      }

      // Critical: Do NOT pass /socket.io requests to Next.js handler
      // Engine.IO will intercept and handle them directly
      if (pathname === '/socket.io' || pathname.startsWith('/socket.io/')) {
        return;
      }

      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    }
  });

  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        // Echo origin to support credentials: true across any host, port, or external domain
        callback(null, true);
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    perMessageDeflate: false,
    httpCompression: false,
    pingInterval: 10000,
    pingTimeout: 20000,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 1e6,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  const gameEngine = new GameEngine((room) => {
    io.to(room.roomCode).emit('room_updated', room);
  });

  io.on('connection', (socket) => {
    const leavePreviousRooms = () => {
      const prevRoom = socket.data.roomCode;
      const prevPlayer = socket.data.playerId;
      if (prevRoom) {
        gameEngine.leaveRoom(prevRoom, prevPlayer, socket.id);
      }
      for (const r of socket.rooms) {
        if (r !== socket.id) {
          socket.leave(r);
        }
      }
      delete socket.data.roomCode;
      delete socket.data.playerId;
    };

    // 1. Create Room
    socket.on('create_room', ({ hostName }, callback) => {
      leavePreviousRooms();
      const result = gameEngine.createRoom(hostName, socket.id);
      socket.join(result.room.roomCode);
      socket.data.roomCode = result.room.roomCode;
      socket.data.playerId = result.playerId;
      if (typeof callback === 'function') callback(result);
    });

    // 2. Join Room
    socket.on('join_room', ({ roomCode, playerName }, callback) => {
      const code = (roomCode || '').toUpperCase().trim();
      if (socket.data.roomCode && socket.data.roomCode !== code) {
        leavePreviousRooms();
      }
      const result = gameEngine.joinRoom(code, playerName, socket.id);
      if (result.success && result.room && result.playerId) {
        for (const r of socket.rooms) {
          if (r !== socket.id && r !== result.room.roomCode) {
            socket.leave(r);
          }
        }
        socket.join(result.room.roomCode);
        socket.data.roomCode = result.room.roomCode;
        socket.data.playerId = result.playerId;
      }
      if (typeof callback === 'function') callback(result);
    });

    // 3. Reconnect Session
    socket.on('reconnect_session', ({ sessionToken, roomCode }, callback) => {
      const targetCode = roomCode ? roomCode.toUpperCase().trim() : undefined;
      if (socket.data.roomCode && targetCode && socket.data.roomCode !== targetCode) {
        leavePreviousRooms();
      }
      const result = gameEngine.reconnectPlayer(sessionToken, socket.id);
      if (result.success && result.room && result.player) {
        for (const r of socket.rooms) {
          if (r !== socket.id && r !== result.room.roomCode) {
            socket.leave(r);
          }
        }
        socket.join(result.room.roomCode);
        socket.data.roomCode = result.room.roomCode;
        socket.data.playerId = result.player.id;
      }
      if (typeof callback === 'function') callback(result);
    });

    // 3b. Explicit Leave Room
    socket.on('leave_room', ({ roomCode, playerId }, callback) => {
      const code = roomCode || socket.data.roomCode;
      const pid = playerId || socket.data.playerId;
      if (code) {
        gameEngine.leaveRoom(code, pid, socket.id);
      }
      leavePreviousRooms();
      if (typeof callback === 'function') callback({ success: true });
    });

    // 4. Lobby Slot Customization
    socket.on('update_lobby_slot', ({ roomCode, playerId, team, role }, callback) => {
      const success = gameEngine.updateLobbySlot(roomCode, playerId, team, role);
      if (typeof callback === 'function') callback({ success });
    });

    // 5. Toggle Bot Fill
    socket.on('toggle_bot_fill', ({ roomCode, playerId }, callback) => {
      const success = gameEngine.toggleBotFill(roomCode, playerId);
      if (typeof callback === 'function') callback({ success });
    });

    // 6. Kick Player
    socket.on('kick_player', ({ roomCode, hostPlayerId, targetPlayerId }, callback) => {
      const success = gameEngine.kickPlayer(roomCode, hostPlayerId, targetPlayerId);
      if (typeof callback === 'function') callback({ success });
    });

    // 7. Start Draft
    socket.on('start_draft', ({ roomCode, hostPlayerId }, callback) => {
      const success = gameEngine.startDraft(roomCode, hostPlayerId);
      if (typeof callback === 'function') callback({ success });
    });

    // 8. Lock Ban
    socket.on('lock_ban', ({ roomCode, playerId, championId }, callback) => {
      const targetRoom = roomCode || socket.data.roomCode;
      const targetPlayer = playerId || socket.data.playerId;
      const success = gameEngine.lockBan(targetRoom, targetPlayer, championId);
      if (typeof callback === 'function') callback({ success });
    });

    socket.on('draft_ban', ({ roomCode, playerId, championId }, callback) => {
      const targetRoom = roomCode || socket.data.roomCode;
      const targetPlayer = playerId || socket.data.playerId;
      const success = gameEngine.lockBan(targetRoom, targetPlayer, championId);
      if (typeof callback === 'function') callback({ success });
    });

    // 9. Lock Pick
    socket.on('lock_pick', ({ roomCode, playerId, championId }, callback) => {
      const targetRoom = roomCode || socket.data.roomCode;
      const targetPlayer = playerId || socket.data.playerId;
      const success = gameEngine.lockPick(targetRoom, targetPlayer, championId);
      if (typeof callback === 'function') callback({ success });
    });

    socket.on('draft_lock', ({ roomCode, playerId, championId }, callback) => {
      const targetRoom = roomCode || socket.data.roomCode;
      const targetPlayer = playerId || socket.data.playerId;
      const success = gameEngine.lockPick(targetRoom, targetPlayer, championId);
      if (typeof callback === 'function') callback({ success });
    });

    // Draft Hover / Selection
    socket.on('draft_select', ({ roomCode, playerId, championId }) => {
      const targetRoom = roomCode || socket.data.roomCode;
      const targetPlayer = playerId || socket.data.playerId;
      if (targetRoom) {
        io.to(targetRoom).emit('draft_hovered', { playerId: targetPlayer, championId });
      }
    });

    // 10. Set Summoner Spell
    socket.on('set_summoner_spell', ({ roomCode, playerId, spellId }, callback) => {
      const success = gameEngine.setSummonerSpell(roomCode, playerId, spellId);
      if (typeof callback === 'function') callback({ success });
    });

    // 11. Move Champion
    socket.on('move_champion', ({ roomCode, playerId, targetX, targetY }, callback) => {
      const result = gameEngine.moveChampion(roomCode, playerId, targetX, targetY);
      if (typeof callback === 'function') callback(result);
    });

    // 12. Undo Move
    socket.on('undo_move', ({ roomCode, playerId }, callback) => {
      const success = gameEngine.undoMove(roomCode, playerId);
      if (typeof callback === 'function') callback({ success });
    });

    // 13. Basic Attack
    socket.on('basic_attack', ({ roomCode, playerId, targetType, targetId }, callback) => {
      const result = gameEngine.basicAttack(roomCode, playerId, targetType, targetId);
      if (typeof callback === 'function') callback(result);
    });

    // 14. Cast Ability
    socket.on('cast_ability', ({ roomCode, playerId, abilityKey, targetX, targetY, targetUnitId }, callback) => {
      const result = gameEngine.castAbility(roomCode, playerId, abilityKey, targetX, targetY, targetUnitId);
      if (typeof callback === 'function') callback(result);
    });

    // 14b. Move Decoy (e.g. Neeko's Shapesplitter) instead of moving your real champion
    socket.on('move_decoy', ({ roomCode, playerId, decoyId, targetX, targetY }, callback) => {
      const result = gameEngine.moveDecoy(roomCode, playerId, decoyId, targetX, targetY);
      if (typeof callback === 'function') callback(result);
    });

    // 15. Use Summoner Spell
    socket.on('use_summoner_spell', ({ roomCode, playerId, targetX, targetY, targetPlayerId }, callback) => {
      const result = gameEngine.useSummonerSpell(roomCode, playerId, targetX, targetY, targetPlayerId);
      if (typeof callback === 'function') callback(result);
    });

    // 16. Buy Item
    socket.on('buy_item', ({ roomCode, playerId, itemId }, callback) => {
      const result = gameEngine.buyItem(roomCode, playerId, itemId);
      if (typeof callback === 'function') callback(result);
    });

    // 16b. Sell Item
    socket.on('sell_item', ({ roomCode, playerId, itemIndex }, callback) => {
      const result = gameEngine.sellItem(roomCode, playerId, itemIndex);
      if (typeof callback === 'function') callback(result);
    });

    // 16c. Undo Buy Item
    socket.on('undo_buy_item', ({ roomCode, playerId }, callback) => {
      const result = gameEngine.undoBuyItem(roomCode, playerId);
      if (typeof callback === 'function') callback(result);
    });

    // 17. Use Item
    socket.on('use_item', ({ roomCode, playerId, itemId }, callback) => {
      const result = gameEngine.useItem(roomCode, playerId, itemId);
      if (typeof callback === 'function') callback(result);
    });

    // 18. Pass Turn
    socket.on('pass_turn', ({ roomCode, playerId }, callback) => {
      const success = gameEngine.passTurn(roomCode, playerId);
      if (typeof callback === 'function') callback({ success });
    });

    // 19. Play Again
    socket.on('play_again', ({ roomCode }, callback) => {
      const success = gameEngine.playAgain(roomCode);
      if (typeof callback === 'function') callback({ success });
    });

    // Disconnect handling
    socket.on('disconnect', () => {
      gameEngine.handleDisconnect(socket.id);
    });
  });

  const shutdown = () => {
    console.log('Shutting down Rift Tactics server...');
    io.close(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const startServer = (portToTry: number) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Server] Port ${portToTry} is already in use.`);
        if (portToTry === 8080) {
          console.log(`[Server] Port 8080 collision detected (e.g. reverse proxy). Falling back to port 3000...`);
          startServer(3000);
          return;
        }
        if (portToTry === 3000) {
          console.log(`[Server] Port 3000 in use. Retrying on port 8080...`);
          startServer(8080);
          return;
        }
      }
      console.error(`[Server] Fatal error on port ${portToTry}:`, err);
      process.exit(1);
    });

    server.listen(portToTry, HOST, () => {
      console.log(`> Rift Tactics server ready on http://${HOST}:${portToTry}`);
    });
  };

  startServer(TARGET_PORT);
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
