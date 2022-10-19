import { waitForLeadership } from './index.js';
const tab = waitForLeadership('test', () => {
  console.log('Became leader!');
});
let lastJson = '';
setInterval(() => {
  const json = JSON.stringify(tab, (key, value) => {
    if (value instanceof Map) return Object.fromEntries(value.entries());
    return value;
  }, '  ');
  if (json !== lastJson) {
    postMessage(json);
    lastJson = json;
  }
}, 50);
