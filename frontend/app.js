'use strict';

// ── Pan / Zoom state ──────────────────────────────────────────────────────────
let scale = 1, tx = 0, ty = 0;
let svgW = 0, svgH = 0;
let minScale = 0.02;
let dragging = false, lastX = 0, lastY = 0, lastDist = 0;

const MAX_RENDER_PX = 8192;
let _gpuTimer = null;
let _gpuActive = false;

// Durante la interaccion activa: GPU acelera el transform (fluido).
// 700ms despues de la ultima accion: se desactiva GPU y se rerasteriza
// el SVG como vector puro al tamano visual actual → siempre nitido.
function activateGPU() {
    const w = wrapper();
    if (w && !_gpuActive) {
        w.style.willChange = 'transform';
        _gpuActive = true;
    }
    clearTimeout(_gpuTimer);
    _gpuTimer = setTimeout(() => {
        const w = wrapper();
        if (w) { w.style.willChange = 'auto'; }
        _gpuActive = false;
        commitRenderQuality();
    }, 700);
}

function commitRenderQuality() {
    const w = wrapper();
    if (!w) return;
    const svg = w.querySelector('svg');
    if (!svg || !svgW || !svgH) return;

    const visualW = svgW * scale;
    const visualH = svgH * scale;
    const newW = Math.max(256, Math.min(MAX_RENDER_PX, Math.round(visualW)));
    const newH = Math.round(newW * visualH / visualW);

    const ratio = newW / svgW;
    if (ratio > 0.8 && ratio < 1.25) return;

    const minVisualW = minScale * svgW;
    svg.setAttribute('width',  newW);
    svg.setAttribute('height', newH);
    scale    = visualW / newW;
    svgW     = newW;
    svgH     = newH;
    minScale = minVisualW / newW;
    applyTransform(); // will-change ya es 'auto': renderiza como vector
}

const viewer = document.getElementById('viewer');

function wrapper() { return document.getElementById('svg-wrapper'); }

function applyTransform() {
    const w = wrapper();
    if (w) w.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
}

function fitToScreen() {
    if (!svgW || !svgH) return;
    const vw = viewer.clientWidth;
    const vh = viewer.clientHeight;
    scale = Math.min(vw / svgW, vh / svgH) * 0.92;
    minScale = scale * 0.5;
    tx = (vw - svgW * scale) / 2;
    ty = (vh - svgH * scale) / 2;
    applyTransform();
    activateGPU();
}

function zoomAt(factor, cx, cy) {
    const s = Math.max(minScale, Math.min(200, scale * factor));
    const k = s / scale;
    tx = cx - k * (cx - tx);
    ty = cy - k * (cy - ty);
    scale = s;
    applyTransform();
    activateGPU();
}

// ── Mouse events ──────────────────────────────────────────────────────────────
viewer.addEventListener('wheel', e => {
    e.preventDefault();
    const r = viewer.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

viewer.addEventListener('mousedown', e => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
});

document.addEventListener('mousemove', e => {
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    applyTransform();
});

document.addEventListener('mouseup', () => { dragging = false; });

// ── Touch events ──────────────────────────────────────────────────────────────
viewer.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
        dragging = true;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        dragging = false;
        lastDist = Math.hypot(
            e.touches[1].clientX - e.touches[0].clientX,
            e.touches[1].clientY - e.touches[0].clientY
        );
    }
}, { passive: true });

viewer.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
        tx += e.touches[0].clientX - lastX;
        ty += e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        applyTransform();
    } else if (e.touches.length === 2) {
        const d = Math.hypot(
            e.touches[1].clientX - e.touches[0].clientX,
            e.touches[1].clientY - e.touches[0].clientY
        );
        if (lastDist > 0) {
            const r = viewer.getBoundingClientRect();
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
            zoomAt(d / lastDist, cx, cy);
        }
        lastDist = d;
    }
}, { passive: false });

viewer.addEventListener('touchend', () => { dragging = false; lastDist = 0; });

// ── Toolbar buttons ───────────────────────────────────────────────────────────
document.getElementById('btn-fit').addEventListener('click', fitToScreen);

document.getElementById('btn-zoom-in').addEventListener('click', () => {
    zoomAt(1.5, viewer.clientWidth / 2, viewer.clientHeight / 2);
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
    zoomAt(1 / 1.5, viewer.clientWidth / 2, viewer.clientHeight / 2);
});

const sidebar = document.getElementById('sidebar');
document.getElementById('btn-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    setTimeout(fitToScreen, 220);
});

// ── Search ────────────────────────────────────────────────────────────────────
const searchPanel   = document.getElementById('search-panel');
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchEmpty   = document.getElementById('search-empty');

let _currentSearchPath = null;
let _activeSearchItem = null;
let _searchAbort = null;

document.getElementById('btn-search').addEventListener('click', () => {
    const nowHidden = searchPanel.classList.toggle('hidden');
    if (!nowHidden) {
        searchInput.focus();
        doSearch();
    }
});

document.getElementById('btn-search-close').addEventListener('click', () => {
    searchPanel.classList.add('hidden');
});

document.getElementById('btn-do-search').addEventListener('click', doSearch);

const btnClearInput = document.getElementById('btn-clear-input');

searchInput.addEventListener('input', () => {
    btnClearInput.classList.toggle('hidden', !searchInput.value);
});

btnClearInput.addEventListener('click', () => {
    searchInput.value = '';
    btnClearInput.classList.add('hidden');
    searchResults.innerHTML = '';
    searchEmpty.classList.add('hidden');
    _activeSearchItem = null;
    if (_searchAbort) { _searchAbort.abort(); _searchAbort = null; }
    searchInput.focus();
});

searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
});

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function navigateToDxf(nx, ny) {
    if (!svgW || !svgH) return;
    const pxX = nx * svgW;
    const pxY = (1 - ny) * svgH;
    // Zoom para que el 3% del ancho del plano llene la pantalla (consistente entre planos)
    scale = Math.min(viewer.clientWidth / (0.03 * svgW), 200);
    tx = viewer.clientWidth  / 2 - pxX * scale;
    ty = viewer.clientHeight / 2 - pxY * scale;
    applyTransform();
    activateGPU();
}

async function doSearch() {
    const query = searchInput.value.trim();
    searchResults.innerHTML = '';
    searchEmpty.classList.add('hidden');
    _activeSearchItem = null;

    // Cancelar busqueda anterior en vuelo
    if (_searchAbort) _searchAbort.abort();
    _searchAbort = new AbortController();
    const signal = _searchAbort.signal;

    if (!query || !_currentSearchPath) {
        if (!_currentSearchPath) {
            searchEmpty.textContent = 'Ireki plano bat lehenengo';
            searchEmpty.classList.remove('hidden');
        }
        return;
    }

    searchEmpty.textContent = 'Bilatzen…';
    searchEmpty.classList.remove('hidden');

    try {
        const resp = await fetch(
            '/api/search?path=' + encodeURIComponent(_currentSearchPath) +
            '&q=' + encodeURIComponent(query),
            { signal }
        );
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const matches = await resp.json();

        searchEmpty.classList.add('hidden');

        if (!matches.length) {
            searchEmpty.textContent = 'Ez da emaitzarik aurkitu';
            searchEmpty.classList.remove('hidden');
            return;
        }

        matches.forEach(({ text, x, y, nx, ny }) => {
            const item = document.createElement('div');
            item.className = 'search-item';
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx >= 0) {
                item.innerHTML =
                    escapeHtml(text.slice(0, idx)) +
                    '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' +
                    escapeHtml(text.slice(idx + query.length));
            } else {
                item.textContent = text;
            }
            item.addEventListener('click', () => {
                if (_activeSearchItem) _activeSearchItem.classList.remove('active');
                item.classList.add('active');
                _activeSearchItem = item;
                if (nx != null && ny != null) {
                    navigateToDxf(nx, ny);
                }
            });
            searchResults.appendChild(item);
        });
    } catch (e) {
        if (e.name === 'AbortError') return;
        searchEmpty.textContent = 'Errorea bilaketan: ' + e.message;
        searchEmpty.classList.remove('hidden');
    }
}

// ── File loading ──────────────────────────────────────────────────────────────
const elPlaceholder = document.getElementById('placeholder');
const elLoading     = document.getElementById('loading');
const elError       = document.getElementById('error-panel');
const elErrorMsg    = document.getElementById('error-msg');
const elCurrentFile = document.getElementById('current-file');

async function openFile(path, name) {
    _currentSearchPath = path;
    document.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
    const treeEl = document.querySelector(`.tree-file[data-path="${CSS.escape(path)}"]`);
    if (treeEl) treeEl.classList.add('active');

    elCurrentFile.textContent = name.replace(/\.(dwg|dxf)$/i, '');
    elPlaceholder.classList.add('hidden');
    elError.classList.add('hidden');
    elLoading.classList.remove('hidden');

    const old = wrapper();
    if (old) old.remove();

    try {
        const resp = await fetch('/api/svg?path=' + encodeURIComponent(path));
        if (!resp.ok) {
            const detail = await resp.text().catch(() => '');
            let msg = detail;
            try { msg = JSON.parse(detail).detail || detail; } catch (_) {}
            throw new Error(msg || `HTTP errorea ${resp.status}`);
        }

        const svgText = await resp.text();
        const div = document.createElement('div');
        div.id = 'svg-wrapper';
        div.innerHTML = svgText;

        const svg = div.querySelector('svg');
        if (!svg) throw new Error('Erantzunak ez du baliozko SVG-rik');

        const vb = svg.viewBox.baseVal;
        if (vb && vb.width > 0 && vb.height > 0) {
            // Renderizar a 2× el viewport: alta resolución inicial sin usar
            // las coordenadas DXF en bruto (que pueden ser 500000px y causan pixelado)
            const initW = viewer.clientWidth * 2;
            svgW = Math.min(initW, MAX_RENDER_PX);
            svgH = Math.round(svgW * vb.height / vb.width);
        } else {
            svgW = parseFloat(svg.getAttribute('width'))  || 1000;
            svgH = parseFloat(svg.getAttribute('height')) || 700;
        }
        svg.setAttribute('width',  svgW);
        svg.setAttribute('height', svgH);

        viewer.appendChild(div);
        fitToScreen();
        if (!searchPanel.classList.contains('hidden') && searchInput.value.trim()) await doSearch();
    } catch (err) {
        elErrorMsg.textContent = 'Error: ' + err.message;
        elError.classList.remove('hidden');
    } finally {
        elLoading.classList.add('hidden');
    }
}

// ── File tree ─────────────────────────────────────────────────────────────────
function startLoad(details) {
    if (details.dataset.loaded === 'true') return Promise.resolve();
    if (details._loadPromise) return details._loadPromise;
    const folderPath = details.dataset.path;
    const sub = details.querySelector('.tree-children');
    sub.innerHTML = '<div class="tree-loading">…</div>';
    details._loadPromise = fetch('/api/tree?path=' + encodeURIComponent(folderPath))
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(data => {
            sub.innerHTML = '';
            (data.children || []).forEach(c => renderNode(c, sub, false));
        })
        .catch(e => {
            sub.innerHTML = `<div style="padding:8px 16px;color:#c44;font-size:12px">Errorea: ${e.message}</div>`;
        })
        .finally(() => { details.dataset.loaded = 'true'; });
    return details._loadPromise;
}

function renderNode(node, container, isRoot) {
    if (node.type === 'dir') {
        if (isRoot) {
            (node.children || []).forEach(c => renderNode(c, container, false));
            return;
        }
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = node.name;
        details.appendChild(summary);
        const sub = document.createElement('div');
        sub.className = 'tree-children';
        details.appendChild(sub);

        if (node.lazy) {
            details.dataset.path = node.path;
            details.dataset.loaded = 'false';
            details.addEventListener('toggle', () => { if (details.open) startLoad(details); });
        } else {
            details.dataset.loaded = 'true';
            (node.children || []).forEach(c => renderNode(c, sub, false));
        }

        container.appendChild(details);
    } else if (node.type === 'file') {
        const el = document.createElement('div');
        el.className = 'tree-file';
        el.title = node.name;
        el.dataset.path = node.path;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = node.name.replace(/\.(dwg|dxf)$/i, '');
        el.appendChild(nameSpan);
        el.addEventListener('click', () => openFile(node.path, node.name));
        container.appendChild(el);
    }
}

// ── Tree search ───────────────────────────────────────────────────────────────
const treeSearchInput  = document.getElementById('tree-search-input');
const btnTreeSearch    = document.getElementById('btn-tree-search');
const btnTreeClear     = document.getElementById('btn-tree-clear');
const treeSearchStatus = document.getElementById('tree-search-status');
const fileTree         = document.getElementById('file-tree');

let _treeSearchAbort = null;

treeSearchInput.addEventListener('input', () => {
    btnTreeClear.classList.toggle('hidden', !treeSearchInput.value);
});

treeSearchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doTreeSearch();
});

btnTreeSearch.addEventListener('click', doTreeSearch);

btnTreeClear.addEventListener('click', () => {
    treeSearchInput.value = '';
    btnTreeClear.classList.add('hidden');
    clearTreeSearch();
    treeSearchInput.focus();
});

function clearTreeSearch() {
    if (_treeSearchAbort) { _treeSearchAbort.abort(); _treeSearchAbort = null; }
    fileTree.classList.remove('tree-search-active');
    fileTree.querySelectorAll('.tree-file.search-match').forEach(el => {
        el.classList.remove('search-match');
        el.querySelector('.match-badge')?.remove();
    });
    treeSearchStatus.classList.add('hidden');
}

async function doTreeSearch() {
    const query = treeSearchInput.value.trim();
    if (!query) { clearTreeSearch(); return; }

    if (_treeSearchAbort) _treeSearchAbort.abort();
    _treeSearchAbort = null;   // null antes de clearTreeSearch para que no aborte el nuevo signal
    clearTreeSearch();

    _treeSearchAbort = new AbortController();
    const signal = _treeSearchAbort.signal;

    treeSearchStatus.textContent = 'Planoetan bilatzen…';
    treeSearchStatus.classList.remove('hidden');

    try {
        const resp = await fetch('/api/search-tree?q=' + encodeURIComponent(query), { signal });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const results = await resp.json();

        fileTree.classList.add('tree-search-active');

        if (!results.length) {
            treeSearchStatus.textContent = 'Ez da emaitzarik aurkitu';
            return;
        }

        treeSearchStatus.textContent = results.length + (results.length === 1 ? ' plano' : ' plano');

        // Recopilar todas las carpetas padre que necesitan estar cargadas
        const folderPaths = new Set();
        results.forEach(({ path }) => {
            const parts = path.split('/');
            for (let i = 1; i < parts.length; i++) {
                folderPaths.add(parts.slice(0, i).join('/'));
            }
        });
        // Cargar de menos profundo a más para que las <details> anidadas estén en el DOM
        const sortedFolders = [...folderPaths].sort((a, b) => a.split('/').length - b.split('/').length);
        for (const fp of sortedFolders) {
            const det = fileTree.querySelector(`details[data-path="${CSS.escape(fp)}"]`);
            if (!det) continue;
            det.open = true;
            await startLoad(det);
        }

        let first = true;
        results.forEach(({ path, count }) => {
            const el = fileTree.querySelector(`.tree-file[data-path="${CSS.escape(path)}"]`);
            if (!el) return;
            el.classList.add('search-match');
            const badge = document.createElement('span');
            badge.className = 'match-badge';
            badge.textContent = count;
            el.appendChild(badge);
            if (first) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                first = false;
            }
        });
    } catch (e) {
        if (e.name === 'AbortError') return;
        treeSearchStatus.textContent = 'Errorea: ' + e.message;
    }
}

async function loadTree() {
    const container = document.getElementById('file-tree');
    try {
        const resp = await fetch('/api/tree');
        if (!resp.ok) throw new Error(`HTTP errorea ${resp.status}`);
        const tree = await resp.json();
        container.innerHTML = '';
        renderNode(tree, container, true);
        if (!container.children.length) {
            container.textContent = 'Ez dago planorik konfiguratutako karpetan.';
            container.style.padding = '16px';
            container.style.color = '#666';
        }
    } catch (e) {
        container.textContent = 'Errorea karpeta-zuhaitza kargatzean: ' + e.message;
        container.style.padding = '16px';
        container.style.color = '#c44';
    }
}

// ── Index progress polling ────────────────────────────────────────────────────
const elIndexProgress = document.getElementById('index-progress');
const elIndexText     = document.getElementById('index-progress-text');
const elIndexBar      = document.getElementById('index-progress-bar');
const elIndexPct      = document.getElementById('index-progress-pct');

async function pollIndexStatus() {
    try {
        const resp = await fetch('/api/index-status');
        if (resp.ok) {
            const s = await resp.json();
            if (s.running) {
                elIndexProgress.classList.remove('hidden');
                elIndexText.textContent = s.current
                    ? s.current + ' indexatzen...'
                    : 'Planoen datuan indexatzen...';
                elIndexBar.style.width = s.pct + '%';
                elIndexPct.textContent = '% ' + s.pct;
            } else {
                elIndexProgress.classList.add('hidden');
            }
        }
    } catch (_) {}
    setTimeout(pollIndexStatus, 1500);
}

pollIndexStatus();

const btnReindex = document.getElementById('btn-reindex');
btnReindex.addEventListener('click', async () => {
    if (!confirm('Indize osoa ezabatu eta berriz sortu nahi duzu?\n(Denbora pixka bat beharko du)')) return;
    btnReindex.classList.add('spinning');
    btnReindex.disabled = true;
    try {
        const resp = await fetch('/api/reindex', { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'already_running') {
            alert('Indexazioa dagoeneko abian da.');
        }
    } catch (e) {
        alert('Errorea: ' + e.message);
    } finally {
        btnReindex.classList.remove('spinning');
        btnReindex.disabled = false;
    }
});

loadTree();
