const jwt = require('jsonwebtoken');
const User = require('./models/User');

const initializeSocket = (io) => {
  const connectedUsers = new Map();

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('authenticate', async (token) => {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        connectedUsers.set(socket.id, userId);
        socket.userId = userId;

        socket.join(`user_${userId}`);

        const user = await User.findById(userId);
        if (user) {
          socket.join(`company_${user.company}`);
          socket.to(`company_${user.company}`).emit('user:online', {
            userId,
            name: user.name
          });
        }

        console.log(`User ${userId} authenticated and joined rooms`);
      } catch (err) {
        console.error('Socket authentication error:', err);
        socket.disconnect();
      }
    });

    socket.on('typing:start', (data) => {
      const { receiverId } = data;
      socket.to(`user_${receiverId}`).emit('typing:start', {
        senderId: socket.userId
      });
    });

    socket.on('typing:stop', (data) => {
      const { receiverId } = data;
      socket.to(`user_${receiverId}`).emit('typing:stop', {
        senderId: socket.userId
      });
    });

    socket.on('message:send', async (data) => {
      try {
        const { receiverId, content, fileUrl, fileName, fileType } = data;
        io.to(`user_${receiverId}`).emit('message:receive', {
          message: {
            _id: Date.now().toString(),
            sender: socket.userId,
            receiver: receiverId,
            content,
            fileUrl,
            fileName,
            fileType,
            createdAt: new Date(),
            isAnnouncement: false
          },
          sender: { id: socket.userId }
        });
      } catch (err) {
        console.error('Socket message send error:', err);
      }
    });

    socket.on('announcement:send', async (data) => {
      try {
        const { companyId, content, fileUrl, fileName, fileType } = data;
        io.to(`company_${companyId}`).emit('announcement:receive', {
          announcement: {
            _id: Date.now().toString(),
            sender: socket.userId,
            content,
            fileUrl,
            fileName,
            fileType,
            createdAt: new Date(),
            isAnnouncement: true
          },
          sender: { id: socket.userId }
        });
      } catch (err) {
        console.error('Socket announcement send error:', err);
      }
    });

    socket.on('disconnect', () => {
      const userId = connectedUsers.get(socket.id);
      if (userId) {
        connectedUsers.delete(socket.id);
        console.log(`User ${userId} disconnected`);
      }
    });
  });

  return io;
};

module.exports = { initializeSocket };
