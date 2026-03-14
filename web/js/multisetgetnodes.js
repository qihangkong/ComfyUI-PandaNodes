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
                        "fields": {} // Store field names and types: { field1: "INT", field2: "FLOAT" }
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
                        const fieldName = this.inputs[slot].name;
                        if (fieldName && node.properties.fields && node.properties.fields[fieldName]) {
                            delete node.properties.fields[fieldName];
                        }
                        this.inputs[slot].type = '*';
                        this.inputs[slot].name = 'unused';
                    }

                    // Handle connect
                    if (link_info && node.graph && slotType == 1 && isChangeConnect) {
                        const resolve = link_info.resolve(node.graph);
                        const type = (resolve?.subgraphInput ?? resolve?.output)?.type;
                        if (type) {
                            // Update input slot
                            const fieldName = this.inputs[slot].name;
                            if (fieldName !== '*') {
                                this.inputs[slot].type = type;
                                this.inputs[slot].name = fieldName;

                                // Store field type
                                if (!node.properties.fields) {
                                    node.properties.fields = {};
                                }
                                node.properties.fields[fieldName] = type;

                                // Update title based on first connected field if group name is empty
                                if (node.widgets[0].value === '' && slot === 0) {
                                    node.title = "Set_" + type;
                                }
                            } else {
                                showAlert(`Slot ${slot} has invalid field name`);
                            }
                        } else {
                            showAlert(`node ${this.title} input undefined.`);
                        }
                    }

                    // Update linked getters
                    node.update();
                    node.size = node.computeSize();
                };
            }

            addField() {
                const fieldNum = this.inputs.filter(inp => inp.name !== 'unused').length;
                const fieldName = `field_${fieldNum + 1}`;
                this.addInput(fieldName, '*');

                if (!this.properties.fields) {
                    this.properties.fields = {};
                }
                this.properties.fields[fieldName] = '*';

                // Add text widget for field name
                const node = this;
                const fieldWidget = this.addWidget(
                    "text",
                    `Field ${fieldNum + 1}`,
                    fieldName,
                    (value) => {
                        const widgetIndex = node.widgets.indexOf(fieldWidget);
                        // Calculate input index: widgets[0] is group name, widgets[1-2] are buttons
                        // So widgets starting from index 3 are field names
                        const inputIndex = widgetIndex - 3;
                        if (inputIndex >= 0 && inputIndex < node.inputs.length) {
                            const oldName = node.inputs[inputIndex].name;
                            const newName = value.trim() || `field_${inputIndex + 1}`;

                            if (newName !== oldName) {
                                // Update input name
                                node.inputs[inputIndex].name = newName;

                                // Update properties
                                if (node.properties.fields && node.properties.fields[oldName]) {
                                    const oldType = node.properties.fields[oldName];
                                    delete node.properties.fields[oldName];
                                    node.properties.fields[newName] = oldType;
                                }

                                node.update();
                                node.size = node.computeSize();
                            }
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
                            const fieldName = this.inputs[i].name;
                            if (this.properties.fields && this.properties.fields[fieldName]) {
                                delete this.properties.fields[fieldName];
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
                const fieldNames = Object.keys(cloned.properties.fields || {});
                fieldNames.forEach((name, index) => {
                    cloned.addInput(name, cloned.properties.fields[name]);

                    // Add text widget for field name
                    const node = cloned;
                    const fieldWidget = cloned.addWidget(
                        "text",
                        `Field ${index + 1}`,
                        name,
                        (value) => {
                            const widgetIndex = node.widgets.indexOf(fieldWidget);
                            const inputIndex = widgetIndex - 3;
                            if (inputIndex >= 0 && inputIndex < node.inputs.length) {
                                const oldName = node.inputs[inputIndex].name;
                                const newName = value.trim() || `field_${inputIndex + 1}`;

                                if (newName !== oldName) {
                                    node.inputs[inputIndex].name = newName;

                                    if (node.properties.fields && node.properties.fields[oldName]) {
                                        const oldType = node.properties.fields[oldName];
                                        delete node.properties.fields[oldName];
                                        node.properties.fields[newName] = oldType;
                                    }

                                    node.update();
                                    node.size = node.computeSize();
                                }
                            }
                        },
                        {}
                    );
                });

                if (fieldNames.length === 0) {
                    cloned.addInput('field_1', '*');

                    const node = cloned;
                    const fieldWidget = cloned.addWidget(
                        "text",
                        "Field 1",
                        'field_1',
                        (value) => {
                            const widgetIndex = node.widgets.indexOf(fieldWidget);
                            const inputIndex = widgetIndex - 3;
                            if (inputIndex >= 0 && inputIndex < node.inputs.length) {
                                const oldName = node.inputs[inputIndex].name;
                                const newName = value.trim() || `field_${inputIndex + 1}`;

                                if (newName !== oldName) {
                                    node.inputs[inputIndex].name = newName;

                                    if (node.properties.fields && node.properties.fields[oldName]) {
                                        const oldType = node.properties.fields[oldName];
                                        delete node.properties.fields[oldName];
                                        node.properties.fields[newName] = oldType;
                                    }

                                    node.update();
                                    node.size = node.computeSize();
                                }
                            }
                        },
                        {}
                    );
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
                // Get current field names and types from inputs
                const fields = {};
                this.inputs.forEach(input => {
                    if (input.name !== 'unused' && input.type !== '*') {
                        fields[input.name] = input.type;
                    }
                });
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
                const setter = this.findSetter(this.graph);
                if (setter) {
                    this.title = "Get_" + setter.widgets[0].value;
                    this.updateFields(setter.properties.fields || {});
                } else {
                    this.title = "Multi Get";
                    this.clearOutputs();
                }
            }

            updateFields(fields) {
                // Store current outputs before clearing
                const fieldNames = Object.keys(fields || {});

                // Remove all existing outputs
                this.clearOutputs();

                // Add outputs for each field
                fieldNames.forEach(name => {
                    const type = fields[name] || '*';
                    this.addOutput(name, type);
                });

                // Update size
                this.size = this.computeSize();
            }

            clearOutputs() {
                while (this.outputs.length > 0) {
                    this.removeOutput(0);
                }
            }


            validateLinks() {
                // Remove invalid links when type changes
                this.outputs.forEach((output, slotIndex) => {
                    if (output.type !== '*' && output.links) {
                        output.links.filter(linkId => {
                            const link = this.graph.links[linkId];
                            return link && (!link.type.split(",").includes(output.type) && link.type !== '*');
                        }).forEach(linkId => {
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
                // Trigger combo update by accessing widget
                if (this.widgets && this.widgets.length > 0) {
                    const widget = this.widgets[0];
                    if (widget.options && widget.options.values) {
                        widget.options.values = [...widget.options.values];
                    }
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
