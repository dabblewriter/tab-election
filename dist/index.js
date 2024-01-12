var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Tab_instances, _Tab_name, _Tab_id, _Tab_callerId, _Tab_callDeferreds, _Tab_queuedCalls, _Tab_channel, _Tab_isLeader, _Tab_isLeaderReady, _Tab_state, _Tab_callCount, _Tab_api, _Tab_isToMe, _Tab_createChannel, _Tab_postMessage, _Tab_onMessage, _Tab_onCall, _Tab_onReturn, _Tab_onState, _Tab_onSend, _Tab_onSendState, _Tab_onLeader;
export var To;
(function (To) {
    To["All"] = "all";
    To["Others"] = "others";
    To["Leader"] = "leader";
})(To || (To = {}));
/**
 * A Tab is an interfaces to synchronize state and messages between tabs. It uses BroadcastChannel and the Lock API.
 * This is a simplified version of the original implementation.
 */
export class Tab extends EventTarget {
    constructor(name = 'default') {
        super();
        _Tab_instances.add(this);
        this.relinquishLeadership = () => { };
        _Tab_name.set(this, void 0);
        _Tab_id.set(this, void 0);
        _Tab_callerId.set(this, void 0);
        _Tab_callDeferreds.set(this, new Map());
        _Tab_queuedCalls.set(this, new Map());
        _Tab_channel.set(this, void 0);
        _Tab_isLeader.set(this, false);
        _Tab_isLeaderReady.set(this, false);
        _Tab_state.set(this, void 0);
        _Tab_callCount.set(this, 0);
        _Tab_api.set(this, void 0);
        __classPrivateFieldSet(this, _Tab_name, name, "f");
        __classPrivateFieldSet(this, _Tab_id, createTabId(), "f");
        __classPrivateFieldSet(this, _Tab_state, {}, "f");
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_createChannel).call(this);
        this.hasLeader().then(hasLeader => {
            if (hasLeader)
                __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, To.Leader, 'onSendState', __classPrivateFieldGet(this, _Tab_id, "f"));
        });
    }
    get id() {
        return __classPrivateFieldGet(this, _Tab_id, "f");
    }
    get name() {
        return __classPrivateFieldGet(this, _Tab_name, "f");
    }
    get isLeader() {
        return __classPrivateFieldGet(this, _Tab_isLeader, "f");
    }
    async hasLeader() {
        return navigator.locks.request(`tab-${__classPrivateFieldGet(this, _Tab_name, "f")}`, { ifAvailable: true }, async (lock) => lock === null);
    }
    getCurrentCallerId() {
        return __classPrivateFieldGet(this, _Tab_callerId, "f");
    }
    getState() {
        return __classPrivateFieldGet(this, _Tab_state, "f");
    }
    setState(state) {
        if (!this.isLeader)
            throw new Error('Only the leader can set state');
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onState).call(this, state);
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, To.Others, 'onState', state);
    }
    async waitForLeadership(onLeadership) {
        this.relinquishLeadership(); // Cancel any previous leadership requests
        try {
            return await navigator.locks.request(`tab-${__classPrivateFieldGet(this, _Tab_name, "f")}`, async (lock) => {
                __classPrivateFieldSet(this, _Tab_isLeader, true, "f");
                __classPrivateFieldSet(this, _Tab_api, await onLeadership(this.relinquishLeadership), "f");
                __classPrivateFieldSet(this, _Tab_isLeaderReady, true, "f");
                __classPrivateFieldGet(this, _Tab_queuedCalls, "f").forEach(({ id, name, rest }, callNumber) => __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onCall).call(this, id, callNumber, name, ...rest));
                __classPrivateFieldGet(this, _Tab_queuedCalls, "f").clear();
                this.dispatchEvent(new Event('leadershipchange'));
                __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, To.Others, 'onLeader', __classPrivateFieldGet(this, _Tab_state, "f"));
                return new Promise(resolve => (this.relinquishLeadership = () => resolve())); // Never resolve
            });
        }
        finally {
            __classPrivateFieldSet(this, _Tab_isLeader, false, "f");
            __classPrivateFieldSet(this, _Tab_api, null, "f");
            this.dispatchEvent(new Event('leadershipchange'));
        }
    }
    call(name, ...rest) {
        var _a;
        const callNumber = __classPrivateFieldSet(this, _Tab_callCount, (_a = __classPrivateFieldGet(this, _Tab_callCount, "f"), ++_a), "f");
        return new Promise(async (resolve, reject) => {
            const timeout = setTimeout(() => {
                __classPrivateFieldGet(this, _Tab_callDeferreds, "f").delete(callNumber);
                reject(new Error('Call timed out'));
            }, 30000);
            __classPrivateFieldGet(this, _Tab_callDeferreds, "f").set(callNumber, { resolve, reject, timeout });
            if (this.isLeader && __classPrivateFieldGet(this, _Tab_isLeaderReady, "f")) {
                __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onCall).call(this, __classPrivateFieldGet(this, _Tab_id, "f"), callNumber, name, ...rest);
            }
            else if (!this.isLeader && (await this.hasLeader())) {
                __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, To.Leader, 'onCall', __classPrivateFieldGet(this, _Tab_id, "f"), callNumber, name, ...rest);
            }
            else {
                __classPrivateFieldGet(this, _Tab_queuedCalls, "f").set(callNumber, { id: __classPrivateFieldGet(this, _Tab_id, "f"), name, rest });
            }
        });
    }
    send(data, to = To.Others) {
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, to, 'onSend', data);
    }
    close() {
        this.relinquishLeadership();
        __classPrivateFieldSet(this, _Tab_isLeader, false, "f");
        __classPrivateFieldGet(this, _Tab_channel, "f").close();
        __classPrivateFieldGet(this, _Tab_channel, "f").onmessage = null;
    }
}
_Tab_name = new WeakMap(), _Tab_id = new WeakMap(), _Tab_callerId = new WeakMap(), _Tab_callDeferreds = new WeakMap(), _Tab_queuedCalls = new WeakMap(), _Tab_channel = new WeakMap(), _Tab_isLeader = new WeakMap(), _Tab_isLeaderReady = new WeakMap(), _Tab_state = new WeakMap(), _Tab_callCount = new WeakMap(), _Tab_api = new WeakMap(), _Tab_instances = new WeakSet(), _Tab_isToMe = function _Tab_isToMe(to) {
    if (typeof to === 'string') {
        return (to === To.Leader && __classPrivateFieldGet(this, _Tab_isLeader, "f")) || to === __classPrivateFieldGet(this, _Tab_id, "f") || to === To.All || to === To.Others;
    }
    return to.has(__classPrivateFieldGet(this, _Tab_id, "f"));
}, _Tab_createChannel = function _Tab_createChannel() {
    __classPrivateFieldSet(this, _Tab_channel, new BroadcastChannel(`tab-${__classPrivateFieldGet(this, _Tab_name, "f")}`), "f");
    __classPrivateFieldGet(this, _Tab_channel, "f").onmessage = e => __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onMessage).call(this, e);
}, _Tab_postMessage = function _Tab_postMessage(to, name, ...rest) {
    const data = { to, name, rest };
    try {
        __classPrivateFieldGet(this, _Tab_channel, "f").postMessage(data);
        if (to !== To.Others && __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_isToMe).call(this, to)) {
            __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onMessage).call(this, new MessageEvent('message', { data }));
        }
    }
    catch (e) {
        // If the channel is closed, create a new one and try again
        if (e.name === 'InvalidStateError') {
            __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_createChannel).call(this);
            __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, to, name, ...rest);
        }
    }
}, _Tab_onMessage = function _Tab_onMessage(event) {
    const { to, name, rest } = event.data;
    if (!__classPrivateFieldGet(this, _Tab_instances, "m", _Tab_isToMe).call(this, to))
        return;
    if (name === 'onCall')
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onCall).apply(this, rest);
    else if (name === 'onReturn')
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onReturn).apply(this, rest);
    else if (name === 'onState')
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onState).apply(this, rest);
    else if (name === 'onSend')
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onSend).apply(this, rest);
    else if (name === 'onSendState')
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onSendState).apply(this, rest);
    else if (name === 'onLeader')
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onLeader).apply(this, rest);
    else
        console.error('Unknown message', name, rest);
}, _Tab_onCall = async function _Tab_onCall(id, callNumber, name, ...rest) {
    if (!this.isLeader)
        return;
    if (!__classPrivateFieldGet(this, _Tab_isLeaderReady, "f")) {
        __classPrivateFieldGet(this, _Tab_queuedCalls, "f").set(callNumber, { id, name, rest });
        return;
    }
    try {
        if (typeof __classPrivateFieldGet(this, _Tab_api, "f")?.[name] !== 'function')
            throw new Error(`Invalid API method "${name}"`);
        __classPrivateFieldSet(this, _Tab_callerId, id, "f");
        const promise = __classPrivateFieldGet(this, _Tab_api, "f")[name](...rest);
        __classPrivateFieldSet(this, _Tab_callerId, undefined, "f");
        const results = await promise;
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, id, 'onReturn', callNumber, null, results);
    }
    catch (e) {
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, id, 'onReturn', callNumber, e);
    }
}, _Tab_onReturn = function _Tab_onReturn(callNumber, error, results) {
    const deferred = __classPrivateFieldGet(this, _Tab_callDeferreds, "f").get(callNumber);
    if (!deferred)
        return console.error('No deferred found for call', callNumber);
    clearTimeout(deferred.timeout);
    __classPrivateFieldGet(this, _Tab_callDeferreds, "f").delete(callNumber);
    if (error)
        deferred.reject(error);
    else
        deferred.resolve(results);
}, _Tab_onState = function _Tab_onState(data) {
    __classPrivateFieldSet(this, _Tab_state, data, "f");
    this.dispatchEvent(new MessageEvent('state', { data }));
}, _Tab_onSend = function _Tab_onSend(data) {
    this.dispatchEvent(new MessageEvent('message', { data }));
}, _Tab_onSendState = function _Tab_onSendState(id) {
    if (this.isLeader) {
        __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, id, 'onState', __classPrivateFieldGet(this, _Tab_state, "f"));
    }
}, _Tab_onLeader = function _Tab_onLeader(state) {
    __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_onState).call(this, state);
    __classPrivateFieldGet(this, _Tab_queuedCalls, "f").forEach(({ id, name, rest }, callNumber) => __classPrivateFieldGet(this, _Tab_instances, "m", _Tab_postMessage).call(this, To.Leader, 'onCall', callNumber, name, ...rest));
    __classPrivateFieldGet(this, _Tab_queuedCalls, "f").clear();
};
const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
function createTabId() {
    let id = '';
    let length = 16;
    while (length--) {
        id += chars[(Math.random() * chars.length) | 0];
    }
    return id;
}
//# sourceMappingURL=index.js.map