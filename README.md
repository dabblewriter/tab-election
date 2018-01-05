# Tab Election

Provides leadership election in the browser across tabs using localStorage *only*. It works across any browser with localStorage. It was able to be made very small by simplifying the leadership election algorithm which only needs to work in this limited environment.

It has been optimized so the first tab(s) open will resolve leadership very quickly, in less than 100ms, avoiding a delay in database or server connections and app startup time. After that, when the existing leader is closed, it will take a few seconds to elect a new leader. This is a necessity because the throttle on setTimeout (and other timing functions in JavaScript) that most browsers place on tabs which are not visible/active requires a longer heartbeat than I would like.

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

You can have multiple channels by providing a name to your election. Each channel will have its own leadership election independent of others, so one tab could be a leader for one channel but not another. This can help avoid collisions if other code in your app might use tab-election as well.

```js
import { waitForLeadership } from 'tab-election';

waitForLeadership('myApp', () => {
  // establish websocket, database connection, or whatever is needed as the leader
});
```

If a tab needs to stop being a leader (or waiting to become one) you can call close on the returned elector and allow garbage collection.

```js
import { waitForLeadership } from 'tab-election';

let elector = waitForLeadership('myApp', () => {
  // establish websocket, database connection, or whatever is needed as the leader
});

// ... sometime later, perhaps a tab is stale or goes into another state that doesn't need/want leadership
elector.close();
```

