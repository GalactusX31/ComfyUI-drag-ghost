import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "Comfy.NodeGhost",
    async setup() {
        const canvas = app.canvas;
        if (!canvas) return;

        let customColorValue = localStorage.getItem("Comfy.NodeGhost.CustomColor") || "#00eeff";
        let ghost = null;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let dragThreshold = 5;
        let draggingNodes = [];
        let initialNodePositions = [];
        let draggingGroups = [];
        let initialGroupPositions = [];
        let extraNodes = [];
        let initialExtraPositions = [];
        let ghostOffset = { x: 0, y: 0 };

        app.ui.settings.addSetting({
            id: "Comfy.NodeGhost.Enabled",
            name: "Enable Ghost Dragging 👻",
            type: "boolean",
            defaultValue: true,
        });

        app.ui.settings.addSetting({
            id: "Comfy.NodeGhost.BorderStyle",
            name: "Ghost Border Style",
            type: "combo",
            defaultValue: "dashed",
            options: ["solid", "dashed", "dotted", "double", "none"],
        });

        app.ui.settings.addSetting({
            id: "Comfy.NodeGhost.RespectPinned",
            name: "Respect Pinned Nodes 📌",
            type: "boolean",
            defaultValue: true,
        });

        app.ui.settings.addSetting({
            id: "Comfy.NodeGhost.BorderColor",
            name: "Ghost Border Color",
            type: "combo",
            defaultValue: "#999999",
            options: [
                { value: "#999999", text: "ComfyUI Gray" },
                { value: "#ffffff", text: "White" },
                { value: "#00eeff", text: "Cyan" },
                { value: "#ff6e6e", text: "Red" },
                { value: "#8bc34a", text: "Green" },
                { value: "#ffeb3b", text: "Yellow" },
                { value: "#ff9800", text: "Orange" },
                { value: "#9c27b0", text: "Purple" },
            ],
            onChange: (value) => {
                if (value === "#999999") {
                    customColorValue = "#999999";
                }
            }
        });

        const styleId = "cncs-ghost-styles";
        if (!document.getElementById(styleId)) {
            const s = document.createElement("style");
            s.id = styleId;
            s.textContent = `
                .cncs-ghost-phantom {
                    position: fixed !important;
                    border-radius: 0px !important;
                    pointer-events: none !important;
                    z-index: 9999 !important;
                    box-sizing: border-box !important;
                    display: none;
                }
                .cncs-ghost-node {
                    position: absolute !important;
                    border-radius: 0px !important;
                    pointer-events: none !important;
                    box-sizing: border-box !important;
                }
            `;
            document.head.appendChild(s);
        }

        app.ui.settings.addSetting({
            id: "Comfy.NodeGhost.CustomColorPicker",
            name: "📝 Pick Custom Color",
            type: (name, setter, value) => {
                const button = document.createElement("button");
                button.innerHTML = "&nbsp;";
                button.style.cssText = "padding: 0; cursor: pointer; width: 100%; min-width: 100px; height: 30px; border: 2px solid #555; border-radius: 4px; display: block;";
                button.style.background = customColorValue;
                button.title = "Click to choose custom color";

                button.onclick = () => {
                    const input = document.createElement('input');
                    input.type = 'color';
                    input.value = customColorValue;

                    input.onchange = (e) => {
                        customColorValue = e.target.value;
                        localStorage.setItem("Comfy.NodeGhost.CustomColor", customColorValue);
                        app.ui.settings.setSettingValue("Comfy.NodeGhost.BorderColor", customColorValue);
                        button.style.background = customColorValue;
                        document.body.removeChild(input);
                    };

                    input.style.position = 'absolute';
                    input.style.opacity = '0';
                    input.style.pointerEvents = 'none';
                    document.body.appendChild(input);
                    input.click();
                };

                return button;
            }
        });

        const isEnabled = () => app.ui.settings.getSettingValue("Comfy.NodeGhost.Enabled");

        const pointerDownHandler = (e) => {
            if (!isEnabled() || e.button !== 0) return;

            if (e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;

            draggingNodes = [];
            draggingGroups = [];
            extraNodes = [];
            initialExtraPositions = [];

            const path = e.composedPath();
            if (!path.includes(canvas.canvas)) return;

            const isClickingUI = path.some(el => {
                if (!el.classList) return false;
                const classList = Array.from(el.classList);
                return classList.some(c =>
                    c.includes('modal') ||
                    c.includes('dialog') ||
                    c.includes('menu') ||
                    c.includes('popup') ||
                    c.includes('settings') ||
                    c.includes('comfy-')
                );
            });

            if (isClickingUI) return;

            const graph = canvas.graph;
            if (!graph) return;

            const nodePos = canvas.convertEventToCanvasOffset(e);
            const node = graph.getNodeOnPos(nodePos[0], nodePos[1]);

            if (node) {
                const localX = nodePos[0] - node.pos[0];
                const localY = nodePos[1] - node.pos[1];
                const cornerMargin = 20;

                const inTopLeftCorner = localX < cornerMargin && localY < cornerMargin;
                const inTopRightCorner = localX > (node.size[0] - cornerMargin) && localY < cornerMargin;
                const inBottomLeftCorner = localX < cornerMargin && localY > (node.size[1] - cornerMargin);
                const inBottomRightCorner = localX > (node.size[0] - cornerMargin) && localY > (node.size[1] - cornerMargin);

                if (inTopLeftCorner || inTopRightCorner || inBottomLeftCorner || inBottomRightCorner) return;

                if (node.widgets && node.widgets.length > 0) {
                    for (let widget of node.widgets) {
                        if (node.getWidgetOnPos && node.getWidgetOnPos(nodePos[0], nodePos[1])) return;
                    }
                }

                const slotMargin = 15;
                if (localX < slotMargin || localX > (node.size[0] - slotMargin)) return;

                if (canvas.isOverNodeInput && canvas.isOverNodeInput(node, nodePos[0], nodePos[1])) return;
                if (canvas.isOverNodeOutput && canvas.isOverNodeOutput(node, nodePos[0], nodePos[1])) return;

                const selectedNodes = canvas.selected_nodes || {};

                if (selectedNodes[node.id]) {
                    draggingNodes = Object.values(selectedNodes).filter(n => n.graph === graph);
                } else {
                    draggingNodes = [node];
                }

                if (draggingNodes.length > 0) {
                    initialNodePositions = draggingNodes.map(n => ({ x: n.pos[0], y: n.pos[1] }));
                    startX = e.clientX;
                    startY = e.clientY;
                    isDragging = false;
                }
            } else {
                const group = [...(graph._groups || [])].reverse().find(g => {
                    return nodePos[0] >= g.pos[0] && nodePos[0] <= g.pos[0] + g.size[0] &&
                        nodePos[1] >= g.pos[1] - 30 && nodePos[1] <= g.pos[1] + g.size[1];
                });

                if (group) {
                    const localX = nodePos[0] - group.pos[0];
                    const localY = nodePos[1] - group.pos[1];
                    const cornerSize = 25;
                    const resizable = localX > group.size[0] - cornerSize && localY > group.size[1] - cornerSize;

                    if (resizable) return;

                    draggingGroups = [group];
                    initialGroupPositions = [{ x: group.pos[0], y: group.pos[1] }];

                    // Use LiteGraph's native method to find nodes inside the group
                    if (group.recomputeInsideNodes) {
                        group.recomputeInsideNodes();
                    }
                    const groupNodes = group._nodes || [];

                    // Include selected nodes that are outside the group
                    const selectedNodes = canvas.selected_nodes || {};
                    if (Object.keys(selectedNodes).length > 0) {
                        draggingNodes = Object.values(selectedNodes).filter(n =>
                            n.graph === graph && !groupNodes.some(gn => gn.id === n.id)
                        );
                        initialNodePositions = draggingNodes.map(n => ({ x: n.pos[0], y: n.pos[1] }));
                    }

                    extraNodes = groupNodes.filter(gn => !draggingNodes.some(dn => dn.id === gn.id));
                    initialExtraPositions = extraNodes.map(en => ({ x: en.pos[0], y: en.pos[1] }));

                    startX = e.clientX;
                    startY = e.clientY;
                    isDragging = false;
                }
            }
        };

        const createGhostElement = (rect, nodes, groups, groupMinX, groupMinY, scale) => {
            const el = document.createElement("div");
            el.className = "cncs-ghost-phantom";
            el.style.width = rect.width + "px";
            el.style.height = rect.height + "px";
            el.style.left = "0px";
            el.style.top = "0px";

            const borderStyle = app.ui.settings.getSettingValue("Comfy.NodeGhost.BorderStyle") || "dashed";
            let borderColor = app.ui.settings.getSettingValue("Comfy.NodeGhost.BorderColor") || "#999999";
            const borderWidth = borderStyle === "double" ? "4px" : "2px";

            if (!borderColor.startsWith("#")) {
                borderColor = customColorValue;
            }

            el.style.borderStyle = borderStyle;
            el.style.borderColor = borderColor;
            el.style.borderWidth = borderWidth;

            const rgb = hexToRgb(borderColor);
            if (rgb) {
                const darkerR = Math.floor(rgb.r * 0.7);
                const darkerG = Math.floor(rgb.g * 0.7);
                const darkerB = Math.floor(rgb.b * 0.7);
                el.style.background = `rgba(${darkerR}, ${darkerG}, ${darkerB}, 0.3)`;
            }

            const respectPinned = app.ui.settings.getSettingValue("Comfy.NodeGhost.RespectPinned");

            // Sub-ghosts for nodes
            nodes.forEach(n => {
                const sub = document.createElement("div");
                sub.className = "cncs-ghost-node";
                sub.style.borderStyle = borderStyle;
                sub.style.borderWidth = borderWidth;

                const isPinned = n.flags && n.flags.pinned;

                if (isPinned) {
                    sub.style.borderColor = "#ff3333";
                    sub.style.background = "rgba(100, 0, 0, 0.4)";
                } else {
                    sub.style.borderColor = borderColor;
                    if (rgb) {
                        const darkerR = Math.floor(rgb.r * 0.7);
                        const darkerG = Math.floor(rgb.g * 0.7);
                        const darkerB = Math.floor(rgb.b * 0.7);
                        sub.style.background = `rgba(${darkerR}, ${darkerG}, ${darkerB}, 0.2)`;
                    }
                }
                el.appendChild(sub);
            });

            // Sub-ghosts for groups
            groups.forEach(g => {
                const sub = document.createElement("div");
                sub.className = "cncs-ghost-node";
                sub.style.borderStyle = borderStyle;
                sub.style.borderWidth = borderWidth;
                sub.style.borderColor = borderColor;
                if (rgb) {
                    const darkerR = Math.floor(rgb.r * 0.7);
                    const darkerG = Math.floor(rgb.g * 0.7);
                    const darkerB = Math.floor(rgb.b * 0.7);
                    sub.style.background = `rgba(${darkerR}, ${darkerG}, ${darkerB}, 0.2)`;
                }
                el.appendChild(sub);
            });

            document.body.appendChild(el);
            return el;
        };

        const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : null;
        };

        let rafId = null;
        let lastMoveEvent = null;

        const pointerMoveHandler = (e) => {
            if (draggingNodes.length === 0 && draggingGroups.length === 0) return;

            if (!isDragging) {
                const dist = Math.sqrt(Math.pow(e.clientX - startX, 2) + Math.pow(e.clientY - startY, 2));
                if (dist > dragThreshold) {
                    isDragging = true;
                    if (canvas.node_dragged) canvas.node_dragged = null;
                }
            }

            if (isDragging) {
                e.stopImmediatePropagation();
                e.preventDefault();

                draggingNodes.forEach((n, i) => {
                    if (initialNodePositions[i]) {
                        n.pos[0] = initialNodePositions[i].x;
                        n.pos[1] = initialNodePositions[i].y;
                    }
                });
                draggingGroups.forEach((g, i) => {
                    if (initialGroupPositions[i]) {
                        g.pos[0] = initialGroupPositions[i].x;
                        g.pos[1] = initialGroupPositions[i].y;
                    }
                });
                extraNodes.forEach((n, i) => {
                    if (initialExtraPositions[i]) {
                        n.pos[0] = initialExtraPositions[i].x;
                        n.pos[1] = initialExtraPositions[i].y;
                    }
                });
            }

            lastMoveEvent = e;

            if (rafId) return;

            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!lastMoveEvent || !isDragging) return;

                const evt = lastMoveEvent;

                draggingNodes.forEach((n, i) => {
                    if (initialNodePositions[i]) {
                        n.pos[0] = initialNodePositions[i].x;
                        n.pos[1] = initialNodePositions[i].y;
                    }
                });
                draggingGroups.forEach((g, i) => {
                    if (initialGroupPositions[i]) {
                        g.pos[0] = initialGroupPositions[i].x;
                        g.pos[1] = initialGroupPositions[i].y;
                    }
                });
                extraNodes.forEach((n, i) => {
                    if (initialExtraPositions[i]) {
                        n.pos[0] = initialExtraPositions[i].x;
                        n.pos[1] = initialExtraPositions[i].y;
                    }
                });

                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                const getNodeWidth = (node) => {
                    const isCollapsed = node.flags && node.flags.collapsed;
                    if (isCollapsed) {
                        if (node._collapsed_width) return node._collapsed_width;
                        const title = node.getTitle ? node.getTitle() : (node.title || "");
                        const minWidth = LiteGraph.NODE_COLLAPSED_WIDTH || 100;
                        const textWidth = title.length * 7 + 40;
                        return Math.max(minWidth, textWidth);
                    }
                    return node.size[0];
                };

                draggingNodes.forEach(n => {
                    const isCollapsed = n.flags && n.flags.collapsed;
                    const titleHeight = LiteGraph.NODE_TITLE_HEIGHT || 30;
                    const w = getNodeWidth(n);
                    const effectiveY = n.pos[1] - titleHeight;
                    const effectiveBottom = n.pos[1] + (isCollapsed ? 0 : n.size[1]);

                    minX = Math.min(minX, n.pos[0]);
                    minY = Math.min(minY, effectiveY);
                    maxX = Math.max(maxX, n.pos[0] + w);
                    maxY = Math.max(maxY, effectiveBottom);
                });

                draggingGroups.forEach(g => {
                    const titleHeight = 30;
                    const effectiveY = g.pos[1] - titleHeight;
                    minX = Math.min(minX, g.pos[0]);
                    minY = Math.min(minY, effectiveY);
                    maxX = Math.max(maxX, g.pos[0] + g.size[0]);
                    maxY = Math.max(maxY, g.pos[1] + g.size[1]);
                });

                const ds = canvas.ds;
                const scale = ds.scale;
                const width = (maxX - minX) * scale;
                const height = (maxY - minY) * scale;

                if (!ghost) {
                    ghost = createGhostElement({ width, height }, draggingNodes, draggingGroups, minX, minY, scale);
                    ghost.style.display = "block";

                    const rect = canvas.canvas.getBoundingClientRect();
                    const screenMinX = (minX + ds.offset[0]) * scale + rect.left;
                    const screenMinY = (minY + ds.offset[1]) * scale + rect.top;

                    ghostOffset.x = evt.clientX - screenMinX;
                    ghostOffset.y = evt.clientY - screenMinY;
                }

                const targetScreenLeft = evt.clientX - ghostOffset.x;
                const targetScreenTop = evt.clientY - ghostOffset.y;
                const rect = canvas.canvas.getBoundingClientRect();

                let graphX = (targetScreenLeft - rect.left) / scale - ds.offset[0];
                let graphY = (targetScreenTop - rect.top) / scale - ds.offset[1];

                if (canvas.align_to_grid || true) {
                    const gridSize = LiteGraph.CANVAS_GRID_SIZE || 10;
                    graphX = Math.round(graphX / gridSize) * gridSize;
                    graphY = Math.round(graphY / gridSize) * gridSize;
                }

                ghost.style.width = width + "px";
                ghost.style.height = height + "px";

                const respectPinned = app.ui.settings.getSettingValue("Comfy.NodeGhost.RespectPinned");

                const children = Array.from(ghost.children);
                let ghostIdx = 0;

                draggingNodes.forEach((n, i) => {
                    const child = children[ghostIdx++];
                    if (!child) return;
                    const isCollapsed = n.flags && n.flags.collapsed;
                    const titleHeight = LiteGraph.NODE_TITLE_HEIGHT || 30;
                    const subW = getNodeWidth(n);
                    const subH = isCollapsed ? titleHeight : (n.size[1] + titleHeight);
                    const isNodePinned = respectPinned && (n.flags && n.flags.pinned);

                    child.style.width = (subW * scale) + "px";
                    child.style.height = (subH * scale) + "px";

                    if (isNodePinned) {
                        child.style.left = ((initialNodePositions[i].x - graphX) * scale) + "px";
                        child.style.top = (((initialNodePositions[i].y - titleHeight) - graphY) * scale) + "px";
                    } else {
                        child.style.left = ((initialNodePositions[i].x - minX) * scale) + "px";
                        child.style.top = (((initialNodePositions[i].y - titleHeight) - minY) * scale) + "px";
                    }
                    child.style.display = "block";
                });

                draggingGroups.forEach((g, i) => {
                    const child = children[ghostIdx++];
                    if (!child) return;
                    const titleHeight = 30;
                    child.style.width = (g.size[0] * scale) + "px";
                    child.style.height = ((g.size[1] + titleHeight) * scale) + "px";
                    child.style.left = ((initialGroupPositions[i].x - minX) * scale) + "px";
                    child.style.top = (((initialGroupPositions[i].y - titleHeight) - minY) * scale) + "px";
                    child.style.display = "block";
                });

                const finalScreenLeft = (graphX + ds.offset[0]) * scale + rect.left;
                const finalScreenTop = (graphY + ds.offset[1]) * scale + rect.top;

                ghost.style.left = finalScreenLeft + "px";
                ghost.style.top = finalScreenTop + "px";
            });
        };

        const pointerUpHandler = (e) => {
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            lastMoveEvent = null;

            if (isDragging && ghost) {
                const ds = canvas.ds;
                const scale = ds.scale;
                const rect = canvas.canvas.getBoundingClientRect();

                const targetScreenLeft = e.clientX - ghostOffset.x;
                const targetScreenTop = e.clientY - ghostOffset.y;

                let finalGraphX = (targetScreenLeft - rect.left) / scale - ds.offset[0];
                let finalGraphY = (targetScreenTop - rect.top) / scale - ds.offset[1];

                if (canvas.align_to_grid || true) {
                    const gridSize = LiteGraph.CANVAS_GRID_SIZE || 10;
                    finalGraphX = Math.round(finalGraphX / gridSize) * gridSize;
                    finalGraphY = Math.round(finalGraphY / gridSize) * gridSize;
                }

                let minInitialX = Infinity, minInitialY = Infinity;
                const titleHeight = LiteGraph.NODE_TITLE_HEIGHT || 30;

                draggingNodes.forEach((n, i) => {
                    const effectiveY = initialNodePositions[i].y - titleHeight;
                    minInitialX = Math.min(minInitialX, initialNodePositions[i].x);
                    minInitialY = Math.min(minInitialY, effectiveY);
                });

                draggingGroups.forEach((g, i) => {
                    const effectiveY = initialGroupPositions[i].y - 30;
                    minInitialX = Math.min(minInitialX, initialGroupPositions[i].x);
                    minInitialY = Math.min(minInitialY, effectiveY);
                });

                const DeltaX = finalGraphX - minInitialX;
                const DeltaY = finalGraphY - minInitialY;

                const respectPinned = app.ui.settings.getSettingValue("Comfy.NodeGhost.RespectPinned");
                let nodesMoved = false;

                draggingNodes.forEach((n, i) => {
                    const isNodePinned = respectPinned && (n.flags && n.flags.pinned);
                    if (isNodePinned) return;

                    const newX = initialNodePositions[i].x + DeltaX;
                    const newY = initialNodePositions[i].y + DeltaY;

                    n.pos[0] = newX;
                    n.pos[1] = newY;

                    if (n.onNodeMoved) n.onNodeMoved();
                    nodesMoved = true;
                });

                draggingGroups.forEach((g, i) => {
                    g.pos[0] = initialGroupPositions[i].x + DeltaX;
                    g.pos[1] = initialGroupPositions[i].y + DeltaY;
                    nodesMoved = true;
                });

                extraNodes.forEach((n, i) => {
                    const isNodePinned = respectPinned && (n.flags && n.flags.pinned);
                    if (isNodePinned) return;

                    n.pos[0] = initialExtraPositions[i].x + DeltaX;
                    n.pos[1] = initialExtraPositions[i].y + DeltaY;

                    if (n.onNodeMoved) n.onNodeMoved();
                    nodesMoved = true;
                });

                if (nodesMoved) canvas.setDirty(true, true);
            }

            if (ghost) {
                ghost.remove();
                ghost = null;
            }
            draggingNodes = [];
            initialNodePositions = [];
            draggingGroups = [];
            initialGroupPositions = [];
            isDragging = false;
        };

        const cancelDrag = () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            lastMoveEvent = null;

            if (isDragging) {
                if (draggingNodes.length > 0) {
                    draggingNodes.forEach((n, i) => {
                        if (initialNodePositions[i]) {
                            n.pos[0] = initialNodePositions[i].x;
                            n.pos[1] = initialNodePositions[i].y;
                        }
                    });
                }
                if (draggingGroups.length > 0) {
                    draggingGroups.forEach((g, i) => {
                        if (initialGroupPositions[i]) {
                            g.pos[0] = initialGroupPositions[i].x;
                            g.pos[1] = initialGroupPositions[i].y;
                        }
                    });
                }
                if (extraNodes.length > 0) {
                    extraNodes.forEach((n, i) => {
                        if (initialExtraPositions[i]) {
                            n.pos[0] = initialExtraPositions[i].x;
                            n.pos[1] = initialExtraPositions[i].y;
                        }
                    });
                }
                canvas.setDirty(true, true);
            }

            if (ghost) {
                ghost.remove();
                ghost = null;
            }
            draggingNodes = [];
            initialNodePositions = [];
            draggingGroups = [];
            initialGroupPositions = [];
            extraNodes = [];
            initialExtraPositions = [];
            isDragging = false;
        };

        const keyDownHandler = (e) => {
            if (e.key === "Escape" && isDragging) {
                cancelDrag();
                e.stopPropagation();
                e.preventDefault();
            }
        };

        window.addEventListener("pointerdown", pointerDownHandler, true);
        window.addEventListener("pointermove", pointerMoveHandler, true);
        window.addEventListener("pointerup", pointerUpHandler, true);
        window.addEventListener("keydown", keyDownHandler, true);
    }
});
