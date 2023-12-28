import { Tab } from './index.js';
const tab = new Tab('test');
tab.waitForLeadership(() => {
  console.log('Became leader!');
});
let lastText = '';
setInterval(() => {
  const text = tab.isLeader ? 'Leader' : 'Not leader';
  if (text !== lastText) {
    console.log(text);
    postMessage(text);
    lastText = text;
  }
}, 50);
