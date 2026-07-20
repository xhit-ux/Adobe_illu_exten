// 参数样例样式读取与批量应用

function copyDxfStyleProperty(target, source, propertyName) {
    try {
        target[propertyName] = source[propertyName];
    } catch (propertyError) {
        // Illustrator versions expose slightly different PathItem style properties.
    }
}

function copyDxfPathStrokeStyle(source, target) {
    try {
        target.stroked = source.stroked;
    } catch (strokeError) {
        return false;
    }

    copyDxfStyleProperty(target, source, "strokeColor");
    copyDxfStyleProperty(target, source, "strokeWidth");
    copyDxfStyleProperty(target, source, "strokeCap");
    copyDxfStyleProperty(target, source, "strokeJoin");
    copyDxfStyleProperty(target, source, "strokeMiterLimit");
    copyDxfStyleProperty(target, source, "strokeDashes");
    copyDxfStyleProperty(target, source, "strokeDashOffset");
    copyDxfStyleProperty(target, source, "strokeOverprint");
    copyDxfStyleProperty(target, source, "opacity");
    copyDxfStyleProperty(target, source, "blendingMode");
    return true;
}

function applyDxfSampleStyleRecursively(container, role, samplePath) {
    var updatedCount = 0;
    for (var itemIndex = 0; itemIndex < container.pageItems.length; itemIndex++) {
        var item = container.pageItems[itemIndex];
        if (item.parent !== container) {
            continue;
        }
        if (item.typename === "GroupItem") {
            updatedCount += applyDxfSampleStyleRecursively(item, role, samplePath);
        } else if (item.typename === "PathItem" &&
            getDxfPrimaryNoteLine(item.note) !== "AAMA_NOTCH_LOCATOR" &&
            !isDxfItemInsideLayer(item, "LanTu_参数样例") &&
            getDxfSemanticRole(item) === role) {
            if (copyDxfPathStrokeStyle(samplePath, item)) {
                updatedCount++;
            }
        }
    }
    return updatedCount;
}

function getDxfSemanticRoleLabel(role) {
    if (role === "contour") {
        return "外线";
    }
    if (role === "clean-edge") {
        return "内线";
    }
    if (role === "notching") {
        return "刀口";
    }
    if (role === "techline") {
        return "工艺线";
    }
    return "未知类型";
}

function applyDxfSampleStyle() {
    try {
        if (app.documents.length === 0) {
            return "请先打开包含参数样例和裁片的 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        var selection = doc.selection;
        if (!selection || selection.length === 0) {
            return "请先选中“LanTu_参数样例”层中的一条样例线。";
        }

        var samplePath = null;
        for (var selectionIndex = 0; selectionIndex < selection.length; selectionIndex++) {
            var selectedItem = selection[selectionIndex];
            if (selectedItem.typename !== "PathItem" ||
                String(selectedItem.note || "").indexOf("AAMA_STYLE_HINT|") !== 0 ||
                !isDxfItemInsideLayer(selectedItem, "LanTu_参数样例")) {
                continue;
            }
            if (samplePath !== null) {
                return "一次只能应用一条参数样例线，请只保留一条样例线处于选中状态。";
            }
            samplePath = selectedItem;
        }
        if (samplePath === null) {
            return "当前选择中没有参数样例线，请从“LanTu_参数样例”层选择。";
        }

        var role = getDxfSemanticRole(samplePath);
        if (role !== "contour" && role !== "clean-edge" &&
            role !== "notching" && role !== "techline") {
            return "该参数样例类型暂不支持样式更新。";
        }

        var updatedCount = 0;
        for (var layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
            if (doc.layers[layerIndex].name === "LanTu_参数样例") {
                continue;
            }
            updatedCount += applyDxfSampleStyleRecursively(
                doc.layers[layerIndex], role, samplePath
            );
        }

        return "样式更新完成！\n" +
            "类型: " + getDxfSemanticRoleLabel(role) + "\n" +
            "已更新: " + updatedCount + " 条对应线条。";
    } catch (error) {
        return "样式更新失败: " + error.message + "（行号: " + error.line + "）";
    }
}
