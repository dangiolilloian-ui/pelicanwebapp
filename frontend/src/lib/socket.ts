import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (socket) return socket;

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (!token) return null;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  // Socket.IO connects to the backend origin (strip /api suffix)
  const baseUrl = apiUrl.replace(/\/api\/?$/, '');

  socket = io(baseUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  socket.on('disconnect', () => {
    socket = null;
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
