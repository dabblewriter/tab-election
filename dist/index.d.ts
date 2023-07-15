export declare type Callback = () => any;
export declare type Unsubscribe = () => void;
export declare type OnReceive = (msg: any, fromLeader: boolean) => void;
export declare type OnState<T> = (state: T) => void;
export declare type Tab<T = any> = {
    send: (msg: any) => void;
    onReceive: (listener: OnReceive, fromLeader: boolean) => Unsubscribe;
    state: () => T | ((state: T) => void);
    onState: (listener: OnState<T>) => Unsubscribe;
    close: () => void;
};
export declare function waitForLeadership<T = any>(onLeadership: Callback): Tab<T>;
export declare function waitForLeadership<T = any>(name: string, onLeadership: Callback): Tab<T>;
