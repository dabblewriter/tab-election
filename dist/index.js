const HEARTBEAT_INTERVAL = 1000;
const PING_TIMEOUT = 50;
const CLOSE = 'tabClose';
const PROMOTE = 'tabPromote';
const PING = 'ping';
const PONG = 'pong';
const ELECTION = 'election';
const CALL = 'call';
const RETURN = 'return';
const STATE = 'state';
const RECEIVE = 'receive';
const DONT_RECEIVE = {};
export function waitForLeadership(name, onLeadership) {
    if (typeof name === 'function') {
        onLeadership = name;
        name = 'default';
    }
    const id = createTabId();
    const tabs = new Map([[id, Date.now()]]);
    const onReceives = new Set();
    const onStates = new Set();
    const callDeferreds = new Map();
    let leaderId = '';
    let heartbeatTimeout = 0;
    let leaderState;
    let channel;
    let callCount = 0;
    let api;
    createChannel();
    self.addEventListener('beforeunload', close);
    const callbacks = {
        [PING]: onPing, [PONG]: onPong, [CLOSE]: onTabClose, [PROMOTE]: onTabPromote, [ELECTION]: onElection,
        [CALL]: onCall, [RETURN]: onReturn, [STATE]: onUserState, [RECEIVE]: onUserMessage,
    };
    const call = (name, ...rest) => {
        return new Promise((resolve, reject) => {
            callDeferreds.set(++callCount, { resolve, reject });
            if (isLeader())
                onCall(id, callCount, name, ...rest);
            else
                postMessage(CALL, id, callCount, name, ...rest, DONT_RECEIVE);
        });
    };
    const send = (msg) => postMessage(RECEIVE, msg, DONT_RECEIVE);
    const onReceive = (onReceive) => {
        onReceives.add(onReceive);
        return () => onReceives.delete(onReceive);
    };
    const state = (state) => {
        if (state === undefined)
            return leaderState;
        if (!isLeader())
            return console.error('Only the leader can set state');
        leaderState = state;
        postMessage(STATE, state, DONT_RECEIVE);
        onUserState(state);
    };
    const onState = (onState) => {
        onStates.add(onState);
        return () => onStates.delete(onState);
    };
    const tab = { id, leaderId, tabs, call, send, onReceive, state, onState, close };
    // Start the heartbeat & initial ping to discover
    sendHeartbeat();
    return tab;
    function createChannel() {
        channel = new BroadcastChannel(`tab-election-${name}`);
        channel.addEventListener('message', onMessage);
    }
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
        const sendSelf = rest[rest.length - 1] !== DONT_RECEIVE;
        if (!sendSelf)
            rest.pop();
        try {
            channel.postMessage(data);
            if (sendSelf)
                onMessage(new MessageEvent('message', { data }));
        }
        catch (e) {
            // If the channel is closed, create a new one and try again
            if (e.name === 'InvalidStateError') {
                createChannel();
                postMessage(name, ...rest);
            }
        }
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
        if (isLeader() && leaderState !== undefined && !tabs.has(tabId)) {
            tab.state(leaderState); // When a new tab joins, send the leader state
        }
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
    async function onCall(id, callNumber, name, ...rest) {
        if (!isLeader())
            return;
        try {
            if (typeof (api === null || api === void 0 ? void 0 : api[name]) !== 'function')
                throw new Error('Invalid API method');
            const results = await api[name](...rest);
            postMessage(RETURN, id, callNumber, null, results);
        }
        catch (e) {
            postMessage(RETURN, id, callNumber, e);
        }
    }
    function onReturn(forTab, callNumber, error, results) {
        if (id !== forTab)
            return;
        const deferred = callDeferreds.get(callNumber);
        if (!deferred)
            return console.error('No deferred found for call', callNumber);
        callDeferreds.delete(callNumber);
        if (error)
            deferred.reject(error);
        else
            deferred.resolve(results);
    }
    function onUserMessage(msg) {
        onReceives.forEach(listener => listener(msg));
    }
    function onUserState(state) {
        leaderState = state;
        onStates.forEach(listener => listener(state));
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
                api = onLeadership();
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