export declare type Callback = () => any;
export declare type Tab = {
    close: () => void;
};
export declare function waitForLeadership(onLeadership: Callback): Tab;
export declare function waitForLeadership(name: string, onLeadership: Callback): Tab;
