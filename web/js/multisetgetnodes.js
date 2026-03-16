const { app } = window.comfyAPI.app;
const LGraphNode = LiteGraph.LGraphNode;

console.log("[PandaNodes] MultiSet/Get nodes loading...");

// MultiSetNode and MultiGetNode - Support multiple variables in one node
// Based on KJNodes SetNode/GetNode but extended for multi-value support

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
    let uniqueName = preferredName;
    let tries = 0;

    while (node.inputs.some((input) =>
        input._fieldId !== currentId && input.name === uniqueName && input.name !== 'unused'
    )) {
        uniqueName = `${preferredName}_${tries}`;
        tries++;
    }

    return uniqueName;
}

// Update field name with duplicate checking
function updateFieldName(node, inputIndex, oldName, newName, widget) {
    const preferredName = newName.trim() || `field_${inputIndex + 1}`;

    if (preferredName !== oldName) {
        const uniqueName = getUniqueFieldName(node, node.inputs[inputIndex]._fieldId, preferredName);

        // Update input name (display only)
        node.inputs[inputIndex].name = uniqueName;

        // Update properties - using internal ID for storage
        if (node.properties.fields && node.properties.fields[node.inputs[inputIndex]._fieldId]) {
            const fieldData = node.properties.fields[node.inputs[inputIndex]._fieldId];
            fieldData.name = uniqueName;
        }

        // Update widget value to show actual name (including _n suffix)
        if (widget && widget.value !== uniqueName) {
            widget.value = uniqueName;
        }

        node.update();
        node.size = node.computeSize();
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
                if (!this.properties) {
                    this.properties = {
                        "previousName": "",
                        "fields": {} // Store field data by internal ID: { id1: { name: "field1", type: "INT" }, id2: { name: "field2", type: "FLOAT" } }
                    };
                }

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
                            if (!node.properties.fields) {
                                node.properties.fields = {};
                            }
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
                // 确保properties和fields属性已初始化
                if (!this.properties) {
                    this.properties = {
                        previousName: "",
                        fields: {}
                    };
                }
                if (!this.properties.fields) {
                    this.properties.fields = {};
                }

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
                const cloned = MultiSetNode.prototype.clone.apply(this);
                cloned.properties = JSON.parse(JSON.stringify(this.properties));
                cloned.properties.previousName = '';
                cloned.size = cloned.computeSize();

                // Reset inputs and widgets
                while (cloned.inputs.length > 0) {
                    cloned.removeInput(0);
                }
                // Keep first 3 widgets (group name and buttons), remove others
                while (cloned.widgets.length > 3) {
                    cloned.widgets.pop();
                }

                // Re-add fields with widgets
                Object.keys(cloned.properties.fields || {}).forEach((fieldId, index) => {
                    const fieldData = cloned.properties.fields[fieldId];
                    cloned.addInput(fieldData.name, fieldData.type);
                    const newInputIndex = cloned.inputs.length - 1;
                    cloned.inputs[newInputIndex]._fieldId = fieldId;

                    // Add text widget for field name
                    const node = cloned;
                    const fieldWidget = cloned.addWidget(
                        "text",
                        `Field ${index + 1}`,
                        fieldData.name,
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
                });

                if (Object.keys(cloned.properties.fields || {}).length === 0) {
                    cloned.addField();
                }

                return cloned;
            }

            onAdded(graph) {
                this.validateName(graph);
            }

            update() {
                if (!this.graph) {
                    return;
                }

                // Ensure properties and fields exist
                if (!this.properties) {
                    this.properties = {
                        previousName: "",
                        fields: {}
                    };
                }
                if (!this.properties.fields) {
                    this.properties.fields = {};
                }

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
                return graph._nodes.filter(otherNode =>
                    otherNode.type === 'MultiGetNode' &&
                    otherNode.widgets[0].value === name &&
                    name !== ''
                );
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
                this.currentSetter = this.findSetter(this.graph); // 缓存 setter 引用
                if (this.currentSetter) {
                    this.title = "Get_" + this.currentSetter.widgets[0].value;
                    this.updateFields(this.currentSetter.properties.fields);
                    // 验证连接
                    this.validateLinks();
                } else {
                    this.title = "Multi Get";
                    this.clearOutputs();
                    this.currentSetter = null;
                }
            }

            updateFields(fields) {
                console.log("=== updateFields called ===");
                console.log("Incoming fields:", JSON.stringify(fields, null, 2));
                console.log("Current outputs before update:", JSON.stringify(this.outputs.map((o, idx) => ({
                    idx, name: o.name, type: o.type, _fieldId: o._fieldId
                })), null, 2));

                // fields is a map of internal IDs to {name, type}
                const fieldEntries = Object.entries(fields || {});

                // Create a map of existing fields by fieldId for quick lookups
                const existingFields = new Map();
                this.outputs.forEach((output, index) => {
                    if (output._fieldId) {
                        existingFields.set(output._fieldId, { index, output });
                    }
                });

                console.log("Existing fields map:", JSON.stringify(
                    [...existingFields.entries()].map(([id, val]) => ({
                        fieldId: id,
                        index: val.index,
                        name: val.output.name,
                        type: val.output.type
                    })),
                    null,
                    2
                ));

                // Process each field from MultiSetNode
                fieldEntries.forEach(([fieldId, fieldData]) => {
                    if (existingFields.has(fieldId)) {
                        // Field exists, update name and type if needed
                        const { index, output } = existingFields.get(fieldId);
                        console.log(`Updating existing field: ${fieldId} at index ${index}`);
                        console.log(`  Old: name=${output.name}, type=${output.type}`);
                        console.log(`  New: name=${fieldData.name}, type=${fieldData.type}`);

                        if (output.name !== fieldData.name) {
                            output.name = fieldData.name;
                        }
                        if (output.type !== fieldData.type) {
                            output.type = fieldData.type;
                        }
                        existingFields.delete(fieldId); // Mark as processed
                    } else {
                        // Field doesn't exist, add new output
                        console.log(`Adding new field: ${fieldId} name=${fieldData.name} type=${fieldData.type}`);
                        this.addOutput(fieldData.name, fieldData.type);
                        this.outputs[this.outputs.length - 1]._fieldId = fieldId;
                        console.log(`  Added output at index ${this.outputs.length - 1}`);
                    }
                });

                console.log("Remaining existing fields to remove:", JSON.stringify(
                    [...existingFields.entries()].map(([id, val]) => ({
                        fieldId: id,
                        index: val.index
                    })),
                    null,
                    2
                ));

                // Remove fields that are no longer present in MultiSetNode
                // Process in reverse order to avoid index shifts
                Array.from(existingFields.values()).sort((a, b) => b.index - a.index).forEach(({ index }) => {
                    console.log(`Removing output at index ${index}`);
                    this.removeOutput(index);
                });

                console.log("Final outputs after update:", JSON.stringify(this.outputs.map((o, idx) => ({
                    idx, name: o.name, type: o.type, _fieldId: o._fieldId
                })), null, 2));
                console.log("=== updateFields complete ===");

                // Update size
                this.size = this.computeSize();
                // 验证连接
                this.validateLinks();
            }

            clearOutputs() {
                while (this.outputs.length > 0) {
                    this.removeOutput(0);
                }
            }

            getInputLink(slot) {
                console.log(`getInputLink: slot ${slot}`);

                // Validate slot index
                if (slot < 0 || slot >= this.outputs.length) {
                    console.warn(`MultiGetNode: Invalid slot index ${slot} (total outputs: ${this.outputs.length})`);
                    return null;
                }

                // Debug output slots
                this.outputs.forEach((output, i) => {
                    console.log(`Output ${i}: name=${output.name}, _fieldId=${output._fieldId}, type=${output.type}`);
                });

                // Get the corresponding setter node
                if (!this.currentSetter) {
                    this.currentSetter = this.findSetter(this.graph);
                }

                if (this.currentSetter) {
                    // Debug current setter fields
                    console.log("Current setter properties:", this.currentSetter.properties);

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
                        console.log("Setter inputs:", this.currentSetter.inputs.map((i, idx) => ({ idx, name: i.name, _fieldId: i._fieldId, type: i.type })));
                        return null;
                    }

                    const slotInfo = this.currentSetter.inputs[setterInputIndex];
                    if (!slotInfo?.link || !this.graph?.links) {
                        // No connection yet or invalid graph state
                        return null;
                    }

                    const link = this.graph.links[slotInfo.link];
                    return link || null;
                } else {
                    const name = this.widgets[0].value;
                    if (name) {
                        console.warn(`MultiGetNode: No MultiSetNode found for group "${name}"`);
                    }
                    return null;
                }
            }

            validateLinks() {
                // Remove invalid links when type changes
                this.outputs.forEach((output, slotIndex) => {
                    if (output.links && output.links.length > 0) {
                        // 检查每个输出连接的有效性
                        output.links.filter(linkId => {
                            const link = this.graph.links[linkId];
                            if (!link) {
                                return false; // 无效链接，不处理
                            }

                            // 输出类型是通配符 -> 所有连接都是有效的
                            if (output.type === '*') {
                                return false; // 不要过滤掉任何连接
                            }

                            // 检查输入节点的输入类型
                            const fromNode = this.graph._nodes.find(n => n.id === link.target_id);
                            if (!fromNode || !fromNode.inputs[link.target_slot]) {
                                return false;
                            }

                            const targetInputType = fromNode.inputs[link.target_slot].type;

                            // 目标输入类型是通配符 -> 连接是有效的
                            if (targetInputType === '*') {
                                return false; // 不要过滤掉任何连接
                            }

                            // 检查是否类型匹配：输出类型是否被接受
                            const acceptedTypes = targetInputType.split(",");
                            const outputTypes = output.type.split(",");

                            // 检查输出类型和目标输入类型是否有重叠
                            const hasMatchingType = outputTypes.some(t1 =>
                                acceptedTypes.some(t2 => t1 === t2 || t1 === '*' || t2 === '*')
                            );

                            if (!hasMatchingType) {
                                // 类型不匹配，应该断开连接
                                return true;
                            }

                            return false; // 类型匹配，保留连接
                        }).forEach(linkId => {
                            console.log(`Removing link from ${output.name} (type ${output.type}) due to type mismatch`);
                            this.graph.removeLink(linkId);
                        });
                    }
                });
            }

            findSetter(graph) {
                const name = this.widgets[0].value;
                return graph._nodes.find(otherNode =>
                    otherNode.type === 'MultiSetNode' &&
                    otherNode.widgets[0].value === name &&
                    name !== ''
                );
            }

            clone() {
                const cloned = MultiGetNode.prototype.clone.apply(this);
                cloned.properties = JSON.parse(JSON.stringify(this.properties));
                cloned.size = cloned.computeSize();
                return cloned;
            }

            setComboValues() {
                // To update combo widget, we need to trigger a re-render instead of setting read-only property
                if (this.widgets && this.widgets.length > 0) {
                    const widget = this.widgets[0];
                    // We can force a widget update by temporarily changing and restoring value
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
