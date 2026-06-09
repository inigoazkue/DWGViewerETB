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

searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
});

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Navega al punto DXF (dxfX, dxfY) usando el viewBox del SVG.
// ezdxf SVGBackend invierte el eje Y: svg_y = -dxf_y
// Por tanto viewBox.y ≈ -max_dxf_y (negativo)
function navigateToDxf(dxfX, dxfY) {
    const svg = wrapper()?.querySelector('svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    if (!vb || vb.width === 0) return;

    console.log('DXF:', dxfX, dxfY);
    console.log('viewBox:', vb.x, vb.y, vb.width, vb.height);
    console.log('SVG px:', svgW, svgH);

    const svgCoordX = dxfX;
    const svgCoordY = -dxfY;

    const pxX = (svgCoordX - vb.x) / vb.width  * svgW;
    const pxY = (svgCoordY - vb.y) / vb.height * svgH;

    console.log('pxX:', pxX, 'pxY:', pxY);

    tx = viewer.clientWidth  / 2 - pxX * scale;
    ty = viewer.clientHeight / 2 - pxY * scale;
    applyTransform();
    activateGPU();
}

async function doSearch() {
    const query = searchInput.value.trim();
    searchResults.innerHTML = '';
    searchEmpty.classList.add('hidden');

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
            '&q=' + encodeURIComponent(query)
        );
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const matches = await resp.json();

        searchEmpty.classList.add('hidden');

        if (!matches.length) {
            searchEmpty.textContent = 'Ez da emaitzarik aurkitu';
            searchEmpty.classList.remove('hidden');
            return;
        }

        let activeItem = null;
        matches.forEach(({ text, x, y }) => {
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
                if (activeItem) activeItem.classList.remove('active');
                item.classList.add('active');
                activeItem = item;
                navigateToDxf(x, y);
            });
            searchResults.appendChild(item);
        });
    } catch (e) {
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
        (node.children || []).forEach(c => renderNode(c, sub, false));
        details.appendChild(sub);
        container.appendChild(details);
    } else if (node.type === 'file') {
        const el = document.createElement('div');
        el.className = 'tree-file';
        el.textContent = node.name.replace(/\.(dwg|dxf)$/i, '');
        el.title = node.name;
        el.dataset.path = node.path;
        el.addEventListener('click', () => openFile(node.path, node.name));
        container.appendChild(el);
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

loadTree();
