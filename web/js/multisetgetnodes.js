const { app } = window.comfyAPI.app;
const LGraphNode = LiteGraph.LGraphNode;

console.log("[PandaNodes] MultiSet/Get nodes loading...");

// MultiSetNode and MultiGetNode - Support multiple variables in one node
// Based on KJNodes SetNode/GetNode but extended for multi-value support

// Type matching utility
const TypeUtils = {
    areTypesCompatible: function(outputType, inputType) {
        if (outputType === '*' || inputType === '*') {
            return true;
        }
        const outputTypes = outputType.split(",");
        const inputTypes = inputType.split(",");
        return outputTypes.some(t1 => inputTypes.some(t2 => t1 === t2));
    }
};

// Node finding utility
const NodeFinder = {
    findNodesByTypeAndName: function(graph, nodeType, widgetValue) {
        if (!widgetValue) return [];
        return graph._nodes.filter(otherNode =>
            otherNode.type === nodeType &&
            otherNode.widgets[0].value === widgetValue
        );
    },
    findNodeByTypeAndName: function(graph, nodeType, widgetValue) {
        if (!widgetValue) return null;
        return graph._nodes.find(otherNode =>
            otherNode.type === nodeType &&
            otherNode.widgets[0].value === widgetValue
        );
    }
};

// Property initialization helper
function ensureProperties(node, defaults = {}) {
    if (!node.properties) {
        node.properties = { ...defaults };
    }
    if (defaults.fields && !node.properties.fields) {
        node.properties.fields = {};
    }
    return node.properties;
}

function showAlert(message) {
    app.extensionManager.toast.add({
        severity: 'warn',
        summary: "Panda MultiSet/Get",
        detail: `${message}`,
        life: 5000,
    });
}

// Get unique field name to avoid duplicates
function getUniqueFieldName(node, currentId, preferredName) {
    if (!node || !node.inputs) {
        return preferredName;
    }

    let uniqueName = preferredName;
    let tries = 0;

    while (node.inputs.some((input) =>
        input && input._fieldId !== currentId && input.name === uniqueName && input.name !== 'unused'
    )) {
        uniqueName = `${preferredName}_${tries}`;
        tries++;
    }

    return uniqueName;
}

// Update field name with duplicate checking
function updateFieldName(node, inputIndex, oldName, newName, widget) {
    // Safety checks
    if (!node || !node.inputs || !node.inputs[inputIndex]) {
        return;
    }

    const preferredName = (newName && newName.trim()) || `field_${inputIndex + 1}`;

    if (preferredName !== oldName) {
        const fieldId = node.inputs[inputIndex]._fieldId;
        const uniqueName = getUniqueFieldName(node, fieldId, preferredName);

        // Update input name (display only)
        node.inputs[inputIndex].name = uniqueName;

        // Update properties - using internal ID for storage
        if (node.properties && node.properties.fields && fieldId && node.properties.fields[fieldId]) {
            const fieldData = node.properties.fields[fieldId];
            fieldData.name = uniqueName;
        }

        // Update widget value to show actual name (including _n suffix)
        if (widget && widget.value !== undefined && widget.value !== uniqueName) {
            widget.value = uniqueName;
        }

        if (node.update) {
            node.update();
        }
        if (node.computeSize) {
            node.size = node.computeSize();
        }
    }
}

app.registerExtension({
    name: "MultiSetNode",
    registerCustomNodes() {
        class MultiSetNode extends LGraphNode {
            serialize_widgets = true;
            drawConnection = false;
            currentGetters = null;
            slotColor = "#FFF";
            canvas = app.canvas;

            constructor(title) {
                super(title);
                ensureProperties(this, { "previousName": "", "fields": {} });

                const node = this;

                // Main name widget
                this.addWidget(
                    "text",
                    "Group Name",
                    '',
                    (s, t, u, v, x) => {
                        if (node.widgets[0].value !== '') {
                            node.title = "Set_" + node.widgets[0].value;
                        } else {
                            node.title = "Multi Set";
                        }
                        node.validateName(node.graph);
                        node.update();
                        node.properties.previousName = node.widgets[0].value;
                    },
                    {}
                );

                // Add/Remove field buttons (as dummy widgets for UI)
                this.addWidget(
                    "button",
                    "+ Add Field",
                    "Add Field",
                    () => {
                        node.addField();
                    }
                );

                this.addWidget(
                    "button",
                    "- Remove Last",
                    "Remove",
                    () => {
                        node.removeLastField();
                    }
                );

                // Initial field
                this.addField();

                // Setup connection handling
                this.setupConnections();
            }

            setupConnections() {
                const node = this;
                this.onConnectionsChange = function(
                    slotType,
                    slot,
                    isChangeConnect,
                    link_info,
                    output
                ) {
                    // Handle disconnect
                    if (slotType == 1 && !isChangeConnect) {
                        const fieldId = this.inputs[slot]._fieldId;
                        if (fieldId && node.properties.fields && node.properties.fields[fieldId]) {
                            node.properties.fields[fieldId].type = '*';
                        }
                        this.inputs[slot].type = '*';
                    }

                    // Handle connect
                    if (link_info && node.graph && slotType == 1 && isChangeConnect) {
                        const resolve = link_info.resolve(node.graph);
                        const type = (resolve?.subgraphInput ?? resolve?.output)?.type;
                        if (type) {
                            // Update input slot
                            const fieldId = this.inputs[slot]._fieldId;
                            this.inputs[slot].type = type;

                            // Store field type - using internal ID
                            ensureProperties(node, { fields: {} });
                            if (!node.properties.fields[fieldId]) {
                                const fieldNum = Object.keys(node.properties.fields).length + 1;
                                node.properties.fields[fieldId] = {
                                    name: `field_${fieldNum}`,
                                    type: type
                                };
                            } else {
                                node.properties.fields[fieldId].type = type;
                            }

                            // Update title based on first connected field if group name is empty
                            if (node.widgets[0].value === '' && slot === 0) {
                                node.title = "Set_" + type;
                            }
                        } else {
                            showAlert(`node ${this.title} input undefined.`);
                        }
                    }

                    // Update linked getters and validate links
                    node.update();

                    // Validate all getters' links after type change
                    const getters = node.findGetters(node.graph);
                    getters.forEach(getter => {
                        if (getter.validateLinks) {
                            getter.validateLinks();
                        }
                    });

                    node.size = node.computeSize();
                };
            }

            addField() {
                const fieldId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`; // Unique internal ID
                ensureProperties(this, { previousName: "", fields: {} });

                const fieldNum = Object.keys(this.properties.fields).length + 1;
                const fieldName = `field_${fieldNum}`;

                this.addInput(fieldName, '*');
                const newInputIndex = this.inputs.length - 1;
                this.inputs[newInputIndex]._fieldId = fieldId;

                // Store field data with internal ID
                this.properties.fields[fieldId] = {
                    name: fieldName,
                    type: '*'
                };

                // Add text widget for field name
                const node = this;
                const fieldWidget = this.addWidget(
                    "text",
                    `Field ${fieldNum}`,
                    fieldName,
                    (value) => {
                        const widgetIndex = node.widgets.indexOf(fieldWidget);
                        const inputIndex = widgetIndex - 3;
                        if (inputIndex >= 0 && inputIndex < node.inputs.length) {
                            const oldName = node.inputs[inputIndex].name;
                            updateFieldName(node, inputIndex, oldName, value, fieldWidget);
                        }
                    },
                    {}
                );

                this.size = this.computeSize();
                this.update();
            }

            removeLastField() {
                if (this.inputs.length > 1) {
                    // Find last non-'unused' input
                    for (let i = this.inputs.length - 1; i >= 0; i--) {
                        if (this.inputs[i].name !== 'unused') {
                            const fieldId = this.inputs[i]._fieldId;
                            if (this.properties.fields && this.properties.fields[fieldId]) {
                                delete this.properties.fields[fieldId];
                            }
                            this.removeInput(i);
                            break;
                        }
                    }

                    // Remove the corresponding widget (last one)
                    if (this.widgets.length > 3) {
                        this.widgets.pop();
                    }

                    this.size = this.computeSize();
                    this.update();
                }
            }

            validateName(graph) {
                let widgetValue = this.widgets[0].value;

                if (widgetValue !== '') {
                    let tries = 0;
                    const existingValues = new Set();

                    graph._nodes.forEach(otherNode => {
                        if (otherNode !== this && otherNode.type === 'MultiSetNode') {
                            existingValues.add(otherNode.widgets[0].value);
                        }
                    });

                    while (existingValues.has(widgetValue)) {
                        widgetValue = this.widgets[0].value + "_" + tries;
                        tries++;
                    }

                    this.widgets[0].value = widgetValue;
                    this.update();
                }
            }

            clone() {
                const cloned = super.clone();
                cloned.properties = JSON.parse(JSON.stringify(this.properties));
                cloned.properties.previousName = '';

                // Reset inputs - remove all first
                while (cloned.inputs.length > 0) {
                    cloned.removeInput(0);
                }

                // Keep first 3 widgets, rebuild the rest carefully
                const preservedWidgets = cloned.widgets.slice(0, 3);
                cloned.widgets.length = 0;
                preservedWidgets.forEach(w => cloned.widgets.push(w));

                // Re-add fields with widgets
                const fieldIds = Object.keys(cloned.properties.fields || {});
                fieldIds.forEach((fieldId, index) => {
                    const fieldData = cloned.properties.fields[fieldId];
                    cloned.addInput(fieldData.name, fieldData.type);
                    const newInputIndex = cloned.inputs.length - 1;
                    cloned.inputs[newInputIndex]._fieldId = fieldId;

                    // Add text widget for field name
                    const fieldWidget = cloned.addWidget(
                        "text",
                        `Field ${index + 1}`,
                        fieldData.name,
                        function(value) {
                            // Use this.widgets instead of captured variable to avoid stale references
                            const widgetIndex = this.widgets.indexOf(fieldWidget);
                            const inputIndex = widgetIndex - 3;
                            if (inputIndex >= 0 && inputIndex < this.inputs.length && this.inputs[inputIndex]) {
                                const oldName = this.inputs[inputIndex].name;
                                updateFieldName(this, inputIndex, oldName, value, fieldWidget);
                            }
                        }.bind(cloned),
                        {}
                    );
                });

                if (fieldIds.length === 0) {
                    cloned.addField();
                }

                cloned.size = cloned.computeSize();
                return cloned;
            }

            onAdded(graph) {
                this.validateName(graph);
            }

            configure(data) {
                const result = super.configure(data);

                // After configuration is loaded, restore the field IDs on inputs
                // We need to match existing fields from properties with inputs
                if (this.properties && this.properties.fields) {
                    const fieldIds = Object.keys(this.properties.fields);
                    fieldIds.forEach((fieldId, index) => {
                        if (this.inputs[index]) {
                            this.inputs[index]._fieldId = fieldId;
                        }
                    });
                }

                return result;
            }

            update() {
                if (!this.graph) {
                    return;
                }

                ensureProperties(this, { previousName: "", fields: {} });

                // Update all getters with current field configuration
                const getters = this.findGetters(this.graph);
                getters.forEach(getter => {
                    if (getter.updateFields) {
                        getter.updateFields(this.properties.fields);
                    }
                });

                // Update combo values in all getters
                const allGetters = this.graph._nodes.filter(otherNode => otherNode.type === "MultiGetNode");
                allGetters.forEach(otherNode => {
                    if (otherNode.setComboValues) {
                        otherNode.setComboValues();
                    }
                });
            }

            findGetters(graph) {
                const name = this.widgets[0].value;
                return NodeFinder.findNodesByTypeAndName(graph, 'MultiGetNode', name);
            }

            getFields() {
                // Get current field names and types from properties
                const fields = {};
                if (this.properties && this.properties.fields) {
                    Object.keys(this.properties.fields).forEach(fieldId => {
                        const fieldData = this.properties.fields[fieldId];
                        fields[fieldData.name] = fieldData.type;
                    });
                }
                return fields;
            }

            getExtraMenuOptions(_, options) {
                const menuEntry = this.drawConnection ? "Hide connections" : "Show connections";
                options.unshift(
                    {
                        content: menuEntry,
                        callback: () => {
                            this.currentGetters = this.findGetters(this.graph);
                            if (this.currentGetters.length === 0) return;
                            this.slotColor = this.canvas.default_connection_color_byType['*'] || "#FFF";
                            this.drawConnection = !this.drawConnection;
                            this.canvas.setDirty(true, true);
                        },
                    },
                    {
                        content: "Clear all fields",
                        callback: () => {
                            // Remove all existing inputs
                            while (this.inputs.length > 0) {
                                this.removeInput(0);
                            }
                            // Keep first 3 widgets, remove others
                            while (this.widgets.length > 3) {
                                this.widgets.pop();
                            }
                            this.properties.fields = {};
                            this.addField();
                            this.update();
                        },
                    },
                );

                // Add submenu for linked getters
                this.currentGetters = this.findGetters(this.graph);
                if (this.currentGetters && this.currentGetters.length > 0) {
                    const gettersSubmenu = this.currentGetters.map(getter => ({
                        content: `${getter.title} id: ${getter.id}`,
                        callback: () => {
                            this.canvas.centerOnNode(getter);
                            this.canvas.selectNode(getter, false);
                            this.canvas.setDirty(true, true);
                        },
                    }));

                    options.unshift({
                        content: "Linked Getters",
                        has_submenu: true,
                        submenu: {
                            title: "Getters",
                            options: gettersSubmenu,
                        }
                    });
                }
            }

            onDrawForeground(ctx, lGraphCanvas) {
                if (this.drawConnection) {
                    this._drawVirtualLinks(lGraphCanvas, ctx);
                }
            }

            _drawVirtualLinks(lGraphCanvas, ctx) {
                if (!this.currentGetters?.length) return;

                const title = this.title || "Multi Set";
                const title_width = ctx.measureText(title).width;

                const defaultLink = { type: 'default', color: this.slotColor };

                for (const getter of this.currentGetters) {
                    const start_pos = this.getConnectionPos(false, 0);
                    const end_pos = [
                        getter.pos[0] - this.pos[0] + getter.size[0],
                        getter.pos[1] - this.pos[1] + getter.size[1] / 2,
                    ];

                    lGraphCanvas.renderLink(
                        ctx,
                        start_pos,
                        end_pos,
                        defaultLink,
                        false,
                        null,
                        this.slotColor,
                        LiteGraph.RIGHT,
                        LiteGraph.LEFT
                    );
                }
            }

            // Virtual node - doesn't affect prompt
            get isVirtualNode() {
                return true;
            }
        }

        LiteGraph.registerNodeType(
            "MultiSetNode",
            Object.assign(MultiSetNode, {
                title: "Multi Set",
            })
        );
        MultiSetNode.category = "PandaNodes/Utils";
        console.log("[PandaNodes] MultiSetNode registered");
    },
});

app.registerExtension({
    name: "MultiGetNode",
    registerCustomNodes() {
        class MultiGetNode extends LGraphNode {
            serialize_widgets = true;
            drawConnection = false;
            slotColor = "#FFF";
            currentSetter = null;
            canvas = app.canvas;

            constructor(title) {
                super(title);
                if (!this.properties) {
                    this.properties = {};
                }

                const node = this;

                // Combo widget to select MultiSetNode group
                const comboOptions = {};
                Object.defineProperty(comboOptions, 'values', {
                    get: () => {
                        if (!node.graph) return [];
                        const setterNodes = node.graph._nodes.filter((otherNode) => otherNode.type === 'MultiSetNode');
                        return setterNodes.map((otherNode) => otherNode.widgets[0].value).sort();
                    },
                    enumerable: true,
                    configurable: true
                });

                this.addWidget(
                    "combo",
                    "Group Name",
                    "",
                    (e) => {
                        node.onGroupChange();
                    },
                    comboOptions
                );

                this.setupConnections();
            }

            setupConnections() {
                const node = this;
                this.onConnectionsChange = function(slotType, slot, isChangeConnect, link_info, output) {
                    if (slotType === 2 && isChangeConnect) {
                        const fromNode = node.graph._nodes.find((otherNode) => otherNode.id === link_info.origin_id);
                        if (fromNode) {
                            const fromSlotType = fromNode.inputs[link_info.origin_slot]?.type;
                            if (fromSlotType) {
                                this.outputs[slot].type = fromSlotType;
                            }
                        }
                    }
                    node.validateLinks();
                };
            }

            onGroupChange() {
                if (!this.graph || !this.widgets || !this.widgets[0]) {
                    return;
                }
                this.currentSetter = this.findSetter(this.graph);
                if (this.currentSetter) {
                    this.title = "Get_" + this.currentSetter.widgets[0].value;
                    this.updateFields(this.currentSetter.properties.fields);
                    this.validateLinks();
                } else {
                    this.title = "Multi Get";
                    this.clearOutputs();
                    this.currentSetter = null;
                }
            }

            updateFields(fields) {
                // fields is a map of internal IDs to {name, type}
                const fieldEntries = Object.entries(fields || {});

                // Create a map of existing fields by fieldId for quick lookups
                const existingFields = new Map();
                this.outputs.forEach((output, index) => {
                    if (output._fieldId) {
                        existingFields.set(output._fieldId, { index, output });
                    }
                });

                let hasChanges = false;

                // Process each field from MultiSetNode
                fieldEntries.forEach(([fieldId, fieldData]) => {
                    if (existingFields.has(fieldId)) {
                        // Field exists, update name and type if needed
                        const { index, output } = existingFields.get(fieldId);
                        if (output.name !== fieldData.name) {
                            output.name = fieldData.name;
                            hasChanges = true;
                        }
                        if (output.type !== fieldData.type) {
                            output.type = fieldData.type;
                            hasChanges = true;
                        }
                        existingFields.delete(fieldId); // Mark as processed
                    } else {
                        // Field doesn't exist, add new output
                        this.addOutput(fieldData.name, fieldData.type);
                        this.outputs[this.outputs.length - 1]._fieldId = fieldId;
                        hasChanges = true;
                    }
                });

                // Remove fields that are no longer present in MultiSetNode
                // Process in reverse order to avoid index shifts
                if (existingFields.size > 0) {
                    Array.from(existingFields.values()).sort((a, b) => b.index - a.index).forEach(({ index }) => {
                        this.removeOutput(index);
                    });
                    hasChanges = true;
                }

                // Update size and validate links only if there were changes
                if (hasChanges) {
                    this.size = this.computeSize();
                    this.validateLinks();
                }
            }

            clearOutputs() {
                while (this.outputs.length > 0) {
                    this.removeOutput(0);
                }
            }

            getInputLink(slot) {
                // Validate slot index
                if (slot < 0 || slot >= this.outputs.length) {
                    console.warn(`MultiGetNode: Invalid slot index ${slot}`);
                    return null;
                }

                // Get the corresponding setter node
                if (!this.currentSetter) {
                    this.currentSetter = this.findSetter(this.graph);
                }

                if (this.currentSetter) {
                    // Get the field ID from this output slot
                    const fieldId = this.outputs[slot]?._fieldId;
                    if (!fieldId) {
                        console.warn(`MultiGetNode: No field ID found for output slot ${slot}`);
                        return null;
                    }

                    // Find the corresponding input slot in the setter by field ID
                    const setterInputIndex = this.currentSetter.inputs.findIndex(input => input._fieldId === fieldId);
                    if (setterInputIndex === -1) {
                        console.warn(`MultiGetNode: Field ID ${fieldId} not found in setter`);
                        return null;
                    }

                    const slotInfo = this.currentSetter.inputs[setterInputIndex];
                    const link = this.graph.links[slotInfo.link];
                    return link;
                } else {
                    const name = this.widgets[0].value;
                    if (name) {
                        console.warn(`MultiGetNode: No MultiSetNode found for group "${name}"`);
                    }
                    return null;
                }
            }

            validateLinks() {
                // Skip validation if no outputs or no links
                if (this.outputs.length === 0) return;

                // Remove invalid links when type changes
                this.outputs.forEach((output, slotIndex) => {
                    if (output.links && output.links.length > 0 && output.type !== '*') {
                        const invalidLinks = output.links.filter(linkId => {
                            const link = this.graph.links[linkId];
                            if (!link) return false;

                            const fromNode = this.graph._nodes.find(n => n.id === link.target_id);
                            if (!fromNode || !fromNode.inputs[link.target_slot]) return false;

                            const targetInputType = fromNode.inputs[link.target_slot].type;
                            if (targetInputType === '*') return false;

                            // Check if types are compatible
                            return !TypeUtils.areTypesCompatible(output.type, targetInputType);
                        });

                        invalidLinks.forEach(linkId => {
                            this.graph.removeLink(linkId);
                        });
                    }
                });
            }

            findSetter(graph) {
                const name = this.widgets[0].value;
                return NodeFinder.findNodeByTypeAndName(graph, 'MultiSetNode', name);
            }

            clone() {
                const cloned = super.clone();
                cloned.properties = JSON.parse(JSON.stringify(this.properties));

                // Clear existing outputs (they will be regenerated by onAdded)
                while (cloned.outputs.length > 0) {
                    cloned.removeOutput(0);
                }

                cloned.currentSetter = null;
                cloned.size = cloned.computeSize();
                return cloned;
            }

            onAdded(graph) {
                // When node is added to graph (including after cloning),
                // update fields if we have a selected group
                if (this.widgets && this.widgets.length > 0 && this.widgets[0] && this.widgets[0].value) {
                    this.onGroupChange();
                }
            }

            configure(data) {
                // First call the super class configure method to restore the node
                const result = super.configure(data);

                // After configuration is loaded, restore the field IDs
                if (this.widgets && this.widgets.length > 0 && this.widgets[0] && this.widgets[0].value) {
                    // We need to wait for the graph to be ready and the MultiSetNode to be loaded
                    const restoreFieldIds = () => {
                        if (!this.graph) {
                            // If graph is not yet ready, try again
                            setTimeout(restoreFieldIds, 50);
                            return;
                        }
                        this.onGroupChange();
                    };
                    setTimeout(restoreFieldIds, 0);
                }

                return result;
            }

            setComboValues() {
                // To update combo widget, we need to trigger a re-render instead of setting read-only property
                if (this.widgets && this.widgets.length > 0) {
                    const widget = this.widgets[0];
                    const currentValue = widget.value;
                    widget.value = currentValue;
                }
            }

            getExtraMenuOptions(_, options) {
                const menuEntry = this.drawConnection ? "Hide connections" : "Show connections";
                this.currentSetter = this.findSetter(this.graph);

                if (!this.currentSetter) return;

                options.unshift(
                    {
                        content: "Go to Setter",
                        callback: () => {
                            this.canvas.centerOnNode(this.currentSetter);
                            this.canvas.selectNode(this.currentSetter, false);
                        },
                    },
                    {
                        content: menuEntry,
                        callback: () => {
                            this.drawConnection = !this.drawConnection;
                            this.slotColor = this.canvas.default_connection_color_byType['*'] || "#FFF";
                            this.canvas.setDirty(true, true);
                        },
                    },
                );
            }

            onDrawForeground(ctx, lGraphCanvas) {
                if (this.drawConnection && this.currentSetter) {
                    this._drawVirtualLink(lGraphCanvas, ctx);
                }
            }

            _drawVirtualLink(lGraphCanvas, ctx) {
                const defaultLink = { type: 'default', color: this.slotColor };

                const start_pos = this.currentSetter.getConnectionPos(false, 0);
                const end_pos = [0, this.size[1] / 2];

                lGraphCanvas.renderLink(
                    ctx,
                    start_pos,
                    end_pos,
                    defaultLink,
                    false,
                    null,
                    this.slotColor
                );
            }

            // Virtual node - doesn't affect prompt
            get isVirtualNode() {
                return true;
            }
        }

        LiteGraph.registerNodeType(
            "MultiGetNode",
            Object.assign(MultiGetNode, {
                title: "Multi Get",
            })
        );
        MultiGetNode.category = "PandaNodes/Utils";
        console.log("[PandaNodes] MultiGetNode registered");
    },
});
console.log("[PandaNodes] MultiSet/Get nodes loaded successfully");
