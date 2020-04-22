'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

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
var HEARTBEAT_INTERVAL = 500;
var TAB_TIMEOUT = 5 * 1000;
var PING_TIMEOUT = 50;
var BAD_TIMESTAMP_MARGIN = 30 * 1000;

var CLOSE = 'tabClose';
var UPDATE = 'tabUpdate';
var PROMOTE = 'tabPromoted';
var PING = 'ping';
var PONG = 'pong';
var MESSAGE_KEY = 'election-message';
var TABS_KEY = 'election-tabs';
var LEADER_KEY = 'election-leader';


var Tab = function Tab(name) {
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
};

Tab.prototype.close = function close () {
  window.removeEventListener('storage', this._onStorage);
  window.removeEventListener('beforeunload', this.close);
  clearTimeout(this._heartbeatTimeout);

  if (Object.keys(this._tabs).length === 1) {
    localStorage.setItem(this._tabsKey, '{}');
  } else {
    this.postMessage(CLOSE, this.id);
  }
};

Tab.prototype.isLeader = function isLeader () {
  return this._leaderId === this.id;
};

Tab.prototype.waitForLeadership = function waitForLeadership (fn) {
    var this$1 = this;

  if (this.isLeader()) { fn.call(this); }
  else { this.once('promote', function () { return fn.call(this$1); }); }
};

Tab.prototype.on = function on (type, listener) {
  this._events[type] = getEventListeners(this, type).concat([listener]);
};

Tab.prototype.once = function once (type, listener) {
  this.on(type, function wrap() {
    this.off(type, wrap);
    listener.apply(this, arguments);
  });
};

Tab.prototype.off = function off (type, listener) {
  this._events[type] = getEventListeners(this, type).filter(function (l) { return l !== listener; });
};

Tab.prototype.set = function set (data) {
  this.tab = Object.assign({}, this.tab, data, { id: this.id, lastUpdated: Date.now() });
  this.postMessage(UPDATE, this.tab);
};

Tab.prototype.get = function get () {
  return this._tabs[this.id];
};

Tab.prototype.getLeader = function getLeader () {
  return this._tabs[this._leaderId];
};

Tab.prototype.getAll = function getAll () {
  return this._tabs;
};

Tab.prototype.emit = function emit (type, data) {
    var this$1 = this;

  getEventListeners(this, type).forEach(function (listener) { return listener.call(this$1, data); });
};

Tab.prototype.postMessage = function postMessage (name, data, to) {
    var this$1 = this;

  var id = createTabId(); // Fix Safari dispatching event to own tab (we do that)
  this._messageIds[id] = true;
  setTimeout(function () { return delete this$1._messageIds[id]; }, 2000);
  var newValue = stringify({ id: id, name: name, data: data, from: this.id, to: to, timestamp: Date.now() });
  var localValue = stringify({ name: name, data: data, from: this.id, to: to, timestamp: Date.now() });
  var oldValue = localStorage.getItem(this._messageKey);
  localStorage.setItem(this._messageKey, newValue);
  var event = new Event('storage');
  event.storageArea = localStorage;
  event.key = this._messageKey;
  event.oldValue = oldValue;
  event.newValue = localValue;
  window.dispatchEvent(event);
  localStorage.removeItem(this._messageKey);
};

Tab.prototype._sendHeartbeat = function _sendHeartbeat () {
    var this$1 = this;

  var now = Date.now();
  clearTimeout(this._heartbeatTimeout);
  var tabSlow = Object.keys(this._tabs).length / 2;
  var nextInterval = HEARTBEAT_INTERVAL + Math.round(Math.random() * HEARTBEAT_INTERVAL * tabSlow);
  this._heartbeatTimeout = setTimeout(function () { return this$1._sendHeartbeat(); }, nextInterval);

  if (!this._tabs[this._leaderId]) {
    this._runElection();
  }

  this.tab.lastUpdated = now;
  this.postMessage(PING, this.tab);

  Object.values(this._tabs).forEach(function (n) {
    // If a tab is old (or an old record with a future date is stuck in localStorage), close it
    if (now - n.lastUpdated > TAB_TIMEOUT || n.lastUpdated - now > BAD_TIMESTAMP_MARGIN) {
      this$1.postMessage(CLOSE, n.id);
    }
  });
};

Tab.prototype._onPing = function _onPing (message) {
    var this$1 = this;

  if (Date.now() - message.timestamp > PING_TIMEOUT) { return; }
  var isNew = !this._tabs[message.data.id];
  this._tabs[message.data.id] = message.data;

  // wait for all the pongs before storing state
  setTimeout(function () {
    if (!this$1._tabs[this$1._leaderId]) {
      this$1._runElection();
    } else if (this$1.isLeader()) {
      this$1._storeState();
    }
  }, PING_TIMEOUT);

  if (message.from !== this.id) {
    this.tab.lastUpdated = Date.now();
    this.postMessage(PONG, this.tab);
    if (isNew) { this.emit('change', this.getAll()); }
  }
};

Tab.prototype._onPong = function _onPong (message) {
  if (Date.now() - message.timestamp > PING_TIMEOUT) { return; }
  var isNew = !this._tabs[message.data.id];
  this._tabs[message.data.id] = message.data;
  if (isNew) { this.emit('change', this.getAll()); }
};

Tab.prototype._runElection = function _runElection () {
    var this$1 = this;

  var maxId = Object.keys(this._tabs).sort().pop();

  // if we think we should be the leader, set the key and send a message
  if (this.id === maxId) {
    localStorage.setItem(this._leaderKey, this.id);
    this.postMessage(PROMOTE);
  }

  // Allow for race conditions and take the last value in localStorage as authoritative
  setTimeout(function () {
    // Nobody has taken leadership from us
    this$1._leaderId = localStorage.getItem(this$1._leaderKey);
    if (this$1.isLeader()) {
      this$1.emit('promote');
    }
  }, PING_TIMEOUT);
};

Tab.prototype._onTabUpdate = function _onTabUpdate (message) {
  this._tabs[message.data.id] = message.data;

  if (this.isLeader()) {
    this._storeState();
  }

  this.emit('change', this.getAll());
};

Tab.prototype._onTabClose = function _onTabClose (message) {
  var id = message.data;
  delete this._tabs[id];
  if (!this._leaderId || this._leaderId === id) {
    this._runElection();
  } else if (this.isLeader()) {
    this._storeState();
  }
  this.emit('change', this.getAll());
};

Tab.prototype._onTabPromote = function _onTabPromote () {
  this._leaderId = localStorage.getItem(this._leaderKey);
};

Tab.prototype._storeState = function _storeState () {
  localStorage.setItem(this._tabsKey, stringify(this._tabs));
};

Tab.prototype._onStorage = function _onStorage (event) {
  if (event.storageArea !== localStorage) { return; }
  if (!event.newValue) { return; }
  if (event.key !== this._messageKey) { return; }

  var message = parse(event.newValue);
  if (!message || message.to && message.to !== this.id || this._messageIds[message.id]) { return; }
  this.emit(message.name, message);
};

function parse(value, defaultValue) {
  try { return JSON.parse(value) || defaultValue; } catch(e) { return defaultValue; }
}

function stringify(value) {
  return JSON.stringify(value);
}

function getEventListeners(obj, type) {
  return obj._events[type] || (obj._events[type] = []);
}

var chars = (
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
).split('');

function createTabId() {
  var id = '';
  var length = 8;
  while (length--) {
    id += chars[Math.random() * chars.length | 0];
  }
  return id;
}

// Shortcut, returns the elector that you can later close, and calls the callback once this tab becomes the leader.
function waitForLeadership(name, callback) {
  if (typeof name === 'function') {
    callback = name;
    name = 'default';
  }
  var tab = new Tab(name);
  tab.waitForLeadership(callback);
  return tab;
}

exports.Tab = Tab;
exports.waitForLeadership = waitForLeadership;
