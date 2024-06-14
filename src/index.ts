export type OnLeadership = (relinquish: Unsubscribe) => any;
export type Unsubscribe = () => void;
export type OnReceive = (msg: any) => void;
export type OnState<T> = (state: T) => void;

interface Deferred {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: number;
}

export enum To {
  All = 'all',
  Others = 'others',
  Leader = 'leader',
}

export interface TabEventMap {
  leadershipchange: Event;
  message: MessageEvent;
  state: MessageEvent;
}

export interface Tab {
  addEventListener<K extends keyof TabEventMap>(type: K, listener: (this: BroadcastChannel, ev: TabEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof TabEventMap>(type: K, listener: (this: BroadcastChannel, ev: TabEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

/**
 * A Tab is an interfaces to synchronize state and messages between tabs. It uses BroadcastChannel and the Lock API.
 * This is a simplified version of the original implementation.
 */
export class Tab<T = Record<string, any>> extends EventTarget implements Tab {
  relinquishLeadership = () => {};

  private _name: string;
  private _id: string;
  private _hasLeaderCache: boolean;
  private _hasLeaderChecking: Promise<boolean>;
  private _callerId: string;
  private _callDeferreds = new Map<number, Deferred>();
  private _queuedCalls = new Map<number, { id: string; name: string; rest: any[] }>();
  private _channel: BroadcastChannel;
  private _isLeader = false;
  private _isLeaderReady = false;
  private _state: T;
  private _callCount = 0;
  private _api: any;
  private _sentCalls = new Map<number, any>();

  constructor(name = 'default') {
    super();
    this._name = name;
    this._id = createTabId();
    this._state = {} as T;
    this._createChannel();
    this.hasLeader().then(hasLeader => {
      if (hasLeader) this._postMessage(To.Leader, 'onSendState', this._id);
    });
  }

  get id() {
    return this._id;
  }

  get name() {
    return this._name;
  }

  get isLeader() {
    return this._isLeader;
  }

  hasLeader(): Promise<boolean> {
    if (this._hasLeaderCache || this.isLeader) return Promise.resolve(true);
    if (this._hasLeaderChecking) return this._hasLeaderChecking;

    const check = () => navigator.locks.request(`tab-${this._name}`, { ifAvailable: true }, lock => lock === null);

    return this._hasLeaderChecking = check().then(async (hasLeader) => {
      if (!hasLeader) {
        this._hasLeaderChecking = null;
        return false;
      }

      // bug in Chrome will sometimes handle this option lock request first before running the winner first. This is a
      // workaround to make sure the winner runs first.
      hasLeader = await check();
      this._hasLeaderCache = hasLeader;
      // wait to know when there is no longer a leader
      navigator.locks.request(`tab-${this._name}`, () => this._hasLeaderCache = false);
      this._hasLeaderChecking = null;
      return hasLeader;
    });
  }

  getCurrentCallerId() {
    return this._callerId;
  }

  getState() {
    return this._state;
  }
  setState(state: T) {
    if (!this.isLeader) throw new Error('Only the leader can set state');
    this._onState(state);
    this._postMessage(To.Others, 'onState', state);
  }

  async waitForLeadership(onLeadership: OnLeadership): Promise<boolean> {
    this.relinquishLeadership(); // Cancel any previous leadership requests
    const abortController = new AbortController();
    const { signal } = abortController;
    this.relinquishLeadership = () => abortController.abort('Aborted');

    try {
      // The signal will cancel the lock request before a lock is attained, the promise.resolve will cancel it after
      return await navigator.locks.request(`tab-${this._name}`, { signal }, async lock => {
        this._isLeader = true;
        // Never resolve until relinquishLeadership is called
        const keepLockPromise = new Promise<boolean>(resolve => (this.relinquishLeadership = () => resolve(true)));
        this._api = await onLeadership(this.relinquishLeadership);
        this._isLeaderReady = true;
        this._queuedCalls.forEach(({ id, name, rest }, callNumber) => this._onCall(id, callNumber, name, ...rest));
        this._queuedCalls.clear();
        this.dispatchEvent(new Event('leadershipchange'));
        this._postMessage(To.Others, 'onLeader', this._state);
        return keepLockPromise;
      }).catch(e => e !== 'Aborted' && Promise.reject(e) || false);
    } finally {
      this._isLeader = false;
      this._api = null;
      this.dispatchEvent(new Event('leadershipchange'));
    }
  }

  call<R>(name: string, ...rest: any[]): Promise<R> {
    const callNumber = ++this._callCount;
    return new Promise<R>(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        this._callDeferreds.delete(callNumber);
        reject(new Error('Call timed out'));
      }, 30_000);
      this._callDeferreds.set(callNumber, { resolve, reject, timeout });
      const hasLeader = await this.hasLeader();
      if (this.isLeader && this._isLeaderReady) {
        this._onCall(this._id, callNumber, name, ...rest);
      } else if (!this.isLeader && hasLeader) {
        // If the call isn't received by the leader within 500ms, assume the leader is dead and try again
        const send = () => {
          const t = setTimeout(() => this._sentCalls.has(callNumber) && send(), 500);
          this._sentCalls.set(callNumber, t);
          this._postMessage(To.Leader, 'onCall', this._id, callNumber, name, ...rest);
        }
        send();
      } else {
        this._queuedCalls.set(callNumber, { id: this._id, name, rest });
      }
    });
  }

  send(data: any, to: string | Set<string> = To.Others): void {
    this._postMessage(to, 'onSend', data);
  }

  close(): void {
    this.relinquishLeadership();
    this._isLeader = false;
    this._channel.close();
    this._channel.onmessage = null;
  }

  _isToMe(to: string | Set<string>, sending?: boolean) {
    if (!to) return false;
    if (typeof to === 'string') {
      // to "All Except [id]" is given as "-[id]", so if it's not me and I'm not sending, return true
      if (to[0] === '-') return to.slice(1) !== this._id && !sending;
      // If we're receiving a message to Others, it is to us, but if we're sending a message to Others, it's not to us
      return (to === To.Leader && this._isLeader) || to === this._id || to === To.All || (to === To.Others && !sending);
    }
    return to.has(this._id);
  }

  _createChannel() {
    this._channel = new BroadcastChannel(`tab-${this._name}`);
    this._channel.onmessage = e => this._onMessage(e);
  }

  _postMessage(to: string | Set<string>, name: string, ...rest: any[]) {
    // Don't send if there's no one to send to
    if (!to || to instanceof Set && !to.size) return;
    const data = { to, name, rest };
    try {
      this._channel.postMessage(data);
      if (this._isToMe(to, true)) {
        this._onMessage(new MessageEvent('message', { data }));
      }
    } catch (e) {
      // If the channel is closed, create a new one and try again
      if (e.name === 'InvalidStateError') {
        this._createChannel();
        this._postMessage(to, name, ...rest);
      }
    }
  }

  _onMessage(event: MessageEvent) {
    const { to, name, rest } = event.data as { to: Set<string>; name: string; rest: any[] };
    if (!this._isToMe(to)) return;
    if (name === 'onCall') this._onCall.apply(this, rest);
    else if (name === 'callReceived') this._callReceived.apply(this, rest);
    else if (name === 'onReturn') this._onReturn.apply(this, rest);
    else if (name === 'onState') this._onState.apply(this, rest);
    else if (name === 'onSend') this._onSend.apply(this, rest);
    else if (name === 'onSendState') this._onSendState.apply(this, rest);
    else if (name === 'onLeader') this._onLeader.apply(this, rest);
    else console.error('Unknown message', name, rest);
  }

  async _onCall(id: string, callNumber: number, name: string, ...rest: any[]) {
    if (!this.isLeader) return;
    this._postMessage(id, 'callReceived', callNumber);
    if (!this._isLeaderReady) {
      this._queuedCalls.set(callNumber, { id, name, rest });
      return;
    }
    try {
      if (typeof this._api?.[name] !== 'function') throw new Error(`Invalid API method "${name}"`);
      this._callerId = id;
      const promise = this._api[name](...rest);
      this._callerId = undefined;
      const results = await promise;
      this._postMessage(id, 'onReturn', callNumber, null, results);
    } catch (e) {
      this._callerId = undefined;
      this._postMessage(id, 'onReturn', callNumber, e);
    }
  }

  _callReceived(callNumber: number) {
    const t = this._sentCalls.get(callNumber);
    if (t) {
      clearTimeout(t);
      this._sentCalls.delete(callNumber);
    }
  }

  _onReturn(callNumber: number, error: any, results: any) {
    if (this._sentCalls.get(callNumber)) this._callReceived(callNumber);
    const deferred = this._callDeferreds.get(callNumber);
    if (!deferred) return console.error('No deferred found for call', callNumber);
    clearTimeout(deferred.timeout);
    this._callDeferreds.delete(callNumber);
    if (error) deferred.reject(error);
    else deferred.resolve(results);
  }

  _onState(data: T) {
    this._state = data;
    this.dispatchEvent(new MessageEvent('state', { data }));
  }

  _onSend(data: any) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  _onSendState(id: string) {
    if (this.isLeader) {
      this._postMessage(id, 'onState', this._state);
    }
  }

  _onLeader(state: T) {
    this._onState(state);
    this._queuedCalls.forEach(({ id, name, rest }, callNumber) =>
      this._postMessage(To.Leader, 'onCall', id, callNumber, name, ...rest)
    );
    this._queuedCalls.clear();
  }
}

const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function createTabId() {
  let id = '';
  let length = 16;
  while (length--) {
    id += chars[(Math.random() * chars.length) | 0];
  }
  return id;
}
