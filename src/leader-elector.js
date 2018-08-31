import { createNodeId } from './utils';

const VOTE_PERIOD = 500;
const HEARTBEAT = 500;
const ELECTION_MIN = 2000; // when not visible in browsers heartbeat is slowed down to 1000 ms, keep above this
const ELECTION_MAX = 3000;

const STATE_FOLLOWER = 'follower';
const STATE_CANDIDATE = 'candidate';
const STATE_LEADER = 'leader';
const STATE_CLOSED = 'closed';


/**
 * Create an elector, listen in the callback provided in waitForLeadership() to know when this becomes the leader. Call
 * close() to disconnect. Ignore the other methods, they are not for you. This started off using raft but because of
 * the environment was simplified. setTimeout/setInterval are throttled to 1000ms in most browsers when the tab is not
 * the focus. Also they all share localStorage which is needed to trigger updates anyway, so we use that instead of
 * proper voting. It works great! Just don't lower the numbers above without testing because the throttling will
 * make multiple leaders become elected with lower numbers, even when voting was in place.
 */
export default class LeaderElector {

  constructor(name) {
    this.name = name;
    this.state = STATE_CLOSED;
    this.nodeId = createNodeId();
    this.timeout = 0;
    this.callback = null;
    this.close = this.close.bind(this);
  }

  /**
   * Wait until this tab becomes the leader, then do something about it. Once the leader, it will remain the leader
   * until closed. The first tab open will almost immediately become the leader (within 100 ms).
   * @return {LeaderElector} A reference to itself.
   */
  waitForLeadership(callback) {
    this.callback = callback;
    this.becomeFollower();
    return this;
  }

  /**
   * Close this leader elector. To restart it, you must call waitForLeadership again.
   */
  close() {
    clearTimeout(this.timeout);
    window.removeEventListener('unload', this.close);
    if (this.state === STATE_LEADER) {
      let leader = getLeaderInfo(this.name);
      if (leader && leader.nodeId === this.nodeId) {
        clearLeaderInfo(this.name);
      }
    }
    this.state = STATE_CLOSED;
  }


  hasLeader() {
    let leader = getLeaderInfo(this.name);
    return leader && Date.now() - leader.timestamp < ELECTION_MIN;
  }

  becomeFollower() {
    this.state = STATE_FOLLOWER;
    clearTimeout(this.timeout);

    let checkLeadership = () => {
      // If no leader or the leader is long gone, immediately take leadership
      if (!this.hasLeader()) return this.becomeCandidate();
      let interval = Math.round(ELECTION_MAX - ELECTION_MIN * Math.random()) + ELECTION_MIN;
      this.timeout = setTimeout(checkLeadership, interval);
    };

    checkLeadership();
  }

  becomeCandidate() {
    this.state = STATE_CANDIDATE;
    clearTimeout(this.timeout);

    setLeaderInfo(this.name, this.nodeId);
    this.timeout = setTimeout(() => {
      // last one wins
      let leader = getLeaderInfo(this.name);
      if (leader.nodeId === this.nodeId) {
        this.becomeLeader();
      } else {
        this.becomeFollower();
      }
    }, VOTE_PERIOD);
  }

  becomeLeader() {
    this.state = STATE_LEADER;
    clearTimeout(this.timeout);

    let heartbeat = () => {
      setLeaderInfo(this.name, this.nodeId);
      this.timeout = setTimeout(heartbeat, HEARTBEAT);
    };
    heartbeat();
    window.addEventListener('unload', this.close);
    this.callback();
  }
}



function getLeaderInfo(name) {
  try {
    return JSON.parse(localStorage.getItem(`tab-leader:${name}`));
  } catch(err) {
    return null;
  }
}

function setLeaderInfo(name, nodeId) {
  localStorage.setItem(`tab-leader:${name}`, JSON.stringify({ nodeId, timestamp: Date.now() }));
}

function clearLeaderInfo(name) {
  localStorage.removeItem(`tab-leader:${name}`);
}
