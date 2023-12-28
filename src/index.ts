
export type OnLeadership = (relinquish: Unsubscribe) => any;
export type Unsubscribe = () => void;
export type OnReceive = (msg: any) => void;
export type OnState<T> = (state: T) => void;

interface Deferred {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: number;
}

const DONT_RECEIVE = {};

/**
 * A Tab is an interfaces to synchronize state and messages between tabs. It uses BroadcastChannel and the Lock API.
 * This is a simplified version of the original implementation.
 */
export class Tab<T = Record<string, any>> extends EventTarget {
  relinquishLeadership = () => {};

  #name: string;
  #id: string;
  #callDeferreds = new Map<number, Deferred>();
  #queuedCalls = new Map<number, { id: string, name: string; rest: any[] }>();
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
      if (hasLeader) this.#postMessage('onSendState', this.#id, DONT_RECEIVE);
    });
  }

  get isLeader() {
    return this.#isLeader;
  }

  async hasLeader() {
    return navigator.locks.request(`tab-${this.#name}`, { ifAvailable: true }, async lock => lock === null);
  }

  getState() {
    return this.#state;
  }
  setState(state: T) {
    if (!this.isLeader) throw new Error('Only the leader can set state');
    this.#onState(state);
    this.#postMessage('onState', state, DONT_RECEIVE);
  }

  async waitForLeadership(onLeadership: OnLeadership): Promise<void> {
    this.relinquishLeadership(); // Cancel any previous leadership requests

    try {
      return await navigator.locks.request(`tab-${this.#name}`, async lock => {
        this.#isLeader = true;
        this.#api = await onLeadership(this.relinquishLeadership);
        this.#isLeaderReady = true;
        this.#queuedCalls.forEach(({ id, name, rest }, callNumber) => this.#onCall(id, callNumber, name, ...rest));
        this.#queuedCalls.clear();
        this.dispatchEvent(new Event('leadershipchange'));
        this.#postMessage('onLeader', this.#state, DONT_RECEIVE);
        return new Promise<void>(resolve => this.relinquishLeadership = () => resolve()); // Never resolve
      });
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
      } else if (!this.isLeader && await this.hasLeader()) {
        this.#postMessage('onCall', this.#id, callNumber, name, ...rest, DONT_RECEIVE);
      } else {
        this.#queuedCalls.set(callNumber, { id: this.#id, name, rest });
      }
    });
  }

  send(data: any): void {
    this.#postMessage('onSend', data, DONT_RECEIVE);
  }

  close(): void {
    this.relinquishLeadership();
    this.#isLeader = false;
    this.#channel.close();
    this.#channel.onmessage = null;
  }

  #createChannel() {
    this.#channel = new BroadcastChannel(`tab-${this.#name}`);
    this.#channel.onmessage = e => this.#onMessage(e);
  }

  #postMessage(name: string, ...rest: any[]) {
    const sendSelf = rest[rest.length - 1] !== DONT_RECEIVE;
    if (!sendSelf) rest.pop();
    const data = { name, rest };
    try {
      this.#channel.postMessage(data);
      if (sendSelf) this.dispatchEvent(new MessageEvent('message', { data }));
    } catch (e) {
      // If the channel is closed, create a new one and try again
      if (e.name === 'InvalidStateError') {
        this.#createChannel();
        this.#postMessage(name, ...rest);
      }
    }
  }

  #onMessage(event: MessageEvent) {
    const { name, rest } = event.data as { name: string; rest: any[] };
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
      const results = await this.#api[name](...rest);
      this.#postMessage('onReturn', id, callNumber, null, results);
    } catch (e) {
      this.#postMessage('onReturn', id, callNumber, e);
    }
  }

  #onReturn(forTab: string, callNumber: number, error: any, results: any) {
    if (this.#id !== forTab) return;
    const deferred = this.#callDeferreds.get(callNumber);
    if (!deferred) return console.error('No deferred found for call', callNumber);
    clearTimeout(deferred.timeout);
    this.#callDeferreds.delete(callNumber);
    if (error) deferred.reject(error);
    else deferred.resolve(results);
  }

  #onState(data: T, id?: string) {
    if (id && id !== this.#id) return;
    this.#state = data;
    this.dispatchEvent(new MessageEvent('state', { data }));
  }

  #onSend(data: any) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  #onSendState(id: string) {
    if (this.isLeader) {
      this.#postMessage('onState', this.#state, id, DONT_RECEIVE);
    }
  }

  #onLeader(state: T) {
    this.#onState(state);
    this.#queuedCalls.forEach(({ id, name, rest }, callNumber) =>
      this.#postMessage('onCall', id, callNumber, name, ...rest)
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
