import LeaderElector from './leader-elector';

export { LeaderElector };

// Shortcut, returns the elector that you can later close, and calls the callback once this tab becomes the leader.
export function waitForLeadership(name, callback) {
  if (typeof name === 'function') {
    callback = name;
    name = 'default';
  }
  let elector = new LeaderElector(name);
  return elector.waitForLeadership(callback);
}
