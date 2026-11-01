// socket.js
let io = null;

function initSocket(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
  });

  io.on('connection', socket => {
    console.log('Client connected:', socket.id);
    socket.on('joinKitchen', () => {
      socket.join('kitchen');
      console.log(`Socket ${socket.id} joined kitchen room`);
    });
    socket.on('joinTable', tableId => {
      const room = `table_${tableId}`;
      socket.join(room);
      console.log(`Socket ${socket.id} joined ${room}`);
    });
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.IO is not initialized yet!');
  }
  return io;
}

module.exports = { initSocket, getIO };

