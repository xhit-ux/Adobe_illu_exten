// 尺码标参数与自动锚点组标记入口：每个裁片始终只有一个尺码标。

function normalizeDxfSizeTagNumber(value, fallbackValue, allowZero) {
    var number = parseFloat(value);
    if (isNaN(number) || number < 0 || (!allowZero && number === 0)) {
        return fallbackValue;
    }
    return number;
}

function createDxfSizeTagSettings(orderCode, heightMm, applyMeasurements) {
    return {
        orderCode: String(orderCode || "").replace(/^\s+|\s+$/g, ""),
        heightMm: normalizeDxfSizeTagNumber(heightMm, 4, false),
        applyMeasurements: applyMeasurements === true
    };
}

function applyDxfSizeTagMeasurements(sizeTag, pieceGroup, settings) {
    if (!settings.applyMeasurements) {
        return;
    }
    var attributes = sizeTag.textRange.characterAttributes;
    attributes.size = settings.heightMm * getDxfMillimeterToDocumentUnits(pieceGroup);
    try {
        attributes.strokeWeight = 0;
        attributes.strokeColor = new NoColor();
    } catch (strokeColorError) {
        // 保持参数样例的无描边状态。
    }
}

function labelDxfSizeGroups(sizeGroups, pairOrdinal, sizeTagSample, settings) {
    if (!settings) {
        settings = createDxfSizeTagSettings("", 4, false);
    }
    pairOrdinal = Math.max(1, parseInt(pairOrdinal, 10) || 1);
    var result = {
        labeledCount: 0,
        pieceCount: 0,
        missingPairCount: 0,
        placementFailedCount: 0,
        removedExtraCount: 0
    };
    for (var sizeIndex = 0; sizeIndex < sizeGroups.length; sizeIndex++) {
        var sizeName = getDxfSizeNameFromGroup(sizeGroups[sizeIndex]);
        var pieceGroups = [];
        collectDxfPieceGroups(sizeGroups[sizeIndex], pieceGroups);
        for (var pieceIndex = 0; pieceIndex < pieceGroups.length; pieceIndex++) {
            var pieceGroup = pieceGroups[pieceIndex];
            var pairs = getDxfAnchorPairs(pieceGroup);
            result.pieceCount++;
            if (pairs.length < pairOrdinal) {
                result.missingPairCount++;
                continue;
            }

            var pair = pairs[pairOrdinal - 1];
            var sizeTag = findDxfPieceSizeTag(pieceGroup);
            if (sizeTag === null) {
                sizeTag = pieceGroup.textFrames.add();
            } else {
                var previousAngle = getDxfSizeTagStoredAngle(sizeTag.note);
                if (Math.abs(previousAngle) > 0.000001) {
                    sizeTag.rotate(-previousAngle);
                }
            }
            result.removedExtraCount += removeDxfExtraPieceSizeTags(
                pieceGroup, sizeTag
            );
            sizeTag.contents = settings.orderCode ?
                settings.orderCode + "-" + sizeName : sizeName;
            sizeTag.name = "尺码标";
            copyDxfTextStyle(sizeTagSample, sizeTag);
            applyDxfSizeTagMeasurements(sizeTag, pieceGroup, settings);
            var placement = positionDxfSizeTagBetweenAnchorPair(
                pieceGroup, pair, sizeTag
            );
            if (!placement.safe) {
                result.placementFailedCount++;
            }
            sizeTag.note = "AAMA_SIZE_TAG|PAIR|" + pairOrdinal +
                "|OUTER|" + pair.outer.metadata.ordinal +
                "|INNER|" + pair.inner.metadata.ordinal +
                "|ANGLE|" + placement.angle +
                "|VISIBLE_SCORE|" + placement.visibleScore +
                "|SAFE|" + (placement.safe ? "1" : "0");
            setDxfMetadataValue(
                sizeTag,
                "AAMA_ELEMENT",
                getDxfPieceStableId(pieceGroup) + "|size-tag"
            );
            result.labeledCount++;
            orderDxfPieceArtwork(pieceGroup);
        }
    }
    return result;
}

function labelDxfPieceSizes(pairValue, orderCode, heightMm) {
    try {
        if (app.documents.length === 0) {
            return "请先打开已导入裁片的 Illustrator 文档。";
        }
        var pairOrdinal = parseDxfSizeAnchorPairOptionValue(pairValue);
        if (pairOrdinal === null) {
            return "请先从下拉框选择一个尺码锚点组。";
        }
        var doc = app.activeDocument;
        var parameterLayer = findDxfLayerByName(doc, "LanTu_参数样例");
        if (parameterLayer === null) {
            return "没有找到“LanTu_参数样例”层。";
        }
        var sizeTagSample = findDxfTextFrameByNotePrefix(
            parameterLayer, "AAMA_SIZE_TAG_SAMPLE"
        );
        if (sizeTagSample === null) {
            return "参数样例区没有找到“XSML”尺码标样例。";
        }
        if (String(sizeTagSample.note || "") !== "AAMA_SIZE_TAG_SAMPLE|DEFAULT_V4") {
            applyDxfDefaultSizeTagStyle(sizeTagSample, doc);
            sizeTagSample.note = "AAMA_SIZE_TAG_SAMPLE|DEFAULT_V4";
        }
        var settings = createDxfSizeTagSettings(orderCode, heightMm, true);
        var sizeGroups = collectDxfInheritanceSizeGroups(doc);
        var labelResult = labelDxfSizeGroups(
            sizeGroups, pairOrdinal, sizeTagSample, settings
        );

        return "尺码标记完成！\n" +
            "使用锚点组: " +
                (pairOrdinal < 10 ? "0" + pairOrdinal : String(pairOrdinal)) + "\n" +
            "订单编码: " + (settings.orderCode || "未填写") + "\n" +
            "码标高度: " + settings.heightMm + "mm\n" +
            "已处理裁片: " + labelResult.pieceCount + " 个\n" +
            "已更新/生成尺码标: " + labelResult.labeledCount + " 个\n" +
            "缺少该锚点组: " + labelResult.missingPairCount + " 个裁片\n" +
            "已清理错误版本多余尺码标: " + labelResult.removedExtraCount + " 个\n" +
            "可见范围未能完全位于内外线区间但已保留: " +
                labelResult.placementFailedCount + " 个。";
    } catch (error) {
        return "尺码标记失败: " + error.message + "（行号: " + error.line + "）";
    }
}
