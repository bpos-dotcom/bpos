const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("bposAgent", {
  version: "1.0.0",
});