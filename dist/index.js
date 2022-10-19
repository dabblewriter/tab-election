const HEARTBEAT_INTERVAL = 1000;
const PING_TIMEOUT = 50;
const CLOSE = 'tabClose';
const PROMOTE = 'tabPromote';
const PING = 'ping';
const PONG = 'pong';
const ELECTION = 'election';
export function waitForLeadership(name, onLeadership) {
    if (typeof name === 'function') {
        onLeadership = name;
        name = 'default';
    }
    const id = createTabId();
    const tabs = new Map([[id, Date.now()]]);
    let leaderId = '';
    let heartbeatTimeout = 0;
    const channel = new BroadcastChannel(`tab-election-${name}`);
    channel.addEventListener('message', onMessage);
    self.addEventListener('beforeunload', close);
    const callbacks = {
        [PING]: onPing, [PONG]: onPong, [CLOSE]: onTabClose, [PROMOTE]: onTabPromote, [ELECTION]: onElection,
    };
    const tab = { id, leaderId, tabs, close };
    // Start the heartbeat & initial ping to discover
    sendHeartbeat();
    return tab;
    function close() {
        channel.removeEventListener('message', onMessage);
        self.removeEventListener('beforeunload', close);
        clearTimeout(heartbeatTimeout);
        postMessage(CLOSE, id);
        if (leaderId === id)
            postMessage(ELECTION);
        channel.close();
    }
    function isLeader() {
        return leaderId === id;
    }
    function postMessage(name, ...rest) {
        const data = { name, rest };
        channel.postMessage(data);
        onMessage(new MessageEvent('message', { data }));
    }
    function onMessage(event) {
        const { name, rest } = event.data;
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
                if (lastUpdated < now)
                    postMessage(CLOSE, id);
            });
            if (!leaderId || !tabs.has(leaderId)) {
                postMessage(ELECTION);
            }
        }, PING_TIMEOUT);
    }
    function onPing(tabId, isTabLeader) {
        const now = Date.now();
        tabs.set(tabId, now);
        if (tabId !== id) {
            postMessage(PONG, id, isLeader());
        }
        if (isTabLeader)
            tab.leaderId = leaderId = tabId;
    }
    function onPong(tabId, isTabLeader) {
        tabs.set(tabId, Date.now());
        if (isTabLeader)
            tab.leaderId = leaderId = tabId;
    }
    function onElection() {
        tab.leaderId = leaderId = '';
        const maxId = Array.from(tabs.keys()).sort().pop();
        // if we think we should be the leader, set the key and send a message
        if (id === maxId) {
            postMessage(PROMOTE, id);
            onTabPromote(id);
        }
    }
    function onTabClose(id) {
        tabs.delete(id);
    }
    function onTabPromote(newLeaderId) {
        if (!leaderId || leaderId < newLeaderId) {
            tab.leaderId = leaderId = newLeaderId;
        }
        setTimeout(() => {
            if (isLeader() && onLeadership) {
                // We won!
                onLeadership();
                onLeadership = null; // Don't let it get called multiple times
            }
        }, PING_TIMEOUT);
    }
}
const chars = ('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ').split('');
function createTabId() {
    let id = '';
    let length = 16;
    while (length--) {
        id += chars[Math.random() * chars.length | 0];
    }
    return id;
}
//# sourceMappingURL=index.js.map