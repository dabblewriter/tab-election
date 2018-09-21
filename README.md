# Tab Election

Provides leadership election, cross tab messaging, and tab data storage in the browser across tabs using localStorage *only*. It works in modern browsers with [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage). It is simplified to make the leadership election algorithm work in this limited environment.

It has been optimized so tabs will resolve leadership very quickly, in about 50ms, avoiding a delay in database or server connections and app startup time. After that, when the existing leader is closed, it will take another 50ms to elect a new leader. The exception is when a tab crashes when it may take several seconds.

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

let tab = waitForLeadership('myApp', () => {
  // establish websocket, database connection, or whatever is needed as the leader
});

// ... sometime later, perhaps a tab is stale or goes into another state that doesn't need/want leadership
tab.close();
```

