// DXF 导入流程入口

function importEtCadDxf(filePath, notchStyle, rulFilePath) {
    // ETCAD 导出的 ANSI/AAMA DXF 使用毫米坐标；Illustrator 使用 points。
    var ETCAD_SIGNATURE = "ANSI/AAMA";
    var STYLE_HINT_BAND_MM = 52;
    notchStyle = normalizeDxfNotchStyle(notchStyle);

    try {
        if (app.documents.length === 0) {
            return "请先在 Illustrator 中打开一个文档，再导入 DXF。";
        }

        var dxfFile = new File(filePath);
        if (!dxfFile.exists) {
            return "找不到 DXF 文件：" + filePath;
        }

        // ANSI/AAMA DXF 是 ASCII 代码对文件。Illustrator 的 ExtendScript 用 UTF-8
        // 读取该类文件时可能返回空字符串，BINARY 可稳定保留所有 ASCII 组码和数值。
        dxfFile.encoding = "BINARY";
        if (!dxfFile.open("r")) {
            return "无法读取 DXF 文件：" + filePath;
        }
        var dxfText = dxfFile.read();
        dxfFile.close();

        if (dxfText.length === 0) {
            return "DXF 文件已打开但未读到内容（文件大小: " + dxfFile.length + " 字节）。";
        }

        if (dxfText.indexOf(ETCAD_SIGNATURE) === -1) {
            $.writeln("提示：DXF 中未找到 " + ETCAD_SIGNATURE + " 标记，仍尝试按标准 ASCII DXF 导入。");
        }

        var pairs = readDxfPairs(dxfText);
        var entities = readDxfEntities(pairs);
        var blocks = readDxfBlocks(pairs);
        var gradeTable = readAamaRulFile(rulFilePath);
        var sizeNames = gradeTable !== null ? gradeTable.sizes : [getDxfBlockSize(blocks[0])];
        var shapes = [];
        var isAamaDuplicateBlockLayout = hasDuplicateDxfBlockNames(blocks);
        var directShapeTemplates = createDxfShapeTemplates(entities, notchStyle);
        prepareAamaGradeMetadataForShapes(
            directShapeTemplates, { entities: entities }
        );
        snapAamaNotchesToAssignedBoundary(directShapeTemplates);
        constrainAamaTechlinesToInnerBoundary(directShapeTemplates);
        var blockShapeCache = createDxfBlockShapeCache(blocks, notchStyle);

        for (var sizeIndex = 0; sizeIndex < sizeNames.length; sizeIndex++) {
            var sizeShapes = cloneDxfShapes(directShapeTemplates);
            applyAamaGradeToBlockShapes(
                sizeShapes, { entities: entities }, gradeTable, sizeIndex
            );
            snapAamaNotchesToAssignedBoundary(sizeShapes);
            constrainAamaTechlinesToInnerBoundary(sizeShapes);
            for (var directIndex = 0; directIndex < sizeShapes.length; directIndex++) {
                sizeShapes[directIndex].pieceKey = "entities";
                sizeShapes[directIndex].pieceLabel = "DXF 实体";
                sizeShapes[directIndex].pieceBaseLabel = "DXF 实体";
                sizeShapes[directIndex].sizeName = sizeNames[sizeIndex];
                sizeShapes[directIndex].pieceQuantity = 1;
                shapes.push(sizeShapes[directIndex]);
            }

            // ETCAD/AAMA 重名块使用绝对坐标，不能再次叠加 INSERT 位移。
            if (isAamaDuplicateBlockLayout) {
                appendStandaloneDxfBlocks(
                    shapes, blocks, gradeTable, sizeIndex, sizeNames[sizeIndex], blockShapeCache
                );
            } else {
                appendInsertedDxfBlocks(
                    shapes, entities, blocks, gradeTable, sizeIndex,
                    sizeNames[sizeIndex], blockShapeCache
                );
            }
        }

        expandDxfShapesByQuantity(shapes);
        assignDxfStableElementIds(shapes);
        arrangeDxfShapesBySizeAndPiece(shapes, sizeNames);
        var quantitySummary = getDxfPieceQuantitySummary(shapes);

        if (shapes.length === 0) {
            return "未在 DXF 的 ENTITIES 或 BLOCKS 段中找到可绘制的线、折线、圆或圆弧。";
        }

        var bounds = getDxfBounds(shapes);
        var doc = app.activeDocument;
        var documentScaleFactor = getDxfDocumentScaleFactor(doc);
        var millimeterScale = getDxfMillimeterToDocumentUnits(doc);
        var drawMargin = STYLE_HINT_BAND_MM * millimeterScale;
        var artboard = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var importId = String(new Date().getTime()) + "-" +
            String(Math.floor(Math.random() * 100000));
        var importLayer = doc.layers.add();
        importLayer.name = "DXF 导入";
        var parameterLayer = createDxfStyleHintLayer(doc, artboard, importLayer);
        var pieceGroups = {};
        var semanticGroups = {};
        var notchCount = 0;
        var techlineCount = 0;
        var regularPathCount = 0;
        var notchEntries = [];

        // 先绘制裁片边线，再绘制刀口。刀口需要根据已存在的闭合边线判断“裁片内部”。
        for (var i = 0; i < shapes.length; i++) {
            var pieceGroup = getOrCreateDxfPieceGroup(
                importLayer, pieceGroups, shapes[i], importId
            );
            var pieceSemanticGroups = getOrCreateDxfPieceSemanticGroups(
                pieceGroup, semanticGroups, shapes[i]
            );
            if (shapes[i].kind === "notch") {
                notchEntries.push({
                    shape: shapes[i],
                    pieceGroup: pieceGroup,
                    semanticGroups: pieceSemanticGroups
                });
                continue;
            }

            if (isAamaTechlineShape(shapes[i])) {
                drawDxfShape(
                    pieceSemanticGroups.techLineGroup,
                    shapes[i],
                    bounds,
                    artboard,
                    millimeterScale,
                    drawMargin,
                    "工艺线"
                );
                techlineCount++;
            } else {
                drawDxfShape(
                    pieceGroup,
                    shapes[i],
                    bounds,
                    artboard,
                    millimeterScale,
                    drawMargin,
                    getDxfShapeDisplayName(shapes[i])
                );
                if (String(shapes[i].dxfLayer) === "1") {
                    drawDxfAnchorPoints(
                        pieceSemanticGroups.clipAnchorGroup,
                        shapes[i],
                        bounds,
                        artboard,
                        millimeterScale,
                        drawMargin,
                        "OUTER"
                    );
                } else if (String(shapes[i].dxfLayer) === "14") {
                    drawDxfAnchorPoints(
                        pieceSemanticGroups.anchorGroup,
                        shapes[i],
                        bounds,
                        artboard,
                        millimeterScale,
                        drawMargin,
                        "INNER"
                    );
                }
                regularPathCount++;
            }
        }

        for (var notchIndex = 0; notchIndex < notchEntries.length; notchIndex++) {
            var notchEntry = notchEntries[notchIndex];
            if (drawDxfNotchMarker(
                notchEntry.pieceGroup,
                notchEntry.semanticGroups.notchingGroup,
                notchEntry.shape,
                bounds,
                artboard,
                millimeterScale,
                drawMargin,
                notchStyle
            )) {
                notchCount++;
            }
        }

        var defaultSizeGroups = [];
        collectDxfSizeGroups(importLayer, defaultSizeGroups);
        var defaultSizeTagSample = findDxfTextFrameByNotePrefix(
            parameterLayer, "AAMA_SIZE_TAG_SAMPLE"
        );
        var defaultSizeLabelResult = {
            labeledCount: 0,
            missingPairCount: 0,
            placementFailedCount: 0
        };
        if (defaultSizeTagSample !== null) {
            defaultSizeLabelResult = labelDxfSizeGroups(
                defaultSizeGroups,
                1,
                defaultSizeTagSample
            );
        }
        for (var pieceGroupKey in pieceGroups) {
            if (pieceGroups.hasOwnProperty(pieceGroupKey) &&
                pieceGroups[pieceGroupKey] &&
                getDxfPrimaryNoteLine(pieceGroups[pieceGroupKey].note).indexOf("AAMA_PIECE|") === 0) {
                orderDxfPieceArtwork(pieceGroups[pieceGroupKey]);
            }
        }
        invalidateDxfAnchorOptionsCache();

        return "DXF 导入完成！\n" +
            "文件: " + dxfFile.displayName + "\n" +
            "格式: " + (dxfText.indexOf(ETCAD_SIGNATURE) === -1 ? "标准 ASCII DXF" : "ETCAD ANSI/AAMA") + "\n" +
            "块处理: " + (isAamaDuplicateBlockLayout ? "AAMA 重名块（按原始坐标）" : "标准 INSERT 块引用") + "\n" +
            "放码规则: " + (gradeTable === null ? "未选择 RUL，仅导入基码" : gradeTable.fileName) + "\n" +
            "尺码组: " + sizeNames.join("、") + "\n" +
            "画布比例: 1:" + documentScaleFactor + "（已按实际毫米修正）\n" +
            "裁片编组: " + quantitySummary.groupCount + " 个；按 Quantity 合计: " +
                quantitySummary.quantityTotal + " 片\n" +
            "刀口类型: " + getDxfNotchStyleLabel(notchStyle) + "\n" +
            "已绘制 " + regularPathCount + " 个轮廓/辅助路径到图层“DXF 导入”。\n" +
            "已绘制 " + techlineCount + " 条工艺线到对应裁片的“工艺线”编组。\n" +
            "已绘制 " + notchCount + " 个刀口到对应裁片编组。\n" +
            "默认尺码标: 锚点组01，已生成 " +
                defaultSizeLabelResult.labeledCount + " 个尺码标；缺少01组裁片 " +
                defaultSizeLabelResult.missingPairCount + " 个。";
    } catch (error) {
        // 绘制阶段的 Illustrator DOM 异常不能留下半成品导入层；参数样例层是
        // 可复用的独立层，不在这里删除。
        try {
            if (importLayer && importLayer.typename === "Layer") {
                importLayer.locked = false;
                importLayer.visible = true;
                importLayer.remove();
            }
        } catch (cleanupError) {
            // 清理失败时保留原始错误，避免掩盖真正的导入原因。
        }
        return "DXF 导入失败: " + error.message + "（行号: " + error.line + "）";
    }
}
