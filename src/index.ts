const HEARTBEAT_INTERVAL = 1000;
const PING_TIMEOUT = 50;

const CLOSE = 'tabClose';
const PING = 'ping';
const PONG = 'pong';
const ELECTION = 'election';
const CAMPAIGN = 'campaign';
const CALL = 'call';
const RETURN = 'return';
const STATE = 'state';
const RECEIVE = 'receive';
const DONT_RECEIVE = {};

export type Callback = () => any;
export type Unsubscribe = () => void;
export type OnReceive = (msg: any) => void;
export type OnState<T> = (state: T) => void;
export interface Tab<T = Record<string, any>> {
  call: <R>(name: string, ...rest: any) => Promise<R>;
  send: (msg: any) => void;
  onReceive: (listener: OnReceive) => Unsubscribe;
  state(): T;
  state(state: T): void;
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
  const callDeferreds = new Map<number, { resolve: (value: any) => void, reject: (reason?: any) => void, timeout: number }>();
  const queuedCalls = new Map<number, { name: string, rest: any[] }>();
  let leaderId = '';
  let heartbeatTimeout = 0;
  let leaderState: T;
  let channel: BroadcastChannel;
  let callCount = 0;
  let api: any;
  let election = false;
  createChannel();
  self.addEventListener('beforeunload', close);
  const callbacks = {
    [PING]: onPing, [PONG]: onPong, [CLOSE]: onTabClose, [ELECTION]: onElection, [CAMPAIGN]: onCampaign,
    [CALL]: onCall, [RETURN]: onReturn, [STATE]: onUserState, [RECEIVE]: onUserMessage,
  };
  const setLeader = (newLeaderId: string) => {
    if (leaderId === newLeaderId) return;
    tab.leaderId = leaderId = newLeaderId;
    callDeferreds.forEach(({ reject }, callCount) => {
      if (queuedCalls.has(callCount)) return;
      callDeferreds.delete(callCount);
      reject(new Error('Leader lost'));
    });
  };
  const runCallsAfterElection = () => {
    if (queuedCalls.size) {
      queuedCalls.forEach(({ name, rest }, callCount) => {
        if (isLeader()) onCall(id, callCount, name, ...rest);
        else postMessage(CALL, id, callCount, name, ...rest, DONT_RECEIVE);
      });
      queuedCalls.clear();
    }
  };
  const call = <R>(name: string, ...rest: any) => {
    return new Promise<R>((resolve, reject) => {
      const timeout = setTimeout(() => {
        callDeferreds.delete(callCount);
        reject(new Error('Call timed out'));
      }, 30_000);
      callDeferreds.set(++callCount, { resolve, reject, timeout });
      if (leaderId && !election) {
        if (isLeader()) onCall(id, callCount, name, ...rest);
        else postMessage(CALL, id, callCount, name, ...rest, DONT_RECEIVE);
      } else {
        queuedCalls.set(callCount, { name, rest });
      }
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
    tabs.clear();
    onReceives.clear();
    onStates.clear();
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
    if (isTabLeader) setLeader(tabId);
  }

  function onPong(tabId: string, isTabLeader: boolean) {
    tabs.set(tabId, Date.now());
    if (isTabLeader) setLeader(tabId);
  }

  async function onCall(id: string, callNumber: number, name: string, ...rest: any[]) {
    if (!isLeader()) return;
    try {
      if (typeof api?.[name] !== 'function') throw new Error(`Invalid API method "${name}"`);
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
    clearTimeout(deferred.timeout);
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

  function onElection() {
    election = true;
    setLeader('');
    const maxId = Array.from(tabs.keys()).sort().pop();

    // if we think we should be the leader because our id is the max, send a message
    if (id === maxId && !isSpectator) {
      postMessage(CAMPAIGN, id);
      onCampaign(id);
    }
  }

  function onCampaign(newLeaderId: string) {
    if (!leaderId || leaderId < newLeaderId) {
      setLeader(newLeaderId);
    }
    setTimeout(() => {
      election = false;
      if (!isSpectator && isLeader()) {
        if (onLeadership) {
          // We won!
          api = onLeadership();
          onLeadership = null; // Don't let it get called multiple times
        }
      }
      runCallsAfterElection();
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
