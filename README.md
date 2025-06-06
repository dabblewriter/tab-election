# Tab Election

Provides leadership election and communication in the browser across tabs *and* workers using the Locks API and BroadcastChannel. It works in modern browsers.

The [Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) allows us to have a very reliable leadership election, with virtually no delay in database or server connections and app startup time. When the existing leader is closed, the next tab will become the new leader immediately. The Tab interface allows calls and messages to be queued before a leader is elected and sent afterwards. The Tab interface supports everything you need to have all tabs communicate with one leader for loading, saving, and syncing data between tabs, including calling API methods the leader provides, broadcasting messages to other tabs, and state syncing.

## Install

```
npm install --save tab-election
```

## API

```js
import { Tab } from 'tab-election';

const tab = new Tab();

tab.waitForLeadership(() => {
  // establish websocket, database connection, or whatever is needed as the leader
});
```

If a tab needs to stop being a leader (or waiting to become one) you can call `tab.relinquishLeadership()` or the
function passed into `tab.waitForLeadership((relinquishLeadership) => { })`. To completely close all connections with
other tabs and allow for garbage collection, call `tab.close()`.

```js
import { Tab } from 'tab-election';

const tab = new Tab('namespace');

tab.waitForLeadership((relinquishLeadership) => {
  // establish websocket, database connection, or whatever is needed as the leader, return an API
  return {
    async loadData() {
      // return await db.load(...);
    },
    letItGo() {
      relinquishLeadership();
    }
  }
});

if (somethingHappens) {
  tab.relinquishLeadership();
}

// ... sometime later, perhaps a tab is stale or goes into another state that doesn't need/want leadership
tab.close();
```

The `tab.waitForLeadership()` method can be async. Calls to the leader will be queued while the API is initialized. The
`waitForLeadership` method returns a promise which will resolve with a `boolean`. If resolved with `true`, the
leadership was relinquished while the tab was the leader. When `false`, it was relinquished before taking leadership.

```js
import { Tab } from 'tab-election';

const tab = new Tab('namespace');

tab.waitForLeadership(async () => {
  // establish websocket, database connection, or whatever is needed as the leader, return an API
  return {
    async loadData() {
      // return await db.load(...);
    },
  }
}).then(wasLeader => {
  console.log('This tab the current leader:', wasLeader);
}, error => {
  console.error('There was an error initializing the leader API', error);
});
```

Errors thrown within API methods will be returned to the caller and thrown in that context. E.g. if a tab calls

```js
import { Tab } from 'tab-election';

const tab = new Tab('namespace');

tab.waitForLeadership(async () => {
  // establish websocket, database connection, or whatever is needed as the leader, return an API
  return {
    async loadData() {
      // This exception is forwarded on to the caller to handle
      throw new Error('Cannot load the data');
    },
  }
});

async function loadData() {
  try {
    // This will recieve an error 'Cannot load the data' from the leader and can be handled here
    return await tab.call('loadData');
  } catch(err) {
    console.error('Error loading data from leader', err);
  }
}
```

To communicate between tabs, send and receive messages.

```js
import { Tab } from 'tab-election';

const tab = new Tab('namespace');

tab.addEventListener('message', event => console.log(event.data));
tab.send('This is a test'); // will not send to self, only to other tabs
```

To keep state (any important data) between the current leader and the other tabs, use `state()`. Use this to let the
other tabs know when the leader is syncing, whether it is online, or if any errors have occured. `state()` will return
the current state of the leader and `state(data)` will set the current state if the tab is the current leader.

The state object can contain anything that is supported by the [Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
including Dates, RegExes, Sets, and Maps.

```js
import { Tab } from 'tab-election';

const tab = new Tab('namespace');

tab.waitForLeadership(() => {
  // establish websocket, database connection, or whatever is needed as the leader
  tab.setState({ connected: false });
  // connect to the server ...
  tab.setState({ connected: true });
});

tab.addEventListener('state', event => console.log('The leader is connected to the server?', event.data.connected));
```

To allow tabs to call methods on the leader (including the leader), use the `call()` method. The return result is always
asyncronous. The API that is callable should be returned from the `waitForLeadership` callback. If the leader has
established a connection to the server and/or database, this may be used for other tabs to get/save data through that
single connection.

```js
import { Tab } from 'tab-election';

const tab = new Tab('namespace');

tab.waitForLeadership(async () => {
  // Can have async instructions here. Calls to `call` in any tab will be queued until the API is returned.
  const db = await connectToTheDatabase();
  return { db };
});

const result = await tab.call('db.saveRecord', { myData: 'foobar' });
if (result === true) {
  console.log('Successfully saved');
}
```

If a tab wants to make calls to the leader, send and receive messages, and know the state, but it does not want to ever
become the leader, then don't call `waitForLeadership`. This is useful when workers are used for leadership and UI
contexts make the requests and display state.

```js
import { Tab } from 'tab-election';

const tab = new Tab('namespace');

const result = await tab.call('saveData', { myData: 'foobar' });
if (result === true) {
  console.log('Successfully saved');
}
```

## Hub & Spoke Architecture

For more complex applications, tab-election provides a Hub & Spoke architecture that simplifies multi-tab coordination with type-safe service registration and RPC communication. The Hub runs in a SharedWorker, WebWorker, or elected tab to manage shared services, while Spokes in each tab communicate with the Hub through typed proxies.

### Type-Safe Service Definition

Services must define a static `namespace` property for compile-time safety:

```typescript
import { Hub, Spoke, Service } from 'tab-election';

// Define a service class with required static namespace
class DatabaseService extends Service {
  readonly namespace = 'db';

  async init() {
    this.db = await openDatabase();
  }

  async getUser(id: string): Promise<User> {
    return await this.db.get('users', id);
  }

  async saveUser(user: User): Promise<void> {
    await this.db.put('users', user);
    this.emit('user-saved', { user }); // Notify all connected tabs
  }
}

class AuthService extends Service {
  readonly namespace = 'auth';

  async login(credentials: LoginData): Promise<Token> {
    // Authentication logic...
  }
}
```

### Hub Setup (in SharedWorker or elected tab)

```typescript
const hub = new Hub({ name: 'app-session', version: '1.0.0' });

// Type-safe registration - namespace must match service's static namespace
hub.register('db', DatabaseService);
hub.register('auth', AuthService);
hub.register('wrong', DatabaseService);  // ❌ TypeScript error, namespace must match (safety feature)
```

### Spoke Setup (in each tab)

```typescript
const spoke = new Spoke({
  workerUrl: 'hub.js',
  name: 'app-session',
  version: '1.0.0'
});

// Type-safe client access - fully typed methods and return values
const db = spoke.client<DatabaseService>('db');
const auth = spoke.client<AuthService>('auth');
const auth = spoke.client<AuthService>('wrong'); // ❌ TypeScript error, namespace must match (safety feature)

// All method calls are fully typed
const user = await db.getUser('123');           // Returns Promise<User>
const token = await auth.login(credentials);    // Returns Promise<Token>

// Listen for service events
const unsubscribe = db.on('user-saved', (payload) => {
  console.log('User was updated:', payload.user);
});
```

### Type Safety Benefits

- **Compile-time namespace validation**: Impossible to mismatch namespace strings with service classes
- **Full type inference**: Method signatures, parameters, and return types are all preserved
- **IntelliSense support**: Full autocomplete and type checking in your IDE
- **Refactoring safety**: Renaming methods or changing signatures is caught at compile time

The Hub & Spoke pattern is ideal when you need centralized resource management, type-safe inter-tab communication, or want to isolate heavy operations in a worker thread.
