const HEARTBEAT_INTERVAL = 1000;
const PING_TIMEOUT = 50;
const CLOSE = 'tabClose';
const PING = 'ping';
const PONG = 'pong';
const ELECTION = 'election';
const CAMPAIGN = 'campaign';
const CALL = 'call';
const RETURN = 'return';
const STATE = 'state';
const RECEIVE = 'receive';
const DONT_RECEIVE = {};
export function waitForLeadership(name, onLeadership) {
    if (typeof name !== 'string') {
        onLeadership = name;
        name = 'default';
    }
    const isSpectator = !onLeadership;
    const id = createTabId();
    const tabs = new Map([[id, Date.now()]]);
    const onReceives = new Set();
    const onStates = new Set();
    const callDeferreds = new Map();
    const queuedCalls = new Map();
    let leaderId = '';
    let heartbeatTimeout = 0;
    let leaderState;
    let channel;
    let callCount = 0;
    let api;
    let election = false;
    createChannel();
    self.addEventListener('beforeunload', close);
    const callbacks = {
        [PING]: onPing, [PONG]: onPong, [CLOSE]: onTabClose, [ELECTION]: onElection, [CAMPAIGN]: onCampaign,
        [CALL]: onCall, [RETURN]: onReturn, [STATE]: onUserState, [RECEIVE]: onUserMessage,
    };
    const setLeader = (newLeaderId) => {
        if (leaderId === newLeaderId)
            return;
        tab.leaderId = leaderId = newLeaderId;
        callDeferreds.forEach(({ reject }, callCount) => {
            if (queuedCalls.has(callCount))
                return;
            callDeferreds.delete(callCount);
            reject(new Error('Leader lost'));
        });
    };
    const runCallsAfterElection = () => {
        if (queuedCalls.size) {
            queuedCalls.forEach(({ name, rest }, callCount) => {
                if (isLeader())
                    onCall(id, callCount, name, ...rest);
                else
                    postMessage(CALL, id, callCount, name, ...rest, DONT_RECEIVE);
            });
            queuedCalls.clear();
        }
    };
    const call = (name, ...rest) => {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                callDeferreds.delete(callCount);
                reject(new Error('Call timed out'));
            }, 30000);
            callDeferreds.set(++callCount, { resolve, reject, timeout });
            if (leaderId && !election) {
                if (isLeader())
                    onCall(id, callCount, name, ...rest);
                else
                    postMessage(CALL, id, callCount, name, ...rest, DONT_RECEIVE);
            }
            else {
                queuedCalls.set(callCount, { name, rest });
            }
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
    if (isSpectator) {
        postMessage(PING);
    }
    else {
        sendHeartbeat();
    }
    return tab;
    function createChannel() {
        channel = new BroadcastChannel(`tab-election-${name}`);
        channel.addEventListener('message', onMessage);
    }
    function close() {
        channel.removeEventListener('message', onMessage);
        self.removeEventListener('beforeunload', close);
        clearTimeout(heartbeatTimeout);
        if (!isSpectator)
            postMessage(CLOSE, id);
        if (leaderId === id)
            postMessage(ELECTION);
        tabs.clear();
        onReceives.clear();
        onStates.clear();
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
            postMessage(STATE, leaderState, DONT_RECEIVE); // When a new tab joins, send the leader state
        }
        if (!tabId)
            return; // Spectator tabs don't need to respond or to be responded to
        const now = Date.now();
        tabs.set(tabId, now);
        if (tabId !== id && !isSpectator) {
            postMessage(PONG, id, isLeader());
        }
        if (isTabLeader)
            setLeader(tabId);
    }
    function onPong(tabId, isTabLeader) {
        tabs.set(tabId, Date.now());
        if (isTabLeader)
            setLeader(tabId);
    }
    async function onCall(id, callNumber, name, ...rest) {
        if (!isLeader())
            return;
        try {
            if (typeof (api === null || api === void 0 ? void 0 : api[name]) !== 'function')
                throw new Error(`Invalid API method "${name}"`);
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
        clearTimeout(deferred.timeout);
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
    function onElection() {
        election = true;
        setLeader('');
        const maxId = Array.from(tabs.keys()).sort().pop();
        // if we think we should be the leader because our id is the max, send a message
        if (id === maxId && !isSpectator) {
            postMessage(CAMPAIGN, id);
            onCampaign(id);
        }
    }
    function onCampaign(newLeaderId) {
        if (!leaderId || leaderId < newLeaderId) {
            setLeader(newLeaderId);
        }
        setTimeout(() => {
            election = false;
            if (!isSpectator && isLeader()) {
                if (onLeadership) {
                    // We won!
                    api = onLeadership();
                    onLeadership = null; // Don't let it get called multiple times
                }
            }
            runCallsAfterElection();
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