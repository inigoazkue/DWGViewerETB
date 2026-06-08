'use strict';

// ── Pan / Zoom state ──────────────────────────────────────────────────────────
let scale = 1, tx = 0, ty = 0;
let svgW = 0, svgH = 0;
let minScale = 0.02;
let dragging = false, lastX = 0, lastY = 0, lastDist = 0;

const MAX_RENDER_PX = 8192;
let _qualityTimer = null;

// Tras cada zoom, reajusta el tamaño real del SVG para que CSS scale → ≈1.
// Resultado: GPU escala una imagen de alta resolución → nitidez sin demora.
function commitRenderQuality() {
    const w = wrapper();
    if (!w) return;
    const svg = w.querySelector('svg');
    if (!svg || !svgW || !svgH) return;

    const visualW = svgW * scale;
    const visualH = svgH * scale;
    const newW = Math.max(256, Math.min(MAX_RENDER_PX, Math.round(visualW)));
    const newH = Math.round(newW * visualH / visualW);

    svg.setAttribute('width',  newW);
    svg.setAttribute('height', newH);
    scale  = visualW / newW;   // ≈ 1 cuando no se llega al límite
    svgW   = newW;
    svgH   = newH;
    minScale = scale * 0.5;
    applyTransform();
}

function scheduleQualityUpdate() {
    clearTimeout(_qualityTimer);
    _qualityTimer = setTimeout(commitRenderQuality, 300);
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
    scheduleQualityUpdate();
}

function zoomAt(factor, cx, cy) {
    const s = Math.max(minScale, Math.min(200, scale * factor));
    const k = s / scale;
    tx = cx - k * (cx - tx);
    ty = cy - k * (cy - ty);
    scale = s;
    applyTransform();
    scheduleQualityUpdate();
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

// ── File loading ──────────────────────────────────────────────────────────────
const elPlaceholder = document.getElementById('placeholder');
const elLoading     = document.getElementById('loading');
const elError       = document.getElementById('error-panel');
const elErrorMsg    = document.getElementById('error-msg');
const elCurrentFile = document.getElementById('current-file');

async function openFile(path, name) {
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
