import { feathers } from '@feathersjs/feathers';
import socketio from '@feathersjs/socketio-client';
import io from 'socket.io-client';

/* global __SOCKET_PATH__ */
const socket = io(window.location.origin, { path: __SOCKET_PATH__, withCredentials: true });
const app = feathers();
app.configure(socketio(socket));

export default app;
export const sessionsService = app.service('sessions');
sessionsService.methods('stop', 'commands', 'resolvePermission', 'diff', 'shas', 'showDiff', 'merge', 'push', 'restore', 'getPrDetails');
export const recentCombosService = app.service('recent-combos');
export const messagesService = app.service('messages');
export const tasksService = app.service('tasks');
tasksService.methods('kill', 'logs');
export const reposService = app.service('repos');
export const userReposService = app.service('user-repos');
reposService.methods(
  'findRemote',
  'findOrgs',
  'branches',
  'configure',
  'refresh',
  'findAll',
  'unlink',
  'createLocal'
);
export const secretsService = app.service('secrets');
export const queuedMessagesService = app.service('queued-messages');
export const usersService = app.service('users');
usersService.methods('approve', 'reject');
export const pluginsService = app.service('admin/plugins');
pluginsService.methods('refresh');

export function getSocket() {
  return socket;
}
