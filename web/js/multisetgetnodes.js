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
        if (!graph || !widgetValue) return [];
        return graph._nodes?.filter(otherNode =>
            otherNode.type === nodeType &&
            otherNode.widgets[0].value === widgetValue
        ) || [];
    },
    findNodeByTypeAndName: function(graph, nodeType, widgetValue) {
        if (!graph || !widgetValue) return null;
        return graph._nodes?.find(otherNode =>
            otherNode.type === nodeType &&
            otherNode.widgets[0].value === widgetValue
        ) || null;
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

            // 自定义序列化钩子：保存 inputs 上的 _fieldId 属性
            _serialize() {
                return {
                    inputs: this.inputs.map(input => ({
                        _fieldId: input._fieldId
                    }))
                };
            }

            configure(data) {
                // Mark that we're in configuration phase to prevent side effects
                this._isConfiguring = true;

                const result = super.configure(data);

                // After configuration is loaded, restore the field IDs on inputs
                // First try to restore from _serialize data (exact matches)
                if (data.inputs) {
                    data.inputs.forEach((savedInput, index) => {
                        if (this.inputs[index] && savedInput._fieldId) {
                            this.inputs[index]._fieldId = savedInput._fieldId;
                        }
                    });
                }

                // Then fallback to matching existing fields from properties with inputs
                if (this.properties && this.properties.fields) {
                    // 修复：清理 properties.fields 中的无效字段（fieldId为 null/undefined/''/'undefined'）
                    const validFields = {};
                    Object.entries(this.properties.fields).forEach(([fieldId, fieldData]) => {
                        if (fieldId && fieldId !== 'undefined' && fieldData && fieldData.name) {
                            validFields[fieldId] = fieldData;
                        } else {
                            console.warn(`[MultiSetNode DEBUG] Clearing invalid field in properties.fields:`, { fieldId, fieldData });
                        }
                    });

                    if (Object.keys(this.properties.fields).length !== Object.keys(validFields).length) {
                        console.warn(`[MultiSetNode DEBUG] Cleaned properties.fields from ${Object.keys(this.properties.fields).length} to ${Object.keys(validFields).length} fields`);
                        this.properties.fields = validFields;
                    }

                    const fieldIds = Object.keys(this.properties.fields);
                    fieldIds.forEach((fieldId, index) => {
                        // Only set fieldId if we don't have it already from _serialize
                        if (this.inputs[index] && !this.inputs[index]._fieldId) {
                            this.inputs[index]._fieldId = fieldId;
                        }
                    });
                }

                // 关键修复：完全同步 widgets 与 properties.fields（与 clone() 方法类似）
                // 前3个 widget 是固定的：name、+Add Field、-Remove Last（都是0-based）
                const preservedWidgets = this.widgets.slice(0, 3);
                this.widgets.length = 0;
                preservedWidgets.forEach(w => this.widgets.push(w));

                if (this.properties.fields) {
                    const fieldIds = Object.keys(this.properties.fields);
                    fieldIds.forEach((fieldId, index) => {
                        const fieldData = this.properties.fields[fieldId];

                        // Add text widget for field name
                        const fieldWidget = this.addWidget(
                            "text",
                            `Field ${index + 1}`,
                            fieldData.name,
                            function(value) {
                                const widgetIndex = this.widgets.indexOf(fieldWidget);
                                const inputIndex = widgetIndex - 3; // 前面3个是固定的
                                if (inputIndex >= 0 && inputIndex < this.inputs.length && this.inputs[inputIndex]) {
                                    const oldName = this.inputs[inputIndex].name;
                                    updateFieldName(this, inputIndex, oldName, value, fieldWidget);
                                }
                            }.bind(this),
                            {}
                        );
                    });
                }

                // Clear the configuring flag after a short delay to ensure everything is ready
                setTimeout(() => {
                    this._isConfiguring = false;
                    // Update linked getters only after configuration is complete
                    this.update();
                }, 100);

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
                console.log("[MultiGetNode DEBUG] onGroupChange() called", {
                    nodeTitle: this.title,
                    nodeId: this.id,
                    _isConfiguring: this._isConfiguring,
                    widgetValue: this.widgets && this.widgets[0] ? this.widgets[0].value : null
                });

                // Skip if we're in the middle of configuring to prevent duplicates
                if (this._isConfiguring) {
                    
                    return;
                }

                if (!this.graph || !this.widgets || !this.widgets[0]) {
                    
                    return;
                }
                this.currentSetter = this.findSetter(this.graph);
                console.log("[MultiGetNode DEBUG] Found setter node in onGroupChange():",
                    this.currentSetter ? { title: this.currentSetter.title, id: this.currentSetter.id } : null);

                if (this.currentSetter) {
                    console.log("[MultiGetNode DEBUG] Setter properties.fields:", this.currentSetter.properties.fields);
                    this.title = "Get_" + this.currentSetter.widgets[0].value;
                    // 使用保留连线的 updateFields 方法，替代 safeSyncFromScratch()
                    this.updateFields(this.currentSetter.properties.fields);
                } else {
                    
                    this.title = "Multi Get";
                    this.clearOutputs();
                    this.currentSetter = null;
                }
            }

            updateFields(fields) {
                // 在 _isConfiguring 期间，完全阻止 updateFields() 的调用！这是防止重复字段的关键！
                if (this._isConfiguring) {
                    console.log("[MultiGetNode DEBUG] updateFields() skipped during configuration", {
                        nodeTitle: this.title,
                        nodeId: this.id
                    });
                    return;
                }

                console.log("[MultiGetNode DEBUG] updateFields() called", {
                    nodeTitle: this.title,
                    nodeId: this.id,
                    fields: fields,
                    currentOutputsCount: this.outputs.length
                });

                if (!fields) {
                    
                    return;
                }

                // 过滤掉无效字段（保留在 MultiGetNode 中的修复）
                const validFieldsEntries = Object.entries(fields || {}).filter(([fieldId, fieldData]) => {
                    const isValid = fieldId && fieldId !== 'undefined' && fieldData && fieldData.name;
                    if (!isValid) {
                        console.warn(`[MultiGetNode DEBUG] Filtering invalid field from fields: fieldId=${fieldId}, fieldData=`, fieldData);
                    }
                    return isValid;
                });

                // 创建现有字段的 map：key 是 fieldId, value 是索引
                const fieldIdToIndex = new Map();
                // 创建现有字段的 name 到索引的 map：用于 name 匹配（当 _fieldId 无效时）
                const fieldNameToIndex = new Map();

                this.outputs.forEach((output, index) => {
                    if (output._fieldId && output._fieldId !== 'undefined' && output._fieldId !== 'null') {
                        fieldIdToIndex.set(output._fieldId, index);
                    }
                    if (output.name) {
                        fieldNameToIndex.set(output.name, index);
                    }
                });

                let hasChanges = false;
                const processedFieldIds = new Set();

                // 处理每个有效的字段
                validFieldsEntries.forEach(([fieldId, fieldData]) => {
                    console.log(`[MultiGetNode DEBUG] Processing valid field: fieldId=${fieldId}, name=${fieldData.name}`);

                    let targetIndex = -1;

                    // 先尝试通过 fieldId 匹配
                    if (fieldIdToIndex.has(fieldId)) {
                        targetIndex = fieldIdToIndex.get(fieldId);
                        processedFieldIds.add(fieldId);
                        console.log(`[MultiGetNode DEBUG] Field found by fieldId at index ${targetIndex}`);
                    }
                    // 如果 fieldId 没找到，尝试通过 name 匹配（保留连线）
                    else if (fieldNameToIndex.has(fieldData.name)) {
                        targetIndex = fieldNameToIndex.get(fieldData.name);
                        // 更新匹配的输出的 fieldId
                        this.outputs[targetIndex]._fieldId = fieldId;
                        processedFieldIds.add(fieldId); // 关键修复：标记为已处理！
                        console.log(`[MultiGetNode DEBUG] Field found by name at index ${targetIndex}, updating fieldId (processed)`);
                        hasChanges = true;
                    }
                    // 都没找到，添加新输出
                    else {
                        console.log(`[MultiGetNode DEBUG] Adding new output fieldId=${fieldId}, name=${fieldData.name}`);
                        this.addOutput(fieldData.name, fieldData.type);
                        this.outputs[this.outputs.length - 1]._fieldId = fieldId;
                        hasChanges = true;
                        return;
                    }

                    // 更新字段的其他属性
                    const output = this.outputs[targetIndex];
                    if (output.name !== fieldData.name) {
                        output.name = fieldData.name;
                        hasChanges = true;
                        console.log(`[MultiGetNode DEBUG] Updated field name at index ${targetIndex} from ${output.name} to ${fieldData.name}`);
                    }
                    if (output.type !== fieldData.type) {
                        output.type = fieldData.type;
                        hasChanges = true;
                        console.log(`[MultiGetNode DEBUG] Updated field type at index ${targetIndex} from ${output.type} to ${fieldData.type}`);
                    }
                });

                // 删除不存在于 MultiSetNode 中的字段（倒序删除）
                for (let i = this.outputs.length - 1; i >= 0; i--) {
                    const output = this.outputs[i];
                    const fieldIdValid = output._fieldId && output._fieldId !== 'undefined' && output._fieldId !== 'null';

                    if (fieldIdValid) {
                        // 检查这个 fieldId 是否在我们处理过的列表中
                        const fieldStillExists = validFieldsEntries.some(([id]) => id === output._fieldId);
                        if (!fieldStillExists) {
                            console.log(`[MultiGetNode DEBUG] Removing field by fieldId: index=${i}, fieldId=${output._fieldId}, name=${output.name}`);
                            this.removeOutput(i);
                            hasChanges = true;
                        }
                    } else {
                        // 如果没有有效的 fieldId，尝试通过 name 检查
                        const nameStillExists = validFieldsEntries.some(([_, data]) => data.name === output.name);
                        if (!nameStillExists) {
                            console.log(`[MultiGetNode DEBUG] Removing field by name: index=${i}, name=${output.name}`);
                            this.removeOutput(i);
                            hasChanges = true;
                        }
                    }
                }

                if (hasChanges) {
                    this.size = this.computeSize();
                    this.validateLinks();
                }

                console.log(`[MultiGetNode DEBUG] updateFields() completed, final outputs count: ${this.outputs.length}`);
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
                cloned._isConfiguring = false; // 关键修复：确保克隆节点的配置标志是 false
                cloned.size = cloned.computeSize();

                console.log("[MultiGetNode DEBUG] clone() completed", {
                    originalTitle: this.title,
                    clonedTitle: cloned.title,
                    nodeId: cloned.id,
                    _isConfiguring: cloned._isConfiguring
                });
                return cloned;
            }

            onAdded(graph) {
                console.log("[MultiGetNode DEBUG] onAdded() called", {
                    nodeTitle: this.title,
                    nodeId: this.id,
                    hasGraph: !!graph,
                    _isConfiguring: this._isConfiguring,
                    widgetValue: this.widgets && this.widgets[0] ? this.widgets[0].value : null
                });

                // 确保 _isConfiguring 标志有默认值
                if (this._isConfiguring === undefined) {
                    this._isConfiguring = false;
                }

                // When node is added to graph (including after cloning),
                // update fields if we have a selected group
                if (this.widgets && this.widgets.length > 0 && this.widgets[0]) {
                    // 关键修复：粘贴操作可能 widget 值还没完全恢复，使用延迟调用
                    const widgetValue = this.widgets[0].value;

                    const trySync = () => {
                        // 再次检查，可能 widget 值已更新
                        const currentValue = this.widgets && this.widgets[0] ? this.widgets[0].value : null;

                        console.log("[MultiGetNode DEBUG] onAdded() trySync", {
                            currentValue: currentValue,
                            originalValue: widgetValue
                        });

                        if (currentValue) {
                            // 临时覆盖 _isConfiguring 标志，确保能同步字段
                            const savedIsConfiguring = this._isConfiguring;
                            this._isConfiguring = false;

                            this.onGroupChange();

                            // 恢复原始标志
                            this._isConfiguring = savedIsConfiguring;
                        }
                    };

                    // 如果当前已有值，直接同步；否则延迟尝试
                    if (widgetValue) {
                        trySync();
                    } else {
                        // 对于粘贴操作，widget 值可能需要等待一下才能恢复
                        setTimeout(trySync, 50);
                        setTimeout(trySync, 200);
                    }
                }
            }

            _serialize() {
                console.log("[MultiGetNode DEBUG] _serialize() called, saving", this.outputs.length, "outputs");
                return {
                    outputs: this.outputs.map(output => ({
                        _fieldId: output._fieldId,
                        name: output.name
                    }))
                };
            }

            configure(data) {
                // 关键：在调用任何可能触发 updateFields() 的操作之前，先设置 _isConfiguring！
                this._isConfiguring = true;

                // 输出完整 data 对象，用于调试
                console.log("[MultiGetNode DEBUG] configure() full data:", data);
                console.log("[MultiGetNode DEBUG] configure() data.keys:", Object.keys(data));
                if (data._serialized) {
                    console.log("[MultiGetNode DEBUG] configure() data._serialized:", data._serialized);
                    if (data._serialized.outputs) {
                        console.log("[MultiGetNode DEBUG] configure() data._serialized.outputs.length:", data._serialized.outputs.length);
                        console.log("[MultiGetNode DEBUG] configure() data._serialized.outputs:", data._serialized.outputs);
                    }
                }

                console.log("[MultiGetNode DEBUG] configure() called", {
                    nodeTitle: this.title,
                    nodeId: this.id,
                    dataKeys: Object.keys(data),
                    hasOutputs: !!data.outputs,
                    outputsCount: data.outputs ? data.outputs.length : 0,
                    outputs: data.outputs ? data.outputs.map(o => ({ name: o.name, _fieldId: o._fieldId })) : []
                });

                // 保存原始配置数据中的 outputs，用于恢复 fieldId
                // 首先检查 data._serialized 或 data.outputs 中是否有保存的 _fieldId
                let savedOutputs = [];
                if (data.outputs) {
                    savedOutputs = data.outputs.map((o, i) => ({
                        name: o.name,
                        _fieldId: (data.outputs && data.outputs[i] && data.outputs[i]._fieldId) ||
                                  (data._serialized && data._serialized.outputs && data._serialized.outputs[i] && data._serialized.outputs[i]._fieldId)
                    }));
                }

                // 先调用 super.configure() 恢复基本状态
                const result = super.configure(data);

                console.log("[MultiGetNode DEBUG] After super.configure(), current outputs:",
                    this.outputs.map(o => ({ name: o.name, _fieldId: o._fieldId })));

                // 关键修复：恢复保存的 outputs 的 _fieldId
                // 并且确保我们的恢复是在 super.configure() 之后立即执行
                let allFieldIdsRestored = true;
                if (savedOutputs && savedOutputs.length > 0) {
                    savedOutputs.forEach((savedOutput, index) => {
                        if (this.outputs[index]) {
                            // 只在 savedOutput._fieldId 确实有效时才恢复
                            if (savedOutput._fieldId && savedOutput._fieldId !== 'undefined' && savedOutput._fieldId !== 'null') {
                                this.outputs[index]._fieldId = savedOutput._fieldId;
                            } else {
                                // 只要有一个输出的 fieldId 是无效的，就标记为未完全恢复
                                allFieldIdsRestored = false;
                            }
                        }
                    });
                    console.log("[MultiGetNode DEBUG] After restoring field IDs:",
                        this.outputs.map(o => ({ name: o.name, _fieldId: o._fieldId })),
                        "allFieldIdsRestored:", allFieldIdsRestored);
                }

                // 延迟同步，确保 graph 和 setter 节点都已恢复
                if (this.widgets && this.widgets.length > 0 && this.widgets[0]) {
                    console.log("[MultiGetNode DEBUG] Widget available, scheduling sync with value:", this.widgets[0].value);

                    if (!this._configureTimeout) {
                        this._configureTimeout = setTimeout(() => {
                            const localTimeout = this._configureTimeout;
                            this._configureTimeout = null;

                            // 只有当我们还是有效的 timeout 持有者时才清除标志并同步
                            if (!localTimeout) {
                                return;
                            }

                            // 关键修复：即使 widgetValue 之前是空的，现在再检查一次
                            const widgetValue = this.widgets && this.widgets[0] ? this.widgets[0].value : null;
                            console.log("[MultiGetNode DEBUG] Timeout sync, widgetValue now:", widgetValue);

                            if (widgetValue) {
                                this._isConfiguring = false;
                                this.currentSetter = this.findSetter(this.graph);
                                if (this.currentSetter) {
                                    this.title = "Get_" + this.currentSetter.widgets[0].value;

                                    if (allFieldIdsRestored) {

                                    } else {
                                        // 如果 fieldId 恢复失败，直接调用 updateFields()，它能正确处理
                                        console.log("[MultiGetNode DEBUG] allFieldIdsRestored is false, calling updateFields");
                                        this.updateFields(this.currentSetter.properties.fields);
                                    }
                                }
                            }
                        }, 200);

                        // 备用同步，确保能处理粘贴操作的 widgetValue 延迟恢复
                        setTimeout(() => {
                            const widgetValue = this.widgets && this.widgets[0] ? this.widgets[0].value : null;
                            if (widgetValue && !this.currentSetter) {
                                console.log("[MultiGetNode DEBUG] Backup sync, widgetValue found:", widgetValue);
                                this._isConfiguring = false;
                                this.currentSetter = this.findSetter(this.graph);
                                if (this.currentSetter) {
                                    this.title = "Get_" + this.currentSetter.widgets[0].value;
                                    this.updateFields(this.currentSetter.properties.fields);
                                }
                            }
                        }, 400);
                    }
                } else {

                    setTimeout(() => {
                        if (!this._configureTimeout) {
                            this._isConfiguring = false;
                        }
                    }, 0);
                }

                return result;
            }


            // 保持向后兼容的安全同步方法
            safeOnGroupChange() {
                if (this._isConfiguring) {
                    return;
                }
                this.onGroupChange();
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
