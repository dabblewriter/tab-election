const HEARTBEAT_INTERVAL = 1000;
const PING_TIMEOUT = 50;

const CLOSE = 'tabClose';
const PROMOTE = 'tabPromote';
const PING = 'ping';
const PONG = 'pong';
const ELECTION = 'election';
const CALL = 'call';
const RETURN = 'return';
const STATE = 'state';
const RECEIVE = 'receive';
const DONT_RECEIVE = {};

export type Callback = () => any;
export type Unsubscribe = () => void;
export type OnReceive = (msg: any) => void;
export type OnState<T> = (state: T) => void;
export type Tab<T = any> = {
  call: (name: string, ...rest: any) => void;
  send: (msg: any) => void;
  onReceive: (listener: OnReceive) => Unsubscribe;
  state: () => T | ((state: T) => void);
  onState: (listener: OnState<T>) => Unsubscribe;
  close: () => void;
}

export function waitForLeadership<T = any>(onLeadership?: Callback): Tab<T>;
export function waitForLeadership<T = any>(name: string, onLeadership?: Callback): Tab<T>;
export function waitForLeadership<T = any>(name: string | Callback, onLeadership?: Callback) {
  if (typeof name !== 'string') {
    onLeadership = name;
    name = 'default';
  }
  const isSpectator = !onLeadership;
  const id = createTabId();
  const tabs = new Map([[ id, Date.now() ]]);
  const onReceives = new Set<OnReceive>();
  const onStates = new Set<OnState<T>>();
  const callDeferreds = new Map<number, { resolve: (value: any) => void, reject: (reason?: any) => void }>();
  let leaderId = '';
  let heartbeatTimeout = 0;
  let leaderState: T;
  let channel: BroadcastChannel;
  let callCount = 0;
  let api: any;
  createChannel();
  self.addEventListener('beforeunload', close);
  const callbacks = {
    [PING]: onPing, [PONG]: onPong, [CLOSE]: onTabClose, [PROMOTE]: onTabPromote, [ELECTION]: onElection,
    [CALL]: onCall, [RETURN]: onReturn, [STATE]: onUserState, [RECEIVE]: onUserMessage,
  };
  const call = (name: string, ...rest: any) => {
    if (!leaderId) return console.error('No leader to call');
    return new Promise((resolve, reject) => {
      callDeferreds.set(++callCount, { resolve, reject });
      if (isLeader()) onCall(id, callCount, name, ...rest);
      else postMessage(CALL, id, callCount, name, ...rest, DONT_RECEIVE);
    })
  };
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
  const tab = { id, leaderId, tabs, call, send, onReceive, state, onState, close };

  // Start the heartbeat & initial ping to discover
  if (isSpectator) {
    postMessage(PING);
  } else {
    sendHeartbeat();
  }

  return tab;

  function createChannel() {
    channel = new BroadcastChannel(`tab-election-${name}`);
    channel.addEventListener('message', onMessage);
  }

  function close() {
    channel.removeEventListener('message', onMessage);
    self.removeEventListener('beforeunload', close);
    clearTimeout(heartbeatTimeout);
    if (!isSpectator) postMessage(CLOSE, id);
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
      postMessage(STATE, leaderState, DONT_RECEIVE); // When a new tab joins, send the leader state
    }
    if (!tabId) return; // Spectator tabs don't need to respond or to be responded to
    const now = Date.now();
    tabs.set(tabId, now);

    if (tabId !== id && !isSpectator) {
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

    // if we think we should be the leader because our id is the max, send a message
    if (id === maxId && !isSpectator) {
      postMessage(PROMOTE, id);
      onTabPromote(id);
    }
  }

  async function onCall(id: string, callNumber: number, name: string, ...rest: any[]) {
    if (!isLeader()) return;
    try {
      if (typeof api?.[name] !== 'function') throw new Error('Invalid API method');
      const results = await api[name](...rest);
      postMessage(RETURN, id, callNumber, null, results);
    } catch (e) {
      postMessage(RETURN, id, callNumber, e);
    }
  }

  function onReturn(forTab: string, callNumber: number, error: any, results: any) {
    if (id !== forTab) return;
    const deferred = callDeferreds.get(callNumber);
    if (!deferred) return console.error('No deferred found for call', callNumber);
    callDeferreds.delete(callNumber);
    if (error) deferred.reject(error);
    else deferred.resolve(results);
  }

  function onUserMessage(msg: any) {
    onReceives.forEach(listener => listener(msg));
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
    if (isSpectator) return;
    setTimeout(() => {
      if (isLeader() && onLeadership) {
        // We won!
        api = onLeadership();
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
