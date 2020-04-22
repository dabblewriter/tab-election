// Inspired by https://github.com/tejacques/crosstab/blob/master/src/crosstab.js Copyright 2015 Tom Jacques
// Copyright 2018 Jacob Wright

// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
const HEARTBEAT_INTERVAL = 500;
const TAB_TIMEOUT = 5 * 1000;
const PING_TIMEOUT = 50;
const BAD_TIMESTAMP_MARGIN = 30 * 1000;

const CLOSE = 'tabClose';
const UPDATE = 'tabUpdate';
const PROMOTE = 'tabPromoted';
const PING = 'ping';
const PONG = 'pong';
const MESSAGE_KEY = 'election-message';
const TABS_KEY = 'election-tabs';
const LEADER_KEY = 'election-leader';


export default class Tab {

  constructor(name) {
    this.id = createTabId();
    this.name = name;
    this.tab = { id: this.id };

    this._messageKey = this.name + '-' + MESSAGE_KEY;
    this._tabsKey = this.name + '-' + TABS_KEY;
    this._leaderKey = this.name + '-' + LEADER_KEY;
    this._leaderId = localStorage.getItem(this._leaderKey) || null;
    this._tabs = parse(localStorage.getItem(this._tabsKey), {});
    this._tabs[this.id] = this.tab;
    this._events = {};
    this._messageIds = {};

    this._onStorage = this._onStorage.bind(this);
    this.close = this.close.bind(this);

    window.addEventListener('storage', this._onStorage);
    window.addEventListener('beforeunload', this.close);
    this.on(PING, this._onPing);
    this.on(PONG, this._onPong);
    this.on(UPDATE, this._onTabUpdate);
    this.on(CLOSE, this._onTabClose);
    this.on(PROMOTE, this._onTabPromote);

    this._sendHeartbeat();
  }

  close() {
    window.removeEventListener('storage', this._onStorage);
    window.removeEventListener('beforeunload', this.close);
    clearTimeout(this._heartbeatTimeout);

    if (Object.keys(this._tabs).length === 1) {
      localStorage.setItem(this._tabsKey, '{}');
    } else {
      this.postMessage(CLOSE, this.id);
    }
  }

  isLeader() {
    return this._leaderId === this.id;
  }

  waitForLeadership(fn) {
    if (this.isLeader()) fn.call(this);
    else this.once('promote', () => fn.call(this));
  }

  on(type, listener) {
    this._events[type] = getEventListeners(this, type).concat([listener]);
  }

  once(type, listener) {
    this.on(type, function wrap() {
      this.off(type, wrap);
      listener.apply(this, arguments);
    });
  }

  off(type, listener) {
    this._events[type] = getEventListeners(this, type).filter(l => l !== listener);
  }

  set(data) {
    this.tab = Object.assign({}, this.tab, data, { id: this.id, lastUpdated: Date.now() });
    this.postMessage(UPDATE, this.tab);
  }

  get() {
    return this._tabs[this.id];
  }

  getLeader() {
    return this._tabs[this._leaderId];
  }

  getAll() {
    return this._tabs;
  }

  emit(type, data) {
    getEventListeners(this, type).forEach(listener => listener.call(this, data));
  }

  postMessage(name, data, to) {
    const id = createTabId(); // Fix Safari dispatching event to own tab (we do that)
    this._messageIds[id] = true;
    setTimeout(() => delete this._messageIds[id], 2000);
    const newValue = stringify({ id, name, data, from: this.id, to, timestamp: Date.now() });
    const localValue = stringify({ name, data, from: this.id, to, timestamp: Date.now() });
    const oldValue = localStorage.getItem(this._messageKey);
    localStorage.setItem(this._messageKey, newValue);
    const event = new Event('storage');
    event.storageArea = localStorage;
    event.key = this._messageKey;
    event.oldValue = oldValue;
    event.newValue = localValue;
    window.dispatchEvent(event);
    localStorage.removeItem(this._messageKey);
  }

  _sendHeartbeat() {
    const now = Date.now();
    clearTimeout(this._heartbeatTimeout);
    const tabSlow = Object.keys(this._tabs).length / 2;
    const nextInterval = HEARTBEAT_INTERVAL + Math.round(Math.random() * HEARTBEAT_INTERVAL * tabSlow);
    this._heartbeatTimeout = setTimeout(() => this._sendHeartbeat(), nextInterval);

    if (!this._tabs[this._leaderId]) {
      this._runElection();
    }

    this.tab.lastUpdated = now;
    this.postMessage(PING, this.tab);

    Object.values(this._tabs).forEach(n => {
      // If a tab is old (or an old record with a future date is stuck in localStorage), close it
      if (now - n.lastUpdated > TAB_TIMEOUT || n.lastUpdated - now > BAD_TIMESTAMP_MARGIN) {
        this.postMessage(CLOSE, n.id);
      }
    });
  }

  _onPing(message) {
    if (Date.now() - message.timestamp > PING_TIMEOUT) return;
    const isNew = !this._tabs[message.data.id];
    this._tabs[message.data.id] = message.data;

    // wait for all the pongs before storing state
    setTimeout(() => {
      if (!this._tabs[this._leaderId]) {
        this._runElection();
      } else if (this.isLeader()) {
        this._storeState();
      }
    }, PING_TIMEOUT);

    if (message.from !== this.id) {
      this.tab.lastUpdated = Date.now();
      this.postMessage(PONG, this.tab);
      if (isNew) this.emit('change', this.getAll());
    }
  }

  _onPong(message) {
    if (Date.now() - message.timestamp > PING_TIMEOUT) return;
    const isNew = !this._tabs[message.data.id];
    this._tabs[message.data.id] = message.data;
    if (isNew) this.emit('change', this.getAll());
  }

  _runElection() {
    const maxId = Object.keys(this._tabs).sort().pop();

    // if we think we should be the leader, set the key and send a message
    if (this.id === maxId) {
      localStorage.setItem(this._leaderKey, this.id);
      this.postMessage(PROMOTE);
    }

    // Allow for race conditions and take the last value in localStorage as authoritative
    setTimeout(() => {
      // Nobody has taken leadership from us
      this._leaderId = localStorage.getItem(this._leaderKey);
      if (this.isLeader()) {
        this.emit('promote');
      }
    }, PING_TIMEOUT);
  }

  _onTabUpdate(message) {
    this._tabs[message.data.id] = message.data;

    if (this.isLeader()) {
      this._storeState();
    }

    this.emit('change', this.getAll());
  }

  _onTabClose(message) {
    const id = message.data;
    delete this._tabs[id];
    if (!this._leaderId || this._leaderId === id) {
      this._runElection();
    } else if (this.isLeader()) {
      this._storeState();
    }
    this.emit('change', this.getAll());
  }

  _onTabPromote() {
    this._leaderId = localStorage.getItem(this._leaderKey);
  }

  _storeState() {
    localStorage.setItem(this._tabsKey, stringify(this._tabs));
  }

  _onStorage(event) {
    if (event.storageArea !== localStorage) return;
    if (!event.newValue) return;
    if (event.key !== this._messageKey) return;

    const message = parse(event.newValue);
    if (!message || message.to && message.to !== this.id || this._messageIds[message.id]) return;
    this.emit(message.name, message);
  }
}

function parse(value, defaultValue) {
  try { return JSON.parse(value) || defaultValue; } catch(e) { return defaultValue; }
}

function stringify(value) {
  return JSON.stringify(value);
}

function getEventListeners(obj, type) {
  return obj._events[type] || (obj._events[type] = []);
}

const chars = (
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
).split('');

function createTabId() {
  let id = '';
  let length = 8;
  while (length--) {
    id += chars[Math.random() * chars.length | 0];
  }
  return id;
}
