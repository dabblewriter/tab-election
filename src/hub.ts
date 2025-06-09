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
 * - Flexible service registration and client proxy generation
 *
 * @example
 * ```typescript
 * // Define a service class
 * class DatabaseService extends Service {
 *   private db: IDBDatabase;
 *
 *   async init(hub: Hub): Promise<void> {
 *     this.db = await openDB(`app-${hub.name}`);
 *   }
 *
 *   async getUser(id: string): Promise<User> {
 *     // Database operations...
 *   }
 *
 *   async saveUser(user: User): Promise<void> {
 *     // Database operations...
 *     this.emit('user-saved', { user }); // Emit events to all connected spokes
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
 * const db = spoke.client<DatabaseService>('db');
 * const user = await db.getUser('123'); // Fully typed!
 *
 * // Listen for events from the service
 * const unsubscribe = db.on('user-saved', (payload) => {
 *   console.log('User was saved:', payload.user);
 * });
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
 * Base service class that provides event emission capabilities.
 * All services should extend this class to enable event-driven communication with spokes.
 */
export interface Service {
  readonly namespace: string;

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

export type Client<T extends Service> = AllMethodsAsync<Omit<T, 'init' | 'close'>> & {
  on<T = unknown>(eventName: string, listener: EventListener<T>): UnsubscribeFunction;
};

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
export class Hub {
  protected services = new Map<string, Service>();
  protected tab: Tab;
  protected leader: Leader | null = null;
  protected versionChannel?: BroadcastChannel;
  protected versionMismatchHandlers = new Set<VersionMismatchHandler>();
  protected _name: string;
  protected _version: string;


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
  constructor(public readonly initialize: (hub: Hub) => Promise<void> | void) {
    const url = new URL(location.href);
    this._name = url.searchParams.get('hub-name') || '';
    this._version = url.searchParams.get('hub-version') || '';

    // Create tab for leadership election and communication
    const tabName = `hub/${this.name}/${this.version}`;
    this.tab = new Tab(tabName);

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
    this.tab.close();
    this.leader?.close();
    this.leader = null;
    this.versionChannel?.close();
  }

  protected async initializeLeadership() {
    await this.tab.waitForLeadership(async () => {
      await this.initialize(this);
      this.leader = new Leader(this, this.services);
      await this.leader.init(this);
      return Object.fromEntries(this.leader.services.entries());
    });

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
  protected clients = new Map<string, Client<Service>>();
  protected onStateListeners = new Set<EventListener<Record<string, any>>>();

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
    this.tab = new Tab(`${this.name}/${this.version}`);
    this.tab.addEventListener('state', event => {
      this.onStateListeners.forEach(listener => listener(event.data));
    });

    // Determine worker URL with version parameter
    if (options.workerUrl instanceof Hub) {
      this.worker = options.workerUrl;
      this.worker.setOptions({ name: this.name, version: this.version });
    } else {
      const url = new URL(options.workerUrl, location.href);
      url.searchParams.set('hub-name', this.name);
      url.searchParams.set('hub-version', this.version);

      // Determine if we should use SharedWorker
      const useSharedWorker = options.useSharedWorker ?? url.searchParams.has('shared');

      // Create worker and tab for communication
      if (useSharedWorker && 'SharedWorker' in globalThis) {
        this.worker = new SharedWorker(url.href);
      } else if ('Worker' in globalThis) {
        this.worker = new Worker(url.href);
      } else {
        throw new Error('No worker available in this environment');
      }
    }
  }

  /**
   * Get the state of the hub.
   */
  get state(): Record<string, any> {
    return this.tab.getState();
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
   * Get a type-safe client proxy for calling methods on a hub service.
   *
   * @param namespace - The namespace of the service to create a client for (must match service's namespace)
   * @returns A proxy object with async versions of all service methods
   * @example
   * ```typescript
   * const db = spoke.client<DatabaseService>('db');
   * const user = await db.getUser('123'); // Fully typed!
   * await db.saveUser(updatedUser);
   * ```
   */
  client<T extends Service>(namespace: T['namespace']): Client<T> {
    if (this.clients.has(namespace)) {
      return this.clients.get(namespace) as Client<T>;
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

    const client = new Proxy({} as any, {
      get: (_target, prop) => {
        if (typeof prop === 'symbol') {
          throw new Error('Can only call async functions on service clients');
        }
        if (prop === 'on') {
          return on;
        }
        return async (...args: any[]) => {
          return this.tab.call(`${namespace}.${prop as string}`, ...args);
        };
      },
    }) as Client<T>;

    this.clients.set(namespace, client);
    return client;
  }

  /**
   * Close the spoke and clean up resources.
   */
  close(): void {
    if (this.worker instanceof Worker) {
      this.worker.terminate();
    } else if (this.worker instanceof SharedWorker) {
      this.worker.port.close();
    } else if (this.worker instanceof Hub) {
      this.worker.close();
    }
  }
}
