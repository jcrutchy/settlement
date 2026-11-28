"use strict";
// Saving and the secret-gist sync.

const KEY = "settlement_save_v2", CREDS = "settlement_gist_creds", FILE = "settlement_save.json";

const creds = () => JSON.parse(localStorage.getItem(CREDS) || "{}");

function saveLocal() { localStorage.setItem(KEY, JSON.stringify(S)); }

function loadLocal() {
    try { const p = JSON.parse(localStorage.getItem(KEY)); if (p && p.version === 4) return p; } catch (e) { console.error(e); }
    return null;
}

function setStatus(msg, isErr) { const el = $("sync-status"); el.style.color = isErr ? "var(--danger)" : "var(--accent)"; el.textContent = msg; }

function syncUI() {
    const c = creds(), ok = !!(c.token && c.gistId);
    $("pull-gist-btn").style.display = $("push-gist-btn").style.display = ok ? "inline-block" : "none";
}

function loadCredsUI() { const c = creds(); $("gist-token").value = c.token || ""; $("gist-id").value = c.gistId || ""; }

function saveCreds() {
    localStorage.setItem(CREDS, JSON.stringify({ token: $("gist-token").value.trim(), gistId: $("gist-id").value.trim() }));
    syncUI();
}

const gistHeaders = c => ({ Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json" });

async function gistGet(c) {
    const r = await fetch(`https://api.github.com/gists/${c.gistId}`, { headers: gistHeaders(c) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const f = (await r.json()).files[FILE];
    return f && f.content ? JSON.parse(f.content) : null;
}

// Conflict rule: rev counts player actions. cloudRev = the rev we last pulled/pushed.
// If the cloud's rev is higher than that, another device made progress we haven't seen.
async function push(auto) {
    const c = creds(); if (!c.token || !c.gistId) return;
    if (auto && S.rev <= S.cloudRev) return; // nothing new to send
    try {
        if (!auto) setStatus("Checking cloud save...");
        const cloud = await gistGet(c);
        if (cloud && cloud.version === 4 && cloud.rev > S.cloudRev) {
            if (auto) return setStatus("Auto-sync skipped: cloud has progress from another device.", true);
            if (!confirm(`Cloud save has progress from another device (saved ${new Date(cloud.lastTick).toLocaleString()}). Overwrite it with this device?`)) return setStatus("Push cancelled.");
        }
        advance(S); saveLocal();
        const r = await fetch(`https://api.github.com/gists/${c.gistId}`, {
            method: "PATCH", headers: { ...gistHeaders(c), "Content-Type": "application/json" },
            body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(S) } } })
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        S.cloudRev = S.rev; saveLocal();
        setStatus(`Synced at ${new Date().toLocaleTimeString()}.`);
    } catch (e) { setStatus("Push failed: " + e.message, true); }
}

async function pull() {
    const c = creds(); if (!c.token || !c.gistId) return setStatus("Enter token and gist ID first.", true);
    try {
        setStatus("Fetching cloud save...");
        const cloud = await gistGet(c);
        if (!cloud || cloud.version !== 4) throw new Error("No v0.4 save in the gist yet. Push one first.");
        if (S.rev > S.cloudRev && !confirm("This device has progress that hasn't been pushed. Replace it with the cloud save?")) return setStatus("Pull cancelled.");
        S = cloud; S.cloudRev = S.rev; placing = selTile = null; loadState(S); recenter(); advance(S); saveLocal(); renderAll(); renderDisplayUI();
        setStatus("Loaded cloud save.");
    } catch (e) { setStatus("Pull failed: " + e.message, true); }
}
