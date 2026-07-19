// DXF 图形转换、刀口预分类、工艺线约束与裁片排版

function normalizeDxfNotchStyle(notchStyle) {
    if (notchStyle === "t" || notchStyle === "v-in" || notchStyle === "v-out") {
        return notchStyle;
    }
    return "straight";
}

function getDxfNotchStyleLabel(notchStyle) {
    if (notchStyle === "t") {
        return "T 形";
    }
    if (notchStyle === "v-in") {
        return "内向 V";
    }
    if (notchStyle === "v-out") {
        return "外向 V";
    }
    return "一字型（直刀口）";
}

function makeDxfShape(points, closed, kind, notchStart) {
    return {
        points: points,
        closed: closed,
        kind: kind || "path",
        notchStart: notchStart === true
    };
}

function convertDxfEntitiesToShapes(entities, notchStyle) {
    var shapes = [];
    var notchKeys = {};

    for (var i = 0; i < entities.length; i++) {
        var entity = entities[i];
        var entityLayer = getDxfEntityLayer(entity);
        var sourceEntityIndex = i;
        var shapeCountBefore = shapes.length;

        // ANSI/AAMA 图层 7 为丝缕线；模板导入不需要该元素，解析阶段直接丢弃。
        if (entityLayer === "7") {
            continue;
        }

        if (entity.type === "LINE") {
            shapes.push(makeDxfShape([
                [getDxfValue(entity, 10, 0), getDxfValue(entity, 20, 0)],
                [getDxfValue(entity, 11, 0), getDxfValue(entity, 21, 0)]
            ], false));
        } else if (entity.type === "LWPOLYLINE") {
            var xs = getDxfValues(entity, 10);
            var ys = getDxfValues(entity, 20);
            var polylinePoints = [];
            for (var j = 0; j < xs.length; j++) {
                polylinePoints.push([xs[j], j < ys.length ? ys[j] : 0]);
            }
            if (polylinePoints.length > 1) {
                var flags = getDxfValue(entity, 70, 0);
                shapes.push(makeDxfShape(polylinePoints, (flags & 1) === 1));
            }
        } else if (entity.type === "POLYLINE") {
            var oldPolylinePoints = [];
            var polylineFlags = getDxfValue(entity, 70, 0);
            var nextIndex = i + 1;

            while (nextIndex < entities.length && entities[nextIndex].type === "VERTEX") {
                oldPolylinePoints.push([
                    getDxfValue(entities[nextIndex], 10, 0),
                    getDxfValue(entities[nextIndex], 20, 0)
                ]);
                nextIndex++;
            }

            if (oldPolylinePoints.length > 1) {
                shapes.push(makeDxfShape(oldPolylinePoints, (polylineFlags & 1) === 1));
            }
            if (nextIndex < entities.length && entities[nextIndex].type === "SEQEND") {
                i = nextIndex;
            }
        } else if (entity.type === "CIRCLE") {
            shapes.push(makeDxfShape(makeDxfArcPoints(
                getDxfValue(entity, 10, 0),
                getDxfValue(entity, 20, 0),
                getDxfValue(entity, 40, 0),
                0,
                360
            ), true));
        } else if (entity.type === "ARC") {
            shapes.push(makeDxfShape(makeDxfArcPoints(
                getDxfValue(entity, 10, 0),
                getDxfValue(entity, 20, 0),
                getDxfValue(entity, 40, 0),
                getDxfValue(entity, 50, 0),
                getDxfValue(entity, 51, 0)
            ), false));
        } else if (entity.type === "POINT" && entityLayer === "4") {
            appendAamaNotchShapes(shapes, entity, notchKeys, notchStyle);
        }

        for (var createdIndex = shapeCountBefore; createdIndex < shapes.length; createdIndex++) {
            shapes[createdIndex].sourceEntityIndex = sourceEntityIndex;
            shapes[createdIndex].dxfLayer = entityLayer;
        }
    }

    return shapes;
}

function getDxfEntityLayer(entity) {
    for (var i = 0; i < entity.pairs.length; i++) {
        if (entity.pairs[i].code === 8) {
            return String(entity.pairs[i].value);
        }
    }
    return "";
}

function classifyAamaNotchesByBoundary(shapes) {
    var outerBoundaries = [];
    var innerBoundaries = [];

    for (var i = 0; i < shapes.length; i++) {
        if (!shapes[i].closed) {
            continue;
        }
        if (String(shapes[i].dxfLayer) === "1") {
            outerBoundaries.push(shapes[i]);
        } else if (String(shapes[i].dxfLayer) === "14") {
            innerBoundaries.push(shapes[i]);
        }
    }

    if (outerBoundaries.length === 0) {
        return;
    }

    for (var shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        var shape = shapes[shapeIndex];
        if (shape.kind !== "notch" || shape.points.length === 0) {
            continue;
        }

        var outerNearest = getDxfNearestPointOnShapes(shape.points[0], outerBoundaries);
        var innerNearest = innerBoundaries.length > 0 ?
            getDxfNearestPointOnShapes(shape.points[0], innerBoundaries) : { distance: Infinity };

        // 内外线重合的折边点优先归到外线，保证会生成实际裁剪刀口。
        if (outerNearest.distance <= innerNearest.distance) {
            shape.notchBoundaryLayer = "1";
            shape.notchBoundaryShapeIndex = outerNearest.shapeIndex;
            shape.notchBoundarySegmentIndex = outerNearest.segmentIndex;
            shape.notchBoundaryProjection = outerNearest.projection;
        } else {
            shape.notchBoundaryLayer = "14";
            shape.notchBoundaryShapeIndex = innerNearest.shapeIndex;
            shape.notchBoundarySegmentIndex = innerNearest.segmentIndex;
            shape.notchBoundaryProjection = innerNearest.projection;
        }
    }
}

function mergeAamaNearbyNotchRecords(shapes) {
    var MERGE_DISTANCE = 1;
    var MIN_DIRECTION_DOT = 0.9659; // 15 degrees

    for (var i = 0; i < shapes.length; i++) {
        var first = shapes[i];
        if (first.kind !== "notch" || first.skipNotch === true || !first.notchBoundaryLayer) {
            continue;
        }

        for (var j = i + 1; j < shapes.length; j++) {
            var second = shapes[j];
            if (second.kind !== "notch" || second.skipNotch === true ||
                second.notchBoundaryLayer !== first.notchBoundaryLayer ||
                second.notchBoundaryShapeIndex !== first.notchBoundaryShapeIndex) {
                continue;
            }

            var anchorDX = second.points[0][0] - first.points[0][0];
            var anchorDY = second.points[0][1] - first.points[0][1];
            if (Math.sqrt(anchorDX * anchorDX + anchorDY * anchorDY) >= MERGE_DISTANCE) {
                continue;
            }

            var firstDirection = getNormalizedDxfNotchDirection(first);
            var secondDirection = getNormalizedDxfNotchDirection(second);
            var directionDot = firstDirection[0] * secondDirection[0] +
                firstDirection[1] * secondDirection[1];
            if (directionDot < MIN_DIRECTION_DOT) {
                continue;
            }

            var anchorX = (first.points[0][0] + second.points[0][0]) / 2;
            var anchorY = (first.points[0][1] + second.points[0][1]) / 2;
            var directionX = firstDirection[0] + secondDirection[0];
            var directionY = firstDirection[1] + secondDirection[1];
            var directionLength = Math.sqrt(directionX * directionX + directionY * directionY);
            if (directionLength === 0) {
                continue;
            }
            directionX /= directionLength;
            directionY /= directionLength;

            first.points[0] = [anchorX, anchorY];
            first.points[1] = [anchorX + directionX * 5, anchorY + directionY * 5];
            if (first.notchBoundarySegmentIndex === second.notchBoundarySegmentIndex) {
                first.notchBoundaryProjection =
                    (first.notchBoundaryProjection + second.notchBoundaryProjection) / 2;
            }
            second.skipNotch = true;
        }
    }
}

function getNormalizedDxfNotchDirection(shape) {
    var directionX = shape.points[1][0] - shape.points[0][0];
    var directionY = shape.points[1][1] - shape.points[0][1];
    var length = Math.sqrt(directionX * directionX + directionY * directionY);
    if (length === 0) {
        return [1, 0];
    }
    return [directionX / length, directionY / length];
}

function snapAamaNotchesToAssignedBoundary(shapes) {
    var boundariesByLayer = { "1": [], "14": [] };
    for (var i = 0; i < shapes.length; i++) {
        var layer = String(shapes[i].dxfLayer);
        if (shapes[i].closed && boundariesByLayer[layer]) {
            boundariesByLayer[layer].push(shapes[i]);
        }
    }

    for (var shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        var notch = shapes[shapeIndex];
        if (notch.kind !== "notch" || !notch.notchBoundaryLayer) {
            continue;
        }
        var boundaries = boundariesByLayer[notch.notchBoundaryLayer];
        var boundary = boundaries[notch.notchBoundaryShapeIndex];
        if (!boundary || boundary.points.length < 2) {
            continue;
        }

        var segmentIndex = notch.notchBoundarySegmentIndex;
        if (segmentIndex < 0 || segmentIndex >= boundary.points.length) {
            continue;
        }
        var nextIndex = (segmentIndex + 1) % boundary.points.length;
        var start = boundary.points[segmentIndex];
        var end = boundary.points[nextIndex];
        var projection = notch.notchBoundaryProjection;
        var targetX = start[0] + (end[0] - start[0]) * projection;
        var targetY = start[1] + (end[1] - start[1]) * projection;
        var offsetX = targetX - notch.points[0][0];
        var offsetY = targetY - notch.points[0][1];

        for (var pointIndex = 0; pointIndex < notch.points.length; pointIndex++) {
            notch.points[pointIndex][0] += offsetX;
            notch.points[pointIndex][1] += offsetY;
        }
    }
}

function constrainAamaTechlinesToInnerBoundary(shapes) {
    var innerBoundaries = [];
    var tolerance = 0.001;

    for (var i = 0; i < shapes.length; i++) {
        if (String(shapes[i].dxfLayer) === "14" && shapes[i].closed) {
            prepareDxfBoundaryClipIndex(shapes[i]);
            innerBoundaries.push(shapes[i]);
        }
    }
    if (innerBoundaries.length === 0) {
        return;
    }

    var filteredShapes = [];
    var techlineKeys = {};
    for (var shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        var shape = shapes[shapeIndex];
        if (String(shape.dxfLayer) !== "8") {
            filteredShapes.push(shape);
            continue;
        }

        var clippedParts = clipDxfTechlineToInnerBoundaries(shape, innerBoundaries, tolerance);
        for (var partIndex = 0; partIndex < clippedParts.length; partIndex++) {
            var part = clippedParts[partIndex];
            if (getDxfPolylineLength(part) <= tolerance) {
                continue;
            }
            var pathKey = getDxfCanonicalPathKey(part, tolerance);
            if (techlineKeys[pathKey]) {
                continue;
            }
            techlineKeys[pathKey] = true;

            var clippedShape = cloneDxfShapeWithOffset(shape, 0, 0);
            clippedShape.points = part;
            clippedShape.closed = false;
            filteredShapes.push(clippedShape);
        }
    }

    shapes.length = 0;
    for (var filteredIndex = 0; filteredIndex < filteredShapes.length; filteredIndex++) {
        shapes.push(filteredShapes[filteredIndex]);
    }
}

function getDxfSegmentBounds(start, end) {
    return {
        minX: Math.min(start[0], end[0]),
        minY: Math.min(start[1], end[1]),
        maxX: Math.max(start[0], end[0]),
        maxY: Math.max(start[1], end[1])
    };
}

function doDxfBoundsOverlap(first, second, tolerance) {
    return first.maxX + tolerance >= second.minX &&
        second.maxX + tolerance >= first.minX &&
        first.maxY + tolerance >= second.minY &&
        second.maxY + tolerance >= first.minY;
}

function prepareDxfBoundaryClipIndex(boundary) {
    var bounds = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
    var segments = [];
    var segmentCount = boundary.closed ? boundary.points.length : boundary.points.length - 1;
    for (var pointIndex = 0; pointIndex < boundary.points.length; pointIndex++) {
        var point = boundary.points[pointIndex];
        bounds.minX = Math.min(bounds.minX, point[0]);
        bounds.minY = Math.min(bounds.minY, point[1]);
        bounds.maxX = Math.max(bounds.maxX, point[0]);
        bounds.maxY = Math.max(bounds.maxY, point[1]);
    }
    for (var segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        var start = boundary.points[segmentIndex];
        var end = boundary.points[(segmentIndex + 1) % boundary.points.length];
        segments.push({
            start: start,
            end: end,
            bounds: getDxfSegmentBounds(start, end)
        });
    }
    boundary._dxfClipBounds = bounds;
    boundary._dxfClipSegments = segments;
}

function clipDxfTechlineToInnerBoundaries(shape, innerBoundaries, tolerance) {
    var parts = [];
    var segmentCount = shape.closed ? shape.points.length : shape.points.length - 1;
    for (var pointIndex = 0; pointIndex < segmentCount; pointIndex++) {
        var start = shape.points[pointIndex];
        var end = shape.points[(pointIndex + 1) % shape.points.length];
        var clippedSegments = clipDxfSegmentToInnerBoundaries(
            start, end, innerBoundaries, tolerance
        );
        for (var segmentIndex = 0; segmentIndex < clippedSegments.length; segmentIndex++) {
            appendDxfClippedSegment(parts, clippedSegments[segmentIndex], tolerance);
        }
    }
    return parts;
}

function clipDxfSegmentToInnerBoundaries(start, end, innerBoundaries, tolerance) {
    var parameters = [0, 1];
    var segmentX = end[0] - start[0];
    var segmentY = end[1] - start[1];
    if (segmentX * segmentX + segmentY * segmentY <= tolerance * tolerance) {
        return [];
    }
    var sourceBounds = getDxfSegmentBounds(start, end);

    for (var boundaryIndex = 0; boundaryIndex < innerBoundaries.length; boundaryIndex++) {
        var boundary = innerBoundaries[boundaryIndex];
        if (!boundary._dxfClipBounds || !boundary._dxfClipSegments) {
            prepareDxfBoundaryClipIndex(boundary);
        }
        if (!doDxfBoundsOverlap(sourceBounds, boundary._dxfClipBounds, tolerance)) {
            continue;
        }
        for (var boundaryPointIndex = 0;
            boundaryPointIndex < boundary._dxfClipSegments.length;
            boundaryPointIndex++) {
            var indexedSegment = boundary._dxfClipSegments[boundaryPointIndex];
            if (!doDxfBoundsOverlap(sourceBounds, indexedSegment.bounds, tolerance)) {
                continue;
            }
            collectDxfSegmentIntersectionParameters(
                start,
                end,
                indexedSegment.start,
                indexedSegment.end,
                parameters
            );
        }
    }

    parameters.sort(function (a, b) { return a - b; });
    var uniqueParameters = [];
    for (var parameterIndex = 0; parameterIndex < parameters.length; parameterIndex++) {
        if (uniqueParameters.length === 0 ||
            Math.abs(parameters[parameterIndex] - uniqueParameters[uniqueParameters.length - 1]) > 0.000000001) {
            uniqueParameters.push(Math.max(0, Math.min(1, parameters[parameterIndex])));
        }
    }

    var clippedSegments = [];
    for (var intervalIndex = 0; intervalIndex + 1 < uniqueParameters.length; intervalIndex++) {
        var startParameter = uniqueParameters[intervalIndex];
        var endParameter = uniqueParameters[intervalIndex + 1];
        if (endParameter - startParameter <= 0.000000001) {
            continue;
        }
        var middlePoint = getDxfInterpolatedPoint(
            start, end, (startParameter + endParameter) / 2
        );
        if (!isPointInsideAnyDxfBoundary(middlePoint, innerBoundaries, tolerance)) {
            continue;
        }
        clippedSegments.push([
            getDxfInterpolatedPoint(start, end, startParameter),
            getDxfInterpolatedPoint(start, end, endParameter)
        ]);
    }
    return clippedSegments;
}

function collectDxfSegmentIntersectionParameters(start, end, boundaryStart, boundaryEnd, result) {
    var segmentX = end[0] - start[0];
    var segmentY = end[1] - start[1];
    var boundaryX = boundaryEnd[0] - boundaryStart[0];
    var boundaryY = boundaryEnd[1] - boundaryStart[1];
    var denominator = segmentX * boundaryY - segmentY * boundaryX;
    var offsetX = boundaryStart[0] - start[0];
    var offsetY = boundaryStart[1] - start[1];

    if (Math.abs(denominator) < 0.000000000001) {
        var collinear = Math.abs(offsetX * segmentY - offsetY * segmentX) < 0.000000001;
        if (!collinear) {
            return;
        }
        var segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
        if (segmentLengthSquared === 0) {
            return;
        }
        addDxfIntersectionParameter(
            result,
            (offsetX * segmentX + offsetY * segmentY) / segmentLengthSquared
        );
        addDxfIntersectionParameter(
            result,
            ((boundaryEnd[0] - start[0]) * segmentX +
                (boundaryEnd[1] - start[1]) * segmentY) / segmentLengthSquared
        );
        return;
    }

    var segmentParameter = (offsetX * boundaryY - offsetY * boundaryX) / denominator;
    var boundaryParameter = (offsetX * segmentY - offsetY * segmentX) / denominator;
    if (segmentParameter >= -0.000000001 && segmentParameter <= 1.000000001 &&
        boundaryParameter >= -0.000000001 && boundaryParameter <= 1.000000001) {
        addDxfIntersectionParameter(result, segmentParameter);
    }
}

function addDxfIntersectionParameter(result, parameter) {
    if (parameter >= -0.000000001 && parameter <= 1.000000001) {
        result.push(Math.max(0, Math.min(1, parameter)));
    }
}

function getDxfInterpolatedPoint(start, end, parameter) {
    return [
        start[0] + (end[0] - start[0]) * parameter,
        start[1] + (end[1] - start[1]) * parameter
    ];
}

function isPointInsideAnyDxfBoundary(point, boundaries, tolerance) {
    var candidates = [];
    for (var boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex++) {
        var boundary = boundaries[boundaryIndex];
        if (!boundary._dxfClipBounds) {
            prepareDxfBoundaryClipIndex(boundary);
        }
        var bounds = boundary._dxfClipBounds;
        if (point[0] < bounds.minX - tolerance || point[0] > bounds.maxX + tolerance ||
            point[1] < bounds.minY - tolerance || point[1] > bounds.maxY + tolerance) {
            continue;
        }
        candidates.push(boundary);
        if (isPointInsideDxfShape(point, boundary)) {
            return true;
        }
    }
    return candidates.length > 0 &&
        getDxfNearestPointOnShapes(point, candidates).distance <= tolerance;
}

function appendDxfClippedSegment(parts, segment, tolerance) {
    if (parts.length > 0) {
        var currentPart = parts[parts.length - 1];
        var currentEnd = currentPart[currentPart.length - 1];
        if (getDxfPointDistance(currentEnd, segment[0]) <= tolerance) {
            if (getDxfPointDistance(currentEnd, segment[1]) > tolerance) {
                currentPart.push(segment[1]);
            }
            return;
        }
    }
    parts.push([segment[0], segment[1]]);
}

function getDxfPointDistance(first, second) {
    var differenceX = first[0] - second[0];
    var differenceY = first[1] - second[1];
    return Math.sqrt(differenceX * differenceX + differenceY * differenceY);
}

function getDxfPolylineLength(points) {
    var length = 0;
    for (var pointIndex = 1; pointIndex < points.length; pointIndex++) {
        length += getDxfPointDistance(points[pointIndex - 1], points[pointIndex]);
    }
    return length;
}

function getDxfCanonicalPathKey(points, tolerance) {
    var forward = [];
    var reverse = [];
    for (var pointIndex = 0; pointIndex < points.length; pointIndex++) {
        forward.push(
            Math.round(points[pointIndex][0] / tolerance) + "," +
            Math.round(points[pointIndex][1] / tolerance)
        );
        var reversePoint = points[points.length - 1 - pointIndex];
        reverse.push(
            Math.round(reversePoint[0] / tolerance) + "," +
            Math.round(reversePoint[1] / tolerance)
        );
    }
    var forwardKey = forward.join(";");
    var reverseKey = reverse.join(";");
    return forwardKey < reverseKey ? forwardKey : reverseKey;
}

function getDxfNearestPointOnShapes(point, shapes) {
    var result = {
        distance: Infinity,
        distanceSquared: Infinity,
        point: [point[0], point[1]],
        shapeIndex: -1,
        segmentIndex: -1,
        projection: 0
    };
    for (var shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        var shape = shapes[shapeIndex];
        if (!shape._dxfNearestBounds || !shape._dxfNearestSegments) {
            prepareDxfNearestShapeIndex(shape);
        }
        if (getDxfPointToBoundsDistanceSquared(point, shape._dxfNearestBounds) >=
            result.distanceSquared) {
            continue;
        }
        for (var pointIndex = 0; pointIndex < shape._dxfNearestSegments.length;
            pointIndex++) {
            var indexedSegment = shape._dxfNearestSegments[pointIndex];
            if (getDxfPointToBoundsDistanceSquared(point, indexedSegment.bounds) >=
                result.distanceSquared) {
                continue;
            }
            var start = indexedSegment.start;
            var end = indexedSegment.end;
            var segmentX = end[0] - start[0];
            var segmentY = end[1] - start[1];
            var segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
            var projection = segmentLengthSquared === 0 ? 0 :
                ((point[0] - start[0]) * segmentX + (point[1] - start[1]) * segmentY) /
                segmentLengthSquared;
            projection = Math.max(0, Math.min(1, projection));
            var nearestX = start[0] + segmentX * projection;
            var nearestY = start[1] + segmentY * projection;
            var distanceX = point[0] - nearestX;
            var distanceY = point[1] - nearestY;
            var distanceSquared = distanceX * distanceX + distanceY * distanceY;
            if (distanceSquared < result.distanceSquared) {
                result.distanceSquared = distanceSquared;
                result.point = [nearestX, nearestY];
                result.shapeIndex = shapeIndex;
                result.segmentIndex = pointIndex;
                result.projection = projection;
            }
        }
    }
    result.distance = Math.sqrt(result.distanceSquared);
    return result;
}

function getDxfPointToBoundsDistanceSquared(point, bounds) {
    var distanceX = 0;
    var distanceY = 0;
    if (point[0] < bounds.minX) {
        distanceX = bounds.minX - point[0];
    } else if (point[0] > bounds.maxX) {
        distanceX = point[0] - bounds.maxX;
    }
    if (point[1] < bounds.minY) {
        distanceY = bounds.minY - point[1];
    } else if (point[1] > bounds.maxY) {
        distanceY = point[1] - bounds.maxY;
    }
    return distanceX * distanceX + distanceY * distanceY;
}

function prepareDxfNearestShapeIndex(shape) {
    var bounds = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
    var segments = [];
    var segmentCount = shape.closed ? shape.points.length : shape.points.length - 1;
    for (var pointIndex = 0; pointIndex < shape.points.length; pointIndex++) {
        var point = shape.points[pointIndex];
        bounds.minX = Math.min(bounds.minX, point[0]);
        bounds.minY = Math.min(bounds.minY, point[1]);
        bounds.maxX = Math.max(bounds.maxX, point[0]);
        bounds.maxY = Math.max(bounds.maxY, point[1]);
    }
    for (var segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
        var start = shape.points[segmentIndex];
        var end = shape.points[(segmentIndex + 1) % shape.points.length];
        segments.push({
            start: start,
            end: end,
            bounds: getDxfSegmentBounds(start, end)
        });
    }
    shape._dxfNearestBounds = bounds;
    shape._dxfNearestSegments = segments;
}

function isPointInsideDxfShape(point, shape) {
    var inside = false;
    for (var i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
        var pointI = shape.points[i];
        var pointJ = shape.points[j];
        var intersects = ((pointI[1] > point[1]) !== (pointJ[1] > point[1])) &&
            (point[0] < (pointJ[0] - pointI[0]) * (point[1] - pointI[1]) /
            (pointJ[1] - pointI[1]) + pointI[0]);
        if (intersects) {
            inside = !inside;
        }
    }
    return inside;
}

function getDxfShapeDisplayName(shape) {
    if (String(shape.dxfLayer) === "1") {
        return "外线";
    }
    if (String(shape.dxfLayer) === "14") {
        return "内线";
    }
    return "DXF 路径";
}

function expandDxfShapesByQuantity(shapes) {
    var pieces = {};
    var pieceOrder = [];
    var originalLength = shapes.length;

    for (var i = 0; i < originalLength; i++) {
        var shape = shapes[i];
        var sizeName = shape.sizeName || "未知尺码";
        var pieceKey = shape.pieceKey || "entities";
        var key = "size:" + sizeName + "|piece:" + pieceKey;
        if (!pieces[key]) {
            pieces[key] = {
                shapes: [],
                quantity: Math.max(1, parseInt(shape.pieceQuantity, 10) || 1),
                originalPieceKey: pieceKey,
                baseLabel: shape.pieceBaseLabel || shape.pieceLabel || "裁片"
            };
            pieceOrder.push(key);
        }

        var piece = pieces[key];
        piece.shapes.push(shape);
    }

    for (var pieceIndex = 0; pieceIndex < pieceOrder.length; pieceIndex++) {
        var currentPiece = pieces[pieceOrder[pieceIndex]];
        var hasCopies = currentPiece.quantity > 1;

        for (var originalShapeIndex = 0; originalShapeIndex < currentPiece.shapes.length; originalShapeIndex++) {
            var originalShape = currentPiece.shapes[originalShapeIndex];
            originalShape.pieceCopyIndex = 0;
            originalShape.pieceLayoutClusterKey = currentPiece.originalPieceKey;
            originalShape.pieceSourceQuantity = currentPiece.quantity;
            originalShape.pieceQuantity = 1;
            if (hasCopies) {
                originalShape.pieceKey = currentPiece.originalPieceKey + "-copy-0";
                originalShape.pieceLabel = currentPiece.baseLabel + "-01";
            } else {
                originalShape.pieceLabel = currentPiece.baseLabel;
            }
        }

        for (var copyIndex = 1; copyIndex < currentPiece.quantity; copyIndex++) {
            for (var shapeIndex = 0; shapeIndex < currentPiece.shapes.length; shapeIndex++) {
                var clone = cloneDxfShapeWithOffset(currentPiece.shapes[shapeIndex], 0, 0);
                clone.pieceCopyIndex = copyIndex;
                clone.pieceLayoutClusterKey = currentPiece.originalPieceKey;
                clone.pieceSourceQuantity = currentPiece.quantity;
                clone.pieceQuantity = 1;
                clone.pieceKey = currentPiece.originalPieceKey + "-copy-" + copyIndex;
                clone.pieceLabel = currentPiece.baseLabel + "-" + formatDxfCopyNumber(copyIndex + 1);
                shapes.push(clone);
            }
        }
    }
}

function formatDxfCopyNumber(number) {
    return number < 10 ? "0" + number : String(number);
}

function formatDxfElementNumber(number) {
    var value = String(number);
    while (value.length < 4) {
        value = "0" + value;
    }
    return value;
}

function assignDxfStableElementIds(shapes) {
    var elementCounters = {};
    var displayCounters = {};
    for (var shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        var shape = shapes[shapeIndex];
        var sizeName = shape.sizeName || "未知尺码";
        var pieceStableId = shape.pieceKey || "entities";
        var pieceScope = "size:" + sizeName + "|piece:" + pieceStableId;
        var sourceIndex = shape.sourceEntityIndex;
        if (sourceIndex === undefined || sourceIndex === null) {
            sourceIndex = "unknown";
        }
        var sourceKey = String(shape.kind || "path") + "|" +
            String(shape.dxfLayer || "") + "|" + String(sourceIndex);
        var occurrenceKey = pieceScope + "|" + sourceKey;
        elementCounters[occurrenceKey] = (elementCounters[occurrenceKey] || 0) + 1;
        displayCounters[pieceScope] = (displayCounters[pieceScope] || 0) + 1;

        shape.pieceStableId = pieceStableId;
        shape.elementOrdinal = displayCounters[pieceScope];
        shape.elementId = "piece:" + pieceStableId + "|source:" + sourceKey +
            "|occurrence:" + elementCounters[occurrenceKey];
    }
}

function cloneDxfShapeWithOffset(shape, offsetX, offsetY) {
    var points = [];
    for (var i = 0; i < shape.points.length; i++) {
        points.push([shape.points[i][0] + offsetX, shape.points[i][1] + offsetY]);
    }

    var clone = makeDxfShape(points, shape.closed, shape.kind, shape.notchStart);
    for (var propertyName in shape) {
        if (shape.hasOwnProperty(propertyName) && propertyName !== "points" &&
            propertyName.indexOf("_dxfClip") !== 0 &&
            propertyName.indexOf("_dxfNearest") !== 0) {
            clone[propertyName] = shape[propertyName];
        }
    }
    return clone;
}

function cloneDxfShapes(shapes) {
    var clones = [];
    for (var shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        clones.push(cloneDxfShapeWithOffset(shapes[shapeIndex], 0, 0));
    }
    return clones;
}

function arrangeDxfShapesBySizeAndPiece(shapes, sizeNames) {
    var PIECE_GAP = 30;
    var COPY_GAP = 20;
    var SIZE_GAP = 80;
    var piecesByKey = {};
    var clustersByKey = {};
    var clustersBySize = {};
    var sizeOrder = [];
    var sizeSeen = {};
    var sourceIndex;

    for (sourceIndex = 0; sourceIndex < sizeNames.length; sourceIndex++) {
        var configuredSize = sizeNames[sourceIndex] || "未知尺码";
        sizeOrder.push(configuredSize);
        sizeSeen[configuredSize] = true;
    }

    for (sourceIndex = 0; sourceIndex < shapes.length; sourceIndex++) {
        var shape = shapes[sourceIndex];
        shape._dxfSourceOrder = sourceIndex;
        var sizeName = shape.sizeName || "未知尺码";
        if (!sizeSeen[sizeName]) {
            sizeSeen[sizeName] = true;
            sizeOrder.push(sizeName);
        }
        var pieceKey = "size:" + sizeName + "|" + (shape.pieceKey || "entities");
        if (!piecesByKey[pieceKey]) {
            piecesByKey[pieceKey] = {
                sizeName: sizeName,
                pieceKey: shape.pieceKey || "entities",
                clusterKey: shape.pieceLayoutClusterKey || shape.pieceKey || "entities",
                copyIndex: shape.pieceCopyIndex || 0,
                shapes: [],
                minX: Infinity,
                minY: Infinity,
                maxX: -Infinity,
                maxY: -Infinity,
                area: 0
            };
        }
        var piece = piecesByKey[pieceKey];
        piece.shapes.push(shape);
        for (var pointIndex = 0; pointIndex < shape.points.length; pointIndex++) {
            var point = shape.points[pointIndex];
            piece.minX = Math.min(piece.minX, point[0]);
            piece.minY = Math.min(piece.minY, point[1]);
            piece.maxX = Math.max(piece.maxX, point[0]);
            piece.maxY = Math.max(piece.maxY, point[1]);
        }
        if (String(shape.dxfLayer) === "1" && shape.closed) {
            piece.area = Math.max(piece.area, Math.abs(getDxfPolygonArea(shape.points)));
        }
    }

    for (var actualPieceKey in piecesByKey) {
        if (!piecesByKey.hasOwnProperty(actualPieceKey)) {
            continue;
        }
        var actualPiece = piecesByKey[actualPieceKey];
        if (actualPiece.area === 0) {
            actualPiece.area = (actualPiece.maxX - actualPiece.minX) *
                (actualPiece.maxY - actualPiece.minY);
        }
        var clusterMapKey = "size:" + actualPiece.sizeName + "|cluster:" + actualPiece.clusterKey;
        // ExtendScript 在某些 Illustrator 版本中，对包含中文或特殊字符的动态
        // 对象键完成赋值后立即再次取值，偶尔会返回 undefined。直接持有本地引用，
        // 同时兼容被异常数据占用但不是有效聚类对象的键。
        var cluster = clustersByKey[clusterMapKey];
        if (!cluster || !cluster.pieces) {
            cluster = {
                sizeName: actualPiece.sizeName,
                clusterKey: actualPiece.clusterKey,
                pieces: [],
                area: 0,
                width: 0,
                height: 0
            };
            clustersByKey[clusterMapKey] = cluster;
            if (!clustersBySize[actualPiece.sizeName]) {
                clustersBySize[actualPiece.sizeName] = [];
            }
            clustersBySize[actualPiece.sizeName].push(cluster);
        }
        cluster.pieces.push(actualPiece);
        cluster.area = Math.max(cluster.area, actualPiece.area);
        cluster.width = Math.max(cluster.width, actualPiece.maxX - actualPiece.minX);
    }

    for (var clusterKey in clustersByKey) {
        if (!clustersByKey.hasOwnProperty(clusterKey)) {
            continue;
        }
        var measuredCluster = clustersByKey[clusterKey];
        measuredCluster.pieces.sort(function (a, b) {
            return a.copyIndex - b.copyIndex;
        });
        for (var measuredIndex = 0; measuredIndex < measuredCluster.pieces.length; measuredIndex++) {
            measuredCluster.height += measuredCluster.pieces[measuredIndex].maxY -
                measuredCluster.pieces[measuredIndex].minY;
            if (measuredIndex > 0) {
                measuredCluster.height += COPY_GAP;
            }
        }
    }

    var rowTop = 0;
    for (var sizeIndex = 0; sizeIndex < sizeOrder.length; sizeIndex++) {
        var currentSize = sizeOrder[sizeIndex];
        var clusters = clustersBySize[currentSize] || [];

        clusters.sort(function (a, b) {
            if (b.area !== a.area) {
                return b.area - a.area;
            }
            return a.clusterKey < b.clusterKey ? -1 : 1;
        });

        var columnLeft = 0;
        var rowHeight = 0;
        for (var pieceIndex = 0; pieceIndex < clusters.length; pieceIndex++) {
            var arrangedCluster = clusters[pieceIndex];
            var copyTop = rowTop;

            for (var copyIndex = 0; copyIndex < arrangedCluster.pieces.length; copyIndex++) {
                var arrangedPiece = arrangedCluster.pieces[copyIndex];
                var height = arrangedPiece.maxY - arrangedPiece.minY;
                var offsetX = columnLeft - arrangedPiece.minX;
                var offsetY = copyTop - arrangedPiece.maxY;

                for (var shapeIndex = 0; shapeIndex < arrangedPiece.shapes.length; shapeIndex++) {
                    var arrangedShape = arrangedPiece.shapes[shapeIndex];
                    arrangedShape._dxfLayoutSizeIndex = sizeIndex;
                    arrangedShape._dxfLayoutPieceIndex = pieceIndex;
                    arrangedShape._dxfLayoutCopyIndex = copyIndex;
                    for (var arrangedPointIndex = 0; arrangedPointIndex < arrangedShape.points.length; arrangedPointIndex++) {
                        arrangedShape.points[arrangedPointIndex][0] += offsetX;
                        arrangedShape.points[arrangedPointIndex][1] += offsetY;
                    }
                }
                copyTop -= height + COPY_GAP;
            }
            columnLeft += arrangedCluster.width + PIECE_GAP;
            rowHeight = Math.max(rowHeight, arrangedCluster.height);
        }
        rowTop -= rowHeight + SIZE_GAP;
    }

    shapes.sort(function (a, b) {
        if (a._dxfLayoutSizeIndex !== b._dxfLayoutSizeIndex) {
            return a._dxfLayoutSizeIndex - b._dxfLayoutSizeIndex;
        }
        if (a._dxfLayoutPieceIndex !== b._dxfLayoutPieceIndex) {
            return a._dxfLayoutPieceIndex - b._dxfLayoutPieceIndex;
        }
        if (a._dxfLayoutCopyIndex !== b._dxfLayoutCopyIndex) {
            return a._dxfLayoutCopyIndex - b._dxfLayoutCopyIndex;
        }
        return a._dxfSourceOrder - b._dxfSourceOrder;
    });
}

function getDxfPolygonArea(points) {
    var area = 0;
    for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
        area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
    }
    return area / 2;
}

function getDxfPieceQuantitySummary(shapes) {
    var seen = {};
    var summary = { groupCount: 0, quantityTotal: 0 };

    for (var i = 0; i < shapes.length; i++) {
        var sizeName = shapes[i].sizeName || "未知尺码";
        var pieceKey = shapes[i].pieceKey || "entities";
        var key = "size:" + sizeName + "|piece:" + pieceKey;
        if (seen[key]) {
            continue;
        }
        seen[key] = true;
        summary.groupCount++;
        summary.quantityTotal += Math.max(1, parseInt(shapes[i].pieceQuantity, 10) || 1);
    }
    return summary;
}

function appendAamaNotchShapes(shapes, entity, notchKeys, notchStyle) {
    var x = getDxfValue(entity, 10, 0);
    var y = getDxfValue(entity, 20, 0);
    var notchType = Math.max(1, Math.round(Math.abs(getDxfValue(entity, 30, 1))));
    var angleDegrees = getDxfValue(entity, 50, 0);

    // ETCAD 会在同一位置重复写入刀口 POINT，按坐标、方向和类型去重。
    var key = Math.round(x * 1000) + ":" +
        Math.round(y * 1000) + ":" +
        Math.round(angleDegrees * 100) + ":" + notchType;
    if (notchKeys[key]) {
        return;
    }
    notchKeys[key] = true;

    // AAMA 图层 4：10/20 为刀口位置，50 为方向角，30 为刀口类型。
    // 该线段用于保存刀口方向；实际绘制长度统一为 5mm，多刀口间距为 3mm。
    var notchLength = 5;
    var notchSpacing = 3;
    var radians = angleDegrees * Math.PI / 180;
    var directionX = Math.cos(radians);
    var directionY = Math.sin(radians);
    var normalX = -directionY;
    var normalY = directionX;

    for (var i = 0; i < notchType; i++) {
        var offset = (i - (notchType - 1) / 2) * notchSpacing;
        var baseX = x + normalX * offset;
        var baseY = y + normalY * offset;
        shapes.push(makeDxfShape([
            [baseX, baseY],
            [baseX + directionX * notchLength, baseY + directionY * notchLength]
        ], false, "notch", true));
    }
}

function hasDuplicateDxfBlockNames(blocks) {
    var seenNames = {};
    for (var i = 0; i < blocks.length; i++) {
        var normalizedName = String(blocks[i].name).toUpperCase();
        if (seenNames[normalizedName]) {
            return true;
        }
        seenNames[normalizedName] = true;
    }
    return false;
}

function createDxfShapeTemplates(entities, notchStyle) {
    var templates = convertDxfEntitiesToShapes(entities, notchStyle);
    classifyAamaNotchesByBoundary(templates);
    mergeAamaNearbyNotchRecords(templates);
    prepareDxfFallbackAnchorMetadata(templates);
    return templates;
}

function prepareDxfFallbackAnchorMetadata(shapes) {
    for (var shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        var shape = shapes[shapeIndex];
        if ((String(shape.dxfLayer) === "1" || String(shape.dxfLayer) === "14") &&
            shape.points.length > 1 &&
            (!shape.aamaAnchorPointIndices || shape.aamaAnchorPointIndices.length === 0)) {
            shape.aamaAnchorPointIndices = getDxfShapeAnchorPointIndices(shape);
        }
    }
}

function createDxfBlockShapeCache(blocks, notchStyle) {
    var cache = {
        indexByName: {},
        shapesByIndex: []
    };
    for (var blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        var normalizedName = String(blocks[blockIndex].name).toUpperCase();
        if (cache.indexByName[normalizedName] === undefined) {
            cache.indexByName[normalizedName] = blockIndex;
        }
        cache.shapesByIndex[blockIndex] = createDxfShapeTemplates(
            blocks[blockIndex].entities, notchStyle
        );
        prepareAamaGradeMetadataForShapes(
            cache.shapesByIndex[blockIndex], blocks[blockIndex]
        );
    }
    return cache;
}

function appendInsertedDxfBlocks(
    shapes, entities, blocks, gradeTable, sizeIndex, sizeName, blockShapeCache
) {
    for (var i = 0; i < entities.length; i++) {
        if (entities[i].type !== "INSERT") {
            continue;
        }

        var names = [];
        for (var p = 0; p < entities[i].pairs.length; p++) {
            if (entities[i].pairs[p].code === 2) {
                names.push(entities[i].pairs[p].value);
            }
        }
        if (names.length === 0) {
            continue;
        }

        var blockIndex = blockShapeCache.indexByName[String(names[0]).toUpperCase()];
        if (blockIndex === undefined) {
            continue;
        }
        var block = blocks[blockIndex];

        var blockShapes = cloneDxfShapes(blockShapeCache.shapesByIndex[blockIndex]);
        applyAamaGradeToBlockShapes(blockShapes, block, gradeTable, sizeIndex);
        snapAamaNotchesToAssignedBoundary(blockShapes);
        constrainAamaTechlinesToInnerBoundary(blockShapes);
        var pieceSize = sizeName || getDxfBlockSize(block);
        var pieceQuantity = getDxfBlockQuantity(block);
        var pieceKey = "insert-" + i;
        var pieceLabel = "裁片 " + (i + 1);
        var insertX = getDxfValue(entities[i], 10, 0);
        var insertY = getDxfValue(entities[i], 20, 0);
        var scaleX = getDxfValue(entities[i], 41, 1);
        var scaleY = getDxfValue(entities[i], 42, 1);
        var rotation = getDxfValue(entities[i], 50, 0) * Math.PI / 180;

        for (var j = 0; j < blockShapes.length; j++) {
            var transformedShape = transformDxfShape(
                blockShapes[j],
                block.baseX,
                block.baseY,
                insertX,
                insertY,
                scaleX,
                scaleY,
                rotation
            );
            transformedShape.pieceKey = pieceKey;
            transformedShape.pieceLabel = pieceLabel;
            transformedShape.pieceBaseLabel = pieceLabel;
            transformedShape.sizeName = pieceSize;
            transformedShape.pieceQuantity = pieceQuantity;
            shapes.push(transformedShape);
        }
    }
}

function appendStandaloneDxfBlocks(
    shapes, blocks, gradeTable, sizeIndex, sizeName, blockShapeCache
) {
    for (var i = 0; i < blocks.length; i++) {
        var blockShapes = cloneDxfShapes(blockShapeCache.shapesByIndex[i]);
        applyAamaGradeToBlockShapes(blockShapes, blocks[i], gradeTable, sizeIndex);
        snapAamaNotchesToAssignedBoundary(blockShapes);
        constrainAamaTechlinesToInnerBoundary(blockShapes);
        var pieceSize = sizeName || getDxfBlockSize(blocks[i]);
        var pieceQuantity = getDxfBlockQuantity(blocks[i]);
        var pieceKey = "block-" + i;
        var pieceLabel = "裁片 " + (i + 1);
        for (var j = 0; j < blockShapes.length; j++) {
            blockShapes[j].pieceKey = pieceKey;
            blockShapes[j].pieceLabel = pieceLabel;
            blockShapes[j].pieceBaseLabel = pieceLabel;
            blockShapes[j].sizeName = pieceSize;
            blockShapes[j].pieceQuantity = pieceQuantity;
            shapes.push(blockShapes[j]);
        }
    }
}

function transformDxfShape(shape, baseX, baseY, insertX, insertY, scaleX, scaleY, rotation) {
    var points = [];
    var cosine = Math.cos(rotation);
    var sine = Math.sin(rotation);

    for (var i = 0; i < shape.points.length; i++) {
        var localX = (shape.points[i][0] - baseX) * scaleX;
        var localY = (shape.points[i][1] - baseY) * scaleY;
        points.push([
            insertX + localX * cosine - localY * sine,
            insertY + localX * sine + localY * cosine
        ]);
    }

    var transformedShape = makeDxfShape(points, shape.closed, shape.kind, shape.notchStart);
    transformedShape.sourceEntityIndex = shape.sourceEntityIndex;
    transformedShape.dxfLayer = shape.dxfLayer;
    transformedShape.notchBoundaryLayer = shape.notchBoundaryLayer;
    transformedShape.notchBoundaryShapeIndex = shape.notchBoundaryShapeIndex;
    transformedShape.notchBoundarySegmentIndex = shape.notchBoundarySegmentIndex;
    transformedShape.notchBoundaryProjection = shape.notchBoundaryProjection;
    transformedShape.skipNotch = shape.skipNotch;
    transformedShape.pieceQuantity = shape.pieceQuantity;
    transformedShape.pieceBaseLabel = shape.pieceBaseLabel;
    transformedShape.aamaAnchorPointIndices = shape.aamaAnchorPointIndices;
    transformedShape.aamaAnchorRuleNumbers = shape.aamaAnchorRuleNumbers;
    transformedShape.aamaGradeRefs = shape.aamaGradeRefs;
    return transformedShape;
}

function makeDxfArcPoints(centerX, centerY, radius, startDegrees, endDegrees) {
    var points = [];
    var end = endDegrees;
    if (end <= startDegrees) {
        end += 360;
    }

    var segmentCount = Math.max(12, Math.ceil((end - startDegrees) / 10));
    for (var i = 0; i <= segmentCount; i++) {
        var degrees = startDegrees + (end - startDegrees) * i / segmentCount;
        var radians = degrees * Math.PI / 180;
        points.push([
            centerX + radius * Math.cos(radians),
            centerY + radius * Math.sin(radians)
        ]);
    }
    return points;
}

function getDxfBounds(shapes) {
    var bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (var i = 0; i < shapes.length; i++) {
        for (var j = 0; j < shapes[i].points.length; j++) {
            var point = shapes[i].points[j];
            bounds.minX = Math.min(bounds.minX, point[0]);
            bounds.minY = Math.min(bounds.minY, point[1]);
            bounds.maxX = Math.max(bounds.maxX, point[0]);
            bounds.maxY = Math.max(bounds.maxY, point[1]);
        }
    }
    return bounds;
}
