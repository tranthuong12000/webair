const API_KEY = "a654c490-1802-48ee-b439-88cc499d3591";

const API_URL =
  `https://data.moenv.gov.tw/api/v2/AQX_P_432?api_key=${API_KEY}`;

let rawData = [];
let allFields = [];
let numericFields = [];
let currentFilteredData = [];
let currentPage = 1;
const rowsPerPage = 20;

let metricBarChart = null;
let metricLineChart = null;

document.addEventListener("DOMContentLoaded", () => {
  fetchAQIData();

  document.getElementById("searchInput").addEventListener("input", () => {
    currentPage = 1;
    applyFilters();
  });

  document.getElementById("countyFilter").addEventListener("change", () => {
    currentPage = 1;
    applyFilters();
  });

  document.getElementById("metricSelect").addEventListener("change", () => {
    currentPage = 1;
    applyFilters();
  });

  document.getElementById("prevPageBtn").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable(currentFilteredData);
    }
  });

  document.getElementById("nextPageBtn").addEventListener("click", () => {
    const totalPages = Math.ceil(currentFilteredData.length / rowsPerPage);

    if (currentPage < totalPages) {
      currentPage++;
      renderTable(currentFilteredData);
    }
  });
});

async function fetchAQIData() {
  try {
    setStatus("資料載入中...");

    if (API_KEY === "請換成你的環境部API_KEY") {
      throw new Error("請先填入你的環境部 API_KEY");
    }

    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error("API 請求失敗，狀態碼：" + response.status);
    }

    const jsonData = await response.json();

    console.log("API 原始資料：", jsonData);

    let records = [];

    if (Array.isArray(jsonData)) {
      records = jsonData;
    } else if (Array.isArray(jsonData.records)) {
      records = jsonData.records;
    } else {
      throw new Error("API 回傳格式不符合預期，找不到資料陣列");
    }

    if (records.length === 0) {
      throw new Error("API 沒有回傳資料");
    }

    rawData = records.map(item => normalizeKeys(item));

    allFields = getAllFields(rawData);
    numericFields = getNumericFields(rawData, allFields);

    if (numericFields.length === 0) {
      throw new Error("找不到可用的數值型指標欄位");
    }

    renderFieldList(allFields);
    initCountyFilter(rawData);
    initMetricSelect(numericFields);
    applyFilters();

    setText("fieldCount", allFields.length);
    setText("apiUpdateTime", getLatestUpdateTime(rawData));

    setStatus(`成功載入 ${rawData.length} 筆資料，偵測到 ${allFields.length} 個欄位`);

  } catch (error) {
    console.error("錯誤：", error);

    setStatus("資料載入失敗：" + error.message);

    setText("apiUpdateTime", "--");

    clearCharts();

    document.getElementById("tableHead").innerHTML = `
      <tr><th>錯誤</th></tr>
    `;

    document.getElementById("dataTable").innerHTML = `
      <tr>
        <td style="color:#ef4444;">
          資料載入失敗：${error.message}
        </td>
      </tr>
    `;

    updatePaginationInfo(0);
  }
}

function normalizeKeys(item) {
  const normalized = {};

  Object.keys(item).forEach(key => {
    const cleanKey = key.trim();
    normalized[cleanKey] = item[key];
  });

  return normalized;
}

function getAllFields(data) {
  const fieldSet = new Set();

  data.forEach(item => {
    Object.keys(item).forEach(key => fieldSet.add(key));
  });

  return Array.from(fieldSet);
}

function getNumericFields(data, fields) {
  return fields.filter(field => {
    let validCount = 0;

    data.forEach(item => {
      const value = toNumber(item[field]);
      if (Number.isFinite(value)) validCount++;
    });

    return validCount > 0;
  });
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return NaN;
  }

  const text = String(value).trim();

  if (text === "" || text === "ND" || text === "NA" || text === "-") {
    return NaN;
  }

  return Number(text);
}

function initCountyFilter(data) {
  const countyFilter = document.getElementById("countyFilter");

  const counties = [...new Set(
    data
      .map(item => item.county || item.County || item["縣市"])
      .filter(Boolean)
  )].sort();

  countyFilter.innerHTML = `<option value="all">全部縣市</option>`;

  counties.forEach(county => {
    countyFilter.innerHTML += `<option value="${county}">${county}</option>`;
  });
}

function initMetricSelect(fields) {
  const metricSelect = document.getElementById("metricSelect");

  metricSelect.innerHTML = "";

  const preferredOrder = [
    "aqi", "pm2.5", "pm2.5_avg", "pm10", "pm10_avg",
    "so2", "co", "o3", "o3_8hr", "no2", "nox", "no",
    "wind_speed", "wind_direc"
  ];

  const sortedFields = [
    ...preferredOrder.filter(field => fields.includes(field)),
    ...fields.filter(field => !preferredOrder.includes(field))
  ];

  sortedFields.forEach(field => {
    metricSelect.innerHTML += `
      <option value="${field}">${field}</option>
    `;
  });

  if (fields.includes("aqi")) {
    metricSelect.value = "aqi";
  } else {
    metricSelect.value = sortedFields[0];
  }
}

function applyFilters() {
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase();
  const selectedCounty = document.getElementById("countyFilter").value;
  const selectedMetric = document.getElementById("metricSelect").value;

  let filteredData = [...rawData];

  if (selectedCounty !== "all") {
    filteredData = filteredData.filter(item => {
      const county = item.county || item.County || item["縣市"] || "";
      return county === selectedCounty;
    });
  }

  if (keyword !== "") {
    filteredData = filteredData.filter(item => {
      const siteName = getSiteName(item).toLowerCase();
      const county = getCounty(item).toLowerCase();
      const status = getStatus(item).toLowerCase();

      return (
        siteName.includes(keyword) ||
        county.includes(keyword) ||
        status.includes(keyword)
      );
    });
  }

  filteredData = filteredData.filter(item => {
    const value = toNumber(item[selectedMetric]);
    return Number.isFinite(value);
  });

  currentFilteredData = filteredData;
  updateDashboard(filteredData, selectedMetric);
}

function updateDashboard(data, metric) {
  if (data.length === 0) {
    setText("avgMetric", "--");
    setText("avgMetricDesc", metric || "--");
    setText("maxMetric", "--");
    setText("maxMetricSite", "沒有符合條件的資料");
    setText("validCount", 0);

    clearCharts();
    renderTable([]);
    return;
  }

  const sortedData = [...data].sort((a, b) => {
    return toNumber(b[metric]) - toNumber(a[metric]);
  });

  const top10 = sortedData.slice(0, 10);

  updateStats(data, metric);
  renderMetricBarChart(top10, metric);
  renderMetricLineChart(top10, metric);
  renderTable(data);
}

function updateStats(data, metric) {
  const values = data
    .map(item => toNumber(item[metric]))
    .filter(value => Number.isFinite(value));

  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

  const maxItem = [...data].sort((a, b) => {
    return toNumber(b[metric]) - toNumber(a[metric]);
  })[0];

  setText("avgMetric", formatNumber(avg));
  setText("avgMetricDesc", `目前指標：${metric}`);
  setText("maxMetric", formatNumber(toNumber(maxItem[metric])));
  setText("maxMetricSite", `${getCounty(maxItem)} ${getSiteName(maxItem)}`);
  setText("validCount", data.length);
}

function renderMetricBarChart(top10, metric) {
  const canvas = document.getElementById("metricBarChart");

  if (!canvas) return;

  if (metricBarChart) {
    metricBarChart.destroy();
  }

  document.getElementById("barChartTitle").textContent =
    `${metric} Top 10 長條圖`;

  metricBarChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: top10.map(item => `${getCounty(item)} ${getSiteName(item)}`),
      datasets: [
        {
          label: metric,
          data: top10.map(item => toNumber(item[metric])),
          backgroundColor: top10.map(item => getMetricColor(metric, toNumber(item[metric]))),
          borderColor: top10.map(item => getMetricColor(metric, toNumber(item[metric]))),
          borderWidth: 1,
          borderRadius: 8,
          barThickness: window.innerWidth < 700 ? 18 : 24
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: context => `${metric}：${context.raw}`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: "#cbd5e1"
          },
          grid: {
            color: "rgba(148,163,184,0.2)"
          }
        },
        y: {
          ticks: {
            color: "#cbd5e1",
            callback: function(value) {
              const label = this.getLabelForValue(value);

              if (window.innerWidth < 700 && label.length > 8) {
                return label.slice(0, 8) + "...";
              }

              if (label.length > 14) {
                return label.slice(0, 14) + "...";
              }

              return label;
            }
          },
          grid: {
            color: "rgba(148,163,184,0.08)"
          }
        }
      }
    }
  });
}

function renderMetricLineChart(top10, metric) {
  const canvas = document.getElementById("metricLineChart");

  if (!canvas) return;

  if (metricLineChart) {
    metricLineChart.destroy();
  }

  document.getElementById("lineChartTitle").textContent =
    `${metric} Top 10 折線圖`;

  metricLineChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: top10.map((item, index) => `第${index + 1}名`),
      datasets: [
        {
          label: metric,
          data: top10.map(item => toNumber(item[metric])),
          borderColor: "#94a3b8",
          backgroundColor: "rgba(148, 163, 184, 0.18)",
          borderWidth: 3,
          pointBackgroundColor: top10.map(item => getMetricColor(metric, toNumber(item[metric]))),
          pointBorderColor: "#0f172a",
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#e5e7eb"
          }
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              const index = context[0].dataIndex;
              const item = top10[index];
              return `${getCounty(item)} ${getSiteName(item)}`;
            },
            label: function(context) {
              return `${metric}：${context.raw}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#cbd5e1"
          },
          grid: {
            color: "rgba(148,163,184,0.08)"
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#cbd5e1"
          },
          grid: {
            color: "rgba(148,163,184,0.2)"
          }
        }
      }
    }
  });
}

function renderTable(data) {
  const tableHead = document.getElementById("tableHead");
  const tableBody = document.getElementById("dataTable");
  const selectedMetric = document.getElementById("metricSelect").value;

  if (data.length === 0) {
    tableHead.innerHTML = `<tr><th>訊息</th></tr>`;
    tableBody.innerHTML = `
      <tr>
        <td>沒有符合條件的資料</td>
      </tr>
    `;
    updatePaginationInfo(0);
    return;
  }

  const sortedData = [...data].sort((a, b) => {
    return toNumber(b[selectedMetric]) - toNumber(a[selectedMetric]);
  });

  const totalPages = Math.ceil(sortedData.length / rowsPerPage);

  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;

  const pageData = sortedData.slice(startIndex, endIndex);

  tableHead.innerHTML = `
    <tr>
      <th>排名</th>
      ${allFields.map(field => `<th>${escapeHtml(field)}</th>`).join("")}
    </tr>
  `;

  tableBody.innerHTML = pageData.map((item, index) => {
    const ranking = startIndex + index + 1;

    return `
      <tr>
        <td>${ranking}</td>
        ${allFields.map(field => {
          const value = item[field] ?? "-";
          const className = field === "status" ? getStatusClass(String(value)) : "";
          return `<td class="${className}">${escapeHtml(value)}</td>`;
        }).join("")}
      </tr>
    `;
  }).join("");

  updatePaginationInfo(totalPages);
}

function updatePaginationInfo(totalPages) {
  const pageInfo = document.getElementById("pageInfo");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");

  if (totalPages === 0) {
    pageInfo.textContent = "第 0 頁 / 共 0 頁";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }

  pageInfo.textContent = `第 ${currentPage} 頁 / 共 ${totalPages} 頁`;

  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage === totalPages;
}

function renderFieldList(fields) {
  const fieldList = document.getElementById("fieldList");

  fieldList.innerHTML = fields.map(field => {
    const isNumeric = numericFields.includes(field);
    const label = isNumeric ? `${field} 數值` : field;

    return `<span class="field-tag">${escapeHtml(label)}</span>`;
  }).join("");
}

function getSiteName(item) {
  return item.sitename || item.siteName || item.SiteName || item["測站"] || "未知測站";
}

function getCounty(item) {
  return item.county || item.County || item["縣市"] || "未知縣市";
}

function getStatus(item) {
  return item.status || item.Status || item["狀態"] || "未知";
}

function getPublishTime(item) {
  return (
    item.publishtime ||
    item.publishTime ||
    item.importdate ||
    item.ImportDate ||
    item.datacreationdate ||
    item.DataCreationDate ||
    item["發布時間"] ||
    "-"
  );
}

function getLatestUpdateTime(data) {
  if (!data || data.length === 0) {
    return "--";
  }

  const timeValues = data
    .map(item => getPublishTime(item))
    .filter(time => time && time !== "-");

  if (timeValues.length === 0) {
    return "--";
  }

  return timeValues[0];
}

function getMetricColor(metric, value) {
  if (metric === "aqi") {
    return getAqiColor(value);
  }

  if (!Number.isFinite(value)) {
    return "#94a3b8";
  }

  return "#38bdf8";
}

function getAqiColor(aqi) {
  if (aqi <= 50) return "#22c55e";
  if (aqi <= 100) return "#facc15";
  if (aqi <= 150) return "#fb923c";
  if (aqi <= 200) return "#ef4444";
  if (aqi <= 300) return "#a855f7";
  return "#7f1d1d";
}

function getStatusClass(status) {
  if (status.includes("良好")) return "good";
  if (status.includes("普通")) return "moderate";
  if (status.includes("敏感")) return "warning";
  if (status.includes("非常")) return "very-danger";
  if (status.includes("不健康")) return "danger";
  if (status.includes("危害")) return "danger";
  return "";
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "--";

  if (Number.isInteger(value)) {
    return value;
  }

  return value.toFixed(2);
}

function clearCharts() {
  if (metricBarChart) {
    metricBarChart.destroy();
    metricBarChart = null;
  }

  if (metricLineChart) {
    metricLineChart.destroy();
    metricLineChart = null;
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setStatus(message) {
  const status = document.getElementById("apiStatus");
  if (status) status.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

setInterval(fetchAQIData, 60 * 60 * 1000);