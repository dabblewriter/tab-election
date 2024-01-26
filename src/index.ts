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

  #name: string;
  #id: string;
  #callerId: string;
  #callDeferreds = new Map<number, Deferred>();
  #queuedCalls = new Map<number, { id: string; name: string; rest: any[] }>();
  #channel: BroadcastChannel;
  #isLeader = false;
  #isLeaderReady = false;
  #state: T;
  #callCount = 0;
  #api: any;

  constructor(name = 'default') {
    super();
    this.#name = name;
    this.#id = createTabId();
    this.#state = {} as T;
    this.#createChannel();
    this.hasLeader().then(hasLeader => {
      if (hasLeader) this.#postMessage(To.Leader, 'onSendState', this.#id);
    });
  }

  get id() {
    return this.#id;
  }

  get name() {
    return this.#name;
  }

  get isLeader() {
    return this.#isLeader;
  }

  async hasLeader() {
    return navigator.locks.request(`tab-${this.#name}`, { ifAvailable: true }, async lock => lock === null);
  }

  getCurrentCallerId() {
    return this.#callerId;
  }

  getState() {
    return this.#state;
  }
  setState(state: T) {
    if (!this.isLeader) throw new Error('Only the leader can set state');
    this.#onState(state);
    this.#postMessage(To.Others, 'onState', state);
  }

  async waitForLeadership(onLeadership: OnLeadership): Promise<boolean> {
    this.relinquishLeadership(); // Cancel any previous leadership requests
    const abortController = new AbortController();
    const { signal } = abortController;
    this.relinquishLeadership = () => abortController.abort('Aborted');

    try {
      // The signal will cancel the lock request before a lock is attained, the promise.resolve will cancel it after
      return await navigator.locks.request(`tab-${this.#name}`, { signal }, async lock => {
        this.#isLeader = true;
        // Never resolve until relinquishLeadership is called
        const keepLockPromise = new Promise<boolean>(resolve => (this.relinquishLeadership = () => resolve(true)));
        this.#api = await onLeadership(this.relinquishLeadership);
        this.#isLeaderReady = true;
        this.#queuedCalls.forEach(({ id, name, rest }, callNumber) => this.#onCall(id, callNumber, name, ...rest));
        this.#queuedCalls.clear();
        this.dispatchEvent(new Event('leadershipchange'));
        this.#postMessage(To.Others, 'onLeader', this.#state);
        return keepLockPromise;
      }).catch(e => e !== 'Aborted' && Promise.reject(e) || false);
    } finally {
      this.#isLeader = false;
      this.#api = null;
      this.dispatchEvent(new Event('leadershipchange'));
    }
  }

  call<R>(name: string, ...rest: any[]): Promise<R> {
    const callNumber = ++this.#callCount;
    return new Promise<R>(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#callDeferreds.delete(callNumber);
        reject(new Error('Call timed out'));
      }, 30_000);
      this.#callDeferreds.set(callNumber, { resolve, reject, timeout });
      if (this.isLeader && this.#isLeaderReady) {
        this.#onCall(this.#id, callNumber, name, ...rest);
      } else if (!this.isLeader && (await this.hasLeader())) {
        this.#postMessage(To.Leader, 'onCall', this.#id, callNumber, name, ...rest);
      } else {
        this.#queuedCalls.set(callNumber, { id: this.#id, name, rest });
      }
    });
  }

  send(data: any, to: string | Set<string> = To.Others): void {
    this.#postMessage(to, 'onSend', data);
  }

  close(): void {
    this.relinquishLeadership();
    this.#isLeader = false;
    this.#channel.close();
    this.#channel.onmessage = null;
  }

  #isToMe(to: string | Set<string>) {
    if (typeof to === 'string') {
      return (to === To.Leader && this.#isLeader) || to === this.#id || to === To.All || to === To.Others;
    }
    return to.has(this.#id);
  }

  #createChannel() {
    this.#channel = new BroadcastChannel(`tab-${this.#name}`);
    this.#channel.onmessage = e => this.#onMessage(e);
  }

  #postMessage(to: string | Set<string>, name: string, ...rest: any[]) {
    // Don't send if there's no one to send to
    if (!to || to instanceof Set && !to.size) return;
    const data = { to, name, rest };
    const toMe = to !== To.Others && this.#isToMe(to);
    try {
      this.#channel.postMessage(data);
      if (toMe) {
        this.#onMessage(new MessageEvent('message', { data }));
      }
    } catch (e) {
      // If the channel is closed, create a new one and try again
      if (e.name === 'InvalidStateError') {
        this.#createChannel();
        this.#postMessage(to, name, ...rest);
      }
    }
  }

  #onMessage(event: MessageEvent) {
    const { to, name, rest } = event.data as { to: Set<string>; name: string; rest: any[] };
    if (!this.#isToMe(to)) return;
    if (name === 'onCall') this.#onCall.apply(this, rest);
    else if (name === 'onReturn') this.#onReturn.apply(this, rest);
    else if (name === 'onState') this.#onState.apply(this, rest);
    else if (name === 'onSend') this.#onSend.apply(this, rest);
    else if (name === 'onSendState') this.#onSendState.apply(this, rest);
    else if (name === 'onLeader') this.#onLeader.apply(this, rest);
    else console.error('Unknown message', name, rest);
  }

  async #onCall(id: string, callNumber: number, name: string, ...rest: any[]) {
    if (!this.isLeader) return;
    if (!this.#isLeaderReady) {
      this.#queuedCalls.set(callNumber, { id, name, rest });
      return;
    }
    try {
      if (typeof this.#api?.[name] !== 'function') throw new Error(`Invalid API method "${name}"`);
      this.#callerId = id;
      const promise = this.#api[name](...rest);
      this.#callerId = undefined;
      const results = await promise;
      this.#postMessage(id, 'onReturn', callNumber, null, results);
    } catch (e) {
      this.#callerId = undefined;
      this.#postMessage(id, 'onReturn', callNumber, e);
    }
  }

  #onReturn(callNumber: number, error: any, results: any) {
    const deferred = this.#callDeferreds.get(callNumber);
    if (!deferred) return console.error('No deferred found for call', callNumber);
    clearTimeout(deferred.timeout);
    this.#callDeferreds.delete(callNumber);
    if (error) deferred.reject(error);
    else deferred.resolve(results);
  }

  #onState(data: T) {
    this.#state = data;
    this.dispatchEvent(new MessageEvent('state', { data }));
  }

  #onSend(data: any) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  #onSendState(id: string) {
    if (this.isLeader) {
      this.#postMessage(id, 'onState', this.#state);
    }
  }

  #onLeader(state: T) {
    this.#onState(state);
    this.#queuedCalls.forEach(({ id, name, rest }, callNumber) =>
      this.#postMessage(To.Leader, 'onCall', callNumber, name, ...rest)
    );
    this.#queuedCalls.clear();
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
