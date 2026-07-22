// 名字/号码参数样例与个性化订单输出

function trimDxfOrderValue(value) {
    return String(value === undefined || value === null ? "" : value).replace(
        /^\s+|\s+$/g, ""
    );
}

function sanitizeDxfOrderMetadataValue(value) {
    return trimDxfOrderValue(value).replace(/[\r\n|]+/g, " ");
}

function unlockDxfOrderItem(item) {
    try {
        item.locked = false;
    } catch (unlockError) {
        // Some Illustrator page items do not expose a writable lock state.
    }
}

// ---- 样例层辅助函数 ----

function findDxfSampleItemInCollection(collection, sampleLayer, itemName) {
    if (!collection) {
        return null;
    }
    var itemCount = 0;
    try {
        itemCount = collection.length;
    } catch (collectionReadError) {
        return null;
    }
    for (var itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        try {
            var item = collection[itemIndex];
            if (item.parent === sampleLayer &&
                String(item.name || "") === itemName) {
                return item;
            }
        } catch (itemReadError) {
            // 跳过无效样例元素
        }
    }
    return null;
}

function findDxfSampleItemByName(sampleLayer, itemName) {
    if (sampleLayer === null || !itemName) {
        return null;
    }
    var collectionNames = [
        "pageItems", "groupItems", "textFrames", "compoundPathItems",
        "pathItems", "placedItems", "rasterItems", "symbolItems"
    ];
    for (var collectionIndex = 0;
        collectionIndex < collectionNames.length; collectionIndex++) {
        var collection = null;
        try {
            collection = sampleLayer[collectionNames[collectionIndex]];
        } catch (collectionAccessError) {
            continue;
        }
        var match = findDxfSampleItemInCollection(
            collection, sampleLayer, itemName
        );
        if (match !== null) {
            return match;
        }
    }
    return null;
}

function ensureDxfPersonalizedOrderSampleLayer(doc, layerName) {
    var layer = findDxfLayerByName(doc, layerName);
    if (layer === null) {
        // 兼容旧版图层名：LanTu_姓名参数样例 → LanTu_名字参数样例
        if (layerName === "LanTu_名字参数样例") {
            var legacyNameLayer = findDxfLayerByName(doc, "LanTu_姓名参数样例");
            if (legacyNameLayer !== null) {
                legacyNameLayer.locked = false;
                legacyNameLayer.name = "LanTu_名字参数样例";
                return legacyNameLayer;
            }
        }
        layer = doc.layers.add();
        layer.name = layerName;
    }
    layer.locked = false;
    layer.visible = true;
    try {
        layer.printable = false;
    } catch (printableError) {
        // Older Illustrator versions may not expose Layer.printable.
    }
    return layer;
}

// ---- 生成参数样例图层（仅创建空图层，用户手动添加命名元素） ----

function ensureDxfPersonalizedOrderSamples() {
    try {
        if (app.documents.length === 0) {
            return "请先打开 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        ensureDxfPersonalizedOrderSampleLayer(doc, "LanTu_名字参数样例");
        ensureDxfPersonalizedOrderSampleLayer(doc, "LanTu_数字号码参数样例");
        return "名字与数字号码参数样例图层已生成！\n" +
            "图层: LanTu_名字参数样例\n" +
            "图层: LanTu_数字号码参数样例\n" +
            "名字贴图：添加以订单名字命名的样例元素；\n" +
            "号码贴图：添加图层直属的 0~9 独立元素，并命名为对应数字；\n" +
            "若为文字元素，则无需操作样例图层，提交订单时会直接替换文字内容。";
    } catch (error) {
        return "生成名字/号码参数样例失败: " + error.message +
            "（行号: " + error.line + "）";
    }
}

// ---- 获取参数样例图层 ----

function getDxfPersonalizedOrderSampleLayer(doc, layerName) {
    var layer = findDxfLayerByName(doc, layerName);
    if (layer === null && layerName === "LanTu_名字参数样例") {
        layer = findDxfLayerByName(doc, "LanTu_姓名参数样例");
    }
    return layer;
}

// ---- 订单数据规范化 ----

function normalizeDxfOrderSizeKey(value) {
    return trimDxfOrderValue(value).toUpperCase();
}

function normalizeDxfPersonalizedOrderRows(orderRows) {
    if (!orderRows || orderRows.length === 0) {
        throw new Error("订单表格中没有可提交的数据");
    }
    var normalizedRows = [];
    for (var rowIndex = 0; rowIndex < orderRows.length; rowIndex++) {
        var sourceRow = orderRows[rowIndex] || {};
        var rowNumber = rowIndex + 1;
        var quantityText = trimDxfOrderValue(sourceRow.quantity);
        var quantity = parseInt(quantityText, 10);
        var row = {
            orderCode: trimDxfOrderValue(sourceRow.orderCode),
            size: trimDxfOrderValue(sourceRow.size),
            name: trimDxfOrderValue(sourceRow.name),
            number: trimDxfOrderValue(sourceRow.number),
            quantity: quantity,
            rowNumber: rowNumber
        };
        if (!row.orderCode) {
            throw new Error("第 " + rowNumber + " 行缺少订单编号");
        }
        if (!row.size) {
            throw new Error("第 " + rowNumber + " 行缺少尺码");
        }
        if (!/^\d+$/.test(quantityText) || isNaN(quantity) || quantity < 1) {
            throw new Error("第 " + rowNumber + " 行件数必须是正整数");
        }
        normalizedRows.push(row);
    }
    return normalizedRows;
}

function findDxfOrderSizeGroup(sizeGroups, requestedSize) {
    var requestedKey = normalizeDxfOrderSizeKey(requestedSize);
    var match = null;
    for (var sizeIndex = 0; sizeIndex < sizeGroups.length; sizeIndex++) {
        if (normalizeDxfOrderSizeKey(
            getDxfSizeNameFromGroup(sizeGroups[sizeIndex])
        ) !== requestedKey) {
            continue;
        }
        if (match !== null) {
            throw new Error("文档中存在重复尺码组：\"" + requestedSize + "\"");
        }
        match = sizeGroups[sizeIndex];
    }
    return match;
}

// ---- 裁片内名字/号码元素查找 ----

function isDxfOrderFieldItem(item, itemName) {
    try {
        var name = String(item.name || "");
        if (name.indexOf(itemName) >= 0) {
            return true;
        }
        var expectedFieldCode = itemName === "名字" ? "NAME" : "NUMBER";
        if (getDxfMetadataValue(item, "AAMA_ORDER_FIELD") === expectedFieldCode) {
            return true;
        }
        return item.typename === "TextFrame" &&
            trimDxfOrderValue(item.contents) === itemName;
    } catch (itemReadError) {
        return false;
    }
}

function getDxfNamedOrderItems(pieceGroup, itemName) {
    var matches = [];
    var queue = [{ container: pieceGroup, hasNamedAncestor: false }];
    for (var queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        var state = queue[queueIndex];
        var items = getDxfDirectInheritanceItems(state.container);
        for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
            var item = items[itemIndex];
            var isNamed = false;
            try {
                isNamed = isDxfOrderFieldItem(item, itemName);
                if (isNamed && !state.hasNamedAncestor) {
                    matches.push(item);
                }
                if (item.typename === "GroupItem") {
                    queue.push({
                        container: item,
                        hasNamedAncestor: state.hasNamedAncestor || isNamed
                    });
                }
            } catch (itemReadError) {
                // Ignore invalid Illustrator collection entries.
            }
        }
    }
    return matches;
}

// ---- 模板校验（仅统计，不再强制要求） ----

function validateDxfOrderTemplateItem(item, itemName, pieceName) {
    if (item.typename === "TextFrame") {
        return;
    }
    if (item.typename !== "GroupItem") {
        throw new Error("裁片\"" + pieceName + "\"的\"" + itemName +
            "\"必须是文字或编组元素");
    }
}

function validateDxfOrderSizeTemplates(sizeGroup) {
    var pieces = [];
    collectDxfPieceGroups(sizeGroup, pieces);
    if (pieces.length === 0) {
        throw new Error("尺码\"" + getDxfSizeNameFromGroup(sizeGroup) +
            "\"中没有裁片编组");
    }
    var summary = { pieceCount: pieces.length, nameCount: 0, numberCount: 0 };
    var fieldNames = ["名字", "号码"];
    for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
        var pieceName = String(pieces[pieceIndex].name || "裁片 " + (pieceIndex + 1));
        for (var fieldIndex = 0; fieldIndex < fieldNames.length; fieldIndex++) {
            var matches = getDxfNamedOrderItems(
                pieces[pieceIndex], fieldNames[fieldIndex]
            );
            for (var matchIndex = 0; matchIndex < matches.length; matchIndex++) {
                validateDxfOrderTemplateItem(
                    matches[matchIndex], fieldNames[fieldIndex], pieceName
                );
            }
            if (fieldNames[fieldIndex] === "名字") {
                summary.nameCount += matches.length;
            } else {
                summary.numberCount += matches.length;
            }
        }
    }
    return summary;
}

// ---- 几何辅助 ----

function getDxfOrderItemBounds(item) {
    try {
        return item.visibleBounds;
    } catch (visibleBoundsError) {
        try {
            return item.geometricBounds;
        } catch (geometricBoundsError) {
            return null;
        }
    }
}

function getDxfOrderBoundsCenter(bounds) {
    if (bounds === null) {
        return [0, 0];
    }
    return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

function getDxfOrderItemPosition(item, bounds) {
    try {
        return [item.position[0], item.position[1]];
    } catch (positionReadError) {
        return [bounds[0], bounds[1]];
    }
}

function positionDxfOrderItemAtPosition(item, targetPosition) {
    try {
        item.position = [targetPosition[0], targetPosition[1]];
        return;
    } catch (positionWriteError) {
        var bounds = getDxfOrderItemBounds(item);
        if (bounds === null) {
            throw new Error("无法读取元素位置");
        }
        item.translate(
            targetPosition[0] - bounds[0],
            targetPosition[1] - bounds[1]
        );
    }
}

function positionDxfOrderItemAtCenter(item, targetCenter) {
    for (var attempt = 0; attempt < 2; attempt++) {
        var bounds = getDxfOrderItemBounds(item);
        if (bounds === null) {
            throw new Error("无法读取元素边界");
        }
        var center = getDxfOrderBoundsCenter(bounds);
        item.translate(targetCenter[0] - center[0], targetCenter[1] - center[1]);
    }
}

// ---- 号码数字排列组合 ----

function addUniqueDxfOrderValue(values, value) {
    for (var valueIndex = 0; valueIndex < values.length; valueIndex++) {
        if (values[valueIndex] === value) {
            return;
        }
    }
    values.push(value);
}

function composeDxfNumberGroupFromSamples(targetContainer, numberString, sampleLayer, templateItem) {
    var templateBounds = getDxfOrderItemBounds(templateItem);
    if (templateBounds === null) {
        throw new Error("无法读取号码模板边界");
    }

    var digits = String(numberString || "").split("");
    var validDigits = [];
    var missingDigits = [];
    for (var di = 0; di < digits.length; di++) {
        var digitItem = findDxfSampleItemByName(sampleLayer, digits[di]);
        if (digitItem === null) {
            addUniqueDxfOrderValue(missingDigits, digits[di]);
        } else {
            validDigits.push({ digit: digits[di], item: digitItem });
        }
    }
    if (missingDigits.length > 0) {
        return { group: null, missingDigits: missingDigits };
    }

    var composedGroup = targetContainer.groupItems.add();
    composedGroup.name = "号码";

    var digitGap = 10 * getDxfMillimeterToDocumentUnits(templateItem);
    var nextDigitLeft = 0;

    for (var vi = 0; vi < validDigits.length; vi++) {
        var digitCopy = validDigits[vi].item.duplicate(
            composedGroup, ElementPlacement.PLACEATEND
        );
        unlockDxfOrderItem(digitCopy);

        var digitBounds = getDxfOrderItemBounds(digitCopy);
        if (digitBounds === null) {
            composedGroup.remove();
            throw new Error("无法读取数字样例\"" + validDigits[vi].digit + "\"的边界");
        }

        // 保持样例元素原始尺寸和外观，仅按可见边界排列。
        var digitCenter = getDxfOrderBoundsCenter(digitBounds);
        digitCopy.translate(
            nextDigitLeft - digitBounds[0],
            -digitCenter[1]
        );
        digitBounds = getDxfOrderItemBounds(digitCopy);
        nextDigitLeft = digitBounds[2] + digitGap;
    }

    setDxfMetadataValue(composedGroup, "AAMA_ORDER_FIELD", "NUMBER");
    return { group: composedGroup, missingDigits: [] };
}

// ---- 核心替换逻辑：分岔处理文字 / 贴图编组 ----

function applyDxfOrderTemplateItem(
    pieceGroup, templateItem, itemName, contents, sampleLayer, fieldCode
) {
    var templateBounds = getDxfOrderItemBounds(templateItem);
    if (templateBounds === null) {
        throw new Error("无法读取\"" + itemName + "\"模板边界");
    }
    var targetCenter = getDxfOrderBoundsCenter(templateBounds);
    var targetPosition = getDxfOrderItemPosition(templateItem, templateBounds);
    unlockDxfOrderItem(templateItem);

    // ---- 情况 1：占位符是 TextFrame → 直接替换文字内容，继承基码样式 ----
    if (templateItem.typename === "TextFrame") {
        templateItem.contents = contents === "" ? " " : contents;
        positionDxfOrderItemAtCenter(templateItem, targetCenter);
        templateItem.name = itemName;
        setDxfMetadataValue(templateItem, "AAMA_ORDER_FIELD", fieldCode);
        return { replaced: true, reason: "text" };
    }

    if (templateItem.typename !== "GroupItem") {
        throw new Error("\"" + itemName + "\"占位元素必须是文字或编组元素");
    }

    // GroupItem 一律视为贴图编组。即使内部含有 TextFrame，也必须使用参数样例替换。
    if (contents === "") {
        return { replaced: false, reason: "empty-value" };
    }

    if (fieldCode === "NUMBER") {
        if (sampleLayer === null) {
            return { replaced: false, reason: "missing-number-layer" };
        }
        var numberResult = composeDxfNumberGroupFromSamples(
            templateItem.parent, contents, sampleLayer, templateItem
        );
        if (numberResult.group === null) {
            return {
                replaced: false,
                reason: "missing-digit-samples",
                values: numberResult.missingDigits
            };
        }
        templateItem.remove();
        positionDxfOrderItemAtCenter(numberResult.group, targetCenter);
        numberResult.group.name = "号码";
        setDxfMetadataValue(numberResult.group, "AAMA_ORDER_FIELD", fieldCode);
        return { replaced: true, reason: "number-sample" };
    }

    if (sampleLayer === null) {
        return { replaced: false, reason: "missing-name-layer" };
    }

    var sampleItem = findDxfSampleItemByName(sampleLayer, contents);
    if (sampleItem === null) {
        return { replaced: false, reason: "missing-name-sample", value: contents };
    }

    var replacement = sampleItem.duplicate(
        templateItem.parent, ElementPlacement.PLACEATEND
    );
    unlockDxfOrderItem(replacement);
    replacement.name = itemName;

    // 缩放到占位符尺寸
    var replacementBounds = getDxfOrderItemBounds(replacement);
    if (replacementBounds !== null) {
        var replWidth = replacementBounds[2] - replacementBounds[0];
        var replHeight = replacementBounds[1] - replacementBounds[3];
        var tplWidth = templateBounds[2] - templateBounds[0];
        var tplHeight = templateBounds[1] - templateBounds[3];
        if (replWidth > 0.000001 && replHeight > 0.000001 &&
            tplWidth > 0.000001 && tplHeight > 0.000001) {
            var sx = tplWidth / replWidth;
            var sy = tplHeight / replHeight;
            if (Math.abs(sx - 1) > 0.000001 || Math.abs(sy - 1) > 0.000001) {
                try {
                    replacement.resize(
                        sx * 100, sy * 100,
                        true, true, true, true,
                        Math.sqrt(sx * sy) * 100,
                        Transformation.CENTER
                    );
                } catch (resizeError) {
                    replacement.remove();
                    throw new Error("名字样例\"" + contents + "\"缩放失败");
                }
            }
        }
    }

    templateItem.remove();
    positionDxfOrderItemAtCenter(replacement, targetCenter);
    setDxfMetadataValue(replacement, "AAMA_ORDER_FIELD", fieldCode);
    return { replaced: true, reason: "name-sample" };
}

function applyDxfOrderFieldToPiece(pieceGroup, itemName, contents, sampleLayer, fieldCode) {
    var matches = getDxfNamedOrderItems(pieceGroup, itemName);
    var summary = {
        matched: matches.length,
        replaced: 0,
        skipped: 0,
        missingNameSamples: [],
        missingDigits: [],
        missingLayers: []
    };
    for (var matchIndex = 0; matchIndex < matches.length; matchIndex++) {
        var result = applyDxfOrderTemplateItem(
            pieceGroup, matches[matchIndex], itemName, contents, sampleLayer, fieldCode
        );
        if (result.replaced) {
            summary.replaced++;
            continue;
        }
        summary.skipped++;
        if (result.reason === "missing-name-sample") {
            addUniqueDxfOrderValue(summary.missingNameSamples, result.value);
        } else if (result.reason === "missing-digit-samples") {
            for (var digitIndex = 0; digitIndex < result.values.length; digitIndex++) {
                addUniqueDxfOrderValue(summary.missingDigits, result.values[digitIndex]);
            }
        } else if (result.reason === "missing-name-layer") {
            addUniqueDxfOrderValue(summary.missingLayers, "LanTu_名字参数样例");
        } else if (result.reason === "missing-number-layer") {
            addUniqueDxfOrderValue(summary.missingLayers, "LanTu_数字号码参数样例");
        }
    }
    return summary;
}

// ---- 订单元数据 ----

function buildDxfOrderSetNote(sourceNote, serial, row, copyNumber) {
    var sourceLines = String(sourceNote || "").split(/\r?\n/);
    var keptLines = [];
    var ignoredPrefixes = [
        "AAMA_SIZE|", "AAMA_SIZE_ID|", "AAMA_ORDER_SET|",
        "AAMA_ORDER_CODE|", "AAMA_ORDER_SIZE|", "AAMA_ORDER_NAME|",
        "AAMA_ORDER_NUMBER|", "AAMA_ORDER_COPY|"
    ];
    for (var lineIndex = 0; lineIndex < sourceLines.length; lineIndex++) {
        var line = sourceLines[lineIndex];
        var ignored = !line;
        for (var prefixIndex = 0; prefixIndex < ignoredPrefixes.length; prefixIndex++) {
            if (line.indexOf(ignoredPrefixes[prefixIndex]) === 0) {
                ignored = true;
                break;
            }
        }
        if (!ignored) {
            keptLines.push(line);
        }
    }
    return [
        "AAMA_ORDER_SET|" + serial,
        "AAMA_ORDER_CODE|" + sanitizeDxfOrderMetadataValue(row.orderCode),
        "AAMA_ORDER_SIZE|" + sanitizeDxfOrderMetadataValue(row.size),
        "AAMA_ORDER_NAME|" + sanitizeDxfOrderMetadataValue(row.name),
        "AAMA_ORDER_NUMBER|" + sanitizeDxfOrderMetadataValue(row.number),
        "AAMA_ORDER_COPY|" + copyNumber
    ].concat(keptLines).join("\n");
}

function getDxfOrderSourceArtworkBounds(sizeGroups) {
    var result = null;
    for (var groupIndex = 0; groupIndex < sizeGroups.length; groupIndex++) {
        var bounds = getDxfOrderItemBounds(sizeGroups[groupIndex]);
        if (bounds === null) {
            continue;
        }
        if (result === null) {
            result = [bounds[0], bounds[1], bounds[2], bounds[3]];
        } else {
            result[0] = Math.min(result[0], bounds[0]);
            result[1] = Math.max(result[1], bounds[1]);
            result[2] = Math.max(result[2], bounds[2]);
            result[3] = Math.min(result[3], bounds[3]);
        }
    }
    return result;
}

function removeDxfOrderLayer(doc, layerName) {
    var layer = findDxfLayerByName(doc, layerName);
    if (layer !== null) {
        layer.locked = false;
        layer.visible = true;
        layer.remove();
    }
}

// ---- 订单预检（放宽校验：允许缺少名字或号码元素） ----

function preflightDxfPersonalizedOrders(doc, orderRows) {
    var rows = normalizeDxfPersonalizedOrderRows(orderRows);

    // 获取样例图层（可能为 null，贴图模式下用户需手动填充）
    var sampleLayers = {
        name: getDxfPersonalizedOrderSampleLayer(doc, "LanTu_名字参数样例"),
        number: getDxfPersonalizedOrderSampleLayer(doc, "LanTu_数字号码参数样例")
    };

    var sizeGroups = collectDxfInheritanceSizeGroups(doc);
    var validatedSizeGroups = [];
    var validationSummaries = [];
    var totalSets = 0;
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        var sizeGroup = findDxfOrderSizeGroup(sizeGroups, rows[rowIndex].size);
        if (sizeGroup === null) {
            throw new Error("第 " + rows[rowIndex].rowNumber + " 行找不到尺码组：\"" +
                rows[rowIndex].size + "\"");
        }
        rows[rowIndex].sourceSizeGroup = sizeGroup;
        var validatedIndex = -1;
        for (var validationIndex = 0;
            validationIndex < validatedSizeGroups.length; validationIndex++) {
            if (validatedSizeGroups[validationIndex] === sizeGroup) {
                validatedIndex = validationIndex;
                break;
            }
        }
        if (validatedIndex < 0) {
            validatedSizeGroups.push(sizeGroup);
            validationSummaries.push(validateDxfOrderSizeTemplates(sizeGroup));
        }
        // 不再强制要求所有裁片都有名字/号码模板；允许缺少任意一个或两个都缺失，
        // 实际替换时静默跳过不存在的字段。
        totalSets += rows[rowIndex].quantity;
    }
    return {
        rows: rows,
        sampleLayers: sampleLayers,
        sizeGroups: sizeGroups,
        totalSets: totalSets
    };
}

function mergeDxfOrderApplySummary(total, current) {
    total.matched += current.matched;
    total.replaced += current.replaced;
    total.skipped += current.skipped;
    var listNames = ["missingNameSamples", "missingDigits", "missingLayers"];
    for (var listIndex = 0; listIndex < listNames.length; listIndex++) {
        var listName = listNames[listIndex];
        for (var valueIndex = 0; valueIndex < current[listName].length; valueIndex++) {
            addUniqueDxfOrderValue(total[listName], current[listName][valueIndex]);
        }
    }
}

function buildDxfOrderApplyReport(summary) {
    var lines = [
        "命中名字/号码占位: " + summary.matched + " 个",
        "实际替换名字/号码元素: " + summary.replaced + " 个"
    ];
    if (summary.skipped > 0) {
        lines.push("未替换占位: " + summary.skipped + " 个");
    }
    if (summary.missingLayers.length > 0) {
        lines.push("缺少样例图层: " + summary.missingLayers.join("、"));
    }
    if (summary.missingNameSamples.length > 0) {
        lines.push("缺少名字样例: " + summary.missingNameSamples.join("、"));
    }
    if (summary.missingDigits.length > 0) {
        lines.push("缺少数字样例: " + summary.missingDigits.join("、"));
    }
    return lines.join("\n");
}

// ---- 提交订单主流程 ----

function submitDxfPersonalizedOrders(orderRows) {
    var temporaryLayerName = "LanTu_订单输出_生成中";
    var temporaryLayer = null;
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var doc = app.activeDocument;
        var preflight = preflightDxfPersonalizedOrders(doc, orderRows);
        var sourceBounds = getDxfOrderSourceArtworkBounds(preflight.sizeGroups);
        if (sourceBounds === null) {
            return "没有找到可用于订单复制的尺码组边界。";
        }

        removeDxfOrderLayer(doc, temporaryLayerName);
        temporaryLayer = doc.layers.add();
        temporaryLayer.name = temporaryLayerName;
        temporaryLayer.locked = false;
        temporaryLayer.visible = true;

        var gap = 20 * getDxfMillimeterToDocumentUnits(doc);
        var targetLeft = sourceBounds[2] + gap;
        var targetTop = sourceBounds[1];
        var setSerial = 0;
        var pieceCount = 0;
        var applySummary = {
            matched: 0,
            replaced: 0,
            skipped: 0,
            missingNameSamples: [],
            missingDigits: [],
            missingLayers: []
        };
        for (var rowIndex = 0; rowIndex < preflight.rows.length; rowIndex++) {
            var row = preflight.rows[rowIndex];
            for (var copyIndex = 0; copyIndex < row.quantity; copyIndex++) {
                setSerial++;
                var orderSet = row.sourceSizeGroup.duplicate(
                    temporaryLayer, ElementPlacement.PLACEATEND
                );
                unlockDxfOrderItem(orderSet);
                orderSet.name = "订单_" + sanitizeDxfOrderMetadataValue(row.orderCode) +
                    "_" + sanitizeDxfOrderMetadataValue(row.size) + "_" + setSerial;
                orderSet.note = buildDxfOrderSetNote(
                    orderSet.note, setSerial, row, copyIndex + 1
                );

                var pieces = [];
                collectDxfPieceGroups(orderSet, pieces);
                for (var pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
                    unlockDxfOrderItem(pieces[pieceIndex]);
                    var pieceUpdated = false;

                    // 名字替换：传入名字样例图层
                    var updatedNameCount = applyDxfOrderFieldToPiece(
                        pieces[pieceIndex], "名字", row.name,
                        preflight.sampleLayers.name, "NAME"
                    );
                    mergeDxfOrderApplySummary(applySummary, updatedNameCount);
                    if (updatedNameCount.replaced > 0) {
                        pieceUpdated = true;
                    }

                    // 号码替换：传入号码样例图层
                    var updatedNumberCount = applyDxfOrderFieldToPiece(
                        pieces[pieceIndex], "号码", row.number,
                        preflight.sampleLayers.number, "NUMBER"
                    );
                    mergeDxfOrderApplySummary(applySummary, updatedNumberCount);
                    if (updatedNumberCount.replaced > 0) {
                        pieceUpdated = true;
                    }
                    if (pieceUpdated) {
                        pieceCount++;
                    }
                }

                var setBounds = getDxfOrderItemBounds(orderSet);
                if (setBounds === null) {
                    throw new Error("无法读取第 " + setSerial + " 套订单的边界");
                }
                orderSet.translate(targetLeft - setBounds[0], targetTop - setBounds[1]);
                setBounds = getDxfOrderItemBounds(orderSet);
                targetTop = setBounds[3] - gap;
            }
        }

        removeDxfOrderLayer(doc, "LanTu_订单输出");
        temporaryLayer.name = "LanTu_订单输出";
        doc.activeLayer = temporaryLayer;
        temporaryLayer = null;
        try {
            app.redraw();
        } catch (redrawError) {
            // Output is complete; redraw is only a visual refresh.
        }
        return "订单提交完成！\n" +
            "订单行: " + preflight.rows.length + " 行\n" +
            "生成套数: " + preflight.totalSets + " 套\n" +
            "替换裁片: " + pieceCount + " 个\n" +
            buildDxfOrderApplyReport(applySummary) + "\n" +
            "输出图层: LanTu_订单输出";
    } catch (error) {
        if (temporaryLayer !== null) {
            try {
                temporaryLayer.locked = false;
                temporaryLayer.remove();
            } catch (cleanupError) {
                // Preserve the original error message.
            }
        }
        return "提交个性化订单失败: " + error.message +
            "（行号: " + error.line + "）";
    }
}
