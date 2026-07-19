// 工艺线语义、刀口绘制与刀口替换

function isAamaTechlineShape(shape) {
    // ANSI/AAMA layer 8 stores internal construction/technical lines.
    return shape && shape.kind !== "notch" && String(shape.dxfLayer) === "8";
}

function getOrCreateDxfTechlineGroup(pieceGroup, techlineGroups, shape) {
    var sizeName = shape.sizeName || "未知尺码";
    var groupKey = "techline|size:" + sizeName + "|" + (shape.pieceKey || "entities");
    if (techlineGroups[groupKey]) {
        return techlineGroups[groupKey];
    }

    var group = pieceGroup.groupItems.add();
    group.name = "工艺线组";
    group.note = "AAMA_TECHLINE|" + groupKey;
    techlineGroups[groupKey] = group;
    return group;
}

function isAamaDxfBoundaryShape(shape) {
    return shape && String(shape.dxfLayer) === "1";
}

function getAamaDxfBoundaryPathId(shape) {
    var sourceIndex = shape.sourceEntityIndex;
    if (sourceIndex === undefined || sourceIndex === null) {
        sourceIndex = "unknown";
    }
    return String(sourceIndex) + "-copy-" + (shape.pieceCopyIndex || 0);
}

function drawDxfNotchMarker(
    pieceGroup, notchingGroup, shape, bounds, artboard, scale, margin, notchStyle
) {
    if (shape.skipNotch === true ||
        (shape.notchBoundaryLayer && shape.notchBoundaryLayer !== "1")) {
        return false;
    }
    var anchor = transformDxfPoint(shape.points[0], bounds, artboard, scale, margin);
    var directionPoint = transformDxfPoint(shape.points[1], bounds, artboard, scale, margin);
    var directionX = directionPoint[0] - anchor[0];
    var directionY = directionPoint[1] - anchor[1];
    var directionLength = Math.sqrt(directionX * directionX + directionY * directionY);

    if (directionLength === 0) {
        return false;
    }

    directionX /= directionLength;
    directionY /= directionLength;
    var boundaryTarget = findDxfNotchTargetSegment(
        pieceGroup,
        anchor[0],
        anchor[1],
        directionX,
        directionY,
        scale
    );
    if (boundaryTarget !== null) {
        anchor = boundaryTarget.anchorPoint;
    }
    var insideDirection = resolveDxfNotchInteriorDirection(
        pieceGroup,
        anchor[0],
        anchor[1],
        directionX,
        directionY,
        boundaryTarget
    );

    var notchGroup = notchingGroup.groupItems.add();
    notchGroup.name = getDxfShapeElementName("刀口", shape);
    setDxfMetadataValue(notchGroup, "AAMA_ELEMENT", shape.elementId || "");
    addDxfNotchLocator(
        notchGroup,
        anchor[0],
        anchor[1],
        insideDirection.directionX,
        insideDirection.directionY
    );
    renderDxfNotchStyle(
        pieceGroup,
        notchGroup,
        anchor[0],
        anchor[1],
        insideDirection.directionX,
        insideDirection.directionY,
        notchStyle,
        boundaryTarget
    );
    return true;
}

function drawDxfNotchStyle(parentGroup, anchorX, anchorY, directionX, directionY, notchStyle) {
    var millimeterScale = getDxfMillimeterToDocumentUnits(parentGroup);
    var notchLength = 5 * millimeterScale;
    var notchHalfWidth = 1.5 * millimeterScale;
    var normalX = -directionY;
    var normalY = directionX;
    var innerX = anchorX + directionX * notchLength;
    var innerY = anchorY + directionY * notchLength;
    var outerX = anchorX - directionX * notchLength;
    var outerY = anchorY - directionY * notchLength;
    var baseStartX = anchorX - normalX * notchHalfWidth;
    var baseStartY = anchorY - normalY * notchHalfWidth;
    var baseEndX = anchorX + normalX * notchHalfWidth;
    var baseEndY = anchorY + normalY * notchHalfWidth;

    notchStyle = normalizeDxfNotchStyle(notchStyle);

    if (notchStyle === "t") {
        addDxfNotchPath(parentGroup, [[anchorX, anchorY], [innerX, innerY]]);
        addDxfNotchPath(parentGroup, [
            [innerX - normalX * notchHalfWidth, innerY - normalY * notchHalfWidth],
            [innerX + normalX * notchHalfWidth, innerY + normalY * notchHalfWidth]
        ]);
    } else if (notchStyle === "v-in") {
        addDxfNotchPath(parentGroup, [
            [baseStartX, baseStartY],
            [innerX, innerY]
        ]);
        addDxfNotchPath(parentGroup, [
            [innerX, innerY],
            [baseEndX, baseEndY]
        ]);
    } else if (notchStyle === "v-out") {
        addDxfNotchPath(parentGroup, [
            [baseStartX, baseStartY],
            [outerX, outerY]
        ]);
        addDxfNotchPath(parentGroup, [
            [outerX, outerY],
            [baseEndX, baseEndY]
        ]);
    } else {
        addDxfNotchPath(parentGroup, [[anchorX, anchorY], [innerX, innerY]]);
    }
}

function addDxfNotchPath(parentGroup, points) {
    var path = parentGroup.pathItems.add();
    path.name = "刀口";
    path.setEntirePath(points);
    path.closed = false;
    applyDxfDefaultStrokeStyle(path, "notching", parentGroup);
}

function renderDxfNotchStyle(
    pieceGroup, notchGroup, anchorX, anchorY, directionX, directionY,
    notchStyle, resolvedTarget
) {
    notchStyle = normalizeDxfNotchStyle(notchStyle);
    var targetPathId = "";

    if (notchStyle === "v-in" || notchStyle === "v-out") {
        targetPathId = applyDxfNotchCut(
            pieceGroup,
            anchorX,
            anchorY,
            directionX,
            directionY,
            notchStyle,
            resolvedTarget
        );
    } else {
        ensureDxfNotchBoundaryAnchor(
            pieceGroup, anchorX, anchorY, directionX, directionY, resolvedTarget
        );
    }

    // 找不到可切开的裁片边线时仍绘制 V 形，保证刀口不会消失。
    if (targetPathId === "") {
        drawDxfNotchStyle(notchGroup, anchorX, anchorY, directionX, directionY, notchStyle);
    }
    updateDxfNotchMetadata(
        notchGroup,
        anchorX,
        anchorY,
        directionX,
        directionY,
        notchStyle,
        targetPathId
    );
    assignDxfNotchChildIds(notchGroup);
}

function assignDxfNotchChildIds(notchGroup) {
    var notchElementId = getDxfElementId(notchGroup);
    if (!notchElementId) {
        return;
    }
    var partIndex = 0;
    for (var itemIndex = 0; itemIndex < notchGroup.pageItems.length; itemIndex++) {
        var item = notchGroup.pageItems[itemIndex];
        if (item.parent !== notchGroup) {
            continue;
        }
        if (getDxfPrimaryNoteLine(item.note) === "AAMA_NOTCH_LOCATOR") {
            setDxfMetadataValue(item, "AAMA_ELEMENT", notchElementId + "|locator");
            continue;
        }
        partIndex++;
        item.name = "刀口线_元素" + formatDxfElementNumber(partIndex);
        setDxfMetadataValue(item, "AAMA_ELEMENT", notchElementId + "|part:" + partIndex);
    }
}

function getDxfNotchVGeometry(
    anchorX, anchorY, directionX, directionY, notchStyle, millimeterScale
) {
    var halfWidth = 1.5 * millimeterScale;
    var height = 5 * millimeterScale;
    var normalX = -directionY;
    var normalY = directionX;
    var apexDirection = notchStyle === "v-out" ? -1 : 1;
    return {
        baseStart: [anchorX - normalX * halfWidth, anchorY - normalY * halfWidth],
        baseEnd: [anchorX + normalX * halfWidth, anchorY + normalY * halfWidth],
        apex: [
            anchorX + directionX * height * apexDirection,
            anchorY + directionY * height * apexDirection
        ]
    };
}

function applyDxfNotchCut(
    pieceGroup, anchorX, anchorY, directionX, directionY, notchStyle, resolvedTarget
) {
    var target = resolvedTarget || findDxfNotchTargetSegment(
        pieceGroup, anchorX, anchorY, directionX, directionY
    );
    if (target === null) {
        return "";
    }
    if (target.pathId === "") {
        tagLegacyDxfBoundaryPaths(pieceGroup);
        target.pathId = getAamaDxfBoundaryPathIdFromPath(target.path);
    }

    var geometry = getDxfNotchVGeometry(
        anchorX,
        anchorY,
        directionX,
        directionY,
        notchStyle,
        getDxfMillimeterToDocumentUnits(pieceGroup)
    );
    replaceDxfPathSegmentWithV(target.path, target, geometry);
    return target.pathId;
}

function ensureDxfNotchBoundaryAnchor(
    pieceGroup, anchorX, anchorY, directionX, directionY, resolvedTarget
) {
    var target = resolvedTarget || findDxfNotchTargetSegment(
        pieceGroup, anchorX, anchorY, directionX, directionY
    );
    if (target === null || target.anchorIsVertex) {
        return;
    }

    var path = target.path;
    var points = getDxfPathAnchors(path);
    var newPoints = [];
    for (var i = 0; i <= target.centerSegmentIndex; i++) {
        newPoints.push(points[i]);
    }
    newPoints.push(target.anchorPoint);
    for (var nextIndex = target.centerSegmentIndex + 1; nextIndex < points.length; nextIndex++) {
        newPoints.push(points[nextIndex]);
    }
    path.setEntirePath(newPoints);
    path.closed = target.closed;
}

function replaceDxfPathSegmentWithV(path, target, geometry) {
    var points = getDxfPathAnchors(path);
    var newPoints = [];
    var i;

    if (target.wraps) {
        // 切口跨过闭合路径的首尾点时，旋转路径起点，保持切口三点连续。
        for (i = target.endSegmentIndex + 1; i <= target.startSegmentIndex; i++) {
            newPoints.push(points[i]);
        }
        newPoints.push(target.baseStart);
        newPoints.push(geometry.apex);
        newPoints.push(target.baseEnd);
    } else {
        for (i = 0; i <= target.startSegmentIndex; i++) {
            newPoints.push(points[i]);
        }
        newPoints.push(target.baseStart);
        newPoints.push(geometry.apex);
        newPoints.push(target.baseEnd);
        for (i = target.endSegmentIndex + 1; i < points.length; i++) {
            newPoints.push(points[i]);
        }
    }

    path.setEntirePath(newPoints);
    path.closed = target.closed;
}

function findDxfNotchTargetSegment(pieceGroup, anchorX, anchorY, directionX, directionY, maximumDistance) {
    var paths = getDxfBoundaryPaths(pieceGroup);
    var best = null;
    var millimeterScale = getDxfMillimeterToDocumentUnits(pieceGroup);
    var halfWidth = 1.5 * millimeterScale;

    for (var pathIndex = 0; pathIndex < paths.length; pathIndex++) {
        var path = paths[pathIndex];
        var points = getDxfPathAnchors(path);
        if (points.length < 2) {
            continue;
        }

        var segmentCount = path.closed ? points.length : points.length - 1;
        for (var pointIndex = 0; pointIndex < segmentCount; pointIndex++) {
            var nextIndex = (pointIndex + 1) % points.length;
            var start = points[pointIndex];
            var end = points[nextIndex];
            var segmentX = end[0] - start[0];
            var segmentY = end[1] - start[1];
            var segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
            if (segmentLengthSquared === 0) {
                continue;
            }

            var projection = ((anchorX - start[0]) * segmentX + (anchorY - start[1]) * segmentY) /
                segmentLengthSquared;
            if (projection < 0) {
                projection = 0;
            } else if (projection > 1) {
                projection = 1;
            }

            var closestX = start[0] + segmentX * projection;
            var closestY = start[1] + segmentY * projection;
            var distanceX = anchorX - closestX;
            var distanceY = anchorY - closestY;
            var distanceSquared = distanceX * distanceX + distanceY * distanceY;
            if (best !== null && distanceSquared >= best.distanceSquared) {
                continue;
            }
            best = {
                path: path,
                points: points,
                pathId: getAamaDxfBoundaryPathIdFromPath(path),
                centerSegmentIndex: pointIndex,
                closed: path.closed,
                distanceSquared: distanceSquared,
                anchorPoint: [closestX, closestY],
                anchorIsVertex: projection < 0.000001 || projection > 0.999999,
                projection: projection
            };
        }
    }

    if (maximumDistance === undefined || maximumDistance === null) {
        maximumDistance = millimeterScale;
    }
    // 已在基码标记为外线刀口的点允许放码后重新吸附；旧对象仍保持 1mm 安全范围。
    if (best === null || best.distanceSquared > maximumDistance * maximumDistance) {
        return null;
    }
    var baseStart = getDxfPathOffsetPoint(
        best.points,
        best.closed,
        best.centerSegmentIndex,
        best.projection,
        -halfWidth
    );
    var baseEnd = getDxfPathOffsetPoint(
        best.points,
        best.closed,
        best.centerSegmentIndex,
        best.projection,
        halfWidth
    );
    if (baseStart === null || baseEnd === null) {
        return null;
    }
    best.distance = Math.sqrt(best.distanceSquared);
    best.startSegmentIndex = baseStart.segmentIndex;
    best.endSegmentIndex = baseEnd.segmentIndex;
    best.wraps = best.closed && baseStart.segmentIndex > baseEnd.segmentIndex;
    best.baseStart = baseStart.point;
    best.baseEnd = baseEnd.point;
    delete best.points;
    return best;
}

function getDxfPathOffsetPoint(points, closed, segmentIndex, projection, offset) {
    var direction = offset < 0 ? -1 : 1;
    var remaining = Math.abs(offset);
    var currentSegment = segmentIndex;
    var currentProjection = projection;
    var guard = 0;
    var maxSegments = points.length + 1;

    while (guard < maxSegments) {
        var nextIndex = (currentSegment + 1) % points.length;
        var start = points[currentSegment];
        var end = points[nextIndex];
        var segmentX = end[0] - start[0];
        var segmentY = end[1] - start[1];
        var segmentLength = Math.sqrt(segmentX * segmentX + segmentY * segmentY);
        if (segmentLength > 0) {
            var available = direction > 0 ?
                (1 - currentProjection) * segmentLength : currentProjection * segmentLength;
            if (remaining <= available) {
                var projectionDelta = remaining / segmentLength * direction;
                var resultProjection = currentProjection + projectionDelta;
                return {
                    segmentIndex: currentSegment,
                    point: [
                        start[0] + segmentX * resultProjection,
                        start[1] + segmentY * resultProjection
                    ]
                };
            }
            remaining -= available;
        }

        if (direction > 0) {
            currentSegment++;
            if (!closed && currentSegment >= points.length - 1) {
                return null;
            }
            if (closed && currentSegment >= points.length) {
                currentSegment = 0;
            }
            currentProjection = 0;
        } else {
            currentSegment--;
            if (currentSegment < 0) {
                if (!closed) {
                    return null;
                }
                currentSegment = points.length - 1;
            }
            currentProjection = 1;
        }
        guard++;
    }
    return null;
}

function collectDxfBoundaryPathsRecursively(container, taggedPaths, semanticPaths) {
    for (var itemIndex = 0; itemIndex < container.pageItems.length; itemIndex++) {
        var item = container.pageItems[itemIndex];
        var itemType = "";
        try {
            if (!item || item.parent !== container) {
                continue;
            }
            itemType = item.typename;
        } catch (invalidItemError) {
            continue;
        }
        if (itemType === "PathItem") {
            var primaryNote = "";
            try {
                primaryNote = getDxfPrimaryNoteLine(item.note);
            } catch (noteReadError) {
                continue;
            }
            // 裁片剪切路径只是 Illustrator 的剪切定义，不是缝边实体；不能把它
            // 纳入边界检索或继续向上查找语义父级。
            if (primaryNote === "AAMA_PIECE_CLIP_PATH") {
                continue;
            }
            if (primaryNote.indexOf("AAMA_DXF_BOUNDARY|") === 0) {
                taggedPaths.push(item);
            } else if (getDxfSemanticRole(item) === "contour" ||
                (item.parent && getDxfPrimaryNoteLine(item.parent.note) ===
                    "AAMA_SEMANTIC_GROUP|outer-line")) {
                semanticPaths.push(item);
            }
        } else if (itemType === "GroupItem") {
            // 新结构的内外线都是裁片直属路径。仅为旧文档的“外线组”保留
            // 一层兼容递归，普通底图/Logo 编组绝不能参与边界识别。
            var groupRole = "";
            try {
                groupRole = getDxfPrimaryNoteLine(item.note);
            } catch (groupNoteError) {
                continue;
            }
            if (groupRole === "AAMA_SEMANTIC_GROUP|outer-line") {
                collectDxfBoundaryPathsRecursively(item, taggedPaths, semanticPaths);
            }
        }
    }
}

function getDxfBoundaryPaths(pieceGroup) {
    var taggedPaths = [];
    var semanticPaths = [];
    collectDxfBoundaryPathsRecursively(pieceGroup, taggedPaths, semanticPaths);
    return taggedPaths.length > 0 ? taggedPaths : semanticPaths;
}

function tagLegacyDxfBoundaryPaths(pieceGroup) {
    var taggedPaths = [];
    var paths = [];
    collectDxfBoundaryPathsRecursively(pieceGroup, taggedPaths, paths);
    var stamp = String(new Date().getTime());
    for (var i = 0; i < paths.length; i++) {
        if (getDxfPrimaryNoteLine(paths[i].note).indexOf("AAMA_DXF_BOUNDARY|") !== 0) {
            paths[i].note = "AAMA_DXF_BOUNDARY|legacy-" + stamp + "-" + i +
                (paths[i].note ? "\n" + paths[i].note : "");
        }
    }
}

function getAamaDxfBoundaryPathIdFromPath(path) {
    var prefix = "AAMA_DXF_BOUNDARY|";
    var primaryLine = getDxfPrimaryNoteLine(path.note);
    if (primaryLine.indexOf(prefix) === 0) {
        return primaryLine.substring(prefix.length);
    }
    return "";
}

function getDxfPathAnchors(path) {
    var points = [];
    for (var i = 0; i < path.pathPoints.length; i++) {
        points.push([path.pathPoints[i].anchor[0], path.pathPoints[i].anchor[1]]);
    }
    return points;
}

function resolveDxfNotchInteriorDirection(
    pieceGroup, anchorX, anchorY, directionX, directionY, resolvedTarget
) {
    var target = resolvedTarget || findDxfNotchTargetSegment(
        pieceGroup, anchorX, anchorY, directionX, directionY
    );
    if (target === null || !target.path.closed) {
        return { directionX: directionX, directionY: directionY };
    }

    var probe = getDxfMillimeterToDocumentUnits(pieceGroup);
    var forwardInside = isPointInsideDxfPath(
        anchorX + directionX * probe,
        anchorY + directionY * probe,
        target.path
    );
    var backwardInside = isPointInsideDxfPath(
        anchorX - directionX * probe,
        anchorY - directionY * probe,
        target.path
    );
    if (backwardInside && !forwardInside) {
        return { directionX: -directionX, directionY: -directionY };
    }
    return { directionX: directionX, directionY: directionY };
}

function isPointInsideDxfPath(x, y, path) {
    var points = getDxfPathAnchors(path);
    var inside = false;
    for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
        var pointI = points[i];
        var pointJ = points[j];
        var intersects = ((pointI[1] > y) !== (pointJ[1] > y)) &&
            (x < (pointJ[0] - pointI[0]) * (y - pointI[1]) /
            (pointJ[1] - pointI[1]) + pointI[0]);
        if (intersects) {
            inside = !inside;
        }
    }
    return inside;
}

function addDxfNotchLocator(parentGroup, anchorX, anchorY, directionX, directionY) {
    var locator = parentGroup.pathItems.add();
    locator.name = "刀口定位";
    locator.note = "AAMA_NOTCH_LOCATOR";
    locator.setEntirePath([
        [anchorX, anchorY],
        [anchorX + directionX, anchorY + directionY]
    ]);
    locator.closed = false;
    locator.stroked = false;
    locator.filled = false;
    locator.hidden = true;
}

function updateDxfNotchMetadata(group, anchorX, anchorY, directionX, directionY, notchStyle, targetPathId) {
    var elementId = getDxfElementId(group);
    group.note = [
        "AAMA_NOTCH",
        anchorX,
        anchorY,
        directionX,
        directionY,
        normalizeDxfNotchStyle(notchStyle),
        targetPathId || ""
    ].join("|");
    if (elementId) {
        setDxfMetadataValue(group, "AAMA_ELEMENT", elementId);
    }
}

function clearDxfNotchArtwork(group) {
    for (var itemIndex = group.pageItems.length - 1; itemIndex >= 0; itemIndex--) {
        if (getDxfPrimaryNoteLine(group.pageItems[itemIndex].note) === "AAMA_NOTCH_LOCATOR") {
            continue;
        }
        group.pageItems[itemIndex].remove();
    }
}

function getDxfNotchLiveGeometry(group, metadata) {
    for (var i = 0; i < group.pageItems.length; i++) {
        var item = group.pageItems[i];
        if (item.typename !== "PathItem" ||
            getDxfPrimaryNoteLine(item.note) !== "AAMA_NOTCH_LOCATOR" ||
            item.pathPoints.length < 2) {
            continue;
        }
        var start = item.pathPoints[0].anchor;
        var end = item.pathPoints[1].anchor;
        var directionX = end[0] - start[0];
        var directionY = end[1] - start[1];
        var length = Math.sqrt(directionX * directionX + directionY * directionY);
        if (length > 0) {
            return {
                anchorX: start[0],
                anchorY: start[1],
                directionX: directionX / length,
                directionY: directionY / length,
                boundaryMatched: true
            };
        }
    }
    return deriveLegacyDxfNotchGeometry(group, metadata);
}

function deriveLegacyDxfNotchGeometry(group, metadata) {
    var endpoints = [];
    var candidates = [];
    for (var i = 0; i < group.pathItems.length; i++) {
        var points = getDxfPathAnchors(group.pathItems[i]);
        if (points.length < 2) {
            continue;
        }
        endpoints.push(points[0]);
        endpoints.push(points[points.length - 1]);
    }
    // 先检查端点中点，旧版内 V 的真实原锚点是两条 V 线外端点的中点。
    for (var first = 0; first < endpoints.length; first++) {
        for (var second = first + 1; second < endpoints.length; second++) {
            candidates.push([
                (endpoints[first][0] + endpoints[second][0]) / 2,
                (endpoints[first][1] + endpoints[second][1]) / 2
            ]);
        }
    }
    for (var endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex++) {
        candidates.push(endpoints[endpointIndex]);
    }

    var best = null;
    var pieceGroup = findDxfOwningPieceGroup(group);
    if (pieceGroup === null) {
        metadata.boundaryMatched = false;
        return metadata;
    }
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
        var target = findDxfNotchTargetSegment(
            pieceGroup,
            candidates[candidateIndex][0],
            candidates[candidateIndex][1],
            metadata.directionX,
            metadata.directionY
        );
        if (target !== null && (best === null || target.distance < best.distance)) {
            best = { point: candidates[candidateIndex], distance: target.distance };
        }
    }
    if (best !== null) {
        var insideDirection = resolveDxfNotchInteriorDirection(
            pieceGroup,
            best.point[0],
            best.point[1],
            metadata.directionX,
            metadata.directionY
        );
        addDxfNotchLocator(
            group,
            best.point[0],
            best.point[1],
            insideDirection.directionX,
            insideDirection.directionY
        );
        return {
            anchorX: best.point[0],
            anchorY: best.point[1],
            directionX: insideDirection.directionX,
            directionY: insideDirection.directionY,
            boundaryMatched: true
        };
    }
    metadata.boundaryMatched = false;
    return metadata;
}

function restoreDxfNotchCut(pieceGroup, anchorX, anchorY, directionX, directionY, notchStyle, targetPathId) {
    if (!targetPathId) {
        return false;
    }
    var paths = getDxfBoundaryPaths(pieceGroup);
    var targetPath = null;
    for (var i = 0; i < paths.length; i++) {
        if (getAamaDxfBoundaryPathIdFromPath(paths[i]) === targetPathId) {
            targetPath = paths[i];
            break;
        }
    }
    if (targetPath === null) {
        return false;
    }

    var wasClosed = targetPath.closed;
    var millimeterScale = getDxfMillimeterToDocumentUnits(pieceGroup);
    var geometry = getDxfNotchVGeometry(
        anchorX,
        anchorY,
        directionX,
        directionY,
        notchStyle,
        millimeterScale
    );
    var points = getDxfPathAnchors(targetPath);
    var apexIndex = findDxfPointIndex(points, geometry.apex, 0.2 * millimeterScale);
    if (apexIndex < 1 || apexIndex >= points.length - 1) {
        return false;
    }
    var restoredPoints = [];
    for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
        if (pointIndex === apexIndex - 1) {
            // 恢复原锚点，使直刀口和 T 形口也从裁片边线的实际锚点发出。
            restoredPoints.push([anchorX, anchorY]);
            pointIndex = apexIndex + 1;
            continue;
        }
        restoredPoints.push(points[pointIndex]);
    }
    if (restoredPoints.length < 2) {
        return false;
    }
    targetPath.setEntirePath(restoredPoints);
    targetPath.closed = wasClosed;
    return true;
}

function findDxfPointIndex(points, target, tolerance) {
    var bestIndex = -1;
    var bestDistance = tolerance * tolerance;
    for (var i = 0; i < points.length; i++) {
        var distanceX = points[i][0] - target[0];
        var distanceY = points[i][1] - target[1];
        var squaredDistance = distanceX * distanceX + distanceY * distanceY;
        if (squaredDistance <= bestDistance) {
            bestDistance = squaredDistance;
            bestIndex = i;
        }
    }
    return bestIndex;
}

function replaceDxfNotchStyle(notchStyle) {
    try {
        if (app.documents.length === 0) {
            return "请先打开包含刀口图层的 Illustrator 文档。";
        }

        notchStyle = normalizeDxfNotchStyle(notchStyle);
        var doc = app.activeDocument;
        var replacedCount = 0;

        for (var layerIndex = 0; layerIndex < doc.layers.length; layerIndex++) {
            doc.layers[layerIndex].locked = false;
            doc.layers[layerIndex].visible = true;
            replacedCount += replaceDxfNotchesRecursively(doc.layers[layerIndex], notchStyle);
        }

        if (replacedCount === 0) {
            return "没有找到可替换的刀口。请先使用新版插件重新导入 DXF。";
        }

        return "刀口样式替换完成！\n" +
            "类型: " + getDxfNotchStyleLabel(notchStyle) + "\n" +
            "已替换: " + replacedCount + " 个刀口。";
    } catch (error) {
        return "刀口样式替换失败: " + error.message + "（行号: " + error.line + "）";
    }
}

function replaceDxfNotchesRecursively(container, notchStyle) {
    var replacedCount = 0;

    for (var groupIndex = container.groupItems.length - 1; groupIndex >= 0; groupIndex--) {
        var group = container.groupItems[groupIndex];
        if (group.parent !== container) {
            continue;
        }

        var metadata = parseDxfNotchMetadata(group.note);
        if (metadata !== null) {
            if (group.name.indexOf("刀口_元素") !== 0) {
                group.name = "刀口";
            }
            var liveGeometry = getDxfNotchLiveGeometry(group, metadata);
            var pieceGroup = findDxfOwningPieceGroup(group);

            if (pieceGroup === null || liveGeometry.boundaryMatched === false) {
                group.remove();
                continue;
            }

            if ((metadata.style === "v-in" || metadata.style === "v-out") && metadata.targetPathId) {
                restoreDxfNotchCut(
                    pieceGroup,
                    liveGeometry.anchorX,
                    liveGeometry.anchorY,
                    liveGeometry.directionX,
                    liveGeometry.directionY,
                    metadata.style,
                    metadata.targetPathId
                );
            }
            clearDxfNotchArtwork(group);
            renderDxfNotchStyle(
                pieceGroup,
                group,
                liveGeometry.anchorX,
                liveGeometry.anchorY,
                liveGeometry.directionX,
                liveGeometry.directionY,
                notchStyle
            );
            replacedCount++;
        } else {
            replacedCount += replaceDxfNotchesRecursively(group, notchStyle);
        }
    }

    return replacedCount;
}

function findDxfOwningPieceGroup(item) {
    var current = item;
    var guard = 0;
    while (current && guard < 20) {
        if (current.typename === "GroupItem" && current.note &&
            current.note.indexOf("AAMA_PIECE|") === 0) {
            return current;
        }
        current = current.parent;
        guard++;
    }
    return null;
}

function parseDxfNotchMetadata(note) {
    var primaryLine = getDxfPrimaryNoteLine(note);
    if (primaryLine.indexOf("AAMA_NOTCH|") !== 0) {
        return null;
    }

    var parts = primaryLine.split("|");
    if (parts.length < 5) {
        return null;
    }

    var metadata = {
        anchorX: parseFloat(parts[1]),
        anchorY: parseFloat(parts[2]),
        directionX: parseFloat(parts[3]),
        directionY: parseFloat(parts[4]),
        style: parts.length > 5 ? normalizeDxfNotchStyle(parts[5]) : "",
        targetPathId: parts.length > 6 ? parts[6] : ""
    };

    if (isNaN(metadata.anchorX) || isNaN(metadata.anchorY) ||
        isNaN(metadata.directionX) || isNaN(metadata.directionY)) {
        return null;
    }
    return metadata;
}

function getDxfSemanticRole(item) {
    var current = item;
    var guard = 0;
    while (current && guard < 20) {
        // Layer/Document 没有可安全读取的 note。角色只可能定义在路径本身或
        // 裁片内的语义编组，因此到这里就应停止，避免 ExtendScript 抛出
        // “undefined 不是对象”。
        if (current.typename === "Layer" || current.typename === "Document") {
            break;
        }
        var name = "";
        var note = "";
        try {
            name = String(current.name || "");
            note = getDxfPrimaryNoteLine(current.note);
        } catch (metadataReadError) {
            break;
        }

        if (note.indexOf("AAMA_STYLE_HINT|") === 0) {
            return note.substring("AAMA_STYLE_HINT|".length);
        }
        if (note === "AAMA_PIECE_CLIP_PATH") {
            return "clip-path";
        }
        if (note.indexOf("AAMA_SEMANTIC_GROUP|") === 0) {
            return note.substring("AAMA_SEMANTIC_GROUP|".length);
        }
        if (note.indexOf("AAMA_NOTCH|") === 0 || name === "刀口" ||
            name.indexOf("刀口_元素") === 0 ||
            name === "刀口组" || name === "Notching" || name === "NotchingGroup") {
            return "notching";
        }
        if (note.indexOf("AAMA_DXF_BOUNDARY|") === 0 || name === "外线" ||
            name.indexOf("外线_元素") === 0 ||
            name === "BlackBorder" || name === "Contour") {
            return "contour";
        }
        if (note.indexOf("AAMA_DXF_INNER_BOUNDARY|") === 0 ||
            name === "内线" || name.indexOf("内线_元素") === 0 || name === "CleanEdge") {
            return "clean-edge";
        }
        if (name === "工艺线" || name.indexOf("工艺线_元素") === 0 || name === "工艺线组" ||
            name === "TechLine" || name === "TechLineGroup") {
            return "techline";
        }
        if (name === "工艺孔" || name === "工艺孔组" ||
            name === "TechHole" || name === "TechHoleGroup") {
            return "tech-hole";
        }
        if (note.indexOf("AAMA_ANCHOR_POINT|INNER|") === 0 ||
            note.indexOf("AAMA_ANCHOR|INNER|") === 0 || name === "内线锚点组" ||
            name === "内线锚点" || name === "AnchorGroup" || name === "AnchorPath") {
            return "inner-anchor";
        }
        if (note.indexOf("AAMA_ANCHOR_POINT|OUTER|") === 0 ||
            note.indexOf("AAMA_ANCHOR|OUTER|") === 0 || name === "外线锚点组" ||
            name === "外线锚点" || name === "ClipAnchorGroup" || name === "ClipAnchorPath") {
            return "outer-anchor";
        }
        current = current.parent;
        guard++;
    }
    return "";
}

function isDxfItemInsideLayer(item, layerName) {
    var current = item;
    var guard = 0;
    while (current && guard < 20) {
        if (current.typename === "Layer" && current.name === layerName) {
            return true;
        }
        current = current.parent;
        guard++;
    }
    return false;
}
