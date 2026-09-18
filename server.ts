import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { GameEngine } from './server/gameEngine';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

async function bootstrap() {
  await app.prepare();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    if (parsedUrl.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: false,
    },
    transports: ['websocket', 'polling'],
    pingInterval: 10000,
    pingTimeout: 30000,
    upgradeTimeout: 30000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  const gameEngine = new GameEngine((room) => {
    io.to(room.roomCode).emit('room_updated', room);
  });

  io.on('connection', (socket) => {
    // 1. Create Room
    socket.on('create_room', ({ hostName }, callback) => {
      const result = gameEngine.createRoom(hostName, socket.id);
      socket.join(result.room.roomCode);
      socket.data.roomCode = result.room.roomCode;
      socket.data.playerId = result.playerId;
      if (typeof callback === 'function') callback(result);
    });

    // 2. Join Room
    socket.on('join_room', ({ roomCode, playerName }, callback) => {
      const result = gameEngine.joinRoom(roomCode, playerName, socket.id);
      if (result.success && result.room && result.playerId) {
        socket.join(result.room.roomCode);
        socket.data.roomCode = result.room.roomCode;
        socket.data.playerId = result.playerId;
      }
      if (typeof callback === 'function') callback(result);
    });

    // 3. Reconnect Session
    socket.on('reconnect_session', ({ sessionToken }, callback) => {
      const result = gameEngine.reconnectPlayer(sessionToken, socket.id);
      if (result.success && result.room && result.player) {
        socket.join(result.room.roomCode);
        socket.data.roomCode = result.room.roomCode;
        socket.data.playerId = result.player.id;
      }
      if (typeof callback === 'function') callback(result);
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

  server.listen(PORT, HOST, () => {
    console.log(`> Rift Tactics server ready on http://${HOST}:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
