// Illustrator 路径绘制、元素元数据与参数样例层

function createDxfRgbColor(red, green, blue) {
    var color = new RGBColor();
    color.red = red;
    color.green = green;
    color.blue = blue;
    return color;
}

function getDxfDefaultStrokeStyle(role, documentOrItem) {
    var pointScale = getDxfPointToDocumentUnits(documentOrItem);
    if (role === "contour") {
        return { color: createDxfRgbColor(0, 0, 0), width: 3 * pointScale };
    }
    if (role === "clean-edge") {
        return { color: createDxfRgbColor(0, 0, 255), width: 2 * pointScale };
    }
    if (role === "techline") {
        return { color: createDxfRgbColor(0, 128, 0), width: 2 * pointScale };
    }
    if (role === "notching") {
        return { color: createDxfRgbColor(128, 128, 128), width: 1.5 * pointScale };
    }
    return { color: createDxfRgbColor(0, 0, 0), width: 0.5 * pointScale };
}

function applyDxfDefaultStrokeStyle(path, role, documentOrItem) {
    var style = getDxfDefaultStrokeStyle(role, documentOrItem || path);
    path.stroked = true;
    path.filled = false;
    path.strokeColor = style.color;
    path.strokeWidth = style.width;
}

function getDxfShapeSemanticRole(shape) {
    if (isAamaDxfBoundaryShape(shape)) {
        return "contour";
    }
    if (shape && String(shape.dxfLayer) === "14") {
        return "clean-edge";
    }
    if (isAamaTechlineShape(shape)) {
        return "techline";
    }
    return "";
}

function drawDxfShape(parentGroup, shape, bounds, artboard, scale, margin, pathName) {
    var illustratorPoints = [];
    var offsetX = artboard[0] + margin - bounds.minX * scale;
    var offsetY = artboard[1] - margin - bounds.maxY * scale;

    for (var i = 0; i < shape.points.length; i++) {
        var point = shape.points[i];
        illustratorPoints.push([
            offsetX + point[0] * scale,
            offsetY + point[1] * scale
        ]);
    }

    var path = parentGroup.pathItems.add();
    path.setEntirePath(illustratorPoints);
    path.closed = shape.closed;
    applyDxfDefaultStrokeStyle(
        path, getDxfShapeSemanticRole(shape), parentGroup
    );
    if (pathName) {
        path.name = getDxfShapeElementName(pathName, shape);
    }
    if (isAamaDxfBoundaryShape(shape)) {
        path.note = "AAMA_DXF_BOUNDARY|" + getAamaDxfBoundaryPathId(shape);
    } else if (String(shape.dxfLayer) === "14" && shape.closed) {
        path.note = "AAMA_DXF_INNER_BOUNDARY|" + getAamaDxfBoundaryPathId(shape);
    }
    setDxfMetadataValue(path, "AAMA_ELEMENT", shape.elementId || "");
    return path;
}

function drawDxfAnchorPoints(parentGroup, shape, bounds, artboard, scale, margin, anchorType) {
    var anchorIndices = getDxfShapeAnchorPointIndices(shape);
    var createdCount = 0;
    for (var anchorIndex = 0; anchorIndex < anchorIndices.length; anchorIndex++) {
        var sourcePointIndex = anchorIndices[anchorIndex];
        if (sourcePointIndex < 0 || sourcePointIndex >= shape.points.length) {
            continue;
        }
        var illustratorPoint = transformDxfPoint(
            shape.points[sourcePointIndex], bounds, artboard, scale, margin
        );
        var ordinal = parentGroup.pathItems.length + 1;
        var anchor = parentGroup.pathItems.add();
        anchor.setEntirePath([illustratorPoint]);
        anchor.closed = false;
        anchor.stroked = false;
        anchor.filled = false;
        anchor.hidden = false;
        anchor.name = formatDxfAnchorName(ordinal);
        anchor.note = "AAMA_ANCHOR_POINT|" + anchorType + "|" +
            getAamaDxfBoundaryPathId(shape) + "|" + ordinal;
        if (shape.aamaAnchorRuleNumbers &&
            shape.aamaAnchorRuleNumbers[sourcePointIndex] !== undefined) {
            setDxfMetadataValue(
                anchor,
                "AAMA_GRADE_RULE",
                shape.aamaAnchorRuleNumbers[sourcePointIndex]
            );
        }
        setDxfMetadataValue(
            anchor,
            "AAMA_ELEMENT",
            (shape.elementId || "") + "|anchor:" + anchorType + ":" + ordinal
        );
        createdCount++;
    }
    return createdCount;
}

function getDxfShapeAnchorPointIndices(shape) {
    if (shape.aamaAnchorPointIndices && shape.aamaAnchorPointIndices.length > 0) {
        return shape.aamaAnchorPointIndices;
    }

    var indices = [];
    var pointCount = shape.points.length;
    if (pointCount < 2) {
        return indices;
    }
    var startIndex = shape.closed ? 0 : 1;
    var endIndex = shape.closed ? pointCount : pointCount - 1;
    if (!shape.closed) {
        indices.push(0);
    }
    for (var pointIndex = startIndex; pointIndex < endIndex; pointIndex++) {
        var previous = shape.points[(pointIndex - 1 + pointCount) % pointCount];
        var current = shape.points[pointIndex];
        var next = shape.points[(pointIndex + 1) % pointCount];
        var incomingX = current[0] - previous[0];
        var incomingY = current[1] - previous[1];
        var outgoingX = next[0] - current[0];
        var outgoingY = next[1] - current[1];
        var incomingLengthSquared = incomingX * incomingX + incomingY * incomingY;
        var outgoingLengthSquared = outgoingX * outgoingX + outgoingY * outgoingY;
        if (incomingLengthSquared === 0 || outgoingLengthSquared === 0) {
            continue;
        }
        var directionDot = incomingX * outgoingX + incomingY * outgoingY;
        // turn >= 12° 等价于 cos(turn) <= cos(12°)。平方比较避免每点
        // 执行两次 sqrt、一次除法和一次 acos。
        if (directionDot <= 0 ||
            directionDot * directionDot <=
                0.9567727288 * incomingLengthSquared * outgoingLengthSquared) {
            indices.push(pointIndex);
        }
    }
    if (!shape.closed) {
        indices.push(pointCount - 1);
    }
    return indices;
}

function formatDxfAnchorName(ordinal) {
    return "锚点" + (ordinal < 10 ? "0" + ordinal : String(ordinal));
}

function transformDxfPoint(point, bounds, artboard, scale, margin) {
    return [
        artboard[0] + margin + (point[0] - bounds.minX) * scale,
        artboard[1] - margin - (bounds.maxY - point[1]) * scale
    ];
}

function getDxfPrimaryNoteLine(note) {
    return String(note || "").split(/\r?\n/)[0];
}

function getDxfMetadataValue(itemOrNote, metadataName) {
    var note = "";
    if (typeof itemOrNote === "string") {
        note = itemOrNote;
    } else {
        try {
            note = String(itemOrNote && itemOrNote.note || "");
        } catch (metadataReadError) {
            return "";
        }
    }
    var lines = note.split(/\r?\n/);
    var prefix = metadataName + "|";
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (lines[lineIndex].indexOf(prefix) === 0) {
            return lines[lineIndex].substring(prefix.length);
        }
    }
    return "";
}

function setDxfMetadataValue(item, metadataName, value) {
    var note = "";
    try {
        note = String(item && item.note || "");
    } catch (metadataReadError) {
        return false;
    }
    var lines = note ? note.split(/\r?\n/) : [];
    var prefix = metadataName + "|";
    var updated = false;
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (lines[lineIndex].indexOf(prefix) === 0) {
            lines[lineIndex] = prefix + String(value);
            updated = true;
            break;
        }
    }
    if (!updated) {
        lines.push(prefix + String(value));
    }
    try {
        item.note = lines.join("\n");
        return true;
    } catch (metadataWriteError) {
        return false;
    }
}

function getDxfImportId(importLayer) {
    // Illustrator 的 Layer 对象没有可靠的 note 属性。新导入的编号直接写在
    // 尺码编组上；这里只为旧文档尝试从已有尺码编组的编号反推导入编号。
    if (importLayer && importLayer.groupItems) {
        for (var groupIndex = 0; groupIndex < importLayer.groupItems.length; groupIndex++) {
            var group = importLayer.groupItems[groupIndex];
            var sizeId = getDxfMetadataValue(group, "AAMA_SIZE_ID");
            var sizeMarkerIndex = sizeId.lastIndexOf("|size:");
            if (sizeMarkerIndex > 0) {
                return sizeId.substring(0, sizeMarkerIndex);
            }
        }
    }
    return "legacy-import";
}

function getDxfElementId(item) {
    return getDxfMetadataValue(item, "AAMA_ELEMENT");
}

function getDxfPieceStableId(pieceGroup) {
    return getDxfMetadataValue(pieceGroup, "AAMA_PIECE_ID");
}

function getDxfSizeGroupId(sizeGroup) {
    return getDxfMetadataValue(sizeGroup, "AAMA_SIZE_ID");
}

function getDxfShapeElementName(baseName, shape) {
    if (!shape || !shape.elementOrdinal) {
        return baseName;
    }
    return baseName + "_元素" + formatDxfElementNumber(shape.elementOrdinal);
}

function getOrCreateDxfPieceGroup(importLayer, pieceGroups, shape, importId) {
    var sizeName = shape.sizeName || "未知尺码";
    var sizeKey = "size:" + sizeName;
    if (!pieceGroups[sizeKey]) {
        var sizeGroup = importLayer.groupItems.add();
        sizeGroup.name = "尺码 " + sizeName;
        sizeGroup.note = "AAMA_SIZE|" + sizeName;
        setDxfMetadataValue(
            sizeGroup,
            "AAMA_SIZE_ID",
            String(importId || getDxfImportId(importLayer)) + "|size:" + sizeName
        );
        pieceGroups[sizeKey] = sizeGroup;
    }

    var pieceKey = sizeKey + "|" + (shape.pieceKey || "entities");
    if (pieceGroups[pieceKey]) {
        return pieceGroups[pieceKey];
    }

    var group = pieceGroups[sizeKey].groupItems.add();
    group.name = shape.pieceLabel || "DXF 实体";
    group.note = "AAMA_PIECE|" + pieceKey +
        "|QTY|" + (shape.pieceQuantity || 1) +
        "|SOURCE_QTY|" + (shape.pieceSourceQuantity || shape.pieceQuantity || 1) +
        "|COPY|" + ((shape.pieceCopyIndex || 0) + 1);
    setDxfMetadataValue(group, "AAMA_PIECE_ID", shape.pieceStableId || shape.pieceKey || "entities");
    pieceGroups[pieceKey] = group;
    return group;
}

function getDxfPieceSemanticGroupKey(shape) {
    return "size:" + (shape.sizeName || "未知尺码") + "|" + (shape.pieceKey || "entities");
}

function addDxfSemanticGroup(pieceGroup, groupName, role) {
    var group = pieceGroup.groupItems.add();
    group.name = groupName;
    group.note = "AAMA_SEMANTIC_GROUP|" + role;
    setDxfMetadataValue(
        group,
        "AAMA_ELEMENT",
        getDxfPieceStableId(pieceGroup) + "|group:" + role
    );
    return group;
}

function getOrCreateDxfPieceSemanticGroups(pieceGroup, semanticGroups, shape) {
    var groupKey = getDxfPieceSemanticGroupKey(shape);
    if (semanticGroups[groupKey]) {
        return semanticGroups[groupKey];
    }

    var groups = {
        anchorGroup: addDxfSemanticGroup(pieceGroup, "内线锚点组", "inner-anchor"),
        clipAnchorGroup: addDxfSemanticGroup(pieceGroup, "外线锚点组", "outer-anchor"),
        notchingGroup: addDxfSemanticGroup(pieceGroup, "刀口组", "notching"),
        techHoleGroup: addDxfSemanticGroup(pieceGroup, "工艺孔组", "tech-hole"),
        techLineGroup: addDxfSemanticGroup(pieceGroup, "工艺线组", "techline")
    };
    semanticGroups[groupKey] = groups;
    return groups;
}

function flattenLegacyDxfOuterLineGroups(pieceGroup) {
    var movedCount = 0;
    for (var groupIndex = pieceGroup.groupItems.length - 1; groupIndex >= 0; groupIndex--) {
        var group = pieceGroup.groupItems[groupIndex];
        if (group.parent !== pieceGroup ||
            (getDxfPrimaryNoteLine(group.note) !== "AAMA_SEMANTIC_GROUP|outer-line" &&
                String(group.name || "") !== "外线组")) {
            continue;
        }
        while (group.pageItems.length > 0) {
            group.pageItems[0].move(pieceGroup, ElementPlacement.PLACEATEND);
            movedCount++;
        }
        group.remove();
    }
    return movedCount;
}

function collectDxfClosedPathsByRole(container, role, result) {
    for (var itemIndex = 0; itemIndex < container.pageItems.length; itemIndex++) {
        var item = container.pageItems[itemIndex];
        if (item.parent !== container) {
            continue;
        }
        if (item.typename === "PathItem" && item.closed &&
            getDxfSemanticRole(item) === role) {
            result.push(item);
        } else if (item.typename === "GroupItem") {
            var groupRole = getDxfPrimaryNoteLine(item.note);
            if (groupRole === "AAMA_SEMANTIC_GROUP|outer-line" ||
                groupRole === "AAMA_SEMANTIC_GROUP|inner-line") {
                collectDxfClosedPathsByRole(item, role, result);
            }
        }
    }
}

function findDxfLargestClosedPath(paths) {
    var selected = null;
    var selectedArea = -1;
    for (var pathIndex = 0; pathIndex < paths.length; pathIndex++) {
        var area = getDxfPathAbsoluteArea(paths[pathIndex]);
        if (area > selectedArea) {
            selected = paths[pathIndex];
            selectedArea = area;
        }
    }
    return selected;
}

function getDxfPieceClipBoundary(pieceGroup, boundaryType) {
    if (boundaryType === "clean") {
        var innerPaths = [];
        collectDxfClosedPathsByRole(pieceGroup, "clean-edge", innerPaths);
        return findDxfLargestClosedPath(innerPaths);
    }
    return findDxfLargestClosedPath(getDxfBoundaryPaths(pieceGroup));
}

function findDxfPieceClipPath(pieceGroup) {
    for (var itemIndex = 0; itemIndex < pieceGroup.pageItems.length; itemIndex++) {
        var item = pieceGroup.pageItems[itemIndex];
        if (item.parent === pieceGroup && item.typename === "PathItem" &&
            getDxfPrimaryNoteLine(item.note) === "AAMA_PIECE_CLIP_PATH") {
            return item;
        }
    }
    return null;
}

function getDxfPieceClipBoundaryType(pieceGroup) {
    var value = getDxfMetadataValue(pieceGroup, "AAMA_PIECE_CLIP_BOUNDARY");
    return value === "clean" ? "clean" : "outer";
}

function ensureDxfPieceClippingMask(pieceGroup, requestedBoundaryType) {
    var boundaryType = requestedBoundaryType || getDxfPieceClipBoundaryType(pieceGroup);
    var currentClipPath = findDxfPieceClipPath(pieceGroup);
    if (currentClipPath !== null && !requestedBoundaryType) {
        return currentClipPath;
    }
    var boundary = getDxfPieceClipBoundary(pieceGroup, boundaryType);
    if (boundary === null) {
        return null;
    }
    if (currentClipPath !== null) {
        try {
            pieceGroup.clipped = false;
        } catch (unclipError) {
            // 继续替换路径，较旧版本会在再次设为 clipped 时刷新状态。
        }
        currentClipPath.remove();
    }
    var clipPath = boundary.duplicate(pieceGroup, ElementPlacement.PLACEATBEGINNING);
    clipPath.name = "<ClipPath>";
    clipPath.note = "AAMA_PIECE_CLIP_PATH";
    setDxfMetadataValue(
        clipPath,
        "AAMA_ELEMENT",
        getDxfPieceStableId(pieceGroup) + "|clip-path"
    );
    clipPath.stroked = false;
    clipPath.filled = false;
    clipPath.clipping = true;
    clipPath.zOrder(ZOrderMethod.BRINGTOFRONT);
    pieceGroup.clipped = true;
    setDxfMetadataValue(pieceGroup, "AAMA_PIECE_CLIP_BOUNDARY", boundaryType);
    return clipPath;
}

function orderDxfPieceArtwork(pieceGroup) {
    flattenLegacyDxfOuterLineGroups(pieceGroup);
    var clipPath = ensureDxfPieceClippingMask(pieceGroup, null);
    var outerPaths = getDxfBoundaryPaths(pieceGroup);
    var sizeTags = typeof findDxfPieceSizeTags === "function" ?
        findDxfPieceSizeTags(pieceGroup) : [];
    for (var sizeTagIndex = 0; sizeTagIndex < sizeTags.length; sizeTagIndex++) {
        if (sizeTags[sizeTagIndex].parent === pieceGroup) {
            try {
                sizeTags[sizeTagIndex].zOrder(ZOrderMethod.BRINGTOFRONT);
            } catch (sizeTagOrderError) {
                // 旧版 Illustrator 不支持的对象层级保持不变。
            }
        }
    }
    for (var outerPathIndex = 0; outerPathIndex < outerPaths.length; outerPathIndex++) {
        if (outerPaths[outerPathIndex].parent === pieceGroup) {
            try {
                outerPaths[outerPathIndex].zOrder(ZOrderMethod.BRINGTOFRONT);
            } catch (outerLineOrderError) {
                // 保持外线为裁片直属普通路径。
            }
        }
    }
    if (clipPath !== null) {
        try {
            clipPath.zOrder(ZOrderMethod.BRINGTOFRONT);
        } catch (clipPathOrderError) {
            // 保持已有剪切关系。
        }
    }
}

function findDxfLayerByName(doc, layerName) {
    for (var layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
        if (doc.layers[layerIndex].name === layerName) {
            return doc.layers[layerIndex];
        }
    }
    return null;
}

function findDxfTextFrameByNote(container, note) {
    for (var textIndex = 0; textIndex < container.textFrames.length; textIndex++) {
        if (String(container.textFrames[textIndex].note || "") === note) {
            return container.textFrames[textIndex];
        }
    }
    return null;
}

function findDxfTextFrameByNotePrefix(container, notePrefix) {
    for (var textIndex = 0; textIndex < container.textFrames.length; textIndex++) {
        if (String(container.textFrames[textIndex].note || "").indexOf(notePrefix) === 0) {
            return container.textFrames[textIndex];
        }
    }
    return null;
}

function findDxfBoldFont(sourceFont) {
    var boldPattern = /(bold|demi|semi|heavy|black|粗|黑)/i;
    if (sourceFont && boldPattern.test(String(sourceFont.style || ""))) {
        return sourceFont;
    }

    var sourceFamily = sourceFont ? String(sourceFont.family || "") : "";
    var bestFont = null;
    var bestScore = -Infinity;
    for (var fontIndex = 0; fontIndex < app.textFonts.length; fontIndex++) {
        var font = app.textFonts[fontIndex];
        if (sourceFamily && String(font.family || "") !== sourceFamily) {
            continue;
        }
        var style = String(font.style || "");
        if (!boldPattern.test(style)) {
            continue;
        }
        var score = 0;
        if (/^bold$/i.test(style) || /^粗体$/.test(style)) {
            score += 20;
        }
        if (/semi|demi/i.test(style)) {
            score += 10;
        }
        if (/italic|oblique|斜/i.test(style)) {
            score -= 5;
        }
        if (score > bestScore) {
            bestFont = font;
            bestScore = score;
        }
    }
    return bestFont || sourceFont;
}

function findDxfMicrosoftYaHeiBoldFont() {
    var bestFont = null;
    var bestScore = -Infinity;
    for (var fontIndex = 0; fontIndex < app.textFonts.length; fontIndex++) {
        var font = app.textFonts[fontIndex];
        var family = String(font.family || "");
        var name = String(font.name || "");
        var style = String(font.style || "");
        var normalizedFamily = family.toLowerCase().replace(/[\s\-_]/g, "");
        var normalizedName = name.toLowerCase().replace(/[\s\-_]/g, "");
        var isMicrosoftYaHei = normalizedFamily.indexOf("microsoftyahei") !== -1 ||
            normalizedName.indexOf("microsoftyahei") !== -1 ||
            family.indexOf("微软雅黑") !== -1 || name.indexOf("微软雅黑") !== -1;
        var isBold = /(bold|demi|semi|heavy|black|粗|黑)/i.test(style + " " + name);
        if (!isMicrosoftYaHei || !isBold) {
            continue;
        }

        var score = 0;
        if (normalizedFamily === "microsoftyahei" || family === "微软雅黑") {
            score += 30;
        }
        if (/^bold$/i.test(style) || /^粗体$/.test(style)) {
            score += 20;
        }
        if (normalizedFamily.indexOf("ui") !== -1 || normalizedName.indexOf("ui") !== -1) {
            score -= 5;
        }
        if (/italic|oblique|斜/i.test(style)) {
            score -= 10;
        }
        if (score > bestScore) {
            bestFont = font;
            bestScore = score;
        }
    }
    return bestFont;
}

function applyDxfDefaultSizeTagStyle(text, doc) {
    var attributes = text.textRange.characterAttributes;
    var pointScale = getDxfPointToDocumentUnits(doc);
    var fillColor = new RGBColor();
    fillColor.red = 233;
    fillColor.green = 78;
    fillColor.blue = 99;

    attributes.size = 14 * pointScale;
    attributes.fillColor = fillColor;
    attributes.strokeColor = new NoColor();
    attributes.strokeWeight = 0;
    var boldFont = findDxfMicrosoftYaHeiBoldFont() ||
        findDxfBoldFont(attributes.textFont);
    if (boldFont) {
        attributes.textFont = boldFont;
    }
}

function getOrCreateDxfParameterText(layer, note, contents, name, position, defaultSize) {
    var text = findDxfTextFrameByNote(layer, note);
    var isNewText = text === null;
    if (isNewText) {
        text = layer.textFrames.add();
    }
    text.contents = contents;
    text.name = name;
    text.note = note;
    text.position = position;
    text.hidden = false;
    if (isNewText) {
        try {
            text.textRange.characterAttributes.size = defaultSize;
        } catch (textSizeError) {
            // Keep Illustrator's current text size when the property is unavailable.
        }
    }
    return text;
}

function createDxfStyleHintLayer(doc, artboard, activeLayer) {
    var layerName = "LanTu_参数样例";
    var layer = findDxfLayerByName(doc, layerName);
    if (layer === null) {
        layer = doc.layers.add();
        layer.name = layerName;
    }
    layer.locked = false;
    try {
        layer.printable = false;
    } catch (printableError) {
        // Older Illustrator versions may not expose Layer.printable to ExtendScript.
    }
    var hints = [
        ["外线", "contour"],
        ["内线", "clean-edge"],
        ["刀口", "notching"],
        ["工艺线", "techline"]
    ];
    var millimeterScale = getDxfMillimeterToDocumentUnits(doc);
    var labelX = artboard[0] + 8 * millimeterScale;
    var startX = labelX + 18 * millimeterScale;
    var startY = artboard[1] - 8 * millimeterScale;
    var pointScale = getDxfPointToDocumentUnits(doc);

    var samplesByRole = {};
    for (var existingIndex = 0; existingIndex < layer.pathItems.length; existingIndex++) {
        var existingSample = layer.pathItems[existingIndex];
        var existingNote = getDxfPrimaryNoteLine(existingSample.note);
        if (existingNote.indexOf("AAMA_STYLE_HINT|") !== 0) {
            continue;
        }
        var existingRole = existingNote.substring("AAMA_STYLE_HINT|".length);
        if (!samplesByRole[existingRole]) {
            samplesByRole[existingRole] = existingSample;
        } else {
            existingSample.hidden = true;
        }
    }

    for (var hintIndex = 0; hintIndex < hints.length; hintIndex++) {
        var role = hints[hintIndex][1];
        var rowY = startY - hintIndex * 8 * millimeterScale;
        var sample = samplesByRole[role];
        var isNewSample = !sample;
        if (isNewSample) {
            sample = layer.pathItems.add();
        }
        sample.setEntirePath([
            [startX, rowY],
            [startX + 20 * millimeterScale, rowY]
        ]);
        sample.closed = false;
        if (isNewSample || getDxfMetadataValue(sample, "AAMA_STYLE_DEFAULT") !== "V2") {
            applyDxfDefaultStrokeStyle(sample, role, doc);
            setDxfMetadataValue(sample, "AAMA_STYLE_DEFAULT", "V2");
        }
        sample.hidden = false;
        sample.name = hints[hintIndex][0];
        sample.note = "AAMA_STYLE_HINT|" + role;
        samplesByRole[role] = sample;
        getOrCreateDxfParameterText(
            layer,
            "AAMA_STYLE_LABEL|" + role,
            hints[hintIndex][0],
            hints[hintIndex][0] + "说明",
            [labelX, rowY + 3 * pointScale],
            9 * pointScale
        );
    }

    for (var unsupportedRole in samplesByRole) {
        if (!samplesByRole.hasOwnProperty(unsupportedRole)) {
            continue;
        }
        if (unsupportedRole !== "contour" && unsupportedRole !== "clean-edge" &&
            unsupportedRole !== "notching" && unsupportedRole !== "techline") {
            samplesByRole[unsupportedRole].hidden = true;
        }
    }

    var sizeTagY = startY - hints.length * 8 * millimeterScale;
    getOrCreateDxfParameterText(
        layer,
        "AAMA_SIZE_TAG_LABEL",
        "尺码标",
        "尺码标说明",
        [labelX, sizeTagY + 3 * pointScale],
        9 * pointScale
    );
    var sizeTagSample = findDxfTextFrameByNotePrefix(layer, "AAMA_SIZE_TAG_SAMPLE");
    var shouldApplyDefaultSizeTagStyle = sizeTagSample === null ||
        String(sizeTagSample.note || "") !== "AAMA_SIZE_TAG_SAMPLE|DEFAULT_V4";
    if (sizeTagSample === null) {
        sizeTagSample = layer.textFrames.add();
    }
    sizeTagSample.contents = "XSML";
    sizeTagSample.name = "尺码标样例";
    sizeTagSample.position = [startX, sizeTagY + 3 * pointScale];
    sizeTagSample.hidden = false;
    if (shouldApplyDefaultSizeTagStyle) {
        applyDxfDefaultSizeTagStyle(sizeTagSample, doc);
    }
    sizeTagSample.note = "AAMA_SIZE_TAG_SAMPLE|DEFAULT_V4";
    if (typeof ensureDxfSecondarySizeTagSample === "function") {
        ensureDxfSecondarySizeTagSample(
            layer,
            doc,
            labelX,
            startX,
            sizeTagY,
            pointScale,
            millimeterScale,
            sizeTagSample
        );
    }
    if (activeLayer) {
        doc.activeLayer = activeLayer;
    }
    layer.visible = true;
    return layer;
}
