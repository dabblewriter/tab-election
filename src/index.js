import Tab from './tab';

export { Tab };

// Shortcut, returns the elector that you can later close, and calls the callback once this tab becomes the leader.
export function waitForLeadership(name, callback) {
  if (typeof name === 'function') {
    callback = name;
    name = 'default';
  }
  const tab = new Tab(name);
  tab.waitForLeadership(callback);
  return tab;
}
