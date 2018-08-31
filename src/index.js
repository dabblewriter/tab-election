import LeaderElector from './leader-elector';
import Metadata from './metadata';

export { LeaderElector };

// Shortcut, returns the elector that you can later close, and calls the callback once this tab becomes the leader.
export function waitForLeadership(name, callback) {
  if (typeof name === 'function') {
    callback = name;
    name = 'default';
  }
  const elector = new LeaderElector(name);
  return elector.waitForLeadership(callback);
}

// Shortcut, returns the TabMetadata that you can set metadata and later close, and calls the callback whenever tab
// metadata changes.
export function getMetadata(name, callback) {
  if (typeof name === 'function') {
    callback = name;
    name = 'default';
  }
  const metadata = new Metadata(name);
  metadata.subscribe(callback);
  return metadata;
}
