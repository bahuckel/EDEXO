"use strict";

/**
 * The foreground watcher's own utility process (foregroundWatch.cjs, watchForegroundOffMain): starts the PowerShell
 * watcher here, off the main process, and passes each change on. Ends with the app; the PowerShell script ends
 * itself once this process is gone.
 */
const { watchForeground } = require("./foregroundWatch.cjs");

const port = process.parentPort;
if (port) watchForeground((name, at) => port.postMessage({ name, at }));
