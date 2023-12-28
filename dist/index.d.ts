export type OnLeadership = (relinquish: Unsubscribe) => any;
export type Unsubscribe = () => void;
export type OnReceive = (msg: any) => void;
export type OnState<T> = (state: T) => void;
/**
 * A Tab is an interfaces to synchronize state and messages between tabs. It uses BroadcastChannel and the Lock API.
 * This is a simplified version of the original implementation.
 */
export declare class Tab<T = Record<string, any>> extends EventTarget {
    #private;
    relinquishLeadership: () => void;
    constructor(name?: string);
    get isLeader(): boolean;
    hasLeader(): Promise<any>;
    getState(): T;
    setState(state: T): void;
    waitForLeadership(onLeadership: OnLeadership): Promise<void>;
    call<R>(name: string, ...rest: any[]): Promise<R>;
    send(data: any): void;
    close(): void;
}
