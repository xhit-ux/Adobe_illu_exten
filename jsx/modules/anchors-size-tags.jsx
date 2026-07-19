// 锚点配对与尺码标定位：外线锚点按编号顺序匹配最近未使用的内线锚点。

function invalidateDxfAnchorOptionsCache() {
    // 旧版“手动选择单个尺码锚点”的缓存已经移除；保留入口兼容现有调用。
}

function parseDxfAnchorPointMetadata(note) {
    var parts = getDxfPrimaryNoteLine(note).split("|");
    if (parts.length < 4 || parts[0] !== "AAMA_ANCHOR_POINT") {
        return null;
    }
    var ordinal = parseInt(parts[3], 10);
    if ((parts[1] !== "INNER" && parts[1] !== "OUTER") || isNaN(ordinal)) {
        return null;
    }
    return { type: parts[1], boundaryId: parts[2], ordinal: ordinal };
}

function parseDxfAnchorOptionValue(value) {
    var match = /^(INNER|OUTER):(\d+)$/.exec(String(value || ""));
    if (!match) {
        return null;
    }
    return { type: match[1], ordinal: parseInt(match[2], 10) };
}

function getDxfAnchorTypeLabel(anchorType) {
    return anchorType === "INNER" ? "内线" : "外线";
}

function clearDxfDocumentSelection(doc) {
    var selection = doc.selection;
    if (!selection) {
        return;
    }
    for (var selectionIndex = selection.length - 1; selectionIndex >= 0; selectionIndex--) {
        try {
            selection[selectionIndex].selected = false;
        } catch (clearError) {
            // 忽略不可选的非页面对象。
        }
    }
}

function findDxfAnchorInPiece(pieceGroup, anchorType, ordinal) {
    for (var itemIndex = 0; itemIndex < pieceGroup.pageItems.length; itemIndex++) {
        var item = pieceGroup.pageItems[itemIndex];
        if (item.parent !== pieceGroup) {
            continue;
        }
        if (item.typename === "PathItem") {
            var metadata = parseDxfAnchorPointMetadata(item.note);
            if (metadata !== null && metadata.type === anchorType &&
                metadata.ordinal === ordinal) {
                return item;
            }
        } else if (item.typename === "GroupItem") {
            var nestedAnchor = findDxfAnchorInPiece(item, anchorType, ordinal);
            if (nestedAnchor !== null) {
                return nestedAnchor;
            }
        }
    }
    return null;
}

function collectDxfAnchorsInPiece(pieceGroup, anchorType, result) {
    for (var itemIndex = 0; itemIndex < pieceGroup.pageItems.length; itemIndex++) {
        var item = pieceGroup.pageItems[itemIndex];
        if (item.parent !== pieceGroup) {
            continue;
        }
        if (item.typename === "PathItem") {
            var metadata = parseDxfAnchorPointMetadata(item.note);
            if (metadata !== null && metadata.type === anchorType &&
                item.pathPoints.length > 0) {
                result.push({ item: item, metadata: metadata });
            }
        } else if (item.typename === "GroupItem") {
            collectDxfAnchorsInPiece(item, anchorType, result);
        }
    }
}

function compareDxfAnchorItems(first, second) {
    if (first.metadata.ordinal !== second.metadata.ordinal) {
        return first.metadata.ordinal - second.metadata.ordinal;
    }
    var firstPoint = first.item.pathPoints[0].anchor;
    var secondPoint = second.item.pathPoints[0].anchor;
    if (firstPoint[0] !== secondPoint[0]) {
        return firstPoint[0] - secondPoint[0];
    }
    return firstPoint[1] - secondPoint[1];
}

function getDxfAnchorPairs(pieceGroup) {
    var outerAnchors = [];
    var innerAnchors = [];
    collectDxfAnchorsInPiece(pieceGroup, "OUTER", outerAnchors);
    collectDxfAnchorsInPiece(pieceGroup, "INNER", innerAnchors);
    outerAnchors.sort(compareDxfAnchorItems);
    innerAnchors.sort(compareDxfAnchorItems);

    var pairs = [];
    var usedInner = {};
    for (var outerIndex = 0; outerIndex < outerAnchors.length; outerIndex++) {
        var outerPoint = outerAnchors[outerIndex].item.pathPoints[0].anchor;
        var nearestInnerIndex = -1;
        var nearestDistanceSquared = Infinity;
        for (var innerIndex = 0; innerIndex < innerAnchors.length; innerIndex++) {
            if (usedInner[innerIndex]) {
                continue;
            }
            var innerPoint = innerAnchors[innerIndex].item.pathPoints[0].anchor;
            var distanceX = outerPoint[0] - innerPoint[0];
            var distanceY = outerPoint[1] - innerPoint[1];
            var distanceSquared = distanceX * distanceX + distanceY * distanceY;
            if (distanceSquared < nearestDistanceSquared - 0.000001 ||
                (Math.abs(distanceSquared - nearestDistanceSquared) <= 0.000001 &&
                (nearestInnerIndex < 0 || innerAnchors[innerIndex].metadata.ordinal <
                    innerAnchors[nearestInnerIndex].metadata.ordinal))) {
                nearestInnerIndex = innerIndex;
                nearestDistanceSquared = distanceSquared;
            }
        }
        if (nearestInnerIndex < 0) {
            break;
        }
        usedInner[nearestInnerIndex] = true;
        pairs.push({
            outer: outerAnchors[outerIndex],
            inner: innerAnchors[nearestInnerIndex],
            distance: Math.sqrt(nearestDistanceSquared)
        });
    }
    pairs.outerCount = outerAnchors.length;
    pairs.innerCount = innerAnchors.length;
    return pairs;
}

function parseDxfSizeAnchorPairOptionValue(value) {
    var match = /^PAIR:(\d+)$/.exec(String(value || ""));
    if (!match) {
        return null;
    }
    var ordinal = parseInt(match[1], 10);
    return isNaN(ordinal) || ordinal < 1 ? null : ordinal;
}

function getDxfSizeAnchorPairOptions() {
    try {
        if (app.documents.length === 0) {
            return "";
        }
        var sizeGroups = collectDxfInheritanceSizeGroups(app.activeDocument);
        var counts = {};
        var outerOrdinals = {};
        var innerOrdinals = {};
        var mixedInner = {};
        for (var sizeIndex = 0; sizeIndex < sizeGroups.length; sizeIndex++) {
            var pieces = [];
            collectDxfPieceGroups(sizeGroups[sizeIndex], pieces);
            for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
                var pairs = getDxfAnchorPairs(pieces[pieceIndex]);
                for (var pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
                    var pairOrdinal = pairIndex + 1;
                    counts[pairOrdinal] = (counts[pairOrdinal] || 0) + 1;
                    if (outerOrdinals[pairOrdinal] === undefined) {
                        outerOrdinals[pairOrdinal] = pairs[pairIndex].outer.metadata.ordinal;
                    }
                    if (innerOrdinals[pairOrdinal] === undefined) {
                        innerOrdinals[pairOrdinal] = pairs[pairIndex].inner.metadata.ordinal;
                    } else if (innerOrdinals[pairOrdinal] !==
                        pairs[pairIndex].inner.metadata.ordinal) {
                        mixedInner[pairOrdinal] = true;
                    }
                }
            }
        }
        var lines = [];
        var ordinal = 1;
        while (counts[ordinal]) {
            var innerLabel = mixedInner[ordinal] ? "最近内线" :
                "内线" + formatDxfAnchorName(innerOrdinals[ordinal]);
            lines.push(
                "PAIR:" + ordinal + "\t锚点组" +
                (ordinal < 10 ? "0" + ordinal : String(ordinal)) +
                "（外线" + formatDxfAnchorName(outerOrdinals[ordinal]) +
                " + " + innerLabel + "，" + counts[ordinal] + " 个裁片可用）"
            );
            ordinal++;
        }
        return lines.join("\n");
    } catch (error) {
        return "ERROR|" + error.message;
    }
}

function selectDxfSizeAnchorPair(pairValue) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var pairOrdinal = parseDxfSizeAnchorPairOptionValue(pairValue);
        if (pairOrdinal === null) {
            return "请选择一个有效的尺码锚点组。";
        }
        var doc = app.activeDocument;
        var preferredPiece = null;
        if (doc.selection && doc.selection.length > 0) {
            preferredPiece = findDxfOwningPieceGroup(doc.selection[0]);
        }
        var selectedPair = null;
        var selectedPiece = null;
        if (preferredPiece !== null) {
            var preferredPairs = getDxfAnchorPairs(preferredPiece);
            if (preferredPairs.length >= pairOrdinal) {
                selectedPair = preferredPairs[pairOrdinal - 1];
                selectedPiece = preferredPiece;
            }
        }
        if (selectedPair === null) {
            var sizeGroups = collectDxfInheritanceSizeGroups(doc);
            for (var sizeIndex = 0; sizeIndex < sizeGroups.length && selectedPair === null;
                sizeIndex++) {
                var pieces = [];
                collectDxfPieceGroups(sizeGroups[sizeIndex], pieces);
                for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
                    var pairs = getDxfAnchorPairs(pieces[pieceIndex]);
                    if (pairs.length >= pairOrdinal) {
                        selectedPair = pairs[pairOrdinal - 1];
                        selectedPiece = pieces[pieceIndex];
                        break;
                    }
                }
            }
        }
        if (selectedPair === null) {
            return "当前文档没有找到该尺码锚点组。";
        }
        clearDxfDocumentSelection(doc);
        selectedPair.outer.item.selected = true;
        selectedPair.inner.item.selected = true;
        return "已预览锚点组" +
            (pairOrdinal < 10 ? "0" + pairOrdinal : String(pairOrdinal)) +
            "：外线" + formatDxfAnchorName(selectedPair.outer.metadata.ordinal) +
            " + 内线" + formatDxfAnchorName(selectedPair.inner.metadata.ordinal) +
            "（裁片“" + String(selectedPiece.name || "未命名") + "”）";
    } catch (error) {
        return "尺码锚点组预览失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function findDxfPieceSizeTags(pieceGroup) {
    var tags = [];
    for (var textIndex = 0; textIndex < pieceGroup.textFrames.length; textIndex++) {
        var text = pieceGroup.textFrames[textIndex];
        if (text.parent === pieceGroup &&
            getDxfPrimaryNoteLine(text.note).indexOf("AAMA_SIZE_TAG|") === 0) {
            tags.push(text);
        }
    }
    return tags;
}

function findDxfPieceSizeTag(pieceGroup) {
    var tags = findDxfPieceSizeTags(pieceGroup);
    if (tags.length === 0) {
        return null;
    }
    for (var tagIndex = 0; tagIndex < tags.length; tagIndex++) {
        if (getDxfMetadataValue(tags[tagIndex], "AAMA_ELEMENT") ===
            getDxfPieceStableId(pieceGroup) + "|size-tag") {
            return tags[tagIndex];
        }
    }
    return tags[0];
}

function removeDxfExtraPieceSizeTags(pieceGroup, keepTag) {
    var removedCount = 0;
    for (var textIndex = pieceGroup.textFrames.length - 1; textIndex >= 0; textIndex--) {
        var text = pieceGroup.textFrames[textIndex];
        if (text.parent === pieceGroup &&
            text !== keepTag &&
            getDxfPrimaryNoteLine(text.note).indexOf("AAMA_SIZE_TAG|") === 0) {
            text.remove();
            removedCount++;
        }
    }
    return removedCount;
}

function getDxfSizeTagStoredAngle(note) {
    var parts = getDxfPrimaryNoteLine(note).split("|");
    for (var partIndex = 0; partIndex < parts.length - 1; partIndex++) {
        if (parts[partIndex] === "ANGLE") {
            var angle = parseFloat(parts[partIndex + 1]);
            return isNaN(angle) ? 0 : angle;
        }
    }
    return 0;
}

function copyDxfTextStyle(sourceText, targetText) {
    var sourceAttributes = sourceText.textRange.characterAttributes;
    var targetAttributes = targetText.textRange.characterAttributes;
    var characterProperties = [
        "textFont", "size", "fillColor", "strokeColor", "strokeWeight",
        "tracking", "horizontalScale", "verticalScale", "baselineShift",
        "leading", "autoLeading", "capitalization", "underline",
        "strikeThrough", "overprintFill", "overprintStroke", "kerningMethod"
    ];
    for (var propertyIndex = 0; propertyIndex < characterProperties.length; propertyIndex++) {
        copyDxfStyleProperty(
            targetAttributes, sourceAttributes, characterProperties[propertyIndex]
        );
    }
    try {
        targetText.textRange.paragraphAttributes.justification =
            sourceText.textRange.paragraphAttributes.justification;
    } catch (paragraphError) {
        // 保持 Illustrator 当前段落对齐方式。
    }
    copyDxfStyleProperty(targetText, sourceText, "opacity");
    copyDxfStyleProperty(targetText, sourceText, "blendingMode");
}

function getDxfPathAbsoluteArea(path) {
    var points = getDxfPathAnchors(path);
    var area = 0;
    for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
        var nextPoint = points[(pointIndex + 1) % points.length];
        area += points[pointIndex][0] * nextPoint[1] - nextPoint[0] * points[pointIndex][1];
    }
    return Math.abs(area / 2);
}

function getDxfNearestSegmentOnPath(path, x, y) {
    var points = getDxfPathAnchors(path);
    var segmentCount = path.closed ? points.length : points.length - 1;
    var nearest = null;
    for (var pointIndex = 0; pointIndex < segmentCount; pointIndex++) {
        var start = points[pointIndex];
        var end = points[(pointIndex + 1) % points.length];
        var segmentX = end[0] - start[0];
        var segmentY = end[1] - start[1];
        var segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
        if (segmentLengthSquared === 0) {
            continue;
        }
        var projection = ((x - start[0]) * segmentX + (y - start[1]) * segmentY) /
            segmentLengthSquared;
        projection = Math.max(0, Math.min(1, projection));
        var closestX = start[0] + segmentX * projection;
        var closestY = start[1] + segmentY * projection;
        var distanceX = x - closestX;
        var distanceY = y - closestY;
        var distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
        var segmentLength = Math.sqrt(segmentLengthSquared);
        if (nearest === null || distance < nearest.distance - 0.000001 ||
            (Math.abs(distance - nearest.distance) <= 0.000001 &&
                segmentLength > nearest.segmentLength)) {
            nearest = {
                distance: distance,
                point: [closestX, closestY],
                segmentX: segmentX,
                segmentY: segmentY,
                segmentIndex: pointIndex,
                segmentLength: segmentLength
            };
        }
    }
    return nearest;
}

function moveDxfTextAnchorTo(sizeTag, targetX, targetY) {
    try {
        var currentAnchor = sizeTag.anchor;
        if (!currentAnchor || currentAnchor.length < 2) {
            return false;
        }
        sizeTag.translate(targetX - currentAnchor[0], targetY - currentAnchor[1]);
        var placedAnchor = sizeTag.anchor;
        return placedAnchor && placedAnchor.length >= 2 &&
            Math.abs(placedAnchor[0] - targetX) <= 0.001 &&
            Math.abs(placedAnchor[1] - targetY) <= 0.001;
    } catch (textAnchorError) {
        return false;
    }
}

function getDxfSizeTagVisibleBounds(sizeTag) {
    try {
        return sizeTag.visibleBounds;
    } catch (visibleBoundsError) {
        try {
            return sizeTag.geometricBounds;
        } catch (geometricBoundsError) {
            return null;
        }
    }
}

function getDxfInnerBoundaryPathId(path) {
    var prefix = "AAMA_DXF_INNER_BOUNDARY|";
    var note = getDxfPrimaryNoteLine(path.note);
    return note.indexOf(prefix) === 0 ? note.substring(prefix.length) : "";
}

function findDxfOuterBoundaryForAnchor(pieceGroup, outerAnchor) {
    var metadata = outerAnchor.metadata;
    var boundaries = getDxfBoundaryPaths(pieceGroup);
    var selected = null;
    var selectedArea = -1;
    for (var pathIndex = 0; pathIndex < boundaries.length; pathIndex++) {
        var boundary = boundaries[pathIndex];
        if (!boundary.closed) {
            continue;
        }
        if (metadata.boundaryId &&
            getAamaDxfBoundaryPathIdFromPath(boundary) === metadata.boundaryId) {
            return boundary;
        }
        var area = getDxfPathAbsoluteArea(boundary);
        if (area > selectedArea) {
            selected = boundary;
            selectedArea = area;
        }
    }
    return selected;
}

function findDxfInnerBoundaryForAnchor(pieceGroup, innerAnchor, outerBoundary) {
    var candidates = [];
    for (var pathIndex = 0; pathIndex < pieceGroup.pathItems.length; pathIndex++) {
        var path = pieceGroup.pathItems[pathIndex];
        var note = getDxfPrimaryNoteLine(path.note);
        if (path.closed && (note.indexOf("AAMA_DXF_INNER_BOUNDARY|") === 0 ||
            getDxfSemanticRole(path) === "clean-edge")) {
            candidates.push(path);
        }
    }
    var innerPoint = innerAnchor.item.pathPoints[0].anchor;
    var selected = null;
    var selectedDistance = Infinity;
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
        var candidate = candidates[candidateIndex];
        if (innerAnchor.metadata.boundaryId &&
            getDxfInnerBoundaryPathId(candidate) === innerAnchor.metadata.boundaryId) {
            return candidate;
        }
        if (outerBoundary !== null && !isPointInsideDxfPath(
            innerPoint[0], innerPoint[1], outerBoundary
        )) {
            continue;
        }
        var nearest = getDxfNearestSegmentOnPath(candidate, innerPoint[0], innerPoint[1]);
        if (nearest !== null && nearest.distance < selectedDistance) {
            selected = candidate;
            selectedDistance = nearest.distance;
        }
    }
    return selected;
}

function getDxfPairTextAngle(outerBoundary, outerPoint) {
    if (outerBoundary === null) {
        return 0;
    }
    var segment = getDxfNearestSegmentOnPath(outerBoundary, outerPoint[0], outerPoint[1]);
    if (segment === null || segment.segmentLength === 0) {
        return 0;
    }
    var angle = Math.atan2(segment.segmentY, segment.segmentX) * 180 / Math.PI;
    if (angle > 90) {
        angle -= 180;
    } else if (angle < -90) {
        angle += 180;
    }
    return angle;
}

function getDxfBoundsPairBandScore(bounds, outerBoundary, innerBoundary, tolerance) {
    if (bounds === null || outerBoundary === null) {
        return 0;
    }
    var left = Math.min(bounds[0], bounds[2]);
    var right = Math.max(bounds[0], bounds[2]);
    var bottom = Math.min(bounds[1], bounds[3]);
    var top = Math.max(bounds[1], bounds[3]);
    var xValues = [left, (left + right) / 2, right];
    var yValues = [bottom, (bottom + top) / 2, top];
    var score = 0;
    for (var xIndex = 0; xIndex < xValues.length; xIndex++) {
        for (var yIndex = 0; yIndex < yValues.length; yIndex++) {
            var pointIsInOuter = isPointInsideDxfPath(
                xValues[xIndex], yValues[yIndex], outerBoundary
            );
            if (!pointIsInOuter) {
                var nearestOuter = getDxfNearestSegmentOnPath(
                    outerBoundary, xValues[xIndex], yValues[yIndex]
                );
                pointIsInOuter = nearestOuter !== null && nearestOuter.distance <= tolerance;
            }
            if (!pointIsInOuter) {
                continue;
            }
            if (innerBoundary !== null && isPointInsideDxfPath(
                xValues[xIndex], yValues[yIndex], innerBoundary
            )) {
                continue;
            }
            if (innerBoundary !== null) {
                var nearestInner = getDxfNearestSegmentOnPath(
                    innerBoundary, xValues[xIndex], yValues[yIndex]
                );
                if (nearestInner !== null && nearestInner.distance <= tolerance) {
                    continue;
                }
            }
            score++;
        }
    }
    return score;
}

function positionDxfSizeTagBetweenAnchorPair(pieceGroup, pair, sizeTag) {
    var outerPoint = pair.outer.item.pathPoints[0].anchor;
    var innerPoint = pair.inner.item.pathPoints[0].anchor;
    var outerBoundary = findDxfOuterBoundaryForAnchor(pieceGroup, pair.outer);
    var innerBoundary = findDxfInnerBoundaryForAnchor(
        pieceGroup, pair.inner, outerBoundary
    );
    var angle = getDxfPairTextAngle(outerBoundary, outerPoint);
    if (Math.abs(angle) > 0.000001) {
        sizeTag.rotate(angle);
    }

    var factors = [
        0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7,
        0.25, 0.75
    ];
    var tolerance = 0.001 * getDxfPointToDocumentUnits(pieceGroup);
    var best = null;
    for (var factorIndex = 0; factorIndex < factors.length; factorIndex++) {
        var factor = factors[factorIndex];
        var targetX = outerPoint[0] + (innerPoint[0] - outerPoint[0]) * factor;
        var targetY = outerPoint[1] + (innerPoint[1] - outerPoint[1]) * factor;
        if (!moveDxfTextAnchorTo(sizeTag, targetX, targetY)) {
            continue;
        }
        var score = getDxfBoundsPairBandScore(
            getDxfSizeTagVisibleBounds(sizeTag), outerBoundary, innerBoundary, tolerance
        );
        if (best === null || score > best.score) {
            best = { x: targetX, y: targetY, factor: factor, score: score };
            if (score === 9 && factor === 0.5) {
                break;
            }
        }
    }
    if (best === null) {
        best = {
            x: (outerPoint[0] + innerPoint[0]) / 2,
            y: (outerPoint[1] + innerPoint[1]) / 2,
            factor: 0.5,
            score: 0
        };
    }
    moveDxfTextAnchorTo(sizeTag, best.x, best.y);
    return {
        angle: angle,
        safe: best.score === 9,
        visibleScore: best.score,
        factor: best.factor
    };
}
