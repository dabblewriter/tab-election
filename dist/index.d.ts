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
    #private;
    relinquishLeadership: () => void;
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
}
