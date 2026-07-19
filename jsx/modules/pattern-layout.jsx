// 套图：作为裁片剪切组中的直属新增元素，并复用元素修改继承跨尺码同步。

function findDxfOwningSizeGroup(item) {
    var current = item;
    var guard = 0;
    while (current && guard < 30) {
        if (current.typename === "GroupItem" &&
            getDxfPrimaryNoteLine(current.note).indexOf("AAMA_SIZE|") === 0) {
            return current;
        }
        current = current.parent;
        guard++;
    }
    return null;
}

function findDxfPatternGroupAncestor(item) {
    var current = item;
    var guard = 0;
    while (current && guard < 30) {
        if (isDxfPatternGroup(current)) {
            return current;
        }
        current = current.parent;
        guard++;
    }
    return null;
}

function getDxfPatternAnchorOption(patternGroup) {
    var parts = getDxfPrimaryNoteLine(patternGroup.note).split("|");
    if (parts.length < 4 || parts[0] !== "AAMA_PATTERN_GROUP" ||
        parts[1] !== "OUTER") {
        return null;
    }
    var ordinal = parseInt(parts[2], 10);
    return isNaN(ordinal) ? null : { type: "OUTER", ordinal: ordinal };
}

function normalizeDxfPatternType(patternType) {
    patternType = String(patternType || "background").toLowerCase();
    if (patternType !== "background" && patternType !== "logo" &&
        patternType !== "name" && patternType !== "number" && patternType !== "other") {
        return "background";
    }
    return patternType;
}

function getDxfPatternTypeLabel(patternType) {
    patternType = normalizeDxfPatternType(patternType);
    if (patternType === "logo") { return "Logo"; }
    if (patternType === "name") { return "名字"; }
    if (patternType === "number") { return "号码"; }
    if (patternType === "other") { return "其他"; }
    return "底图";
}

function getDxfPatternTypeFromGroup(patternGroup) {
    return normalizeDxfPatternType(
        getDxfMetadataValue(patternGroup, "AAMA_PATTERN_TYPE") || "background"
    );
}

function getDxfPatternZPriority(patternGroup) {
    var patternType = getDxfPatternTypeFromGroup(patternGroup);
    if (patternType === "logo") { return 1; }
    if (patternType === "name") { return 2; }
    if (patternType === "number") { return 3; }
    if (patternType === "other") { return 4; }
    return 0;
}

function findDxfPatternGroupInPiece(pieceGroup, option, patternType) {
    patternType = patternType ? normalizeDxfPatternType(patternType) : "";
    for (var groupIndex = 0; groupIndex < pieceGroup.groupItems.length; groupIndex++) {
        var group = pieceGroup.groupItems[groupIndex];
        if (group.parent !== pieceGroup || !isDxfPatternGroup(group)) {
            continue;
        }
        var groupOption = getDxfPatternAnchorOption(group);
        if ((!patternType || getDxfPatternTypeFromGroup(group) === patternType) &&
            (option === null || (groupOption !== null &&
                groupOption.type === option.type && groupOption.ordinal === option.ordinal))) {
            return group;
        }
    }
    return null;
}

function removeDxfPatternGroups(pieceGroup, patternType) {
    patternType = patternType ? normalizeDxfPatternType(patternType) : "";
    var removedCount = 0;
    for (var groupIndex = pieceGroup.groupItems.length - 1; groupIndex >= 0; groupIndex--) {
        var group = pieceGroup.groupItems[groupIndex];
        if (group.parent === pieceGroup && isDxfPatternGroup(group) &&
            (!patternType || getDxfPatternTypeFromGroup(group) === patternType)) {
            group.remove();
            removedCount++;
        }
    }
    return removedCount;
}

function findDxfPatternContentGroup(patternGroup) {
    for (var groupIndex = 0; groupIndex < patternGroup.groupItems.length; groupIndex++) {
        var group = patternGroup.groupItems[groupIndex];
        if (group.parent === patternGroup &&
            getDxfPrimaryNoteLine(group.note) === "AAMA_PATTERN_CONTENT") {
            return group;
        }
    }
    return null;
}

function findDxfPrimaryOuterBoundary(pieceGroup) {
    var boundaries = getDxfBoundaryPaths(pieceGroup);
    var selected = null;
    var selectedArea = -1;
    for (var boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex++) {
        var boundary = boundaries[boundaryIndex];
        if (!boundary.closed) {
            continue;
        }
        var area = getDxfPathAbsoluteArea(boundary);
        if (area > selectedArea) {
            selected = boundary;
            selectedArea = area;
        }
    }
    return selected;
}

function collectDxfAnchorsInContainer(container, anchorType, result) {
    for (var itemIndex = 0; itemIndex < container.pageItems.length; itemIndex++) {
        var item = container.pageItems[itemIndex];
        if (item.parent !== container) {
            continue;
        }
        if (item.typename === "PathItem") {
            var metadata = parseDxfAnchorPointMetadata(item.note);
            if (metadata !== null && metadata.type === anchorType &&
                item.pathPoints.length > 0) {
                result.push({ item: item, metadata: metadata });
            }
        } else if (item.typename === "GroupItem") {
            collectDxfAnchorsInContainer(item, anchorType, result);
        }
    }
}

function getDxfPatternAnchorOptions(sizeId) {
    try {
        if (app.documents.length === 0) {
            return "";
        }
        var doc = app.activeDocument;
        var sizeGroup = findDxfSizeGroupById(doc, String(sizeId || ""));
        if (sizeGroup === null) {
            return "";
        }
        var pieces = [];
        collectDxfPieceGroups(sizeGroup, pieces);
        var counts = {};
        for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
            var anchors = [];
            var seenInPiece = {};
            collectDxfAnchorsInContainer(pieces[pieceIndex], "OUTER", anchors);
            for (var anchorIndex = 0; anchorIndex < anchors.length; anchorIndex++) {
                var ordinal = anchors[anchorIndex].metadata.ordinal;
                if (!seenInPiece[ordinal]) {
                    counts[ordinal] = (counts[ordinal] || 0) + 1;
                    seenInPiece[ordinal] = true;
                }
            }
        }
        var ordinals = [];
        for (var countKey in counts) {
            if (counts.hasOwnProperty(countKey)) {
                ordinals.push(parseInt(countKey, 10));
            }
        }
        ordinals.sort(function (a, b) { return a - b; });
        var lines = [];
        for (var ordinalIndex = 0; ordinalIndex < ordinals.length; ordinalIndex++) {
            var currentOrdinal = ordinals[ordinalIndex];
            lines.push(
                "OUTER:" + currentOrdinal + "\t外线 " +
                formatDxfAnchorName(currentOrdinal) + "（" +
                counts[currentOrdinal] + "/" + pieces.length + " 裁片）"
            );
        }
        return lines.join("\n");
    } catch (error) {
        return "ERROR|" + error.message;
    }
}

function clearDxfPatternAnchorHelpers() {
    try {
        if (app.documents.length === 0) {
            return "";
        }
        var layer = findDxfLayerByName(app.activeDocument, "LanTu_套图辅助");
        if (layer !== null) {
            layer.locked = false;
            layer.visible = true;
            layer.remove();
        }
        return "";
    } catch (error) {
        return "ERROR|" + error.message;
    }
}

function previewDxfPatternAnchor(sizeId, anchorValue) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        var sizeGroup = findDxfSizeGroupById(doc, String(sizeId || ""));
        var option = parseDxfAnchorOptionValue(anchorValue);
        if (sizeGroup === null || option === null || option.type !== "OUTER") {
            return "请选择有效的基准尺码和外线锚点。";
        }
        var selectedPiece = null;
        if (doc.selection && doc.selection.length > 0) {
            var candidatePiece = findDxfOwningPieceGroup(doc.selection[0]);
            if (candidatePiece !== null && findDxfOwningSizeGroup(candidatePiece) === sizeGroup) {
                selectedPiece = candidatePiece;
            }
        }
        if (selectedPiece === null) {
            var pieces = [];
            collectDxfPieceGroups(sizeGroup, pieces);
            for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
                if (findDxfAnchorInPiece(
                    pieces[pieceIndex], option.type, option.ordinal
                ) !== null) {
                    selectedPiece = pieces[pieceIndex];
                    break;
                }
            }
        }
        if (selectedPiece === null) {
            return "该尺码组没有找到所选外线锚点。";
        }
        var anchor = findDxfAnchorInPiece(
            selectedPiece, option.type, option.ordinal
        );
        clearDxfDocumentSelection(doc);
        anchor.hidden = false;
        anchor.selected = true;
        try {
            anchor.pathPoints[0].selected = PathPointSelection.ANCHORPOINT;
        } catch (pointSelectionError) {
            // PageItem 选中状态仍会显示 Illustrator 原生选择提示。
        }
        return "已用 Illustrator 原生选中提示定位：" +
            String(selectedPiece.name || "未命名裁片") + " / 外线 " +
            formatDxfAnchorName(option.ordinal) + "。";
    } catch (error) {
        return "对花锚点提示失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function normalizeDxfPatternPlacement(placement) {
    // 当前只有底层可选；保留参数以便后续增加“置顶/置于工艺线下”等位置。
    return String(placement || "bottom").toLowerCase() === "bottom" ?
        "BOTTOM" : "BOTTOM";
}

function setDxfPatternGroupMetadata(
    patternGroup, pieceGroup, sizeGroup, option, placement, patternType
) {
    patternType = normalizeDxfPatternType(patternType);
    var anchorType = "NONE";
    var anchorOrdinal = 0;
    if (option && option.type === "OUTER" && !isNaN(parseInt(option.ordinal, 10))) {
        anchorType = "OUTER";
        anchorOrdinal = parseInt(option.ordinal, 10);
    }
    patternGroup.name = "套花_" + getDxfPatternTypeLabel(patternType);
    patternGroup.note = "AAMA_PATTERN_GROUP|" + anchorType + "|" +
        anchorOrdinal + "|" + (placement || "BOTTOM");
    setDxfMetadataValue(patternGroup, "AAMA_PATTERN_PIECE_ID", getDxfPieceStableId(pieceGroup));
    setDxfMetadataValue(patternGroup, "AAMA_PATTERN_SIZE_ID", getDxfSizeGroupId(sizeGroup));
    setDxfMetadataValue(patternGroup, "AAMA_PATTERN_TYPE", patternType);
}

function createDxfPatternGroupFromContent(
    pieceGroup, sizeGroup, sourceContent, option, placement, patternType
) {
    if (ensureDxfPieceClippingMask(pieceGroup, null) === null) {
        return null;
    }
    patternType = normalizeDxfPatternType(patternType);
    removeDxfPatternGroups(pieceGroup, patternType);
    // 图案本身就是裁片剪切组的直属新增元素，不再额外包一层“图案内容”编组。
    // sourceContent 始终是粘贴内容整理出的 GroupItem，因此可直接作为套花元素。
    var patternGroup = sourceContent.duplicate(pieceGroup, ElementPlacement.PLACEATEND);
    setDxfPatternGroupMetadata(
        patternGroup, pieceGroup, sizeGroup, option, placement, patternType
    );
    orderDxfPieceArtwork(pieceGroup);
    return patternGroup;
}

function getDxfPastedPatternSource(doc, targetLayer) {
    clearDxfDocumentSelection(doc);
    try {
        app.executeMenuCommand("pasteInPlace");
    } catch (pasteInPlaceError) {
        // 某些 Illustrator 版本没有“原位粘贴”菜单命令，下面回退普通粘贴。
    }
    if (!doc.selection || doc.selection.length === 0) {
        try {
            app.executeMenuCommand("paste");
        } catch (pasteError) {
            return null;
        }
    }
    if (!doc.selection || doc.selection.length === 0) {
        return null;
    }

    var pastedItems = [];
    for (var selectionIndex = 0; selectionIndex < doc.selection.length; selectionIndex++) {
        if (doc.selection[selectionIndex] && doc.selection[selectionIndex].typename) {
            pastedItems.push(doc.selection[selectionIndex]);
        }
    }
    if (pastedItems.length === 0) {
        return null;
    }
    if (pastedItems.length > 1) {
        try {
            app.executeMenuCommand("group");
            if (doc.selection && doc.selection.length === 1 &&
                doc.selection[0].typename === "GroupItem") {
                pastedItems = [doc.selection[0]];
            }
        } catch (groupError) {
            // 回退到手工编组。
        }
    }

    var sourceGroup = null;
    if (pastedItems.length === 1 && pastedItems[0].typename === "GroupItem") {
        sourceGroup = pastedItems[0];
    } else {
        sourceGroup = targetLayer.groupItems.add();
        for (var itemIndex = 0; itemIndex < pastedItems.length; itemIndex++) {
            try {
                pastedItems[itemIndex].move(sourceGroup, ElementPlacement.PLACEATEND);
            } catch (moveError) {
                // 不能移动的对象不会作为图案内容使用。
            }
        }
    }
    sourceGroup.name = "LanTu_套图临时图案";
    sourceGroup.note = "AAMA_PATTERN_SOURCE";
    return sourceGroup;
}

function getDxfSelectedPatternPiece(doc, sizeGroup) {
    if (!doc.selection || doc.selection.length === 0) {
        return { piece: null, error: "请先选择基准尺码组中的一个目标裁片。" };
    }
    var selectedPiece = null;
    for (var selectionIndex = 0; selectionIndex < doc.selection.length; selectionIndex++) {
        var candidatePiece = findDxfOwningPieceGroup(doc.selection[selectionIndex]);
        if (candidatePiece === null || findDxfOwningSizeGroup(candidatePiece) !== sizeGroup) {
            continue;
        }
        if (selectedPiece !== null && selectedPiece !== candidatePiece) {
            return { piece: null, error: "一次只能为一个裁片添加套花元素。" };
        }
        selectedPiece = candidatePiece;
    }
    if (selectedPiece === null) {
        return { piece: null, error: "当前选择不属于所选基准尺码组。" };
    }
    return { piece: selectedPiece, error: "" };
}

function ensureDxfPatternInheritanceBase(doc, sizeGroup) {
    var sizeId = getDxfSizeGroupId(sizeGroup);
    var snapshotRoot = getDxfInheritanceSnapshotRoot(doc);
    if (snapshotRoot !== null &&
        getDxfMetadataValue(snapshotRoot, "AAMA_INHERITANCE_ROOT") === sizeId) {
        return false;
    }
    prepareDxfSizeGroupForInheritance(sizeGroup);
    createDxfInheritanceSnapshot(doc, sizeGroup, sizeId);
    return true;
}

function createDxfPatternLayout(sizeId, patternType) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        // 兼容旧面板的四参数调用；新流程不再使用锚点和缩放基准点。
        if (arguments.length >= 4) {
            patternType = arguments[3];
        }
        var doc = app.activeDocument;
        var sizeGroup = findDxfSizeGroupById(doc, String(sizeId || ""));
        if (sizeGroup === null) {
            return "没有找到所选的基准尺码组。";
        }
        patternType = normalizeDxfPatternType(patternType);
        ensureDxfPieceStableIds(sizeGroup);
        var selectionResult = getDxfSelectedPatternPiece(doc, sizeGroup);
        if (selectionResult.piece === null) {
            return selectionResult.error;
        }
        var targetPiece = selectionResult.piece;
        if (ensureDxfPieceClippingMask(targetPiece, null) === null) {
            return "所选裁片缺少可用的缝边或净边，无法建立剪切组。";
        }
        var createdSnapshot = ensureDxfPatternInheritanceBase(doc, sizeGroup);

        var importLayer = findDxfOwningLayer(sizeGroup);
        if (importLayer === null) {
            return "无法确定基准尺码组所在图层。";
        }
        var previousLayer = doc.activeLayer;
        var previousLocked = importLayer.locked;
        var previousVisible = importLayer.visible;
        importLayer.locked = false;
        importLayer.visible = true;
        doc.activeLayer = importLayer;
        var sourceGroup = getDxfPastedPatternSource(doc, importLayer);
        if (sourceGroup === null) {
            if (previousLayer) {
                doc.activeLayer = previousLayer;
            }
            importLayer.visible = previousVisible;
            importLayer.locked = previousLocked;
            return "剪贴板中没有可粘贴的图案元素。请先复制图案后再执行。";
        }

        var patternGroup = null;
        try {
            patternGroup = createDxfPatternGroupFromContent(
                targetPiece, sizeGroup, sourceGroup, null, "BOTTOM", patternType
            );
            prepareDxfSizeGroupForInheritance(sizeGroup);
            orderDxfPieceArtwork(targetPiece);
        } finally {
            sourceGroup.remove();
            clearDxfDocumentSelection(doc);
            if (previousLayer) {
                doc.activeLayer = previousLayer;
            }
            importLayer.visible = previousVisible;
            importLayer.locked = previousLocked;
        }
        if (patternGroup === null) {
            return "套花元素添加失败：所选裁片没有可用的剪切边界。";
        }
        return "套花元素已添加！\n" +
            "基准尺码: " + getDxfSizeNameFromGroup(sizeGroup) + "\n" +
            "目标裁片: " + String(targetPiece.name || "未命名裁片") + "\n" +
            "套图类型: " + getDxfPatternTypeLabel(patternType) + "\n" +
            "继承基准: " + (createdSnapshot ? "已自动建立" : "继续使用当前基准") + "\n" +
            "层级: 底图 < Logo < 名字 < 号码 < 其他。";
    } catch (error) {
        return "创建套图失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function getDxfSelectedPatternReference(doc, sizeGroup) {
    var selection = doc.selection;
    if (!selection || selection.length === 0) {
        return null;
    }
    var selectedItem = null;
    for (var selectionIndex = 0; selectionIndex < selection.length; selectionIndex++) {
        var candidate = selection[selectionIndex];
        var patternGroup = findDxfPatternGroupAncestor(candidate);
        var candidateSizeGroup = findDxfOwningSizeGroup(candidate);
        if (patternGroup !== null && candidateSizeGroup === sizeGroup) {
            if (selectedItem !== null && selectedItem !== candidate) {
                return { error: "请只选择一个图案对象或一个图案锚点。" };
            }
            selectedItem = candidate;
        }
    }
    if (selectedItem === null) {
        return { error: "请在所选基准尺码的“套图组 > 图案内容”中选择基准点。" };
    }
    if (selectedItem.typename === "PathItem") {
        var selectedPoint = null;
        for (var pointIndex = 0; pointIndex < selectedItem.pathPoints.length; pointIndex++) {
            var pointSelection = selectedItem.pathPoints[pointIndex].selected;
            var hasSelectedPoint = false;
            try {
                hasSelectedPoint = pointSelection !== PathPointSelection.NOSELECTION;
            } catch (selectionStateError) {
                hasSelectedPoint = String(pointSelection) !== "0";
            }
            if (hasSelectedPoint) {
                if (selectedPoint !== null) {
                    return { error: "请只选择一个图案锚点；也可以直接选择单个图案对象。" };
                }
                selectedPoint = selectedItem.pathPoints[pointIndex].anchor;
            }
        }
        if (selectedPoint !== null) {
            return { point: [selectedPoint[0], selectedPoint[1]] };
        }
    }
    return { point: getDxfItemCenter(selectedItem) };
}

function formatDxfPatternReference(point) {
    return Number(point[0]).toFixed(6) + "," + Number(point[1]).toFixed(6);
}

function getDxfPatternReference(patternGroup) {
    var value = getDxfMetadataValue(patternGroup, "AAMA_PATTERN_REFERENCE");
    var values = String(value || "").split(",");
    if (values.length !== 2) {
        return null;
    }
    var x = parseFloat(values[0]);
    var y = parseFloat(values[1]);
    return isNaN(x) || isNaN(y) ? null : [x, y];
}

function setDxfPatternScaleReference(sizeId, anchorValue, patternType) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        var sizeGroup = findDxfSizeGroupById(doc, String(sizeId || ""));
        var option = parseDxfAnchorOptionValue(anchorValue);
        if (sizeGroup === null) {
            return "没有找到所选的基准尺码组。";
        }
        if (option === null || option.type !== "OUTER") {
            return "请先选择创建套图时使用的外线对花锚点。";
        }
        patternType = normalizeDxfPatternType(patternType);
        var selectedReference = getDxfSelectedPatternReference(doc, sizeGroup);
        if (selectedReference === null) {
            return "请先在图案内容中选择一个锚点或对象作为缩放基准点。";
        }
        if (selectedReference.error) {
            return selectedReference.error;
        }
        var pieces = [];
        collectDxfPieceGroups(sizeGroup, pieces);
        var updatedCount = 0;
        for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
            var patternGroup = findDxfPatternGroupInPiece(
                pieces[pieceIndex], option, patternType
            );
            if (patternGroup === null) {
                continue;
            }
            setDxfMetadataValue(
                patternGroup, "AAMA_PATTERN_REFERENCE",
                formatDxfPatternReference(selectedReference.point)
            );
            updatedCount++;
        }
        return "缩放基准点已设置！\n" +
            "坐标: " + formatDxfPatternReference(selectedReference.point) + "\n" +
            "已写入套图组: " + updatedCount + " 个。";
    } catch (error) {
        return "设置缩放基准点失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function transformDxfPatternContentToTarget(
    content, baseAnchor, targetAnchor, reference, scaleX, scaleY
) {
    var baseCenter = getDxfItemCenter(content);
    content.resize(scaleX * 100, scaleY * 100);
    var resizedCenter = getDxfItemCenter(content);
    var desiredCenter = [
        reference[0] + (baseCenter[0] - reference[0]) * scaleX,
        reference[1] + (baseCenter[1] - reference[1]) * scaleY
    ];
    content.translate(desiredCenter[0] - resizedCenter[0], desiredCenter[1] - resizedCenter[1]);
    var scaledAnchor = [
        reference[0] + (baseAnchor[0] - reference[0]) * scaleX,
        reference[1] + (baseAnchor[1] - reference[1]) * scaleY
    ];
    var offsetX = targetAnchor[0] - scaledAnchor[0];
    var offsetY = targetAnchor[1] - scaledAnchor[1];
    content.translate(offsetX, offsetY);
    return [reference[0] + offsetX, reference[1] + offsetY];
}

function createInheritedDxfPatternGroup(
    basePatternGroup, basePiece, targetPiece, baseSizeGroup, targetSizeGroup,
    option, placement, reference, scaleX, scaleY, patternType
) {
    var sourceContent = findDxfPatternContentGroup(basePatternGroup);
    var baseAnchorItem = findDxfAnchorInPiece(basePiece, option.type, option.ordinal);
    var targetAnchorItem = findDxfAnchorInPiece(targetPiece, option.type, option.ordinal);
    if (sourceContent === null ||
        ensureDxfPieceClippingMask(targetPiece, null) === null ||
        baseAnchorItem === null ||
        targetAnchorItem === null || baseAnchorItem.pathPoints.length === 0 ||
        targetAnchorItem.pathPoints.length === 0) {
        return null;
    }
    patternType = normalizeDxfPatternType(patternType);
    removeDxfPatternGroups(targetPiece, patternType);
    var patternGroup = targetPiece.groupItems.add();
    setDxfPatternGroupMetadata(
        patternGroup, targetPiece, targetSizeGroup, option, placement, patternType
    );
    var content = sourceContent.duplicate(patternGroup, ElementPlacement.PLACEATEND);
    content.name = "图案内容";
    content.note = "AAMA_PATTERN_CONTENT";
    var targetReference = transformDxfPatternContentToTarget(
        content,
        baseAnchorItem.pathPoints[0].anchor,
        targetAnchorItem.pathPoints[0].anchor,
        reference,
        scaleX,
        scaleY
    );
    setDxfMetadataValue(
        patternGroup, "AAMA_PATTERN_REFERENCE", formatDxfPatternReference(targetReference)
    );
    orderDxfPieceArtwork(targetPiece);
    return patternGroup;
}

function clearDxfPatternLayouts() {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var sizeGroups = collectDxfInheritanceSizeGroups(app.activeDocument);
        var removedCount = 0;
        for (var sizeIndex = 0; sizeIndex < sizeGroups.length; sizeIndex++) {
            var pieces = [];
            collectDxfPieceGroups(sizeGroups[sizeIndex], pieces);
            for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
                removedCount += removeDxfPatternGroups(pieces[pieceIndex]);
                orderDxfPieceArtwork(pieces[pieceIndex]);
            }
        }
        return "套花已清空，共移除 " + removedCount + " 个套花内容组；裁片剪切路径已保留。";
    } catch (error) {
        return "清空套花失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function applyDxfPieceClipBoundary(boundaryType) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        boundaryType = boundaryType === "clean" ? "clean" : "outer";
        var sizeGroups = collectDxfInheritanceSizeGroups(app.activeDocument);
        var updatedCount = 0;
        var missingCount = 0;
        for (var sizeIndex = 0; sizeIndex < sizeGroups.length; sizeIndex++) {
            var pieces = [];
            collectDxfPieceGroups(sizeGroups[sizeIndex], pieces);
            for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
                if (ensureDxfPieceClippingMask(
                    pieces[pieceIndex], boundaryType
                ) === null) {
                    missingCount++;
                } else {
                    updatedCount++;
                    orderDxfPieceArtwork(pieces[pieceIndex]);
                }
            }
        }
        return "裁片剪切边界已切换为“" +
            (boundaryType === "clean" ? "净边" : "缝边") + "”：成功 " +
            updatedCount + " 个，缺少对应边界 " + missingCount + " 个。";
    } catch (error) {
        return "切换裁片剪切边界失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function beginDxfPatternManualAlignment(sizeId, anchorValue) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        if (!doc.selection || doc.selection.length !== 1) {
            return "请先在隔离模式中单选一个需要对花的图案元素或元素组。";
        }
        var selectedItem = doc.selection[0];
        var pieceGroup = findDxfOwningPieceGroup(selectedItem);
        if (pieceGroup === null) {
            return "当前元素不在已导入的裁片组中。";
        }
        var sizeGroup = findDxfOwningSizeGroup(pieceGroup);
        if (sizeGroup === null || getDxfSizeGroupId(sizeGroup) !== String(sizeId || "")) {
            return "当前选中元素不属于所选基准尺码组。";
        }
        var center = getDxfItemCenter(selectedItem);
        setDxfMetadataValue(
            pieceGroup, "AAMA_PATTERN_ACTIVE_ITEM_CENTER",
            formatDxfPatternReference(center)
        );
        return "已识别手工对花元素：" + String(selectedItem.name || selectedItem.typename) +
            "\n裁片: " + String(pieceGroup.name || "未命名") +
            "\n元素中心: " + formatDxfPatternReference(center) +
            "\n选择对花锚点后将使用 Illustrator 原生选择高亮提示。";
    } catch (error) {
        return "进入手工对花失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function endDxfPatternManualAlignment() {
    try {
        if (app.documents.length === 0) {
            return "";
        }
        clearDxfDocumentSelection(app.activeDocument);
        try {
            app.executeMenuCommand("exitIsolationMode");
        } catch (isolationError) {
            // 无隔离状态时只清除选择。
        }
        return "已退出手工对花并清除选择提示。";
    } catch (error) {
        return "退出手工对花失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function inheritDxfPatternToOtherSizes(sizeId, rulFilePath) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        var sizeGroups = ensureDxfSizeGroupIds(doc, false);
        var baseSizeGroup = findDxfSizeGroupById(doc, String(sizeId || ""), sizeGroups);
        if (baseSizeGroup === null) {
            return "没有找到所选的基准尺码组。";
        }
        var snapshotRoot = getDxfInheritanceSnapshotRoot(doc);
        if (snapshotRoot === null || getDxfMetadataValue(
            snapshotRoot, "AAMA_INHERITANCE_ROOT"
        ) !== getDxfSizeGroupId(baseSizeGroup)) {
            return "当前尺码尚未建立套花继承基准，请先选择裁片并点击“一键套花”。";
        }

        var pieces = ensureDxfPieceStableIds(baseSizeGroup);
        var patternCount = 0;
        for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
            for (var groupIndex = 0; groupIndex < pieces[pieceIndex].groupItems.length;
                groupIndex++) {
                var group = pieces[pieceIndex].groupItems[groupIndex];
                if (group.parent === pieces[pieceIndex] && isDxfPatternGroup(group)) {
                    patternCount++;
                }
            }
        }
        if (patternCount === 0) {
            return "所选基准尺码中没有套花元素。";
        }

        var inheritanceResult = inheritDxfBaseToOtherSizes(rulFilePath);
        if (inheritanceResult.indexOf("元素修改继承完成！") === 0) {
            return inheritanceResult.replace(
                "元素修改继承完成！",
                "套花继承完成！\n继承方式: 裁片直属新增元素"
            );
        }
        return inheritanceResult;
    } catch (error) {
        return "套图继承失败: " + error.message + "（行号: " + error.line + "）";
    }
}
