'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

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
    return JSON.parse(localStorage.getItem(("leader:" + name)));
  } catch(err) {
    return null;
  }
}

function setLeaderInfo(name, nodeId) {
  localStorage.setItem(("leader:" + name), JSON.stringify({ nodeId: nodeId, timestamp: Date.now() }));
}

function clearLeaderInfo(name) {
  localStorage.removeItem(("leader:" + name));
}

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

// Shortcut, returns the elector that you can later close, and calls the callback once this tab becomes the leader.
function waitForLeadership(name, callback) {
  if (typeof name === 'function') {
    callback = name;
    name = 'default';
  }
  var elector = new LeaderElector(name);
  return elector.waitForLeadership(callback);
}

exports.LeaderElector = LeaderElector;
exports.waitForLeadership = waitForLeadership;
//# sourceMappingURL=index.js.map
