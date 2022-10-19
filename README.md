# Tab Election

Provides leadership election in the browser across tabs *and* workers using BroadcastChannel. It works in modern browsers. Use a (polyfill)[https://www.npmjs.com/package/broadcastchannel-polyfill] if you need to support older browsers.

It has been optimized so tabs will resolve leadership very quickly, in about 50ms, avoiding a delay in database or server connections and app startup time. After that, when the existing leader is closed, it will take another 50ms to elect a new leader. The exception is when a tab crashes when it may take a second or two.

## Install

```
npm install --save tab-election
```

## API

```js
import { waitForLeadership } from 'tab-election';

waitForLeadership(() => {
  // establish websocket, database connection, or whatever is needed as the leader
});
```

If a tab needs to stop being a leader (or waiting to become one) you can call close on the returned elector and allow garbage collection.

```js
import { waitForLeadership } from 'tab-election';

const tab = waitForLeadership('namespace', () => {
  // establish websocket, database connection, or whatever is needed as the leader
});

// ... sometime later, perhaps a tab is stale or goes into another state that doesn't need/want leadership
tab.close();
```

