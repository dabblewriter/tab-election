import { createNodeId } from './utils';

const METADATA_HEARTBEAT = 500;
const METADATA_MAX = 2000;

/**
 * Create a metadata consumer to set metadata for this tab and get the metadata from other tabs. Call subscribe() to
 * start listening and close() to disconnect.
 */
export default class Metadata {

  constructor(name) {
    this.name = name;
    this.nodeId = createNodeId();
    this.timeout = 0;
    this.callback = null;
    this.close = this.close.bind(this);
    this.version = 0;
    this.source = {};
    this.metadata = {};
    this.data = {};
    this.subscribers = [];

    this.watchMetadata();
    this.set(this.data);
    window.addEventListener('unload', this.close);
  }

  /**
   * Subscribe to changes in the node metadata.
   * @param  {Function} callback A function that is called whenever node metadata is changed on any node.
   * @return {Function} A function to cancel the subscription.
   */
  subscribe(callback) {
    this.subscribers.push(callback);
    return function cancel() {
      const index = this.subscribers.indexOf(callback);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }

  /**
   * Sets the metadata for this node.
   * @param  {Object} metadata The metadata for this node.
   * @return {Metadata} A reference to itself.
   */
  set(data) {
    this.data = Object.assign(this.data, data);
    const metadata = getMetadata(this.name);
    const thisNode = metadata[this.nodeId] || (metadata[this.nodeId] = {});
    thisNode.timestamp = Date.now();
    thisNode.version = this.version++;
    thisNode.data = this.data;
    setMetadata(this.name, metadata);

    // Send updates locally immediately
    this.source = metadata;
    this.metadata[this.nodeId] = this.data;
    this.subscribers.forEach(fn => fn.call(this, this.metadata, { [this.nodeId]: this.data }));

    return this;
  }

  /**
   * Close this leader elector. To restart it, you must call waitForLeadership again.
   */
  close() {
    clearTimeout(this.timeout);
    window.removeEventListener('unload', this.close);
    const metadata = getMetadata(this.name);
    delete metadata[this.nodeId];
    setMetadata(this.name, metadata);
  }


  watchMetadata() {

    const heartbeat = () => {
      const metadata = getMetadata(this.name);
      const now = Date.now();
      const changed = {};

      // Look for changes and clean up old nodes
      Object.keys(metadata).forEach(nodeId => {
        const entry = metadata[nodeId];
        if (now - entry.timestamp > METADATA_MAX) {
          changed[nodeId] = null;
          delete metadata[nodeId];
        } else {
          if (!this.source[nodeId] || this.source[nodeId].version < entry.version) {
            changed[nodeId] = entry.data;
          }
        }
      });

      // Update our timestamp
      const thisNode = metadata[this.nodeId] || (metadata[this.nodeId] = {
        timestamp: 0,
        version: this.version,
        data: {}
      });
      thisNode.timestamp = Date.now();
      setMetadata(this.name, metadata);

      // Dispatch update if there was one
      if (Object.keys(changed).length) {
        this.source = metadata;
        this.metadata = {};
        Object.keys(metadata).forEach(nodeId => this.metadata[nodeId] = metadata[nodeId].data);
        this.subscribers.forEach(fn => fn.call(this, this.metadata, changed));
      }

      this.timeout = setTimeout(heartbeat, METADATA_HEARTBEAT);
    };

    heartbeat();
  }
}


function getMetadata(name) {
  return JSON.parse(localStorage.getItem(`tab-metadata:${name}`) || '{}');
}

function setMetadata(name, metadata) {
  localStorage.setItem(`tab-metadata:${name}`, JSON.stringify(metadata));
}
