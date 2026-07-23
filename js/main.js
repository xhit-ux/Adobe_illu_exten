// js/main.js
document.addEventListener("DOMContentLoaded", function () {
	var csInterface = new CSInterface();
	var selectedDxfPath = "";
	var selectedRulPath = "";
	var selectedInheritanceRulPath = "";

	var btnScan = document.getElementById("btn-scan");
	var btnSelectDxf = document.getElementById("btn-select-dxf");
	var btnSelectRul = document.getElementById("btn-select-rul");
	var btnClearRul = document.getElementById("btn-clear-rul");
	var btnImport = document.getElementById("btn-import");
	var dxfFileName = document.getElementById("dxf-file-name");
	var rulFileName = document.getElementById("rul-file-name");
	var notchStyle = document.getElementById("notch-style");
	var btnApplyStyle = document.getElementById("btn-apply-style");
	var sizeAnchor = document.getElementById("size-anchor");
	var orderCode = document.getElementById("order-code");
	var sizeTagHeight = document.getElementById("size-tag-height");
	var btnLabelSizes = document.getElementById("btn-label-sizes");
	var secondaryOrderCode = document.getElementById("secondary-order-code");
	var secondarySizeTagHeight = document.getElementById("secondary-size-tag-height");
	var btnLabelSecondarySizes = document.getElementById("btn-label-secondary-sizes");
	var inheritanceBaseSize = document.getElementById("inheritance-base-size");
	var btnSetInheritanceBase = document.getElementById("btn-set-inheritance-base");
	var btnInheritSizes = document.getElementById("btn-inherit-sizes");
	var btnSelectInheritanceRul = document.getElementById("btn-select-inheritance-rul");
	var inheritanceRulFileName = document.getElementById("inheritance-rul-file-name");
	var btnAddFixedElements = document.getElementById("btn-add-fixed-elements");
	var btnRemoveFixedElements = document.getElementById("btn-remove-fixed-elements");
	var btnCreateOrderSamples = document.getElementById("btn-create-order-samples");
	var btnParseOrders = document.getElementById("btn-parse-orders");
	var btnSubmitOrders = document.getElementById("btn-submit-orders");
	var btnAddOrderRow = document.getElementById("btn-add-order-row");
	var btnClearOrders = document.getElementById("btn-clear-orders");
	var orderPasteInput = document.getElementById("order-paste-input");
	var orderStatus = document.getElementById("order-status");
	var orderTableSection = document.getElementById("order-table-section");
	var orderTableBody = document.getElementById("order-table-body");
	var resultBox = document.getElementById("result-box");
	var hostOperationBusy = false;
	var orderParseTimer = null;

	function getFileName(filePath) {
		var parts = String(filePath || "").split(/[\\\/]/);
		return parts.length > 0 ? parts[parts.length - 1] : "";
	}

	function updateFileDisplay(element, filePath, emptyText) {
		if (filePath) {
			element.textContent = getFileName(filePath);
			element.title = filePath;
			element.className = "file-name";
		} else {
			element.textContent = emptyText;
			element.title = "";
			element.className = "file-name empty";
		}
	}

	function updateImportState() {
		btnImport.disabled = !selectedDxfPath;
		btnClearRul.disabled = !selectedRulPath;
		updateFileDisplay(dxfFileName, selectedDxfPath, "未选择");
		updateFileDisplay(rulFileName, selectedRulPath, "未选择（可选）");
	}

	function updateInheritanceRulState() {
		updateFileDisplay(
			inheritanceRulFileName,
			selectedInheritanceRulPath,
			"未选择"
		);
		var hasBaseSize = !!inheritanceBaseSize.value;
		btnSetInheritanceBase.disabled = !hasBaseSize;
		btnInheritSizes.disabled = !hasBaseSize || !selectedInheritanceRulPath;
	}

	function readNumericInput(element, fallbackValue, allowZero) {
		var value = parseFloat(element.value);
		if (!isFinite(value) || value < 0 || (!allowZero && value === 0)) {
			value = fallbackValue;
			element.value = String(fallbackValue);
		}
		return value;
	}

	function setOrderStatus(message, isError) {
		orderStatus.textContent = message;
		orderStatus.style.color = isError ? "#e45b5b" : "#a9a9a9";
	}

	function isOrderHeaderRow(columns) {
		return columns.length >= 6 &&
			/订单/.test(columns[0]) &&
			/尺码|码数/.test(columns[1]) &&
			/名字/.test(columns[2]) &&
			/号码|数字/.test(columns[3]) &&
			/其它/.test(columns[4]) &&
			/件数|数量/.test(columns[5]);
	}

	function splitOrderColumns(line) {
		if (line.indexOf("\t") >= 0) {
			return line.split("\t");
		}
		return line.replace(/｜/g, "|").split("|");
	}

	function parsePastedOrderRows(text) {
		var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
		var rows = [];
		for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			var line = lines[lineIndex].replace(/^\s+|\s+$/g, "");
			if (!line) {
				continue;
			}
			var columns = splitOrderColumns(line);
			for (var columnIndex = 0; columnIndex < columns.length; columnIndex++) {
				columns[columnIndex] = columns[columnIndex].replace(/^\s+|\s+$/g, "");
			}
			if (rows.length === 0 && isOrderHeaderRow(columns)) {
				continue;
			}
			if (columns.length !== 6) {
				throw new Error("第 " + (lineIndex + 1) + " 行不是六列数据");
			}
			rows.push({
				orderCode: columns[0],
				size: columns[1],
				name: columns[2],
				number: columns[3],
				other: columns[4],
				quantity: columns[5]
			});
		}
		if (rows.length === 0) {
			throw new Error("没有识别到订单数据");
		}
		return rows;
	}

	function createOrderInput(fieldName, value) {
		var input = document.createElement("input");
		input.type = "text";
		input.setAttribute("data-order-field", fieldName);
		input.value = String(value === undefined || value === null ? "" : value);
		input.addEventListener("input", function () {
			input.classList.remove("invalid");
		});
		return input;
	}

	function addOrderTableRow(values) {
		var row = document.createElement("tr");
		var fields = ["orderCode", "size", "name", "number", "other", "quantity"];
		values = values || {};
		for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
			var cell = document.createElement("td");
			cell.appendChild(createOrderInput(fields[fieldIndex], values[fields[fieldIndex]]));
			row.appendChild(cell);
		}
		var removeCell = document.createElement("td");
		var removeButton = document.createElement("button");
		removeButton.type = "button";
		removeButton.className = "order-row-remove";
		removeButton.textContent = "×";
		removeButton.title = "删除此行";
		removeButton.setAttribute("aria-label", "删除此订单行");
		removeButton.addEventListener("click", function () {
			orderTableBody.removeChild(row);
			updateOrderTableState();
		});
		removeCell.appendChild(removeButton);
		row.appendChild(removeCell);
		orderTableBody.appendChild(row);
		return row;
	}

	function updateOrderTableState() {
		var hasRows = orderTableBody.children.length > 0;
		orderTableSection.classList.toggle("visible", hasRows);
		btnSubmitOrders.disabled = !hasRows || hostOperationBusy;
	}

	function renderOrderRows(rows) {
		orderTableBody.innerHTML = "";
		for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
			addOrderTableRow(rows[rowIndex]);
		}
		updateOrderTableState();
	}

	function parseAndRenderOrders() {
		try {
			var rows = parsePastedOrderRows(orderPasteInput.value);
			renderOrderRows(rows);
			setOrderStatus("已识别 " + rows.length + " 行，可继续编辑", false);
		} catch (error) {
			setOrderStatus(error.message, true);
			orderTableBody.innerHTML = "";
			updateOrderTableState();
		}
	}

	function collectOrderRows() {
		var rows = [];
		var tableRows = orderTableBody.querySelectorAll("tr");
		var firstInvalid = null;
		for (var rowIndex = 0; rowIndex < tableRows.length; rowIndex++) {
			var values = {};
		var fields = ["orderCode", "size", "name", "number", "other", "quantity"];
			var hasValue = false;
			for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
				var fieldName = fields[fieldIndex];
				var input = tableRows[rowIndex].querySelector(
					"input[data-order-field='" + fieldName + "']"
				);
				input.classList.remove("invalid");
				values[fieldName] = String(input.value || "").replace(
					/^\s+|\s+$/g, ""
				);
				hasValue = hasValue || values[fieldName] !== "";
			}
			if (!hasValue) {
				continue;
			}
			var orderInput = tableRows[rowIndex].querySelector(
				"input[data-order-field='orderCode']"
			);
			var sizeInput = tableRows[rowIndex].querySelector(
				"input[data-order-field='size']"
			);
			var quantityInput = tableRows[rowIndex].querySelector(
				"input[data-order-field='quantity']"
			);
			if (!values.orderCode) {
				orderInput.classList.add("invalid");
				firstInvalid = firstInvalid || orderInput;
			}
			if (!values.size) {
				sizeInput.classList.add("invalid");
				firstInvalid = firstInvalid || sizeInput;
			}
			if (!/^\d+$/.test(values.quantity) || parseInt(values.quantity, 10) < 1) {
				quantityInput.classList.add("invalid");
				firstInvalid = firstInvalid || quantityInput;
			}
			rows.push(values);
		}
		if (rows.length === 0) {
			throw new Error("订单表格中没有可提交的数据");
		}
		if (firstInvalid) {
			firstInvalid.focus();
			throw new Error("请补全订单编号、尺码，并把件数填写为正整数");
		}
		return rows;
	}

	function selectFile(title, extension, callback) {
		if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) {
			resultBox.value = "当前 CEP 环境不支持打开文件选择器。";
			return;
		}

		var picked = window.cep.fs.showOpenDialogEx(
			false,
			false,
			title,
			"",
			[extension]
		);
		if (picked.err === 0 && picked.data && picked.data.length > 0) {
			callback(picked.data[0]);
			updateImportState();
		}
	}

	function refreshSizeAnchorPairOptions(preferredValue) {
		csInterface.evalScript("getDxfSizeAnchorPairOptions()", function (result) {
			var previousValue = preferredValue || sizeAnchor.value;
			var lines = String(result || "").split(/\r?\n/);
			sizeAnchor.innerHTML = "";
			var placeholderOption = document.createElement("option");
			placeholderOption.value = "";
			placeholderOption.textContent = "请选择尺码锚点组";
			sizeAnchor.appendChild(placeholderOption);
			var optionCount = 0;
			for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				if (!lines[lineIndex] || lines[lineIndex].indexOf("ERROR|") === 0) {
					continue;
				}
				var separatorIndex = lines[lineIndex].indexOf("\t");
				if (separatorIndex < 1) {
					continue;
				}
				var option = document.createElement("option");
				option.value = lines[lineIndex].substring(0, separatorIndex);
				option.textContent = lines[lineIndex].substring(separatorIndex + 1);
				sizeAnchor.appendChild(option);
				optionCount++;
			}
			if (optionCount === 0) {
				placeholderOption.textContent = "暂无可配对锚点组";
			} else if (previousValue) {
				sizeAnchor.value = previousValue;
			}
			btnLabelSizes.disabled = !sizeAnchor.value;
		});
	}

	function refreshInheritanceSizeOptions(preferredValue) {
		csInterface.evalScript("getDxfInheritanceSizeOptions()", function (result) {
			var previousValue = preferredValue || inheritanceBaseSize.value;
			var lines = String(result || "").split(/\r?\n/);
			inheritanceBaseSize.innerHTML = "";
			var placeholderOption = document.createElement("option");
			placeholderOption.value = "";
			placeholderOption.textContent = "请选择基准尺码组";
			inheritanceBaseSize.appendChild(placeholderOption);
			var optionCount = 0;
			for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				if (!lines[lineIndex] || lines[lineIndex].indexOf("ERROR|") === 0) {
					continue;
				}
				var separatorIndex = lines[lineIndex].indexOf("\t");
				if (separatorIndex < 1) {
					continue;
				}
				var option = document.createElement("option");
				option.value = lines[lineIndex].substring(0, separatorIndex);
				option.textContent = lines[lineIndex].substring(separatorIndex + 1);
				inheritanceBaseSize.appendChild(option);
				optionCount++;
			}

			if (optionCount === 0) {
				placeholderOption.textContent = "暂无基准尺码组";
			} else if (previousValue) {
				inheritanceBaseSize.value = previousValue;
			}
			updateInheritanceRulState();
		});
	}

	btnScan.addEventListener("click", function () {
		resultBox.value = "正在扫描文档图层，请稍候...";
		hostOperationBusy = true;
		csInterface.evalScript("scanDxfDocumentPieces()", function (result) {
			hostOperationBusy = false;
			resultBox.value = result;
			refreshSizeAnchorPairOptions();
			refreshInheritanceSizeOptions();
		});
	});

	notchStyle.addEventListener("change", function () {
		var selectedNotchStyle = notchStyle.value || "straight";
		resultBox.value = "正在替换全部刀口样式...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"replaceDxfNotchStyle(" + JSON.stringify(selectedNotchStyle) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	});

	btnApplyStyle.addEventListener("click", function () {
		if (hostOperationBusy) {
			return;
		}
		resultBox.value = "正在应用参数样例样式...";
		hostOperationBusy = true;
		csInterface.evalScript("applyDxfSampleStyle()", function (result) {
			hostOperationBusy = false;
			resultBox.value = result;
		});
	});

	sizeAnchor.addEventListener("change", function () {
		btnLabelSizes.disabled = !sizeAnchor.value;
		if (!sizeAnchor.value || hostOperationBusy) {
			return;
		}
		csInterface.evalScript(
			"selectDxfSizeAnchorPair(" + JSON.stringify(sizeAnchor.value) + ")",
			function (result) {
				resultBox.value = result;
			}
		);
	});

	btnLabelSizes.addEventListener("click", function () {
		if (!sizeAnchor.value || hostOperationBusy) {
			return;
		}
		var normalizedOrderCode = String(orderCode.value || "").replace(/^\s+|\s+$/g, "");
		var heightMm = readNumericInput(sizeTagHeight, 4, false);
		resultBox.value = "正在自动配对内外线锚点并生成尺码标...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"labelDxfPieceSizes(" +
			JSON.stringify(sizeAnchor.value) + ", " +
			JSON.stringify(normalizedOrderCode) + ", " +
			heightMm + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	});

	btnLabelSecondarySizes.addEventListener("click", function () {
		if (hostOperationBusy) {
			return;
		}
		var normalizedOrderCode = String(secondaryOrderCode.value || "").replace(
			/^\s+|\s+$/g, ""
		);
		var heightMm = readNumericInput(secondarySizeTagHeight, 12, false);
		resultBox.value = "正在识别连续七点区域、裁切缝合并生成二号尺码标...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"labelDxfSecondaryPieceSizes(" +
			JSON.stringify(normalizedOrderCode) + ", " + heightMm + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	});

	inheritanceBaseSize.addEventListener("change", function () {
		updateInheritanceRulState();
	});

	btnSelectInheritanceRul.addEventListener("click", function () {
		selectFile("选择本次继承使用的 RUL 放码规则", "rul", function (filePath) {
			selectedInheritanceRulPath = filePath;
			resultBox.value = "已选择本次继承 RUL：" + getFileName(filePath);
			updateInheritanceRulState();
		});
	});

	btnSetInheritanceBase.addEventListener("click", function () {
		if (!inheritanceBaseSize.value || hostOperationBusy) {
			return;
		}
		resultBox.value = "正在保存元素修改基准...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"setDxfInheritanceBase(" + JSON.stringify(inheritanceBaseSize.value) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	});

	btnInheritSizes.addEventListener("click", function () {
		if (!inheritanceBaseSize.value || !selectedInheritanceRulPath || hostOperationBusy) {
			return;
		}
		resultBox.value = "正在将基准尺码组的元素修改继承到其它尺码...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"inheritDxfBaseToOtherSizes(" +
			JSON.stringify(selectedInheritanceRulPath) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
				selectedInheritanceRulPath = "";
				updateInheritanceRulState();
				refreshSizeAnchorPairOptions();
			}
		);
	});

	function setSelectedElementsFixedSize(isFixed) {
		if (hostOperationBusy) {
			return;
		}
		resultBox.value = isFixed ?
			"正在把选中对象加入固定元素继承..." :
			"正在把选中对象移出固定元素继承...";
		hostOperationBusy = true;
		csInterface.evalScript(
			"setDxfSelectedElementsFixedSize(" + (isFixed ? "true" : "false") + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
			}
		);
	}

	btnAddFixedElements.addEventListener("click", function () {
		setSelectedElementsFixedSize(true);
	});

	btnRemoveFixedElements.addEventListener("click", function () {
		setSelectedElementsFixedSize(false);
	});

	btnCreateOrderSamples.addEventListener("click", function () {
		if (hostOperationBusy) {
			return;
		}
		resultBox.value = "正在生成名字与数字号码参数样例...";
		hostOperationBusy = true;
		updateOrderTableState();
		csInterface.evalScript("ensureDxfPersonalizedOrderSamples()", function (result) {
			hostOperationBusy = false;
			resultBox.value = result;
			updateOrderTableState();
		});
	});

	btnParseOrders.addEventListener("click", function () {
		parseAndRenderOrders();
	});

	orderPasteInput.addEventListener("paste", function (event) {
		var clipboardText = event.clipboardData ?
			event.clipboardData.getData("text/plain") : "";
		if (!clipboardText) {
			return;
		}
		event.preventDefault();
		orderPasteInput.value = clipboardText;
		parseAndRenderOrders();
	});

	orderPasteInput.addEventListener("input", function () {
		if (orderParseTimer !== null) {
			clearTimeout(orderParseTimer);
		}
		var value = orderPasteInput.value;
		if (value.indexOf("\t") < 0 && value.indexOf("\n") < 0 &&
			value.indexOf("|") < 0 && value.indexOf("｜") < 0) {
			return;
		}
		orderParseTimer = setTimeout(function () {
			orderParseTimer = null;
			parseAndRenderOrders();
		}, 180);
	});

	btnAddOrderRow.addEventListener("click", function () {
		var row = addOrderTableRow();
		updateOrderTableState();
		row.querySelector("input").focus();
	});

	btnClearOrders.addEventListener("click", function () {
		orderPasteInput.value = "";
		orderTableBody.innerHTML = "";
		setOrderStatus("等待粘贴订单数据", false);
		updateOrderTableState();
		orderPasteInput.focus();
	});

	btnSubmitOrders.addEventListener("click", function () {
		if (hostOperationBusy) {
			return;
		}
		var rows;
		try {
			rows = collectOrderRows();
		} catch (error) {
			setOrderStatus(error.message, true);
			resultBox.value = "订单数据有误：" + error.message;
			return;
		}
		resultBox.value = "正在预检并生成个性化订单，请稍候...";
		hostOperationBusy = true;
		updateOrderTableState();
		csInterface.evalScript(
			"submitDxfPersonalizedOrders(" + JSON.stringify(rows) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
				if (String(result || "").indexOf("订单提交完成！") === 0) {
					setOrderStatus("订单已提交，共 " + rows.length + " 行", false);
				} else {
					setOrderStatus("订单提交失败，请查看运行结果", true);
				}
				updateOrderTableState();
			}
		);
	});

	btnSelectDxf.addEventListener("click", function () {
		selectFile("选择 ETCAD 导出的 DXF 文件", "dxf", function (filePath) {
			selectedDxfPath = filePath;
			resultBox.value = "已选择 DXF：" + getFileName(filePath);
		});
	});

	btnSelectRul.addEventListener("click", function () {
		selectFile("选择放码规则 RUL 文件（可选）", "rul", function (filePath) {
			selectedRulPath = filePath;
			resultBox.value = "已选择 RUL：" + getFileName(filePath);
		});
	});

	btnClearRul.addEventListener("click", function () {
		selectedRulPath = "";
		resultBox.value = "已清除 RUL，将只导入 DXF 基码。";
		updateImportState();
	});

	btnImport.addEventListener("click", function () {
		if (!selectedDxfPath) {
			resultBox.value = "请先选择 DXF 文件。";
			return;
		}

		var selectedNotchStyle = notchStyle.value || "straight";
		resultBox.value = selectedRulPath ?
			"正在导入 DXF 并应用 RUL 放码规则，请稍候..." :
			"正在导入 DXF 基码，请稍候...";
		hostOperationBusy = true;

		csInterface.evalScript(
			"importEtCadDxf(" +
			JSON.stringify(selectedDxfPath) + ", " +
			JSON.stringify(selectedNotchStyle) + ", " +
			JSON.stringify(selectedRulPath) + ")",
			function (result) {
				hostOperationBusy = false;
				resultBox.value = result;
				refreshSizeAnchorPairOptions("PAIR:1");
				refreshInheritanceSizeOptions();
			}
		);
	});

	updateImportState();
	updateInheritanceRulState();
	updateOrderTableState();
	refreshSizeAnchorPairOptions("PAIR:1");
	refreshInheritanceSizeOptions();
});
