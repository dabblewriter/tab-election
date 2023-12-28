export function deepEquals(a, b, visited = new Map()) {
    // Check for cyclic references
    if (visited.has(a)) {
        return visited.get(a) === b;
    }
    visited.set(a, b);
    // Handle null and undefined cases
    if (a == null || b == null) {
        return a === b;
    }
    // Check if the types are different
    if (typeof a !== typeof b) {
        return false;
    }
    // Handle Date objects
    if (a instanceof Date) {
        return b instanceof Date && a.getTime() === b.getTime();
    }
    // Handle RegExp objects
    if (a instanceof RegExp) {
        return b instanceof RegExp && a.toString() === b.toString();
    }
    // Handle Blob, File, and FileList objects (shallow comparison for blobs/files)
    if ((a instanceof Blob || a instanceof File) && (b instanceof Blob || b instanceof File)) {
        return a.size === b.size && a.type === b.type;
    }
    // Handle FileList objects
    if (a instanceof FileList && b instanceof FileList) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEquals(a.item(i), b.item(i), visited)) {
                return false;
            }
        }
        return true;
    }
    // Handle ArrayBuffer and TypedArray objects
    if ((a instanceof ArrayBuffer && b instanceof ArrayBuffer) || (ArrayBuffer.isView(a) && ArrayBuffer.isView(b))) {
        if (a.byteLength !== b.byteLength)
            return false;
        const viewA = new Uint8Array(a instanceof ArrayBuffer ? a : a.buffer);
        const viewB = new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer);
        for (let i = 0; i < viewA.length; i++) {
            if (viewA[i] !== viewB[i])
                return false;
        }
        return true;
    }
    // Handle Map and Set objects
    if (a instanceof Map && b instanceof Map) {
        if (a.size !== b.size)
            return false;
        for (const [key, val] of a.entries()) {
            if (!b.has(key) || !deepEquals(val, b.get(key), visited)) {
                return false;
            }
        }
        return true;
    }
    // Handle Set objects
    if (a instanceof Set && b instanceof Set) {
        if (a.size !== b.size)
            return false;
        for (const item of a) {
            if (!b.has(item)) {
                return false;
            }
        }
        return true;
    }
    // Handle Error objects
    if (a instanceof Error && b instanceof Error) {
        return a.message === b.message && a.name === b.name;
    }
    // Handle ImageData objects
    if (a instanceof ImageData && b instanceof ImageData) {
        if (a.width !== b.width || a.height !== b.height)
            return false;
        return deepEquals(a.data, b.data, visited);
    }
    // Handle objects and arrays recursively
    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = new Set(Object.keys(b));
        if (keysA.length !== keysB.size)
            return false;
        for (const key of keysA) {
            if (!keysB.has(key))
                return false;
            if (!deepEquals(a[key], b[key], visited)) {
                return false;
            }
        }
        return true;
    }
    // Handle primitive types
    return a === b;
}
//# sourceMappingURL=deepEquals.js.map