const HEARTBEAT_INTERVAL = 1000;
const PING_TIMEOUT = 50;

const CLOSE = 'tabClose';
const PROMOTE = 'tabPromote';
const PING = 'ping';
const PONG = 'pong';
const ELECTION = 'election';
const STATE = 'state';
const RECEIVE = 'receive';
const DONT_RECEIVE = {};

export type Callback = () => any;
export type Unsubscribe = () => void;
export type OnReceive = (msg: any, fromLeader: boolean) => void;
export type OnState<T> = (state: T) => void;
export type Tab<T = any> = {
  send: (msg: any) => void;
  onReceive: (listener: OnReceive, fromLeader: boolean) => Unsubscribe;
  state: () => T | ((state: T) => void);
  onState: (listener: OnState<T>) => Unsubscribe;
  close: () => void;
}

export function waitForLeadership<T = any>(onLeadership: Callback): Tab<T>;
export function waitForLeadership<T = any>(name: string, onLeadership: Callback): Tab<T>;
export function waitForLeadership<T = any>(name: string | Callback, onLeadership?: Callback) {
  if (typeof name === 'function') {
    onLeadership = name;
    name = 'default';
  }
  const id = createTabId();
  const tabs = new Map([[ id, Date.now() ]]);
  const onReceives = new Set<OnReceive>();
  const onStates = new Set<OnState<T>>();
  let leaderId = '';
  let heartbeatTimeout = 0;
  let leaderState: T;
  let channel: BroadcastChannel;
  createChannel();
  self.addEventListener('beforeunload', close);
  const callbacks = {
    [PING]: onPing, [PONG]: onPong, [CLOSE]: onTabClose, [PROMOTE]: onTabPromote, [ELECTION]: onElection,
    [STATE]: onUserState, [RECEIVE]: onUserMessage,
  }
  const send = (msg: any) => postMessage(RECEIVE, msg, DONT_RECEIVE);
  const onReceive = (onReceive: OnReceive): Unsubscribe => {
    onReceives.add(onReceive);
    return () => onReceives.delete(onReceive);
  }
  const state = (state?: any) => {
    if (state === undefined) return leaderState;
    if (!isLeader()) return console.error('Only the leader can set state');
    leaderState = state;
    postMessage(STATE, state, DONT_RECEIVE);
    onUserState(state);
  };
  const onState = (onState: OnState<T>): Unsubscribe => {
    onStates.add(onState);
    return () => onStates.delete(onState);
  }
  const tab = { id, leaderId, tabs, send, onReceive, state, onState, close };

  // Start the heartbeat & initial ping to discover
  sendHeartbeat();

  return tab;

  function createChannel() {
    channel = new BroadcastChannel(`tab-election-${name}`);
    channel.addEventListener('message', onMessage);
  }

  function close() {
    channel.removeEventListener('message', onMessage);
    self.removeEventListener('beforeunload', close);
    clearTimeout(heartbeatTimeout);
    postMessage(CLOSE, id);
    if (leaderId === id) postMessage(ELECTION);
    channel.close();
  }

  function isLeader() {
    return leaderId === id;
  }

  function postMessage(name: string, ...rest: any[]) {
    const data = { name, rest };
    const sendSelf = rest[rest.length - 1] !== DONT_RECEIVE;
    if (!sendSelf) rest.pop();
    try {
      channel.postMessage(data);
      if (sendSelf) onMessage(new MessageEvent('message', { data }));
    } catch (e) {
      // If the channel is closed, create a new one and try again
      if (e.name === 'InvalidStateError') {
        createChannel();
        postMessage(name, ...rest);
      }
    }
  }

  function onMessage(event: MessageEvent) {
    const { name, rest } = event.data as { name: keyof typeof callbacks, rest: any[] };
    callbacks[name].apply(null, rest);
  }

  function sendHeartbeat() {
    const now = Date.now();
    clearTimeout(heartbeatTimeout);
    const nextInterval = HEARTBEAT_INTERVAL + Math.round(Math.random() * HEARTBEAT_INTERVAL * tabs.size);
    heartbeatTimeout = setTimeout(() => sendHeartbeat(), nextInterval);

    postMessage(PING, id, isLeader());
    setTimeout(() => {
      tabs.forEach((lastUpdated, id) => {
        // If a tab is old (or an old record with a future date is stuck in localStorage), close it
        if (lastUpdated < now) postMessage(CLOSE, id);
      });
      if (!leaderId || !tabs.has(leaderId)) {
        postMessage(ELECTION);
      }
    }, PING_TIMEOUT);
  }

  function onPing(tabId: string, isTabLeader: boolean) {
    if (isLeader() && leaderState !== undefined && !tabs.has(tabId)) {
      tab.state(leaderState); // When a new tab joins, send the leader state
    }
    const now = Date.now();
    tabs.set(tabId, now);

    if (tabId !== id) {
      postMessage(PONG, id, isLeader());
    }
    if (isTabLeader) tab.leaderId = leaderId = tabId;
  }

  function onPong(tabId: string, isTabLeader: boolean) {
    tabs.set(tabId, Date.now());
    if (isTabLeader) tab.leaderId = leaderId = tabId;
  }

  function onElection() {
    tab.leaderId = leaderId = '';
    const maxId = Array.from(tabs.keys()).sort().pop();

    // if we think we should be the leader, set the key and send a message
    if (id === maxId) {
      postMessage(PROMOTE, id);
      onTabPromote(id);
    }
  }

  function onUserMessage(msg: any, fromLeader: boolean) {
    onReceives.forEach(listener => listener(msg, fromLeader));
  }

  function onUserState(state: any) {
    leaderState = state;
    onStates.forEach(listener => listener(state));
  }

  function onTabClose(id: string) {
    tabs.delete(id);
  }

  function onTabPromote(newLeaderId: string) {
    if (!leaderId || leaderId < newLeaderId) {
      tab.leaderId = leaderId = newLeaderId;
    }
    setTimeout(() => {
      if (isLeader() && onLeadership) {
        // We won!
        onLeadership();
        onLeadership = null; // Don't let it get called multiple times
      }
    }, PING_TIMEOUT);
  }
}

const chars = (
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
).split('');

function createTabId() {
  let id = '';
  let length = 16;
  while (length--) {
    id += chars[Math.random() * chars.length | 0];
  }
  return id;
}
