import { Tab } from './tab.js';

/**
 * Hub & Spoke Multi-Tab Coordination Utility
 *
 * This utility provides a simple way to coordinate multiple browser tabs using a hub-and-spoke
 * architecture where one tab (or shared worker) acts as the central hub that manages shared
 * resources like databases and server connections, while other tabs (spokes) communicate with
 * the hub to access these resources.
 *
 * Key features:
 * - Automatic leadership election using tab-election
 * - Type-safe RPC between spokes and hub services
 * - Optional version mismatch detection and handling
 * - Support for SharedWorker, WebWorker, or in-tab coordination
 * - Flexible service registration and service stub generation
 *
 * @example
 * ```typescript
 * // Define event types for your service
 * interface DatabaseEvents {
 *   'user-saved': { user: User };
 *   'user-deleted': { id: string };
 * }
 *
 * // Define a service class with phantom property for type inference
 * class DatabaseService {
 *   readonly namespace = 'db' as const;
 *   readonly __events?: DatabaseEvents;  // Phantom property - don't set at runtime
 *   private db: IDBDatabase;
 *   private hub: Hub;
 *
 *   async init(hub: Hub): Promise<void> {
 *     this.hub = hub;
 *     this.db = await openDB(`app-${hub.name}`);
 *   }
 *
 *   async getUser(id: string): Promise<User> {
 *     // Database operations...
 *   }
 *
 *   async saveUser(user: User): Promise<void> {
 *     // Database operations...
 *     this.hub.emit(this.namespace, 'user-saved', { user }); // Type-safe event emission
 *   }
 * }
 *
 * // Hub setup (in shared worker or elected tab)
 * const hub = new Hub((hub) => {
 *   hub.register(new DatabaseService());
 *   hub.register(new AuthenticationService());
 * });
 * hub.onVersionMismatch((oldVersion, newVersion) => {
 *   console.log(`Version updated: ${oldVersion} -> ${newVersion}`);
 *   return 'refresh'; // or 'ignore'
 * });
 *
 * // Spoke setup (in each tab)
 * const spoke = new Spoke({
 *   workerUrl: 'hub.js',
 *   name: 'user-123',
 *   version: '1.0.0'
 * });
 * const db = spoke.getService<DatabaseService>('db');
 * const user = await db.getUser('123'); // Fully typed!
 *
 * // Listen for events from the service - fully typed!
 * const unsubscribe = db.on('user-saved', ({ user }) => {
 *   console.log('User was saved:', user);
 * });
 *
 * // TypeScript will error on invalid event names or payloads:
 * // db.on('invalid-event', () => {}); // Error: invalid event name
 * // db.on('user-saved', ({ wrongProp }) => {}); // Error: wrong payload shape
 * ```
 */

// Types and Interfaces

/**
 * Event listener function type.
 */
export type EventListener<T = unknown> = (payload: T) => void;

/**
 * Unsubscribe function type.
 */
export type UnsubscribeFunction = () => void;

/**
 * Base service interface that hub services should implement.
 *
 * `Events` is a mapping from event names (string keys) to the payload type that will be
 * delivered to listeners. By default it is an empty map meaning the service does not
 * emit any strongly-typed events.
 *
 * @example
 * ```typescript
 * interface UserEvents {
 *   "user-saved": { user: User };
 *   "user-deleted": { id: string };
 * }
 *
 * class DatabaseService {
 *   readonly namespace = "db" as const;
 *   readonly __events?: UserEvents;  // Phantom property for type inference
 *
 *   async saveUser(user: User): Promise<void> {
 *     // ... save logic
 *     // Emit via hub.emit(this.namespace, 'user-saved', { user })
 *   }
 * }
 * ```
 */
export interface Service<Events extends Record<string, any> = {}> {
  readonly namespace: string;
  readonly __events?: Events;

  /**
   * Initialize the service.
   * This is called once when the service is first instantiated in the hub.
   */
  init?(hub: Hub): Promise<void> | void;

  /**
   * Close the service.
   * This is called when the service is no longer needed.
   */
  close?(): void;
}

// Extract the event map from a Service implementation
type ServiceEvents<T> = T extends Service<infer E> ? E : never;

/**
 * Service stub type - a proxy for calling methods on a remote Service with type-safe events.
 */
export type ServiceStub<T extends Service<any>> = AllMethodsAsync<Omit<T, 'init' | 'close' | '__events'>> & {
  on<K extends keyof ServiceEvents<T>>(eventName: K, listener: EventListener<ServiceEvents<T>[K]>): UnsubscribeFunction;
};

/**
 * @deprecated Use `ServiceStub<T>` instead. This alias will be removed in a future major version.
 */
export type Client<T extends Service<any>> = ServiceStub<T>;

/**
 * Configuration options for creating a Hub.
 */
export interface HubOptions {
  /** Unique name/namespace for this hub instance (e.g., 'user-123', 'session-abc') */
  name?: string;
  /** Optional version string for version mismatch detection */
  version?: string;
}

/**
 * Configuration options for creating a Spoke.
 */
export interface SpokeOptions {
  /** URL of the worker script that runs the hub, or a Hub instance for an in-tab hub (will still only be one active hub per name/version) */
  workerUrl: string | Hub;
  /** Unique name/namespace to connect to (must match hub name) */
  name: string;
  /** Optional version string for version mismatch detection */
  version?: string;
  /** Whether to use SharedWorker when available */
  useSharedWorker?: boolean;
}

/**
 * Function signature for version mismatch handlers.
 */
export type VersionMismatchHandler = (oldVersion: string, newVersion: string) => void;

/**
 * Utility type to convert all methods to async methods for RPC.
 */
type AllMethodsAsync<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K] extends (...args: any[]) => Promise<any>
  ? T[K]
  : T[K] extends (...args: infer P) => infer R
  ? (...args: P) => Promise<R>
  : never;
};

class Leader {

  constructor(public hub: Hub, public readonly services: Map<string, Service>) {
  }

  async init(hub: Hub) {
    for (const service of this.services.values()) {
      if (typeof service.init === 'function') {
        await service.init(hub);
      }
    }
  }

  close() {
    for (const service of this.services.values()) {
      if (typeof service.close === 'function') {
        service.close();
      }
    }
  }
}

export interface Hub {
  addEventListener(type: 'message', listener: (ev: MessageEvent) => any, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: 'message', listener: (ev: MessageEvent) => any, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

/**
 * Hub class - runs in shared worker or elected tab to manage services and coordination.
 *
 * The Hub is responsible for:
 * - Leadership election among tabs/workers
 * - Service initialization and lifecycle management
 * - RPC method dispatch from spokes to services
 * - Version mismatch detection and handling
 * - Broadcasting updates to connected spokes
 */
export class Hub extends EventTarget {
  protected services = new Map<string, Service>();
  protected tab: Tab;
  protected leader: Leader | null = null;
  protected versionChannel?: BroadcastChannel;
  protected versionMismatchHandlers = new Set<VersionMismatchHandler>();
  protected _name: string;
  protected _version: string;
  protected _isRecovery: boolean;
  protected _heartbeatInterval?: ReturnType<typeof setInterval>;


  /**
   * Create a new Hub instance.
   *
   * @example
   * ```typescript
   * const hub = new Hub((hub) => {
   *   // Initialize the hub when it becomes the leader
   *   hub.register(new DatabaseService());
   *   hub.register(new AuthenticationService());
   * });
   * ```
   */
  constructor(public readonly initialize: (hub: Hub) => Promise<void> | void, name?: string, version?: string) {
    super();
    const parts = name ? [] : self.name.split(':');
    this._name = name || parts[0] || 'default';
    this._version = version || parts[1] || '0.0.0';
    this._isRecovery = !name && !!parts[2];

    // Create tab for leadership election and communication
    this.tab = new Tab(`hub/${this.name}/${this.version}`);

    if (this._name && this._version) {
      // Start leadership election if the name and version were provided, otherwise wait to be set in setOptions
      this.initializeLeadership();
    }
  }

  /**
   * Get the name of the hub.
   */
  get name() {
    return this._name;
  }

  /**
   * Get the version of the hub.
   */
  get version() {
    return this._version;
  }

  /**
   * Whether this hub instance is the elected leader.
   */
  get isLeader(): boolean {
    return this.tab.isLeader;
  }

  /**
   * Change the options of the hub.
   * This will change the name and version of the hub and restart the leadership election.
   *
   * @param options - The new options for the hub
   */
  setOptions(options: Required<HubOptions>) {
    this._name = options.name;
    this._version = options.version;
    this.tab.relinquishLeadership();
    this.tab.close();
    this.tab = new Tab(`hub/${this.name}/${this.version}`);
    this.initializeLeadership();
  }

  /**
   * Register a service with the hub.
   * Services will be instantiated only when this hub becomes the leader.
   *
   * @param service - Instance of the service
   * @example
   * ```typescript
   * hub.register(databaseService);
   * hub.register(authenticationService);
   * ```
   */
  register<T extends Service>(service: T): void {
    this.services.set(service.namespace, service);
  }

  /**
   * Set up version mismatch detection and handling.
   * When called, enables cross-version communication to detect when tabs with different
   * versions are present and allows custom handling of the situation.
   *
   * @param handler - Function to call when version mismatch is detected
   * @example
   * ```typescript
   * hub.onVersionMismatch((oldVersion, newVersion) => {
   *   if (hasUnsavedData()) return 'ignore';
   *   return 'refresh';
   * });
   * ```
   */
  onVersionMismatch(handler: VersionMismatchHandler): UnsubscribeFunction {
    this.versionMismatchHandlers.add(handler);
    this.setupVersionDetection();
    return () => this.versionMismatchHandlers.delete(handler);
  }

  /**
   * Send a message to all connected spokes.
   *
   * @param message - Message to send
   * @example
   * ```typescript
   * hub.send({ type: 'user-updated', userId: '123' });
   * ```
   */
  send(message: any): void {
    this.tab.send(message);
  }

  /**
   * Emit an event to all connected spokes for a service.
   * Events are scoped to the service namespace, so only clients of this specific service will receive them.
   *
   * @param namespace - Namespace of the service to emit the event for
   * @param eventName - Name of the event to emit
   * @param payload - Data to send with the event
   * @example
   * ```typescript
   * hub.emit('db', 'user-updated', { userId: '123', changes: {...} });
   * ```
   */
  emit(namespace: string, eventName: string, payload: unknown): void {
    this.send({
      type: 'service-event',
      namespace,
      eventName,
      payload,
    });
  }

  /**
   * Get the state of the hub.
   */
  get state(): Record<string, any> {
    return this.tab.getState();
  }

  /**
   * Updates the state of the hub.
   *
   * @param state - State to update
   * @example
   * ```typescript
   * hub.setState({ connected: true });
   * ```
   */
  updateState(state: Record<string, any>): void {
    const currentState = this.tab.getState();
    this.tab.setState({ ...currentState, ...state });
  }

  /**
   * Close the hub and clean up resources.
   */
  close(): void {
    clearInterval(this._heartbeatInterval);
    this.tab.close();
    this.leader?.close();
    this.leader = null;
    this.versionChannel?.close();
  }

  protected async initializeLeadership() {
    this.tab.addEventListener('leadershipchange', () => {
      const data = { type: 'tab-election:leadership', isLeader: this.tab.isLeader };
      // In a dedicated worker, notify the parent tab via postMessage
      if (typeof window === 'undefined' && 'postMessage' in self) {
        (self as any).postMessage(data);
      }
      // Dispatch locally for in-tab Hub case (Spoke listens via addEventListener)
      this.dispatchEvent(new MessageEvent('message', { data }));
    });

    await this.tab.waitForLeadership(async () => {
      await this.initialize(this);
      this.leader = new Leader(this, this.services);
      await this.leader.init(this);
      this._heartbeatInterval = setInterval(() => {
        this.send({ type: 'tab-election:heartbeat' });
      }, 2000);
      return Object.fromEntries(this.leader.services.entries());
    }, { steal: this._isRecovery });

    clearInterval(this._heartbeatInterval);
    if (this.leader) {
      this.leader.close();
      this.leader = null;
    }
  }

  protected setupVersionDetection(): void {
    if (this.versionChannel) return;

    // Use version-agnostic channel name for cross-version communication
    this.versionChannel = new BroadcastChannel(`hub-version-${this.name}`);

    // Listen for other hub versions starting up
    this.versionChannel.addEventListener('message', event => {
      const { version: otherVersion } = event.data;
      if (otherVersion !== this.version && this.versionMismatchHandlers.size > 0) {
        this.versionMismatchHandlers.forEach(handler => handler(this.version, otherVersion));
      }
    });

    // Announce this hub's version
    this.versionChannel.postMessage({ version: this.version });
  }
}

/**
 * Spoke class - runs in browser tabs to communicate with the hub.
 *
 * The Spoke is responsible for:
 * - Connecting to the hub (via worker or tab communication)
 * - Providing type-safe service client proxies
 * - Handling worker lifecycle (creation, communication)
 * - Forwarding RPC calls to hub services
 */
export class Spoke {
  protected tab: Tab;
  protected worker?: Worker | SharedWorker | Hub;
  protected stubs = new Map<string, ServiceStub<Service>>();
  protected onStateListeners = new Set<EventListener<Record<string, any>>>();
  protected onLeaderChangeListeners = new Set<EventListener<boolean>>();
  protected _isLeader = false;
  protected _workerUrl?: string;
  protected _recoveryAttempt = 0;
  protected _heartbeatTimeout?: ReturnType<typeof setTimeout>;
  protected _lastHeartbeat = 0;

  readonly name: string;
  readonly version?: string;

  /**
   * Create a new Spoke instance.
   *
   * @param options - Configuration options for the spoke
   * @example
   * ```typescript
   * const spoke = new Spoke({
   *   workerUrl: 'hub.js',
   *   name: 'user-123',
   *   version: '1.0.0'
   * });
   * ```
   */
  constructor(options: SpokeOptions) {
    this.name = options.name || 'default';
    this.version = options.version || '0.0.0';
    this.tab = new Tab(`hub/${this.name}/${this.version}`);
    this.tab.addEventListener('state', event => {
      this.onStateListeners.forEach(listener => listener(event.data));
    });

    // Determine worker URL with version parameter
    if (options.workerUrl instanceof Hub) {
      this.worker = options.workerUrl;
      this.worker.setOptions({ name: this.name, version: this.version });
    } else {
      this._workerUrl = options.workerUrl;
      // Create worker and tab for communication
      const name = `${this.name}:${this.version}`;
      if (options.useSharedWorker && 'SharedWorker' in globalThis) {
        this.worker = new SharedWorker(options.workerUrl, { type: 'module', name });
      } else if ('Worker' in globalThis) {
        this.worker = new Worker(options.workerUrl, { type: 'module', name });
      } else {
        throw new Error('No worker available in this environment');
      }
    }

    // Listen for leadership changes from the worker (regular Worker via postMessage,
    // in-tab Hub via EventTarget). SharedWorker is excluded since the spoke doesn't own it.
    if (!(this.worker instanceof SharedWorker)) {
      this.worker.addEventListener('message', ((e: MessageEvent) => {
        if (e.data?.type === 'tab-election:leadership') {
          this._isLeader = e.data.isLeader;
          this.onLeaderChangeListeners.forEach(l => l(e.data.isLeader));
        }
      }) as EventListener);
    }

    // Monitor heartbeats from the hub for worker recovery
    if (this._workerUrl) {
      this._startHeartbeatMonitoring();
    }
  }

  /**
   * Whether this spoke's worker is the elected leader.
   * Always false when using a SharedWorker (the spoke doesn't own it).
   */
  get isLeader(): boolean {
    return this._isLeader;
  }

  /**
   * Get the state of the hub.
   */
  get state(): Record<string, any> {
    return this.tab.getState();
  }

  /**
   * Listen for leadership changes.
   * The listener is called with `true` when this spoke's worker becomes the leader,
   * and `false` when it loses leadership.
   *
   * @param listener - Function to call when leadership changes
   * @returns A function to unsubscribe the listener
   */
  onLeaderChange(listener: EventListener<boolean>): UnsubscribeFunction {
    this.onLeaderChangeListeners.add(listener);
    return () => this.onLeaderChangeListeners.delete(listener);
  }

  /**
   * Listen for state changes on the hub.
   *
   * @param listener - Function to call when state changes
   * @example
   * ```typescript
   * spoke.onState(state => {
   *   console.log('State changed:', state);
   * });
   * ```
   */
  onState(listener: EventListener<Record<string, any>>): UnsubscribeFunction {
    this.onStateListeners.add(listener);
    return () => this.onStateListeners.delete(listener);
  }

  /**
   * Get a type-safe stub for calling methods on a hub service.
   *
   * @param namespace - The namespace of the service to get (must match service's namespace)
   * @returns A proxy object with async versions of all service methods
   * @example
   * ```typescript
   * const db = spoke.getService<DatabaseService>('db');
   * const user = await db.getUser('123'); // Fully typed!
   * await db.saveUser(updatedUser);
   * ```
   */
  getService<T extends Service>(namespace: T['namespace']): ServiceStub<T> {
    if (this.stubs.has(namespace)) {
      return this.stubs.get(namespace) as ServiceStub<T>;
    }

    const on = (eventName: string, listener: EventListener) => {
      const handler = (event: MessageEvent) => {
        if (
          event.data?.type === 'service-event' &&
          event.data?.namespace === namespace &&
          event.data?.eventName === eventName
        ) {
          listener(event.data?.payload);
        }
      };
      this.tab.addEventListener('message', handler);
      return () => this.tab.removeEventListener('message', handler);
    };

    const stub = new Proxy({} as any, {
      get: (_target, prop) => {
        if (typeof prop === 'symbol') {
          throw new Error('Can only call async functions on service stubs');
        }
        if (prop === 'on') {
          return on;
        }
        if (prop === 'then') {
          return undefined;
        }
        return async (...args: any[]) => {
          return this.tab.call(`${namespace}.${prop as string}`, ...args);
        };
      },
    }) as ServiceStub<T>;

    this.stubs.set(namespace, stub);
    return stub;
  }

  /**
   * @deprecated Use `getService()` instead. This method will be removed in a future major version.
   */
  client<T extends Service>(namespace: T['namespace']): ServiceStub<T> {
    return this.getService<T>(namespace);
  }

  /**
   * Close the spoke and clean up resources.
   */
  close(): void {
    clearTimeout(this._heartbeatTimeout);
    if (this.worker instanceof Worker) {
      this.worker.terminate();
    } else if (this.worker instanceof SharedWorker) {
      this.worker.port.close();
    } else if (this.worker instanceof Hub) {
      this.worker.close();
    }
  }

  protected _startHeartbeatMonitoring(): void {
    // Randomized timeout between 5-10s per spoke instance
    const timeout = 5000 + Math.random() * 5000;

    this.tab.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type === 'tab-election:heartbeat') {
        this._lastHeartbeat = Date.now();
      } else if (e.data?.type === 'tab-election:recover' && this.worker instanceof SharedWorker) {
        // SharedWorker recovery broadcasts — all spokes must switch together
        this._recover(e.data.attempt);
      }
    });

    const check = () => {
      this._heartbeatTimeout = setTimeout(() => {
        // Only trigger recovery after receiving at least one heartbeat
        if (this._lastHeartbeat > 0 && Date.now() - this._lastHeartbeat > timeout) {
          if (this.worker instanceof SharedWorker) {
            // SharedWorker: broadcast so all spokes recover together
            const attempt = this._recoveryAttempt + 1;
            this.tab.send({ type: 'tab-election:recover', attempt });
            this._recover(attempt);
          } else if (this.worker instanceof Worker && this._isLeader) {
            // Regular Worker: only recover if this spoke's worker is the hung leader.
            // Terminate releases the lock, another tab's worker takes leadership.
            this._recover(this._recoveryAttempt + 1);
          }
        }
        check();
      }, timeout);
    };
    check();
  }

  protected _recover(attempt: number): void {
    if (attempt <= this._recoveryAttempt) return;
    this._recoveryAttempt = attempt;

    if (this.worker instanceof SharedWorker) {
      this.worker.port.close();
      // New SharedWorker with recovery suffix — same URL, same version,
      // different worker name so the browser creates a new process.
      // The Hub parses the recovery suffix and uses steal:true on the lock.
      const name = `${this.name}:${this.version}:recover-${attempt}`;
      this.worker = new SharedWorker(this._workerUrl!, { type: 'module', name });
    } else if (this.worker instanceof Worker) {
      this.worker.terminate();
      // New Worker — lock was released by terminate, another tab's worker
      // or this new one will take leadership naturally.
      const name = `${this.name}:${this.version}`;
      this.worker = new Worker(this._workerUrl!, { type: 'module', name });
      // Re-attach leadership change listener on the new worker
      this.worker.addEventListener('message', ((e: MessageEvent) => {
        if (e.data?.type === 'tab-election:leadership') {
          this._isLeader = e.data.isLeader;
          this.onLeaderChangeListeners.forEach(l => l(e.data.isLeader));
        }
      }) as EventListener);
    }
  }
}
