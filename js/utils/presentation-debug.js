let diagnosticsTimer = null;

export function logPresentationState() {
    const revealState = window.__RevealState || { initialized: false, ready: false };
    const projectorState = window.__ProjectorConnection || { connected: false };

    console.table({
        initialized: !!revealState.initialized,
        ready: !!revealState.ready,
        projector: !!projectorState.connected
    });
}

export function startPresentationDiagnostics() {
    if (diagnosticsTimer || !window.location.hostname.includes('localhost')) return;

    diagnosticsTimer = window.setInterval(() => {
        logPresentationState();
    }, 5000);
}
