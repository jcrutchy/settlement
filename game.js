let gameData = null;
let state = {
    version: 1,
    lastTick: Date.now(),
    resources: {},
    unlocks: { resources: {}, jobs: {}, buildings: {} },
    population: 0,
    jobs: {},
    buildings: {},
    logs: ["A clearing in the wilderness. Gather wood to build shelter."]
};

const STORAGE_KEY = "settlement_save_v1";
const CREDS_KEY = "settlement_gist_creds";
const GIST_FILENAME = "settlement_save.json";

// --- INITIALIZATION ---
async function init() {
    const res = await fetch("gamedata.json");
    gameData = await res.json();
    document.getElementById("game-title").textContent = gameData.meta.title;

    initDefaultState();
    loadLocalSave();
    loadCredsUI();
    updateSyncUIState();
    bindEvents();
    calculateOfflineProgress();

    checkUnlocks();
    renderAll();

    setInterval(tick, gameData.meta.tickRateMs);
    setInterval(saveLocal, gameData.meta.autoSaveMs);
}

function initDefaultState() {
    gameData.resources.forEach(r => {
        state.resources[r.id] = r.initial || 0;
        state.unlocks.resources[r.id] = !!r.unlocked;
    });
    gameData.jobs.forEach(j => {
        state.jobs[j.id] = 0;
        state.unlocks.jobs[j.id] = !j.unlockReq;
    });
    gameData.buildings.forEach(b => {
        state.buildings[b.id] = 0;
        state.unlocks.buildings[b.id] = !!b.unlocked;
    });
}

// --- STATE SANITIZATION (SCHEMA MIGRATION) ---
function sanitizeState() {
    gameData.resources.forEach(r => {
        if (state.resources[r.id] === undefined) {
            state.resources[r.id] = r.initial || 0;
            state.unlocks.resources[r.id] = !!r.unlocked;
        }
    });

    gameData.jobs.forEach(j => {
        if (state.jobs[j.id] === undefined) {
            state.jobs[j.id] = 0;
            state.unlocks.jobs[j.id] = !j.unlockReq;
        }
    });

    gameData.buildings.forEach(b => {
        if (state.buildings[b.id] === undefined) {
            state.buildings[b.id] = 0;
            state.unlocks.buildings[b.id] = !!b.unlocked;
        }
    });
}

// --- CORE SIMULATION LOOP ---
function tick(deltaSeconds = 1) {
    const now = Date.now();
    state.lastTick = now;

    // 1. Housing & Population Growth
    const maxPop = getMaxHousing();
    if (state.population < maxPop && state.resources.food >= 5) {
        if (Math.random() < 0.15 * deltaSeconds) {
            state.population++;
            addLog("A new settler arrived at your camp.");
        }
    }

    // 2. Food Consumption & Starvation Check
    const foodNeeded = state.population * 0.5 * deltaSeconds;
    state.resources.food -= foodNeeded;
    if (state.resources.food < 0) {
        state.resources.food = 0;
        if (state.population > 0 && Math.random() < 0.2) {
            state.population--;
            unassignExcessWorkers();
            addLog("Starvation! A settler has abandoned the camp.");
        }
    }

    // 3. Worker Production
    const foodMultiplier = 1 + (state.buildings.granary || 0) * 0.2;
    gameData.jobs.forEach(job => {
        const count = state.jobs[job.id] || 0;
        if (count > 0) {
            let output = count * job.rate * deltaSeconds;
            if (job.produces === "food") output *= foodMultiplier;
            state.resources[job.produces] += output;
        }
    });

    // 4. Evaluate Unlocks
    checkUnlocks();
    renderDynamic();
}

function calculateOfflineProgress() {
    const elapsedSec = Math.floor((Date.now() - state.lastTick) / 1000);
    if (elapsedSec > 5) {
        const simSec = Math.min(elapsedSec, 28800);
        tick(simSec);
        addLog(`Welcome back. Simulated ${simSec}s of offline progress.`);
    }
}

function checkUnlocks() {
    const checkReq = (req) => !req || (state.resources[req.resource] || 0) >= req.amount;

    gameData.resources.forEach(r => {
        if (!state.unlocks.resources[r.id] && checkReq(r.unlockReq)) {
            state.unlocks.resources[r.id] = true;
            addLog(`Discovered resource: ${r.name}.`);
            renderAll();
        }
    });

    gameData.jobs.forEach(j => {
        if (!state.unlocks.jobs[j.id] && checkReq(j.unlockReq)) {
            state.unlocks.jobs[j.id] = true;
            addLog(`New role available: ${j.name}.`);
            renderAll();
        }
    });

    gameData.buildings.forEach(b => {
        if (!state.unlocks.buildings[b.id] && checkReq(b.unlockReq)) {
            state.unlocks.buildings[b.id] = true;
            addLog(`New structure unlocked: ${b.name}.`);
            renderAll();
        }
    });
}

// --- PLAYER ACTIONS ---
function gatherManual(resId) {
    state.resources[resId] = (state.resources[resId] || 0) + 1;
    checkUnlocks();
    renderDynamic();
}

function adjustJob(jobId, delta) {
    const idle = getIdlePop();
    if (delta > 0 && idle > 0) {
        state.jobs[jobId]++;
    } else if (delta < 0 && state.jobs[jobId] > 0) {
        state.jobs[jobId]--;
    }
    renderDynamic();
}

function buildStructure(bId) {
    const bDef = gameData.buildings.find(b => b.id === bId);
    const cost = getBuildingCost(bDef);
    if (!canAfford(cost)) return;

    Object.entries(cost).forEach(([res, amt]) => {
        state.resources[res] -= amt;
    });
    state.buildings[bId]++;
    addLog(`Constructed ${bDef.name} (${state.buildings[bId]}).`);
    renderAll();
}

// --- HELPERS ---
function getMaxHousing() {
    return (state.buildings.hut || 0) * 2 + (state.buildings.cabin || 0) * 5;
}

function getIdlePop() {
    const assigned = Object.values(state.jobs).reduce((a, b) => a + b, 0);
    return Math.max(0, state.population - assigned);
}

function unassignExcessWorkers() {
    while (getIdlePop() < 0 || Object.values(state.jobs).reduce((a, b) => a + b, 0) > state.population) {
        const activeJob = Object.keys(state.jobs).find(k => state.jobs[k] > 0);
        if (activeJob) state.jobs[activeJob]--;
        else break;
    }
}

function getBuildingCost(bDef) {
    const count = state.buildings[bDef.id] || 0;
    const cost = {};
    Object.entries(bDef.baseCost).forEach(([res, base]) => {
        cost[res] = Math.floor(base * Math.pow(bDef.costMultiplier, count));
    });
    return cost;
}

function canAfford(cost) {
    return Object.entries(cost).every(([res, amt]) => (state.resources[res] || 0) >= amt);
}

function addLog(msg) {
    state.logs.unshift(`[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${msg}`);
    if (state.logs.length > 20) state.logs.pop();
    renderLogs();
}

// --- UI RENDERING ---
function renderAll() {
    renderLogs();

    const resContainer = document.getElementById("resources-list");
    const btnContainer = document.getElementById("manual-actions");
    resContainer.innerHTML = "";
    btnContainer.innerHTML = "";

    gameData.resources.forEach(r => {
        if (!state.unlocks.resources[r.id]) return;
        resContainer.innerHTML += `
            <div class="stat-card">
                <span>${r.icon} ${r.name}</span>
                <strong id="res-val-${r.id}">0</strong>
            </div>`;
        const btn = document.createElement("button");
        btn.textContent = `+ Gather ${r.name}`;
        btn.onclick = () => gatherManual(r.id);
        btnContainer.appendChild(btn);
    });

    const jobsContainer = document.getElementById("jobs-list");
    jobsContainer.innerHTML = "";
    gameData.jobs.forEach(j => {
        if (!state.unlocks.jobs[j.id]) return;
        const row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML = `
            <div class="row-info">
                <strong>${j.name}</strong>
                <span>+${j.rate}/s ${j.produces}</span>
            </div>
            <div class="button-row" style="align-items:center;">
                <button onclick="adjustJob('${j.id}', -1)">-</button>
                <span class="badge" id="job-val-${j.id}">0</span>
                <button onclick="adjustJob('${j.id}', 1)">+</button>
            </div>`;
        jobsContainer.appendChild(row);
    });

    const bldContainer = document.getElementById("buildings-list");
    bldContainer.innerHTML = "";
    gameData.buildings.forEach(b => {
        if (!state.unlocks.buildings[b.id]) return;
        const cost = getBuildingCost(b);
        const costStr = Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(", ");
        const row = document.createElement("div");
        row.className = "row-item";
        row.innerHTML = `
            <div class="row-info">
                <strong>${b.name} (${state.buildings[b.id] || 0})</strong>
                <span>${b.desc} • Cost: ${costStr}</span>
            </div>
            <button id="bld-btn-${b.id}" onclick="buildStructure('${b.id}')">Build</button>`;
        bldContainer.appendChild(row);
    });

    renderDynamic();
}

function renderDynamic() {
    gameData.resources.forEach(r => {
        const el = document.getElementById(`res-val-${r.id}`);
        if (el) el.textContent = Math.floor(state.resources[r.id] || 0);
    });

    document.getElementById("pop-counter").textContent = `${state.population} / ${getMaxHousing()}`;
    document.getElementById("idle-pop").textContent = getIdlePop();

    gameData.jobs.forEach(j => {
        const el = document.getElementById(`job-val-${j.id}`);
        if (el) el.textContent = state.jobs[j.id] || 0;
    });

    gameData.buildings.forEach(b => {
        const btn = document.getElementById(`bld-btn-${b.id}`);
        if (btn) btn.disabled = !canAfford(getBuildingCost(b));
    });
}

function renderLogs() {
    const box = document.getElementById("log-panel");
    box.innerHTML = state.logs.map(l => `<div class="log-entry">${l}</div>`).join("");
}

// --- LOCAL & SECRET GIST PERSISTENCE ---
function saveLocal() {
    state.lastTick = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadLocalSave() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            state = { ...state, ...parsed };
            sanitizeState();
        } catch (e) {
            console.error("Failed to parse local save", e);
        }
    }
}

function loadCredsUI() {
    const creds = JSON.parse(localStorage.getItem(CREDS_KEY) || "{}");
    if (creds.token) document.getElementById("gist-token").value = creds.token;
    if (creds.gistId) document.getElementById("gist-id").value = creds.gistId;
}

function saveCredsAuto() {
    const token = document.getElementById("gist-token").value.trim();
    const gistId = document.getElementById("gist-id").value.trim();
    localStorage.setItem(CREDS_KEY, JSON.stringify({ token, gistId }));
    updateSyncUIState();
}

function updateSyncUIState() {
    const creds = JSON.parse(localStorage.getItem(CREDS_KEY) || "{}");
    const hasCreds = !!(creds.token && creds.gistId);

    const pullBtn = document.getElementById("pull-gist-btn");
    const pushBtn = document.getElementById("push-gist-btn");

    if (hasCreds) {
        pullBtn.style.display = "inline-block";
        pushBtn.style.display = "inline-block";
        pushBtn.disabled = false;
        pushBtn.title = "";
    } else {
        pullBtn.style.display = "none";
        pushBtn.style.display = "none";
    }
}

function setSyncStatus(msg, isError = false) {
    const el = document.getElementById("sync-status");
    el.style.color = isError ? "var(--danger)" : "var(--accent)";
    el.textContent = msg;
}

async function pushToGist(isAuto = false) {
    const creds = JSON.parse(localStorage.getItem(CREDS_KEY) || "{}");
    if (!creds.token || !creds.gistId) return;

    saveLocal();
    if (!isAuto) setSyncStatus("Checking cloud state before push...");
    
    try {
        const checkRes = await fetch(`https://api.github.com/gists/${creds.gistId}`, {
            headers: {
                "Authorization": `Bearer ${creds.token}`,
                "Accept": "application/vnd.github+json"
            }
        });
        
        if (checkRes.ok) {
            const data = await checkRes.json();
            const fileContent = data.files[GIST_FILENAME]?.content;
            if (fileContent) {
                const cloudState = JSON.parse(fileContent);
                if (cloudState.lastTick && cloudState.lastTick > state.lastTick + 5000 && !isAuto) {
                    const localTime = new Date(state.lastTick).toLocaleTimeString();
                    const cloudTime = new Date(cloudState.lastTick).toLocaleTimeString();
                    if (!confirm(`Warning: Cloud save is newer (${cloudTime}) than this device (${localTime}). Overwrite cloud with this device's progress?`)) {
                        setSyncStatus("Push canceled to prevent overwriting newer progress.");
                        return;
                    }
                }
            }
        }

        if (!isAuto) setSyncStatus("Pushing save to Secret Gist...");
        const res = await fetch(`https://api.github.com/gists/${creds.gistId}`, {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${creds.token}`,
                "Accept": "application/vnd.github+json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                files: { [GIST_FILENAME]: { content: JSON.stringify(state, null, 2) } }
            })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!isAuto) setSyncStatus(`Synced to Gist at ${new Date().toLocaleTimeString()}.`);
    } catch (err) {
        if (!isAuto) setSyncStatus(`Push failed: ${err.message}`, true);
    }
}

async function pullFromGist() {
    const creds = JSON.parse(localStorage.getItem(CREDS_KEY) || "{}");
    if (!creds.token || !creds.gistId) return setSyncStatus("Enter Token & Gist ID first.", true);

    setSyncStatus("Fetching save from Secret Gist...");
    try {
        const res = await fetch(`https://api.github.com/gists/${creds.gistId}`, {
            headers: {
                "Authorization": `Bearer ${creds.token}`,
                "Accept": "application/vnd.github+json"
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const fileContent = data.files[GIST_FILENAME]?.content;
        if (!fileContent) throw new Error(`File ${GIST_FILENAME} not found in Gist.`);

        const cloudState = JSON.parse(fileContent);

        if (cloudState.lastTick && state.lastTick && cloudState.lastTick < state.lastTick - 5000) {
            const localTime = new Date(state.lastTick).toLocaleTimeString();
            const cloudTime = new Date(cloudState.lastTick).toLocaleTimeString();
            if (!confirm(`Warning: Your local save is newer (${localTime}) than the cloud save (${cloudTime}). Overwrite local with cloud?`)) {
                setSyncStatus("Pull canceled.");
                return;
            }
        }

        state = cloudState;
        sanitizeState();
        saveLocal();
        calculateOfflineProgress();
        renderAll();
        setSyncStatus(`Loaded cloud save from ${new Date(state.lastTick).toLocaleTimeString()}.`);
    } catch (err) {
        setSyncStatus(`Pull failed: ${err.message}`, true);
    }
}

function bindEvents() {
    document.getElementById("toggle-sync-btn").onclick = () => {
        document.getElementById("sync-panel").classList.toggle("hidden");
    };

    document.getElementById("gist-token").oninput = saveCredsAuto;
    document.getElementById("gist-id").oninput = saveCredsAuto;

    document.getElementById("push-gist-btn").onclick = () => pushToGist(false);
    document.getElementById("pull-gist-btn").onclick = pullFromGist;

    document.getElementById("local-save-btn").onclick = () => {
        saveLocal();
        addLog("Game saved locally.");
    };
    document.getElementById("hard-reset-btn").onclick = () => {
        if (confirm("Wipe local save and restart?")) {
            localStorage.removeItem(STORAGE_KEY);
            location.reload();
        }
    };

    window.addEventListener("beforeunload", () => {
        saveLocal();
        const creds = JSON.parse(localStorage.getItem(CREDS_KEY) || "{}");
        if (creds.token && creds.gistId) {
            fetch(`https://api.github.com/gists/${creds.gistId}`, {
                method: "PATCH",
                keepalive: true,
                headers: {
                    "Authorization": `Bearer ${creds.token}`,
                    "Accept": "application/vnd.github+json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    files: { [GIST_FILENAME]: { content: JSON.stringify(state, null, 2) } }
                })
            }).catch(() => {});
        }
    });
}

init();
