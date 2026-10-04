/**
 * KPI Motivation Pro - Workflow Manager Logic
 */

const DEFAULT_API = "https://script.google.com/a/macros/holcim.com/s/AKfycbz1liY1_0n9j1wBNS9oY_eetSVZ96NIAYwAHg7jIGQvf75KJ7bumPhXZ0Hpr45iLwPz1Q/exec";

let appState = {
    url: localStorage.getItem('api_url') || DEFAULT_API,
    tasks: [],
    collabMap: {},
    filteredTasks: [],
    selectedIds: new Set(),
    currentTargetPlanner: null, // Verouille la sélection au Planner sélectionné
    charts: { planners: null, categories: null }
};

document.addEventListener("DOMContentLoaded", () => {
    initUI();
    if (appState.url) {
        document.getElementById('api-url').value = appState.url;
        fetchData();
    } else {
        showToast("⚠️ Spécifiez l'URL du backend Apps Script pour commencer.", "error");
    }
});

function initUI() {
    // Navigation
    document.querySelectorAll('.nav-links li').forEach(link => {
        link.addEventListener('click', () => {
            document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const viewTarget = link.getAttribute('data-view');
            document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
            document.getElementById('view-' + viewTarget).classList.add('active');
        });
    });

    // Inputs bindings
    document.getElementById('btn-sync').addEventListener('click', () => {
        const inputUrl = document.getElementById('api-url').value.trim();
        if(inputUrl) {
           appState.url = inputUrl;
           localStorage.setItem('api_url', inputUrl);
           fetchData();
        }
    });

    // Filters bindings
    const filterIds = ['search-bar', 'flt-plant', 'flt-planner', 'flt-workcenter', 'flt-category'];
    filterIds.forEach(id => {
        document.getElementById(id).addEventListener('input', applyFilters);
    });
    document.getElementById('btn-reset-filters').addEventListener('click', () => {
        filterIds.forEach(id => document.getElementById(id).value = "");
        applyFilters();
    });

    // CheckAll binding
    document.getElementById('check-all-visible').addEventListener('change', (e) => {
        let isChecked = e.target.checked;
        appState.filteredTasks.forEach(t => {
           if(isChecked) {
               // Enforce target planner logic
               if (!appState.currentTargetPlanner) appState.currentTargetPlanner = t.planner;
               if (t.planner === appState.currentTargetPlanner) {
                   appState.selectedIds.add(t._id);
               }
           } else {
               appState.selectedIds.delete(t._id);
           }
        });
        
        if(appState.selectedIds.size === 0) appState.currentTargetPlanner = null;
        renderTable();
        updateActionBar();
    });

    // Workflow actions
    document.getElementById('btn-trigger-workflow').addEventListener('click', openVerificationModal);
    document.getElementById('btn-rejeter').addEventListener('click', () => {
        document.getElementById('workflow-modal').classList.remove('open');
    });
    document.getElementById('btn-approuver').addEventListener('click', executeWorkflowSender);
}

// ===================================
// DATA FETCHING (EXTRACTION)
// ===================================
async function fetchData() {
    showToast("Synchronisation avec Google Sheets en cours...", "info");
    try {
        const res = await fetch(appState.url);
        const json = await res.json();
        
        if(json.status === "success") {
            // Add internal IDs
            appState.tasks = json.data.tasks.map((t, idx) => ({ ...t, _id: "T" + idx }));
            appState.collabMap = json.data.collaboratorsMap;
            
            // Generate Filters Options
            populateSelectOptions('flt-plant', [...new Set(appState.tasks.map(t => t.plant))].sort());
            populateSelectOptions('flt-planner', [...new Set(appState.tasks.map(t => t.planner))].sort());
            populateSelectOptions('flt-workcenter', [...new Set(appState.tasks.map(t => t.workCenter))].sort());
            populateSelectOptions('flt-category', [...new Set(appState.tasks.map(t => t.category))].sort());
            
            appState.selectedIds.clear();
            appState.currentTargetPlanner = null;
            
            appState.filteredTasks = [...appState.tasks];
            updateDashboard();
            renderTable();
            updateActionBar();
            showToast("Extraction effectuée avec succès !", "success");
        } else {
            throw new Error(json.message);
        }
    } catch(err) {
        showToast("Erreur de connexion : " + err.message, "error");
    }
}

function populateSelectOptions(id, array) {
    const el = document.getElementById(id);
    el.innerHTML = '<option value="">Tous</option>';
    array.forEach(item => {
        if(item && item !== "-") el.innerHTML += `<option value="${item}">${item}</option>`;
    });
}

// ===================================
// DASHBOARD & CHARTS
// ===================================
function updateDashboard() {
    const totalLines = appState.tasks.length;
    let totalWork = 0; let totalActual = 0;
    let parPlanner = {}; let parCat = {};

    appState.tasks.forEach(t => {
        totalWork += t.work;
        totalActual += t.actualWork;
        
        if(!parPlanner[t.planner]) parPlanner[t.planner] = { w:0, a:0 };
        parPlanner[t.planner].w += t.work;
        parPlanner[t.planner].a += t.actualWork;

        if(!parCat[t.category]) parCat[t.category] = 0;
        parCat[t.category]++;
    });

    document.getElementById('dash-lines').innerText = totalLines;
    document.getElementById('dash-work').innerText = totalWork.toFixed(1);
    document.getElementById('dash-actual').innerText = totalActual.toFixed(1);
    document.getElementById('dash-taux').innerText = totalWork > 0 ? ((totalActual / totalWork) * 100).toFixed(1) + '%' : '0%';

    // Charts
    const plannersCtx = document.getElementById('chartPlanners').getContext('2d');
    if(appState.charts.planners) appState.charts.planners.destroy();
    
    appState.charts.planners = new Chart(plannersCtx, {
        type: 'bar',
        data: {
            labels: Object.keys(parPlanner),
            datasets: [
                { label: 'Work', data: Object.values(parPlanner).map(p => p.w), backgroundColor: '#3b82f6' },
                { label: 'Actual Work', data: Object.values(parPlanner).map(p => p.a), backgroundColor: '#10b981' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } } , plugins: { legend: { labels: { color: '#fff'} } }}
    });

    const catCtx = document.getElementById('chartCategories').getContext('2d');
    if(appState.charts.categories) appState.charts.categories.destroy();
    
    appState.charts.categories = new Chart(catCtx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(parCat),
            datasets: [{ data: Object.values(parCat), backgroundColor: ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#fff'} } } }
    });
}

// ===================================
// TABLE & FILTERS
// ===================================
function applyFilters() {
    const q = document.getElementById('search-bar').value.toLowerCase();
    const plt = document.getElementById('flt-plant').value;
    const pln = document.getElementById('flt-planner').value;
    const wct = document.getElementById('flt-workcenter').value;
    const cat = document.getElementById('flt-category').value;

    appState.filteredTasks = appState.tasks.filter(t => {
        let textMatch = q === "" || t.order.toString().toLowerCase().includes(q) || t.opText.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
        let pMatch = plt === "" || t.plant === plt;
        let plnMatch = pln === "" || t.planner === pln;
        let cMatch = cat === "" || t.category === cat;
        let wMatch = wct === "" || t.workCenter === wct;
        return textMatch && pMatch && plnMatch && cMatch && wMatch;
    });

    document.getElementById('check-all-visible').checked = false;
    renderTable();
}

window.toggleRow = function(id) {
    const task = appState.tasks.find(t => t._id === id);
    if (!task) return;

    if (appState.selectedIds.has(id)) {
        appState.selectedIds.delete(id);
        if(appState.selectedIds.size === 0) appState.currentTargetPlanner = null; // Libère le lock
    } else {
        // Enforce lock Target
        if (!appState.currentTargetPlanner) {
            appState.currentTargetPlanner = task.planner;
        }
        
        if (task.planner === appState.currentTargetPlanner) {
            appState.selectedIds.add(id);
        } else {
            showToast("Sélection bloquée : Le workflow cible actuellement le Planner " + appState.currentTargetPlanner, "error");
            return;
        }
    }
    
    renderTable();
    updateActionBar();
};

function renderTable() {
    const body = document.getElementById('table-body');
    body.innerHTML = '';
    
    if(appState.filteredTasks.length === 0) {
        body.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Aucune ligne ne correspond aux filtres.</td></tr>';
        return;
    }

    // Performance limit (Affiche max 100 pour browser perf, mais check logic apply globally)
    appState.filteredTasks.slice(0, 150).forEach(t => {
        const isSelected = appState.selectedIds.has(t._id);
        const isDisabled = appState.currentTargetPlanner && t.planner !== appState.currentTargetPlanner && !isSelected;

        body.innerHTML += `
            <tr style="${isSelected ? 'background: rgba(99,102,241,0.1)' : ''}">
                <td>
                    <label class="checkbox-container">
                        <input type="checkbox" onchange="toggleRow('${t._id}')" ${isSelected ? 'checked' : ''} ${isDisabled ? 'disabled title="Target Lock actif"' : ''}>
                        <span class="checkmark"></span>
                    </label>
                </td>
                <td>${t.plant}</td>
                <td style="font-weight:600; color:${isDisabled ? '#666' : '#fff'}">${t.planner}</td>
                <td>${t.workCenter}</td>
                <td>${t.order}</td>
                <td><div style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${t.opText}">${t.opText}</div></td>
                <td>${t.category}</td>
                <td>${t.work}</td>
                <td style="font-weight:bold; color: ${t.work > 0 && t.actualWork === 0 ? '#ef4444' : 'inherit'}">${t.actualWork}</td>
            </tr>
        `;
    });
}

function updateActionBar() {
    const bar = document.getElementById('action-bar');
    const badge = document.getElementById('badge-sel');
    const count = appState.selectedIds.size;
    
    badge.innerText = count;
    document.getElementById('abar-count').innerText = count;
    document.getElementById('abar-planner').innerText = appState.currentTargetPlanner || "Aucun";

    if (count > 0) {
        bar.classList.add('visible');
    } else {
        bar.classList.remove('visible');
    }
}

// ===================================
// WORKFLOW (MODAL & EXECUTION)
// ===================================
function openVerificationModal() {
    if (appState.selectedIds.size === 0) return;
    
    const emailStatus = document.getElementById('mod-email-status');
    const planner = appState.currentTargetPlanner;
    const emailAssocie = appState.collabMap[planner] || "NON TROUVABLE";
    
    document.getElementById('mod-planner').innerText = planner;
    
    if(emailAssocie === "NON TROUVABLE") {
        emailStatus.innerHTML = `<span class="text-red">⚠️ Attention: Aucun email trouvé dans COLLABORATEURS pour ce Planner. L'envoi échouera.</span>`;
        document.getElementById('btn-approuver').disabled = true;
    } else {
        emailStatus.innerHTML = `Email cible identifié : <strong class="text-green">${emailAssocie}</strong>`;
        document.getElementById('btn-approuver').disabled = false;
    }

    const tBody = document.getElementById('mod-task-list');
    tBody.innerHTML = '';
    
    appState.tasks.filter(t => appState.selectedIds.has(t._id)).forEach(t => {
        tBody.innerHTML += `<tr><td>${t.order}</td><td>${t.opText.substring(0,30)}...</td><td>${t.category}</td><td style="color:#ef4444">${t.work} / ${t.actualWork}</td></tr>`;
    });

    document.getElementById('envoi-status').style.display = 'none';
    document.getElementById('workflow-modal').classList.add('open');
}

async function executeWorkflowSender() {
    const btn = document.getElementById('btn-approuver');
    const statusBox = document.getElementById('envoi-status');
    const customMessage = document.getElementById('mod-message').value;
    
    // 1. EXTRACTION & EN_ATTENTE
    const payloadTasks = appState.tasks.filter(t => appState.selectedIds.has(t._id));
    
    const payload = {
        action: "EXECUTE_WORKFLOW",
        payload: {
            planner: appState.currentTargetPlanner,
            customMessage: customMessage,
            tasks: payloadTasks
        }
    };

    // 2. ENVOI_EN_COURS
    btn.disabled = true;
    statusBox.style.display = 'block';
    statusBox.className = "mt-4 envoi-status-box loading";
    statusBox.innerText = "Traitement et envoi d'email en cours (Apps Script MailApp)...";

    try {
        const res = await fetch(appState.url, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        const ans = await res.json();
        
        if (ans.status === "success") {
            // 3. ENVOYÉ
            statusBox.className = "mt-4 envoi-status-box success";
            statusBox.innerText = `SÉLECTION -> EXTRACTION -> VÉRIFICATION -> APPROUVÉ -> ENVOYÉ ✅\n${ans.message}`;
            showToast("Mailer executé avec succès.", "success");
            
            // Vidage et relock
            setTimeout(() => {
                appState.selectedIds.clear();
                appState.currentTargetPlanner = null;
                document.getElementById('check-all-visible').checked = false;
                renderTable();
                updateActionBar();
                document.getElementById('workflow-modal').classList.remove('open');
                btn.disabled = false;
            }, 3000);

        } else {
            throw new Error(ans.message);
        }
    } catch(err) {
        // ERREUR -> A RELANCER
        statusBox.className = "mt-4 envoi-status-box error";
        statusBox.innerText = `ENVOI EN COURS -> ERREUR -> À RELANCER\nDétail: ${err.message}`;
        btn.disabled = false;
    }
}

function showToast(msg, type="info") {
    const t = document.createElement('div');
    t.className = 'toast show';
    t.innerHTML = `<span style="margin-right:8px">${type==='success'?'✅':type==='error'?'🚨':'🔔'}</span> ${msg}`;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4000);
}
