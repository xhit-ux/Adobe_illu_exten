// DXF/RUL 文件结构解析与 AAMA 放码规则

function readDxfPairs(dxfText) {
    var pairs = [];
    var position = 0;
    var textLength = dxfText.length;

    function readNextDxfLine() {
        if (position >= textLength) {
            return null;
        }
        var start = position;
        while (position < textLength) {
            var characterCode = dxfText.charCodeAt(position);
            if (characterCode === 10 || characterCode === 13) {
                break;
            }
            position++;
        }
        var line = dxfText.substring(start, position);
        if (position < textLength && dxfText.charCodeAt(position) === 13) {
            position++;
        }
        if (position < textLength && dxfText.charCodeAt(position) === 10) {
            position++;
        }
        return line;
    }

    while (position < textLength) {
        var codeLine = readNextDxfLine();
        var valueLine = readNextDxfLine();
        if (codeLine === null || valueLine === null) {
            break;
        }
        var code = parseInt(codeLine.replace(/^\s+|\s+$/g, ""), 10);
        if (!isNaN(code)) {
            pairs.push({
                code: code,
                value: valueLine.replace(/^\s+|\s+$/g, "")
            });
        }
    }
    return pairs;
}

function readAamaRulFile(filePath) {
    if (!filePath) {
        return null;
    }

    var rulFile = new File(filePath);
    if (!rulFile.exists) {
        throw new Error("找不到 RUL 文件: " + filePath);
    }

    rulFile.encoding = "BINARY";
    if (!rulFile.open("r")) {
        throw new Error("无法读取 RUL 文件: " + filePath);
    }
    var rulText = rulFile.read();
    rulFile.close();

    var gradeTable = parseAamaRul(rulText);
    if (gradeTable === null || gradeTable.sizes.length === 0) {
        throw new Error("RUL 文件中没有找到 SIZE LIST: " + rulFile.displayName);
    }
    gradeTable.fileName = rulFile.displayName;
    return gradeTable;
}

function parseAamaRul(rulText) {
    var lines = rulText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var sizes = [];
    var sampleSize = "";
    var rules = {};

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/^\s+|\s+$/g, "");

        if (line.indexOf("SIZE LIST:") === 0) {
            var sizeText = line.substring("SIZE LIST:".length).replace(/^\s+|\s+$/g, "");
            sizes = sizeText.split(/\s+/);
        } else if (line.indexOf("SAMPLE SIZE:") === 0) {
            sampleSize = line.substring("SAMPLE SIZE:".length).replace(/^\s+|\s+$/g, "");
        } else {
            var ruleMatch = /^RULE:\s*DELTA\s+(\d+)/i.exec(line);
            if (ruleMatch && i + 1 < lines.length) {
                var numberText = lines[++i];
                var numberMatches = numberText.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g) || [];
                var offsets = [];

                for (var valueIndex = 0; valueIndex + 1 < numberMatches.length; valueIndex += 2) {
                    offsets.push([
                        parseFloat(numberMatches[valueIndex]),
                        parseFloat(numberMatches[valueIndex + 1])
                    ]);
                }
                rules[parseInt(ruleMatch[1], 10)] = offsets;
            }
        }
    }

    if (sizes.length === 0 || sampleSize === "") {
        return null;
    }

    return { sizes: sizes, sampleSize: sampleSize, rules: rules };
}

function readDxfEntities(pairs) {
    var entities = [];
    var inEntities = false;
    var waitingForSectionName = false;
    var current = null;

    function pushCurrent() {
        if (current !== null) {
            entities.push(current);
            current = null;
        }
    }

    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];

        if (pair.code === 0 && pair.value === "SECTION") {
            pushCurrent();
            waitingForSectionName = true;
            inEntities = false;
            continue;
        }

        if (waitingForSectionName && pair.code === 2) {
            inEntities = pair.value.toUpperCase() === "ENTITIES";
            waitingForSectionName = false;
            continue;
        }

        if (pair.code === 0 && pair.value === "ENDSEC") {
            pushCurrent();
            inEntities = false;
            continue;
        }

        if (!inEntities) {
            continue;
        }

        if (pair.code === 0) {
            pushCurrent();
            current = { type: pair.value.toUpperCase(), pairs: [] };
        } else if (current !== null) {
            current.pairs.push(pair);
        }
    }

    pushCurrent();
    return entities;
}

function readDxfBlocks(pairs) {
    var blocks = [];
    var inBlocks = false;
    var waitingForSectionName = false;
    var block = null;
    var currentEntity = null;

    function pushEntity() {
        if (block !== null && currentEntity !== null) {
            block.entities.push(currentEntity);
            currentEntity = null;
        }
    }

    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];

        if (pair.code === 0 && pair.value === "SECTION") {
            waitingForSectionName = true;
            inBlocks = false;
            continue;
        }

        if (waitingForSectionName && pair.code === 2) {
            inBlocks = pair.value.toUpperCase() === "BLOCKS";
            waitingForSectionName = false;
            continue;
        }

        if (!inBlocks) {
            continue;
        }

        if (pair.code === 0 && pair.value === "ENDSEC") {
            pushEntity();
            inBlocks = false;
            continue;
        }

        if (pair.code === 0 && pair.value === "BLOCK") {
            pushEntity();
            block = { name: "", baseX: 0, baseY: 0, headerPairs: [], entities: [] };
            continue;
        }

        if (pair.code === 0 && pair.value === "ENDBLK") {
            pushEntity();
            if (block !== null) {
                blocks.push(block);
                block = null;
            }
            continue;
        }

        if (block === null) {
            continue;
        }

        if (pair.code === 0) {
            pushEntity();
            currentEntity = { type: pair.value.toUpperCase(), pairs: [] };
        } else if (currentEntity !== null) {
            currentEntity.pairs.push(pair);
        } else {
            block.headerPairs.push(pair);
            if (pair.code === 2) {
                block.name = pair.value;
            } else if (pair.code === 10) {
                block.baseX = parseFloat(pair.value) || 0;
            } else if (pair.code === 20) {
                block.baseY = parseFloat(pair.value) || 0;
            }
        }
    }

    return blocks;
}

function getDxfValues(entity, code) {
    var values = [];
    for (var i = 0; i < entity.pairs.length; i++) {
        if (entity.pairs[i].code === code) {
            values.push(parseFloat(entity.pairs[i].value));
        }
    }
    return values;
}

function getDxfValue(entity, code, fallback) {
    for (var i = 0; i < entity.pairs.length; i++) {
        if (entity.pairs[i].code === code) {
            var value = parseFloat(entity.pairs[i].value);
            return isNaN(value) ? fallback : value;
        }
    }
    return fallback;
}

function getDxfRawValue(entity, code, fallback) {
    for (var i = 0; i < entity.pairs.length; i++) {
        if (entity.pairs[i].code === code) {
            return entity.pairs[i].value;
        }
    }
    return fallback;
}

function getDxfBlockSize(block) {
    for (var i = 0; i < block.entities.length; i++) {
        if (block.entities[i].type !== "TEXT") {
            continue;
        }

        var text = String(getDxfRawValue(block.entities[i], 1, ""));
        var match = /^Size:\s*(.+)$/i.exec(text);
        if (match && match[1]) {
            return match[1].replace(/^\s+|\s+$/g, "").toUpperCase();
        }
    }
    return "未知尺码";
}

function getDxfBlockQuantity(block) {
    for (var i = 0; i < block.entities.length; i++) {
        if (block.entities[i].type !== "TEXT") {
            continue;
        }

        var text = String(getDxfRawValue(block.entities[i], 1, ""));
        var match = /^Quantity\s*:\s*(\d+)/i.exec(text);
        if (match) {
            return Math.max(1, parseInt(match[1], 10) || 1);
        }
    }
    return 1;
}

function getAamaPieceQuantityFromNote(note) {
    var match = /\|QTY\|(\d+)/.exec(String(note || ""));
    return match ? Math.max(1, parseInt(match[1], 10) || 1) : 1;
}

function getAamaRuleNumber(textEntity) {
    if (!textEntity || textEntity.type !== "TEXT") {
        return null;
    }

    var match = /^#\s*(\d+)/.exec(String(getDxfRawValue(textEntity, 1, "")));
    return match ? parseInt(match[1], 10) : null;
}

function getAamaRuleDelta(gradeTable, ruleNumber, sizeIndex) {
    if (!gradeTable || ruleNumber === null || !gradeTable.rules[ruleNumber]) {
        return [0, 0];
    }

    var offsets = gradeTable.rules[ruleNumber];
    return sizeIndex < offsets.length ? offsets[sizeIndex] : [0, 0];
}

function collectAamaGradeRefsForShape(block, shape) {
    var refs = [];
    var entities = block.entities;
    var startIndex = shape.sourceEntityIndex;

    if (shape.kind === "notch") {
        var notchRule = getAamaRuleNumber(entities[startIndex + 1]);
        if (notchRule !== null) {
            refs.push({
                x: shape.points[0][0],
                y: shape.points[0][1],
                ruleNumber: notchRule
            });
        }
        return refs;
    }

    for (var i = startIndex + 1; i < entities.length; i++) {
        var entity = entities[i];
        if (entity.type === "POLYLINE" || entity.type === "LWPOLYLINE" ||
            entity.type === "LINE" || entity.type === "CIRCLE" || entity.type === "ARC") {
            break;
        }

        if (entity.type === "POINT" && getDxfEntityLayer(entity) === "2") {
            var ruleNumber = getAamaRuleNumber(entities[i + 1]);
            if (ruleNumber !== null) {
                refs.push({
                    x: getDxfValue(entity, 10, 0),
                    y: getDxfValue(entity, 20, 0),
                    ruleNumber: ruleNumber
                });
            }
        }
    }
    return refs;
}

function applyAamaGradeToBlockShapes(shapes, block, gradeTable, sizeIndex) {
    for (var i = 0; i < shapes.length; i++) {
        var shape = shapes[i];
        var refs = shape.aamaGradeRefs || collectAamaGradeRefsForShape(block, shape);
        if ((String(shape.dxfLayer) === "1" || String(shape.dxfLayer) === "14") &&
            shape.closed && !shape.aamaAnchorPointIndices) {
            shape.aamaAnchorPointIndices = getAamaAnchorPointIndices(shape, refs);
        }
        if ((String(shape.dxfLayer) === "1" || String(shape.dxfLayer) === "14") &&
            shape.closed && !shape.aamaAnchorRuleNumbers) {
            shape.aamaAnchorRuleNumbers = getAamaAnchorRuleNumbers(shape, refs);
        }
        if (refs.length === 0) {
            continue;
        }

        if (!gradeTable) {
            continue;
        }

        if (shape.kind === "notch") {
            var notchDelta = getAamaRuleDelta(gradeTable, refs[0].ruleNumber, sizeIndex);
            for (var notchPoint = 0; notchPoint < shape.points.length; notchPoint++) {
                shape.points[notchPoint][0] += notchDelta[0];
                shape.points[notchPoint][1] += notchDelta[1];
            }
        } else {
            applyAamaInterpolatedGrade(shape, refs, gradeTable, sizeIndex);
        }
    }
}

function prepareAamaGradeMetadataForShapes(shapes, block) {
    for (var shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
        var shape = shapes[shapeIndex];
        shape.aamaGradeRefs = collectAamaGradeRefsForShape(block, shape);
        if ((String(shape.dxfLayer) === "1" || String(shape.dxfLayer) === "14") &&
            shape.closed) {
            var gradeAnchorIndices = getAamaAnchorPointIndices(
                shape, shape.aamaGradeRefs
            );
            if (gradeAnchorIndices.length > 0) {
                shape.aamaAnchorPointIndices = gradeAnchorIndices;
            }
            shape.aamaAnchorRuleNumbers = getAamaAnchorRuleNumbers(
                shape, shape.aamaGradeRefs
            );
        }
    }
}

function getAamaAnchorRuleNumbers(shape, refs) {
    var rulesByPointIndex = {};
    var toleranceSquared = 0.05 * 0.05;
    for (var refIndex = 0; refIndex < refs.length; refIndex++) {
        var closestIndex = -1;
        var closestDistance = Infinity;
        for (var pointIndex = 0; pointIndex < shape.points.length; pointIndex++) {
            var differenceX = shape.points[pointIndex][0] - refs[refIndex].x;
            var differenceY = shape.points[pointIndex][1] - refs[refIndex].y;
            var distance = differenceX * differenceX + differenceY * differenceY;
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = pointIndex;
            }
        }
        if (closestIndex >= 0 && closestDistance <= toleranceSquared &&
            rulesByPointIndex[closestIndex] === undefined) {
            rulesByPointIndex[closestIndex] = refs[refIndex].ruleNumber;
        }
    }
    return rulesByPointIndex;
}

function getAamaAnchorPointIndices(shape, refs) {
    var indices = [];
    var seen = {};
    var toleranceSquared = 0.05 * 0.05;
    for (var refIndex = 0; refIndex < refs.length; refIndex++) {
        var closestIndex = -1;
        var closestDistance = Infinity;
        for (var pointIndex = 0; pointIndex < shape.points.length; pointIndex++) {
            var differenceX = shape.points[pointIndex][0] - refs[refIndex].x;
            var differenceY = shape.points[pointIndex][1] - refs[refIndex].y;
            var distance = differenceX * differenceX + differenceY * differenceY;
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = pointIndex;
            }
        }
        if (closestIndex >= 0 && closestDistance <= toleranceSquared && !seen[closestIndex]) {
            seen[closestIndex] = true;
            indices.push(closestIndex);
        }
    }
    indices.sort(function (a, b) { return a - b; });
    return indices;
}

function applyAamaInterpolatedGrade(shape, refs, gradeTable, sizeIndex) {
    var originalPoints = [];
    var controlsByIndex = {};
    var controls = [];
    var toleranceSquared = 0.05 * 0.05;

    for (var i = 0; i < shape.points.length; i++) {
        originalPoints.push([shape.points[i][0], shape.points[i][1]]);
    }

    for (var refIndex = 0; refIndex < refs.length; refIndex++) {
        var closestIndex = -1;
        var closestDistance = Infinity;

        for (var pointIndex = 0; pointIndex < originalPoints.length; pointIndex++) {
            var dx = originalPoints[pointIndex][0] - refs[refIndex].x;
            var dy = originalPoints[pointIndex][1] - refs[refIndex].y;
            var distance = dx * dx + dy * dy;
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = pointIndex;
            }
        }

        if (closestIndex >= 0 && closestDistance <= toleranceSquared && !controlsByIndex[closestIndex]) {
            var control = {
                index: closestIndex,
                delta: getAamaRuleDelta(gradeTable, refs[refIndex].ruleNumber, sizeIndex)
            };
            controlsByIndex[closestIndex] = control;
            controls.push(control);
        }
    }

    controls.sort(function (a, b) { return a.index - b.index; });
    if (controls.length === 0) {
        return;
    }

    if (controls.length === 1) {
        for (var singleIndex = 0; singleIndex < shape.points.length; singleIndex++) {
            shape.points[singleIndex][0] += controls[0].delta[0];
            shape.points[singleIndex][1] += controls[0].delta[1];
        }
        return;
    }

    if (!shape.closed) {
        // 控制点本身由插值段处理；端点若再次整段平移会使开放线端点的放码量翻倍。
        applyAamaConstantDelta(shape.points, 0, controls[0].index - 1, controls[0].delta);
        for (var openIndex = 0; openIndex < controls.length - 1; openIndex++) {
            applyAamaGradeSegment(
                shape.points, originalPoints,
                controls[openIndex], controls[openIndex + 1], false
            );
        }
        applyAamaConstantDelta(
            shape.points,
            controls[controls.length - 1].index + 1,
            shape.points.length - 1,
            controls[controls.length - 1].delta
        );
    } else {
        for (var closedIndex = 0; closedIndex < controls.length; closedIndex++) {
            applyAamaGradeSegment(
                shape.points, originalPoints,
                controls[closedIndex], controls[(closedIndex + 1) % controls.length], true
            );
        }
    }
}

function applyAamaConstantDelta(points, startIndex, endIndex, delta) {
    for (var i = startIndex; i <= endIndex; i++) {
        points[i][0] += delta[0];
        points[i][1] += delta[1];
    }
}

function applyAamaGradeSegment(points, originalPoints, startControl, endControl, allowWrap) {
    var indices = [startControl.index];
    var currentIndex = startControl.index;

    while (currentIndex !== endControl.index) {
        currentIndex++;
        if (currentIndex >= points.length) {
            if (!allowWrap) {
                break;
            }
            currentIndex = 0;
        }
        indices.push(currentIndex);
        if (indices.length > points.length + 1) {
            break;
        }
    }

    var distances = [0];
    var totalDistance = 0;
    for (var i = 1; i < indices.length; i++) {
        var previous = originalPoints[indices[i - 1]];
        var current = originalPoints[indices[i]];
        var dx = current[0] - previous[0];
        var dy = current[1] - previous[1];
        totalDistance += Math.sqrt(dx * dx + dy * dy);
        distances.push(totalDistance);
    }

    for (var pointOffset = 0; pointOffset < indices.length; pointOffset++) {
        var ratio = totalDistance === 0 ? 0 : distances[pointOffset] / totalDistance;
        var deltaX = startControl.delta[0] + (endControl.delta[0] - startControl.delta[0]) * ratio;
        var deltaY = startControl.delta[1] + (endControl.delta[1] - startControl.delta[1]) * ratio;
        var pointIndex = indices[pointOffset];
        points[pointIndex][0] = originalPoints[pointIndex][0] + deltaX;
        points[pointIndex][1] = originalPoints[pointIndex][1] + deltaY;
    }
}
