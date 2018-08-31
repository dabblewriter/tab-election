
const chars = (
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
).split('');

export function createNodeId() {
  let id = '';
  let length = 6;
  while (length--) {
    id += chars[Math.random() * chars.length | 0];
  }
  return id;
}
