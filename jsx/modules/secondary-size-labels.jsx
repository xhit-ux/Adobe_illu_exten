// 二号尺码标：识别外线锚点组中的连续七点矩形结构，在其中心独立生成尺码文字。

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
    var boundaries = collectDxfSecondaryOuterAnchorsByBoundary(pieceGroup);
    var candidates = [];
    var usedSets = {};
    for (var boundaryKey in boundaries) {
        if (!boundaries.hasOwnProperty(boundaryKey)) {
            continue;
        }
        var boundary = boundaries[boundaryKey];
        var anchors = boundary.anchors;
        if (anchors.length < 7) {
            continue;
        }
        var windowCount = anchors.length === 7 ? 1 : anchors.length;
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
        missingPatternCount: 0,
        ambiguousPatternCount: 0,
        placementFailedCount: 0,
        removedExtraCount: 0
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
            if (!positionDxfSecondarySizeTagAtCenter(
                sizeTag, regionResult.match.center
            )) {
                result.placementFailedCount++;
            }
            var anchorOrdinals = [];
            for (var anchorIndex = 0;
                anchorIndex < regionResult.match.anchors.length; anchorIndex++) {
                anchorOrdinals.push(
                    regionResult.match.anchors[anchorIndex].metadata.ordinal
                );
            }
            sizeTag.note = "AAMA_SECONDARY_SIZE_TAG|BOUNDARY|" +
                regionResult.match.boundaryId + "|ANCHORS|" + anchorOrdinals.join(",");
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
            "已更新/生成二号尺码标: " + result.labeledCount + " 个\n" +
            "未识别连续七点结构: " + result.missingPatternCount + " 个\n" +
            "存在多个候选而跳过: " + result.ambiguousPatternCount + " 个\n" +
            "定位失败: " + result.placementFailedCount + " 个\n" +
            "已清理多余二号尺码标: " + result.removedExtraCount + " 个。";
    } catch (error) {
        return "二号尺码标记失败: " + error.message + "（行号: " + error.line + "）";
    }
}
