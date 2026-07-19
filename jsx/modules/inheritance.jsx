// 尺码组索引、元素修改基准与跨尺码继承

function getDxfSizeNameFromGroup(sizeGroup) {
    var note = getDxfPrimaryNoteLine(sizeGroup.note);
    if (note.indexOf("AAMA_SIZE|") === 0) {
        return note.substring("AAMA_SIZE|".length);
    }
    var match = /^尺码\s+(.+)$/.exec(String(sizeGroup.name || ""));
    return match ? match[1] : "未知尺码";
}

function collectDxfSizeGroups(container, result) {
    for (var groupIndex = 0; groupIndex < container.groupItems.length; groupIndex++) {
        var group = container.groupItems[groupIndex];
        if (group.parent !== container) {
            continue;
        }
        if (String(group.note || "").indexOf("AAMA_SIZE|") === 0 ||
            /^尺码\s+/.test(String(group.name || ""))) {
            result.push(group);
        } else {
            collectDxfSizeGroups(group, result);
        }
    }
}

function collectDxfPieceGroups(container, result) {
    for (var groupIndex = 0; groupIndex < container.groupItems.length; groupIndex++) {
        var group = container.groupItems[groupIndex];
        if (group.parent !== container) {
            continue;
        }
        if (String(group.note || "").indexOf("AAMA_PIECE|") === 0) {
            result.push(group);
        } else {
            collectDxfPieceGroups(group, result);
        }
    }
}

function findDxfOwningLayer(item) {
    var current = item;
    var guard = 0;
    while (current && guard < 30) {
        if (current.typename === "Layer") {
            return current;
        }
        current = current.parent;
        guard++;
    }
    return null;
}

function collectDxfInheritanceSizeGroups(doc) {
    var sizeGroups = [];
    for (var layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
        var layer = doc.layers[layerIndex];
        if (layer.name === "LanTu_参数样例" || layer.name === "LanTu_继承基准") {
            continue;
        }
        collectDxfSizeGroups(layer, sizeGroups);
    }
    return sizeGroups;
}

function deriveDxfPieceStableId(pieceGroup, fallbackIndex) {
    var primaryNote = getDxfPrimaryNoteLine(pieceGroup.note);
    var match = /\|piece:([^|]+)/.exec(primaryNote);
    if (match) {
        return match[1];
    }
    return "piece-" + formatDxfElementNumber(fallbackIndex + 1);
}

function ensureDxfPieceStableIds(sizeGroup) {
    var pieces = [];
    collectDxfPieceGroups(sizeGroup, pieces);
    for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
        if (!getDxfPieceStableId(pieces[pieceIndex])) {
            setDxfMetadataValue(
                pieces[pieceIndex],
                "AAMA_PIECE_ID",
                deriveDxfPieceStableId(pieces[pieceIndex], pieceIndex)
            );
        }
    }
    return pieces;
}

function ensureDxfSizeGroupIds(doc, ensurePieceIds) {
    var groups = collectDxfInheritanceSizeGroups(doc);
    var usedIds = {};
    for (var existingIndex = 0; existingIndex < groups.length; existingIndex++) {
        var existingId = getDxfSizeGroupId(groups[existingIndex]);
        if (existingId) {
            usedIds[existingId] = true;
        }
    }
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        var group = groups[groupIndex];
        var sizeId = getDxfSizeGroupId(group);
        if (!sizeId) {
            var layer = findDxfOwningLayer(group);
            var importId = layer ? getDxfImportId(layer) : "legacy-import";
            var baseId = importId + "|size:" + getDxfSizeNameFromGroup(group);
            sizeId = baseId;
            var suffix = 2;
            while (usedIds[sizeId]) {
                sizeId = baseId + "-" + suffix;
                suffix++;
            }
            setDxfMetadataValue(group, "AAMA_SIZE_ID", sizeId);
            usedIds[sizeId] = true;
        }
        if (ensurePieceIds !== false) {
            ensureDxfPieceStableIds(group);
        }
    }
    return groups;
}

function getDxfInheritanceSizeOptions() {
    try {
        if (app.documents.length === 0) {
            return "";
        }
        // 下拉框只需要尺码组 ID；不在每次刷新时递归扫描所有裁片。
        var groups = ensureDxfSizeGroupIds(app.activeDocument, false);
        var lines = [];
        for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
            lines.push(
                getDxfSizeGroupId(groups[groupIndex]) + "\t" +
                getDxfSizeNameFromGroup(groups[groupIndex])
            );
        }
        return lines.join("\n");
    } catch (error) {
        return "ERROR|" + error.message;
    }
}

function findDxfSizeGroupById(doc, sizeId, groups) {
    groups = groups || ensureDxfSizeGroupIds(doc, false);
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        if (getDxfSizeGroupId(groups[groupIndex]) === sizeId) {
            return groups[groupIndex];
        }
    }
    return null;
}

function isDxfInheritanceExcludedItem(item) {
    // 元素修改继承覆盖裁片内的全部元素，包括尺码标、边线、工艺线、刀口、
    // 锚点、套花、嵌套编组和手工新增对象。剪切路径由每个目标裁片自己的
    // 缝边/净边生成，属于派生对象，不能作为普通元素继承。
    try {
        return item && item.typename === "PathItem" &&
            getDxfPrimaryNoteLine(item.note) === "AAMA_PIECE_CLIP_PATH";
    } catch (invalidItemError) {
        return true;
    }
}

function isDxfDirectInheritanceItem(item, container) {
    try {
        return item && item.parent === container;
    } catch (invalidItemError) {
        return false;
    }
}

function isDxfInheritanceGroupItem(item) {
    try {
        return item && item.typename === "GroupItem";
    } catch (invalidItemError) {
        return false;
    }
}

function getDxfManualElementBaseName(item) {
    if (item.typename === "GroupItem") {
        return "编组";
    }
    if (item.typename === "TextFrame") {
        return "文字";
    }
    if (item.typename === "PathItem") {
        return "路径";
    }
    return "元素";
}

function collectExistingDxfInheritanceElementIds(container, pieceId, state) {
    var manualPrefix = pieceId + "|manual:";
    for (var itemIndex = 0; itemIndex < container.pageItems.length; itemIndex++) {
        var item = container.pageItems[itemIndex];
        if (!isDxfDirectInheritanceItem(item, container) ||
            isDxfInheritanceExcludedItem(item)) {
            continue;
        }
        var elementId = getDxfElementId(item);
        if (elementId) {
            state.used[elementId] = true;
            if (elementId.indexOf(manualPrefix) === 0) {
                var manualNumber = parseInt(elementId.substring(manualPrefix.length), 10);
                if (!isNaN(manualNumber)) {
                    state.counter = Math.max(state.counter, manualNumber);
                }
            }
        }
        // 没有自身编号的编组是本轮新增加的原子元素。它会作为整体继承，
        // 无需扫描内部可能包含的复合路径、图片或数千个图案子对象。
        if (elementId && isDxfInheritanceGroupItem(item)) {
            collectExistingDxfInheritanceElementIds(item, pieceId, state);
        }
    }
}

function ensureDxfInheritanceElementIds(container, pieceId, state) {
    for (var itemIndex = 0; itemIndex < container.pageItems.length; itemIndex++) {
        var item = container.pageItems[itemIndex];
        if (!isDxfDirectInheritanceItem(item, container) ||
            isDxfInheritanceExcludedItem(item)) {
            continue;
        }
        var elementId = getDxfElementId(item);
        var isNewElement = !elementId;
        if (!elementId) {
            do {
                state.counter++;
                elementId = pieceId + "|manual:" + state.counter;
            } while (state.used[elementId]);
            if (!setDxfMetadataValue(item, "AAMA_ELEMENT", elementId)) {
                continue;
            }
            try {
                if (!item.name || item.name === "<路径>" || item.name === "<编组>") {
                    item.name = getDxfManualElementBaseName(item) + "_元素" +
                        formatDxfElementNumber(state.counter);
                }
            } catch (renameError) {
                // 元素编号已经写入，图层面板名称不可写时保持原名。
            }
        }
        state.used[elementId] = true;
        if (!isNewElement && isDxfInheritanceGroupItem(item)) {
            ensureDxfInheritanceElementIds(item, pieceId, state);
        }
    }
}

function prepareDxfSizeGroupForInheritance(sizeGroup) {
    var pieces = ensureDxfPieceStableIds(sizeGroup);
    for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
        orderDxfPieceArtwork(pieces[pieceIndex]);
        var state = { counter: 0, used: {} };
        collectExistingDxfInheritanceElementIds(
            pieces[pieceIndex], getDxfPieceStableId(pieces[pieceIndex]), state
        );
        ensureDxfInheritanceElementIds(
            pieces[pieceIndex], getDxfPieceStableId(pieces[pieceIndex]), state
        );
    }
    return pieces.length;
}

function prepareDxfInheritanceSnapshot(snapshotRoot) {
    var snapshotLayer = findDxfOwningLayer(snapshotRoot);
    if (snapshotLayer === null) {
        return prepareDxfSizeGroupForInheritance(snapshotRoot);
    }
    var wasLocked = snapshotLayer.locked;
    var wasVisible = snapshotLayer.visible;
    try {
        snapshotLayer.locked = false;
        snapshotLayer.visible = true;
        return prepareDxfSizeGroupForInheritance(snapshotRoot);
    } finally {
        snapshotLayer.visible = wasVisible;
        snapshotLayer.locked = wasLocked;
    }
}

function removeDxfInheritanceSnapshotLayer(doc) {
    var layer = findDxfLayerByName(doc, "LanTu_继承基准");
    if (layer === null) {
        return;
    }
    layer.locked = false;
    layer.visible = true;
    layer.remove();
}

function createDxfInheritanceSnapshot(doc, sizeGroup, sizeId) {
    var activeLayer = doc.activeLayer;
    if (activeLayer && activeLayer.name === "LanTu_继承基准") {
        activeLayer = findDxfOwningLayer(sizeGroup);
    }
    removeDxfInheritanceSnapshotLayer(doc);
    var snapshotLayer = doc.layers.add();
    snapshotLayer.name = "LanTu_继承基准";
    snapshotLayer.locked = false;
    snapshotLayer.visible = true;
    try {
        snapshotLayer.printable = false;
    } catch (printableError) {
        // Older Illustrator versions may not expose Layer.printable.
    }
    var snapshotRoot = sizeGroup.duplicate(
        snapshotLayer, ElementPlacement.PLACEATEND
    );
    snapshotRoot.name = "元素修改基准_" + getDxfSizeNameFromGroup(sizeGroup);
    snapshotRoot.note = "AAMA_INHERITANCE_ROOT|" + sizeId + "\n" +
        String(snapshotRoot.note || "");
    snapshotLayer.visible = false;
    snapshotLayer.locked = true;
    if (activeLayer && activeLayer !== snapshotLayer) {
        doc.activeLayer = activeLayer;
    }
    return snapshotRoot;
}

function getDxfInheritanceSnapshotRoot(doc) {
    var layer = findDxfLayerByName(doc, "LanTu_继承基准");
    if (layer === null) {
        return null;
    }
    for (var groupIndex = 0; groupIndex < layer.groupItems.length; groupIndex++) {
        if (layer.groupItems[groupIndex].parent === layer) {
            return layer.groupItems[groupIndex];
        }
    }
    return null;
}

function setDxfInheritanceBase(sizeId) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        var sizeGroup = findDxfSizeGroupById(doc, String(sizeId || ""));
        if (sizeGroup === null) {
            return "没有找到所选尺码编组。";
        }
        var pieceCount = prepareDxfSizeGroupForInheritance(sizeGroup);
        createDxfInheritanceSnapshot(doc, sizeGroup, getDxfSizeGroupId(sizeGroup));
        return "元素修改基准已设置！\n" +
            "尺码: " + getDxfSizeNameFromGroup(sizeGroup) + "\n" +
            "裁片: " + pieceCount + " 个。现在可以编辑该基准尺码组。";
    } catch (error) {
        return "设置元素修改基准失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function mapDxfPieceGroupsById(container) {
    var pieces = [];
    var map = {};
    collectDxfPieceGroups(container, pieces);
    for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
        var pieceId = getDxfPieceStableId(pieces[pieceIndex]);
        if (pieceId) {
            map[pieceId] = pieces[pieceIndex];
        }
    }
    return map;
}

function mapDxfInheritanceItems(container) {
    var map = {};
    for (var itemIndex = 0; itemIndex < container.pageItems.length; itemIndex++) {
        var item = container.pageItems[itemIndex];
        if (!isDxfDirectInheritanceItem(item, container) ||
            isDxfInheritanceExcludedItem(item)) {
            continue;
        }
        var elementId = getDxfElementId(item);
        if (elementId) {
            map[elementId] = item;
        }
    }
    return map;
}

function getDxfItemCenter(item) {
    try {
        var bounds = item.geometricBounds;
        return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    } catch (boundsError) {
        try {
            return [item.position[0], item.position[1]];
        } catch (positionError) {
            return [0, 0];
        }
    }
}

function getDxfInheritancePieceReference(pieceGroup) {
    var boundaries = getDxfBoundaryPaths(pieceGroup);
    var selected = null;
    var selectedArea = -1;
    for (var boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex++) {
        if (!boundaries[boundaryIndex].closed) {
            continue;
        }
        var area = getDxfPathAbsoluteArea(boundaries[boundaryIndex]);
        if (area > selectedArea) {
            selected = boundaries[boundaryIndex];
            selectedArea = area;
        }
    }
    return selected !== null ? getDxfItemCenter(selected) : getDxfItemCenter(pieceGroup);
}

function getDxfInheritancePieceFrame(pieceGroup) {
    var boundaries = getDxfBoundaryPaths(pieceGroup);
    var selected = null;
    var selectedArea = -1;
    for (var boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex++) {
        if (!boundaries[boundaryIndex].closed) {
            continue;
        }
        var area = getDxfPathAbsoluteArea(boundaries[boundaryIndex]);
        if (area > selectedArea) {
            selected = boundaries[boundaryIndex];
            selectedArea = area;
        }
    }
    var frameItem = selected !== null ? selected : pieceGroup;
    var bounds = frameItem.geometricBounds;
    return {
        center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
        width: Math.max(0.000001, Math.abs(bounds[2] - bounds[0])),
        height: Math.max(0.000001, Math.abs(bounds[3] - bounds[1]))
    };
}

function getDxfInheritanceOuterAnchorMap(pieceGroup) {
    var anchorsByOrdinal = {};
    var outerAnchorGroup = null;
    for (var groupIndex = 0; groupIndex < pieceGroup.groupItems.length; groupIndex++) {
        var group = pieceGroup.groupItems[groupIndex];
        try {
            if (group.parent === pieceGroup &&
                getDxfPrimaryNoteLine(group.note) ===
                    "AAMA_SEMANTIC_GROUP|outer-anchor") {
                outerAnchorGroup = group;
                break;
            }
        } catch (groupReadError) {
            // 继续检查其他直属编组。
        }
    }
    if (outerAnchorGroup === null) {
        return anchorsByOrdinal;
    }
    for (var pathIndex = 0; pathIndex < outerAnchorGroup.pathItems.length; pathIndex++) {
        var anchorItem = outerAnchorGroup.pathItems[pathIndex];
        try {
            if (anchorItem.parent !== outerAnchorGroup || anchorItem.pathPoints.length === 0) {
                continue;
            }
            var metadata = parseDxfAnchorPointMetadata(anchorItem.note);
            if (metadata === null || metadata.type !== "OUTER" ||
                anchorsByOrdinal[metadata.ordinal]) {
                continue;
            }
            var point = anchorItem.pathPoints[0].anchor;
            var ruleNumber = parseInt(
                getDxfMetadataValue(anchorItem, "AAMA_GRADE_RULE"), 10
            );
            anchorsByOrdinal[metadata.ordinal] = {
                point: [point[0], point[1]],
                ruleNumber: isNaN(ruleNumber) ? null : ruleNumber
            };
        } catch (anchorReadError) {
            // 单个损坏锚点不影响其余锚点参与倍率计算。
        }
    }
    return anchorsByOrdinal;
}

function getDxfInheritanceGradeSizeIndex(gradeTable, sizeName) {
    var normalizedName = String(sizeName || "").toUpperCase();
    for (var sizeIndex = 0; sizeIndex < gradeTable.sizes.length; sizeIndex++) {
        if (String(gradeTable.sizes[sizeIndex]).toUpperCase() === normalizedName) {
            return sizeIndex;
        }
    }
    return -1;
}

function getDxfInheritanceRuleDelta(
    gradeTable, ruleNumber, sizeIndex, millimeterScale
) {
    if (ruleNumber === null || !gradeTable.rules[ruleNumber] || sizeIndex < 0 ||
        sizeIndex >= gradeTable.rules[ruleNumber].length) {
        return null;
    }
    var delta = gradeTable.rules[ruleNumber][sizeIndex];
    return [delta[0] * millimeterScale, delta[1] * millimeterScale];
}

function getDxfInheritanceGradeTransform(
    basePiece, targetPiece, gradeTable, baseSizeIndex, targetSizeIndex
) {
    var baseAnchors = getDxfInheritanceOuterAnchorMap(basePiece);
    var targetAnchors = getDxfInheritanceOuterAnchorMap(targetPiece);
    var baseReferenceAnchor = baseAnchors[1];
    var targetReferenceAnchor = targetAnchors[1];
    if (!baseReferenceAnchor || !targetReferenceAnchor ||
        baseReferenceAnchor.ruleNumber === null ||
        targetReferenceAnchor.ruleNumber === null ||
        baseReferenceAnchor.ruleNumber !== targetReferenceAnchor.ruleNumber) {
        return null;
    }
    var baseReference = baseReferenceAnchor.point;
    var targetReference = targetReferenceAnchor.point;
    var millimeterScale = getDxfMillimeterToDocumentUnits(basePiece);
    var baseReferenceDelta = getDxfInheritanceRuleDelta(
        gradeTable, baseReferenceAnchor.ruleNumber, baseSizeIndex, millimeterScale
    );
    var targetReferenceDelta = getDxfInheritanceRuleDelta(
        gradeTable, baseReferenceAnchor.ruleNumber, targetSizeIndex, millimeterScale
    );
    if (baseReferenceDelta === null || targetReferenceDelta === null) {
        return null;
    }
    var baseDistanceSquared = 0;
    var targetDistanceSquared = 0;
    var matchedRuleCount = 0;
    var baseMinX = baseReference[0];
    var baseMaxX = baseReference[0];
    var baseMinY = baseReference[1];
    var baseMaxY = baseReference[1];
    var targetReferenceFromRul = [
        baseReference[0] - baseReferenceDelta[0] + targetReferenceDelta[0],
        baseReference[1] - baseReferenceDelta[1] + targetReferenceDelta[1]
    ];
    var targetMinX = targetReferenceFromRul[0];
    var targetMaxX = targetReferenceFromRul[0];
    var targetMinY = targetReferenceFromRul[1];
    var targetMaxY = targetReferenceFromRul[1];

    for (var ordinal in baseAnchors) {
        if (!baseAnchors.hasOwnProperty(ordinal) || String(ordinal) === "1" ||
            !targetAnchors[ordinal]) {
            continue;
        }
        var baseAnchor = baseAnchors[ordinal];
        var targetAnchor = targetAnchors[ordinal];
        if (baseAnchor.ruleNumber === null || targetAnchor.ruleNumber === null ||
            baseAnchor.ruleNumber !== targetAnchor.ruleNumber) {
            continue;
        }
        var baseDelta = getDxfInheritanceRuleDelta(
            gradeTable, baseAnchor.ruleNumber, baseSizeIndex, millimeterScale
        );
        var targetDelta = getDxfInheritanceRuleDelta(
            gradeTable, baseAnchor.ruleNumber, targetSizeIndex, millimeterScale
        );
        if (baseDelta === null || targetDelta === null) {
            continue;
        }
        // 先从基码锚点坐标中扣除基码 RUL delta，恢复样码向量，再应用
        // 目标尺码 delta。整个倍率只来自本次上传的 RUL，不使用目标裁片几何反算。
        var sampleX = baseAnchor.point[0] - baseReference[0] -
            ((baseDelta[0] - baseReferenceDelta[0]));
        var sampleY = baseAnchor.point[1] - baseReference[1] -
            ((baseDelta[1] - baseReferenceDelta[1]));
        var baseX = sampleX + baseDelta[0] - baseReferenceDelta[0];
        var baseY = sampleY + baseDelta[1] - baseReferenceDelta[1];
        var targetX = sampleX + targetDelta[0] - targetReferenceDelta[0];
        var targetY = sampleY + targetDelta[1] - targetReferenceDelta[1];
        var baseSquared = baseX * baseX + baseY * baseY;
        if (baseSquared <= 0.000001) {
            continue;
        }
        baseDistanceSquared += baseSquared;
        targetDistanceSquared += targetX * targetX + targetY * targetY;
        matchedRuleCount++;
        var targetPointX = baseAnchor.point[0] - baseDelta[0] + targetDelta[0];
        var targetPointY = baseAnchor.point[1] - baseDelta[1] + targetDelta[1];
        baseMinX = Math.min(baseMinX, baseAnchor.point[0]);
        baseMaxX = Math.max(baseMaxX, baseAnchor.point[0]);
        baseMinY = Math.min(baseMinY, baseAnchor.point[1]);
        baseMaxY = Math.max(baseMaxY, baseAnchor.point[1]);
        targetMinX = Math.min(targetMinX, targetPointX);
        targetMaxX = Math.max(targetMaxX, targetPointX);
        targetMinY = Math.min(targetMinY, targetPointY);
        targetMaxY = Math.max(targetMaxY, targetPointY);
    }

    if (matchedRuleCount === 0 || baseDistanceSquared <= 0.000001 ||
        targetDistanceSquared <= 0.000001) {
        return null;
    }
    var scale = Math.sqrt(targetDistanceSquared / baseDistanceSquared);
    if (isNaN(scale) || !isFinite(scale) || scale <= 0.000001) {
        return null;
    }
    var baseWidth = baseMaxX - baseMinX;
    var baseHeight = baseMaxY - baseMinY;
    var targetWidth = targetMaxX - targetMinX;
    var targetHeight = targetMaxY - targetMinY;
    var scaleX = baseWidth > 0.000001 && targetWidth > 0.000001 ?
        targetWidth / baseWidth : scale;
    var scaleY = baseHeight > 0.000001 && targetHeight > 0.000001 ?
        targetHeight / baseHeight : scale;
    if (!isFinite(scaleX) || !isFinite(scaleY) ||
        scaleX <= 0.000001 || scaleY <= 0.000001) {
        return null;
    }
    var positionScale = Math.sqrt(scaleX * scaleY);
    return {
        baseReference: baseReference,
        targetReference: targetReference,
        scale: positionScale,
        scaleX: scaleX,
        scaleY: scaleY,
        positionScale: positionScale,
        matchedRuleCount: matchedRuleCount,
        referenceRuleNumber: baseReferenceAnchor.ruleNumber
    };
}

function scaleDxfInheritanceDelta(delta, context) {
    var positionScale = context.positionScale || context.gradeScale || 1;
    return [
        delta[0] * positionScale,
        delta[1] * positionScale
    ];
}

function mapDxfInheritanceBasePoint(point, context) {
    var positionScale = context.positionScale || context.gradeScale || 1;
    if (context.snapshotPieceCenter && context.targetPieceCenter) {
        return [
            context.targetPieceCenter[0] +
                (point[0] - context.snapshotPieceCenter[0]) * positionScale,
            context.targetPieceCenter[1] +
                (point[1] - context.snapshotPieceCenter[1]) * positionScale
        ];
    }
    if (context.baseReferencePoint && context.targetReferencePoint) {
        return [
            context.targetReferencePoint[0] +
                (point[0] - context.baseReferencePoint[0]) * positionScale,
            context.targetReferencePoint[1] +
                (point[1] - context.baseReferencePoint[1]) * positionScale
        ];
    }
    return [
        context.targetPieceCenter[0] +
        (point[0] - context.snapshotPieceCenter[0]) * positionScale,
        context.targetPieceCenter[1] +
        (point[1] - context.snapshotPieceCenter[1]) * positionScale
    ];
}

function copyDxfPathAppearance(source, target) {
    copyDxfPathStrokeStyle(source, target);
    copyDxfStyleProperty(target, source, "filled");
    copyDxfStyleProperty(target, source, "fillColor");
    copyDxfStyleProperty(target, source, "fillOverprint");
    copyDxfStyleProperty(target, source, "evenodd");
    copyDxfStyleProperty(target, source, "opacity");
    copyDxfStyleProperty(target, source, "blendingMode");
}

function getDxfPathAnchorCenter(path) {
    var center = [0, 0];
    var count = path.pathPoints.length;
    if (count === 0) {
        return center;
    }
    for (var pointIndex = 0; pointIndex < count; pointIndex++) {
        center[0] += path.pathPoints[pointIndex].anchor[0];
        center[1] += path.pathPoints[pointIndex].anchor[1];
    }
    return [center[0] / count, center[1] / count];
}

function getDxfPathSimilarityTransform(snapshotPath, basePath) {
    var count = snapshotPath.pathPoints.length;
    if (count === 0 || count !== basePath.pathPoints.length) {
        return null;
    }
    var snapshotCenter = getDxfPathAnchorCenter(snapshotPath);
    var baseCenter = getDxfPathAnchorCenter(basePath);
    var denominator = 0;
    var dot = 0;
    var cross = 0;
    for (var pointIndex = 0; pointIndex < count; pointIndex++) {
        var snapshotAnchor = snapshotPath.pathPoints[pointIndex].anchor;
        var baseAnchor = basePath.pathPoints[pointIndex].anchor;
        var snapshotX = snapshotAnchor[0] - snapshotCenter[0];
        var snapshotY = snapshotAnchor[1] - snapshotCenter[1];
        var baseX = baseAnchor[0] - baseCenter[0];
        var baseY = baseAnchor[1] - baseCenter[1];
        denominator += snapshotX * snapshotX + snapshotY * snapshotY;
        dot += snapshotX * baseX + snapshotY * baseY;
        cross += snapshotX * baseY - snapshotY * baseX;
    }
    var transform = {
        a: denominator > 0.000001 ? dot / denominator : 1,
        b: denominator > 0.000001 ? cross / denominator : 0,
        snapshotCenter: snapshotCenter,
        baseCenter: baseCenter
    };
    var scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
    var tolerance = Math.max(0.01, Math.sqrt(denominator / count) * 0.002);
    if (scale < 0.000001) {
        return null;
    }
    for (var verifyIndex = 0; verifyIndex < count; verifyIndex++) {
        var snapshotPoint = snapshotPath.pathPoints[verifyIndex];
        var basePoint = basePath.pathPoints[verifyIndex];
        var coordinateNames = ["anchor", "leftDirection", "rightDirection"];
        for (var coordinateIndex = 0;
            coordinateIndex < coordinateNames.length;
            coordinateIndex++) {
            var coordinateName = coordinateNames[coordinateIndex];
            var source = snapshotPoint[coordinateName];
            var expected = basePoint[coordinateName];
            var sourceX = source[0] - snapshotCenter[0];
            var sourceY = source[1] - snapshotCenter[1];
            var predictedX = baseCenter[0] + transform.a * sourceX - transform.b * sourceY;
            var predictedY = baseCenter[1] + transform.b * sourceX + transform.a * sourceY;
            var differenceX = expected[0] - predictedX;
            var differenceY = expected[1] - predictedY;
            if (Math.sqrt(differenceX * differenceX + differenceY * differenceY) > tolerance) {
                return null;
            }
        }
    }
    return transform;
}

function transformDxfInheritanceCoordinate(point, center, transform, translation) {
    var relativeX = point[0] - center[0];
    var relativeY = point[1] - center[1];
    return [
        center[0] + transform.a * relativeX - transform.b * relativeY + translation[0],
        center[1] + transform.b * relativeX + transform.a * relativeY + translation[1]
    ];
}

function applyDxfPathSimilarityTransform(
    snapshotPath, basePath, targetPath, context, transform
) {
    var targetCenter = getDxfPathAnchorCenter(targetPath);
    var translation = scaleDxfInheritanceDelta([
        transform.baseCenter[0] - transform.snapshotCenter[0],
        transform.baseCenter[1] - transform.snapshotCenter[1]
    ], context);
    for (var pointIndex = 0; pointIndex < targetPath.pathPoints.length; pointIndex++) {
        var targetPoint = targetPath.pathPoints[pointIndex];
        var anchor = [targetPoint.anchor[0], targetPoint.anchor[1]];
        var left = [targetPoint.leftDirection[0], targetPoint.leftDirection[1]];
        var right = [targetPoint.rightDirection[0], targetPoint.rightDirection[1]];
        targetPoint.anchor = transformDxfInheritanceCoordinate(
            anchor, targetCenter, transform, translation
        );
        targetPoint.leftDirection = transformDxfInheritanceCoordinate(
            left, targetCenter, transform, translation
        );
        targetPoint.rightDirection = transformDxfInheritanceCoordinate(
            right, targetCenter, transform, translation
        );
        copyDxfStyleProperty(
            targetPoint, basePath.pathPoints[pointIndex], "pointType"
        );
    }
}

function applyDxfPathPointDelta(snapshotPath, basePath, targetPath, context) {
    var snapshotCount = snapshotPath.pathPoints.length;
    var baseCount = basePath.pathPoints.length;
    var targetCount = targetPath.pathPoints.length;
    if (snapshotCount === baseCount && baseCount === targetCount) {
        var similarityTransform = getDxfPathSimilarityTransform(snapshotPath, basePath);
        if (similarityTransform !== null) {
            applyDxfPathSimilarityTransform(
                snapshotPath, basePath, targetPath, context, similarityTransform
            );
            targetPath.closed = basePath.closed;
            copyDxfPathAppearance(basePath, targetPath);
            return;
        }
        for (var pointIndex = 0; pointIndex < baseCount; pointIndex++) {
            var snapshotPoint = snapshotPath.pathPoints[pointIndex];
            var basePoint = basePath.pathPoints[pointIndex];
            var targetPoint = targetPath.pathPoints[pointIndex];
            var anchor = targetPoint.anchor;
            var left = targetPoint.leftDirection;
            var right = targetPoint.rightDirection;
            var anchorDelta = scaleDxfInheritanceDelta([
                basePoint.anchor[0] - snapshotPoint.anchor[0],
                basePoint.anchor[1] - snapshotPoint.anchor[1]
            ], context);
            var leftDelta = scaleDxfInheritanceDelta([
                basePoint.leftDirection[0] - snapshotPoint.leftDirection[0],
                basePoint.leftDirection[1] - snapshotPoint.leftDirection[1]
            ], context);
            var rightDelta = scaleDxfInheritanceDelta([
                basePoint.rightDirection[0] - snapshotPoint.rightDirection[0],
                basePoint.rightDirection[1] - snapshotPoint.rightDirection[1]
            ], context);
            targetPoint.anchor = [anchor[0] + anchorDelta[0], anchor[1] + anchorDelta[1]];
            targetPoint.leftDirection = [left[0] + leftDelta[0], left[1] + leftDelta[1]];
            targetPoint.rightDirection = [right[0] + rightDelta[0], right[1] + rightDelta[1]];
            copyDxfStyleProperty(targetPoint, basePoint, "pointType");
        }
    } else {
        var replacementPoints = [];
        for (var replacementIndex = 0; replacementIndex < baseCount; replacementIndex++) {
            replacementPoints.push(mapDxfInheritanceBasePoint(
                basePath.pathPoints[replacementIndex].anchor, context
            ));
        }
        targetPath.setEntirePath(replacementPoints);
        for (var handleIndex = 0; handleIndex < baseCount; handleIndex++) {
            targetPath.pathPoints[handleIndex].leftDirection = mapDxfInheritanceBasePoint(
                basePath.pathPoints[handleIndex].leftDirection, context
            );
            targetPath.pathPoints[handleIndex].rightDirection = mapDxfInheritanceBasePoint(
                basePath.pathPoints[handleIndex].rightDirection, context
            );
            copyDxfStyleProperty(
                targetPath.pathPoints[handleIndex],
                basePath.pathPoints[handleIndex],
                "pointType"
            );
        }
    }
    targetPath.closed = basePath.closed;
    copyDxfPathAppearance(basePath, targetPath);
}

function normalizeDxfInheritanceAngle(angle) {
    while (angle > 180) {
        angle -= 360;
    }
    while (angle < -180) {
        angle += 360;
    }
    return angle;
}

function getDxfItemMatrixInfo(item) {
    try {
        var matrix = item.matrix;
        var a = parseFloat(matrix.mValueA);
        var b = parseFloat(matrix.mValueB);
        var c = parseFloat(matrix.mValueC);
        var d = parseFloat(matrix.mValueD);
        if (!isNaN(a) && !isNaN(b) && !isNaN(c) && !isNaN(d)) {
            return {
                rotation: Math.atan2(b, a) * 180 / Math.PI,
                scaleX: Math.sqrt(a * a + b * b),
                scaleY: Math.sqrt(c * c + d * d)
            };
        }
    } catch (matrixError) {
        // Some Illustrator page item types do not expose a matrix.
    }
    return null;
}

function getDxfItemGeometricFrame(item) {
    try {
        var bounds = item.geometricBounds;
        return {
            center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
            width: Math.abs(bounds[2] - bounds[0]),
            height: Math.abs(bounds[3] - bounds[1])
        };
    } catch (boundsError) {
        return null;
    }
}

function isDxfInheritedDimensionClose(actualValue, expectedValue) {
    var tolerance = Math.max(0.05, Math.abs(expectedValue) * 0.002);
    return Math.abs(actualValue - expectedValue) <= tolerance;
}

function resizeDxfInheritedItemAboutCenter(
    item, horizontalScale, verticalScale, verifyUniformScale
) {
    if (!isFinite(horizontalScale) || !isFinite(verticalScale) ||
        horizontalScale <= 0.000001 || verticalScale <= 0.000001) {
        return false;
    }
    var beforeFrame = getDxfItemGeometricFrame(item);
    var horizontalPercent = horizontalScale * 100;
    var verticalPercent = verticalScale * 100;
    var lineWidthPercent = Math.sqrt(horizontalScale * verticalScale) * 100;
    var resized = false;

    // Illustrator 对剪切组省略可选参数时，各版本采用的默认缩放基点并不稳定。
    // 显式指定中心点、横纵倍率和图案/描边选项，避免只缩放一个方向。
    try {
        item.resize(
            horizontalPercent,
            verticalPercent,
            true,
            true,
            true,
            true,
            lineWidthPercent,
            Transformation.CENTER
        );
        resized = true;
    } catch (explicitResizeError) {
        try {
            item.resize(
                horizontalPercent,
                verticalPercent,
                true,
                true,
                true,
                true,
                lineWidthPercent
            );
            resized = true;
        } catch (legacyResizeError) {
            try {
                item.resize(horizontalPercent, verticalPercent);
                resized = true;
            } catch (simpleResizeError) {
                return false;
            }
        }
    }

    if (!resized || verifyUniformScale !== true || beforeFrame === null) {
        return resized;
    }

    var afterFrame = getDxfItemGeometricFrame(item);
    if (afterFrame === null) {
        return false;
    }
    var expectedWidth = beforeFrame.width * horizontalScale;
    var expectedHeight = beforeFrame.height * verticalScale;
    var widthMatches = beforeFrame.width <= 0.000001 ||
        isDxfInheritedDimensionClose(afterFrame.width, expectedWidth);
    var heightMatches = beforeFrame.height <= 0.000001 ||
        isDxfInheritedDimensionClose(afterFrame.height, expectedHeight);
    if (widthMatches && heightMatches) {
        return true;
    }

    // 某些 Illustrator 版本会让嵌套剪切组只在一个轴上生效；按实际边界补足
    // 缺失的轴向倍率。第二次只修正几何，不重复放大描边。
    var correctionX = afterFrame.width > 0.000001 ?
        expectedWidth / afterFrame.width : 1;
    var correctionY = afterFrame.height > 0.000001 ?
        expectedHeight / afterFrame.height : 1;
    try {
        item.resize(
            correctionX * 100,
            correctionY * 100,
            true,
            true,
            true,
            true,
            100,
            Transformation.CENTER
        );
    } catch (correctionError) {
        try {
            item.resize(correctionX * 100, correctionY * 100);
        } catch (legacyCorrectionError) {
            return false;
        }
    }

    var correctedFrame = getDxfItemGeometricFrame(item);
    if (correctedFrame === null) {
        return false;
    }
    var correctedWidthMatches = beforeFrame.width <= 0.000001 ||
        isDxfInheritedDimensionClose(correctedFrame.width, expectedWidth);
    var correctedHeightMatches = beforeFrame.height <= 0.000001 ||
        isDxfInheritedDimensionClose(correctedFrame.height, expectedHeight);
    if (correctedWidthMatches && correctedHeightMatches) {
        return true;
    }

    // resize() 若仍被剪切组内部状态拦截，最后直接校正 PageItem 的几何宽高。
    // 该操作可能改变临时中心，但调用方随后会按 RUL 重新放置准确中心点。
    try {
        if (beforeFrame.width > 0.000001) {
            item.width = expectedWidth;
        }
        if (beforeFrame.height > 0.000001) {
            item.height = expectedHeight;
        }
    } catch (dimensionCorrectionError) {
        return false;
    }
    var dimensionCorrectedFrame = getDxfItemGeometricFrame(item);
    return dimensionCorrectedFrame !== null &&
        (beforeFrame.width <= 0.000001 || isDxfInheritedDimensionClose(
            dimensionCorrectedFrame.width, expectedWidth
        )) &&
        (beforeFrame.height <= 0.000001 || isDxfInheritedDimensionClose(
            dimensionCorrectedFrame.height, expectedHeight
        ));
}

function applyDxfPageItemTransformDelta(snapshotItem, baseItem, targetItem, context) {
    var snapshotCenter = getDxfItemCenter(snapshotItem);
    var baseCenter = getDxfItemCenter(baseItem);
    var targetCenter = getDxfItemCenter(targetItem);
    var snapshotMatrix = getDxfItemMatrixInfo(snapshotItem);
    var baseMatrix = getDxfItemMatrixInfo(baseItem);
    if (snapshotMatrix !== null && baseMatrix !== null) {
        var horizontalScale = snapshotMatrix.scaleX > 0.000001 ?
            baseMatrix.scaleX / snapshotMatrix.scaleX : 1;
        var verticalScale = snapshotMatrix.scaleY > 0.000001 ?
            baseMatrix.scaleY / snapshotMatrix.scaleY : 1;
        try {
            if (Math.abs(horizontalScale - 1) > 0.000001 ||
                Math.abs(verticalScale - 1) > 0.000001) {
                resizeDxfInheritedItemAboutCenter(
                    targetItem, horizontalScale, verticalScale, false
                );
            }
        } catch (resizeError) {
            // Keep the target size when this item cannot be resized.
        }
        var rotationDelta = normalizeDxfInheritanceAngle(
            baseMatrix.rotation - snapshotMatrix.rotation
        );
        try {
            if (Math.abs(rotationDelta) > 0.000001) {
                targetItem.rotate(rotationDelta);
            }
        } catch (rotationError) {
            // Keep the target angle when this item cannot be rotated.
        }
    }
    var movement = scaleDxfInheritanceDelta([
        baseCenter[0] - snapshotCenter[0],
        baseCenter[1] - snapshotCenter[1]
    ], context);
    var currentCenter = getDxfItemCenter(targetItem);
    try {
        targetItem.translate(
            targetCenter[0] + movement[0] - currentCenter[0],
            targetCenter[1] + movement[1] - currentCenter[1]
        );
    } catch (translateError) {
        // Keep the target position when translation is unsupported.
    }
}

function applyDxfTextDelta(snapshotText, baseText, targetText, context) {
    if (String(baseText.contents) !== String(snapshotText.contents)) {
        targetText.contents = baseText.contents;
    }
    copyDxfTextStyle(baseText, targetText);
    applyDxfPageItemTransformDelta(snapshotText, baseText, targetText, context);
}

function applyDxfGeneralItemDelta(snapshotItem, baseItem, targetItem, context) {
    applyDxfPageItemTransformDelta(snapshotItem, baseItem, targetItem, context);
    copyDxfStyleProperty(targetItem, baseItem, "opacity");
    copyDxfStyleProperty(targetItem, baseItem, "blendingMode");
}

function applyDxfExistingElementDelta(snapshotItem, baseItem, targetItem, context) {
    if (baseItem.name !== snapshotItem.name) {
        targetItem.name = baseItem.name;
    }
    copyDxfStyleProperty(targetItem, baseItem, "hidden");
    if (baseItem.typename === "PathItem" && targetItem.typename === "PathItem" &&
        snapshotItem.typename === "PathItem") {
        applyDxfPathPointDelta(snapshotItem, baseItem, targetItem, context);
    } else if (baseItem.typename === "TextFrame" && targetItem.typename === "TextFrame" &&
        snapshotItem.typename === "TextFrame") {
        applyDxfTextDelta(snapshotItem, baseItem, targetItem, context);
    } else {
        applyDxfGeneralItemDelta(snapshotItem, baseItem, targetItem, context);
    }
}

function duplicateDxfInheritedElement(baseItem, targetContainer, context) {
    var duplicate = baseItem.duplicate(targetContainer, ElementPlacement.PLACEATEND);
    var baseCenter = getDxfItemCenter(baseItem);
    var gradeScaleX = context.gradeScaleX || context.pieceScaleX ||
        context.gradeScale || 1;
    var gradeScaleY = context.gradeScaleY || context.pieceScaleY ||
        context.gradeScale || 1;
    var duplicateWasLocked = false;
    try {
        duplicateWasLocked = duplicate.locked === true;
        duplicate.locked = false;
    } catch (lockReadError) {
        duplicateWasLocked = false;
    }
    if (!resizeDxfInheritedItemAboutCenter(
        duplicate, gradeScaleX, gradeScaleY, true
    )) {
        try {
            duplicate.remove();
        } catch (removeResizeFailureError) {
            // Ignore cleanup errors and report the original scaling failure.
        }
        throw new Error("新增元素无法按 RUL 的横纵倍率缩放");
    }
    try {
        var duplicateCenter = getDxfItemCenter(duplicate);
        var mappedCenter = mapDxfInheritanceBasePoint(baseCenter, context);
        duplicate.translate(
            mappedCenter[0] - duplicateCenter[0],
            mappedCenter[1] - duplicateCenter[1]
        );
    } catch (translateError) {
        try {
            duplicate.remove();
        } catch (removeTranslateFailureError) {
            // Ignore cleanup errors and report the original positioning failure.
        }
        throw new Error("新增元素中心点无法映射到目标尺码");
    }
    var finalCenter = getDxfItemCenter(duplicate);
    var expectedCenter = mapDxfInheritanceBasePoint(baseCenter, context);
    var centerErrorX = expectedCenter[0] - finalCenter[0];
    var centerErrorY = expectedCenter[1] - finalCenter[1];
    if (Math.sqrt(centerErrorX * centerErrorX + centerErrorY * centerErrorY) > 0.05) {
        try {
            duplicate.translate(centerErrorX, centerErrorY);
        } catch (centerCorrectionError) {
            try {
                duplicate.remove();
            } catch (removeCenterFailureError) {
                // Ignore cleanup errors and report the original positioning failure.
            }
            throw new Error("新增元素中心点校正失败");
        }
    }
    try {
        duplicate.locked = duplicateWasLocked;
    } catch (lockRestoreError) {
        // Lock state does not affect the inherited geometry.
    }
    if (isDxfPatternGroup(duplicate)) {
        var targetPiece = findDxfOwningPieceGroup(targetContainer);
        var targetSize = targetPiece !== null ? findDxfOwningSizeGroup(targetPiece) : null;
        if (targetPiece !== null) {
            setDxfMetadataValue(
                duplicate, "AAMA_PATTERN_PIECE_ID", getDxfPieceStableId(targetPiece)
            );
        }
        if (targetSize !== null) {
            setDxfMetadataValue(
                duplicate, "AAMA_PATTERN_SIZE_ID", getDxfSizeGroupId(targetSize)
            );
        }
    }
    return duplicate;
}

function isDxfManualInheritanceElementId(elementId) {
    return String(elementId || "").indexOf("|manual:") >= 0;
}

function inheritDxfContainerChanges(snapshotContainer, baseContainer, targetContainer, context, result) {
    var snapshotMap = mapDxfInheritanceItems(snapshotContainer);
    var baseMap = mapDxfInheritanceItems(baseContainer);
    var targetMap = mapDxfInheritanceItems(targetContainer);
    var elementId;

    for (elementId in snapshotMap) {
        if (!snapshotMap.hasOwnProperty(elementId) || baseMap[elementId]) {
            continue;
        }
        if (targetMap[elementId]) {
            targetMap[elementId].remove();
            result.deleted++;
        }
    }

    for (elementId in baseMap) {
        if (!baseMap.hasOwnProperty(elementId)) {
            continue;
        }
        var baseItem = baseMap[elementId];
        var snapshotItem = snapshotMap[elementId];
        var targetItem = targetMap[elementId];
        if (!snapshotItem || !targetItem ||
            baseItem.typename !== targetItem.typename ||
            (snapshotItem && baseItem.typename !== snapshotItem.typename)) {
            if (targetItem) {
                targetItem.remove();
            }
            duplicateDxfInheritedElement(baseItem, targetContainer, context);
            result.added++;
            continue;
        }

        // 手工添加的底图、Logo、文字等元素不应依赖上一轮目标码结果继续累乘。
        // 每次都从当前基码重新复制，再按本次 RUL 做一次绝对缩放和定位；这样也能
        // 自动纠正旧版本已经生成但横向倍率错误的目标码元素。
        if (isDxfManualInheritanceElementId(elementId)) {
            var rebuiltItem = duplicateDxfInheritedElement(
                baseItem, targetContainer, context
            );
            try {
                targetItem.remove();
            } catch (removeOldManualItemError) {
                try {
                    rebuiltItem.remove();
                } catch (removeRebuiltItemError) {
                    // Ignore cleanup errors and report the replacement failure.
                }
                throw new Error("目标尺码中的旧新增元素无法替换");
            }
            result.rebuilt++;
            continue;
        }

        if (baseItem.typename === "GroupItem") {
            if (baseItem.name !== snapshotItem.name) {
                targetItem.name = baseItem.name;
            }
            // 编组自身的外观也属于继承范围；位置变化由子元素的坐标差递归
            // 传递，避免同时平移编组和子元素造成双倍位移。
            copyDxfStyleProperty(targetItem, baseItem, "opacity");
            copyDxfStyleProperty(targetItem, baseItem, "blendingMode");
            copyDxfStyleProperty(targetItem, baseItem, "hidden");
            inheritDxfContainerChanges(
                snapshotItem, baseItem, targetItem, context, result
            );
        } else {
            applyDxfExistingElementDelta(
                snapshotItem, baseItem, targetItem, context
            );
            result.updated++;
        }
    }
}

function inheritDxfBaseToOtherSizes(rulFilePath) {
    var inheritanceStage = "初始化";
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        if (!rulFilePath) {
            return "请为本次继承选择 RUL 放码规则文件。";
        }
        inheritanceStage = "读取RUL放码规则";
        var gradeTable = readAamaRulFile(String(rulFilePath));
        if (gradeTable === null) {
            return "所选 RUL 文件没有有效的放码规则。";
        }
        var snapshotRoot = getDxfInheritanceSnapshotRoot(doc);
        if (snapshotRoot === null) {
            return "请先选择尺码并点击“设为基准”。";
        }
        var baseSizeId = getDxfMetadataValue(
            snapshotRoot, "AAMA_INHERITANCE_ROOT"
        );
        if (!baseSizeId) {
            return "元素修改基准缺少尺码编号，请重新点击“设为基准”。";
        }
        // 只做一次文档级尺码组扫描；后续目标组直接复用该结果。
        var sizeGroups = ensureDxfSizeGroupIds(doc, false);
        var baseSizeGroup = findDxfSizeGroupById(doc, baseSizeId, sizeGroups);
        if (baseSizeGroup === null) {
            return "当前文档中找不到已设置的基准尺码组。";
        }
        var baseSizeIndex = getDxfInheritanceGradeSizeIndex(
            gradeTable, getDxfSizeNameFromGroup(baseSizeGroup)
        );
        if (baseSizeIndex < 0) {
            return "RUL 文件不包含基准尺码“" +
                getDxfSizeNameFromGroup(baseSizeGroup) + "”。";
        }

        // 旧版本快照曾跳过尺码标。先补齐快照、基码及目标组的唯一编号，
        // 这样升级前创建的快照也能正确识别“基码中已删除”的对象。
        inheritanceStage = "准备继承快照";
        prepareDxfInheritanceSnapshot(snapshotRoot);
        inheritanceStage = "扫描基准尺码新增元素";
        prepareDxfSizeGroupForInheritance(baseSizeGroup);
        inheritanceStage = "建立裁片对应关系";
        var snapshotPieces = mapDxfPieceGroupsById(snapshotRoot);
        var basePieces = mapDxfPieceGroupsById(baseSizeGroup);
        var result = {
            sizeGroups: 0,
            pieces: 0,
            added: 0,
            deleted: 0,
            updated: 0,
            rebuilt: 0,
            missingPieces: 0,
            missingGradeSizes: 0,
            missingGradeRules: 0,
            gradeScaleMin: Infinity,
            gradeScaleMax: 0,
            gradeScaleXMin: Infinity,
            gradeScaleXMax: 0,
            gradeScaleYMin: Infinity,
            gradeScaleYMax: 0
        };

        for (var sizeIndex = 0; sizeIndex < sizeGroups.length; sizeIndex++) {
            var targetSizeGroup = sizeGroups[sizeIndex];
            if (getDxfSizeGroupId(targetSizeGroup) === baseSizeId) {
                continue;
            }
            var targetSizeIndex = getDxfInheritanceGradeSizeIndex(
                gradeTable, getDxfSizeNameFromGroup(targetSizeGroup)
            );
            if (targetSizeIndex < 0) {
                result.missingGradeSizes++;
                continue;
            }
            inheritanceStage = "处理目标尺码 " + getDxfSizeNameFromGroup(targetSizeGroup);
            targetSizeGroup.locked = false;
            prepareDxfSizeGroupForInheritance(targetSizeGroup);
            var targetPieces = mapDxfPieceGroupsById(targetSizeGroup);
            result.sizeGroups++;

            // 整个裁片编组也按稳定裁片编号参与删除同步。
            for (var deletedPieceId in snapshotPieces) {
                if (!snapshotPieces.hasOwnProperty(deletedPieceId) ||
                    basePieces[deletedPieceId]) {
                    continue;
                }
                if (targetPieces[deletedPieceId]) {
                    targetPieces[deletedPieceId].remove();
                    result.deleted++;
                    delete targetPieces[deletedPieceId];
                }
            }

            for (var pieceId in basePieces) {
                if (!basePieces.hasOwnProperty(pieceId)) {
                    continue;
                }
                var snapshotPiece = snapshotPieces[pieceId];
                var targetPiece = targetPieces[pieceId];
                if (!snapshotPiece || !targetPiece) {
                    result.missingPieces++;
                    continue;
                }
                var baseFrame = getDxfInheritancePieceFrame(basePieces[pieceId]);
                var targetFrame = getDxfInheritancePieceFrame(targetPiece);
                var gradeTransform = getDxfInheritanceGradeTransform(
                    basePieces[pieceId], targetPiece, gradeTable,
                    baseSizeIndex, targetSizeIndex
                );
                if (gradeTransform === null) {
                    result.missingGradeRules++;
                    continue;
                }
                result.gradeScaleMin = Math.min(
                    result.gradeScaleMin, gradeTransform.scale
                );
                result.gradeScaleMax = Math.max(
                    result.gradeScaleMax, gradeTransform.scale
                );
                result.gradeScaleXMin = Math.min(
                    result.gradeScaleXMin, gradeTransform.scaleX
                );
                result.gradeScaleXMax = Math.max(
                    result.gradeScaleXMax, gradeTransform.scaleX
                );
                result.gradeScaleYMin = Math.min(
                    result.gradeScaleYMin, gradeTransform.scaleY
                );
                result.gradeScaleYMax = Math.max(
                    result.gradeScaleYMax, gradeTransform.scaleY
                );
                var context = {
                    snapshotPieceCenter: baseFrame.center,
                    targetPieceCenter: targetFrame.center,
                    baseReferencePoint: gradeTransform.baseReference,
                    targetReferencePoint: gradeTransform.targetReference,
                    gradeScale: gradeTransform.positionScale,
                    gradeScaleX: gradeTransform.scaleX,
                    gradeScaleY: gradeTransform.scaleY,
                    positionScale: gradeTransform.positionScale,
                    pieceScaleX: gradeTransform.scaleX,
                    pieceScaleY: gradeTransform.scaleY
                };
                inheritDxfContainerChanges(
                    snapshotPiece,
                    basePieces[pieceId],
                    targetPiece,
                    context,
                    result
                );
                orderDxfPieceArtwork(targetPiece);
                result.pieces++;
            }
        }

        for (var basePieceId in basePieces) {
            if (basePieces.hasOwnProperty(basePieceId)) {
                orderDxfPieceArtwork(basePieces[basePieceId]);
            }
        }

        var canUpdateSnapshot = result.pieces > 0 &&
            result.missingGradeSizes === 0 && result.missingGradeRules === 0 &&
            result.missingPieces === 0;
        if (result.pieces === 0 && result.missingGradeRules > 0) {
            return "元素修改继承未执行：当前文档的外线锚点没有保存 RUL Rule 编号。\n" +
                "请用当前版本重新导入 DXF，再重新设为基准并执行继承。\n" +
                "原继承快照已保留，未被覆盖。";
        }
        if (canUpdateSnapshot) {
            inheritanceStage = "更新继承基准";
            createDxfInheritanceSnapshot(doc, baseSizeGroup, baseSizeId);
        }
        invalidateDxfAnchorOptionsCache();
        var gradeScaleSummary = result.pieces > 0 ?
            result.gradeScaleMin.toFixed(4) + " ~ " + result.gradeScaleMax.toFixed(4) :
            "无可计算裁片";
        var gradeScaleXSummary = result.pieces > 0 ?
            result.gradeScaleXMin.toFixed(4) + " ~ " +
                result.gradeScaleXMax.toFixed(4) : "无可计算裁片";
        var gradeScaleYSummary = result.pieces > 0 ?
            result.gradeScaleYMin.toFixed(4) + " ~ " +
                result.gradeScaleYMax.toFixed(4) : "无可计算裁片";
        return "元素修改继承完成！\n" +
            "基准尺码: " + getDxfSizeNameFromGroup(baseSizeGroup) + "\n" +
            "RUL规则: " + gradeTable.fileName + "\n" +
            "目标尺码组: " + result.sizeGroups + " 个\n" +
            "已处理裁片: " + result.pieces + " 个\n" +
            "新增: " + result.added + "；删除: " + result.deleted +
                "；按RUL重建: " + result.rebuilt +
                "；更新/移动: " + result.updated + "\n" +
            "缺少对应裁片: " + result.missingPieces + " 个\n" +
            "RUL位置倍率: " + gradeScaleSummary + "\n" +
            "RUL元素X倍率: " + gradeScaleXSummary + "\n" +
            "RUL元素Y倍率: " + gradeScaleYSummary + "\n" +
            "RUL缺少目标尺码: " + result.missingGradeSizes + " 个\n" +
            "锚点缺少Rule编号而跳过: " + result.missingGradeRules + " 个\n" +
            "继承快照: " + (canUpdateSnapshot ? "已更新" : "因存在跳过项而保留原快照") + "。";
    } catch (error) {
        return "元素修改继承失败［" + inheritanceStage + "］: " +
            error.message + "（行号: " + error.line + "）";
    }
}
