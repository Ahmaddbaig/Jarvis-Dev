#!/usr/bin/env node

const { app, BrowserWindow } = require('electron');

const endpoint = process.env.JARVIS_LOCAL_AI_REALTIME_URL
  || 'http://127.0.0.1:8080/v1/realtime/calls';
const model = process.env.JARVIS_LOCAL_AI_MODEL || 'jarvis-local-m5';

async function testWebRTC() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    // Load a LocalAI page first so the warm-up request is same-origin. This
    // keeps the server's browser CORS allowlist restricted to Jarvis itself.
    await window.loadURL(new URL('/readyz', endpoint).toString());
    return await window.webContents.executeJavaScript(`
      (async () => {
        const pc = new RTCPeerConnection();
        pc.addTransceiver('audio', { direction: 'sendrecv' });
        pc.createDataChannel('oai-events');

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (pc.iceGatheringState !== 'complete') {
            await new Promise((resolve) => {
              const timeout = setTimeout(resolve, 10_000);
              pc.addEventListener('icegatheringstatechange', () => {
                if (pc.iceGatheringState === 'complete') {
                  clearTimeout(timeout);
                  resolve();
                }
              });
            });
          }
          const response = await fetch(${JSON.stringify(endpoint)}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sdp: pc.localDescription?.sdp || offer.sdp || '',
              model: ${JSON.stringify(model)},
            }),
          });
          const body = await response.text();

          if (!response.ok) {
            return { ok: false, status: response.status, error: body.slice(0, 500) };
          }

          const call = JSON.parse(body);
          await pc.setRemoteDescription({ type: 'answer', sdp: call.sdp });
          const connectionState = await new Promise((resolve) => {
            if (pc.connectionState === 'connected') {
              resolve(pc.connectionState);
              return;
            }

            const timeout = setTimeout(() => resolve(pc.connectionState), 20_000);
            pc.addEventListener('connectionstatechange', () => {
              if (pc.connectionState === 'connected' || pc.connectionState === 'failed') {
                clearTimeout(timeout);
                resolve(pc.connectionState);
              }
            });
          });

          return {
            ok: connectionState === 'connected',
            status: response.status,
            connectionState,
            iceConnectionState: pc.iceConnectionState,
            offerCandidateCount: (pc.localDescription?.sdp || '')
              .split('\\r\\n')
              .filter((line) => line.startsWith('a=candidate:')).length,
            answerCandidateCount: (call.sdp || '')
              .split('\\r\\n')
              .filter((line) => line.startsWith('a=candidate:')).length,
          };
        } finally {
          pc.close();
        }
      })()
    `, true);
  } finally {
    window.destroy();
  }
}

app.whenReady()
  .then(testWebRTC)
  .then((result) => {
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());
