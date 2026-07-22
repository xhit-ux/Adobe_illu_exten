// 二号尺码标：识别外线连续七点区域，裁掉该区域并在前后相邻点的连线中心生成尺码文字。

function createDxfSecondarySizeTagSettings(orderCode, heightMm) {
    return {
        orderCode: String(orderCode || "").replace(/^\s+|\s+$/g, ""),
        heightMm: normalizeDxfSizeTagNumber(heightMm, 12, false)
    };
}

function findDxfSecondaryOuterAnchorGroup(pieceGroup) {
    for (var groupIndex = 0; groupIndex < pieceGroup.groupItems.length; groupIndex++) {
        var group = pieceGroup.groupItems[groupIndex];
        if (group.parent !== pieceGroup) {
            continue;
        }
        var note = getDxfPrimaryNoteLine(group.note);
        if (note === "AAMA_SEMANTIC_GROUP|outer-anchor" ||
            String(group.name || "") === "外线锚点组") {
            return group;
        }
    }
    return null;
}

function collectDxfSecondaryOuterAnchorsByBoundary(pieceGroup) {
    var anchorGroup = findDxfSecondaryOuterAnchorGroup(pieceGroup);
    var boundaries = {};
    if (anchorGroup === null) {
        return boundaries;
    }
    for (var pathIndex = 0; pathIndex < anchorGroup.pathItems.length; pathIndex++) {
        var anchorItem = anchorGroup.pathItems[pathIndex];
        if (anchorItem.parent !== anchorGroup || anchorItem.pathPoints.length === 0) {
            continue;
        }
        var metadata = parseDxfAnchorPointMetadata(anchorItem.note);
        if (metadata === null || metadata.type !== "OUTER") {
            continue;
        }
        var key = "boundary:" + metadata.boundaryId;
        if (!boundaries[key]) {
            boundaries[key] = {
                boundaryId: metadata.boundaryId,
                anchors: []
            };
        }
        boundaries[key].anchors.push({
            item: anchorItem,
            metadata: metadata,
            point: [
                anchorItem.pathPoints[0].anchor[0],
                anchorItem.pathPoints[0].anchor[1]
            ]
        });
    }
    for (var boundaryKey in boundaries) {
        if (boundaries.hasOwnProperty(boundaryKey)) {
            boundaries[boundaryKey].anchors.sort(function (first, second) {
                return first.metadata.ordinal - second.metadata.ordinal;
            });
        }
    }
    return boundaries;
}

function getDxfSecondaryProjectionRange(points, propertyName) {
    var minimum = Infinity;
    var maximum = -Infinity;
    for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
        minimum = Math.min(minimum, points[pointIndex][propertyName]);
        maximum = Math.max(maximum, points[pointIndex][propertyName]);
    }
    return { minimum: minimum, maximum: maximum, span: maximum - minimum };
}

function getDxfSecondaryProjectionMean(points, propertyName) {
    var total = 0;
    for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
        total += points[pointIndex][propertyName];
    }
    return points.length > 0 ? total / points.length : 0;
}

function analyzeDxfSecondarySevenAnchorPoints(points, pieceGroup) {
    if (!points || points.length !== 7) {
        return null;
    }
    var millimeterScale = getDxfMillimeterToDocumentUnits(pieceGroup);
    var absoluteTolerance = 0.25 * millimeterScale;
    var minimumWidth = 5 * millimeterScale;
    var minimumHeight = 3 * millimeterScale;
    var origin = points[0];
    var best = null;

    // 任取两点建立候选横轴，再投影到局部坐标；这样裁片整体旋转后仍能识别。
    for (var firstIndex = 0; firstIndex < points.length - 1; firstIndex++) {
        for (var secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex++) {
            var axisX = points[secondIndex][0] - points[firstIndex][0];
            var axisY = points[secondIndex][1] - points[firstIndex][1];
            var axisLength = Math.sqrt(axisX * axisX + axisY * axisY);
            if (axisLength <= absoluteTolerance * 2) {
                continue;
            }
            var unitX = axisX / axisLength;
            var unitY = axisY / axisLength;
            var normalX = -unitY;
            var normalY = unitX;
            var projected = [];
            for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
                var relativeX = points[pointIndex][0] - origin[0];
                var relativeY = points[pointIndex][1] - origin[1];
                projected.push({
                    x: relativeX * unitX + relativeY * unitY,
                    y: relativeX * normalX + relativeY * normalY
                });
            }
            projected.sort(function (first, second) {
                return first.y - second.y;
            });

            for (var splitIndex = 3; splitIndex <= 4; splitIndex++) {
                var firstRow = projected.slice(0, splitIndex);
                var secondRow = projected.slice(splitIndex);
                if (!((firstRow.length === 3 && secondRow.length === 4) ||
                    (firstRow.length === 4 && secondRow.length === 3))) {
                    continue;
                }
                firstRow.sort(function (first, second) { return first.x - second.x; });
                secondRow.sort(function (first, second) { return first.x - second.x; });
                var firstX = getDxfSecondaryProjectionRange(firstRow, "x");
                var secondX = getDxfSecondaryProjectionRange(secondRow, "x");
                var firstY = getDxfSecondaryProjectionRange(firstRow, "y");
                var secondY = getDxfSecondaryProjectionRange(secondRow, "y");
                var width = (firstX.span + secondX.span) / 2;
                var firstMeanY = getDxfSecondaryProjectionMean(firstRow, "y");
                var secondMeanY = getDxfSecondaryProjectionMean(secondRow, "y");
                var height = Math.abs(secondMeanY - firstMeanY);
                if (width < minimumWidth || height < minimumHeight || width < height * 1.1) {
                    continue;
                }
                var lineTolerance = Math.max(absoluteTolerance, width * 0.005);
                var edgeTolerance = Math.max(absoluteTolerance * 2, width * 0.03);
                if (firstY.span > lineTolerance || secondY.span > lineTolerance ||
                    Math.abs(firstX.minimum - secondX.minimum) > edgeTolerance ||
                    Math.abs(firstX.maximum - secondX.maximum) > edgeTolerance) {
                    continue;
                }
                var threePointRow = firstRow.length === 3 ? firstRow : secondRow;
                var fourPointRow = firstRow.length === 4 ? firstRow : secondRow;
                var leftEdge = (firstX.minimum + secondX.minimum) / 2;
                var rightEdge = (firstX.maximum + secondX.maximum) / 2;
                var centerX = (leftEdge + rightEdge) / 2;
                var threeCenterError = Math.abs(threePointRow[1].x - centerX) / width;
                var innerLeft = fourPointRow[1].x;
                var innerRight = fourPointRow[2].x;
                var innerCenterError = Math.abs((innerLeft + innerRight) / 2 - centerX) / width;
                var innerGapRatio = (innerRight - innerLeft) / width;
                var leftMarginRatio = (innerLeft - leftEdge) / width;
                var rightMarginRatio = (rightEdge - innerRight) / width;
                if (threeCenterError > 0.12 || innerCenterError > 0.12 ||
                    innerLeft >= centerX || innerRight <= centerX ||
                    innerGapRatio <= 0 || innerGapRatio > 0.35 ||
                    leftMarginRatio < 0.1 || rightMarginRatio < 0.1) {
                    continue;
                }
                var score = threeCenterError + innerCenterError + innerGapRatio * 0.25 +
                    firstY.span / width + secondY.span / width +
                    Math.abs(firstX.minimum - secondX.minimum) / width +
                    Math.abs(firstX.maximum - secondX.maximum) / width;
                var centerY = (firstMeanY + secondMeanY) / 2;
                var candidate = {
                    center: [
                        origin[0] + centerX * unitX + centerY * normalX,
                        origin[1] + centerX * unitY + centerY * normalY
                    ],
                    width: width,
                    height: height,
                    score: score
                };
                if (best === null || candidate.score < best.score) {
                    best = candidate;
                }
            }
        }
    }
    return best;
}

function getDxfSecondaryAnchorSetKey(boundaryId, anchors) {
    var ordinals = [];
    for (var anchorIndex = 0; anchorIndex < anchors.length; anchorIndex++) {
        ordinals.push(anchors[anchorIndex].metadata.ordinal);
    }
    ordinals.sort(function (first, second) { return first - second; });
    return boundaryId + "|" + ordinals.join(",");
}

function findDxfSecondarySizeTagRegion(pieceGroup) {
    var processedMatch = getDxfSecondaryProcessedRegion(pieceGroup);
    if (processedMatch !== null) {
        return { match: processedMatch, ambiguous: false, candidateCount: 1 };
    }
    var boundaries = collectDxfSecondaryOuterAnchorsByBoundary(pieceGroup);
    var candidates = [];
    var usedSets = {};
    for (var boundaryKey in boundaries) {
        if (!boundaries.hasOwnProperty(boundaryKey)) {
            continue;
        }
        var boundary = boundaries[boundaryKey];
        var anchors = boundary.anchors;
        if (anchors.length < 9) {
            continue;
        }
        var windowCount = anchors.length;
        for (var startIndex = 0; startIndex < windowCount; startIndex++) {
            var windowAnchors = [];
            var points = [];
            for (var offset = 0; offset < 7; offset++) {
                var anchor = anchors[(startIndex + offset) % anchors.length];
                windowAnchors.push(anchor);
                points.push(anchor.point);
            }
            var setKey = getDxfSecondaryAnchorSetKey(
                boundary.boundaryId, windowAnchors
            );
            if (usedSets[setKey]) {
                continue;
            }
            usedSets[setKey] = true;
            var analysis = analyzeDxfSecondarySevenAnchorPoints(points, pieceGroup);
            if (analysis === null) {
                continue;
            }
            analysis.boundaryId = boundary.boundaryId;
            analysis.anchors = windowAnchors;
            analysis.previousAnchor = anchors[
                (startIndex - 1 + anchors.length) % anchors.length
            ];
            analysis.nextAnchor = anchors[(startIndex + 7) % anchors.length];
            analysis.sourceOrdinals = [];
            for (var sourceIndex = 0; sourceIndex < windowAnchors.length; sourceIndex++) {
                analysis.sourceOrdinals.push(
                    windowAnchors[sourceIndex].metadata.ordinal
                );
            }
            analysis.setKey = setKey;
            candidates.push(analysis);
        }
    }
    candidates.sort(function (first, second) { return first.score - second.score; });
    if (candidates.length === 0) {
        return { match: null, ambiguous: false, candidateCount: 0 };
    }
    if (candidates.length > 1 &&
        candidates[1].score <= candidates[0].score + 0.08) {
        return { match: null, ambiguous: true, candidateCount: candidates.length };
    }
    return {
        match: candidates[0],
        ambiguous: false,
        candidateCount: candidates.length
    };
}

function getDxfSecondaryCutRecord(pieceGroup) {
    var value = getDxfMetadataValue(pieceGroup, "AAMA_SECONDARY_CUT");
    if (!value) {
        return null;
    }
    var parts = value.split("\t");
    if (parts.length < 9 || parts[0] !== "V1") {
        return null;
    }
    var record = {
        boundaryId: parts[1],
        previousOrdinal: parseInt(parts[2], 10),
        nextOrdinal: parseInt(parts[3], 10),
        bridgeStart: [parseFloat(parts[4]), parseFloat(parts[5])],
        bridgeEnd: [parseFloat(parts[6]), parseFloat(parts[7])],
        sourceOrdinals: []
    };
    if (isNaN(record.previousOrdinal) || isNaN(record.nextOrdinal) ||
        isNaN(record.bridgeStart[0]) || isNaN(record.bridgeStart[1]) ||
        isNaN(record.bridgeEnd[0]) || isNaN(record.bridgeEnd[1])) {
        return null;
    }
    var ordinalParts = parts[8] ? parts[8].split(",") : [];
    for (var ordinalIndex = 0; ordinalIndex < ordinalParts.length; ordinalIndex++) {
        var ordinal = parseInt(ordinalParts[ordinalIndex], 10);
        if (!isNaN(ordinal)) {
            record.sourceOrdinals.push(ordinal);
        }
    }
    return record;
}

function findDxfSecondaryAnchorByOrdinal(boundary, ordinal) {
    if (!boundary) {
        return null;
    }
    for (var anchorIndex = 0; anchorIndex < boundary.anchors.length; anchorIndex++) {
        if (boundary.anchors[anchorIndex].metadata.ordinal === ordinal) {
            return boundary.anchors[anchorIndex];
        }
    }
    return null;
}

function getDxfSecondaryProcessedRegion(pieceGroup) {
    var record = getDxfSecondaryCutRecord(pieceGroup);
    if (record === null) {
        return null;
    }
    var boundaries = collectDxfSecondaryOuterAnchorsByBoundary(pieceGroup);
    var boundary = boundaries["boundary:" + record.boundaryId];
    var previousAnchor = findDxfSecondaryAnchorByOrdinal(
        boundary, record.previousOrdinal
    );
    var nextAnchor = findDxfSecondaryAnchorByOrdinal(boundary, record.nextOrdinal);
    if (previousAnchor !== null && nextAnchor !== null) {
        record.bridgeStart = previousAnchor.point;
        record.bridgeEnd = nextAnchor.point;
    }
    return {
        processed: true,
        boundaryId: record.boundaryId,
        anchors: [],
        sourceOrdinals: record.sourceOrdinals,
        previousAnchor: previousAnchor,
        nextAnchor: nextAnchor,
        previousOrdinal: record.previousOrdinal,
        nextOrdinal: record.nextOrdinal,
        bridgeStart: record.bridgeStart,
        bridgeEnd: record.bridgeEnd,
        center: [
            (record.bridgeStart[0] + record.bridgeEnd[0]) / 2,
            (record.bridgeStart[1] + record.bridgeEnd[1]) / 2
        ],
        score: 0
    };
}

function setDxfSecondaryCutRecord(pieceGroup, plan) {
    return setDxfMetadataValue(
        pieceGroup,
        "AAMA_SECONDARY_CUT",
        [
            "V1",
            plan.boundaryId,
            plan.previousOrdinal,
            plan.nextOrdinal,
            plan.bridgeStart[0],
            plan.bridgeStart[1],
            plan.bridgeEnd[0],
            plan.bridgeEnd[1],
            plan.sourceOrdinals.join(",")
        ].join("\t")
    );
}

function getDxfSecondaryPolygonArea(points) {
    var area = 0;
    for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
        var nextIndex = (pointIndex + 1) % points.length;
        area += points[pointIndex][0] * points[nextIndex][1] -
            points[nextIndex][0] * points[pointIndex][1];
    }
    return Math.abs(area) / 2;
}

function isDxfSecondaryPointOnSegment(point, start, end, tolerance) {
    var segmentX = end[0] - start[0];
    var segmentY = end[1] - start[1];
    var lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (lengthSquared <= tolerance * tolerance) {
        return getDxfPointDistance(point, start) <= tolerance;
    }
    var projection = ((point[0] - start[0]) * segmentX +
        (point[1] - start[1]) * segmentY) / lengthSquared;
    if (projection < 0 || projection > 1) {
        return false;
    }
    var nearest = [
        start[0] + segmentX * projection,
        start[1] + segmentY * projection
    ];
    return getDxfPointDistance(point, nearest) <= tolerance;
}

function isDxfSecondaryPointOnPolygon(point, polygon, tolerance) {
    for (var pointIndex = 0; pointIndex < polygon.length; pointIndex++) {
        if (isDxfSecondaryPointOnSegment(
            point,
            polygon[pointIndex],
            polygon[(pointIndex + 1) % polygon.length],
            tolerance
        )) {
            return true;
        }
    }
    return false;
}

function isDxfSecondaryPointInRemovedRegion(point, polygon, tolerance) {
    return isDxfSecondaryPointOnPolygon(point, polygon, tolerance) ||
        isPointInsideDxfShape(point, { points: polygon });
}

function findDxfSecondaryBoundaryPath(pieceGroup, boundaryId) {
    var boundaries = getDxfBoundaryPaths(pieceGroup);
    for (var pathIndex = 0; pathIndex < boundaries.length; pathIndex++) {
        if (getAamaDxfBoundaryPathIdFromPath(boundaries[pathIndex]) === boundaryId) {
            return boundaries[pathIndex];
        }
    }
    return null;
}

function findDxfSecondaryNearestPathPointIndex(points, target, tolerance) {
    var bestIndex = -1;
    var bestDistance = Infinity;
    for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
        var distance = getDxfPointDistance(points[pointIndex], target);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = pointIndex;
        }
    }
    return bestDistance <= tolerance ? bestIndex : -1;
}

function findDxfSecondaryForwardPathPoint(
    points, target, startIndex, maximumSteps, tolerance
) {
    var best = null;
    for (var step = 1; step <= maximumSteps; step++) {
        var pointIndex = (startIndex + step) % points.length;
        var distance = getDxfPointDistance(points[pointIndex], target);
        if (distance <= tolerance &&
            (best === null || distance < best.distance ||
                (distance === best.distance && step < best.step))) {
            best = { index: pointIndex, step: step, distance: distance };
        }
    }
    return best;
}

function collectDxfSecondaryPathInterval(points, startIndex, stepCount) {
    var result = [];
    for (var step = 0; step <= stepCount; step++) {
        var point = points[(startIndex + step) % points.length];
        result.push([point[0], point[1]]);
    }
    return result;
}

function createDxfSecondaryCutPlan(pieceGroup, match) {
    var outerPath = findDxfSecondaryBoundaryPath(pieceGroup, match.boundaryId);
    if (outerPath === null || !outerPath.closed) {
        return null;
    }
    var pathPoints = getDxfPathAnchors(outerPath);
    if (pathPoints.length < 10) {
        return null;
    }
    var matchTolerance = Math.max(
        0.001,
        0.5 * getDxfMillimeterToDocumentUnits(pieceGroup)
    );
    var geometryTolerance = Math.max(
        0.0001,
        0.01 * getDxfMillimeterToDocumentUnits(pieceGroup)
    );
    var sequence = [match.previousAnchor];
    for (var anchorIndex = 0; anchorIndex < match.anchors.length; anchorIndex++) {
        sequence.push(match.anchors[anchorIndex]);
    }
    sequence.push(match.nextAnchor);
    var previousIndex = findDxfSecondaryNearestPathPointIndex(
        pathPoints, sequence[0].point, matchTolerance
    );
    if (previousIndex < 0) {
        return null;
    }
    var sequenceIndices = [previousIndex];
    var currentIndex = previousIndex;
    var consumedSteps = 0;
    for (var sequenceIndex = 1; sequenceIndex < sequence.length; sequenceIndex++) {
        var found = findDxfSecondaryForwardPathPoint(
            pathPoints,
            sequence[sequenceIndex].point,
            currentIndex,
            pathPoints.length - consumedSteps - 1,
            matchTolerance
        );
        if (found === null) {
            return null;
        }
        consumedSteps += found.step;
        currentIndex = found.index;
        sequenceIndices.push(currentIndex);
    }
    if (consumedSteps <= 1 || consumedSteps >= pathPoints.length - 1) {
        return null;
    }
    var removedPolygon = collectDxfSecondaryPathInterval(
        pathPoints, previousIndex, consumedSteps
    );
    var retainedPoints = collectDxfSecondaryPathInterval(
        pathPoints,
        currentIndex,
        pathPoints.length - consumedSteps
    );
    if (removedPolygon.length < 3 || retainedPoints.length < 3 ||
        getDxfSecondaryPolygonArea(removedPolygon) <=
            geometryTolerance * geometryTolerance ||
        getDxfSecondaryPolygonArea(retainedPoints) <=
            geometryTolerance * geometryTolerance) {
        return null;
    }
    var sourceOrdinals = [];
    for (var sourceIndex = 0; sourceIndex < match.anchors.length; sourceIndex++) {
        sourceOrdinals.push(match.anchors[sourceIndex].metadata.ordinal);
    }
    return {
        outerPath: outerPath,
        boundaryId: match.boundaryId,
        previousAnchor: match.previousAnchor,
        nextAnchor: match.nextAnchor,
        previousOrdinal: match.previousAnchor.metadata.ordinal,
        nextOrdinal: match.nextAnchor.metadata.ordinal,
        sourceAnchors: match.anchors,
        sourceOrdinals: sourceOrdinals,
        removedPolygon: removedPolygon,
        retainedPoints: retainedPoints,
        bridgeStart: removedPolygon[0],
        bridgeEnd: removedPolygon[removedPolygon.length - 1],
        center: [
            (removedPolygon[0][0] + removedPolygon[removedPolygon.length - 1][0]) / 2,
            (removedPolygon[0][1] + removedPolygon[removedPolygon.length - 1][1]) / 2
        ],
        tolerance: geometryTolerance
    };
}

function getDxfSecondaryUniqueParameters(parameters) {
    parameters.sort(function (first, second) { return first - second; });
    var unique = [];
    for (var parameterIndex = 0; parameterIndex < parameters.length; parameterIndex++) {
        var value = Math.max(0, Math.min(1, parameters[parameterIndex]));
        if (unique.length === 0 ||
            Math.abs(value - unique[unique.length - 1]) > 0.000000001) {
            unique.push(value);
        }
    }
    return unique;
}

function normalizeDxfSecondaryPathPart(points, tolerance) {
    var normalized = [];
    for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
        if (normalized.length === 0 ||
            getDxfPointDistance(normalized[normalized.length - 1], points[pointIndex]) >
                tolerance) {
            normalized.push(points[pointIndex]);
        }
    }
    return normalized;
}

function mergeDxfSecondaryClosedPathParts(parts, tolerance) {
    if (parts.length < 2) {
        return parts;
    }
    var first = parts[0];
    var last = parts[parts.length - 1];
    if (getDxfPointDistance(last[last.length - 1], first[0]) > tolerance) {
        return parts;
    }
    var merged = last.slice(0);
    for (var pointIndex = 1; pointIndex < first.length; pointIndex++) {
        merged.push(first[pointIndex]);
    }
    var result = [merged];
    for (var partIndex = 1; partIndex < parts.length - 1; partIndex++) {
        result.push(parts[partIndex]);
    }
    return result;
}

function getDxfSecondaryOutsidePathParts(path, plan) {
    var points = getDxfPathAnchors(path);
    if (points.length < 2) {
        return { changed: false, parts: [] };
    }
    var parts = [];
    var removedAny = false;
    var segmentCount = path.closed ? points.length : points.length - 1;
    for (var segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        var start = points[segmentIndex];
        var end = points[(segmentIndex + 1) % points.length];
        var parameters = [0, 1];
        for (var regionIndex = 0; regionIndex < plan.removedPolygon.length;
            regionIndex++) {
            collectDxfSegmentIntersectionParameters(
                start,
                end,
                plan.removedPolygon[regionIndex],
                plan.removedPolygon[(regionIndex + 1) % plan.removedPolygon.length],
                parameters
            );
        }
        var uniqueParameters = getDxfSecondaryUniqueParameters(parameters);
        for (var intervalIndex = 0; intervalIndex + 1 < uniqueParameters.length;
            intervalIndex++) {
            var startParameter = uniqueParameters[intervalIndex];
            var endParameter = uniqueParameters[intervalIndex + 1];
            if (endParameter - startParameter <= 0.000000001) {
                continue;
            }
            var intervalStart = getDxfInterpolatedPoint(start, end, startParameter);
            var intervalEnd = getDxfInterpolatedPoint(start, end, endParameter);
            var middle = getDxfInterpolatedPoint(
                start, end, (startParameter + endParameter) / 2
            );
            if (isDxfSecondaryPointInRemovedRegion(
                middle, plan.removedPolygon, plan.tolerance
            )) {
                removedAny = true;
                continue;
            }
            appendDxfClippedSegment(
                parts, [intervalStart, intervalEnd], plan.tolerance
            );
        }
    }
    if (!removedAny) {
        return { changed: false, parts: [] };
    }
    if (path.closed) {
        parts = mergeDxfSecondaryClosedPathParts(parts, plan.tolerance);
    }
    var normalizedParts = [];
    for (var partIndex = 0; partIndex < parts.length; partIndex++) {
        var normalized = normalizeDxfSecondaryPathPart(
            parts[partIndex], plan.tolerance
        );
        if (normalized.length < 2) {
            continue;
        }
        var shouldClose = false;
        if (path.closed) {
            if (getDxfPointDistance(
                normalized[0], normalized[normalized.length - 1]
            ) <= plan.tolerance) {
                normalized.pop();
                shouldClose = normalized.length >= 3;
            } else if (isDxfSecondaryPointOnSegment(
                normalized[0], plan.bridgeStart, plan.bridgeEnd, plan.tolerance
            ) && isDxfSecondaryPointOnSegment(
                normalized[normalized.length - 1],
                plan.bridgeStart,
                plan.bridgeEnd,
                plan.tolerance
            )) {
                shouldClose = normalized.length >= 2;
            }
        }
        if (normalized.length >= 2) {
            normalizedParts.push({ points: normalized, closed: shouldClose });
        }
    }
    return { changed: true, parts: normalizedParts };
}

function isDxfSecondarySourceAnchor(plan, item) {
    for (var anchorIndex = 0; anchorIndex < plan.sourceAnchors.length; anchorIndex++) {
        if (plan.sourceAnchors[anchorIndex].item === item) {
            return true;
        }
    }
    return false;
}

function isDxfSecondaryItemInsideRegion(item, plan) {
    var bounds = null;
    try {
        bounds = item.visibleBounds;
    } catch (visibleBoundsError) {
        try {
            bounds = item.geometricBounds;
        } catch (geometricBoundsError) {
            return false;
        }
    }
    if (!bounds || bounds.length < 4) {
        return false;
    }
    var center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    if (item.typename === "RasterItem" || item.typename === "PlacedItem") {
        var corners = [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[1]],
            [bounds[2], bounds[3]],
            [bounds[0], bounds[3]]
        ];
        for (var cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
            if (!isDxfSecondaryPointInRemovedRegion(
                corners[cornerIndex], plan.removedPolygon, plan.tolerance
            )) {
                return false;
            }
        }
        return true;
    }
    return isDxfSecondaryPointInRemovedRegion(
        center, plan.removedPolygon, plan.tolerance
    );
}

function collectDxfSecondaryDirectChildren(container, collectGroups, result) {
    var itemCount = 0;
    try {
        itemCount = container.pageItems.length;
    } catch (collectionError) {
        return;
    }
    for (var itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        try {
            var item = container.pageItems[itemIndex];
            if (!item || item.parent !== container) {
                continue;
            }
            var itemType = item.typename;
            if ((itemType === "GroupItem") === collectGroups) {
                result.push(item);
            }
        } catch (itemError) {
            // 只读收集阶段跳过 Illustrator 返回的失效后代引用。
        }
    }
}

function processDxfSecondaryLiveItems(
    container, plan, preservedTag, statistics
) {
    var groups = [];
    collectDxfSecondaryDirectChildren(container, true, groups);
    for (var groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
        try {
            processDxfSecondaryLiveItems(
                groups[groupIndex], plan, preservedTag, statistics
            );
        } catch (groupTraversalError) {
            statistics.failedItems++;
        }
    }
    var leafItems = [];
    collectDxfSecondaryDirectChildren(container, false, leafItems);
    for (var itemIndex = leafItems.length - 1; itemIndex >= 0; itemIndex--) {
        try {
            var item = leafItems[itemIndex];
            if (!item || item === plan.outerPath || item === preservedTag) {
                continue;
            }
            var itemType = item.typename;
            if (itemType === "PathItem") {
                var primaryNote = getDxfPrimaryNoteLine(item.note);
                if (primaryNote === "AAMA_PIECE_CLIP_PATH" ||
                    primaryNote.indexOf("AAMA_ANCHOR_POINT|") === 0) {
                    continue;
                }
                var pathResult = applyDxfSecondaryPathCut(item, plan);
                statistics.removedItems += pathResult.removed;
                statistics.trimmedPaths += pathResult.trimmed;
                statistics.createdPathParts += pathResult.created;
                statistics.failedItems += pathResult.failed;
            } else if (isDxfSecondaryItemInsideRegion(item, plan)) {
                item.remove();
                statistics.removedItems++;
            }
        } catch (liveItemError) {
            statistics.failedItems++;
        }
    }
}

function removeDxfSecondaryLiveAnchors(container, plan, statistics) {
    var groups = [];
    collectDxfSecondaryDirectChildren(container, true, groups);
    for (var groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
        try {
            removeDxfSecondaryLiveAnchors(
                groups[groupIndex], plan, statistics
            );
        } catch (groupTraversalError) {
            statistics.failedItems++;
        }
    }
    var leafItems = [];
    collectDxfSecondaryDirectChildren(container, false, leafItems);
    for (var itemIndex = leafItems.length - 1; itemIndex >= 0; itemIndex--) {
        try {
            var item = leafItems[itemIndex];
            if (item.typename !== "PathItem" ||
                getDxfPrimaryNoteLine(item.note).indexOf(
                    "AAMA_ANCHOR_POINT|"
                ) !== 0) {
                continue;
            }
            if (item === plan.previousAnchor.item || item === plan.nextAnchor.item) {
                continue;
            }
            var anchorPoint = item.pathPoints.length > 0 ?
                item.pathPoints[0].anchor : null;
            if (isDxfSecondarySourceAnchor(plan, item) ||
                (anchorPoint && isDxfSecondaryPointInRemovedRegion(
                    [anchorPoint[0], anchorPoint[1]],
                    plan.removedPolygon,
                    plan.tolerance
                ))) {
                item.remove();
                statistics.removedItems++;
                statistics.removedAnchors++;
            }
        } catch (anchorError) {
            statistics.failedItems++;
        }
    }
}

function removeDxfSecondaryEmptyGroups(container, statistics) {
    var groups = [];
    collectDxfSecondaryDirectChildren(container, true, groups);
    for (var groupIndex = groups.length - 1; groupIndex >= 0; groupIndex--) {
        try {
            var item = groups[groupIndex];
            removeDxfSecondaryEmptyGroups(item, statistics);
            if (item.pageItems.length === 0) {
                item.remove();
                statistics.removedGroups++;
            }
        } catch (groupError) {
            // 删除子元素后失效的空编组无需再次处理。
        }
    }
}

function restoreDxfSecondaryPathGeometry(path, points, closed) {
    try {
        path.setEntirePath(points);
        path.closed = closed;
        return true;
    } catch (restoreError) {
        return false;
    }
}

function applyDxfSecondaryPathCut(path, plan) {
    var pathPointCount = 0;
    try {
        pathPointCount = path.pathPoints.length;
    } catch (pathReadError) {
        return { removed: 0, trimmed: 0, created: 0, failed: 1 };
    }
    if (pathPointCount === 0) {
        return { removed: 0, trimmed: 0, created: 0, failed: 0 };
    }
    if (pathPointCount === 1) {
        var point = path.pathPoints[0].anchor;
        if (isDxfSecondaryPointInRemovedRegion(
            [point[0], point[1]], plan.removedPolygon, plan.tolerance
        )) {
            try {
                path.remove();
                return { removed: 1, trimmed: 0, created: 0, failed: 0 };
            } catch (pointRemoveError) {
                return { removed: 0, trimmed: 0, created: 0, failed: 1 };
            }
        }
        return { removed: 0, trimmed: 0, created: 0, failed: 0 };
    }
    var originalPoints = getDxfPathAnchors(path);
    var originalClosed = path.closed;
    var clipped = null;
    try {
        clipped = getDxfSecondaryOutsidePathParts(path, plan);
    } catch (clipCalculationError) {
        return { removed: 0, trimmed: 0, created: 0, failed: 1 };
    }
    if (!clipped.changed) {
        return { removed: 0, trimmed: 0, created: 0, failed: 0 };
    }
    if (clipped.parts.length === 0) {
        try {
            path.remove();
            return { removed: 1, trimmed: 0, created: 0, failed: 0 };
        } catch (pathRemoveError) {
            return { removed: 0, trimmed: 0, created: 0, failed: 1 };
        }
    }
    var targets = [path];
    var duplicates = [];
    try {
        for (var partIndex = 1; partIndex < clipped.parts.length; partIndex++) {
            var duplicate = path.duplicate(
                path.parent, ElementPlacement.PLACEATEND
            );
            duplicates.push(duplicate);
            targets.push(duplicate);
        }
    } catch (duplicateError) {
        for (var duplicateIndex = duplicates.length - 1; duplicateIndex >= 0;
            duplicateIndex--) {
            try {
                duplicates[duplicateIndex].remove();
            } catch (duplicateRemoveError) {
                // 失效副本无需继续处理。
            }
        }
        return { removed: 0, trimmed: 0, created: 0, failed: 1 };
    }
    var originalElementId = getDxfElementId(path);
    try {
        for (var targetIndex = 0; targetIndex < targets.length; targetIndex++) {
            targets[targetIndex].setEntirePath(clipped.parts[targetIndex].points);
            targets[targetIndex].closed = clipped.parts[targetIndex].closed;
            if (targetIndex > 0 && originalElementId) {
                setDxfMetadataValue(
                    targets[targetIndex],
                    "AAMA_ELEMENT",
                    originalElementId + "|secondary-cut:" + (targetIndex + 1)
                );
            }
        }
    } catch (pathWriteError) {
        restoreDxfSecondaryPathGeometry(path, originalPoints, originalClosed);
        for (var failedDuplicateIndex = duplicates.length - 1;
            failedDuplicateIndex >= 0; failedDuplicateIndex--) {
            try {
                duplicates[failedDuplicateIndex].remove();
            } catch (failedDuplicateRemoveError) {
                // 失效副本无需继续处理。
            }
        }
        return { removed: 0, trimmed: 0, created: 0, failed: 1 };
    }
    return {
        removed: 0,
        trimmed: 1,
        created: Math.max(0, targets.length - 1),
        failed: 0
    };
}

function updateDxfSecondaryClipPathInPlace(pieceGroup, plan) {
    var clipPath = findDxfPieceClipPath(pieceGroup);
    var createdClipPath = false;
    var originalPoints = null;
    var originalClosed = true;
    var originalClipping = true;
    var originalGroupClipped = false;
    try {
        originalGroupClipped = pieceGroup.clipped === true;
    } catch (groupStateError) {
        originalGroupClipped = false;
    }
    if (clipPath !== null) {
        originalPoints = getDxfPathAnchors(clipPath);
        originalClosed = clipPath.closed;
        originalClipping = clipPath.clipping;
    }
    try {
        if (clipPath === null) {
            clipPath = plan.outerPath.duplicate(
                pieceGroup, ElementPlacement.PLACEATBEGINNING
            );
            createdClipPath = true;
        }
        clipPath.setEntirePath(plan.retainedPoints);
        clipPath.closed = true;
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
        try {
            clipPath.zOrder(ZOrderMethod.BRINGTOFRONT);
        } catch (clipOrderError) {
            // 已有剪切路径通常已经位于编组顶部，无需因层级 API 失败中断。
        }
        try {
            pieceGroup.clipped = true;
        } catch (groupClipError) {
            if (!originalGroupClipped) {
                throw groupClipError;
            }
        }
        setDxfMetadataValue(pieceGroup, "AAMA_PIECE_CLIP_BOUNDARY", "outer");
        return clipPath;
    } catch (clipUpdateError) {
        if (createdClipPath && clipPath !== null) {
            try {
                clipPath.remove();
            } catch (createdClipRemoveError) {
                // 创建失败的剪切路径可能已经失效。
            }
        } else if (clipPath !== null && originalPoints !== null) {
            restoreDxfSecondaryPathGeometry(
                clipPath, originalPoints, originalClosed
            );
            try {
                clipPath.clipping = originalClipping;
            } catch (clipStateRestoreError) {
                // 后续仍会恢复裁片编组状态。
            }
        }
        try {
            pieceGroup.clipped = originalGroupClipped;
        } catch (groupStateRestoreError) {
            // 返回失败，由调用方停止本裁片处理。
        }
        return null;
    }
}

function applyDxfSecondaryRegionCut(pieceGroup, plan, preservedTag) {
    var statistics = {
        removedItems: 0,
        trimmedPaths: 0,
        createdPathParts: 0,
        removedAnchors: 0,
        removedGroups: 0,
        rebuiltClipPaths: 0,
        failedItems: 0
    };
    var originalOuterPoints = getDxfPathAnchors(plan.outerPath);
    var originalOuterClosed = plan.outerPath.closed;
    if (!setDxfSecondaryCutRecord(pieceGroup, plan)) {
        throw new Error("无法记录二号尺码标区域裁切结果");
    }
    try {
        plan.outerPath.setEntirePath(plan.retainedPoints);
        plan.outerPath.closed = true;
        setDxfMetadataValue(plan.outerPath, "AAMA_SECONDARY_STITCH", "1");
    } catch (outerPathError) {
        setDxfMetadataValue(pieceGroup, "AAMA_SECONDARY_CUT", "");
        setDxfMetadataValue(plan.outerPath, "AAMA_SECONDARY_STITCH", "");
        restoreDxfSecondaryPathGeometry(
            plan.outerPath, originalOuterPoints, originalOuterClosed
        );
        throw new Error("外线缝合失败: " + outerPathError.message);
    }
    var rebuiltClipPath = updateDxfSecondaryClipPathInPlace(pieceGroup, plan);
    if (rebuiltClipPath === null) {
        setDxfMetadataValue(pieceGroup, "AAMA_SECONDARY_CUT", "");
        setDxfMetadataValue(plan.outerPath, "AAMA_SECONDARY_STITCH", "");
        restoreDxfSecondaryPathGeometry(
            plan.outerPath, originalOuterPoints, originalOuterClosed
        );
        throw new Error("无法原位更新裁片剪切路径");
    }
    statistics.rebuiltClipPaths++;
    processDxfSecondaryLiveItems(
        pieceGroup, plan, preservedTag, statistics
    );
    removeDxfSecondaryLiveAnchors(pieceGroup, plan, statistics);
    removeDxfSecondaryEmptyGroups(pieceGroup, statistics);
    return statistics;
}

function ensureDxfSecondarySizeTagSample(
    layer, doc, labelX, startX, sizeTagY, pointScale, millimeterScale, defaultSample
) {
    var secondaryY = sizeTagY - 8 * millimeterScale;
    getOrCreateDxfParameterText(
        layer,
        "AAMA_SECONDARY_SIZE_TAG_LABEL",
        "二号尺码标",
        "二号尺码标说明",
        [labelX, secondaryY + 3 * pointScale],
        9 * pointScale
    );
    var sample = findDxfTextFrameByNotePrefix(
        layer, "AAMA_SECONDARY_SIZE_TAG_SAMPLE"
    );
    var shouldApplyDefault = sample === null ||
        String(sample.note || "") !== "AAMA_SECONDARY_SIZE_TAG_SAMPLE|DEFAULT_V1";
    if (sample === null) {
        sample = layer.textFrames.add();
    }
    sample.contents = "XSML";
    sample.name = "二号尺码标样例";
    sample.position = [startX, secondaryY + 3 * pointScale];
    sample.hidden = false;
    if (shouldApplyDefault) {
        if (defaultSample !== null) {
            copyDxfTextStyle(defaultSample, sample);
            try {
                sample.textRange.characterAttributes.size =
                    defaultSample.textRange.characterAttributes.size * 3;
            } catch (sampleSizeError) {
                applyDxfDefaultSizeTagStyle(sample, doc);
                sample.textRange.characterAttributes.size = 42 * pointScale;
            }
        } else {
            applyDxfDefaultSizeTagStyle(sample, doc);
            sample.textRange.characterAttributes.size = 42 * pointScale;
        }
    }
    sample.note = "AAMA_SECONDARY_SIZE_TAG_SAMPLE|DEFAULT_V1";
    return sample;
}

function findDxfPieceSecondarySizeTags(pieceGroup) {
    var tags = [];
    var textCount = 0;
    try {
        textCount = pieceGroup.textFrames.length;
    } catch (textCollectionError) {
        return tags;
    }
    for (var textIndex = 0; textIndex < textCount; textIndex++) {
        try {
            var text = pieceGroup.textFrames[textIndex];
            if (text && text.parent === pieceGroup &&
                getDxfPrimaryNoteLine(text.note).indexOf(
                    "AAMA_SECONDARY_SIZE_TAG|"
                ) === 0) {
                tags.push(text);
            }
        } catch (invalidTextError) {
            // 忽略Illustrator文字集合中的失效引用。
        }
    }
    return tags;
}

function findDxfPieceSecondarySizeTag(pieceGroup) {
    var tags = findDxfPieceSecondarySizeTags(pieceGroup);
    var expectedId = getDxfPieceStableId(pieceGroup) + "|secondary-size-tag";
    for (var tagIndex = 0; tagIndex < tags.length; tagIndex++) {
        if (getDxfElementId(tags[tagIndex]) === expectedId) {
            return tags[tagIndex];
        }
    }
    return tags.length > 0 ? tags[0] : null;
}

function removeDxfExtraSecondarySizeTags(pieceGroup, keepTag) {
    var tags = findDxfPieceSecondarySizeTags(pieceGroup);
    var removedCount = 0;
    for (var tagIndex = tags.length - 1; tagIndex >= 0; tagIndex--) {
        if (tags[tagIndex] !== keepTag) {
            tags[tagIndex].remove();
            removedCount++;
        }
    }
    return removedCount;
}

function applyDxfSecondarySizeTagMeasurements(sizeTag, pieceGroup, settings) {
    var attributes = sizeTag.textRange.characterAttributes;
    attributes.size = settings.heightMm * getDxfMillimeterToDocumentUnits(pieceGroup);
    try {
        attributes.strokeWeight = 0;
        attributes.strokeColor = new NoColor();
    } catch (strokeColorError) {
        // 保持参数样例的无描边状态。
    }
}

function positionDxfSecondarySizeTagAtCenter(sizeTag, targetCenter) {
    for (var attempt = 0; attempt < 2; attempt++) {
        var bounds = getDxfSizeTagVisibleBounds(sizeTag);
        if (bounds === null) {
            return false;
        }
        var currentCenter = [
            (bounds[0] + bounds[2]) / 2,
            (bounds[1] + bounds[3]) / 2
        ];
        sizeTag.translate(
            targetCenter[0] - currentCenter[0],
            targetCenter[1] - currentCenter[1]
        );
    }
    return true;
}

function getDxfSecondaryVisibleLabelCenter(pieceGroup, sizeTag, match) {
    var bridgeStart = match.bridgeStart;
    var bridgeEnd = match.bridgeEnd;
    if (!bridgeStart || !bridgeEnd) {
        return match.center;
    }
    var bridgeX = bridgeEnd[0] - bridgeStart[0];
    var bridgeY = bridgeEnd[1] - bridgeStart[1];
    var bridgeLength = Math.sqrt(bridgeX * bridgeX + bridgeY * bridgeY);
    if (bridgeLength <= 0.000001) {
        return match.center;
    }
    var normalX = -bridgeY / bridgeLength;
    var normalY = bridgeX / bridgeLength;
    var boundary = findDxfSecondaryBoundaryPath(pieceGroup, match.boundaryId);
    var selectedCross = 0;
    if (boundary !== null) {
        var boundaryPoints = getDxfPathAnchors(boundary);
        for (var pointIndex = 0; pointIndex < boundaryPoints.length; pointIndex++) {
            var relativeX = boundaryPoints[pointIndex][0] - bridgeStart[0];
            var relativeY = boundaryPoints[pointIndex][1] - bridgeStart[1];
            var cross = bridgeX * relativeY - bridgeY * relativeX;
            if (Math.abs(cross) > Math.abs(selectedCross)) {
                selectedCross = cross;
            }
        }
    }
    if (selectedCross < 0) {
        normalX = -normalX;
        normalY = -normalY;
    }
    var bounds = getDxfSizeTagVisibleBounds(sizeTag);
    if (bounds === null) {
        return match.center;
    }
    var halfWidth = Math.abs(bounds[2] - bounds[0]) / 2;
    var halfHeight = Math.abs(bounds[1] - bounds[3]) / 2;
    var projectedHalfExtent = Math.abs(normalX) * halfWidth +
        Math.abs(normalY) * halfHeight;
    var margin = 0.2 * getDxfMillimeterToDocumentUnits(pieceGroup);
    var midpoint = [
        (bridgeStart[0] + bridgeEnd[0]) / 2,
        (bridgeStart[1] + bridgeEnd[1]) / 2
    ];
    return [
        midpoint[0] + normalX * (projectedHalfExtent + margin),
        midpoint[1] + normalY * (projectedHalfExtent + margin)
    ];
}

function getOrCreateDxfSecondarySizeTagSample(doc) {
    var parameterLayer = findDxfLayerByName(doc, "LanTu_参数样例");
    var sample = parameterLayer !== null ? findDxfTextFrameByNotePrefix(
        parameterLayer, "AAMA_SECONDARY_SIZE_TAG_SAMPLE"
    ) : null;
    if (sample !== null) {
        return sample;
    }
    var activeArtboardIndex = doc.artboards.getActiveArtboardIndex();
    createDxfStyleHintLayer(
        doc, doc.artboards[activeArtboardIndex].artboardRect, doc.activeLayer
    );
    parameterLayer = findDxfLayerByName(doc, "LanTu_参数样例");
    return parameterLayer !== null ? findDxfTextFrameByNotePrefix(
        parameterLayer, "AAMA_SECONDARY_SIZE_TAG_SAMPLE"
    ) : null;
}

function labelDxfSecondarySizeGroups(sizeGroups, sample, settings) {
    var result = {
        pieceCount: 0,
        labeledCount: 0,
        cutCount: 0,
        reusedCutCount: 0,
        missingPatternCount: 0,
        ambiguousPatternCount: 0,
        topologyFailedCount: 0,
        placementFailedCount: 0,
        removedExtraCount: 0,
        removedItemCount: 0,
        trimmedPathCount: 0,
        removedAnchorCount: 0,
        removedGroupCount: 0,
        rebuiltClipPathCount: 0,
        failedItemCount: 0,
        failureMessages: []
    };
    for (var sizeIndex = 0; sizeIndex < sizeGroups.length; sizeIndex++) {
        var sizeName = getDxfSizeNameFromGroup(sizeGroups[sizeIndex]);
        var pieces = [];
        collectDxfPieceGroups(sizeGroups[sizeIndex], pieces);
        for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
            var pieceGroup = pieces[pieceIndex];
            var regionResult = findDxfSecondarySizeTagRegion(pieceGroup);
            result.pieceCount++;
            if (regionResult.ambiguous) {
                result.ambiguousPatternCount++;
                continue;
            }
            if (regionResult.match === null) {
                result.missingPatternCount++;
                continue;
            }
            var sizeTag = findDxfPieceSecondarySizeTag(pieceGroup);
            if (!regionResult.match.processed) {
                var cutPlan = createDxfSecondaryCutPlan(
                    pieceGroup, regionResult.match
                );
                if (cutPlan === null) {
                    result.topologyFailedCount++;
                    if (result.failureMessages.length < 5) {
                        result.failureMessages.push(
                            String(pieceGroup.name || "未命名裁片") +
                            ": 无法把前后锚点映射到外线路径"
                        );
                    }
                    continue;
                }
                try {
                    var cutResult = applyDxfSecondaryRegionCut(
                        pieceGroup, cutPlan, sizeTag
                    );
                    result.cutCount++;
                    result.removedItemCount += cutResult.removedItems;
                    result.trimmedPathCount += cutResult.trimmedPaths;
                    result.removedAnchorCount += cutResult.removedAnchors;
                    result.removedGroupCount += cutResult.removedGroups;
                    result.rebuiltClipPathCount += cutResult.rebuiltClipPaths;
                    result.failedItemCount += cutResult.failedItems;
                    regionResult.match.processed = true;
                    regionResult.match.center = cutPlan.center;
                    regionResult.match.bridgeStart = cutPlan.bridgeStart;
                    regionResult.match.bridgeEnd = cutPlan.bridgeEnd;
                    regionResult.match.previousOrdinal = cutPlan.previousOrdinal;
                    regionResult.match.nextOrdinal = cutPlan.nextOrdinal;
                    regionResult.match.sourceOrdinals = cutPlan.sourceOrdinals;
                } catch (cutError) {
                    result.topologyFailedCount++;
                    if (result.failureMessages.length < 5) {
                        result.failureMessages.push(
                            String(pieceGroup.name || "未命名裁片") +
                            ": " + cutError.message
                        );
                    }
                    continue;
                }
            } else {
                result.reusedCutCount++;
            }
            try {
                if (sizeTag === null) {
                    sizeTag = pieceGroup.textFrames.add();
                }
                result.removedExtraCount += removeDxfExtraSecondarySizeTags(
                    pieceGroup, sizeTag
                );
                sizeTag.contents = settings.orderCode ?
                    settings.orderCode + "-" + sizeName : sizeName;
                sizeTag.name = "二号尺码标";
                copyDxfTextStyle(sample, sizeTag);
                applyDxfSecondarySizeTagMeasurements(sizeTag, pieceGroup, settings);
                var visibleLabelCenter = getDxfSecondaryVisibleLabelCenter(
                    pieceGroup, sizeTag, regionResult.match
                );
                if (!positionDxfSecondarySizeTagAtCenter(
                    sizeTag, visibleLabelCenter
                )) {
                    result.placementFailedCount++;
                }
                var anchorOrdinals = regionResult.match.sourceOrdinals || [];
                sizeTag.note = "AAMA_SECONDARY_SIZE_TAG|BOUNDARY|" +
                    regionResult.match.boundaryId +
                    "|BRIDGE|" + regionResult.match.previousOrdinal + "," +
                    regionResult.match.nextOrdinal +
                    "|REMOVED_ANCHORS|" + anchorOrdinals.join(",");
                setDxfMetadataValue(
                    sizeTag,
                    "AAMA_ELEMENT",
                    getDxfPieceStableId(pieceGroup) + "|secondary-size-tag"
                );
                setDxfMetadataValue(sizeTag, "AAMA_FIXED_SIZE", "1");
                try {
                    sizeTag.zOrder(ZOrderMethod.BRINGTOFRONT);
                    var clipPath = findDxfPieceClipPath(pieceGroup);
                    if (clipPath !== null) {
                        clipPath.zOrder(ZOrderMethod.BRINGTOFRONT);
                    }
                } catch (orderError) {
                    // 层级不影响二号尺码标的识别和坐标。
                }
                result.labeledCount++;
            } catch (labelError) {
                result.placementFailedCount++;
                if (result.failureMessages.length < 5) {
                    result.failureMessages.push(
                        String(pieceGroup.name || "未命名裁片") +
                        ": 二号尺码标生成失败: " + labelError.message
                    );
                }
            }
        }
    }
    return result;
}

function labelDxfSecondaryPieceSizes(orderCode, heightMm) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的Illustrator文档。";
        }
        var doc = app.activeDocument;
        var sample = getOrCreateDxfSecondarySizeTagSample(doc);
        if (sample === null) {
            return "参数样例区没有找到二号尺码标样例。";
        }
        var settings = createDxfSecondarySizeTagSettings(orderCode, heightMm);
        var sizeGroups = collectDxfInheritanceSizeGroups(doc);
        var result = labelDxfSecondarySizeGroups(sizeGroups, sample, settings);
        return "二号尺码标记完成！\n" +
            "订单编码: " + (settings.orderCode || "未填写") + "\n" +
            "码标高度: " + settings.heightMm + "mm\n" +
            "已处理裁片: " + result.pieceCount + " 个\n" +
            "已完成区域裁切缝合: " + result.cutCount + " 个\n" +
            "已存在裁切记录并复用: " + result.reusedCutCount + " 个\n" +
            "已更新/生成二号尺码标: " + result.labeledCount + " 个\n" +
            "未识别连续七点结构: " + result.missingPatternCount + " 个\n" +
            "存在多个候选而跳过: " + result.ambiguousPatternCount + " 个\n" +
            "区域拓扑处理失败: " + result.topologyFailedCount + " 个\n" +
            "已删除区域元素: " + result.removedItemCount + " 个\n" +
            "已裁切/缝合路径: " + result.trimmedPathCount + " 条\n" +
            "已删除区域锚点: " + result.removedAnchorCount + " 个\n" +
            "已清理空编组: " + result.removedGroupCount + " 个\n" +
            "已重建裁剪路径: " + result.rebuiltClipPathCount + " 个\n" +
            "单元素裁切失败并由剪切路径兜底: " + result.failedItemCount + " 个\n" +
            "定位失败: " + result.placementFailedCount + " 个\n" +
            "已清理多余二号尺码标: " + result.removedExtraCount + " 个。" +
            (result.failureMessages.length > 0 ?
                "\n失败明细:\n" + result.failureMessages.join("\n") : "");
    } catch (error) {
        return "二号尺码标记失败: " + error.message + "（行号: " + error.line + "）";
    }
}
