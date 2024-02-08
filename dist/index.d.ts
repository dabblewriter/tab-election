export type OnLeadership = (relinquish: Unsubscribe) => any;
export type Unsubscribe = () => void;
export type OnReceive = (msg: any) => void;
export type OnState<T> = (state: T) => void;
export declare enum To {
    All = "all",
    Others = "others",
    Leader = "leader"
}
export interface TabEventMap {
    leadershipchange: Event;
    message: MessageEvent;
    state: MessageEvent;
}
export interface Tab {
    addEventListener<K extends keyof TabEventMap>(type: K, listener: (this: BroadcastChannel, ev: TabEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    removeEventListener<K extends keyof TabEventMap>(type: K, listener: (this: BroadcastChannel, ev: TabEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}
/**
 * A Tab is an interfaces to synchronize state and messages between tabs. It uses BroadcastChannel and the Lock API.
 * This is a simplified version of the original implementation.
 */
export declare class Tab<T = Record<string, any>> extends EventTarget implements Tab {
    relinquishLeadership: () => void;
    private _name;
    private _id;
    private _callerId;
    private _callDeferreds;
    private _queuedCalls;
    private _channel;
    private _isLeader;
    private _isLeaderReady;
    private _state;
    private _callCount;
    private _api;
    constructor(name?: string);
    get id(): string;
    get name(): string;
    get isLeader(): boolean;
    hasLeader(): Promise<any>;
    getCurrentCallerId(): string;
    getState(): T;
    setState(state: T): void;
    waitForLeadership(onLeadership: OnLeadership): Promise<boolean>;
    call<R>(name: string, ...rest: any[]): Promise<R>;
    send(data: any, to?: string | Set<string>): void;
    close(): void;
    _isToMe(to: string | Set<string>): boolean;
    _createChannel(): void;
    _postMessage(to: string | Set<string>, name: string, ...rest: any[]): void;
    _onMessage(event: MessageEvent): void;
    _onCall(id: string, callNumber: number, name: string, ...rest: any[]): Promise<void>;
    _onReturn(callNumber: number, error: any, results: any): void;
    _onState(data: T): void;
    _onSend(data: any): void;
    _onSendState(id: string): void;
    _onLeader(state: T): void;
}
