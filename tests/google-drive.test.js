import test from "node:test";
import assert from "node:assert/strict";

class FakeButton {
  constructor() {
    this.listeners = {};
    this.dataset = {};
    this.attrs = {};
    this.disabled = false;
    this.textContent = "Connect";
    this.classList = {toggle() {}};
  }
  addEventListener(name, callback) {
    (this.listeners[name] ||= []).push(callback);
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  click() {
    for (const callback of this.listeners.click || []) callback({type: "click", target: this});
  }
}

function installFakeDom({google = null, failGoogleScript = false} = {}) {
  const button = new FakeButton();
  const uploadStatus = {textContent: ""};
  const driveStatus = {textContent: "", dataset: {}};
  let tokenRequests = 0;
  const events = [];

  globalThis.location = {protocol: "https:", origin: "https://fabian97-oss.github.io", hostname: "fabian97-oss.github.io"};
  globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
  globalThis.window = {
    ...(google ? {google} : {}),
    addEventListener() {},
    dispatchEvent(event) { events.push(event.type); }
  };
  globalThis.document = {
    getElementById(id) {
      return id === "google-connect-button" ? button
        : id === "upload-status" ? uploadStatus
          : id === "drive-status" ? driveStatus : null;
    },
    querySelectorAll() { return []; },
    createElement() {
      return {dataset: {}, src: "", async: false, onload: null, onerror: null, remove() {}};
    },
    head: {
      appendChild(script) {
        if (failGoogleScript) queueMicrotask(() => script.onerror?.());
        else queueMicrotask(() => script.onload?.());
      }
    }
  };
  return {button, uploadStatus, driveStatus, events, getTokenRequests: () => tokenRequests, incrementTokenRequests: () => { tokenRequests += 1; }};
}

test("Google-Drive-Button bindet den Klick und fordert ein OAuth-Token an", async () => {
  let testState;
  const google = {accounts: {oauth2: {initTokenClient(config) {
    return {requestAccessToken() {
      testState.incrementTokenRequests();
      config.callback({access_token: "fake-test-token"});
    }};
  }}}};
  testState = installFakeDom({google});
  const {createGoogleDrive} = await import("../js/google-drive.js?google-drive-button-success");
  const drive = createGoogleDrive({
    getMetadata: async () => ({}), setMetadata: async value => value,
    getStoredSongs: async () => [], saveDownloadedSong: async () => {},
    setDriveFileId: async () => {}, deleteLocalSong: async () => {}, refreshLibrary: async () => {},
    waitUntilReady: async () => { throw new Error("TEST_SYNC_STOP"); },
    setStatus: message => { testState.uploadStatus.textContent = message; }
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drive.getDiagnostics().handlerBound, true);
  assert.equal(drive.getDiagnostics().googleSdkLoaded, true);
  assert.equal(testState.button.disabled, false);
  const originalConsoleError = console.error;
  console.error = () => {};
  testState.button.click();
  await new Promise(resolve => setTimeout(resolve, 10));
  console.error = originalConsoleError;
  assert.equal(testState.getTokenRequests(), 1);
  assert.match(testState.uploadStatus.textContent, /TEST_SYNC_STOP/);
  assert.ok(testState.events.includes("myspotify-drive-ready"));
});

test("blockiertes Google-Anmeldescript wird sichtbar gemeldet und kann erneut geladen werden", async () => {
  const testState = installFakeDom({failGoogleScript: true});
  const {createGoogleDrive} = await import("../js/google-drive.js?google-drive-script-failure");
  const drive = createGoogleDrive({
    getMetadata: async () => ({}), setMetadata: async value => value,
    getStoredSongs: async () => [], saveDownloadedSong: async () => {},
    setDriveFileId: async () => {}, deleteLocalSong: async () => {}, refreshLibrary: async () => {},
    waitUntilReady: async () => {}, setStatus: message => { testState.uploadStatus.textContent = message; }
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drive.getDiagnostics().googleSdkLoaded, false);
  assert.equal(testState.button.disabled, false);
  assert.match(testState.driveStatus.textContent, /blockiert oder konnte nicht geladen werden/);
  testState.button.click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(testState.uploadStatus.textContent, /Google Drive kann nicht starten/);
});
