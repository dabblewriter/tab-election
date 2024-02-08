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
        this.relinquishLeadership = () => { };
        this._callDeferreds = new Map();
        this._queuedCalls = new Map();
        this._isLeader = false;
        this._isLeaderReady = false;
        this._callCount = 0;
        this._name = name;
        this._id = createTabId();
        this._state = {};
        this._createChannel();
        this.hasLeader().then(hasLeader => {
            if (hasLeader)
                this._postMessage(To.Leader, 'onSendState', this._id);
        });
    }
    get id() {
        return this._id;
    }
    get name() {
        return this._name;
    }
    get isLeader() {
        return this._isLeader;
    }
    async hasLeader() {
        const check = () => navigator.locks.request(`tab-${this._name}`, { ifAvailable: true }, async (lock) => lock === null);
        if (await check()) {
            // bug in Chrome will sometimes handle this option lock request first before running the winner first. This is a
            // workaround to make sure the winner runs first.
            return await check();
        }
        ;
    }
    getCurrentCallerId() {
        return this._callerId;
    }
    getState() {
        return this._state;
    }
    setState(state) {
        if (!this.isLeader)
            throw new Error('Only the leader can set state');
        this._onState(state);
        this._postMessage(To.Others, 'onState', state);
    }
    async waitForLeadership(onLeadership) {
        this.relinquishLeadership(); // Cancel any previous leadership requests
        const abortController = new AbortController();
        const { signal } = abortController;
        this.relinquishLeadership = () => abortController.abort('Aborted');
        try {
            // The signal will cancel the lock request before a lock is attained, the promise.resolve will cancel it after
            return await navigator.locks.request(`tab-${this._name}`, { signal }, async (lock) => {
                this._isLeader = true;
                // Never resolve until relinquishLeadership is called
                const keepLockPromise = new Promise(resolve => (this.relinquishLeadership = () => resolve(true)));
                this._api = await onLeadership(this.relinquishLeadership);
                this._isLeaderReady = true;
                this._queuedCalls.forEach(({ id, name, rest }, callNumber) => this._onCall(id, callNumber, name, ...rest));
                this._queuedCalls.clear();
                this.dispatchEvent(new Event('leadershipchange'));
                this._postMessage(To.Others, 'onLeader', this._state);
                return keepLockPromise;
            }).catch(e => e !== 'Aborted' && Promise.reject(e) || false);
        }
        finally {
            this._isLeader = false;
            this._api = null;
            this.dispatchEvent(new Event('leadershipchange'));
        }
    }
    call(name, ...rest) {
        const callNumber = ++this._callCount;
        return new Promise(async (resolve, reject) => {
            const timeout = setTimeout(() => {
                this._callDeferreds.delete(callNumber);
                reject(new Error('Call timed out'));
            }, 30000);
            this._callDeferreds.set(callNumber, { resolve, reject, timeout });
            if (this.isLeader && this._isLeaderReady) {
                this._onCall(this._id, callNumber, name, ...rest);
            }
            else {
                const exists = await this.hasLeader();
                // Check again if this is the leader since it could have become the leader while checking
                if (this.isLeader && this._isLeaderReady) {
                    this._onCall(this._id, callNumber, name, ...rest);
                }
                else if (!this.isLeader && exists) {
                    this._postMessage(To.Leader, 'onCall', this._id, callNumber, name, ...rest);
                }
                else {
                    this._queuedCalls.set(callNumber, { id: this._id, name, rest });
                }
            }
        });
    }
    send(data, to = To.Others) {
        this._postMessage(to, 'onSend', data);
    }
    close() {
        this.relinquishLeadership();
        this._isLeader = false;
        this._channel.close();
        this._channel.onmessage = null;
    }
    _isToMe(to) {
        if (typeof to === 'string') {
            return (to === To.Leader && this._isLeader) || to === this._id || to === To.All || to === To.Others;
        }
        return to.has(this._id);
    }
    _createChannel() {
        this._channel = new BroadcastChannel(`tab-${this._name}`);
        this._channel.onmessage = e => this._onMessage(e);
    }
    _postMessage(to, name, ...rest) {
        // Don't send if there's no one to send to
        if (!to || to instanceof Set && !to.size)
            return;
        const data = { to, name, rest };
        const toMe = to !== To.Others && this._isToMe(to);
        try {
            this._channel.postMessage(data);
            if (toMe) {
                this._onMessage(new MessageEvent('message', { data }));
            }
        }
        catch (e) {
            // If the channel is closed, create a new one and try again
            if (e.name === 'InvalidStateError') {
                this._createChannel();
                this._postMessage(to, name, ...rest);
            }
        }
    }
    _onMessage(event) {
        const { to, name, rest } = event.data;
        if (!this._isToMe(to))
            return;
        if (name === 'onCall')
            this._onCall.apply(this, rest);
        else if (name === 'onReturn')
            this._onReturn.apply(this, rest);
        else if (name === 'onState')
            this._onState.apply(this, rest);
        else if (name === 'onSend')
            this._onSend.apply(this, rest);
        else if (name === 'onSendState')
            this._onSendState.apply(this, rest);
        else if (name === 'onLeader')
            this._onLeader.apply(this, rest);
        else
            console.error('Unknown message', name, rest);
    }
    async _onCall(id, callNumber, name, ...rest) {
        if (!this.isLeader)
            return;
        if (!this._isLeaderReady) {
            this._queuedCalls.set(callNumber, { id, name, rest });
            return;
        }
        try {
            if (typeof this._api?.[name] !== 'function')
                throw new Error(`Invalid API method "${name}"`);
            this._callerId = id;
            const promise = this._api[name](...rest);
            this._callerId = undefined;
            const results = await promise;
            this._postMessage(id, 'onReturn', callNumber, null, results);
        }
        catch (e) {
            this._callerId = undefined;
            this._postMessage(id, 'onReturn', callNumber, e);
        }
    }
    _onReturn(callNumber, error, results) {
        const deferred = this._callDeferreds.get(callNumber);
        if (!deferred)
            return console.error('No deferred found for call', callNumber);
        clearTimeout(deferred.timeout);
        this._callDeferreds.delete(callNumber);
        if (error)
            deferred.reject(error);
        else
            deferred.resolve(results);
    }
    _onState(data) {
        this._state = data;
        this.dispatchEvent(new MessageEvent('state', { data }));
    }
    _onSend(data) {
        this.dispatchEvent(new MessageEvent('message', { data }));
    }
    _onSendState(id) {
        if (this.isLeader) {
            this._postMessage(id, 'onState', this._state);
        }
    }
    _onLeader(state) {
        this._onState(state);
        this._queuedCalls.forEach(({ id, name, rest }, callNumber) => this._postMessage(To.Leader, 'onCall', callNumber, name, ...rest));
        this._queuedCalls.clear();
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
//# sourceMappingURL=index.js.map