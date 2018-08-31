'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var chars = (
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
).split('');

function createNodeId() {
  var id = '';
  var length = 6;
  while (length--) {
    id += chars[Math.random() * chars.length | 0];
  }
  return id;
}

var VOTE_PERIOD = 500;
var HEARTBEAT = 500;
var ELECTION_MIN = 2000; // when not visible in browsers heartbeat is slowed down to 1000 ms, keep above this
var ELECTION_MAX = 3000;

var STATE_FOLLOWER = 'follower';
var STATE_CANDIDATE = 'candidate';
var STATE_LEADER = 'leader';
var STATE_CLOSED = 'closed';


/**
 * Create an elector, listen in the callback provided in waitForLeadership() to know when this becomes the leader. Call
 * close() to disconnect. Ignore the other methods, they are not for you. This started off using raft but because of
 * the environment was simplified. setTimeout/setInterval are throttled to 1000ms in most browsers when the tab is not
 * the focus. Also they all share localStorage which is needed to trigger updates anyway, so we use that instead of
 * proper voting. It works great! Just don't lower the numbers above without testing because the throttling will
 * make multiple leaders become elected with lower numbers, even when voting was in place.
 */
var LeaderElector = function LeaderElector(name) {
  this.name = name;
  this.state = STATE_CLOSED;
  this.nodeId = createNodeId();
  this.timeout = 0;
  this.callback = null;
  this.close = this.close.bind(this);
};

/**
 * Wait until this tab becomes the leader, then do something about it. Once the leader, it will remain the leader
 * until closed. The first tab open will almost immediately become the leader (within 100 ms).
 * @return {LeaderElector} A reference to itself.
 */
LeaderElector.prototype.waitForLeadership = function waitForLeadership (callback) {
  this.callback = callback;
  this.becomeFollower();
  return this;
};

/**
 * Close this leader elector. To restart it, you must call waitForLeadership again.
 */
LeaderElector.prototype.close = function close () {
  clearTimeout(this.timeout);
  window.removeEventListener('unload', this.close);
  if (this.state === STATE_LEADER) {
    var leader = getLeaderInfo(this.name);
    if (leader && leader.nodeId === this.nodeId) {
      clearLeaderInfo(this.name);
    }
  }
  this.state = STATE_CLOSED;
};


LeaderElector.prototype.hasLeader = function hasLeader () {
  var leader = getLeaderInfo(this.name);
  return leader && Date.now() - leader.timestamp < ELECTION_MIN;
};

LeaderElector.prototype.becomeFollower = function becomeFollower () {
    var this$1 = this;

  this.state = STATE_FOLLOWER;
  clearTimeout(this.timeout);

  var checkLeadership = function () {
    // If no leader or the leader is long gone, immediately take leadership
    if (!this$1.hasLeader()) { return this$1.becomeCandidate(); }
    var interval = Math.round(ELECTION_MAX - ELECTION_MIN * Math.random()) + ELECTION_MIN;
    this$1.timeout = setTimeout(checkLeadership, interval);
  };

  checkLeadership();
};

LeaderElector.prototype.becomeCandidate = function becomeCandidate () {
    var this$1 = this;

  this.state = STATE_CANDIDATE;
  clearTimeout(this.timeout);

  setLeaderInfo(this.name, this.nodeId);
  this.timeout = setTimeout(function () {
    // last one wins
    var leader = getLeaderInfo(this$1.name);
    if (leader.nodeId === this$1.nodeId) {
      this$1.becomeLeader();
    } else {
      this$1.becomeFollower();
    }
  }, VOTE_PERIOD);
};

LeaderElector.prototype.becomeLeader = function becomeLeader () {
    var this$1 = this;

  this.state = STATE_LEADER;
  clearTimeout(this.timeout);

  var heartbeat = function () {
    setLeaderInfo(this$1.name, this$1.nodeId);
    this$1.timeout = setTimeout(heartbeat, HEARTBEAT);
  };
  heartbeat();
  window.addEventListener('unload', this.close);
  this.callback();
};

function getLeaderInfo(name) {
  try {
    return JSON.parse(localStorage.getItem(("tab-leader:" + name)));
  } catch(err) {
    return null;
  }
}

function setLeaderInfo(name, nodeId) {
  localStorage.setItem(("tab-leader:" + name), JSON.stringify({ nodeId: nodeId, timestamp: Date.now() }));
}

function clearLeaderInfo(name) {
  localStorage.removeItem(("tab-leader:" + name));
}

var METADATA_HEARTBEAT = 500;
var METADATA_MAX = 2000;

/**
 * Create a metadata consumer to set metadata for this tab and get the metadata from other tabs. Call subscribe() to
 * start listening and close() to disconnect.
 */
var Metadata = function Metadata(name) {
  this.name = name;
  this.nodeId = createNodeId();
  this.timeout = 0;
  this.callback = null;
  this.close = this.close.bind(this);
  this.version = 0;
  this.source = {};
  this.metadata = {};
  this.data = {};
  this.subscribers = [];

  this.watchMetadata();
  this.set(this.data);
  window.addEventListener('unload', this.close);
};

/**
 * Subscribe to changes in the node metadata.
 * @param{Function} callback A function that is called whenever node metadata is changed on any node.
 * @return {Function} A function to cancel the subscription.
 */
Metadata.prototype.subscribe = function subscribe (callback) {
  this.subscribers.push(callback);
  return function cancel() {
    var index = this.subscribers.indexOf(callback);
    if (index >= 0) { this.subscribers.splice(index, 1); }
  };
};

/**
 * Sets the metadata for this node.
 * @param{Object} metadata The metadata for this node.
 * @return {Metadata} A reference to itself.
 */
Metadata.prototype.set = function set (data) {
    var this$1 = this;
    var obj;

  this.data = Object.assign(this.data, data);
  var metadata = getMetadata$1(this.name);
  var thisNode = metadata[this.nodeId] || (metadata[this.nodeId] = {});
  thisNode.timestamp = Date.now();
  thisNode.version = this.version++;
  thisNode.data = this.data;
  setMetadata(this.name, metadata);

  // Send updates locally immediately
  this.source = metadata;
  this.metadata[this.nodeId] = this.data;
  this.subscribers.forEach(function (fn) { return fn.call(this$1, this$1.metadata, ( obj = {}, obj[this$1.nodeId] = this$1.data, obj)); });

  return this;
};

/**
 * Close this leader elector. To restart it, you must call waitForLeadership again.
 */
Metadata.prototype.close = function close () {
  clearTimeout(this.timeout);
  window.removeEventListener('unload', this.close);
  var metadata = getMetadata$1(this.name);
  delete metadata[this.nodeId];
  setMetadata(this.name, metadata);
};


Metadata.prototype.watchMetadata = function watchMetadata () {
    var this$1 = this;


  var heartbeat = function () {
    var metadata = getMetadata$1(this$1.name);
    var now = Date.now();
    var changed = {};

    // Look for changes and clean up old nodes
    Object.keys(metadata).forEach(function (nodeId) {
      var entry = metadata[nodeId];
      if (now - entry.timestamp > METADATA_MAX) {
        changed[nodeId] = null;
        delete metadata[nodeId];
      } else {
        if (!this$1.source[nodeId] || this$1.source[nodeId].version < entry.version) {
          changed[nodeId] = entry.data;
        }
      }
    });

    // Update our timestamp
    var thisNode = metadata[this$1.nodeId] || (metadata[this$1.nodeId] = {
      timestamp: 0,
      version: this$1.version,
      data: {}
    });
    thisNode.timestamp = Date.now();
    setMetadata(this$1.name, metadata);

    // Dispatch update if there was one
    if (Object.keys(changed).length) {
      this$1.source = metadata;
      this$1.metadata = {};
      Object.keys(metadata).forEach(function (nodeId) { return this$1.metadata[nodeId] = metadata[nodeId].data; });
      this$1.subscribers.forEach(function (fn) { return fn.call(this$1, this$1.metadata, changed); });
    }

    this$1.timeout = setTimeout(heartbeat, METADATA_HEARTBEAT);
  };

  heartbeat();
};

function getMetadata$1(name) {
  return JSON.parse(localStorage.getItem(("tab-metadata:" + name)) || '{}');
}

function setMetadata(name, metadata) {
  localStorage.setItem(("tab-metadata:" + name), JSON.stringify(metadata));
}

// Shortcut, returns the elector that you can later close, and calls the callback once this tab becomes the leader.
function waitForLeadership(name, callback) {
  if (typeof name === 'function') {
    callback = name;
    name = 'default';
  }
  var elector = new LeaderElector(name);
  return elector.waitForLeadership(callback);
}

// Shortcut, returns the TabMetadata that you can set metadata and later close, and calls the callback whenever tab
// metadata changes.
function getMetadata(name, callback) {
  if (typeof name === 'function') {
    callback = name;
    name = 'default';
  }
  var metadata = new Metadata(name);
  metadata.subscribe(callback);
  return metadata;
}

exports.LeaderElector = LeaderElector;
exports.waitForLeadership = waitForLeadership;
exports.getMetadata = getMetadata;
//# sourceMappingURL=index.js.map
